const { chromium } = require('playwright');
const sharp = require('sharp');
const http = require('http');
const https = require('https');
const { URL } = require('url');

let AxeBuilder = null;
try {
  AxeBuilder = require('@axe-core/playwright').default || require('@axe-core/playwright');
} catch (e) {
  try {
    AxeBuilder = require('@axe-core/playwright');
  } catch (_) {
    console.warn('[testerCore] @axe-core/playwright not loaded:', e.message);
  }
}

const WORKER_SECRET = process.env.TESTER_WORKER_SECRET || '';

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
      console.warn(`[testerCore] Webhook failed (${err.message}), retrying once...`);
      await new Promise((r) => setTimeout(r, 1000));
      return await postOnce();
    }
    throw err;
  }
}

// Canonical hostname normalizer (strips ^www. and lowercases)
function cleanHostname(host) {
  return (host || '').toLowerCase().trim().replace(/^www\./i, '');
}

// Helper: Check if candidate URL belongs to same site as base URL (handling www. and canonical redirects)
function isSameSite(candidateUrl, baseHost) {
  try {
    const candidateHost = new URL(candidateUrl).hostname;
    return cleanHostname(candidateHost) === cleanHostname(baseHost);
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

// Chromium startup flags
const CHROMIUM_ARGS = [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking'
];

// Destructive and logout action guardrail blacklist regex
const DESTRUCTIVE_ACTION_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;

const BINARY_EXTENSIONS_REGEX = /\.(pdf|zip|tar|gz|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|mp4|mov|avi|mkv|mp3|wav|docx?|xlsx?|pptx?|exe|dmg|apk)$/i;

function normalizeUrlString(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    // ONLY lowercase protocol and hostname. Preserve exact pathname and query casing!
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${protocol}//${hostname}${port}${pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
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
 * Helper to fetch JSON from URL with timeout
 */
function fetchJson(url, options = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(parsed, {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: timeoutMs
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(body), raw: body });
          } catch (_) {
            resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: null, raw: body });
          }
        });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${timeoutMs}ms`)); });
      req.on('error', reject);
      if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Mail.tm Live Disposable Inbox Provider for Auto-Signup OTP / Verification Link
 */
class MailTmInbox {
  constructor() {
    this.token = null;
    this.email = null;
    this.password = null;
    this.active = false;
  }

  async createInbox() {
    try {
      const domRes = await fetchJson('https://api.mail.tm/domains', {}, 4000);
      const domain = domRes.data?.['hydra:member']?.[0]?.domain || domRes.data?.[0]?.domain;
      if (!domain) return false;

      const randomUser = `bob.qa.${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      this.email = `${randomUser}@${domain}`;
      this.password = `BobQaPass#${Date.now()}!`;

      const regRes = await fetchJson('https://api.mail.tm/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { address: this.email, password: this.password }
      }, 4000);

      if (!regRes.ok) return false;

      const tokenRes = await fetchJson('https://api.mail.tm/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { address: this.email, password: this.password }
      }, 4000);

      if (!tokenRes.ok || !tokenRes.data?.token) return false;

      this.token = tokenRes.data.token;
      this.active = true;
      console.log(`[testerCore] Created real disposable mail.tm inbox: ${this.email}`);
      return true;
    } catch (err) {
      console.warn('[testerCore] mail.tm inbox creation error:', err.message);
      return false;
    }
  }

  async pollForOtpOrLink(maxWaitMs = 20000) {
    if (!this.active || !this.token) return null;
    const start = Date.now();
    console.log(`[testerCore] Polling mail.tm inbox for verification code/link (up to ${maxWaitMs / 1000}s)...`);

    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const msgListRes = await fetchJson('https://api.mail.tm/messages', {
          headers: { Authorization: `Bearer ${this.token}` }
        }, 3500);

        const messages = msgListRes.data?.['hydra:member'] || [];
        if (messages.length > 0) {
          const firstMsgId = messages[0].id;
          const msgDetail = await fetchJson(`https://api.mail.tm/messages/${firstMsgId}`, {
            headers: { Authorization: `Bearer ${this.token}` }
          }, 3500);

          const text = msgDetail.data?.text || msgDetail.data?.intro || '';
          const html = msgDetail.data?.html?.[0] || '';
          const combined = `${text} ${html}`;

          // Extract 4-8 digit OTP
          const otpMatch = combined.match(/\b([0-9]{4,8})\b/);
          // Extract verify link
          const linkMatch = combined.match(/https?:\/\/[^\s"'<>]+(verify|confirm|activate|token=[^\s"'<>]+)[^\s"'<>]*/i);

          return {
            otp: otpMatch ? otpMatch[1] : null,
            verifyUrl: linkMatch ? linkMatch[0] : null,
            subject: msgDetail.data?.subject || ''
          };
        }
      } catch (pollErr) {
        // Continue polling
      }
    }
    return null;
  }
}

