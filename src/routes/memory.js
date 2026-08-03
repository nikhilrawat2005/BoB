const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const memory = require('../services/memoryService');

// GET /api/memory/facts
router.get('/facts', requireAuth, async (req, res) => {
  try {
    const facts = await memory.listFacts(req.userId);
    res.json({ facts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/facts  { text }
router.post('/facts', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (typeof text !== 'string' || text.length > 1000) {
    return res.status(400).json({ error: 'text must be a string under 1000 characters' });
  }
  try {
    const fact = await memory.addFact(req.userId, text);
    res.json({ fact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/memory/facts/:id
router.delete('/facts/:id', requireAuth, async (req, res) => {
  try {
    await memory.deleteFact(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
