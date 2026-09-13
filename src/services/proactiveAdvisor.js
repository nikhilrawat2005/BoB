const { callLLM } = require('./llmService');
const memory = require('./memoryService');
const memoryManager = require('./memoryManager');
const weather = require('./weatherService');
const news = require('./newsService');
const stocks = require('./stocksService');

/**
 * Proactive Advisor Service
 * Enables Bob to self-initiate guidance, career suggestions, and next steps.
 */

async function generateProactiveGreeting(userId, userEmail) {
  try {
    const currentMonthId = memoryManager.isoMonthKey(new Date());
    const [facts, monthText, liveResult] = await Promise.allSettled([
      memory.listFacts(userId),
      memory.getMonthMemoryText(userId, currentMonthId),
      fetchLiveContext(),
    ]);

    const factsArr = facts.status === 'fulfilled' ? facts.value : [];
    const monthMemory = monthText.status === 'fulfilled' ? monthText.value : null;
    const liveContext = liveResult.status === 'fulfilled' ? liveResult.value : null;

    const memoryContext = [
      factsArr.length ? `Known Master Facts & Habits: ${factsArr.map(f => f.text).join('; ')}` : '',
      monthMemory ? `Current Month Memory (${currentMonthId}): ${monthMemory}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `You are Bob, Master Nikhil's personal AI assistant.
Master Nikhil just opened the app. Generate a short, warm, proactive welcome greeting (2-3 sentences max).
Rules:
1. Greet Master Nikhil warmly by name.
2. ${liveContext ? 'Naturally weave in ONE line from the Live Context below (weather or market or a news headline) that feels most relevant today, then add a motivating suggestion based on Memory Context.' : 'Offer a motivating suggestion based on Memory Context.'}
3. Keep it concise and natural — no bullet points, no lists. Use exact numbers from Live Context only.

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

module.exports = {
  generateProactiveGreeting,
};