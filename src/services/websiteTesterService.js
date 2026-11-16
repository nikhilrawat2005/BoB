const crypto = require('crypto');
const fetch = require('node-fetch');
const { db } = require('../config/firebase');
const geminiPool = require('./geminiPoolService');
const llmService = require('./llmService');
const documentGenerator = require('./documentGenerator');
const fileService = require('./fileService');

const WORKER_URL = (process.env.RENDER_TESTER_WORKER_URL || '').replace(/\/$/, '');
const WORKER_SECRET = process.env.TESTER_WORKER_SECRET || '';

// In-memory transient map for raw auth credentials during dispatch (Never stored in Firestore)
const pendingAuthConfigs = new Map(); // testId -> { authConfig, expiresAt }

// Periodic sweep for expired transient authConfigs
setInterval(() => {
  const now = Date.now();
  for (const [testId, entry] of pendingAuthConfigs.entries()) {
    if (entry.expiresAt && entry.expiresAt < now) {
      pendingAuthConfigs.delete(testId);
    }
  }
}, 60 * 1000);

/**
 * Normalizes and validates target URL
 */
function normalizeUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) throw new Error('Target website URL is required.');
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return new URL(url).href;
}

/**
 * Helper to upload Base64 WebP screenshot buffer to Cloudinary through fileService
 */
async function uploadScreenshotWebp(userId, base64Str, filename) {
  if (!base64Str) return null;
  const buffer = Buffer.from(base64Str, 'base64');
  const file = {
    buffer,
    originalname: filename,
    mimetype: 'image/webp',
    size: buffer.length
  };
  return await fileService.uploadFile(userId, file);
}

/**
 * Attempts non-blocking wake up and dispatch to Render worker
 */
