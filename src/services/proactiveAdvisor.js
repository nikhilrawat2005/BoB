const { callLLM } = require('./llmService');
const memory = require('./memoryService');

/**
 * Proactive Advisor Service
 * Enables Bob to self-initiate guidance, career suggestions, and next steps
 */

async function generateProactiveGreeting(userId, userEmail) {
  try {
    const facts = await memory.listFacts(userId);
    const summaries = await memory.listWeeklySummaries(userId);

    const memoryContext = [
      facts.length ? `Known Master Facts & Habits: ${facts.map(f => f.text).join('; ')}` : '',
      summaries.length ? `Recent Weekly Focus: ${summaries[0]?.summary || ''}` : ''
    ].filter(Boolean).join('\n');

    const prompt = `You are Bob, Master Nikhil's proactive AI assistant.
Master Nikhil just opened the app. Generate a short, enthusiastic, proactive welcome greeting (2-3 sentences max).
Include:
1. Warm greeting to Master Nikhil.
2. A proactive suggestion or next-step recommendation based on his recent work and goals.

Memory Context:
${memoryContext}`;

    const { text } = await callLLM({
      role: 'chat',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.7,
    });

    return text;
  } catch (err) {
    console.error('generateProactiveGreeting error:', err.message);
    return `Hello Master Nikhil! I'm online and ready. How can I assist you with your projects today?`;
  }
}

module.exports = {
  generateProactiveGreeting,
};
