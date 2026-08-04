const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const se = require('../services/selfEditService');

// GET /api/self-edit — list edit history
router.get('/', requireAuth, async (req, res) => {
  try {
    const edits = await se.listEdits(req.userId);
    res.json({ edits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/self-edit/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const edit = await se.getEdit(req.userId, req.params.id);
    if (!edit) return res.status(404).json({ error: 'Edit not found' });
    res.json({ edit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/propose  { title, file, oldCode, newCode, category, reason }
router.post('/propose', requireAuth, async (req, res) => {
  try {
    const edit = await se.proposeEdit(req.userId, req.body);
    res.status(201).json({ edit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/self-edit/run — Bob reviews the codebase and proposes edits (manual by default)
router.post('/run', requireAuth, async (req, res) => {
  try {
    const autoApply = Boolean(req.body.autoApply);
    res.json({ started: true });
    se.runSelfReview(req.userId, { autoApply }).catch(err => console.error('Self-review error:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/:id/approve — approve a manual edit (then apply separately)
router.post('/:id/approve', requireAuth, async (req, res) => {
  try {
    const edit = await se.setStatus(req.userId, req.params.id, 'approved');
    if (!edit) return res.status(404).json({ error: 'Edit not found' });
    res.json({ edit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/:id/reject
router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const edit = await se.setStatus(req.userId, req.params.id, 'rejected');
    if (!edit) return res.status(404).json({ error: 'Edit not found' });
    res.json({ edit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/:id/apply — run the safety pipeline (auto or after approval)
router.post('/:id/apply', requireAuth, async (req, res) => {
  try {
    const edit = await se.applyEdit(req.userId, req.params.id);
    res.json({ edit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
