const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const seo = require('../services/seoService');

// GET /api/seo — list audited sites
router.get('/', requireAuth, async (req, res) => {
  try {
    const sites = await seo.listSites(req.userId);
    res.json({ sites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo  { url } — add website + run audit
router.post('/', requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  try {
    const site = await seo.createSite(req.userId, url);
    res.json({ site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/:id/analyze — re-audit
router.post('/:id/analyze', requireAuth, async (req, res) => {
  try {
    const site = await seo.reAudit(req.userId, req.params.id);
    res.json({ site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/seo/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await seo.deleteSite(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/:id/chat
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const messages = await seo.chatList(req.userId, req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/:id/chat  { message }
router.post('/:id/chat', requireAuth, async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  if (message.length > 4000) return res.status(400).json({ error: 'message too long' });
  try {
    const data = await seo.chatSend(req.userId, req.params.id, message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;