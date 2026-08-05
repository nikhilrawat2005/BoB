const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const hacks = require('../services/hackathonService');

// GET /api/hackathons
router.get('/', requireAuth, async (req, res) => {
  try {
    const hackathons = await hacks.listHackathons(req.userId);
    res.json({ hackathons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hackathons/parse  { rawText }
router.post('/parse', requireAuth, async (req, res) => {
  const { rawText } = req.body || {};
  if (!rawText) return res.status(400).json({ error: 'rawText is required' });
  try {
    const parsed = await hacks.parseFromText(req.userId, rawText);
    res.json({ parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hackathons  { title?, link, source?, startDate?, endDate?, mode?, prize?, description?, rules?, participating?, tracking? }
router.post('/', requireAuth, async (req, res) => {
  const { title, link, source, startDate, endDate, mode, prize, description, rules, participating, tracking } = req.body || {};
  if (!link && !title) return res.status(400).json({ error: 'Provide a hackathon link or title.' });
  try {
    const hackathon = await hacks.createHackathon(req.userId, { title, link, source, startDate, endDate, mode, prize, description, rules, participating, tracking });
    res.json({ hackathon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hackathons/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const hackathon = await hacks.getHackathon(req.userId, req.params.id);
    if (!hackathon) return res.status(404).json({ error: 'Hackathon not found' });
    res.json({ hackathon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/hackathons/:id  { tracking, participating, notes, startDate, endDate, ... }
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const hackathon = await hacks.updateHackathon(req.userId, req.params.id, req.body || {});
    if (!hackathon) return res.status(404).json({ error: 'Hackathon not found' });
    res.json({ hackathon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/hackathons/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await hacks.deleteHackathon(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hackathons/:id/scrape — re-scrape knowledge panel
router.post('/:id/scrape', requireAuth, async (req, res) => {
  try {
    const hackathon = await hacks.refreshKnowledge(req.userId, req.params.id);
    res.json({ hackathon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hackathons/:id/knowledge-from-text  { text } — update knowledge from pasted announcement
router.post('/:id/knowledge-from-text', requireAuth, async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
  try {
    const hackathon = await hacks.refreshKnowledgeFromText(req.userId, req.params.id, text);
    res.json({ hackathon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hackathons/:id/chat
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const messages = await hacks.chatList(req.userId, req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hackathons/:id/chat  { message }
router.post('/:id/chat', requireAuth, async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  if (message.length > 4000) return res.status(400).json({ error: 'message too long' });
  try {
    const data = await hacks.chatSend(req.userId, req.params.id, message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
