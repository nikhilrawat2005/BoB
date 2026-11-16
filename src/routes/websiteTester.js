const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const testerService = require('../services/websiteTesterService');

const WORKER_SECRET = process.env.TESTER_WORKER_SECRET || '';

/**
 * Determine request base URL (for Webhook callbacks)
 */
function getRequestBaseUrl(req) {
  if (process.env.PUBLIC_BOB_BASE_URL) {
    return process.env.PUBLIC_BOB_BASE_URL.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

/**
 * Webhook endpoint from Render Playwright worker.
 * Authenticated via header 'x-worker-secret' (NO Firebase user auth token).
 */
router.post('/webhook', async (req, res) => {
  try {
    if (WORKER_SECRET) {
      const incomingSecret = req.headers['x-worker-secret'];
      if (!incomingSecret || incomingSecret !== WORKER_SECRET) {
        return res.status(401).json({ error: 'Unauthorized: invalid worker secret' });
      }
    }

    const result = await testerService.handleWorkerWebhook(req.body);
    res.json(result || { ok: true });
  } catch (err) {
    console.error('[websiteTesterWebhook] Error processing webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Protected user endpoints
 */

// POST /api/website-tester - Starts a new autonomous website test
router.post('/', requireAuth, async (req, res) => {
  try {
    const { url, authConfig } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Field "url" is required' });
    }

    const baseUrl = getRequestBaseUrl(req);
    const testRecord = await testerService.startWebsiteTest(req.userId, url, baseUrl, authConfig);
    res.status(202).json(testRecord);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/website-tester - Lists user's past website tests
router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const tests = await testerService.listWebsiteTests(req.userId, limit);
    res.json({ tests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/website-tester/:id - Gets live status and findings
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const baseUrl = getRequestBaseUrl(req);
    const test = await testerService.getWebsiteTestStatus(req.userId, req.params.id, baseUrl);
    if (!test) {
      return res.status(404).json({ error: 'Website test not found' });
    }
    res.json(test);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/website-tester/:id/pdf - Redirects or streams PDF report
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const baseUrl = getRequestBaseUrl(req);
    const test = await testerService.getWebsiteTestStatus(req.userId, req.params.id, baseUrl);
    if (!test || !test.reportPdf || !test.reportPdf.url) {
      return res.status(404).json({ error: 'PDF report not found or not yet generated' });
    }
    res.redirect(test.reportPdf.url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/website-tester/:id - Deletes test record
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await testerService.deleteWebsiteTest(req.userId, req.params.id);
    res.json({ success: true, message: 'Test deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/website-tester/:id/rerun - Reruns an existing test
router.post('/:id/rerun', requireAuth, async (req, res) => {
  try {
    const baseUrl = getRequestBaseUrl(req);
    const existing = await testerService.getWebsiteTestStatus(req.userId, req.params.id, baseUrl);
    if (!existing || !existing.url) {
      return res.status(404).json({ error: 'Original test not found' });
    }
    const { authConfig } = req.body || {};
    const newTest = await testerService.startWebsiteTest(req.userId, existing.url, baseUrl, authConfig);
    res.status(202).json(newTest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
