const crypto = require('crypto');
const fetch = require('node-fetch');
const { db } = require('../config/firebase');
const geminiPool = require('./geminiPoolService');
const llmService = require('./llmService');
const documentGenerator = require('./documentGenerator');
const fileService = require('./fileService');

const WORKER_URL = (process.env.RENDER_TESTER_WORKER_URL || '').replace(/\/$/, '');
const WORKER_SECRET = process.env.TESTER_WORKER_SECRET || '';

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

      // Worker is awake & idle -> dispatch immediately
      console.log(`[websiteTester] Worker is awake. Dispatching POST /worker/run for test ${testId}...`);
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
          callbackUrl
        })
      });

      if (runRes.status === 202 || runRes.ok) {
        if (db) {
          await db.collection('users').doc(userId).collection('website_tests').doc(testId).update({
            status: 'running',
            workerDispatched: true,
            progress: { phase: 1, label: 'Phase 1: Crawling & discovering site routes in real browser...', done: 1, total: 6 }
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
async function startWebsiteTest(userId, rawUrl, baseUrl) {
  const url = normalizeUrl(rawUrl);
  const testId = `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const initialRecord = {
    testId,
    userId,
    url,
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
    const { site, discoveryData } = payload;
    await docRef.update({
      site,
      status: 'running',
      'progress.phase': 2,
      'progress.label': 'Phase 2: Inferring site purpose, journeys & marketing claims...',
      'progress.done': 2
    });

    // Run Phase 2 Purpose Inference via Gemini Pool
    const prompt = `You are a Principal Software QA & Product Architect.
Analyze this website discovery crawl data to infer what the product/service is, what user journeys are essential, and what explicit claims it makes.

DISCOVERY DATA:
URL: ${site.startUrl}
Title: ${site.title}
Homepage Headings: ${JSON.stringify(discoveryData.homepage?.headings || [])}
Homepage CTAs: ${JSON.stringify(discoveryData.homepage?.ctas || [])}
Forms: ${JSON.stringify(discoveryData.homepage?.forms || [])}
Text Snippet: ${(discoveryData.homepage?.textSample || '').slice(0, 3000)}
Sample Discovered Internal Links: ${JSON.stringify((discoveryData.linksSample || []).slice(0, 30))}

Respond ONLY with a JSON object in this exact format:
{
  "summary": "1-2 sentence core purpose of the website",
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
    const finalTargetPages = Array.isArray(purpose.targetPages) && purpose.targetPages.length > 0
      ? purpose.targetPages.filter(p => typeof p === 'string' && p.startsWith('http'))
      : [site.startUrl];

    if (!finalTargetPages.includes(site.startUrl)) {
      finalTargetPages.unshift(site.startUrl);
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
      targetPages: finalTargetPages.slice(0, 6),
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
                label: 'Desktop View',
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
                label: 'Mobile Responsive View',
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

    const claimPrompt = `You are an Autonomous AI Website Tester.
Synthesize all triage findings and verify marketing claims against evidence.

SITE: ${site.startUrl} (${site.title})
PURPOSE: ${JSON.stringify(purpose)}
EXPLICIT CLAIMS: ${JSON.stringify(purpose.explicitClaims || [])}
TRIAGE FINDINGS: ${JSON.stringify(triageFindings.slice(0, 25))}
CAPTURED NETWORK & CONSOLE:
Console: ${JSON.stringify(evidence.console.slice(0, 15))}
Network: ${JSON.stringify(evidence.network.slice(0, 15))}
SCREENSHOTS: ${JSON.stringify(evidence.screenshots.map(s => ({ pageUrl: s.pageUrl, label: s.label, url: s.url })))}

Task:
Produce a structured synthesis of verified findings.
Each finding MUST be categorized into one of: 'confirmed', 'likely', 'ux', 'capability-verification'.
Severity MUST be: 'critical', 'high', 'medium', or 'low'.

Respond ONLY with a JSON object:
{
  "summary": "High-level audit executive summary (1-2 paragraphs)",
  "claimMatrix": [
    {
      "claim": "Claim text",
      "verdict": "VERIFIED" | "DISPROVEN" | "INCONCLUSIVE" | "UNTESTED",
      "reasoning": "What the network/DOM proved or failed to prove"
    }
  ],
  "findings": [
    {
      "id": "bug_1",
      "title": "Clear concise issue title",
      "url": "Specific page URL",
      "action": "Steps that expose the issue",
      "expected": "Expected behavior",
      "actual": "Observed behavior",
      "evidence": "Network status, console log, or DOM overflow metric",
      "screenshotUrl": "matching screenshot URL or null",
      "category": "confirmed" | "likely" | "ux" | "capability-verification",
      "severity": "critical" | "high" | "medium" | "low",
      "confidence": 0.95,
      "rootCause": "Probable root cause"
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
      const pdfSpec = {
        format: 'pdf',
        title: `Bob Autonomous AI Website Audit - ${site.title || site.startUrl}`,
        filename: `website_audit_${testId}.pdf`,
        sections: [
          {
            heading: '1. Executive Summary',
            body: `${synthesizedResult.summary || 'Audit executed across desktop and mobile viewports.'}\n\nSite: ${site.startUrl}\nPages Explored: ${site.pageCount || 1}\nTotal Findings: ${finalFindings.length}`
          },
          {
            heading: '2. Purpose & Feature Inference',
            body: `Inferred Purpose: ${purpose.summary || 'Web Application'}\n\nPrimary User Journeys:\n${(purpose.primaryUserJourneys || []).map(j => `• ${j}`).join('\n')}\n\nKey Claims:\n${(purpose.explicitClaims || []).map(c => `• ${c}`).join('\n')}`
          },
          {
            heading: '3. Claim vs. Reality Verification Matrix',
            body: (synthesizedResult.claimMatrix && synthesizedResult.claimMatrix.length > 0)
              ? synthesizedResult.claimMatrix.map(m => `[${m.verdict}] ${m.claim}\nReasoning: ${m.reasoning}`).join('\n\n')
              : 'No explicit claims evaluated.'
          },
          {
            heading: '4. Categorized Findings & Evidence Trails',
            body: finalFindings.length > 0
              ? finalFindings.map((f, i) => {
                  return `${i + 1}. [${f.severity ? f.severity.toUpperCase() : 'MEDIUM'}] [${f.category || 'CONFIRMED'}] ${f.title}\n` +
                    `URL: ${f.url || site.startUrl}\n` +
                    `Expected: ${f.expected || 'N/A'}\n` +
                    `Actual: ${f.actual || 'N/A'}\n` +
                    `Evidence: ${f.evidence || 'Recorded in browser trace'}\n` +
                    `Root Cause: ${f.rootCause || 'N/A'}\n` +
                    (f.screenshotUrl ? `Screenshot: ${f.screenshotUrl}\n` : '');
                }).join('\n')
              : 'No critical defects found during this automated test run.'
          }
        ]
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
