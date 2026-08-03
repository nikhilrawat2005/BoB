const { callLLM } = require('./llmService');
const memory = require('./memoryService');
const memoryManager = require('./memoryManager');
const weather = require('./weatherService');
const news = require('./newsService');
const stocks = require('./stocksService');

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
    const currentMonthId = memoryManager.isoMonthKey(new Date());
    const [facts, monthText, secretNotes, liveResult] = await Promise.allSettled([
      memory.listFacts(userId),
      memory.getMonthMemoryText(userId, currentMonthId),
      memory.listSecretNotes(userId),
      fetchLiveContext(),
    ]);

    const factsArr = facts.status === 'fulfilled' ? facts.value : [];
    const monthMemory = monthText.status === 'fulfilled' ? monthText.value : null;
    const secretNotesArr = secretNotes.status === 'fulfilled' ? secretNotes.value : [];
    const liveContext = liveResult.status === 'fulfilled' ? liveResult.value : null;

    const vaultHint = buildVaultHint(secretNotesArr);

    const memoryContext = [
      factsArr.length ? `Known Master Facts & Habits: ${factsArr.map(f => f.text).join('; ')}` : '',
      monthMemory ? `Current Month Memory (${currentMonthId}): ${monthMemory}` : '',
      vaultHint
    ].filter(Boolean).join('\n');

    const prompt = `You are Bob, Master Nikhil's personal AI assistant.
Master Nikhil just opened the app. Generate a short, warm, proactive welcome greeting (2-3 sentences max).
Rules:
1. Greet Master Nikhil warmly by name.
2. If there is a SUBTLE VAULT REMINDER in Memory Context, mention it EXACTLY as instructed — do NOT change the wording, do NOT reveal sensitive details.
3. ${liveContext ? 'Otherwise, naturally weave in ONE line from the Live Context below (weather or market or a news headline) that feels most relevant today, then add a motivating suggestion based on Memory Context.' : 'Otherwise, offer a motivating suggestion based on Memory Context.'}
4. Keep it concise and natural — no bullet points, no lists. Use exact numbers from Live Context only.

Live Context (fetched just now — exact values, do not invent):
${liveContext || 'No live context available.'}

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

/**
 * Fetch a compact live line for the greeting (weather + market + top headline).
 * Tolerates any failure — returns null if nothing is available.
 */
async function fetchLiveContext() {
  const defaultCity = process.env.DEFAULT_CITY || 'New Delhi';
  const [w, n, s] = await Promise.allSettled([
    weather.getWeatherForCity(defaultCity),
    news.getNews('top', 1),
    stocks.getQuotes(['^NSEI', '^BSESN']),
  ]);

  const parts = [];
  if (w.status === 'fulfilled') {
    const line = weather.formatWeather(w.value);
    if (line) parts.push(`🌦️ Weather: ${line}`);
  }
  if (s.status === 'fulfilled') {
    const line = stocks.formatQuotes(s.value);
    if (line) parts.push(`📈 Market: ${line}`);
  }
  if (n.status === 'fulfilled' && n.value && n.value.length) {
    parts.push(`📰 Top headline: ${n.value[0].title}`);
  }
  return parts.length ? parts.join('\n') : null;
}

async function checkAndGenerateNotifications(userId) {
  try {
    const secretNotes = await memory.listSecretNotes(userId);
    const existingNotifs = await memory.listNotifications(userId);
    const existingTitles = new Set(existingNotifs.map(n => n.title));

    const now = Date.now();

    for (const note of secretNotes) {
      if (!note.eventDate) continue;

      const eventMs = new Date(note.eventDate).getTime();
      const diffDays = Math.ceil((eventMs - now) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= 7) {
        const notifTitle = `Vault Reminder (${note.eventDate})`;
        if (!existingTitles.has(notifTitle)) {
          const timeMsg = diffDays === 0 ? "today!" : diffDays === 1 ? "tomorrow" : `in ${diffDays} days`;
          const snippet = note.noteText.length > 30 ? note.noteText.slice(0, 30) + "..." : note.noteText;
          await memory.addNotification(
            userId,
            notifTitle,
            `Master Nikhil, a secret vault date is approaching ${timeMsg}!`,
            'vault',
            `Master Nikhil, regarding my Secret Vault reminder for ${timeMsg}: '${snippet}', let's discuss this!`
          );
        }
      }
    }
  } catch (err) {
    console.error('checkAndGenerateNotifications error:', err.message);
  }
}

module.exports = {
  generateProactiveGreeting,
  checkAndGenerateNotifications
};