/**
 * Phase 0: Pre-Crawl Authentication Engine
 * Supports: 'session', 'credentials', 'auto_signup' (with mail.tm OTP auto-signup)
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

  console.log(`[testerCore] Executing Phase 0 Auth Handshake in mode: "${authConfig.mode}"...`);

  try {
    // ─────────────────────────────────────────────────────────────
    // MODE 1: SESSION INJECTION (Cookies / localStorage / Bearer)
    // ─────────────────────────────────────────────────────────────
    if (authConfig.mode === 'session') {
      const normalizedCookies = normalizeCookies(authConfig.cookiesInput, startUrl);
      if (normalizedCookies.length > 0) {
        try {
          await context.addCookies(normalizedCookies);
          console.log(`[testerCore] Injected ${normalizedCookies.length} session cookies.`);
        } catch (cErr) {
          console.warn('[testerCore] Cookie injection warning:', cErr.message);
        }
      }

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
          console.log(`[testerCore] Registered localStorage init script with ${Object.keys(storageEntries).length} entries.`);
        }
      }

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
        console.log('[testerCore] Attached Bearer token route interceptor.');
      }

      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      result.postLoginUrl = currentUrl;

      const authIndicators = await page.evaluate(() => {
        const hasAuthText = Boolean(document.body.innerText.match(/dashboard|projects|settings|profile|sign\s*out|log\s*out/i));
        const hasSidebarOrAvatar = Boolean(document.querySelector('aside, nav[class*="sidebar" i], [class*="dashboard" i], img[class*="avatar" i], [aria-label*="profile" i]'));
        return { hasAuthText, hasSidebarOrAvatar };
      }).catch(() => ({ hasAuthText: false, hasSidebarOrAvatar: false }));

      result.authenticated = authIndicators.hasSidebarOrAvatar || authIndicators.hasAuthText;

      const landingPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
      result.authScreenshotBase64 = await compressScreenshotWebp(landingPng);
      console.log(`[testerCore] Session injection complete. Authenticated: ${result.authenticated}`);
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 2: SMART MULTI-STEP CREDENTIAL LOGIN
    // ─────────────────────────────────────────────────────────────
    else if (authConfig.mode === 'credentials') {
      const loginUrl = authConfig.loginUrl || startUrl;
      console.log(`[testerCore] Navigating to login URL: ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

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
          console.log('[testerCore] Clicked login navigation trigger on landing page.');
          await page.waitForTimeout(2500);
        }
      }

      // Step 1: Identifier
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
      console.log('[testerCore] Filled identifier field.');
      await page.waitForTimeout(600);

      // Step 2: Password
      let hasPasswordInput = await page.evaluate(() => {
        const pw = document.querySelector('input[type="password"]');
        return Boolean(pw && (pw.offsetParent !== null || window.getComputedStyle(pw).display !== 'none'));
      }).catch(() => false);

      if (!hasPasswordInput) {
        console.log('[testerCore] Password field not visible; attempting two-step Next/Continue click...');
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
          const nextBtn = buttons.find(b => {
            const txt = (b.innerText || b.value || '').trim();
            return /^(next|continue|submit|proceed)$/i.test(txt);
          });
          if (nextBtn) nextBtn.click();
        }).catch(() => {});

        await page.waitForSelector('input[type="password"]', { timeout: 4000 }).catch(() => {});
      }

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
      console.log('[testerCore] Filled password field.');
      await page.waitForTimeout(600);

      // Step 3: Submit Form
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

      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
        page.waitForTimeout(4500)
      ]);

      // Step 3b: Handle OTP/PIN
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
          console.log('[testerCore] Filled OTP / PIN input.');
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
      console.log(`[testerCore] Credential login completed. Authenticated: ${result.authenticated} - Current URL: ${postUrl}`);
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 3: AUTONOMOUS TEST REGISTRATION (Auto-Signup + Live OTP)
    // ─────────────────────────────────────────────────────────────
    else if (authConfig.mode === 'auto_signup') {
      const signupUrl = authConfig.signupUrl || startUrl;
      console.log(`[testerCore] Navigating to signup URL: ${signupUrl}`);
      await page.goto(signupUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

      let formSubmitted = false;

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

      // Check if registration form fields actually exist
      const formFieldsFound = await page.evaluate(() => {
        const hasEmail = Boolean(document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]'));
        const hasPw = Boolean(document.querySelector('input[type="password"]'));
        return hasEmail || hasPw;
      }).catch(() => false);

      if (!formFieldsFound) {
        console.log('[testerCore] No signup or registration form found on this site; proceeding with public audit.');
        result.authenticated = false;
        result.authError = 'No signup or registration form found on this site; proceeded with public audit.';
        result.postLoginUrl = page.url();
        const landingPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
        result.authScreenshotBase64 = await compressScreenshotWebp(landingPng);
      } else {
        // Try creating real mail.tm inbox
        const mailInbox = new MailTmInbox();
        const mailTmCreated = await mailInbox.createInbox();

        const testEmail = mailTmCreated ? mailInbox.email : `bob.audit.${Date.now()}@testmail.app`;
        const testPassword = mailTmCreated ? mailInbox.password : `BobAudit#${new Date().getFullYear()}!`;
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

          // Accept checkboxes if any
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          checkboxes.forEach(c => { if (!c.checked) c.click(); });
        }, { name: testName, email: testEmail, password: testPassword }).catch(() => {});

        await page.waitForTimeout(500);

        // Submit Registration
        const didSubmit = await page.evaluate(() => {
          const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            submitBtn.click();
            return true;
          }
          const buttons = Array.from(document.querySelectorAll('button'));
          const regBtn = buttons.find(b => /sign\s*up|register|create|get\s*started/i.test(b.innerText || ''));
          if (regBtn) {
            regBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (didSubmit) {
          formSubmitted = true;
        } else {
          // Attempt enter press if submit button not directly clicked
          await page.keyboard.press('Enter');
          formSubmitted = true;
        }

        await Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
          page.waitForTimeout(4500)
        ]);

        // Check if site asks for Email OTP or verification link
        if (mailTmCreated) {
          const asksForOtp = await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText : '';
            const hasOtpPrompt = /enter (the )?(code|otp|verification)|check your email|we sent a code/i.test(bodyText);
            const hasInput = Boolean(document.querySelector('input[name*="code" i], input[name*="otp" i], input[autocomplete="one-time-code"], input[placeholder*="code" i]'));
            return hasOtpPrompt || hasInput;
          }).catch(() => false);

          if (asksForOtp) {
            console.log('[testerCore] Detected OTP / Verification screen on registration. Polling mail.tm...');
            const emailMessage = await mailInbox.pollForOtpOrLink(20000);
            if (emailMessage?.otp) {
              console.log(`[testerCore] Found email OTP: ${emailMessage.otp}. Filling into form...`);
              await page.evaluate((otpVal) => {
                const input = document.querySelector('input[name*="code" i], input[name*="otp" i], input[autocomplete="one-time-code"], input[placeholder*="code" i], input[type="text"]');
                if (input) {
                  input.focus();
                  input.value = otpVal;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }, emailMessage.otp).catch(() => {});

              await page.keyboard.press('Enter');
              await page.waitForTimeout(3000);
            } else if (emailMessage?.verifyUrl) {
              console.log(`[testerCore] Found email verification URL: ${emailMessage.verifyUrl}. Navigating...`);
              await page.goto(emailMessage.verifyUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(3000);
            }
          }
        }

        const postUrl = page.url();
        result.postLoginUrl = postUrl;

        if (!formSubmitted) {
          result.authenticated = false;
          result.authError = 'No signup or registration form found on this site; proceeded with public audit.';
        } else {
          // Require BOTH:
          // 1. postUrl is not a /signup, /register, or /login page, AND
          // 2. At least one positive post-login signal exists
          const isNotOnAuthPage = !/\/(signup|register|login|signin)/i.test(postUrl);
          const postSignals = await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText : '';
            const hasAuthText = Boolean(bodyText.match(/logout|sign\s*out|dashboard|my\s*account/i));
            const hasSidebarOrAvatar = Boolean(document.querySelector('aside, nav[class*="sidebar" i], [class*="dashboard" i], img[class*="avatar" i], [aria-label*="profile" i]'));
            let hasAuthStorage = false;
            try {
              const keys = Object.keys(window.localStorage || {});
              hasAuthStorage = keys.some(k => /token|auth|session|jwt|user/i.test(k));
            } catch (_) {}
            return { hasAuthText, hasSidebarOrAvatar, hasAuthStorage };
          }).catch(() => ({ hasAuthText: false, hasSidebarOrAvatar: false, hasAuthStorage: false }));

          const cookies = await context.cookies().catch(() => []);
          const hasAuthCookie = cookies.some(c => /sess|auth|token|jwt|id/i.test(c.name));

          const positiveSignal = postSignals.hasAuthText || postSignals.hasSidebarOrAvatar || postSignals.hasAuthStorage || hasAuthCookie;
          result.authenticated = isNotOnAuthPage && positiveSignal;

          if (!result.authenticated) {
            result.authError = 'Registration did not yield an authenticated session; proceeded with public audit.';
          }
        }

        const landingPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
        result.authScreenshotBase64 = await compressScreenshotWebp(landingPng);
        console.log(`[testerCore] Auto-signup complete. Authenticated: ${result.authenticated} - URL: ${postUrl}`);
      }
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
      console.log(`[testerCore] Captured session recovery snapshot (${result.savedCookies.length} cookies, ${Object.keys(result.savedLocalStorage).length} localStorage keys).`);
    }

  } catch (err) {
    console.warn('[testerCore] Phase 0 Authentication failed, falling back to public crawl:', err.message);
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

    for (let i = 0; i < candidates.length && views.length < 12; i++) {
      const el = candidates[i];
      const text = (el.innerText || el.textContent || '').trim().slice(0, 60);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const checkString = `${text} ${ariaLabel} ${title} ${el.className || ''}`;

      if (!text && !ariaLabel) continue;
      if (DESTRUCTIVE_REGEX.test(checkString)) continue;

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

/**
 * Main Playwright execution pipeline
 */
