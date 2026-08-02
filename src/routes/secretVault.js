const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const memory = require('../services/memoryService');
const { callLLM } = require('../services/llmService');

// Default PIN for Master Nikhil's vault
const VAULT_PIN = process.env.SECRET_VAULT_PIN || '2005';

// POST /api/secret/verify-pin
router.post('/verify-pin', requireAuth, (req, res) => {
  const { pin } = req.body;
  if (String(pin).trim() === String(VAULT_PIN).trim()) {
    return res.json({ success: true, message: 'Vault Access Granted' });
  }
  return res.status(401).json({ success: false, error: 'Incorrect Passcode PIN' });
});

// GET /api/secret/chat — List hidden secret chat messages
router.get('/chat', requireAuth, async (req, res) => {
  try {
    const messages = await memory.getVaultMessages(req.userId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/secret/chat — Send message in Secret Hidden Chat Mode
router.post('/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // 1. Save user message in secret vault collection
    await memory.addVaultMessage(req.userId, 'user', message);

    // 2. Fetch recent vault messages for context
    const recentVaultMsgs = await memory.getVaultMessages(req.userId, 20);

    const systemPrompt = `You are Bob's Secret Self — an ultra-private, encrypted assistant operating inside Master Nikhil's Secret Vault.
- You are strictly talking inside Master Nikhil's confidential, PIN-protected Secret Vault.
- Address Master Nikhil with extreme loyalty, high confidentiality, and precision.
- Keep responses sharp, highly intelligent, direct, and completely private.`;

    const { text, model } = await callLLM({
      role: 'chat',
      messages: [
        { role: 'system', content: systemPrompt },
        ...recentVaultMsgs.map(m => ({ role: m.role, content: m.content })),
      ],
    });

    // 3. Save assistant reply in secret vault collection
    await memory.addVaultMessage(req.userId, 'assistant', text);

    res.json({ reply: text, model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/secret/chat — Clear all secret chat history
router.delete('/chat', requireAuth, async (req, res) => {
  try {
    await memory.clearVaultMessages(req.userId);
    res.json({ success: true, message: 'Secret chat history wiped.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy note routes maintained for backwards compatibility
router.get('/notes', requireAuth, async (req, res) => {
  try {
    const notes = await memory.listSecretNotes(req.userId);
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
