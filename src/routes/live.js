const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
const memory = require('../services/memoryService');
const weather = require('../services/weatherService');
const news = require('../services/newsService');
const stocks = require('../services/stocksService');

// ─────────────────────────────────────────────────────────
// GET /api/live/weather?city=   — Live weather for a city
// GET /api/live/news?category=  — Top headlines (top/india/world/tech/sports/business)
// GET /api/live/stocks?symbols= — Indian market quotes (comma separated)
// ─────────────────────────────────────────────────────────

router.get('/weather', requireAuth, async (req, res) => {
  try {
    const city = req.query.city || process.env.DEFAULT_CITY || 'New Delhi';
    const w = await weather.getWeatherForCity(city);
    res.json({ ...w, summary: weather.formatWeather(w) });
  } catch (err) {
    res.status(502).json({ error: 'Weather fetch failed', details: err.message });
  }
});

router.get('/news', requireAuth, async (req, res) => {
  try {
    const category = req.query.category || 'top';
    const limit = Math.min(parseInt(req.query.limit) || 5, 10);
    const headlines = await news.getNews(category, limit);
    res.json({ category, headlines });
  } catch (err) {
    res.status(502).json({ error: 'News fetch failed', details: err.message });
  }
});

router.get('/stocks', requireAuth, async (req, res) => {
  try {
    const quotes = await stocks.getQuotes(req.query.symbols);
    res.json({ quotes, summary: stocks.formatQuotes(quotes) });
  } catch (err) {
    res.status(502).json({ error: 'Market fetch failed', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/live/briefing — Daily self-briefing
// Called each morning by the GitHub Actions workflow
// (.github/workflows/briefing.yml). Generates a briefing message
// with live weather + market + news, saves it into Master Nikhil's
// latest chat session, and pushes a notification.
// Auth: CRON_SECRET bearer if set, else normal Firebase auth.
// ─────────────────────────────────────────────────────────
function cronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (cronSecret) {
    if (provided === cronSecret) return next();
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }
  return requireAuth(req, res, next);
}

router.post('/briefing', cronAuth, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const defaultCity = process.env.DEFAULT_CITY || 'New Delhi';

    // 1. Gather live data in parallel — any failure is tolerated.
    const [weatherRes, newsRes, stocksRes] = await Promise.allSettled([
      weather.getWeatherForCity(defaultCity),
      news.getNews('top', 5),
      stocks.getQuotes(null),
    ]);

    const weatherLine = weatherRes.status === 'fulfilled' ? weather.formatWeather(weatherRes.value) : null;
    const newsLines = newsRes.status === 'fulfilled' ? news.formatNews(newsRes.value) : null;
    const marketLine = stocksRes.status === 'fulfilled' ? stocks.formatQuotes(stocksRes.value) : null;

    // 2. Pull Master's memory context
    const [facts, summaries, sessions] = await Promise.all([
      memory.listFacts(userId).catch(() => []),
      memory.listWeeklySummaries(userId).catch(() => []),
      memory.listSessions(userId).catch(() => []),
    ]);

    const memoryContext = [
      facts.length ? `Known facts & habits: ${facts.map(f => f.text).join('; ')}` : '',
      summaries.length ? `Recent weekly focus: ${summaries[0]?.summary || ''}` : '',
    ].filter(Boolean).join('\n');

    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });

    // 3. Generate the briefing
    const systemMsg = `You are Bob, Master Nikhil's personal AI assistant. This is your AUTONOMOUS DAILY MORNING BRIEFING.
Be warm, concise, and structured. Use the OUTPUT STYLE rules (bold key terms, short sections, one emoji per section, blank lines between sections).
Produce: (1) one-line greeting, (2) 🌦️ Weather for ${weatherLine ? 'today' : ''}, (3) 📈 Market snapshot (Nifty/Sensex change), (4) 📰 Top 3 news headlines with one-line summaries, (5) 🔥 Today's focus suggestion based on Master's facts/plans.
Use ONLY the exact live numbers given — never invent prices/temperatures. If live data is missing, say "live data ish samay unavailable tha" and move on.
Keep the whole briefing under 350 words.
Context about Master Nikhil:\n${memoryContext || 'No extra context yet.'}`;

    const userMsg = `Generate today's morning briefing.
Current date (IST): ${nowIST}
🌦️ WEATHER: ${weatherLine || 'unavailable'}
📈 MARKET: ${marketLine || 'unavailable'}
📰 HEADLINES:\n${newsLines || 'unavailable'}`;

    const { text } = await callLLM({
      role: 'writer',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.6,
      max_tokens: 3000,
    });

    // 4. Save into the latest session (so it appears in the chat) + notify
    const latestSession = sessions && sessions.length ? sessions[0] : null;
    if (latestSession) {
      await memory.addMessage(userId, latestSession.id, 'assistant', text);
    }
    await memory.addNotification(
      userId,
      '🌅 Daily Briefing',
      'Good morning Master Nikhil! Tap to read your weather, market & news briefing.',
      'reminder',
      text
    );

    res.json({ ok: true, savedToSession: latestSession ? latestSession.id : null });
  } catch (err) {
    console.error('[Briefing] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
