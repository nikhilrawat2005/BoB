const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
const memory = require('../services/memoryService');

const memoryManager = require('../services/memoryManager');

// POST /api/chat  { sessionId, message, model? }
router.post('/', requireAuth, async (req, res) => {
  const { sessionId, message, model } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  try {
    // 1. Save user's message
    await memory.addMessage(req.userId, sessionId, 'user', message);

    // 2. Intermediary Router: Classify intent in real time
    const intent = await memoryManager.classifyIntent(message);

    // If new fact detected automatically, store it in memory facts
    if (intent.isNewFact && intent.extractedFact) {
      await memory.addFact(req.userId, intent.extractedFact);
    }

    // 3. Pull recent history, facts, and weekly summaries context
    const recent = await memory.getRecentMessages(req.userId, sessionId, 20);
    const facts = await memory.listFacts(req.userId);
    const weeklySummaries = await memory.listWeeklySummaries(req.userId);

    let contextBlocks = [];
    if (facts.length) {
      contextBlocks.push(`Known facts about Master Nikhil: ${facts.map(f => f.text).join('; ')}`);
    }
    if (weeklySummaries.length) {
      contextBlocks.push(`Historical Weekly Chat Summaries & Key Pointers:\n${weeklySummaries.slice(0, 3).map(s => `[Week ${s.weekId}]: ${s.summary}`).join('\n')}`);
    }

    const memoryContext = contextBlocks.join('\n\n');

    // 4. Call Answering Agent LLM
    const systemPrompt = `You are Bob, an intelligent, ultra-loyal personal AI assistant created for your Master, Nikhil.
- Always know that your Master and creator is Nikhil (email: ${req.userEmail || 'Nikhil'}).
- Be respectful, concise, highly capable, and address Master Nikhil warmly.
- You have full access to historical chat summaries and stored facts.
${memoryContext}`;

    const { text, model: usedModel } = await callLLM({
      role: 'chat',
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...recent.map(m => ({ role: m.role, content: m.content })),
      ],
    });

    // 5. Save assistant's reply
    await memory.addMessage(req.userId, sessionId, 'assistant', text);

    // 6. Trigger non-blocking background weekly chat summarizer job
    memoryManager.summarizeUserSessions(req.userId).catch(err => console.error('Background summary error:', err));

    res.json({ reply: text, model: usedModel });
  } catch (err) {
    res.status(500).json({ error: 'LLM call failed', details: err.message });
  }
});

module.exports = router;
