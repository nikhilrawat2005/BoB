const express = require('express');
const { executePlaywrightPipeline } = require('./testerCore');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;
const WORKER_SECRET = process.env.TESTER_WORKER_SECRET || '';

// Single active job concurrency lock to guarantee 512MB RAM survival on Render
let activeJobId = null;

// Auth middleware for protected worker routes
function requireWorkerSecret(req, res, next) {
  if (!WORKER_SECRET) {
    return next();
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

  // Execute pipeline in background with cleanup callback
  executePlaywrightPipeline({
    testId,
    userId,
    url,
    callbackUrl,
    authConfig,
    onJobComplete: () => {
      activeJobId = null;
    }
  });
});

app.listen(PORT, () => {
  console.log(`[testerWorker] Stateless Playwright Browser Worker running on port ${PORT}`);
});
