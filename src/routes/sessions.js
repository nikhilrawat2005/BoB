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
    let title = req.body.title;
    if (title && (typeof title !== 'string' || title.length > 100)) {
      return res.status(400).json({ error: 'title must be a string under 100 characters' });
    }
    const session = await memory.createSession(req.userId, title);
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

// PATCH /api/sessions/:id  { title }
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Valid title is required' });
    }
    const cleanTitle = title.trim().slice(0, 100);
    await memory.updateSessionTitle(req.userId, req.params.id, cleanTitle);
    await memory.syncSessionFactTitles(req.userId, req.params.id, cleanTitle);
    res.json({ success: true, id: req.params.id, title: cleanTitle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sessions/:id  { title }
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Valid title is required' });
    }
    const cleanTitle = title.trim().slice(0, 100);
    await memory.updateSessionTitle(req.userId, req.params.id, cleanTitle);
    await memory.syncSessionFactTitles(req.userId, req.params.id, cleanTitle);
    res.json({ success: true, id: req.params.id, title: cleanTitle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await memory.deleteSession(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
