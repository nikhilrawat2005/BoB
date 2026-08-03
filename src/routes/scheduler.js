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
function tickAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'] || '';
  const provided    = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (cronSecret) {
    if (provided === cronSecret) return next();
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }
  return requireAuth(req, res, next);
}

router.post('/tick', tickAuth, async (req, res) => {
  try {
    const result = await scheduler.tick();
    res.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
