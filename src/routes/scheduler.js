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
// POST /api/scheduler/tick  — Vercel Cron endpoint
// Called automatically by Vercel every 15 minutes
// Protected by CRON_SECRET header
// ─────────────────────────────────────────────────────────
router.post('/tick', async (req, res) => {
  // Vercel sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'] || '';
  const provided    = authHeader.replace('Bearer ', '').trim();

  // If CRON_SECRET is set, validate it; if not set, allow (dev mode)
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }

  try {
    const result = await scheduler.tick();
    res.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
