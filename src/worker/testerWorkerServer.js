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

// Main Playwright execution pipeline (Phases 1 & 3 on Render)
async function executePlaywrightPipeline({ testId, userId, url, callbackUrl }) {
  let browser = null;
  const startTime = Date.now();

  try {
    console.log(`[testerWorker] Starting execution for test ${testId} - URL: ${url}`);
    browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 BobWebsiteTester/1.0',
    });

    const page = await context.newPage();
    const parsedOrigin = new URL(url).origin;

    // ─────────────────────────────────────────────────────────────
    // PHASE 1: DISCOVERY CRAWL (BFS internal link graph + homepage audit)
    // ─────────────────────────────────────────────────────────────
    const discoveryStartTime = Date.now();
    const visitedUrls = new Set();
    const discoveredLinks = [];
    const linkQueue = [url];
    const SAFETY_CAP = 10000;
    const DISCOVERY_TIMEOUT_MS = 25000;

    let pageTitle = '';
    let homepageVisibleText = '';
    let headings = [];
    let ctas = [];
    let formsOverview = [];

    // Visit Start Page
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500); // Allow brief client hydration

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

    // Fast DOM Link Extraction (Visible + Hidden menus/drawers)
    const extractPageLinks = async () => {
      return await page.evaluate(({ origin }) => {
        const links = [];
        const anchors = document.querySelectorAll('a[href]');
        anchors.forEach((a) => {
          try {
            const rawHref = a.getAttribute('href');
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;
            const fullUrl = new URL(rawHref, window.location.href).href;
            if (fullUrl.startsWith(origin)) {
              const text = (a.innerText || a.textContent || '').trim().slice(0, 100);
              const isVisible = (a.offsetParent !== null) && (window.getComputedStyle(a).display !== 'none');
              links.push({ url: fullUrl.split('#')[0], linkText: text, isVisible });
            }
          } catch {}
        });
        return links;
      }, { origin: parsedOrigin }).catch(() => []);
    };

    const initialLinks = await extractPageLinks();
    for (const l of initialLinks) {
      if (!visitedUrls.has(l.url) && discoveredLinks.length < SAFETY_CAP) {
        visitedUrls.add(l.url);
        discoveredLinks.push(l);
        if (linkQueue.length < 50) linkQueue.push(l.url);
      }
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

    const discoveryPayload = {
      event: 'phase1_complete',
      testId,
      userId,
      site: {
        title: pageTitle,
        startUrl: url,
        origin: parsedOrigin,
        pageCount: discoveredLinks.length + 1,
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
        },
        linksSample: discoveredLinks.slice(0, 50)
      }
    };

    console.log(`[testerWorker] Phase 1 complete. Discovered ${discoveredLinks.length + 1} pages. Sending to Vercel webhook...`);
    const phase2Response = await postWebhook(callbackUrl, discoveryPayload);
    console.log(`[testerWorker] Phase 2 plan received from Vercel:`, phase2Response);

    const targetPages = (phase2Response && Array.isArray(phase2Response.targetPages) && phase2Response.targetPages.length > 0)
      ? phase2Response.targetPages.slice(0, 6)
      : [url, ...discoveredLinks.map(l => l.url).slice(0, 5)];

    // ─────────────────────────────────────────────────────────────
    // PHASE 3: SEQUENTIAL EXPLORATION (Desktop + Mobile + Batched Webhook)
    // ─────────────────────────────────────────────────────────────
    console.log(`[testerWorker] Starting Phase 3 on ${targetPages.length} target pages...`);
    const pagesEvidence = [];
    const totalPages = targetPages.length;

    for (let i = 0; i < targetPages.length; i++) {
      const targetUrl = targetPages[i];
      console.log(`[testerWorker] Auditing page ${i + 1}/${totalPages}: ${targetUrl}`);

      const pageErrors = [];
      const networkAnomalies = [];
      const interactiveLogs = [];

      // Event listeners for browser runtime signals
      const onConsole = (msg) => {
        if (msg.type() === 'error') {
          pageErrors.push({ type: 'console_error', text: msg.text().slice(0, 300), location: msg.location() });
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
          const req = res.request();
          const resUrl = res.url();
          if (status >= 400) {
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
        // 1. Desktop walk (1280x720)
        await page.setViewportSize({ width: 1280, height: 720 });
        const navStart = Date.now();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1000);
        loadTimingMs = Date.now() - navStart;

        // DOM Audit: overflow, broken images, dead buttons, empty sections
        domAudit = await page.evaluate(() => {
          const docEl = document.documentElement;
          const bodyEl = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, bodyEl ? bodyEl.scrollWidth : 0);
          const clientWidth = docEl.clientWidth || window.innerWidth;
          const hasHorizontalOverflow = scrollWidth > (clientWidth + 5);

          const brokenImages = Array.from(document.querySelectorAll('img'))
            .filter((img) => !img.complete || img.naturalWidth === 0)
            .map((img) => ({ src: (img.src || '').slice(0, 150), alt: img.alt || '' }))
            .slice(0, 10);

          const deadButtons = Array.from(document.querySelectorAll('a, button'))
            .filter((el) => {
              const href = el.getAttribute('href');
              return (href === '#' || href === 'javascript:void(0);' || href === 'javascript:;') && !el.onclick;
            })
            .map((el) => (el.innerText || el.textContent || '').trim().slice(0, 60))
            .filter(Boolean)
            .slice(0, 10);

          const missingAltCount = Array.from(document.querySelectorAll('img:not([alt]), img[alt=""]')).length;
          const unlabelledInputs = Array.from(document.querySelectorAll('input:not([aria-label]):not([placeholder])')).length;

          return {
            scrollWidth,
            clientWidth,
            hasHorizontalOverflow,
            brokenImages,
            deadButtons,
            accessibilitySummary: { missingAltCount, unlabelledInputs }
          };
        }).catch(() => null);

        // Safe interactive actions: boundary inputs & tab clicks
        try {
          const interactiveResults = await page.evaluate(() => {
            const actions = [];
            const searchInput = document.querySelector('input[type="search"], input[name*="search" i], input[placeholder*="search" i]');
            if (searchInput) {
              actions.push({ element: 'search_input', found: true, placeholder: searchInput.placeholder || '' });
            }
            const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, button[data-tab], nav a, header a')).slice(0, 5);
            tabs.forEach((t) => {
              actions.push({ element: 'nav_item', text: (t.innerText || t.textContent || '').trim().slice(0, 40) });
            });
            return actions;
          });
          interactiveLogs.push(...interactiveResults);
        } catch {}

        // Desktop screenshot
        const desktopPng = await page.screenshot({ fullPage: false, type: 'png' }).catch(() => null);
        desktopScreenshotBase64 = await compressScreenshotWebp(desktopPng);

        // 2. Mobile walk (390x844)
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(600);

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
        // Clean up listeners for this page
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
      }

      pagesEvidence.push({
        url: targetUrl,
        loadTimingMs,
        errors: pageErrors.slice(0, 15),
        networkAnomalies: networkAnomalies.slice(0, 15),
        interactiveLogs,
        domAudit,
        screenshots: {
          desktopWebpBase64: desktopScreenshotBase64,
          mobileWebpBase64: mobileScreenshotBase64
        }
      });

      // Flush micro-batches of 2 pages to stay well under Vercel's 4.5 MB request limit
      if (pagesEvidence.length >= 2 || i === targetPages.length - 1) {
        console.log(`[testerWorker] Flushing Phase 3 micro-batch (${pagesEvidence.length} pages)...`);
        await postWebhook(callbackUrl, {
          event: 'phase3_batch',
          testId,
          userId,
          progressDone: i + 1,
          progressTotal: totalPages,
          pagesEvidence: [...pagesEvidence]
        });
        pagesEvidence.length = 0; // Clear memory buffer immediately
      }
    }

    // Phase 3 completion signal
    await postWebhook(callbackUrl, {
      event: 'phase3_complete',
      testId,
      userId,
      totalExplored: totalPages,
      tookMs: Date.now() - startTime
    });
    console.log(`[testerWorker] Full pipeline completed successfully for test ${testId}`);

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
  const { testId, userId, url, callbackUrl } = req.body || {};

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
  executePlaywrightPipeline({ testId, userId, url, callbackUrl });
});

app.listen(PORT, () => {
  console.log(`[testerWorker] Stateless Playwright Browser Worker running on port ${PORT}`);
});