async function executePlaywrightPipeline({ testId, userId, url, callbackUrl, authConfig, onJobComplete }) {
  let browser = null;
  const startTime = Date.now();

  try {
    console.log(`[testerCore] Starting pipeline for test ${testId} - URL: ${url} (Auth: ${authConfig?.mode || 'guest'})`);
    browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 BobWebsiteTester/2.0',
    });

    const page = await context.newPage();
    const initialOrigin = new URL(url).origin;
    const initialHost = new URL(url).hostname;

    // ─────────────────────────────────────────────────────────────
    // PHASE 0: AUTHENTICATION HANDSHAKE & SESSION PERSISTENCE
    // ─────────────────────────────────────────────────────────────
    const authResult = await performAuthentication(context, page, url, authConfig);
    const postLoginUrl = authResult.authenticated && authResult.postLoginUrl ? authResult.postLoginUrl : url;

    // Canonical Origin Resolution
    let canonicalOrigin = initialOrigin;
    let canonicalHost = initialHost;
    try {
      const currentLoc = page.url();
      if (currentLoc && currentLoc.startsWith('http')) {
        canonicalOrigin = new URL(currentLoc).origin;
        canonicalHost = new URL(currentLoc).hostname;
      }
    } catch {}

    const ensureSessionActive = async (targetDestUrl) => {
      if (!authResult.authenticated) return;
      const current = page.url();
      if (/\/(login|signin)/i.test(current)) {
        console.warn(`[testerCore] Detected unexpected session drop to login (${current}). Restoring session snapshot...`);
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
          console.warn('[testerCore] Session recovery notice:', resErr.message);
        }
      }
    };

    // ─────────────────────────────────────────────────────────────
    // PHASE 1: 4-LAYER DISCOVERY CRAWL (DOM + Sitemap/Robots + JS Bundle + SPA Tabs)
    // ─────────────────────────────────────────────────────────────
    const discoveryStartTime = Date.now();
    const visitedUrls = new Set();
    const discoveredLinks = [];
    const linkQueue = [postLoginUrl];
    if (url !== postLoginUrl) linkQueue.push(url);

    const MAX_DISCOVERED_PAGES = 150;
    const DISCOVERY_TIMEOUT_MS = 35000;

    let pageTitle = '';
    let homepageVisibleText = '';
    let headings = [];
    let ctas = [];
    let formsOverview = [];

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

    // Quantitative/Factual Claims
    const homepageClaims = await page.evaluate(() => {
      const claims = [];
      const text = document.body ? document.body.innerText : '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 200);

      const statPattern = /(\b\d+(\.\d+)?\s*(%|lpa|ctc|offers|placements|rank|ranking|students|alumni|crore|cr|lakh|lakhs|star|stars|accredited|grade)\b|highest\s*package|average\s*package|naac\s*[a-z\+]+|nirf\b|aicte|aktu)/i;
      for (const line of lines) {
        if (statPattern.test(line) && !claims.includes(line)) {
          claims.push(line);
          if (claims.length >= 30) break;
        }
      }
      return claims;
    }).catch(() => []);

    // LAYER A: DOM Link Extraction
    const extractDomLinks = async (sourcePageUrl = page.url()) => {
      return await page.evaluate(({ baseHost, sourcePageUrl }) => {
        const DESTRUCTIVE_REGEX = /\b(log\s*out|sign\s*out|signout|logout|delete\s*(account|profile|workspace|project|organization|team|data|all)|remove\s*account|close\s*account|deactivate|cancel\s*subscription|unsubscribe|revoke\s*token|reset\s*password|change\s*password|pay\s*now|complete\s*purchase|place\s*order|confirm\s*payment|transfer\s*funds|wipe|destroy)\b/i;
        const BINARY_REGEX = /\.(pdf|zip|tar|gz|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|mp4|mov|avi|mkv|mp3|wav|docx?|xlsx?|pptx?|exe|dmg|apk)$/i;

        const cleanBase = (baseHost || '').toLowerCase().replace(/^www\./i, '');
        const isInternalHost = (h) => (h || '').toLowerCase().replace(/^www\./i, '') === cleanBase;

        const links = [];
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

            if (DESTRUCTIVE_REGEX.test(checkStr) || /\/(log\s*out|sign\s*out|signout|logout|delete-account)/i.test(trimmedHref)) {
              return;
            }

            const parsed = new URL(trimmedHref, window.location.href);
            if (!isInternalHost(parsed.hostname)) return;
            if (BINARY_REGEX.test(parsed.pathname)) return;

            // Preserve pathname and search case! Only lowercase protocol & hostname
            const protocol = parsed.protocol.toLowerCase();
            const hostname = parsed.hostname.toLowerCase();
            const port = parsed.port ? `:${parsed.port}` : '';
            let pathname = parsed.pathname;
            if (pathname.length > 1 && pathname.endsWith('/')) {
              pathname = pathname.slice(0, -1);
            }
            const cleanUrl = `${protocol}//${hostname}${port}${pathname}${parsed.search}`;

            const isVisible = (a.offsetParent !== null) && (window.getComputedStyle(a).display !== 'none');
            links.push({
              url: cleanUrl,
              linkText: text,
              isVisible,
              sourceType: 'dom_link',
              foundOnPage: sourcePageUrl
            });
          } catch {}
        });
        return links;
      }, { baseHost: canonicalHost, sourcePageUrl }).catch(() => []);
    };

    const initialDomLinks = await extractDomLinks(postLoginUrl);
    for (const l of initialDomLinks) {
      if (!visitedUrls.has(l.url) && discoveredLinks.length < MAX_DISCOVERED_PAGES) {
        visitedUrls.add(l.url);
        discoveredLinks.push(l);
        if (linkQueue.length < 50) linkQueue.push(l.url);
      }
    }

    // LAYER B: Sitemap.xml & Robots.txt Harvesting
    try {
      const sitemapUrls = [`${canonicalOrigin}/sitemap.xml`, `${canonicalOrigin}/robots.txt`];
      for (const mapUrl of sitemapUrls) {
        const harvestedUrls = await page.evaluate(async (targetMap) => {
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 4000);
            const res = await fetch(targetMap, { signal: ctrl.signal });
            clearTimeout(tid);
            if (!res.ok) return [];
            const text = await res.text();
            const locMatches = text.match(/<loc>(.*?)<\/loc>/gi) || [];
            const locList = locMatches.map(m => m.replace(/<\/?loc>/gi, '').trim());

            // Extract Disallow/Allow paths from robots.txt too
            if (targetMap.includes('robots.txt')) {
              const lines = text.split('\n');
              for (const line of lines) {
                const match = line.match(/^(?:Allow|Disallow):\s*(\/[a-zA-Z0-9_\-\/]+)/i);
                if (match && match[1] && !match[1].includes('*')) {
                  locList.push(`${window.location.origin}${match[1]}`);
                }
              }
            }
            return locList;
          } catch {
            return [];
          }
        }, mapUrl).catch(() => []);

        for (const rawLoc of harvestedUrls) {
          if (isSameSite(rawLoc, canonicalHost) && !BINARY_EXTENSIONS_REGEX.test(rawLoc)) {
            const clean = normalizeUrlString(rawLoc);
            if (!visitedUrls.has(clean) && discoveredLinks.length < MAX_DISCOVERED_PAGES) {
              visitedUrls.add(clean);
              discoveredLinks.push({
                url: clean,
                linkText: 'Sitemap / Robots Route',
                isVisible: true,
                sourceType: 'sitemap',
                foundOnPage: mapUrl
              });
              if (linkQueue.length < 60) linkQueue.push(clean);
            }
          }
        }
      }
    } catch (eB) {
      console.warn('[testerCore] Layer B sitemap/robots notice:', eB.message);
    }

    // LAYER C: JS Bundle Client-Side Router Route Extraction (Real SPAs Only!)
    try {
      const isSpaFramework = await page.evaluate(() => Boolean(
        window.__NEXT_DATA__ ||
        document.querySelector('#__next, #root[data-reactroot], #app[data-v-app], [ng-version]') ||
        document.querySelector('script[src*="/_next/static/"], script[src*="/assets/index-"]')
      )).catch(() => false);

      if (isSpaFramework) {
        console.log('[testerCore] Detected SPA framework on site. Proceeding with Layer C JS bundle route harvesting...');
        const extractedJsRoutes = await page.evaluate(async ({ baseHost }) => {
          const cleanBase = (baseHost || '').toLowerCase().replace(/^www\./i, '');
          const isInternalHost = (h) => (h || '').toLowerCase().replace(/^www\./i, '') === cleanBase;
          const routes = [];

          // Find loaded same-origin script bundles
          const scriptTags = Array.from(document.querySelectorAll('script[src]'))
            .map(s => s.src)
            .filter(src => {
              try {
                const u = new URL(src);
                return isInternalHost(u.hostname) && (src.includes('chunk') || src.includes('main') || src.includes('app') || src.includes('index') || src.includes('_next'));
              } catch {
                return false;
              }
            })
            .slice(0, 8);

          for (const src of scriptTags) {
            try {
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 3000);
              const res = await fetch(src, { signal: ctrl.signal });
              clearTimeout(tid);
              if (!res.ok) continue;
              const jsText = await res.text();

              // Look for router patterns like path:"/dashboard/..." or "/settings" or "/analytics"
              const routeRegex = /["'](\/(?:dashboard|analytics|settings|projects|billing|profile|teams|portal|auth|account|explore|admin|login|register)[a-zA-Z0-9_\-\/]*)["']/g;
              let m;
              while ((m = routeRegex.exec(jsText)) !== null) {
                const path = m[1];
                if (path && path.length > 2 && !path.includes('//') && !path.endsWith('.js') && !path.endsWith('.css')) {
                  routes.push({ url: `${window.location.origin}${path}`, scriptSrc: src });
                  if (routes.length >= 30) break;
                }
              }
            } catch {}
          }
          return routes;
        }, { baseHost: canonicalHost }).catch(() => []);

        for (const item of extractedJsRoutes) {
          const jsRoute = item.url;
          const clean = normalizeUrlString(jsRoute);
          if (!visitedUrls.has(clean) && discoveredLinks.length < MAX_DISCOVERED_PAGES) {
            visitedUrls.add(clean);
            discoveredLinks.push({
              url: clean,
              linkText: 'JS Router Extracted Route',
              isVisible: false,
              sourceType: 'js_bundle',
              foundOnPage: item.scriptSrc || postLoginUrl
            });
            if (linkQueue.length < 80) linkQueue.push(clean);
          }
        }
      } else {
        console.log('[testerCore] Site is not a client-side SPA (no Next.js/React/Vue/Angular detected). Skipping Layer C JS bundle route extraction to prevent false-positive route guessing.');
      }
    } catch (eC) {
      console.warn('[testerCore] Layer C JS route extraction notice:', eC.message);
    }

    // LAYER D: SPA Sidebar & Tab Discovery on authenticated dashboard
    let discoveredSpaTabs = [];
    if (authResult.authenticated || /dashboard|portal|app/i.test(postLoginUrl)) {
      discoveredSpaTabs = await discoverSpaInteractiveViews(page);
      console.log(`[testerCore] Layer D discovered ${discoveredSpaTabs.length} interactive SPA dashboard tabs/views.`);
    }

    // BFS crawl remaining links until timeout or cap
    while (linkQueue.length > 0 && (Date.now() - discoveryStartTime) < DISCOVERY_TIMEOUT_MS && discoveredLinks.length < MAX_DISCOVERED_PAGES) {
      const nextUrl = linkQueue.shift();
      try {
        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 6000 });
        const moreLinks = await extractDomLinks(nextUrl);
        for (const l of moreLinks) {
          if (!visitedUrls.has(l.url) && discoveredLinks.length < MAX_DISCOVERED_PAGES) {
            visitedUrls.add(l.url);
            discoveredLinks.push(l);
            if (linkQueue.length < 100) linkQueue.push(l.url);
          }
        }
      } catch {}
    }

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
        truncated: discoveredLinks.length >= MAX_DISCOVERED_PAGES,
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
        linksSample: discoveredLinks.slice(0, 120),
        spaTabs: discoveredSpaTabs
      }
    };

    console.log(`[testerCore] Phase 1 complete. Discovered ${discoveredLinks.length + 1} pages & ${discoveredSpaTabs.length} SPA tabs. Sending to callback webhook...`);
    const phase2Response = await postWebhook(callbackUrl, discoveryPayload);
    console.log(`[testerCore] Phase 2 plan received:`, phase2Response);

    // ─────────────────────────────────────────────────────────────
    // TWO-TIER FULL-SITE EXPLORATION PIPELINE (Phase 3: Up to 70 Pages)
    // ─────────────────────────────────────────────────────────────
    let tier1Urls = [];
    const publicPriorityUrls = [url];
    const dashboardPriorityUrls = [];

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

    if (phase2Response && Array.isArray(phase2Response.targetPages) && phase2Response.targetPages.length > 0) {
      const targets = phase2Response.targetPages.filter(p => typeof p === 'string' && p.startsWith('http'));
      tier1Urls = targets.slice(0, 20);
    }

    publicPriorityUrls.slice(0, 6).forEach(u => {
      if (!tier1Urls.includes(u) && tier1Urls.length < 20) tier1Urls.push(u);
    });
    dashboardPriorityUrls.slice(0, 8).forEach(u => {
      if (!tier1Urls.includes(u) && tier1Urls.length < 20) tier1Urls.push(u);
    });

    discoveredLinks.forEach(l => {
      const linkUrl = typeof l === 'string' ? l : l.url;
      if (linkUrl && !tier1Urls.includes(linkUrl) && tier1Urls.length < 20) tier1Urls.push(linkUrl);
    });

    const tier1Targets = tier1Urls.map(u => ({ url: u, isSpaTab: false }));
    if (discoveredSpaTabs.length > 0) {
      discoveredSpaTabs.slice(0, 8).forEach(tab => {
        tier1Targets.push({
          url: postLoginUrl,
          isSpaTab: true,
          spaTabSelector: tab.spaTabSelector,
          spaTabLabel: tab.spaTabLabel,
          title: tab.title
        });
      });
    }

    // Tier 2 Targets: Remaining discovered internal pages not in Tier 1 (up to 50 pages)
    const tier1UrlSet = new Set(tier1Urls);
    let tier2Targets = [];
    if (phase2Response && Array.isArray(phase2Response.sweepUrls) && phase2Response.sweepUrls.length > 0) {
      tier2Targets = phase2Response.sweepUrls.filter(u => typeof u === 'string' && !tier1UrlSet.has(u)).slice(0, 50);
    }
    if (tier2Targets.length === 0) {
      for (const linkItem of discoveredLinks) {
        const linkUrl = typeof linkItem === 'string' ? linkItem : linkItem.url;
        if (linkUrl && !tier1UrlSet.has(linkUrl) && !tier2Targets.includes(linkUrl)) {
          tier2Targets.push(linkUrl);
          if (tier2Targets.length >= 50) break;
        }
      }
    }

    // Fast lookup map for discovered links metadata (sourceType & foundOnPage)
    const discoveredLinksMeta = new Map();
    discoveredLinks.forEach(l => {
      if (l && l.url) {
        discoveredLinksMeta.set(l.url, {
          sourceType: l.sourceType || 'dom_link',
          foundOnPage: l.foundOnPage || url
        });
      }
    });

    const totalExplorationCount = tier1Targets.length + tier2Targets.length;
    console.log(`[testerCore] Starting Two-Tier Exploration: Tier 1 Deep Audit = ${tier1Targets.length} targets, Tier 2 Sweep = ${tier2Targets.length} targets (Total: ${totalExplorationCount} targets)`);

    const pagesEvidence = [];
    let overallProgressDone = 0;

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
    // TIER 1: DEEP VISUAL + INTERACTIVE + AXE-CORE AUDIT
    // ─────────────────────────────────────────────────────────
    for (let i = 0; i < tier1Targets.length; i++) {
      const targetItem = tier1Targets[i];
      const targetUrl = targetItem.url;
      const isSpaTab = targetItem.isSpaTab;
      const targetDisplay = isSpaTab ? `${targetUrl} [Tab: ${targetItem.spaTabLabel}]` : targetUrl;
      overallProgressDone++;
      console.log(`[testerCore] [Tier 1 Deep Audit] ${i + 1}/${tier1Targets.length} (${overallProgressDone}/${totalExplorationCount}): ${targetDisplay}`);

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
          const isInternal = isSameSite(resUrl, canonicalHost);

          // Forensics: HTTP >= 400 or latency inspection
          if (status >= 400) {
            httpErrorStatuses.set(resUrl, status);
            const meta = discoveredLinksMeta.get(resUrl);
            const sourceType = meta?.sourceType || (isSameSite(resUrl, canonicalHost) ? 'dom_link' : 'external');
            const foundOnPage = meta?.foundOnPage || targetUrl;

            // Never report a JS-guessed 404 (Layer C) as a confirmed broken route
            if (status === 404 && sourceType === 'js_bundle') {
              console.log(`[testerCore] Ignoring 404 on unverified JS-guessed route: ${resUrl}`);
            } else {
              networkAnomalies.push({
                type: 'http_error',
                url: resUrl.slice(0, 200),
                method: req.method(),
                status,
                sourceType,
                foundOnPage
              });
            }
          }

          // Black-box API Forensics: Inspect JSON responses of same-origin XHR/fetch
          const resourceType = req.resourceType();
          if (isInternal && (resourceType === 'fetch' || resourceType === 'xhr')) {
            const contentType = res.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              try {
                const jsonBody = await res.json().catch(() => null);
                if (jsonBody) {
                  // Detect silent backend failure (HTTP 200 with error / ok: false)
                  const isSilentFail = jsonBody.error || jsonBody.ok === false || jsonBody.success === false;
                  if (isSilentFail) {
                    networkAnomalies.push({
                      type: 'silent_api_failure',
                      url: resUrl.slice(0, 200),
                      method: req.method(),
                      status,
                      preview: JSON.stringify(jsonBody).slice(0, 300)
                    });
                  }
                  // Detect leaked stack trace
                  const rawString = JSON.stringify(jsonBody);
                  if (rawString.includes('at Object.') || rawString.includes('SQLSTATE') || rawString.includes('SyntaxError') || rawString.includes('node_modules')) {
                    networkAnomalies.push({
                      type: 'leaked_stack_trace',
                      url: resUrl.slice(0, 200),
                      method: req.method(),
                      preview: rawString.slice(0, 400)
                    });
                  }
                }
              } catch (_) {}
            }
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
      let axeSummary = null;

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

        // Auto-Scroll Hydration Pass
        await runAutoScrollHydration();

        // WCAG Accessibility Audit via @axe-core/playwright
        if (AxeBuilder) {
          try {
            const axeResults = await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa'])
              .analyze();

            const topViolations = (axeResults.violations || []).slice(0, 10).map(v => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              helpUrl: v.helpUrl,
              nodesCount: v.nodes.length,
              selectors: v.nodes.slice(0, 3).map(n => n.target.join(' > '))
            }));

            axeSummary = {
              violationsCount: axeResults.violations.length,
              passesCount: axeResults.passes.length,
              topViolations
            };
          } catch (axeErr) {
            console.warn('[testerCore] Axe audit notice:', axeErr.message);
          }
        }

        // Accurate DOM Audit & Placeholder string detection
        const failedUrlList = Array.from(networkFailedUrls);
        const httpErrorList = Array.from(httpErrorStatuses.entries()).map(([u, s]) => ({ url: u, status: s }));

        domAudit = await page.evaluate(({ failedUrls, httpErrors }) => {
          const docEl = document.documentElement;
          const bodyEl = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, bodyEl ? bodyEl.scrollWidth : 0);
          const clientWidth = docEl.clientWidth || window.innerWidth;
          const hasHorizontalOverflow = scrollWidth > (clientWidth + 5);

          // 1. Accurate Broken Images
          const brokenImages = [];
          const allImages = Array.from(document.querySelectorAll('img'));
          allImages.forEach((img) => {
            const rawSrc = (img.src || img.getAttribute('src') || '').trim();
            if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.length < 5) return;

            const isNetworkFailed = failedUrls.some(u => u === rawSrc || rawSrc.includes(u));
            const isHttpError = httpErrors.some(e => e.url === rawSrc || rawSrc.includes(e.url));
            const isNaturalZero = img.complete === true && img.naturalWidth === 0;

            if (isNetworkFailed || isHttpError || isNaturalZero) {
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

          // 2. Suspicious Controls
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

          // 3. Content Hygiene: Placeholder strings & extracted stats
          const bodyText = document.body ? document.body.innerText : '';
          const placeholderIssues = [];
          if (/lorem ipsum/i.test(bodyText)) placeholderIssues.push('Lorem ipsum placeholder text');
          if (/\bundefined\b/.test(bodyText)) placeholderIssues.push('Literal "undefined" rendered on page');
          if (/\bNaN\b/.test(bodyText)) placeholderIssues.push('Literal "NaN" rendered on page');
          if (/\[object Object\]/.test(bodyText)) placeholderIssues.push('Unserialized "[object Object]" rendered on page');
          if (/\{\{[a-zA-Z0-9_.]+\}\}/.test(bodyText)) placeholderIssues.push('Uninterpolated template braces {{...}} rendered on page');

          // Extract stats/claims from this page
          const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 150);
          const statPattern = /(\b\d+(\.\d+)?\s*(%|lpa|ctc|offers|placements|rank|ranking|students|alumni|crore|cr|lakh|lakhs|star|stars|accredited|grade)\b|highest\s*package|average\s*package|naac\s*[a-z\+]+|nirf\b|aicte|aktu)/i;
          const pageStats = [];
          for (const line of lines) {
            if (statPattern.test(line) && !pageStats.includes(line)) {
              pageStats.push(line);
              if (pageStats.length >= 10) break;
            }
          }

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
            placeholderIssues,
            extractedPageStats: pageStats,
            accessibilitySummary: { missingAltCount, unlabelledInputs }
          };
        }, { failedUrls: failedUrlList, httpErrors: httpErrorList }).catch(() => null);

        // Real click verification on up to 5 suspicious dead buttons
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
                await new Promise(r => setTimeout(r, 450));

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

        // Safe Boundary Form Fuzzing on search/public forms
        const formFuzzLog = await page.evaluate(async () => {
          const searchInput = document.querySelector('input[type="search"], input[name*="search" i], input[placeholder*="search" i]');
          if (!searchInput) return null;

          const results = [];
          try {
            searchInput.focus();
            searchInput.value = 'test\'"><';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            const form = searchInput.closest('form');
            if (form) {
              const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
              if (submitBtn) submitBtn.click();
              results.push('Fuzzed search form with test\'"><');
            }
          } catch (e) {
            results.push(`Fuzzing error: ${e.message}`);
          }
          return results;
        }).catch(() => null);

        if (formFuzzLog && domAudit) {
          domAudit.formFuzzing = formFuzzLog;
        }

        if (axeSummary && domAudit) {
          domAudit.axe = axeSummary;
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
        console.log(`[testerCore] Flushing Tier 1 micro-batch (${pagesEvidence.length} pages)...`);
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
    // TIER 2: FAST FULL-SITE SWEEP (Up to 50 Pages)
    // ─────────────────────────────────────────────────────────
    console.log(`[testerCore] Starting Tier 2 Fast Sweep across ${tier2Targets.length} discovered URLs...`);
    for (let j = 0; j < tier2Targets.length; j++) {
      const sweepUrl = tier2Targets[j];
      overallProgressDone++;
      console.log(`[testerCore] [Tier 2 Sweep] ${j + 1}/${tier2Targets.length} (${overallProgressDone}/${totalExplorationCount}): ${sweepUrl}`);

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
          const resUrl = res.url();
          if (status >= 400) {
            const meta = discoveredLinksMeta.get(resUrl);
            const sourceType = meta?.sourceType || (isSameSite(resUrl, canonicalHost) ? 'dom_link' : 'external');
            const foundOnPage = meta?.foundOnPage || sweepUrl;

            // Never report a JS-guessed 404 (Layer C) as a confirmed broken route
            if (status === 404 && sourceType === 'js_bundle') {
              console.log(`[testerCore] Sweep ignoring 404 on unverified JS-guessed route: ${resUrl}`);
            } else {
              networkAnomalies.push({
                type: 'http_error',
                url: resUrl.slice(0, 200),
                method: res.request().method(),
                status,
                sourceType,
                foundOnPage
              });
            }
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

          // Numerical stats for cross-page contradiction checks
          const bodyText = bodyEl ? bodyEl.innerText : '';
          const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 150);
          const statPattern = /(\b\d+(\.\d+)?\s*(%|lpa|ctc|offers|placements|rank|ranking|students|alumni|crore|cr|lakh|lakhs|star|stars|accredited|grade)\b|highest\s*package|average\s*package)/i;
          const pageStats = [];
          for (const line of lines) {
            if (statPattern.test(line) && !pageStats.includes(line)) {
              pageStats.push(line);
              if (pageStats.length >= 6) break;
            }
          }

          return {
            title,
            h1Text: h1 ? (h1.innerText || h1.textContent || '').trim().slice(0, 100) : '',
            scrollWidth,
            clientWidth,
            hasHorizontalOverflow,
            extractedPageStats: pageStats
          };
        }).catch(() => null);

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

      // Flush micro-batches every 8 Tier 2 sweep pages or at the end
      if (pagesEvidence.length >= 8 || j === tier2Targets.length - 1) {
        console.log(`[testerCore] Flushing Tier 2 micro-batch (${pagesEvidence.length} pages)...`);
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

    // Phase 3 completion signal
    await postWebhook(callbackUrl, {
      event: 'phase3_complete',
      testId,
      userId,
      totalExplored: totalExplorationCount,
      tookMs: Date.now() - startTime
    });
    console.log(`[testerCore] Full two-tier pipeline completed successfully for test ${testId} (${totalExplorationCount} total pages audited)`);

  } catch (err) {
    console.error(`[testerCore] Fatal error during test ${testId}:`, err);
    await postWebhook(callbackUrl, {
      event: 'worker_error',
      testId,
      userId,
      error: err.message || 'Worker execution failed'
    }).catch((e) => console.error('[testerCore] Failed to post error webhook:', e.message));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.log(`[testerCore] Browser closed for test ${testId}`);
    }
    if (typeof onJobComplete === 'function') {
      try { onJobComplete(); } catch (_) {}
    }
    if (global.gc) {
      try { global.gc(); } catch {}
    }
  }
}

module.exports = {
  executePlaywrightPipeline,
  postWebhook,
  isSameSite,
  compressScreenshotWebp
};
