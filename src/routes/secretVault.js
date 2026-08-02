const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const memory = require('../services/memoryService');

// Default PIN for Master Nikhil's vault
const VAULT_PIN = process.env.SECRET_VAULT_PIN || '1234';

// POST /api/secret/verify-pin
router.post('/verify-pin', requireAuth, (req, res) => {
  const { pin } = req.body;
  if (pin === VAULT_PIN) {
    return res.json({ success: true, message: 'Vault Access Granted' });
  }
  return res.status(401).json({ success: false, error: 'Incorrect Passcode PIN' });
});

// GET /api/secret/notes
router.get('/notes', requireAuth, async (req, res) => {
  try {
    const notes = await memory.listSecretNotes(req.userId);
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/secret/notes  { noteText, eventDate? }
router.post('/notes', requireAuth, async (req, res) => {
  const { noteText, eventDate } = req.body;
  if (!noteText) return res.status(400).json({ error: 'Note text is required' });

  try {
    const note = await memory.addSecretNote(req.userId, noteText, eventDate);
    res.json({ note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/secret/notes/:id
router.delete('/notes/:id', requireAuth, async (req, res) => {
  try {
    await memory.deleteSecretNote(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
