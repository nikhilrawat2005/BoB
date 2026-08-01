const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const memory = require('../services/memoryService');

// GET /api/sessions
router.get('/', requireAuth, async (req, res) => {
  try {
    const sessions = await memory.listSessions(req.userId);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions  { title? }
router.post('/', requireAuth, async (req, res) => {
  try {
    const session = await memory.createSession(req.userId, req.body.title);
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id/messages
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const messages = await memory.getRecentMessages(req.userId, req.params.id, 100);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