async function tryWakeAndDispatchWorker(testId, userId, targetUrl, baseUrl) {
  if (!WORKER_URL) {
    console.warn('[websiteTester] RENDER_TESTER_WORKER_URL is not configured.');
    return { ok: false, error: 'RENDER_TESTER_WORKER_URL not configured' };
  }

  const callbackUrl = `${baseUrl.replace(/\/$/, '')}/api/website-tester/webhook`;

  try {
    // 1. Quick health check ping (2.5s AbortController timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const healthRes = await fetch(`${WORKER_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'x-worker-secret': WORKER_SECRET }
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (healthRes && healthRes.ok) {
      const healthData = await healthRes.json().catch(() => ({}));
      if (healthData.busy) {
        console.log(`[websiteTester] Worker is currently busy with job ${healthData.activeJobId}. Test ${testId} remains queued.`);
        return { ok: true, queued: true, busy: true };
      }

      // Retrieve transient authConfig if available
      const pendingEntry = pendingAuthConfigs.get(testId);
      const authConfig = pendingEntry ? pendingEntry.authConfig : null;

      // Worker is awake & idle -> dispatch immediately
      console.log(`[websiteTester] Worker is awake. Dispatching POST /worker/run for test ${testId} (auth mode: ${authConfig?.mode || 'guest'})...`);
      const runRes = await fetch(`${WORKER_URL}/worker/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-secret': WORKER_SECRET
        },
        body: JSON.stringify({
          testId,
          userId,
          url: targetUrl,
          callbackUrl,
          authConfig
        })
      });

      if (runRes.status === 202 || runRes.ok) {
        // Zero-leak: immediately clear raw secrets from memory once accepted by Render
        pendingAuthConfigs.delete(testId);

        if (db) {
          await db.collection('users').doc(userId).collection('website_tests').doc(testId).update({
            status: 'running',
            workerDispatched: true,
            progress: { phase: 1, label: 'Phase 1: Authenticating & discovering site routes in real browser...', done: 1, total: 6 }
          });
        }
        return { ok: true, dispatched: true };
      }
    }
  } catch (err) {
    console.log(`[websiteTester] Wake-up ping triggered cold boot (${err.message})`);
  }

  return { ok: true, dispatched: false, waking: true };
}

/**
 * Starts a new autonomous website test run
 */
async function startWebsiteTest(userId, rawUrl, baseUrl, rawAuthConfig = null) {
  const url = normalizeUrl(rawUrl);
  const testId = `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const mode = (rawAuthConfig && rawAuthConfig.mode) ? rawAuthConfig.mode : 'guest';
  let sanitizedAuthConfig = null;
  if (rawAuthConfig && mode !== 'guest') {
    sanitizedAuthConfig = {
      mode,
      loginUrl: rawAuthConfig.loginUrl || null,
      signupUrl: rawAuthConfig.signupUrl || null,
      identifier: rawAuthConfig.identifier || '',
      password: rawAuthConfig.password || '',
      otpOrPin: rawAuthConfig.otpOrPin || '',
      cookiesInput: rawAuthConfig.cookiesInput || '',
      localStorageInput: rawAuthConfig.localStorageInput || '',
      bearerToken: rawAuthConfig.bearerToken || ''
    };
    // Store raw secrets in transient in-memory map ONLY (expires in 10 minutes)
    pendingAuthConfigs.set(testId, {
      authConfig: sanitizedAuthConfig,
      expiresAt: Date.now() + 10 * 60 * 1000
    });
  }

  // Sanitized authSummary for Firestore (ZERO secrets stored in DB)
  const authSummary = {
    mode,
    loginUrl: rawAuthConfig?.loginUrl || null,
    signupUrl: rawAuthConfig?.signupUrl || null,
    authenticated: false,
    authStatus: mode === 'guest' ? 'guest' : 'pending',
    postLoginUrl: null,
    dashboardViewsFound: 0,
    authError: null,
    screenshotUrl: null
  };

  const initialRecord = {
    testId,
    userId,
    url,
    authSummary,
    status: 'waking_worker',
    workerDispatched: false,
    progress: { phase: 0, label: 'Waking up Render browser worker...', done: 0, total: 6 },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    site: null,
    purpose: null,
    findings: [],
    evidence: { screenshots: [], console: [], network: [], domAudits: [] },
    reportPdf: null,
    summary: null,
    error: null
  };

  if (db) {
    await db.collection('users').doc(userId).collection('website_tests').doc(testId).set(initialRecord);
  }

  // Fire non-blocking wake up and dispatch
  tryWakeAndDispatchWorker(testId, userId, url, baseUrl).catch((e) => {
    console.warn('[websiteTester] Non-blocking dispatch notice:', e.message);
  });

  return initialRecord;
}

/**
 * Gets live status of a website test (with opportunistic dispatch during polling)
 */
async function getWebsiteTestStatus(userId, testId, baseUrl) {
  if (!db) throw new Error('Firestore not initialized');
  const docRef = db.collection('users').doc(userId).collection('website_tests').doc(testId);
  const snap = await docRef.get();
  if (!snap.exists) return null;

  const data = snap.data();

  // If worker is still waking and haven't dispatched yet, check health and dispatch on-the-fly
  if (data.status === 'waking_worker' && !data.workerDispatched && baseUrl) {
    tryWakeAndDispatchWorker(testId, userId, data.url, baseUrl).catch(() => {});
  }

  return data;
}

/**
 * Lists past website tests for user
 */
async function listWebsiteTests(userId, limit = 20) {
  if (!db) return [];
  const snap = await db.collection('users').doc(userId).collection('website_tests')
    .orderBy('startedAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => d.data());
}

/**
 * Deletes a test record from Firestore
 */
async function deleteWebsiteTest(userId, testId) {
  if (!db) return false;
  await db.collection('users').doc(userId).collection('website_tests').doc(testId).delete();
  return true;
}

/**
 * Handles incoming webhooks from Render Playwright worker
 */
async function handleWorkerWebhook(payload) {
  const { event, testId, userId } = payload || {};
  if (!testId || !userId) {
    throw new Error('Missing testId or userId in webhook payload');
  }

  if (!db) throw new Error('Firestore not initialized');
  const docRef = db.collection('users').doc(userId).collection('website_tests').doc(testId);
  const docSnap = await docRef.get();
  const currentData = docSnap.exists ? docSnap.data() : {};

  console.log(`[websiteTesterWebhook] Processing event "${event}" for test ${testId}`);

  // ─────────────────────────────────────────────────────────────
  // EVENT: PHASE 1 COMPLETE → RUN PHASE 2 (PURPOSE INFERENCE)
  // ─────────────────────────────────────────────────────────────
  if (event === 'phase1_complete') {
    const { site, discoveryData, authResult } = payload;

    let authScreenshotUrl = null;
    if (authResult?.authScreenshotBase64) {
      try {
        const uploadRes = await uploadScreenshotWebp(
          userId,
          authResult.authScreenshotBase64,
          `tester_auth_${testId}_${Date.now()}.webp`
        );
        if (uploadRes?.url) {
          authScreenshotUrl = uploadRes.url;
        }
      } catch (authUpErr) {
        console.warn('[websiteTester] Failed to upload auth screenshot:', authUpErr.message);
      }
    }

    const prevAuthSummary = currentData.authSummary || {};
    const updatedAuthSummary = {
      ...prevAuthSummary,
      mode: authResult?.mode || prevAuthSummary.mode || 'guest',
      authenticated: Boolean(authResult?.authenticated),
      authStatus: authResult?.authenticated ? 'authenticated' : (authResult?.authError ? 'failed' : (prevAuthSummary.mode === 'guest' ? 'guest' : 'public_fallback')),
      postLoginUrl: authResult?.postLoginUrl || null,
      dashboardViewsFound: authResult?.dashboardViewsFound || 0,
      authError: authResult?.authError || null,
      screenshotUrl: authScreenshotUrl || prevAuthSummary.screenshotUrl || null
    };

    const initialEvidenceShots = [...(currentData.evidence?.screenshots || [])];
    if (authScreenshotUrl) {
      initialEvidenceShots.unshift({
        pageUrl: authResult?.postLoginUrl || site.startUrl,
        viewport: '1280x720',
        label: 'Post-Login Dashboard Landing (Auth Snapshot)',
        fileId: null,
        url: authScreenshotUrl
      });
    }

    await docRef.update({
      site,
      authSummary: updatedAuthSummary,
      status: 'running',
      'evidence.screenshots': initialEvidenceShots,
      'progress.phase': 2,
      'progress.label': 'Phase 2: Inferring site purpose, journeys & dashboard capabilities...',
      'progress.done': 2
    });

    // Run Phase 2 Purpose Inference via Gemini Pool
    const prompt = `You are a Principal Software QA & Product Architect.
Analyze this website discovery crawl data to infer what the product/service is, what user journeys are essential (both public and authenticated dashboard flows), and what explicit claims it makes.

DISCOVERY DATA:
URL: ${site.startUrl}
Title: ${site.title}
Authentication Result: ${JSON.stringify(authResult || { mode: 'guest' })}
Homepage Headings: ${JSON.stringify(discoveryData.homepage?.headings || [])}
Homepage CTAs: ${JSON.stringify(discoveryData.homepage?.ctas || [])}
Forms: ${JSON.stringify(discoveryData.homepage?.forms || [])}
Interactive SPA Dashboard Views/Tabs: ${JSON.stringify((discoveryData.spaTabs || []).slice(0, 15))}
Text Snippet: ${(discoveryData.homepage?.textSample || '').slice(0, 3000)}
Sample Discovered Internal Links: ${JSON.stringify((discoveryData.linksSample || []).slice(0, 40))}

INSTRUCTIONS FOR TARGET PAGES SELECTION:
- If authenticated (${Boolean(authResult?.authenticated)}), ensure at least 70% of targetPages are post-login dashboard/protected routes (e.g., /dashboard, /analytics, /settings, /projects, /profile, /billing) or discovered SPA tabs.
- Also include key public flows (e.g. homepage, pricing/features) for complete end-to-end verification.
- Inventory both Public Claims and Authenticated Dashboard Capabilities/Modules in claimedFeatures and explicitClaims.

Respond ONLY with a JSON object in this exact format:
{
  "summary": "1-2 sentence core purpose of the website and dashboard",
  "primaryUserJourneys": ["Journey 1...", "Journey 2..."],
  "claimedFeatures": ["Feature 1...", "Feature 2..."],
  "explicitClaims": ["e.g. AI-powered...", "real-time updates...", "100% free..."],
  "contentTypes": ["marketing", "auth", "dashboard", "ecommerce", "documentation"],
  "targetPages": ["${site.startUrl}", "URL_2", "URL_3", "URL_4", "URL_5", "URL_6"]
}`;

    let purpose = {
      summary: site.title || 'Web application',
      primaryUserJourneys: ['Explore homepage', 'Navigate primary links'],
      claimedFeatures: [],
      explicitClaims: [],
      contentTypes: ['web-application'],
      targetPages: [site.startUrl]
    };

    try {
      const llmRes = await geminiPool.callGeminiWithFallback(
        {
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2
        },
        async (opts) => llmService.callLLM({ role: 'seo', persona: 'builder', ...opts })
      );

      const content = llmRes?.choices?.[0]?.message?.content || llmRes?.text || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        purpose = JSON.parse(jsonMatch[0]);
      }
    } catch (llmErr) {
      console.warn('[websiteTester] Phase 2 LLM inference failed, using fallback:', llmErr.message);
    }

    // Ensure targetPages has startUrl and valid strings
    let finalTargetPages = Array.isArray(purpose.targetPages) && purpose.targetPages.length > 0
      ? purpose.targetPages.filter(p => typeof p === 'string' && p.startsWith('http'))
      : [site.startUrl];

    if (!finalTargetPages.includes(site.startUrl)) {
      finalTargetPages.unshift(site.startUrl);
    }

    // If authenticated and postLoginUrl exists and isn't included, insert it right after startUrl
    if (authResult?.postLoginUrl && !finalTargetPages.includes(authResult.postLoginUrl)) {
      finalTargetPages.splice(1, 0, authResult.postLoginUrl);
    }

    await docRef.update({
      purpose,
      'progress.phase': 3,
      'progress.label': 'Phase 3: Exploring pages & capturing browser evidence...',
      'progress.done': 2
    });

    // Return targetPages and claims directly in HTTP response for Render worker to proceed
    return {
      ok: true,
      targetPages: finalTargetPages.slice(0, 8),
      journeys: purpose.primaryUserJourneys || [],
      explicitClaims: purpose.explicitClaims || []
    };
  }

  // ─────────────────────────────────────────────────────────────
  // EVENT: PHASE 3 BATCH → UPLOAD SCREENSHOTS & STORE EVIDENCE
  // ─────────────────────────────────────────────────────────────
  if (event === 'phase3_batch') {
    const { pagesEvidence, progressDone, progressTotal } = payload;
    const uploadedScreenshots = [];
    const newConsoleErrors = [];
    const newNetworkAnomalies = [];
    const newDomAudits = [];

    if (Array.isArray(pagesEvidence)) {
      for (let i = 0; i < pagesEvidence.length; i++) {
        const item = pagesEvidence[i];
        const pageUrl = item.url;
        const pageSafeName = pageUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-30);

    // Upload Desktop WebP
    if (item.screenshots?.desktopWebpBase64) {
      try {
        const uploadRes = await uploadScreenshotWebp(
          userId,
          item.screenshots.desktopWebpBase64,
          `tester_desktop_${pageSafeName}_${Date.now()}.webp`
        );
        if (uploadRes?.url) {
          uploadedScreenshots.push({
            pageUrl,
            viewport: '1280x720',
            label: `Desktop View (${pageUrl.replace(/^https?:\/\/[^/]+/i, '') || '/'})`,
            fileId: uploadRes.id,
            url: uploadRes.url
          });
        }
      } catch (upErr) {
        console.warn('[websiteTester] Failed to upload desktop screenshot:', upErr.message);
      }
    }

    // Upload Mobile WebP
    if (item.screenshots?.mobileWebpBase64) {
      try {
        const uploadRes = await uploadScreenshotWebp(
          userId,
          item.screenshots.mobileWebpBase64,
          `tester_mobile_${pageSafeName}_${Date.now()}.webp`
        );
        if (uploadRes?.url) {
          uploadedScreenshots.push({
            pageUrl,
            viewport: '390x844',
            label: `Mobile Responsive View (${pageUrl.replace(/^https?:\/\/[^/]+/i, '') || '/'})`,
            fileId: uploadRes.id,
            url: uploadRes.url
          });
        }
      } catch (upErr) {
        console.warn('[websiteTester] Failed to upload mobile screenshot:', upErr.message);
      }
    }

        if (Array.isArray(item.errors)) newConsoleErrors.push(...item.errors);
        if (Array.isArray(item.networkAnomalies)) newNetworkAnomalies.push(...item.networkAnomalies);
        if (item.domAudit) newDomAudits.push({ pageUrl, audit: item.domAudit });
      }
    }

    const prevEvidence = currentData.evidence || { screenshots: [], console: [], network: [], domAudits: [] };
    const updatedEvidence = {
      screenshots: [...(prevEvidence.screenshots || []), ...uploadedScreenshots],
      console: [...(prevEvidence.console || []), ...newConsoleErrors],
      network: [...(prevEvidence.network || []), ...newNetworkAnomalies],
      domAudits: [...(prevEvidence.domAudits || []), ...newDomAudits]
    };

    await docRef.update({
      evidence: updatedEvidence,
      'progress.done': Math.min(5, 2 + Math.round(((progressDone || 1) / (progressTotal || 6)) * 2)),
      'progress.label': `Phase 3: Exploring pages & capturing browser evidence (${progressDone || 1}/${progressTotal || 6})...`
    });

    return { ok: true, batchStored: true };
  }

  // ─────────────────────────────────────────────────────────────
  // EVENT: PHASE 3 COMPLETE → TRIGGER PHASES 4, 5, AND 6
  // ─────────────────────────────────────────────────────────────
  if (event === 'phase3_complete') {
    await docRef.update({
      'progress.phase': 4,
      'progress.label': 'Phase 4: Running parallel LLM triage on DOM, network & visual evidence...',
      'progress.done': 4
    });

    const refreshedDoc = await docRef.get();
    const testData = refreshedDoc.data() || {};
    const purpose = testData.purpose || {};
    const evidence = testData.evidence || { screenshots: [], console: [], network: [], domAudits: [] };
    const site = testData.site || { title: testData.url, startUrl: testData.url };

    // ─────────────────────────────────────────────────────────
    // PHASE 4: BULK TRIAGE (4-Key Parallel Split)
    // ─────────────────────────────────────────────────────────
    const triageTasks = [
      // Task 1: Layout & Responsive Breakdowns
      {
        prompt: `Analyze captured DOM and responsive audit for layout breaks, horizontal overflows, and broken assets:
DOM Audits: ${JSON.stringify(evidence.domAudits.slice(0, 10))}
Identify confirmed visual/layout bugs. Return a JSON array of bug objects:
[{"title": "...", "severity": "high"|"medium"|"low", "actual": "...", "expected": "...", "url": "..."}]`
      },
      // Task 2: Console & Network API Failures
      {
        prompt: `Analyze browser console errors and failed/slow network requests:
Console Errors: ${JSON.stringify(evidence.console.slice(0, 20))}
Network Anomalies: ${JSON.stringify(evidence.network.slice(0, 20))}
Identify confirmed technical and client runtime defects. Return a JSON array:
[{"title": "...", "severity": "critical"|"high"|"medium"|"low", "actual": "...", "expected": "...", "url": "..."}]`
      },
      // Task 3: Interactive & Dead Elements
      {
        prompt: `Analyze DOM interactions and dead buttons:
DOM Audits: ${JSON.stringify(evidence.domAudits.map(d => ({ pageUrl: d.pageUrl, deadButtons: d.audit?.deadButtons })).slice(0, 10))}
Identify functional UX and interaction defects. Return a JSON array:
[{"title": "...", "severity": "medium"|"low", "actual": "...", "expected": "...", "url": "..."}]`
      },
      // Task 4: Content, Headings & Cross-Page Inconsistencies
      {
        prompt: `Analyze site purpose, headings, and discoverability:
Site: ${JSON.stringify(site)}
Purpose: ${JSON.stringify(purpose)}
Identify cross-page navigation, UX, or branding inconsistencies. Return a JSON array:
[{"title": "...", "severity": "low"|"ux", "actual": "...", "expected": "...", "url": "..."}]`
      }
    ];

    let triageFindings = [];
    try {
      const parallelResults = await geminiPool.runParallelGemini(
        triageTasks.map(t => ({ messages: [{ role: 'user', content: t.prompt }], temperature: 0.2 })),
        {
          concurrencyPerKey: 2,
          fallbackFn: async (task) => llmService.callLLM({ role: 'seo', persona: 'builder', ...task })
        }
      );

      parallelResults.forEach((res) => {
        const text = res?.choices?.[0]?.message?.content || res?.text || '';
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed)) triageFindings.push(...parsed);
          } catch {}
        }
      });
    } catch (triageErr) {
      console.warn('[websiteTester] Phase 4 parallel triage error:', triageErr.message);
    }

    // ─────────────────────────────────────────────────────────
    // PHASE 5: DEEP CLAIM VERIFICATION (Claim vs Reality Matrix)
    // ─────────────────────────────────────────────────────────
    await docRef.update({
      'progress.phase': 5,
      'progress.label': 'Phase 5: Verifying site claims against captured network & DOM reality...',
      'progress.done': 5
    });

    const claimPrompt = `You are a Principal Software QA Architect and Senior Product Reliability Engineer.
Analyze and synthesize all triage findings, runtime logs, and browser evidence for this website audit.
Produce an in-depth, rigorous, highly explaining, and actionable audit report.

SITE AUDITED: ${site.startUrl} ("${site.title}")
AUTHENTICATION CONTEXT: ${JSON.stringify(testData.authSummary || { mode: 'guest' })}
PURPOSE & JOURNEYS: ${JSON.stringify(purpose)}
MARKETING CLAIMS TO VERIFY: ${JSON.stringify(purpose.explicitClaims || [])}
TRIAGE FINDINGS: ${JSON.stringify(triageFindings.slice(0, 30))}
BROWSER CONSOLE ERRORS: ${JSON.stringify(evidence.console.slice(0, 25))}
NETWORK ANOMALIES & FAILED REQUESTS: ${JSON.stringify(evidence.network.slice(0, 25))}
DOM & RESPONSIVE AUDITS: ${JSON.stringify(evidence.domAudits.slice(0, 10))}
SCREENSHOT LABELS & URLS: ${JSON.stringify(evidence.screenshots.map(s => ({ pageUrl: s.pageUrl, label: s.label, url: s.url })))}

Instructions:
1. Executive Summary: Write a clear 2-3 paragraph executive summary explaining:
   - What the product is and who it serves.
   - Overall health rating (Stable, Degraded, Critical).
   - Core technical / UX bottlenecks observed during live browser interaction.
   - If authenticated, include a dedicated evaluation of protected post-login dashboard modules, API authentication health (e.g. 401/403/500 errors), empty state bugs, broken sidebar navigation, and hardcoded vs dynamic dashboard data.
2. Claim Verification Matrix:
   - For every marketing claim, assign a verdict ('VERIFIED', 'DISPROVEN', 'LIKELY', 'INCONCLUSIVE').
   - Provide an in-depth "reasoning" with tangible evidence (what network requests, DOM elements, or missing states proved or questioned this claim).
   - Provide a "businessImpact" (how this affects user conversion or brand credibility).
3. Discovered Defects & Anomalies:
   - Group and deduplicate findings into: 'confirmed' (hard technical failures like 4xx/5xx, net::ERR, script crashes), 'likely' (probable bugs), 'ux' (friction points, missing breadcrumbs/nav), or 'capability-verification' (feature gaps).
   - Flag specific post-login defects (e.g. broken dashboard API endpoints returning 401/403/500, empty state bugs, broken sidebar navigation, unresponsive dashboard widgets, fake/hardcoded metrics vs real API data).
   - For each finding, provide:
     * title: Clear and descriptive.
     * url: Exact route where it occurs.
     * severity: 'critical', 'high', 'medium', or 'low'.
     * action: Specific reproduction steps taken by the automated browser.
     * expected: What a healthy application should do.
     * actual: Exact error message, HTTP code, or broken DOM state observed.
     * evidence: Direct technical log or network URL excerpt.
     * rootCause: Deep architectural / code-level explanation of why this bug is happening.
     * fixRecommendation: Step-by-step actionable code/architecture fix for the developer.
     * screenshotUrl: Exact matching screenshot URL from the evidence list or null.

Respond ONLY with a valid JSON object in this format:
{
  "summary": "Detailed 2-3 paragraph executive summary...",
  "healthScore": 75,
  "healthStatus": "Degraded Performance" | "Stable" | "Critical Defects",
  "claimMatrix": [
    {
      "claim": "Claim text",
      "verdict": "VERIFIED" | "DISPROVEN" | "LIKELY" | "INCONCLUSIVE",
      "reasoning": "Detailed technical reasoning based on DOM & network evidence...",
      "businessImpact": "Impact on user trust and adoption..."
    }
  ],
  "findings": [
    {
      "id": "bug_1",
      "title": "Clear issue title",
      "url": "https://...",
      "action": "Navigated to page and initiated listener...",
      "expected": "Expected behavior...",
      "actual": "Observed failure...",
      "evidence": "Technical proof...",
      "screenshotUrl": "matching screenshot URL or null",
      "category": "confirmed" | "likely" | "ux" | "capability-verification",
      "severity": "critical" | "high" | "medium" | "low",
      "confidence": 0.95,
      "rootCause": "Deep technical root cause...",
      "fixRecommendation": "Concrete guidance on how developers can fix this..."
    }
  ]
}`;

    let synthesizedResult = {
      summary: `Automated audit completed for ${site.startUrl}. Examined desktop and mobile rendering across key routes.`,
      claimMatrix: [],
      findings: []
    };

    try {
      const phase5Res = await llmService.callLLM({
        role: 'builder',
        messages: [{ role: 'user', content: claimPrompt }],
        temperature: 0.2
      });

      const rawText = phase5Res?.choices?.[0]?.message?.content || phase5Res?.text || '';
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        synthesizedResult = JSON.parse(match[0]);
      }
    } catch (phase5Err) {
      console.warn('[websiteTester] Phase 5 synthesis fallback:', phase5Err.message);
      synthesizedResult.findings = triageFindings.map((f, idx) => ({
        id: `bug_${idx + 1}`,
        title: f.title || 'Observed defect',
        url: f.url || site.startUrl,
        action: 'Navigation & audit',
        expected: f.expected || 'Clean presentation without errors',
        actual: f.actual || 'Anomaly detected',
        evidence: 'Detected in browser audit logs',
        screenshotUrl: evidence.screenshots?.[0]?.url || null,
        category: 'likely',
        severity: f.severity || 'medium',
        confidence: 0.8,
        rootCause: 'DOM/Script anomaly'
      }));
    }

    // Associate screenshots with findings if matching URL exists
    const finalFindings = (synthesizedResult.findings || []).map((finding, idx) => {
      let matchedShot = null;
      if (finding.url && evidence.screenshots.length > 0) {
        matchedShot = evidence.screenshots.find(s => s.pageUrl === finding.url) || evidence.screenshots[0];
      }
      return {
        ...finding,
        id: finding.id || `bug_${idx + 1}`,
        screenshotUrl: finding.screenshotUrl || (matchedShot ? matchedShot.url : null)
      };
    });

    // ─────────────────────────────────────────────────────────
    // PHASE 6: REPORT ASSEMBLY & PDF GENERATION
    // ─────────────────────────────────────────────────────────
    await docRef.update({
      'progress.phase': 6,
      'progress.label': 'Phase 6: Generating evidence-based PDF bug report...',
      'progress.done': 6
    });

    let reportPdfRecord = null;
    try {
      const authSummary = testData.authSummary || {};
      const authModeDisplay = {
        guest: 'Guest (Public Crawl Only)',
        credentials: 'Login Credentials (Multi-Step Form)',
        session: 'Session Injection (Cookies / localStorage / Bearer Token)',
        auto_signup: 'Autonomous Test Registration (Auto-Signup)'
      }[authSummary.mode] || (authSummary.mode || 'Guest');

      const pdfSections = [
        {
          heading: '1. Executive Summary & Application Health',
          body: `${synthesizedResult.summary || 'Audit executed across desktop and mobile viewports.'}\n\n` +
            `Target Application: ${site.startUrl}\n` +
            `Audit Title: ${site.title || 'Web Application'}\n` +
            `Health Status: ${synthesizedResult.healthStatus || 'Evaluated'}` +
            (synthesizedResult.healthScore ? ` (${synthesizedResult.healthScore}/100)` : '') + '\n' +
            `Total Pages / Views Explored: ${site.pageCount || 1}\n` +
            `Total Detected Findings: ${finalFindings.length}`
        },
        {
          heading: '2. Authentication & Post-Login Dashboard Coverage',
          body: `Authentication Mode: ${authModeDisplay}\n` +
            `Login Verification Status: ${authSummary.authenticated ? 'Authenticated Successfully' : (authSummary.mode === 'guest' ? 'Guest Mode (Public Audit)' : `Auth Incomplete / Public Fallback${authSummary.authError ? ` (${authSummary.authError})` : ''}`)}\n` +
            (authSummary.postLoginUrl ? `Post-Login Landing Route: ${authSummary.postLoginUrl}\n` : '') +
            `Protected Dashboard Pages & SPA Tabs Audited: ${authSummary.dashboardViewsFound || 0}\n` +
            `Destructive & Logout Guardrails: Active (Prevented unintended logout and state mutation)`
        },
        {
          heading: '3. Product Purpose & Discovered User Journeys',
          body: `Inferred Core Purpose:\n${purpose.summary || 'Web Application'}\n\n` +
            `Key User Journeys Tested:\n${(purpose.primaryUserJourneys || []).map(j => `• ${j}`).join('\n')}\n\n` +
            `Identified Content/Page Types:\n${(purpose.contentTypes || []).map(c => `• ${c}`).join('\n')}`
        },
        {
          heading: '4. Marketing Claims vs. Browser Reality Matrix',
          body: (synthesizedResult.claimMatrix && synthesizedResult.claimMatrix.length > 0)
            ? synthesizedResult.claimMatrix.map(m => {
                return `[${m.verdict}] "${m.claim}"\n` +
                  `Evidence & Analysis: ${m.reasoning || 'Evaluated against browser runtime.'}\n` +
                  (m.businessImpact ? `Business & Trust Impact: ${m.businessImpact}\n` : '');
              }).join('\n')
            : 'No explicit marketing claims verified during this automated run.'
        },
        {
          heading: '5. Deep Technical & UX Findings',
          body: finalFindings.length > 0
            ? finalFindings.map((f, i) => {
                return `─────────────────────────────────────────────────────────────\n` +
                  `FINDING #${i + 1}: [${(f.severity || 'MEDIUM').toUpperCase()}] [${(f.category || 'DEFECT').toUpperCase()}] ${f.title}\n` +
                  `URL: ${f.url || site.startUrl}\n` +
                  `Reproduction Action: ${f.action || 'Page navigation and background listeners'}\n` +
                  `Expected Behavior: ${f.expected || 'Clean execution without errors'}\n` +
                  `Actual Observed: ${f.actual || 'Defect detected in runtime'}\n` +
                  `Evidence: ${f.evidence || 'Captured in browser network/console trace'}\n` +
                  `Root Cause: ${f.rootCause || 'Unspecified runtime/configuration issue'}\n` +
                  (f.fixRecommendation ? `Recommended Fix: ${f.fixRecommendation}\n` : '') +
                  (f.screenshotUrl ? `Visual Evidence: ${f.screenshotUrl}\n` : '');
              }).join('\n')
            : 'No defects or anomalies detected during this automated test run.'
        },
        {
          heading: '6. Methodology & Browser Test Protocol',
          body: `This audit was executed autonomously using headless Chromium via Playwright on a stateless worker.\n` +
            `• Viewports Tested: Desktop (1280x720) and Mobile Responsive (390x844).\n` +
            `• Phase 0 Authentication: Pre-crawl credential login, cookie/localStorage session injection, or autonomous account creation.\n` +
            `• SPA & Dashboard Discovery: Audited protected dashboard routes and interactive single-page app tabs.\n` +
            `• Destructive Action Guardrails: Actively blacklisted logout, delete account, and payment submission triggers.\n` +
            `• Analyzed Signals: DOM horizontal scroll overflow, broken asset links, dead navigation targets, console errors, HTTP >=400 failures, and streaming sync anomalies.\n` +
            `• Screenshots were compressed to WebP (Quality 65) and permanently archived in Cloudinary.`
        }
      ];

      const pdfSpec = {
        format: 'pdf',
        title: `Autonomous AI Website Audit Report - ${site.title || site.startUrl}`,
        filename: `website_audit_${testId}.pdf`,
        sections: pdfSections
      };

      const pdfBuffer = await documentGenerator.generatePdf(pdfSpec);
      if (pdfBuffer) {
        const uploadRes = await fileService.uploadFile(userId, {
          buffer: pdfBuffer,
          originalname: `Website_Audit_${site.title ? site.title.replace(/[^a-zA-Z0-9]/g, '_') : 'Report'}_${Date.now()}.pdf`,
          mimetype: 'application/pdf',
          size: pdfBuffer.length
        });
        if (uploadRes?.url) {
          reportPdfRecord = {
            fileId: uploadRes.id,
            url: uploadRes.url,
            originalName: uploadRes.originalName
          };
        }
      }
    } catch (pdfErr) {
      console.warn('[websiteTester] PDF generation error:', pdfErr.message);
    }

    // Complete audit in Firestore
    await docRef.update({
      status: 'done',
      finishedAt: new Date().toISOString(),
      summary: synthesizedResult.summary || 'Audit completed successfully.',
      claimMatrix: synthesizedResult.claimMatrix || [],
      findings: finalFindings,
      reportPdf: reportPdfRecord,
      'progress.done': 6,
      'progress.label': 'Audit Complete'
    });

    console.log(`[websiteTester] Completed test ${testId} with ${finalFindings.length} findings.`);
    return { ok: true, completed: true, findingsCount: finalFindings.length };
  }

  // ─────────────────────────────────────────────────────────────
  // EVENT: WORKER ERROR
  // ─────────────────────────────────────────────────────────────
  if (event === 'worker_error') {
    const errorMsg = payload.error || 'Unknown worker error';
    await docRef.update({
      status: 'failed',
      error: errorMsg,
      finishedAt: new Date().toISOString(),
      'progress.label': `Failed: ${errorMsg}`
    });
    return { ok: true, failed: true };
  }

  return { ok: true, ignored: true };
}

module.exports = {
  startWebsiteTest,
  getWebsiteTestStatus,
  listWebsiteTests,
  deleteWebsiteTest,
  handleWorkerWebhook,
  tryWakeAndDispatchWorker
};
