const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const scheduler = require('../services/schedulerService');

// ─────────────────────────────────────────────────────────
// POST /api/scheduler   — Create a new scheduled task
// Body: { title, prompt, scheduledAt (ISO or epoch ms), repeat? }
// ─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { title, prompt, scheduledAt, repeat } = req.body;

  if (!scheduledAt) {
    return res.status(400).json({ error: 'scheduledAt is required (ISO string or epoch ms)' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required — what should Bob generate?' });
  }
  if (typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'prompt must be a string under 4000 characters' });
  }
  if (title && (typeof title !== 'string' || title.length > 100)) {
    return res.status(400).json({ error: 'title must be a string under 100 characters' });
  }
  if (repeat && !['none', 'daily', 'weekly'].includes(repeat)) {
    return res.status(400).json({ error: 'repeat must be one of: none, daily, weekly' });
  }

  try {
    const task = await scheduler.createTask(req.userId, { title, prompt, scheduledAt, repeat });
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/scheduler   — List pending scheduled tasks
// ─────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const statusFilter = req.query.status || 'pending';
    const tasks = await scheduler.listTasks(req.userId, statusFilter);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/scheduler/:id   — Cancel a task
// ─────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await scheduler.cancelTask(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/scheduler/tick  — Scheduled task fire endpoint
// Called hourly by the GitHub Actions workflow (.github/workflows/tick.yml)
// on Vercel Hobby (Vercel Cron only allows once-per-day schedules there).
// Auth: if CRON_SECRET is set, the workflow sends it as
// Authorization: Bearer <CRON_SECRET>; otherwise (dev mode) the
// browser-polling path falls back to the normal Firebase auth.
// ─────────────────────────────────────────────────────────
// FIX (#5): if CRON_SECRET is never set, /api/scheduler/tick silently falls
// back to normal Firebase auth — the GitHub Actions cron workflow (which only
// sends a Bearer secret, never a Firebase ID token) would then get a silent
// 401 every hour with nothing surfaced anywhere except a buried log line.
// This warns loudly ONCE at server startup so a missing CRON_SECRET is
// obvious immediately instead of discovered days later when scheduled tasks
// never fired.
if (!process.env.CRON_SECRET) {
  console.warn(
    '[scheduler] WARNING: CRON_SECRET is not set. /api/scheduler/tick will ' +
    'fall back to normal Firebase auth, which means the GitHub Actions cron ' +
    'workflow (.github/workflows/tick.yml) will fail every run with 401 ' +
    'Unauthorized — it sends a Bearer secret, not a Firebase ID token. ' +
    'Set CRON_SECRET in both Vercel env vars and the GitHub repo secret to fix.'
  );
}

function tickAuth(req, res, next) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = (req.headers['x-cron-secret'] || '').trim();
  const querySecret = (req.query.cron_secret || req.query.key || '').trim();
  const isVercelCron = req.headers['x-vercel-cron'] === '1';

  // If Vercel Cron invoked it directly or valid secret matches
  if (isVercelCron) return next();

  if (cronSecret && (provided === cronSecret || headerSecret === cronSecret || querySecret === cronSecret)) {
    return next();
  }

  // Fallback: check Firebase authentication (e.g. frontend client 30s polling)
  return requireAuth(req, res, next);
}

// In-memory throttling timestamps to prevent runaway Firestore reads on tick
let lastHackDiscoveryRun = 0;
let lastHackExpireRun = 0;
const HACK_RUN_THROTTLE_MS = 12 * 60 * 60 * 1000; // max once every 12 hours
const HACK_EXPIRE_THROTTLE_MS = 6 * 60 * 60 * 1000; // max once every 6 hours

router.post('/tick', tickAuth, async (req, res) => {
  try {
    const result = await scheduler.tick();

    // Run memory consolidation ONLY during the 4 AM - 6 AM IST window, not on every tick!
    const memoryManager = require('../services/memoryManager');
    const targetUserId = req.userId || process.env.PRIMARY_USER_ID;
    if (targetUserId) {
      const now = Date.now();
      const currentHourIST = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }), 10);
      if (currentHourIST >= 4 && currentHourIST <= 6) {
        memoryManager.runDailyConsolidation(targetUserId).catch(e => console.warn('[Scheduler tick] daily consolidation:', e.message));
      }

      // ── Hackathon Discovery: strictly throttled in-memory (max 1 run per 12h) ──
      const hackDiscovery = require('../services/hackathonDiscoveryService');
      if (now - lastHackDiscoveryRun > HACK_RUN_THROTTLE_MS) {
        lastHackDiscoveryRun = now;
        hackDiscovery.runDiscovery(targetUserId).catch(e => console.warn('[Scheduler tick] hackDiscovery:', e.message));
      }

      // ── Hackathon Auto-expire: strictly throttled in-memory (max 1 run per 6h) ──
      if (now - lastHackExpireRun > HACK_EXPIRE_THROTTLE_MS) {
        lastHackExpireRun = now;
        hackDiscovery.autoExpireDiscovery(targetUserId).catch(e => console.warn('[Scheduler tick] hackDiscoveryExpire:', e.message));
      }
    }

    res.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
