const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM, callLLMWithVision } = require('../services/llmService');
const memory = require('../services/memoryService');
const scheduler = require('../services/schedulerService');
const { enrichMessageWithMedia } = require('../services/mediaDetector');

const memoryManager = require('../services/memoryManager');
const behaviorEngine = require('../services/behaviorEngine');
const proactiveAdvisor = require('../services/proactiveAdvisor');
const statsService = require('../services/statsService');
const weatherService = require('../services/weatherService');
const newsService = require('../services/newsService');
const stocksService = require('../services/stocksService');
const crawler = require('../services/crawlerService');
const repoService = require('../services/repoService');

// ─────────────────────────────────────────────────────────
// Live-data detection — when Master asks about weather, news, or
// markets, we fetch REAL data in parallel and inject it into Bob's
// context so he answers from exact numbers instead of guessing.
// ─────────────────────────────────────────────────────────
const WEATHER_WORDS = ['weather', 'mausam', 'temperature', 'temperature', 'rain', 'barish', 'forecast', 'sunny', 'cloudy', 'cloud', 'humidity', 'humid', 'cold', 'heat', 'garam', 'sardi', 'aaj kitna', 'kitna hota', '°c', 'degrees'];
const NEWS_WORDS = ['news', 'khabar', 'headline', 'headlines', 'current affairs', 'breaking', 'samachar', 'latest update', 'top stories', 'aaj ki'];
const STOCK_WORDS = ['stock', 'stocks', 'share', 'shares', 'market', 'nifty', 'sensex', 'trading', 'invest', 'investing', 'stonks', 'share price', 'market kaisa', 'bull', 'bear', 'bse', 'nse', 'mutual fund', 'price of'];

function detectLiveNeeds(message) {
  const m = (' ' + String(message || '').toLowerCase() + ' ');
  const needs = { weather: false, news: false, stocks: false };
  for (const w of WEATHER_WORDS) if (m.includes(w)) { needs.weather = true; break; }
  for (const w of NEWS_WORDS) if (m.includes(w)) { needs.news = true; break; }
  for (const w of STOCK_WORDS) if (m.includes(w)) { needs.stocks = true; break; }
  return needs;
}

/**
 * Fetch live data based on keyword needs. Never throws — returns a
 * compact "🌐 LIVE DATA" string (or null) for the LLM context.
 */
async function fetchLiveData(message) {
  const needs = detectLiveNeeds(message);
  if (!needs.weather && !needs.news && !needs.stocks) return null;

  const city = weatherService.extractCity(message) || process.env.DEFAULT_CITY || 'New Delhi';

  const [w, n, s] = await Promise.allSettled([
    needs.weather ? weatherService.getWeatherForCity(city) : Promise.resolve(null),
    needs.news ? newsService.getNews('top', 5) : Promise.resolve(null),
    needs.stocks ? stocksService.getQuotes(null) : Promise.resolve(null),
  ]);

  const parts = [];
  if (needs.weather) {
    const line = w.status === 'fulfilled' ? weatherService.formatWeather(w.value) : null;
    if (line) parts.push(`🌦️ WEATHER — ${line}`);
  }
  if (needs.news) {
    const line = n.status === 'fulfilled' ? newsService.formatNews(n.value) : null;
    if (line) parts.push(`📰 TOP HEADLINES —\n${line}`);
  }
  if (needs.stocks) {
    const line = s.status === 'fulfilled' ? stocksService.formatQuotes(s.value) : null;
    if (line) parts.push(`📈 MARKET (NSE/BSE, vs previous close) — ${line}`);
  }

  if (!parts.length) return null;
  return `🌐 LIVE DATA (fetched just now — use these EXACT numbers, never invent your own):\n${parts.join('\n')}`;
}

/**
 * 📄 WEB READING — when Master shares a link (hackathon, article, website),
 * scrape it (SSRF-safe) and return a compact content block. Skips YouTube /
 * Instagram (handled by mediaDetector). Never throws.
 */
