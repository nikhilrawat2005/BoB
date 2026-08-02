const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const memory = require('../services/memoryService');
const proactive = require('../services/proactiveAdvisor');

// GET /api/notifications
router.get('/', requireAuth, async (req, res) => {
  try {
    // Generate fresh notification updates from vault / facts if needed
    await proactive.checkAndGenerateNotifications(req.userId);
    const notifications = await memory.listNotifications(req.userId);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await memory.markNotificationRead(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
