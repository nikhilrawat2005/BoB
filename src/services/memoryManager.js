const { callLLM } = require('./llmService');
const memory = require('./memoryService');

/**
   Multi-LLM Memory Manager Service
   Handles:
   1. Intermediary Routing (Detects if user asks about past chats/summaries or sets new rules)
   2. Auto Memory/Fact Extraction
   3. Weekly Chat Summarization
 */

/**
 * Intermediary Router: Classifies user prompt intent
 */
async function classifyIntent(message) {
  try {
    const prompt = `Analyze the following message from Master Nikhil.
Determine:
1. Is he asking about past chats, weekly summaries, or historical discussions? (isHistoryQuery: true/false)
2. Is he stating a fact, preference, or rule to remember? (isNewFact: true/false)

Message: "${message}"

Respond strictly in valid JSON format:
{ "isHistoryQuery": boolean, "isNewFact": boolean, "extractedFact": string or null }`;

    const { text } = await callLLM({
      role: 'router',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.1,
    });

    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return parsed;
  } catch (err) {
    console.error('Intermediary router error:', err.message);
    return { isHistoryQuery: false, isNewFact: false, extractedFact: null };
  }
}

/**
 * Background Auto-Summarizer for Weekly Chats
 */
async function summarizeUserSessions(userId) {
  try {
    const sessions = await memory.listSessions(userId);
    if (!sessions || !sessions.length) return null;

    let fullTranscript = '';
    // Collect recent 5 active sessions
    for (const sess of sessions.slice(0, 5)) {
      const msgs = await memory.getRecentMessages(userId, sess.id, 30);
      if (msgs.length) {
        fullTranscript += `\n--- Session: ${sess.title || 'Chat'} ---\n`;
        msgs.forEach(m => {
          fullTranscript += `${m.role.toUpperCase()}: ${m.content}\n`;
        });
      }
    }

    if (!fullTranscript.trim()) return null;

    const summaryPrompt = `You are Bob's Memory Manager LLM.
Summarize the following chat history from Master Nikhil into structured, high-value bullet pointers and key decisions.
Do NOT lose any important instructions, preferences, tech decisions, or account details.

Chat History:
${fullTranscript}

Format: Return a concise summary with Key Pointers & Key Decisions.`;

    const { text } = await callLLM({
      role: 'memorySummarize',
      messages: [{ role: 'system', content: summaryPrompt }],
      temperature: 0.2,
    });

    // Save current week summary
    const now = new Date();
    const weekId = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
    await memory.saveWeeklySummary(userId, weekId, { summary: text });
    return text;
  } catch (err) {
    console.error('Background summarizer error:', err.message);
    return null;
  }
}

module.exports = {
  classifyIntent,
  summarizeUserSessions,
};