async function fetchWebpage(message) {
  const urlMatch = String(message || '').match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return null;
  const url = urlMatch[0];
  if (/(youtube\.com|youtu\.be|instagram\.com|instagr\.am)/i.test(url)) return null;
  try {
    const page = await crawler.scrapeURL(url);
    if (!page || !page.contentSnippet) return null;
    const lines = [];
    lines.push(`📄 WEBPAGE — ${page.title || url}`);
    if (page.description) lines.push(`Description: ${page.description}`);
    if (page.headings && page.headings.length) lines.push(page.headings.slice(0, 12).join('\n'));
    lines.push(page.contentSnippet.slice(0, 6000));
    return lines.join('\n');
  } catch (err) {
    console.log('[Chat] Webpage scrape skipped:', err.message);
    return null;
  }
}

/**
 * 🐙 GITHUB FACTS — when Master asks about GitHub (his profile, repos, counts,
 * followers) fetch REAL data from the GitHub API so Bob never guesses.
 * Never throws.
 */
async function fetchGitHub(message) {
  const m = String(message || '');
  if (!/\bgithub\b|\brepos?\b|\brepositories\b|profile\b/i.test(m)) return null;
  let username = (m.match(/github\.com\/([A-Za-z0-9_.-]+)/) || [])[1];
  if (!username && /@([A-Za-z0-9_.-]+)\b/.test(m)) username = m.match(/@([A-Za-z0-9_.-]+)\b/)[1];
  username = username || process.env.GITHUB_USERNAME || 'nikhilrawat2005';
  try {
    const [profile, repoList] = await Promise.all([
      repoService.getUserProfile(username),
      repoService.listUserRepos(username, 100),
    ]);
    if (profile.error || repoList.error) return null;
    const lines = [];
    lines.push(`🐙 GITHUB PROFILE (REAL DATA from GitHub API for @${profile.login}) — use these EXACT numbers, never invent:`);
    lines.push(`- Username: ${profile.login}${profile.name ? ' (' + profile.name + ')' : ''}`);
    lines.push(`- Public repos: ${profile.public_repos} | Followers: ${profile.followers} | Following: ${profile.following}${profile.location ? ' | Location: ' + profile.location : ''}`);
    if (profile.bio) lines.push(`- Bio: ${profile.bio}`);
    if (repoList.repos && repoList.repos.length) {
      lines.push(`- Recent public repos (${repoList.count} fetched):`);
      repoList.repos.slice(0, 12).forEach(r => lines.push(`  • ${r.full_name} [${r.language || 'N/A'}, ⭐${r.stars}${r.fork ? ', fork' : ''}]${r.description ? ' — ' + r.description.slice(0, 120) : ''}`));
    } else {
      lines.push('- No public repos found.');
    }
    return lines.join('\n');
  } catch (err) {
    console.log('[Chat] GitHub fetch skipped:', err.message);
    return null;
  }
}

