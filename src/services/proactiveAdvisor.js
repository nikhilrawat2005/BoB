const { callLLM } = require('./llmService');
const memory = require('./memoryService');

/**
 * Proactive Advisor Service
 * Enables Bob to self-initiate guidance, career suggestions, and next steps
 * Also checks Secret Vault for upcoming dates and injects subtle coded hints.
 */

/**
 * Checks secret vault notes for any upcoming event dates within N days.
 * Returns a discreet hint string without revealing raw note content.
 */
function buildVaultHint(secretNotes) {
  if (!secretNotes.length) return '';

  const now = Date.now();
  const upcomingNotes = [];

  for (const note of secretNotes) {
    if (!note.eventDate) continue;

    // eventDate is stored as an ISO string e.g. "2026-08-05"
    const eventMs = new Date(note.eventDate).getTime();
    const diffDays = Math.ceil((eventMs - now) / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays <= 7) {
      upcomingNotes.push(diffDays);
    }
  }

  // Build subtle hint based on how soon the nearest event is
  if (upcomingNotes.length > 0) {
    const nearest = Math.min(...upcomingNotes);
    if (nearest === 0) {
      return `[SUBTLE VAULT REMINDER — PRIVACY STRICT]: Master Nikhil has a personal priority marked for TODAY in his Secret Vault. ONLY mention: "Master Nikhil, there's an important personal reminder for today — please check your Secret Vault." Do NOT reveal any names or note details.`;
    } else if (nearest === 1) {
      return `[SUBTLE VAULT REMINDER — PRIVACY STRICT]: Master Nikhil has a personal event TOMORROW in his Secret Vault. ONLY mention: "Master Nikhil, an important personal date is coming up tomorrow — check your Secret Vault." Do NOT reveal any names or note details.`;
    } else {
      return `[SUBTLE VAULT REMINDER — PRIVACY STRICT]: Master Nikhil has a personal event in ${nearest} days in his Secret Vault. ONLY mention: "Master Nikhil, a personal priority is approaching in ${nearest} days — check your Secret Vault." Do NOT reveal any names or note details.`;
    }
  }

  // Notes exist but none are immediately upcoming — give a general reminder
  return `[SUBTLE VAULT NOTE]: Master Nikhil has ${secretNotes.length} private ${secretNotes.length === 1 ? 'entry' : 'entries'} in his Secret Vault. Optionally mention: "Master Nikhil, your Secret Vault has personal reminders saved — feel free to review them." Do NOT reveal any names or raw note details.`;
}

async function generateProactiveGreeting(userId, userEmail) {
  try {
    const facts = await memory.listFacts(userId);
    const summaries = await memory.listWeeklySummaries(userId);
    const secretNotes = await memory.listSecretNotes(userId);

    const vaultHint = buildVaultHint(secretNotes);

    const memoryContext = [
      facts.length ? `Known Master Facts & Habits: ${facts.map(f => f.text).join('; ')}` : '',
      summaries.length ? `Recent Weekly Focus: ${summaries[0]?.summary || ''}` : '',
      vaultHint
    ].filter(Boolean).join('\n');

    const prompt = `You are Bob, Master Nikhil's personal AI assistant.
Master Nikhil just opened the app. Generate a short, warm, proactive welcome greeting (2-3 sentences max).
Rules:
1. Greet Master Nikhil warmly by name.
2. If there is a SUBTLE VAULT REMINDER in Memory Context, mention it EXACTLY as instructed — do NOT change the wording, do NOT reveal sensitive details.
3. Otherwise, offer a motivating suggestion based on Memory Context.
4. Keep it concise and natural — no bullet points, no lists.

Memory Context:
${memoryContext || 'No context available yet.'}`;

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
