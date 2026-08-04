const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const routines = require('../services/routineService');
const hacks = require('../services/hackathonService');

// Cron auth for the background pump (GitHub Actions) — CRON_SECRET bearer
function cronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (cronSecret) {
    if (provided === cronSecret) return next();
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }
  return requireAuth(req, res, next);
}

// GET /api/routines
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await routines.listRoutines(req.userId);
    res.json({ routines: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/routines  { title, prompt, intervalHours, workspace, target, active }
router.post('/', requireAuth, async (req, res) => {
  const { title, prompt, intervalHours, workspace, target, active } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    const routine = await routines.createRoutine(req.userId, { title, prompt, intervalHours, workspace, target, active });
    res.json({ routine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/routines/:id
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const routine = await routines.updateRoutine(req.userId, req.params.id, req.body || {});
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    res.json({ routine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/routines/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await routines.deleteRoutine(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/routines/:id/run — run now (force)
router.post('/:id/run', requireAuth, async (req, res) => {
  try {
    const routine = await routines.getRoutine(req.userId, req.params.id);
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    const result = await routines.runRoutine(req.userId, routine);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/routines/pump — background worker, every 5 min.
// Runs due routines AND auto-expires/reminds hackathons.
router.post('/pump', cronAuth, async (req, res) => {
  try {
    const routinesOut = await routines.processDueRoutines();
    const hackOut = await hacks.autoExpireAndRemind();
    res.json({ ok: true, routines: routinesOut, hackathons: hackOut, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