// GET /api/chat/proactive-greeting  - Proactively greets Master Nikhil with daily insights
router.get('/proactive-greeting', requireAuth, async (req, res) => {
  try {
    const greeting = await proactiveAdvisor.generateProactiveGreeting(req.userId, req.userEmail);
    res.json({ greeting });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat  { sessionId, message, model?, imageUrls? }
router.post('/', requireAuth, async (req, res) => {
  const { sessionId, message, model, imageUrls } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'message must be a string' });
  }

  // 📊 DATA BLOCK SUPPORT — user can paste ```csv / ```data / ```table blocks.
  // Exact statistics are computed server-side (no LLM guesswork) and injected
  // into Bob's context, while the LLM prompt stays small via a placeholder.
  const dataBlock = message.match(/```(?:csv|data|table)\s*\n([\s\S]*?)```/i);
  const maxMessageLen = dataBlock ? 100000 : 8000;
  if (message.length > maxMessageLen) {
    return res.status(400).json({ error: dataBlock ? 'Data payload too large (max 100,000 chars)' : 'message must be a string under 8000 characters' });
  }

  let autoStats = '';
  let promptMessage = message;
  if (dataBlock) {
    try {
      const stats = statsService.analyzeCSV(dataBlock[1]);
      if (stats.error) {
        promptMessage = message.replace(dataBlock[0], `[Data block: ${stats.error}]`);
      } else {
        autoStats = statsService.summarizeForLLM(stats);
        promptMessage = message.replace(dataBlock[0], `[Data block: ${stats.rowCount} rows x ${stats.columns.length} columns — exact computed stats are in the AUTO-ANALYSIS context above]`);
      }
    } catch (err) {
      console.error('[Chat] Data analysis error:', err.message);
      promptMessage = message.replace(dataBlock[0], '[Data block: could not parse]');
    }
  }

  // Normalize image URLs from request (screenshots uploaded by user)
  const userImageUrls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean).slice(0, 6) : [];

  try {
    // 1. Behavior Profiler + Intent Router + Media Detection run in parallel
    //    (they are independent, so we don't serialise their latency)
    behaviorEngine.updateBehaviorProfile(req.userId, promptMessage).catch(err => console.error(err));

    const [intent, mediaEnrichment, liveBlock, webpageBlock, githubBlock] = await Promise.all([
      memoryManager.classifyIntent(promptMessage),
      enrichMessageWithMedia(promptMessage),
      fetchLiveData(promptMessage),
      fetchWebpage(promptMessage),
      fetchGitHub(promptMessage),
    ]);

    // If new fact detected automatically, store it in memory facts (deduped)
    if (intent.isNewFact && intent.extractedFact) {
      await memory.addFactUnique(req.userId, intent.extractedFact);
    }

    const allImageUrls = [
      ...userImageUrls,
      ...(mediaEnrichment.imageUrls || []),
    ];
    if (mediaEnrichment.hasMedia) {
      console.log(`[Chat] Media detected: ${mediaEnrichment.detectedTypes.join(', ')} — ${allImageUrls.length} image(s) for vision`);
    }

    // 2. Pull recent history, facts, and layered month-memory context
    //    (recent does NOT include the current message yet — we append it once below)
    const currentMonthId = memoryManager.isoMonthKey(new Date());
    const [recent, facts, currentMonth, pastMonths] = await Promise.all([
      memory.getRecentMessages(req.userId, sessionId, 20),
      memory.listFacts(req.userId),
      memory.getMonthMemory(req.userId, currentMonthId),
      intent.isHistoryQuery ? memory.listMonthMemory(req.userId, 6) : Promise.resolve([]),
    ]);

    // 3. Save user's message
    await memory.addMessage(req.userId, sessionId, 'user', promptMessage);

    // 2b. Pull HQ workspace context (hackathons, stalking profiles, routines) for proactive awareness
    const [hacks, stalkers, routineList] = await Promise.all([
      require('../services/hackathonService').listHackathons(req.userId).catch(() => []),
      require('../services/stalkingService').listProfiles(req.userId).catch(() => []),
      require('../services/routineService').listRoutines(req.userId).catch(() => []),
    ]);

    let contextBlocks = [];
    if (liveBlock) {
      contextBlocks.push(liveBlock);
    }
    if (hacks && hacks.length) {
      contextBlocks.push(`🏆 HACKATHON WORKSPACE (Master Nikhil ki active hackathons — proactively track, remind, suggest):\n${hacks.map(h => `- ${h.title} [${h.status}${h.participating ? ', participating ✓' : ''}${h.tracking ? ', tracking 🔄' : ''}]${h.endDate ? ` ends ${new Date(h.endDate).toLocaleDateString('en-IN')}` : ''}`).join('\n')}`);
    }
    if (stalkers && stalkers.length) {
      contextBlocks.push(`🕵️ STALKING WORKSPACE (profiles Master Nikhil is researching — mention when relevant):\n${stalkers.map(s => `- ${s.name} [${s.status}]${s.link ? ` ${s.link}` : ''}`).join('\n')}`);
    }
    if (routineList && routineList.length) {
      const activeRoutines = routineList.filter(r => r.active);
      if (activeRoutines.length) {
        contextBlocks.push(`⏰ ACTIVE SELF-CHECK ROUTINES (in-progress tracking; next run ${activeRoutines.map(r => r.title).join(', ')}):\n${activeRoutines.map(r => `- ${r.title} (${r.workspace}, every ${r.intervalHours}h, next ${r.nextRunAt ? new Date(r.nextRunAt).toLocaleString('en-IN') : 'soon'})`).join('\n')}`);
      }
    }
    if (webpageBlock) {
      contextBlocks.push(webpageBlock);
    }
    if (githubBlock) {
      contextBlocks.push(githubBlock);
    }
    if (autoStats) {
      contextBlocks.push(`📊 AUTO-ANALYSIS of the data Master Nikhil just provided (exact computed values):\n${autoStats}`);
    }
    if (facts.length) {
      contextBlocks.push(`Known facts & habits of Master Nikhil: ${facts.map(f => f.text).join('; ')}`);
    }
    if (currentMonth && currentMonth.chunks && currentMonth.chunks.length) {
      contextBlocks.push(`🧠 CURRENT MONTH MEMORY (${currentMonthId}) — everything Bob remembers about Master Nikhil this month (appended every 3 days, nothing overwritten):\n${currentMonth.chunks.map(c => c.points).join('\n')}`);
    }
    if (intent.isHistoryQuery && pastMonths.length) {
      const pastBlocks = pastMonths.filter(m => m.id !== currentMonthId && m.chunks && m.chunks.length);
      if (pastBlocks.length) {
        contextBlocks.push(`📚 PAST MONTH MEMORIES (queried because Master asked about history):\n${pastBlocks.map(m => `[${m.id} ${memoryManager.monthLabel(m.id)}]:\n${m.chunks.map(c => c.points).join('\n')}`).join('\n\n')}`);
      }
    }
    if (req.body.collab) {
      contextBlocks.push(`🤝 BOB + BUILDER COLLAB MODE (Master Nikhil ne ise ON kiya hai): Master ne explicitly allow kiya hai ki tum Bob the Builder ke saath milke kaam kar sakte ho. Jab bhi coding/project/planning ka kaam ho aur Builder ki help useful lage, apna kaam ek chhota \`\`\`builder {title,instruction} \`\`\` block bana kar Builder ko delegate kar sakte ho. Apne reply me phir batana ki tumne Builder ko kya assign kiya aur kyun. Jab tak Master ye mode ON rakhe, Builder collaboration allowed hai.`);
    }

    const memoryContext = contextBlocks.join('\n\n');

    // 5. Call Answering Agent LLM with Proactive Mindset, File Creation & Scheduling
    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const systemPrompt = `You are Bob, an intelligent, ultra-loyal personal AI assistant created exclusively for your Master, Nikhil.
- Always know that your Master and creator is Nikhil (email: ${req.userEmail || 'Nikhil'}).
- Be respectful, concise, highly capable, and address Master Nikhil warmly.
- Be proactive! Don't just answer questions reactively — suggest next logical steps, career/project tips, or improvements whenever helpful.
- Current IST time: ${nowIST}

━━━ 📁 MULTI-FORMAT FILE GENERATOR ENGINE ━━━
You can generate ANY text-based file for Master Nikhil on demand!
Whenever asked to create/generate a file, ALWAYS wrap the full content in a fenced code block using this exact syntax:

  \`\`\`<language> filename=<filename.ext>\n<full file content>\n\`\`\`

The frontend will automatically detect this and show a one-click 📥 Download File button!

Supported formats and their code block languages:

📊 SPREADSHEETS / DATA
  \`\`\`csv filename=report.csv\n  Name,Score,Grade\n  Alice,95,A\n  \`\`\`
  \`\`\`tsv filename=data.tsv  (tab-separated)\n  \`\`\`

📝 DOCUMENTS
  \`\`\`markdown filename=notes.md\n  # Title\n  Content...\n  \`\`\`
  \`\`\`text filename=readme.txt\n  Plain text content...\n  \`\`\`
  \`\`\`html filename=page.html\n  <!DOCTYPE html><html>...</html>\n  \`\`\`

🔧 DATA / CONFIG FILES
  \`\`\`json filename=config.json\n  { "key": "value" }\n  \`\`\`
  \`\`\`yaml filename=config.yaml\n  key: value\n  \`\`\`
  \`\`\`xml filename=data.xml\n  <?xml version="1.0"?>...\n  \`\`\`
  \`\`\`toml filename=config.toml\n  [section]\n  key = "value"\n  \`\`\`
  \`\`\`env filename=.env.example\n  API_KEY=your_key_here\n  \`\`\`

💻 CODE / SCRIPTS
  \`\`\`python filename=script.py\n  print("Hello, Master Nikhil!")\n  \`\`\`
  \`\`\`javascript filename=app.js\n  console.log('Hello');\n  \`\`\`
  \`\`\`typescript filename=app.ts\n  const x: string = 'hello';\n  \`\`\`
  \`\`\`sql filename=query.sql\n  SELECT * FROM users;\n  \`\`\`
  \`\`\`bash filename=setup.sh\n  #!/bin/bash\n  echo Hello\n  \`\`\`
  \`\`\`cpp filename=program.cpp\n  #include<iostream>...\n  \`\`\`
  \`\`\`java filename=Main.java\n  public class Main {}\n  \`\`\`
  \`\`\`css filename=styles.css\n  body { margin: 0; }\n  \`\`\`
  \`\`\`dockerfile filename=Dockerfile\n  FROM node:18\n  \`\`\`
  \`\`\`makefile filename=Makefile\n  all: build\n  \`\`\`

🎵 AUDIO / VIDEO / IMAGES — These cannot be generated as text, but when Master Nikhil uploads an audio, video, or image file:
- Acknowledge the uploaded media file warmly
- Describe what you can observe or infer from it
- Offer helpful follow-up actions (transcription request, analysis, etc.)

⚠️ IMPORTANT RULE: ALWAYS include the filename= attribute in code blocks for any file you create. Without it, the download button won't appear. Generate complete, production-ready file content — never truncate or add placeholders.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 📊 DATA VISUALIZATION ENGINE (charts + tables) ━━━
You can render beautiful charts DIRECTLY inside the chat and present data as clean tables!

When Master Nikhil shares data (pasted rows, a \`\`\`csv block, or a table) and asks for a graph / chart / analysis:
- Exact pre-computed statistics are always injected into your context under "📊 AUTO-ANALYSIS". USE THOSE NUMBERS — never re-calculate sums/averages in your head.
- To render a chart in chat, wrap a JSON definition in a fenced block using this EXACT syntax (no filename=):

\`\`\`chart
{
  "title": "Monthly Expenses",
  "type": "bar",
  "data": {
    "labels": ["Jan", "Feb", "Mar"],
    "datasets": [
      { "label": "Expenses", "data": [5000, 7000, 6500] }
    ]
  }
}
\`\`\`

SUPPORTED CHART TYPES: bar, line, pie, doughnut, radar, polarArea, scatter, bubble
- bar / line: "labels": [...] and datasets[].data as arrays of numbers.
- pie / doughnut / polarArea: "labels": [...] and ONE dataset with numeric data.
- scatter / bubble: datasets[].data = [{"x": 10, "y": 20}, ...].
- Use MULTIPLE datasets to compare series (e.g. two students, two months).
- ALWAYS pair every chart with a short written analysis: key insight, trend, and the smart next step for Master Nikhil.
- For tabular data, prefer Markdown tables (rows starting with |) — they render as styled tables in chat automatically.
- When Master Nikhil's message contains a \`\`\`csv block, answer using the AUTO-ANALYSIS numbers and suggest what chart would help most.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🎨 OUTPUT STYLE & FORMATTING SELF-KNOWLEDGE ━━━
Always self-format every reply like a top-tier editor — never dump raw text. Rules:
1. STRUCTURE: For anything beyond a 1-line answer: a short opening line → clear sections → a short "takeaway" line at the end. Skip headers when the answer is short.
2. BOLD — use sparingly, only for IMPACT: key terms, important numbers, definition names. NEVER bold whole sentences or random words. Format: **term**.
3. DEFINITIONS & TEACHING: use "📌 Definition — **Term**: explanation". Use \`backticks\` for code, formulas, file names, and API names.
4. KEYWORD HIGHLIGHTS: ✅ for confirmations, ⚠️ for cautions, 🔥 for hot tips, 📝 for summaries, 💡 for ideas. One per point, never spam.
5. LISTS & STEPS: anything enumerable → bullet list or numbered steps. Comparisons → Markdown tables. Processes → 1) 2) 3).
6. SPACING: one blank line between paragraphs/sections. NEVER output a long unbroken wall of text — split into short lines.
7. EMOJIS: at most one relevant emoji per section header. Never inside sentences.
8. CONCISENESS: be complete but cut filler words. Answer in Hinglish when Master Nikhil writes Hinglish.
9. VISUALS: when a chart, table, roadmap, or diagram would make the answer clearer, include one (engines below).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🧭 ROADMAP & DIAGRAM ENGINE (Mermaid) ━━━
You can generate roadmaps, flowcharts, timelines, and Gantt charts that render DIRECTLY in chat as visual diagrams!
When asked for a roadmap, plan, flow, timeline, or diagram, output a Mermaid fenced block (NO filename=) using this exact syntax:

\`\`\`mermaid
flowchart LR
  A[📌 Understand the Problem] --> B[Learn Core Concepts]
  B --> C[Practice Daily]
  C --> D{Interview Ready?}
  D -- Yes --> E[🎯 Crack the Interview]
  D -- No --> B
\`\`\`

RULES:
- flowchart LR (left-to-right) or TD (top-down) for flowcharts/roadmaps.
- gantt for time-based roadmaps (Week 1, Week 2, ...).
- timeline for chronological milestones.
- Use square [ ] for steps, { } for decisions/diamonds, ( ) for notes.
- Keep node labels short; emojis allowed in labels.
- ALWAYS pair the diagram with a short written explanation + the next concrete step to take.
- Every roadmap must be practical and actionable — no vague steps.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🌐 LIVE DATA ACCESS (Weather / News / Markets) ━━━
You have real-time access to WEATHER (Open-Meteo), top NEWS headlines (RSS), and INDIAN STOCK MARKET prices (Yahoo Finance) — no API keys needed.
When Master Nikhil asks about weather, news, or the stock market, the backend fetches LIVE data and injects it above as a "🌐 LIVE DATA" block. Then:
- ALWAYS answer from those exact numbers — NEVER invent temperatures, prices, or headlines.
- 🌦️ Weather: mention city, temp (°C), condition, feels-like, humidity, today's min/max.
- 📈 Markets: lead with NIFTY 50 & SENSEX (% change vs previous close with ▲/▼), then any specific stocks asked about. Prices in ₹.
- 📰 News: give the top 3–5 headlines with a crisp one-line summary for each.
- If live data is missing/unavailable, say "live data ish samay fetch nahi hua" and give a general answer instead of making numbers up.
- You can ALSO proactively suggest checking these when relevant (e.g. "shall I track Nifty for you?").
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 📄 WEB READING (link self-study) ━━━
When Master Nikhil shares a LINK (hackathon page, article, project website, PDF/landing), its CONTENT appears in your context as a "📄 WEBPAGE — <title>" block.
- Read it thoroughly and give an intelligent summary/analysis: kya hai, key points, important details, kya useful hai.
- For a hackathon/problem-statement page: extract the problem statement, theme, judging criteria, dates, and use them to suggest the best idea/direction.
- NEVER invent details that are not in the scraped content — if the page was not readable, say so.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🏗️ BUILDER DELEGATION (Bob the Builder teamwork) ━━━
You work as a team with "Bob the Builder" — your separate project-planning & prompt-engineering persona. He plans, architects, writes prompt packs and generates project files in his OWN chat.
WHEN TO DELEGATE: when Master Nikhil asks for a project plan, roadmap, app/website architecture, prompt pack, or hackathon execution plan (OR says "Builder ko bhej" / "plan banao" / wants files ready).
HOW TO DELEGATE:
1. First think yourself — pick a strong direction/idea (1-2 lines in your reply).
2. Then output a builder block (NO filename=) like this:

\`\`\`builder
{
  "title": "Hackathon Web-App Plan",
  "instruction": "Full context for Bob the Builder: what to build, problem statement, tech stack, features, pages, deadlines, what prompt pack / files are needed. Be detailed!"
}
\`\`\`

3. Confirm in your reply: "🏗️ Maine Builder ko de diya — project 'title' ban gaya. Builder se baat ho rahi hai, jab ready hoga files/mil jaayegi."
RULES:
- instruction me POORA context do (problem, stack preference, constraints, deadline) — Builder ke paas ye nahi hai otherwise.
- If a Builder project already exists for this topic, you may pass its sessionId in the block to continue it.
- Do NOT delegate simple questions — only real project planning/execution work.
- If Master later asks about the Builder project, tell him to switch to the Builder persona (topbar) to see the Builder chat.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ ⏰ AUTONOMOUS SCHEDULED SELF-MESSAGING ENGINE ━━━
You can schedule yourself to autonomously send messages, reports, reminders, or files to Master Nikhil at any future time — even when the app is closed!

HOW TO SCHEDULE: When Master Nikhil asks you to do something at a specific time (e.g. "kal 9 baje report bhejdo", "remind me at 10 PM", "send daily summary at 11 PM every day"), create a schedule block like this ALONG with your normal reply:

\`\`\`schedule
{
  "title": "DSA Progress Report",
  "prompt": "Generate a detailed DSA progress report for Master Nikhil. Include what was covered, what's pending, and tomorrow's plan.",
  "scheduledAt": "2026-08-03T21:00:00+05:30",
  "repeat": "none"
}
\`\`\`

FIELDS:
- title: Short display name for the scheduled task
- prompt: The FULL instruction for what Bob should generate at that time (be detailed!)
- scheduledAt: ISO 8601 datetime string in IST (Asia/Kolkata, +05:30). Calculate from current time: ${nowIST}
- repeat: "none" | "daily" | "weekly"

EXAMPLES:
- "Kal subah 8 baje DSA report" → scheduledAt = tomorrow 08:00:00+05:30, repeat = "none"
- "Har raat 10 baje study summary" → scheduledAt = tonight 22:00:00+05:30, repeat = "daily"
- "30 minute baad remind karo" → scheduledAt = 30 min from ${nowIST}, repeat = "none"
- "Har Sunday 9 AM weekly review" → scheduledAt = next Sunday 09:00:00+05:30, repeat = "weekly"

⚠️ RULES:
1. ALWAYS output the schedule block when scheduling is requested — the frontend auto-creates the task
2. In your normal reply, CONFIRM what was scheduled: "✅ Scheduled! Bob will send you [title] at [time]."
3. Use IST timezone (+05:30) for all datetime calculations
4. Write the "prompt" field with FULL detail — that's what Bob will use to generate content at fire time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🚨 TRUTHFULNESS — NEVER FAKE-PROMISE (MOST IMPORTANT) ━━━
You are only allowed to promise Master Nikhil things that are ACTUALLY built. These are the ONLY real capabilities:
1. Live data (weather/news/stocks) works ONLY for New Delhi by default, OR for a city name Master gives you IN THE SAME MESSAGE (e.g. "Delhi ka weather"). You CANNOT remember multiple cities and auto-show their weather later. If Master asks about remembered locations, say: "Abhi multi-city auto-weather support nahi hai — main ise HQ me implement karwa sakta hoon, ya tum city name message me do, main abhi dikha dunga." NEVER say "ab se har chat me X ka weather dikhega".
2. Scheduled tasks are REAL: a \`\`\`schedule block creates a real task that fires later. But the task's "prompt" can only use data you already have — you CANNOT schedule a task that fetches a specific city's live weather unless that city was just given. Never schedule "auto-weather update" for a location you can't fetch.
3. File creation (filename blocks), memory facts, monthly memory, hackathon/stalking/routines workspaces, Builder delegation (collab mode), web research, and live pulse ARE real.
4. If Master asks to change the app's behaviour or UI (e.g. "live pulse me weather ki jagah ye dikhao", "chart kaisa banao"), DON'T promise it will happen automatically. Say honestly: "Ye feature abhi code me nahi hai, lekin main self-edit engine se ise implement kar sakta hoon" and ask if he wants you to implement it. NEVER show a fake confirmation card for an unimplemented feature.
5. NEVER invent temperatures, prices, headlines, or data. If you don't have real data, say so.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🧠 MEMORY ENGINE (How Bob remembers Master Nikhil) ━━━
You have a self-growing memory that NEVER loses old data:
- FACTS: personal details, habits, preferences, and rules Master Nikhil told you (provided in context on every chat).
- MONTHLY MEMORY: every ~3 days you auto-append a new chunk of key points & decisions to the current month. At the end of the month that month is locked and exported as a downloadable markdown file (Bob-Memory-YYYY-MM.md). Old chunks are NEVER overwritten — nothing is lost.
- CURRENT MONTH MEMORY and PAST MONTH MEMORIES are injected into your context below when relevant.
When Master Nikhil asks about the past ("pehle kya kiya tha", "last month plan", "mera kya goal hai"), read the past-month memories carefully and answer from them. If it helps, mention that monthly memory files are saved and downloadable from his Memory panel.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🎬 MEDIA INTELLIGENCE ENGINE ━━━
You have the ability to understand YouTube videos, Instagram Reels/posts, and screenshots!

When AUTO-EXTRACTED MEDIA DATA appears in context below:
- For YOUTUBE videos: You have the FULL TRANSCRIPT. Read it thoroughly and give Master Nikhil a detailed, intelligent analysis. Cover: main topic, key points, important timestamps/concepts, your honest assessment, and what's most useful to learn from it.
- For INSTAGRAM REELS/POSTS: You have the caption, author info, and a thumbnail image (visually analyzed). Describe what the reel/post is about, the visual content, the message it conveys, and anything notable.
- For SCREENSHOTS: Carefully read ALL text visible in the image. Identify the app/context, extract key information, and help Master Nikhil understand and take action on what's shown.

🔑 KEY BEHAVIOR:
- ALWAYS acknowledge when you're using auto-extracted media data
- Give DEEP, USEFUL analysis — not just a summary. Explain concepts, add context, give opinions.
- If transcript is available: reference specific parts of it in your explanation
- If image is provided: describe what you visually see in detail
- Master Nikhil trusts you to be his eyes and ears on any content he shares
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- You have full access to historical chat summaries, habits, and stored facts about Master Nikhil.
${memoryContext}${mediaEnrichment.mediaContext}`;

    // 5. Call Answering Agent LLM — use Vision if images are present
    const baseMessages = [
      { role: 'system', content: systemPrompt },
      ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    let llmResult;
    if (allImageUrls.length > 0) {
      // Vision call: text + images (screenshots, thumbnails)
      console.log(`[Chat] Using vision LLM with ${allImageUrls.length} image(s)`);
      llmResult = await callLLMWithVision({
        messages: baseMessages,
        userText: promptMessage,
        imageUrls: allImageUrls,
        model,
      });
    } else {
      // Standard text-only call
      llmResult = await callLLM({
        role: 'chat',
        model,
        messages: [
          ...baseMessages,
          { role: 'user', content: promptMessage },
        ],
      });
    }

    const { text, model: usedModel } = llmResult;

    // 6. Save assistant's reply
    await memory.addMessage(req.userId, sessionId, 'assistant', text);

    // 7. Parse any schedule blocks from Bob's reply and auto-create tasks
    const scheduleRegex = /```schedule\s*\n([\s\S]*?)```/g;
    let schedMatch;
    const createdTasks = [];
    while ((schedMatch = scheduleRegex.exec(text)) !== null) {
      try {
        const taskData = JSON.parse(schedMatch[1].trim());
        const task = await scheduler.createTask(req.userId, taskData);
        createdTasks.push(task);
        console.log(`[Chat] Auto-created scheduled task: "${task.title}" at ${new Date(task.scheduledAt).toISOString()}`);
      } catch (parseErr) {
        console.error('[Chat] Failed to parse schedule block:', parseErr.message);
      }
    }

    // 8. Smart Chat Naming: If session title is default, generate a 3-5 word descriptive title
    let updatedTitle = null;
    if (recent.length <= 2) {
      try {
        const titleRes = await callLLM({
          role: 'chat',
          messages: [
            { role: 'system', content: 'Generate a short, concise, descriptive 3 to 5 word title with 1 relevant emoji for this conversation. Do not use quotes or punctuation. Example: "🐍 Python Script Generator" or "📊 Expense Report Setup".' },
            { role: 'user', content: `User: ${promptMessage}\nAssistant: ${text}` }
          ],
          temperature: 0.5,
          max_tokens: 30,
        });
        if (titleRes && titleRes.text) {
          updatedTitle = titleRes.text.trim().replace(/^["']|["']$/g, '');
          await memory.updateSessionTitle(req.userId, sessionId, updatedTitle);
        }
      } catch (titleErr) {
        console.error('[Chat] Title generation error:', titleErr.message);
      }
    }

    // 9. Trigger non-blocking background weekly chat summarizer job
    memoryManager.summarizeUserSessions(req.userId).catch(err => console.error('Background summary error:', err));

    res.json({ reply: text, model: usedModel, scheduledTasks: createdTasks, updatedTitle });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: 'LLM call failed', details: err.message });
  }
});

module.exports = router;
