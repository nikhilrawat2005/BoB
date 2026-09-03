const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
const memory = require('../services/memoryService');
const memoryManager = require('../services/memoryManager');
const weather = require('../services/weatherService');
const news = require('../services/newsService');
const stocks = require('../services/stocksService');
const discovery = require('../services/hackathonDiscoveryService');

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

// GET /api/live/pulse?city= — Combined Weather + News + Stocks in one call
router.get('/pulse', requireAuth, async (req, res) => {
  try {
    const city = req.query.city || process.env.DEFAULT_CITY || 'New Delhi';
    const [wRes, nRes, sRes] = await Promise.allSettled([
      weather.getWeatherForCity(city),
      news.getNews('tech', 5),
      stocks.getQuotes(null),
    ]);

    const weatherData = wRes.status === 'fulfilled' ? wRes.value : null;
    const newsData = nRes.status === 'fulfilled' ? nRes.value : [];
    const stocksData = sRes.status === 'fulfilled' ? sRes.value : [];

    res.json({
      weather: weatherData,
      news: newsData,
      stocks: stocksData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // 0. Close out any stale months (runs daily via this job even if user doesn't chat)
    await memoryManager.finalizeStaleMonths(userId).catch(() => {});

    // 1. Gather live data in parallel — any failure is tolerated.
    const [weatherRes, newsRes, stocksRes] = await Promise.allSettled([
      weather.getWeatherForCity(defaultCity),
      news.getNews('top', 5),
      stocks.getQuotes(null),
    ]);

    const weatherLine = weatherRes.status === 'fulfilled' ? weather.formatWeather(weatherRes.value) : null;
    const newsLines = newsRes.status === 'fulfilled' ? news.formatNews(newsRes.value) : null;
    const marketLine = stocksRes.status === 'fulfilled' ? stocks.formatQuotes(stocksRes.value) : null;

    // 2. Pull Master's memory context (facts + current-month memory)
    const currentMonthId = memoryManager.isoMonthKey(new Date());
    const [facts, monthText, sessions] = await Promise.all([
      memory.listFacts(userId).catch(() => []),
      memory.getMonthMemoryText(userId, currentMonthId).catch(() => null),
      memory.listSessions(userId).catch(() => []),
    ]);

    const memoryContext = [
      facts.length ? `Known facts & habits: ${facts.map(f => f.text).join('; ')}` : '',
      monthText ? `Current month memory (${currentMonthId}):\n${monthText}` : '',
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

// ─────────────────────────────────────────────────────────
// Hackathon Discovery Radar (Live Pulse section)
// ─────────────────────────────────────────────────────────

// GET /api/live/hackathon-discovery — list active (non-expired, non-dismissed) discovery cards
router.get('/hackathon-discovery', requireAuth, async (req, res) => {
  try {
    const items = await discovery.listDiscovery(req.userId);
    const meta = await discovery.getDiscoveryMeta(req.userId);
    res.json({ items, meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/live/hackathon-discovery/run — manually trigger a discovery run
router.post('/hackathon-discovery/run', requireAuth, async (req, res) => {
  try {
    const result = await discovery.runDiscovery(req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/live/hackathon-discovery/:id/save — save card to hackathons list
router.post('/hackathon-discovery/:id/save', requireAuth, async (req, res) => {
  try {
    const participating = Boolean(req.body?.participating);
    const hackathon = await discovery.saveDiscovery(req.userId, req.params.id, participating);
    res.json({ hackathon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/live/hackathon-discovery/:id/dismiss — dismiss forever
router.post('/hackathon-discovery/:id/dismiss', requireAuth, async (req, res) => {
  try {
    await discovery.dismissDiscovery(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/live/hackathon-discovery/toggle — pause or resume auto-discovery
// Body: { enable: true | false }
router.post('/hackathon-discovery/toggle', requireAuth, async (req, res) => {
  try {
    const enable = req.body?.enable !== false; // default true if not specified
    const result = await discovery.toggleDiscovery(req.userId, enable);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
