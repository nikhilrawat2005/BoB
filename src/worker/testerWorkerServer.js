const express = require('express');
const { chromium } = require('playwright');
const sharp = require('sharp');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;
const WORKER_SECRET = process.env.TESTER_WORKER_SECRET || '';

// Single active job concurrency lock to guarantee 512MB RAM survival
let activeJobId = null;

// Auth middleware for protected worker routes
function requireWorkerSecret(req, res, next) {
  if (!WORKER_SECRET) {
    return next(); // If secret is not set (e.g. local dev), proceed with warning
  }
  const secretHeader = req.headers['x-worker-secret'];
  if (!secretHeader || secretHeader !== WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing worker secret' });
  }
  next();
}

// Health check endpoint (for Render health check & Vercel wake-up ping)
app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    busy: Boolean(activeJobId),
    activeJobId,
    uptime: Math.round(process.uptime()),
    memoryMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576)
  });
});

// Helper: Post webhook back to Vercel with timeout + 1 retry
async function postWebhook(callbackUrl, payload, retries = 1) {
  const postOnce = () => {
    return new Promise((resolve, reject) => {
      const parsed = new URL(callbackUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const postData = JSON.stringify(payload);
      const req = lib.request(
        parsed,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'x-worker-secret': WORKER_SECRET || '',
          },
          timeout: 25000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve({ raw: data });
              }
            } else {
              reject(new Error(`Webhook failed with status ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out after 25s'));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  };

  try {
    return await postOnce();
  } catch (err) {
    if (retries > 0) {
      console.warn(`[testerWorker] Webhook failed (${err.message}), retrying once...`);
      await new Promise((r) => setTimeout(r, 1000));
      return await postOnce();
    }
    throw err;
  }
}

// Helper: Check if candidate URL belongs to same site as base URL (handling www. and canonical redirects)
function isSameSiteUrl(candidateUrl, baseHost) {
  try {
    const candidateHost = new URL(candidateUrl).hostname.toLowerCase();
    const cleanCandidate = candidateHost.replace(/^www\./i, '');
    const cleanBase = (baseHost || '').toLowerCase().replace(/^www\./i, '');
    return cleanCandidate === cleanBase;
  } catch {
    return false;
  }
}

// Memory-optimized screenshot compressor using Sharp (WebP, quality: 65, max width: 1280)
async function compressScreenshotWebp(pngBuffer) {
  if (!pngBuffer || pngBuffer.length === 0) return null;
  const webpBuffer = await sharp(pngBuffer)
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 65 })
    .toBuffer();
  return webpBuffer.toString('base64');
}

// 512 MB strict Chromium startup flags
const CHROMIUM_ARGS = [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--js-flags=--max-old-space-size=192'
];

// Destructive and logout action guardrail blacklist regex
const DESTRUCTIVE_ACTION_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;

/**
 * Checks whether an element descriptor or URL is destructive or a logout trigger
 */
function isDestructiveOrLogout(text = '', href = '', attributes = {}) {
  const combinedText = [
    text,
    href,
    attributes.ariaLabel || '',
    attributes.title || '',
    attributes.id || '',
    attributes.name || '',
    attributes.className || ''
  ].join(' ');

  if (DESTRUCTIVE_ACTION_REGEX.test(combinedText)) return true;
  if (href && /\/(log\s*out|sign\s*out|signout|logout|delete-account|remove-account)/i.test(href)) return true;
  return false;
}

/**
 * Normalizes cookie input (JSON array or raw Cookie header string 'k1=v1; k2=v2')
 */
function normalizeCookies(cookiesInput, targetUrl) {
  if (!cookiesInput) return [];
  const parsedTarget = new URL(targetUrl);
  const targetDomain = parsedTarget.hostname;

  if (Array.isArray(cookiesInput)) {
    return cookiesInput.map(c => ({
      name: c.name || c.key,
      value: String(c.value),
      domain: c.domain || targetDomain,
      path: c.path || '/',
      httpOnly: Boolean(c.httpOnly),
      secure: typeof c.secure === 'boolean' ? c.secure : parsedTarget.protocol === 'https:',
      sameSite: c.sameSite || 'Lax'
    })).filter(c => c.name && c.value !== undefined);
  }

  if (typeof cookiesInput === 'string') {
    const trimmed = cookiesInput.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return normalizeCookies(parsed, targetUrl);
        if (typeof parsed === 'object' && parsed !== null) {
          return Object.entries(parsed).map(([k, v]) => ({
            name: k,
            value: String(v),
            domain: targetDomain,
            path: '/',
            secure: parsedTarget.protocol === 'https:'
          }));
        }
      } catch {}
    }

    // Cookie header string: "key1=val1; key2=val2"
    return trimmed.split(';')
      .map(pair => pair.trim())
      .filter(Boolean)
      .map(pair => {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) return null;
        return {
          name: pair.slice(0, eqIdx).trim(),
          value: pair.slice(eqIdx + 1).trim(),
          domain: targetDomain,
          path: '/',
          secure: parsedTarget.protocol === 'https:'
        };
      })
      .filter(Boolean);
  }

  return [];
}

/**
 * Phase 0: Pre-Crawl Authentication Engine
 * Supports: 'session', 'credentials', 'auto_signup'
 */
async function performAuthentication(context, page, startUrl, authConfig) {
  const result = {
    mode: authConfig?.mode || 'guest',
    authenticated: false,
    postLoginUrl: null,
    dashboardViewsFound: 0,
    authError: null,
    authScreenshotBase64: null,
    savedCookies: [],
    savedLocalStorage: {}
  };

  if (!authConfig || authConfig.mode === 'guest') {
    return result;
  }

  console.log(`[testerWorker] Executing Phase 0 Auth Handshake in mode: "${authConfig.mode}"...`);

  try {
    // ─────────────────────────────────────────────────────────────
    // MODE 1: SESSION INJECTION (Cookies / localStorage / Bearer)
    // ─────────────────────────────────────────────────────────────
    if (authConfig.mode === 'session') {
      const normalizedCookies = normalizeCookies(authConfig.cookiesInput, startUrl);
      if (normalizedCookies.length > 0) {
        try {
          await context.addCookies(normalizedCookies);
          console.log(`[testerWorker] Injected ${normalizedCookies.length} session cookies.`);
        } catch (cErr) {
          console.warn('[testerWorker] Cookie injection warning:', cErr.message);
        }
      }

      // localStorage injection
      if (authConfig.localStorageInput) {
        let storageEntries = {};
        if (typeof authConfig.localStorageInput === 'object') {
          storageEntries = authConfig.localStorageInput;
        } else if (typeof authConfig.localStorageInput === 'string') {
          try {
            storageEntries = JSON.parse(authConfig.localStorageInput);
          } catch {}
        }

        if (Object.keys(storageEntries).length > 0) {
          await context.addInitScript((entries) => {
            try {
              for (const [k, v] of Object.entries(entries)) {
                window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
              }
            } catch (_) {}
          }, storageEntries);
          console.log(`[testerWorker] Registered localStorage init script with ${Object.keys(storageEntries).length} entries.`);
        }
      }

      // Bearer token injection
      if (authConfig.bearerToken) {
        const token = authConfig.bearerToken.replace(/^Bearer\s+/i, '').trim();
        const origin = new URL(startUrl).origin;
        await context.route('**/*', (route) => {
          const req = route.request();
          if (req.url().startsWith(origin)) {
            const headers = { ...req.headers() };
            if (!headers['authorization']) {
              headers['authorization'] = `Bearer ${token}`;
            }
            return route.continue({ headers });
          }
          route.continue();
        });
        console.log('[testerWorker] Attached Bearer token route interceptor.');
      }

      // Navigate to target start URL
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000); // Allow SPA hydration

      const currentUrl = page.url();
      result.postLoginUrl = currentUrl;

      // Check authenticated indicators
      const authIndicators = await page.evaluate(() => {
        const hasAuthText = Boolean(document.body.innerText.match(/dashboard|projects|settings|profile|sign\s*out|log\s*out/i));
        const hasSidebarOrAvatar = Boolean(document.querySelector('aside, nav[class*="sidebar" i], [class*="dashboard" i], img[class*="avatar" i], [aria-label*="profile" i]'));
        return { hasAuthText, hasSidebarOrAvatar };
      }).catch(() => ({ hasAuthText: false, hasSidebarOrAvatar: false }));

      result.authenticated = authIndicators.hasSidebarOrAvatar || authIndicators.hasAuthText;

      const landingPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
      result.authScreenshotBase64 = await compressScreenshotWebp(landingPng);
      console.log(`[testerWorker] Session injection complete. Authenticated: ${result.authenticated}`);
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 2: SMART MULTI-STEP CREDENTIAL LOGIN
    // ─────────────────────────────────────────────────────────────
    else if (authConfig.mode === 'credentials') {
      const loginUrl = authConfig.loginUrl || startUrl;
      console.log(`[testerWorker] Navigating to login URL: ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

      // If on startUrl and no visible login inputs, try finding and clicking Login / Sign In link
      const hasVisibleLoginInput = await page.evaluate(() => {
        return Boolean(document.querySelector('input[type="password"], input[type="email"], input[name*="user" i]'));
      }).catch(() => false);

      if (!hasVisibleLoginInput) {
        const clickedLogin = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button'));
          const loginBtn = links.find(l => {
            const txt = (l.innerText || l.textContent || '').trim();
            const href = l.getAttribute('href') || '';
            return /^(log\s*in|sign\s*in|portal)$/i.test(txt) || /\/(login|signin)/i.test(href);
          });
          if (loginBtn) {
            loginBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (clickedLogin) {
          console.log('[testerWorker] Clicked login navigation trigger on landing page.');
          await page.waitForTimeout(2500);
        }
      }

      // Step 1: Identifier / Username / Email
      const identifierFilled = await page.evaluate((identifierVal) => {
        const selectors = [
          'input[type="email"]',
          'input[name*="email" i]',
          'input[name*="user" i]',
          'input[name*="login" i]',
          'input[id*="email" i]',
          'input[autocomplete="username"]',
          'input[type="text"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && (el.offsetParent !== null || window.getComputedStyle(el).display !== 'none')) {
            el.focus();
            el.value = identifierVal;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, authConfig.identifier || '');

      if (!identifierFilled) {
        throw new Error('Unable to locate visible email or username input field.');
      }
      console.log('[testerWorker] Filled identifier field.');
      await page.waitForTimeout(600);

      // Step 2: Check for Password field (Single-step vs Two-step flow)
      let hasPasswordInput = await page.evaluate(() => {
        const pw = document.querySelector('input[type="password"]');
        return Boolean(pw && (pw.offsetParent !== null || window.getComputedStyle(pw).display !== 'none'));
      }).catch(() => false);

      if (!hasPasswordInput) {
        console.log('[testerWorker] Password field not visible; attempting two-step Next/Continue click...');
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
          const nextBtn = buttons.find(b => {
            const txt = (b.innerText || b.value || '').trim();
            return /^(next|continue|submit|proceed)$/i.test(txt);
          });
          if (nextBtn) nextBtn.click();
        }).catch(() => {});

        // Wait up to 4000ms for password input to appear
        await page.waitForSelector('input[type="password"]', { timeout: 4000 }).catch(() => {});
      }

      // Fill Password
      const passwordFilled = await page.evaluate((pwVal) => {
        const pw = document.querySelector('input[type="password"]');
        if (pw) {
          pw.focus();
          pw.value = pwVal;
          pw.dispatchEvent(new Event('input', { bubbles: true }));
          pw.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, authConfig.password || '');

      if (!passwordFilled) {
        throw new Error('Unable to locate password input field.');
      }
      console.log('[testerWorker] Filled password field.');
      await page.waitForTimeout(600);

      // Step 3: Submit Login Form
      const submitted = await page.evaluate(() => {
        const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          submitBtn.click();
          return true;
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        const loginBtn = buttons.find(b => /log\s*in|sign\s*in|continue|submit|enter/i.test(b.innerText || ''));
        if (loginBtn) {
          loginBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (!submitted) {
        await page.keyboard.press('Enter');
      }

      // Wait up to 8s for navigation / settlement
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
        page.waitForTimeout(4500)
      ]);

      // Step 3b: Handle OTP/PIN if provided
      if (authConfig.otpOrPin) {
        const otpFilled = await page.evaluate((otpVal) => {
          const otpInput = document.querySelector('input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"], input[placeholder*="code" i], input[placeholder*="otp" i]');
          if (otpInput) {
            otpInput.focus();
            otpInput.value = otpVal;
            otpInput.dispatchEvent(new Event('input', { bubbles: true }));
            otpInput.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }, authConfig.otpOrPin).catch(() => false);

        if (otpFilled) {
          console.log('[testerWorker] Filled OTP / PIN input.');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
        }
      }

      // Step 4: Verify Login & Snapshot
      const postUrl = page.url();
      result.postLoginUrl = postUrl;

      const isStillOnLogin = /\/(login|signin)/i.test(postUrl);
      const postCheck = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        const hasAuthIndicators = Boolean(text.match(/dashboard|logout|sign\s*out|my\s*account|settings/i));
        const hasSidebarOrAvatar = Boolean(document.querySelector('aside, nav[class*="sidebar" i], [class*="dashboard" i], img[class*="avatar" i], [aria-label*="profile" i]'));
        return { hasAuthIndicators, hasSidebarOrAvatar };
      }).catch(() => ({ hasAuthIndicators: false, hasSidebarOrAvatar: false }));

      result.authenticated = !isStillOnLogin && (postCheck.hasAuthIndicators || postCheck.hasSidebarOrAvatar);

      const landingPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
      result.authScreenshotBase64 = await compressScreenshotWebp(landingPng);
      console.log(`[testerWorker] Credential login completed. Authenticated: ${result.authenticated} - Current URL: ${postUrl}`);
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 3: AUTONOMOUS TEST REGISTRATION (Auto-Signup)
    // ─────────────────────────────────────────────────────────────
    else if (authConfig.mode === 'auto_signup') {
      const signupUrl = authConfig.signupUrl || startUrl;
      console.log(`[testerWorker] Navigating to signup URL: ${signupUrl}`);
      await page.goto(signupUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

      // Check if registration inputs are visible, otherwise locate Sign Up link
      const hasSignupInput = await page.evaluate(() => {
        return Boolean(document.querySelector('input[type="password"], input[type="email"]'));
      }).catch(() => false);

      if (!hasSignupInput) {
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button'));
          const regBtn = links.find(l => {
            const txt = (l.innerText || l.textContent || '').trim();
            const href = l.getAttribute('href') || '';
            return /^(sign\s*up|register|create\s*account|get\s*started)$/i.test(txt) || /\/(signup|register)/i.test(href);
          });
          if (regBtn) regBtn.click();
        }).catch(() => {});
        await page.waitForTimeout(2500);
      }

      // Deterministic test credentials
      const testEmail = `bob.audit.${Date.now()}@testmail.app`;
      const testPassword = `BobAudit#${new Date().getFullYear()}!`;
      const testName = 'Bob QA Tester';

      await page.evaluate(({ name, email, password }) => {
        const nameInput = document.querySelector('input[name*="name" i], input[id*="name" i], input[placeholder*="name" i]');
        if (nameInput) {
          nameInput.focus();
          nameInput.value = name;
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const emailInput = document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
        if (emailInput) {
          emailInput.focus();
          emailInput.value = email;
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const pwInputs = Array.from(document.querySelectorAll('input[type="password"]'));
        pwInputs.forEach((p) => {
          p.focus();
          p.value = password;
          p.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Accept checkboxes if any (e.g. Terms)
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        checkboxes.forEach(c => { if (!c.checked) c.click(); });
      }, { name: testName, email: testEmail, password: testPassword }).catch(() => {});

      await page.waitForTimeout(500);

      // Submit Registration
      await page.evaluate(() => {
        const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          submitBtn.click();
          return;
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        const regBtn = buttons.find(b => /sign\s*up|register|create|get\s*started/i.test(b.innerText || ''));
        if (regBtn) regBtn.click();
      }).catch(() => {});

      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
        page.waitForTimeout(4500)
      ]);

      const postUrl = page.url();
      result.postLoginUrl = postUrl;
      result.authenticated = !/\/(signup|register)/i.test(postUrl);

      const landingPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
      result.authScreenshotBase64 = await compressScreenshotWebp(landingPng);
      console.log(`[testerWorker] Auto-signup complete. Authenticated: ${result.authenticated} - URL: ${postUrl}`);
    }

    // Capture Reusable savedAuthSnapshot for Session Persistence Recovery
    if (result.authenticated) {
      result.savedCookies = await context.cookies().catch(() => []);
      result.savedLocalStorage = await page.evaluate(() => {
        try {
          return { ...window.localStorage };
        } catch (_) {
          return {};
        }
      }).catch(() => ({}));
      console.log(`[testerWorker] Captured session recovery snapshot (${result.savedCookies.length} cookies, ${Object.keys(result.savedLocalStorage).length} localStorage keys).`);
    }

  } catch (err) {
    console.warn('[testerWorker] Phase 0 Authentication failed, falling back to public crawl:', err.message);
    result.authError = err.message;
    result.authenticated = false;
    result.postLoginUrl = page.url();
  }

  return result;
}

/**
 * Discovers interactive SPA Dashboard Views & Sidebar Tabs that change views without <a href>
 */
async function discoverSpaInteractiveViews(page) {
  return await page.evaluate(() => {
    const DESTRUCTIVE_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;
    const views = [];

    const candidates = Array.from(document.querySelectorAll(
      'aside button, aside [role="tab"], aside [role="menuitem"], nav[class*="sidebar" i] button, [class*="sidebar" i] button, [class*="dashboard" i] [role="tab"], [role="tablist"] [role="tab"]'
    ));

    for (let i = 0; i < candidates.length && views.length < 8; i++) {
      const el = candidates[i];
      const text = (el.innerText || el.textContent || '').trim().slice(0, 60);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const checkString = `${text} ${ariaLabel} ${title} ${el.className || ''}`;

      if (!text && !ariaLabel) continue;
      if (DESTRUCTIVE_REGEX.test(checkString)) continue;

      // Build unique selector
      let selector = '';
      if (el.id) {
        selector = `#${el.id}`;
      } else if (el.getAttribute('role') === 'tab' && ariaLabel) {
        selector = `[role="tab"][aria-label="${ariaLabel}"]`;
      } else if (el.getAttribute('data-tab')) {
        selector = `[data-tab="${el.getAttribute('data-tab')}"]`;
      } else {
        const idx = Array.from(el.parentElement ? el.parentElement.children : []).indexOf(el) + 1;
        selector = `${el.tagName.toLowerCase()}:nth-child(${idx})`;
      }

      views.push({
        spaTabSelector: selector,
        spaTabLabel: text || ariaLabel,
        title: `Dashboard Tab: ${text || ariaLabel}`,
        isDashboardView: true
      });
    }

    return views;
  }).catch(() => []);
}

// Main Playwright execution pipeline (Phases 0, 1 & 3 on Render)
async function executePlaywrightPipeline({ testId, userId, url, callbackUrl, authConfig }) {
  let browser = null;
  const startTime = Date.now();

  try {
    console.log(`[testerWorker] Starting execution for test ${testId} - URL: ${url} (Auth Mode: ${authConfig?.mode || 'guest'})`);
    browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 BobWebsiteTester/1.0',
    });

    const page = await context.newPage();
    const initialOrigin = new URL(url).origin;
    const initialHost = new URL(url).hostname;

    // ─────────────────────────────────────────────────────────────
    // PHASE 0: AUTHENTICATION HANDSHAKE & SESSION PERSISTENCE
    // ─────────────────────────────────────────────────────────────
    const authResult = await performAuthentication(context, page, url, authConfig);
    const postLoginUrl = authResult.authenticated && authResult.postLoginUrl ? authResult.postLoginUrl : url;

    // Canonical Origin Resolution: compute both initial and post-redirect origin & hostname
    let canonicalOrigin = initialOrigin;
    let canonicalHost = initialHost;
    try {
      const currentLoc = page.url();
      if (currentLoc && currentLoc.startsWith('http')) {
        canonicalOrigin = new URL(currentLoc).origin;
        canonicalHost = new URL(currentLoc).hostname;
      }
    } catch {}

    // Helper: restore session persistence snapshot if page drops or redirects to login
    const ensureSessionActive = async (targetDestUrl) => {
      if (!authResult.authenticated) return;
      const current = page.url();
      if (/\/(login|signin)/i.test(current)) {
        console.warn(`[testerWorker] Detected unexpected session drop to login (${current}). Restoring saved session snapshot...`);
        try {
          if (authResult.savedCookies && authResult.savedCookies.length > 0) {
            await context.addCookies(authResult.savedCookies);
          }
          if (authResult.savedLocalStorage && Object.keys(authResult.savedLocalStorage).length > 0) {
            await page.evaluate((entries) => {
              try {
                for (const [k, v] of Object.entries(entries)) {
                  window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
                }
              } catch (_) {}
            }, authResult.savedLocalStorage);
          }
          await page.goto(targetDestUrl || postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(1000);
        } catch (resErr) {
          console.warn('[testerWorker] Session recovery attempt notice:', resErr.message);
        }
      }
    };

    // ─────────────────────────────────────────────────────────────
    // PHASE 1: DISCOVERY CRAWL (BFS Graph + SPA Sidebar Discovery)
    // ─────────────────────────────────────────────────────────────
    const discoveryStartTime = Date.now();
    const visitedUrls = new Set();
    const discoveredLinks = [];
    const linkQueue = [postLoginUrl];
    if (url !== postLoginUrl) linkQueue.push(url);

    const SAFETY_CAP = 10000;
    const DISCOVERY_TIMEOUT_MS = 25000;

    let pageTitle = '';
    let homepageVisibleText = '';
    let headings = [];
    let ctas = [];
    let formsOverview = [];

    // Ensure we start discovery on postLoginUrl
    if (page.url() !== postLoginUrl) {
      await page.goto(postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    pageTitle = await page.title().catch(() => '');

    const homepageData = await page.evaluate(() => {
      const getVisibleText = (el) => (el.innerText || el.textContent || '').trim();
      const hTags = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => ({ level: h.tagName.toLowerCase(), text: getVisibleText(h).slice(0, 150) }))
        .filter((h) => h.text.length > 0)
        .slice(0, 30);

      const buttons = Array.from(document.querySelectorAll('button, a.btn, a[role="button"], input[type="submit"]'))
        .map((b) => getVisibleText(b).slice(0, 80))
        .filter((t) => t.length > 0)
        .slice(0, 20);

      const forms = Array.from(document.querySelectorAll('form')).map((f) => {
        const inputs = Array.from(f.querySelectorAll('input, select, textarea')).map((i) => ({
          name: i.name || i.id || '',
          type: i.type || i.tagName.toLowerCase(),
          placeholder: i.placeholder || ''
        }));
        return {
          action: f.action || '',
          method: (f.method || 'GET').toUpperCase(),
          inputCount: inputs.length,
          inputs: inputs.slice(0, 10)
        };
      }).slice(0, 5);

      const bodyText = (document.body.innerText || '').slice(0, 5000);

      return { hTags, buttons, forms, bodyText };
    }).catch(() => ({ hTags: [], buttons: [], forms: [], bodyText: '' }));

    headings = homepageData.hTags;
    ctas = homepageData.buttons;
    formsOverview = homepageData.forms;
    homepageVisibleText = homepageData.bodyText;

    // Extract Homepage Claims & Quantitative Stats (e.g. package stats, offer counts, accreditations, ranking numbers)
    const homepageClaims = await page.evaluate(() => {
      const claims = [];
      const text = document.body ? document.body.innerText : '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 200);

      // Match numbers, percentages, packages (LPA/Cr/k/M), rankings (NIRF, NAAC, NBA), prices, dates
      const statPattern = /(\b\d+(\.\d+)?\s*(%|lpa|ctc|offers|placements|rank|ranking|students|alumni|crore|cr|lakh|lakhs|star|stars|accredited|grade)\b|highest\s*package|average\s*package|naac\s*[a-z\+]+|nirf\b|aicte|aktu)/i;
      for (const line of lines) {
        if (statPattern.test(line) && !claims.includes(line)) {
          claims.push(line);
          if (claims.length >= 25) break;
        }
      }
      return claims;
    }).catch(() => []);

    // Fast DOM Link Extraction with Destructive/Logout Guardrails & Mega-Menu/Hidden Dropdowns
    const extractPageLinks = async () => {
      return await page.evaluate(({ baseHost }) => {
        const DESTRUCTIVE_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;
        const BINARY_EXTENSIONS_REGEX = /\.(pdf|zip|tar|gz|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|mp4|mov|avi|mkv|mp3|wav|docx?|xlsx?|pptx?|exe|dmg|apk)$/i;

        const cleanBase = (baseHost || '').toLowerCase().replace(/^www\./i, '');
        const isInternalHost = (h) => (h || '').toLowerCase().replace(/^www\./i, '') === cleanBase;

        const links = [];
        // Scan ALL links in DOM: nav, header, aside, footer, mega-menus, collapsed dropdowns
        const anchors = document.querySelectorAll('a[href], nav a, header a, footer a, [role="menu"] a, .dropdown-menu a, .mega-menu a');
        anchors.forEach((a) => {
          try {
            const rawHref = a.getAttribute('href');
            if (!rawHref) return;
            const trimmedHref = rawHref.trim();
            if (trimmedHref.startsWith('#') || trimmedHref.startsWith('javascript:') || trimmedHref.startsWith('mailto:') || trimmedHref.startsWith('tel:')) return;

            const text = (a.innerText || a.textContent || '').trim().slice(0, 100);
            const ariaLabel = a.getAttribute('aria-label') || '';
            const title = a.getAttribute('title') || '';
            const checkStr = `${text} ${ariaLabel} ${title} ${trimmedHref}`;

            // Destructive Guardrail Check
            if (DESTRUCTIVE_REGEX.test(checkStr) || /\/(log\s*out|sign\s*out|signout|logout|delete-account)/i.test(trimmedHref)) {
              return;
            }

            const parsed = new URL(trimmedHref, window.location.href);
            if (!isInternalHost(parsed.hostname)) return;

            // Strip binary extensions
            if (BINARY_EXTENSIONS_REGEX.test(parsed.pathname)) return;

            // Normalize URL: strip hash and trailing slash (except root)
            let cleanUrl = `${parsed.origin}${parsed.pathname}`;
            if (cleanUrl.length > parsed.origin.length + 1 && cleanUrl.endsWith('/')) {
              cleanUrl = cleanUrl.slice(0, -1);
            }
            if (parsed.search) {
              cleanUrl += parsed.search;
            }

            const isVisible = (a.offsetParent !== null) && (window.getComputedStyle(a).display !== 'none');
            links.push({ url: cleanUrl, linkText: text, isVisible });
          } catch {}
        });
        return links;
      }, { baseHost: canonicalHost }).catch(() => []);
    };

    const initialLinks = await extractPageLinks();
    for (const l of initialLinks) {
      if (!visitedUrls.has(l.url) && discoveredLinks.length < SAFETY_CAP) {
        visitedUrls.add(l.url);
        discoveredLinks.push(l);
        if (linkQueue.length < 50) linkQueue.push(l.url);
      }
    }

    // Try fetching /sitemap.xml (with 4s timeout) to harvest sitemap links matching the same site domain
    try {
      const sitemapUrl = `${canonicalOrigin}/sitemap.xml`;
      const sitemapLinks = await page.evaluate(async (sUrl) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(sUrl, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) return [];
          const xmlText = await res.text();
          const locMatches = xmlText.match(/<loc>(.*?)<\/loc>/gi) || [];
          return locMatches.map(m => m.replace(/<\/?loc>/gi, '').trim());
        } catch {
          return [];
        }
      }, sitemapUrl);

      for (const rawLoc of sitemapLinks) {
        if (isSameSiteUrl(rawLoc, canonicalHost)) {
          const BINARY_REGEX = /\.(pdf|zip|tar|gz|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|mp4|mov|avi|mkv|mp3|wav|docx?|xlsx?|pptx?)$/i;
          if (!BINARY_REGEX.test(rawLoc)) {
            const clean = rawLoc.split('#')[0].replace(/\/$/, '');
            if (!visitedUrls.has(clean) && discoveredLinks.length < SAFETY_CAP) {
              visitedUrls.add(clean);
              discoveredLinks.push({ url: clean, linkText: 'Sitemap Link', isVisible: true });
            }
          }
        }
      }
    } catch (sitemapErr) {
      console.warn('[testerWorker] Sitemap harvest skipped:', sitemapErr.message);
    }

    // SPA Sidebar & Tab Discovery on authenticated dashboard
    let discoveredSpaTabs = [];
    if (authResult.authenticated || /dashboard|portal|app/i.test(postLoginUrl)) {
      discoveredSpaTabs = await discoverSpaInteractiveViews(page);
      console.log(`[testerWorker] Discovered ${discoveredSpaTabs.length} interactive SPA dashboard tabs/views.`);
    }

    // BFS crawl remaining links until timeout or safety cap
    while (linkQueue.length > 0 && (Date.now() - discoveryStartTime) < DISCOVERY_TIMEOUT_MS && discoveredLinks.length < SAFETY_CAP) {
      const nextUrl = linkQueue.shift();
      try {
        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 6000 });
        const moreLinks = await extractPageLinks();
        for (const l of moreLinks) {
          if (!visitedUrls.has(l.url) && discoveredLinks.length < SAFETY_CAP) {
            visitedUrls.add(l.url);
            discoveredLinks.push(l);
            if (linkQueue.length < 100) linkQueue.push(l.url);
          }
        }
      } catch {
        // Continue discovery despite single page errors
      }
    }

    // Count dashboard views found
    const dashboardRoutesCount = discoveredLinks.filter(l => /\/(dashboard|analytics|settings|projects|billing|profile|teams|workspaces)/i.test(l.url)).length + discoveredSpaTabs.length;
    authResult.dashboardViewsFound = dashboardRoutesCount;

    const discoveryPayload = {
      event: 'phase1_complete',
      testId,
      userId,
      authResult: {
        mode: authResult.mode,
        authenticated: authResult.authenticated,
        postLoginUrl: authResult.postLoginUrl,
        dashboardViewsFound: authResult.dashboardViewsFound,
        authError: authResult.authError,
        authScreenshotBase64: authResult.authScreenshotBase64
      },
      site: {
        title: pageTitle,
        startUrl: url,
        postLoginUrl,
        origin: canonicalOrigin,
        pageCount: discoveredLinks.length + discoveredSpaTabs.length + 1,
        truncated: discoveredLinks.length >= SAFETY_CAP,
        tookMs: Date.now() - discoveryStartTime
      },
      discoveryData: {
        homepage: {
          title: pageTitle,
          textSample: homepageVisibleText,
          headings,
          ctas,
          forms: formsOverview,
          extractedClaims: homepageClaims
        },
        linksSample: discoveredLinks.slice(0, 100),
        spaTabs: discoveredSpaTabs
      }
    };

    console.log(`[testerWorker] Phase 1 complete. Discovered ${discoveredLinks.length + 1} pages & ${discoveredSpaTabs.length} SPA tabs. Sending to Vercel webhook...`);
    const phase2Response = await postWebhook(callbackUrl, discoveryPayload);
    console.log(`[testerWorker] Phase 2 plan received from Vercel:`, phase2Response);

    // ─────────────────────────────────────────────────────────────
    // TWO-TIER FULL-SITE EXPLORATION PIPELINE (Phase 3)
    // ─────────────────────────────────────────────────────────────
    // Target Pages Selection: Ensure BOTH Public Landing Pages AND Post-Login Dashboard Views are included!
    let tier1Urls = [];
    const publicPriorityUrls = [url];
    const dashboardPriorityUrls = [];

    // Separate discovered links into dashboard/authenticated vs public
    for (const linkItem of discoveredLinks) {
      const linkUrl = typeof linkItem === 'string' ? linkItem : linkItem.url;
      if (!linkUrl) continue;
      if (/\/(dashboard|analytics|settings|projects|billing|profile|teams|explore|ai-hub|saved|portal|account)/i.test(linkUrl)) {
        if (!dashboardPriorityUrls.includes(linkUrl)) dashboardPriorityUrls.push(linkUrl);
      } else {
        if (!publicPriorityUrls.includes(linkUrl)) publicPriorityUrls.push(linkUrl);
      }
    }

    if (authResult.authenticated && authResult.postLoginUrl && !dashboardPriorityUrls.includes(authResult.postLoginUrl)) {
      dashboardPriorityUrls.unshift(authResult.postLoginUrl);
    }

    // Blend: take priority public routes AND priority dashboard routes in Tier 1 Deep Audit
    if (phase2Response && Array.isArray(phase2Response.targetPages) && phase2Response.targetPages.length > 0) {
      const llmTargets = phase2Response.targetPages.filter(p => typeof p === 'string' && p.startsWith('http'));
      tier1Urls = llmTargets.slice(0, 15);
    }

    // Ensure at least 3-4 public pages AND 3-4 dashboard pages are always in Tier 1 if available
    publicPriorityUrls.slice(0, 5).forEach(u => {
      if (!tier1Urls.includes(u) && tier1Urls.length < 15) tier1Urls.push(u);
    });
    dashboardPriorityUrls.slice(0, 6).forEach(u => {
      if (!tier1Urls.includes(u) && tier1Urls.length < 15) tier1Urls.push(u);
    });

    // If still room, fill from discovered links
    discoveredLinks.forEach(l => {
      const linkUrl = typeof l === 'string' ? l : l.url;
      if (linkUrl && !tier1Urls.includes(linkUrl) && tier1Urls.length < 15) tier1Urls.push(linkUrl);
    });

    // Build combined Tier 1 targets (pages + up to 5 discovered SPA tabs)
    const tier1Targets = tier1Urls.map(u => ({ url: u, isSpaTab: false }));
    if (discoveredSpaTabs.length > 0) {
      discoveredSpaTabs.slice(0, 5).forEach(tab => {
        tier1Targets.push({
          url: postLoginUrl,
          isSpaTab: true,
          spaTabSelector: tab.spaTabSelector,
          spaTabLabel: tab.spaTabLabel,
          title: tab.title
        });
      });
    }

    // Tier 2 Targets: Remaining discovered internal pages not in Tier 1 (up to 30 pages)
    const tier1UrlSet = new Set(tier1Urls);
    const tier2Targets = [];
    for (const linkItem of discoveredLinks) {
      const linkUrl = typeof linkItem === 'string' ? linkItem : linkItem.url;
      if (linkUrl && !tier1UrlSet.has(linkUrl) && !tier2Targets.includes(linkUrl)) {
        tier2Targets.push(linkUrl);
        if (tier2Targets.length >= 30) break;
      }
    }

    const totalExplorationCount = tier1Targets.length + tier2Targets.length;
    console.log(`[testerWorker] Starting Two-Tier Exploration: Tier 1 Deep Audit = ${tier1Targets.length} targets, Tier 2 Sweep = ${tier2Targets.length} targets (Total: ${totalExplorationCount} targets)`);

    const pagesEvidence = [];
    let overallProgressDone = 0;

    // Helper: Run Auto-Scroll Hydration Pass (down and back up)
    const runAutoScrollHydration = async () => {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let step = 0;
          const maxSteps = 4;
          const interval = setInterval(() => {
            step++;
            window.scrollBy(0, window.innerHeight || 600);
            if (step >= maxSteps) {
              clearInterval(interval);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 250);
        });
      }).catch(() => {});
      await page.waitForTimeout(600);
    };

    // ─────────────────────────────────────────────────────────
    // TIER 1: DEEP VISUAL + INTERACTIVE AUDIT (Desktop & Mobile)
    // ─────────────────────────────────────────────────────────
    for (let i = 0; i < tier1Targets.length; i++) {
      const targetItem = tier1Targets[i];
      const targetUrl = targetItem.url;
      const isSpaTab = targetItem.isSpaTab;
      const targetDisplay = isSpaTab ? `${targetUrl} [Tab: ${targetItem.spaTabLabel}]` : targetUrl;
      overallProgressDone++;
      console.log(`[testerWorker] [Tier 1 Deep Audit] ${i + 1}/${tier1Targets.length} (${overallProgressDone}/${totalExplorationCount}): ${targetDisplay}`);

      await ensureSessionActive(targetUrl);

      const pageErrors = [];
      const networkAnomalies = [];
      const interactiveLogs = [];
      const networkFailedUrls = new Set();
      const httpErrorStatuses = new Map();

      const onConsole = (msg) => {
        if (msg.type() === 'error') {
          pageErrors.push({ type: 'console_error', text: msg.text().slice(0, 300), location: msg.location() });
        }
      };
      const onPageError = (err) => {
        pageErrors.push({ type: 'uncaught_exception', text: (err.message || String(err)).slice(0, 300) });
      };
      const onRequestFailed = (req) => {
        const failedUrl = req.url().slice(0, 200);
        networkFailedUrls.add(req.url());
        networkAnomalies.push({
          type: 'request_failed',
          url: failedUrl,
          method: req.method(),
          failure: req.failure() ? req.failure().errorText : 'Unknown failure'
        });
      };
      const onResponse = async (res) => {
        try {
          const status = res.status();
          const req = res.request();
          const resUrl = res.url();
          if (status >= 400) {
            httpErrorStatuses.set(resUrl, status);
            networkAnomalies.push({
              type: 'http_error',
              url: resUrl.slice(0, 200),
              method: req.method(),
              status
            });
          }
        } catch {}
      };

      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('requestfailed', onRequestFailed);
      page.on('response', onResponse);

      let desktopScreenshotBase64 = null;
      let mobileScreenshotBase64 = null;
      let domAudit = null;
      let loadTimingMs = 0;

      try {
        await page.setViewportSize({ width: 1280, height: 720 });
        const navStart = Date.now();

        if (isSpaTab) {
          if (page.url() !== targetUrl) {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
            await page.waitForTimeout(1000);
          }
          const tabSafeToClick = await page.evaluate(({ sel }) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const DESTRUCTIVE_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;
            const text = (el.innerText || el.textContent || '').trim();
            const aria = el.getAttribute('aria-label') || '';
            const href = el.getAttribute('href') || '';
            if (DESTRUCTIVE_REGEX.test(`${text} ${aria} ${href}`)) return false;
            el.click();
            return true;
          }, { sel: targetItem.spaTabSelector });

          if (!tabSafeToClick) {
            interactiveLogs.push({ action: targetItem.spaTabLabel, skipped: 'Blocked by Destructive/Logout Guardrail' });
          } else {
            interactiveLogs.push({ action: 'Clicked SPA Tab', label: targetItem.spaTabLabel });
            await page.waitForTimeout(1200);
          }
        } else {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
          await page.waitForTimeout(600);
        }

        loadTimingMs = Date.now() - navStart;

        // Auto-Scroll Hydration Pass (eliminates lazy-load false positives)
        await runAutoScrollHydration();

        // Accurate DOM Audit: Accurate Broken Images, Content Claims & Interactive Elements
        const failedUrlList = Array.from(networkFailedUrls);
        const httpErrorList = Array.from(httpErrorStatuses.entries()).map(([u, s]) => ({ url: u, status: s }));

        domAudit = await page.evaluate(({ failedUrls, httpErrors }) => {
          const docEl = document.documentElement;
          const bodyEl = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, bodyEl ? bodyEl.scrollWidth : 0);
          const clientWidth = docEl.clientWidth || window.innerWidth;
          const hasHorizontalOverflow = scrollWidth > (clientWidth + 5);

          // 1. Accurate Broken Image Detection:
          // Only flag if its src returned >=400/requestfailed OR (complete && naturalWidth === 0 with non-empty src after scroll)
          const brokenImages = [];
          const allImages = Array.from(document.querySelectorAll('img'));
          allImages.forEach((img) => {
            const rawSrc = (img.src || img.getAttribute('src') || '').trim();
            if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.length < 5) return;

            const isNetworkFailed = failedUrls.some(u => u === rawSrc || rawSrc.includes(u));
            const isHttpError = httpErrors.some(e => e.url === rawSrc || rawSrc.includes(e.url));
            const isNaturalZero = img.complete === true && img.naturalWidth === 0;

            if (isNetworkFailed || isHttpError || isNaturalZero) {
              // Ensure it's not a 1x1 tracking pixel
              const widthAttr = parseInt(img.getAttribute('width') || '10', 10);
              const heightAttr = parseInt(img.getAttribute('height') || '10', 10);
              if (widthAttr <= 1 && heightAttr <= 1) return;

              brokenImages.push({
                src: rawSrc.slice(0, 200),
                alt: img.alt || '',
                reason: isHttpError ? 'HTTP Error' : (isNetworkFailed ? 'Network Failed' : 'Rendered naturalWidth 0')
              });
            }
          });

          // 2. Dead Buttons / Controls (Skip modern interactive attributes!)
          const suspiciousControls = [];
          const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], [role="tab"]'));
          const DESTRUCTIVE_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;

          candidates.forEach((el, idx) => {
            const href = el.getAttribute('href');
            const isHashOrVoid = href === '#' || href === 'javascript:void(0);' || href === 'javascript:;' || !href;
            if (!isHashOrVoid) return;

            const text = (el.innerText || el.textContent || '').trim().slice(0, 60);
            const ariaLabel = el.getAttribute('aria-label') || '';
            const checkStr = `${text} ${ariaLabel} ${el.className || ''}`;
            if (DESTRUCTIVE_REGEX.test(checkStr)) return;

            // Check if element has modern interactive/tab/modal attributes
            const hasInteractiveAttr = el.hasAttribute('data-bs-toggle') ||
              el.hasAttribute('data-toggle') ||
              el.hasAttribute('data-bs-target') ||
              el.hasAttribute('data-target') ||
              el.getAttribute('role') === 'tab' ||
              el.getAttribute('role') === 'button' ||
              el.hasAttribute('aria-controls') ||
              el.hasAttribute('aria-expanded') ||
              el.hasAttribute('aria-haspopup') ||
              el.hasAttribute('@click') ||
              el.hasAttribute('ng-click') ||
              Boolean(el.onclick);

            if (!hasInteractiveAttr && text.length > 0) {
              let sel = el.id ? `#${el.id}` : '';
              if (!sel) {
                const parent = el.parentElement;
                const childIdx = parent ? Array.from(parent.children).indexOf(el) + 1 : 1;
                sel = `${el.tagName.toLowerCase()}:nth-child(${childIdx})`;
              }
              suspiciousControls.push({ selector: sel, text, tag: el.tagName.toLowerCase(), checkIdx: idx });
            }
          });

          // 3. Extract Content Statistics & Headings from this page
          const pageHeadings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => ({ level: h.tagName.toLowerCase(), text: (h.innerText || h.textContent || '').trim().slice(0, 150) }))
            .filter(h => h.text.length > 0)
            .slice(0, 20);

          const missingAltCount = Array.from(document.querySelectorAll('img:not([alt]), img[alt=""]')).length;
          const unlabelledInputs = Array.from(document.querySelectorAll('input:not([aria-label]):not([placeholder])')).length;

          return {
            scrollWidth,
            clientWidth,
            hasHorizontalOverflow,
            brokenImages: brokenImages.slice(0, 15),
            suspiciousControls: suspiciousControls.slice(0, 10),
            pageHeadings,
            accessibilitySummary: { missingAltCount, unlabelledInputs }
          };
        }, { failedUrls: failedUrlList, httpErrors: httpErrorList }).catch(() => null);

        // Real click verification on up to 5 candidate suspicious dead buttons
        const verifiedDeadButtons = [];
        if (domAudit && Array.isArray(domAudit.suspiciousControls)) {
          for (let cIdx = 0; cIdx < Math.min(domAudit.suspiciousControls.length, 5); cIdx++) {
            const ctrl = domAudit.suspiciousControls[cIdx];
            try {
              const clickResult = await page.evaluate(async (ctrlItem) => {
                const el = document.querySelectorAll('a, button, [role="button"], [role="tab"]')[ctrlItem.checkIdx];
                if (!el) return { changed: true };

                const urlBefore = window.location.href;
                const bodyLenBefore = document.body ? document.body.innerHTML.length : 0;
                const scrollYBefore = window.scrollY;

                try { el.click(); } catch { return { changed: true }; }

                await new Promise(r => setTimeout(r, 400));

                const urlAfter = window.location.href;
                const bodyLenAfter = document.body ? document.body.innerHTML.length : 0;
                const scrollYAfter = window.scrollY;

                const hasUrlChange = urlBefore !== urlAfter;
                const hasDomMutation = Math.abs(bodyLenAfter - bodyLenBefore) > 10;
                const hasScrollChange = Math.abs(scrollYAfter - scrollYBefore) > 50;

                return { changed: hasUrlChange || hasDomMutation || hasScrollChange };
              }, ctrl).catch(() => ({ changed: true }));

              if (!clickResult.changed) {
                verifiedDeadButtons.push(ctrl.text);
              }
            } catch {}
          }
          domAudit.deadButtons = verifiedDeadButtons;
          delete domAudit.suspiciousControls;
        }

        // Desktop screenshot
        const desktopPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
        desktopScreenshotBase64 = await compressScreenshotWebp(desktopPng);

        // Mobile walk (390x844)
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(500);

        const mobileAudit = await page.evaluate(() => {
          const scrollWidth = document.documentElement.scrollWidth;
          const clientWidth = window.innerWidth;
          const mobileNavToggle = document.querySelector('button[aria-label*="menu" i], button.hamburger, .menu-toggle');
          return {
            hasMobileOverflow: scrollWidth > (clientWidth + 5),
            scrollWidth,
            clientWidth,
            hasMobileNav: Boolean(mobileNavToggle)
          };
        }).catch(() => null);

        if (domAudit && mobileAudit) {
          domAudit.mobile = mobileAudit;
        }

        const mobilePng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
        mobileScreenshotBase64 = await compressScreenshotWebp(mobilePng);

      } catch (pageErr) {
        pageErrors.push({ type: 'page_nav_error', text: pageErr.message });
      } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
      }

      pagesEvidence.push({
        url: targetDisplay,
        tier: 1,
        loadTimingMs,
        isSpaTab: Boolean(isSpaTab),
        spaTabLabel: targetItem.spaTabLabel || null,
        errors: pageErrors.slice(0, 15),
        networkAnomalies: networkAnomalies.slice(0, 15),
        interactiveLogs,
        domAudit,
        screenshots: {
          desktopWebpBase64: desktopScreenshotBase64,
          mobileWebpBase64: mobileScreenshotBase64
        }
      });

      // Flush micro-batches every 2 Tier 1 pages
      if (pagesEvidence.length >= 2 || i === tier1Targets.length - 1) {
        console.log(`[testerWorker] Flushing Tier 1 micro-batch (${pagesEvidence.length} pages)...`);
        await postWebhook(callbackUrl, {
          event: 'phase3_batch',
          testId,
          userId,
          progressDone: overallProgressDone,
          progressTotal: totalExplorationCount,
          pagesEvidence: [...pagesEvidence]
        });
        pagesEvidence.length = 0;
      }
    }

    // ─────────────────────────────────────────────────────────
    // TIER 2: FAST FULL-SITE SWEEP (Up to 30 Additional Pages)
    // ─────────────────────────────────────────────────────────
    console.log(`[testerWorker] Starting Tier 2 Fast Sweep across ${tier2Targets.length} discovered URLs...`);
    for (let j = 0; j < tier2Targets.length; j++) {
      const sweepUrl = tier2Targets[j];
      overallProgressDone++;
      console.log(`[testerWorker] [Tier 2 Sweep] ${j + 1}/${tier2Targets.length} (${overallProgressDone}/${totalExplorationCount}): ${sweepUrl}`);

      const pageErrors = [];
      const networkAnomalies = [];
      let domAudit = null;
      let loadTimingMs = 0;
      let sweepScreenshotBase64 = null;

      const onConsole = (msg) => {
        if (msg.type() === 'error') {
          pageErrors.push({ type: 'console_error', text: msg.text().slice(0, 300) });
        }
      };
      const onPageError = (err) => {
        pageErrors.push({ type: 'uncaught_exception', text: (err.message || String(err)).slice(0, 300) });
      };
      const onRequestFailed = (req) => {
        networkAnomalies.push({
          type: 'request_failed',
          url: req.url().slice(0, 200),
          method: req.method(),
          failure: req.failure() ? req.failure().errorText : 'Unknown failure'
        });
      };
      const onResponse = async (res) => {
        try {
          const status = res.status();
          if (status >= 400) {
            networkAnomalies.push({
              type: 'http_error',
              url: res.url().slice(0, 200),
              method: res.request().method(),
              status
            });
          }
        } catch {}
      };

      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('requestfailed', onRequestFailed);
      page.on('response', onResponse);

      try {
        await page.setViewportSize({ width: 1280, height: 720 });
        const navStart = Date.now();
        await page.goto(sweepUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(400);
        loadTimingMs = Date.now() - navStart;

        // Single light scroll
        await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
        await page.waitForTimeout(200);

        domAudit = await page.evaluate(() => {
          const docEl = document.documentElement;
          const bodyEl = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, bodyEl ? bodyEl.scrollWidth : 0);
          const clientWidth = docEl.clientWidth || window.innerWidth;
          const hasHorizontalOverflow = scrollWidth > (clientWidth + 5);

          const h1 = document.querySelector('h1');
          const title = document.title || '';

          return {
            title,
            h1Text: h1 ? (h1.innerText || h1.textContent || '').trim().slice(0, 100) : '',
            scrollWidth,
            clientWidth,
            hasHorizontalOverflow
          };
        }).catch(() => null);

        // Only capture a screenshot if a critical error or overflow occurred on this sweep page
        const hasCriticalError = pageErrors.length > 0 || networkAnomalies.some(a => a.status >= 500) || (domAudit && domAudit.hasHorizontalOverflow);
        if (hasCriticalError) {
          const sweepPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
          sweepScreenshotBase64 = await compressScreenshotWebp(sweepPng);
        }

      } catch (sweepErr) {
        pageErrors.push({ type: 'page_nav_error', text: sweepErr.message });
      } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
      }

      pagesEvidence.push({
        url: sweepUrl,
        tier: 2,
        loadTimingMs,
        errors: pageErrors.slice(0, 10),
        networkAnomalies: networkAnomalies.slice(0, 10),
        domAudit,
        screenshots: {
          desktopWebpBase64: sweepScreenshotBase64,
          mobileWebpBase64: null
        }
      });

      // Flush micro-batches every 6 Tier 2 sweep pages or at the end
      if (pagesEvidence.length >= 6 || j === tier2Targets.length - 1) {
        console.log(`[testerWorker] Flushing Tier 2 micro-batch (${pagesEvidence.length} pages)...`);
        await postWebhook(callbackUrl, {
          event: 'phase3_batch',
          testId,
          userId,
          progressDone: overallProgressDone,
          progressTotal: totalExplorationCount,
          pagesEvidence: [...pagesEvidence]
        });
        pagesEvidence.length = 0;
      }
    }

    // Phase 3 completion signal with full count
    await postWebhook(callbackUrl, {
      event: 'phase3_complete',
      testId,
      userId,
      totalExplored: totalExplorationCount,
      tookMs: Date.now() - startTime
    });
    console.log(`[testerWorker] Full two-tier pipeline completed successfully for test ${testId} (${totalExplorationCount} total pages audited)`);

  } catch (err) {
    console.error(`[testerWorker] Fatal error during test ${testId}:`, err);
    await postWebhook(callbackUrl, {
      event: 'worker_error',
      testId,
      userId,
      error: err.message || 'Worker execution failed'
    }).catch((e) => console.error('[testerWorker] Failed to post error webhook:', e.message));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.log(`[testerWorker] Browser closed for test ${testId}`);
    }
    activeJobId = null;
    if (global.gc) {
      try { global.gc(); } catch {}
    }
  }
}

// POST /worker/run — initiates an asynchronous test run
app.post('/worker/run', requireWorkerSecret, (req, res) => {
  const { testId, userId, url, callbackUrl, authConfig } = req.body || {};

  if (!testId || !userId || !url || !callbackUrl) {
    return res.status(400).json({ error: 'Missing required parameters: testId, userId, url, callbackUrl' });
  }

  if (activeJobId) {
    return res.status(429).json({
      error: 'Worker is currently busy executing another test run',
      busy: true,
      activeJobId
    });
  }

  activeJobId = testId;

  // Immediately respond 202 Accepted (<100ms)
  res.status(202).json({
    accepted: true,
    testId,
    message: 'Playwright test run accepted and dispatched in background.'
  });

  // Execute pipeline in background
  executePlaywrightPipeline({ testId, userId, url, callbackUrl, authConfig });
});

app.listen(PORT, () => {
  console.log(`[testerWorker] Stateless Playwright Browser Worker running on port ${PORT}`);
});
