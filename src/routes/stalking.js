const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const stalk = require('../services/stalkingService');

// GET /api/stalking
router.get('/', requireAuth, async (req, res) => {
  try {
    const profiles = await stalk.listProfiles(req.userId);
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stalking  { name?, link?, notes? }
router.post('/', requireAuth, async (req, res) => {
  const { name, link, notes } = req.body || {};
  if (!link && !name) return res.status(400).json({ error: 'Provide a name or a link (LinkedIn / GitHub / site) to stalk.' });
  try {
    const profile = await stalk.createProfile(req.userId, { name, link, notes });
    // Kick off the deep-dive research (background — response returns immediately).
    // FIX (#9): researchProfile() already persists status:'error' to Firestore on
    // failure (visible in the UI), but the route-level .catch(() => {}) silently
    // dropped the error server-side too — so a bug in the write itself, or any
    // failure before that persistence happens, left zero trace anywhere. Now it's
    // at least logged so it shows up in server logs instead of vanishing.
    stalk.researchProfile(req.userId, profile.id).catch(err =>
      console.error(`[stalking] background research failed (profile ${profile.id}):`, err.message)
    );
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stalking/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const profile = await stalk.getProfile(req.userId, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/stalking/:id  { name, link, notes }
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const profile = await stalk.updateProfile(req.userId, req.params.id, req.body || {});
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stalking/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await stalk.deleteProfile(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stalking/:id/research — re-run deep-dive
router.post('/:id/research', requireAuth, async (req, res) => {
  try {
    stalk.researchProfile(req.userId, req.params.id).catch(err =>
      console.error(`[stalking] background re-research failed (profile ${req.params.id}):`, err.message)
    );
    res.json({ status: 'researching' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stalking/:id/chat
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const messages = await stalk.chatList(req.userId, req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stalking/:id/chat  { message }
router.post('/:id/chat', requireAuth, async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  if (message.length > 4000) return res.status(400).json({ error: 'message too long' });
  try {
    const data = await stalk.chatSend(req.userId, req.params.id, message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
