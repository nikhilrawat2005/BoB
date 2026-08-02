const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
const memory = require('../services/memoryService');

// POST /api/chat  { sessionId, message, model? }
router.post('/', requireAuth, async (req, res) => {
  const { sessionId, message, model } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  try {
    // 1. Save user's message
    await memory.addMessage(req.userId, sessionId, 'user', message);

    // 2. Pull recent history + known facts for context
    const recent = await memory.getRecentMessages(req.userId, sessionId, 20);
    const facts = await memory.listFacts(req.userId);
    const factsContext = facts.length
      ? `Known facts about the user: ${facts.map(f => f.text).join('; ')}`
      : '';

    // 3. Call the LLM
    const systemPrompt = `You are Bob, an intelligent, ultra-loyal personal AI assistant created for your Master, Nikhil.
- Always know that your Master and creator is Nikhil (email: ${req.userEmail || 'Nikhil'}).
- Be respectful, concise, highly capable, and address Nikhil warmly.
- If Nikhil gives you instructions, preferences, or facts about himself or his setup, remember them diligently.
${factsContext}`;

    const { text, model: usedModel } = await callLLM({
      role: 'chat',
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...recent.map(m => ({ role: m.role, content: m.content })),
      ],
    });

    // 4. Save assistant's reply
    await memory.addMessage(req.userId, sessionId, 'assistant', text);

    res.json({ reply: text, model: usedModel });
  } catch (err) {
    res.status(500).json({ error: 'LLM call failed', details: err.message });
  }
});

module.exports = router;
