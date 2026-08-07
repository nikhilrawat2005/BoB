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
// Binary-file intent detection — fast regex pre-check (no LLM call) that
// flags when Master Nikhil is asking for a real Office/PDF file, so we can
// remind the model (below) to use a `filespec` JSON block instead of the
// plain-text fenced-block path, which cannot produce valid .xlsx/.docx/etc.
// Returns one of 'xlsx' | 'docx' | 'pdf' | 'pptx' | null.
// ─────────────────────────────────────────────────────────
function detectBinaryFileIntent(message) {
  const m = String(message || '').toLowerCase();
  // Bare "word"/"excel" are common English words, so those two require a
  // file-ish companion word to avoid false positives (e.g. "in a word, yes").
  // "pdf" and "ppt" are unambiguous short-forms in this Hinglish context, so
  // they match standalone.
  if (/\.xlsx\b|excel\s*(sheet|file|workbook)|spreadsheet/.test(m)) return 'xlsx';
  if (/\.docx\b|\bword\s*(doc|document|file)\b/.test(m)) return 'docx';
  if (/\.pptx\b|power\s*point|\bppt\b|slide\s*deck|presentation\s*file/.test(m)) return 'pptx';
  if (/\.pdf\b|\bpdf\b/.test(m)) return 'pdf';
  return null;
}

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
 * If a specific repo link is pasted, the ACTUAL repo code is read (analyzeRepo).
 * Never throws. Returns an array of context blocks (or null).
 */
const TOPIC_STOPWORDS = new Set(['github', 'git', 'repos', 'repo', 'repositories', 'repository', 'projects', 'project', 'mera', 'meri', 'mere', 'apna', 'apni', 'sab', 'saare', 'kuch', 'regarding']);

function extractTopic(m) {
  let cleaned = String(m || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();

  // Pattern 0: Topic AFTER "regarding / related to / about / for / ke regarding" (e.g. "find repos regarding ai models")
  const pAfterKeyword = cleaned.match(/(?:(?:ke\s+)?regarding|related\s+to|about|for|ke\s+baare\s+me|ke\s+liye)\s+([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})/i);

  // Pattern 1: Topic BEFORE "ke regarding / related / pe / par / ke liye / ke baare me" (e.g. "location tracking ke regarding repos find karo")
  const pHinglishBefore = cleaned.match(/([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})\s+(?:ke\s+(?:regarding|related|liye|baare\s+me|par|pe)|pe|par|related\s+to)/i);

  // Pattern 2: Topic AFTER "repos for/about/on/related to" (e.g. "repos for location tracking")
  const pEnglishAfter = cleaned.match(/(?:repos?|projects?|repositories)\s+(?:for|about|on|related\s+to|regarding|ke\s+liye|ke\s+baare\s+me)\s+([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})/i);

  // Pattern 3: Direct search verbs (e.g. "find location tracking repos" or "dhundo location tracking projects")
  const pVerbs = cleaned.match(/(?:find|search|dhundh[o]?|dhoond[o]?|khoj[o]?|suggest|recommend)\s+(\d+\s+)?([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})\s*(?:repos?|projects?|code|repositories)?/i);

  // Pattern 4: Direct noun phrase (e.g. "location tracking repos")
  const pNoun = cleaned.match(/([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})\s+(?:repos?|projects?|repositories)/i);

  let topic = (pAfterKeyword && pAfterKeyword[1]) ||
              (pHinglishBefore && pHinglishBefore[1]) ||
              (pEnglishAfter && pEnglishAfter[1]) ||
              (pVerbs && (pVerbs[2] || pVerbs[1])) ||
              (pNoun && pNoun[1]) ||
              cleaned;

  let prev;
  do {
    prev = topic;
    topic = topic
      .replace(/(?:\brelated\b|\brepo\b|\brepos?\b|\bprojects?\b|\bregarding\b|\bke?\b|\bka\b|\bki\b|\bko\b|\bme\b|\bpe\b|\bpar\b|\bdo\b|\bkarke\b|\bbatao\b|\bbata\b|\bchahiye\b|\bdhoondo?\b|\bdhundho?\b|\bfind\b|\bsearch\b|\bkaro\b|\bhai\b|\bhain\b|\bgood\b|\bgreat\b|\bacha\b|\baccha\b|\bacche\b|\bkoi\b|\bone\b|\bany\b|\bsome\b|\bnhi\b|\bnahi\b)\s*$/i, '')
      .replace(/^(?:github|git|pe|par|me|se|ke|ka|ki|ko|the|a|an|some|best|top|kya|koi|good|acha|accha|any|abhi|mere|mera|apne|apna|apni|sab|saare|find|search|dhundh|dhoond|khoj|kar|sakte|ho)\s+/i, '')
      .trim();
  } while (topic !== prev);

  return TOPIC_STOPWORDS.has(String(topic || '').toLowerCase()) ? '' : topic;
}

function searchIntent(m) {
  if (/\bgithub\.com\/([A-Za-z0-9_.-]+)\b|\@[A-Za-z0-9_.-]+\b/i.test(m)) return false;
  const hasKeyword = /\b(?:repos?|projects?|repositories|source code|github|dhundh[oa]?|dhoond[oa]?|khoj[oa]?|search|find|suggest|recommend)\b/i.test(m);
  if (!hasKeyword) return false;
  const topic = extractTopic(m);
  return !!topic;
}

async function fetchGitHub(message) {
  const m = String(message || '');
  if (!/\bgithub\b|\brepos?\b|\brepositories\b|\bprojects?\b|\bprofile\b|\bdhoond\b|\bdhundh\b|\bkhoj\b|\bsearch\b|\bfind\b/i.test(m)) return null;
  const blocks = [];

  // 1) Specific repo link(s) pasted? → read the ACTUAL code of the repo.
  const repoUrls = repoService.extractRepoUrls(m).slice(0, 2);
  if (repoUrls.length) {
    for (const r of repoUrls) {
      const analysis = await repoService.analyzeRepo(r.url).catch(err => ({ status: 'error', message: err.message }));
      if (analysis && analysis.status === 'ok') {
        blocks.push(analysis.context);
        blocks.push(`⚠️ REPO RULE for "${analysis.repo.fullName}": upar wala code REAL padha gaya hai. Repo ke baare me ONLY upar diye file content/metadata use karo — kuch bhi invent mat karo.`);
      } else {
        const why = (analysis && (analysis.error === 'not_found' || analysis.status === 'not_found'))
          ? `YE REPO EXIST NAHI KARTI (404) — private hai ya delete/rename ho gayi. Ye link follow mat karo, aur koi repo/link mat banao.`
          : analysis && analysis.status === 'private'
            ? 'Ye repo PRIVATE hai — iska content nahi dikh sakta, bina token ke. Khud se content mat banao.'
            : (analysis && (analysis.error === 'rate_limit' || analysis.status === 'rate_limit'))
              ? 'GitHub API rate limit hit — abhi repo verify nahi ho paya (anonymous 60/hr).'
              : (analysis && analysis.message) || 'Repo fetch fail hua.';
        blocks.push(`⚠️ GITHUB REPO CHECK for "${r.owner}/${r.repo}" (REAL API result): ${why}`);
      }
    }
    return blocks;
  }

  // 1b) Repo SEARCH intent (e.g. "best location tracking repos do") → REAL GitHub Search API.
  if (searchIntent(m)) {
    const topic = extractTopic(m);
    const res = await repoService.searchRepos(topic, 5).catch(() => ({ error: 'network', message: 'GitHub search call failed.' }));
    if (res.error) {
      blocks.push(`⚠️ GITHUB SEARCH FAILED (REAL reason): ${res.message} — KABHI bhi repo/star/link invent mat karo.`);
    } else if (res.items && res.items.length) {
      const lines = [];
      lines.push(`🐙 GITHUB SEARCH "${topic}" (REAL GitHub API, sorted by stars) — Sirf inki details use karo, kuch invent mat karo:`);
      res.items.forEach((r, i) => lines.push(`${i + 1}. ${r.full_name} — ${r.language || 'N/A'} ⭐${r.stars} (${r.forks} forks)\n   🔗 ${r.html_url}\n   ${r.description ? r.description.slice(0, 160) : '(no description)'}`));
      lines.push('- RULE: Ye hi real results hain. Koi aur repo/star/link mat banao. Repo detail ke liye kaunsi repo pasand aaye, Master usse paste kare, tab main actual code padh ke analysis doonga.');
      blocks.push(lines.join('\n'));
    } else {
      blocks.push(`🐙 GITHUB SEARCH "${topic}" (REAL API): koi repo nahi mili is topic pe — honestly bolo, fake repo/link mat banao.`);
    }
    return blocks;
  }

  // 2) No specific repo link → profile + REAL full repo list.
  let username = (m.match(/github\.com\/([A-Za-z0-9_.-]+)/) || [])[1];
  if (!username && /@([A-Za-z0-9_.-]+)\b/.test(m)) username = m.match(/@([A-Za-z0-9_.-]+)\b/)[1];
  username = username || process.env.GITHUB_USERNAME || 'nikhilrawat2005';
  try {
    const [profile, repoList] = await Promise.all([
      repoService.getUserProfile(username),
      repoService.listUserRepos(username, 100),
    ]);
    if (profile.error || repoList.error) {
      blocks.push(`⚠️ GITHUB DATA FETCH FAILED (REAL reason): ${profile.message || repoList.message}. KABHI bhi repo name, count, stars, language ya link invent mat karo — honestly batao ki fetch fail hua aur GITHUB_TOKEN laga kar fix hoga.`);
      return blocks;
    }
    const lines = [];
    lines.push(`🐙 GITHUB PROFILE (REAL DATA from GitHub API for @${profile.login}) — use these EXACT numbers, never invent:`);
    lines.push(`- Username: ${profile.login}${profile.name ? ' (' + profile.name + ')' : ''}`);
    lines.push(`- Public repos: ${profile.public_repos} | Followers: ${profile.followers} | Following: ${profile.following}${profile.location ? ' | Location: ' + profile.location : ''}`);
    if (profile.bio) lines.push(`- Bio: ${profile.bio}`);
    lines.push(`- ⚠️ RULE: Sirf yehi repos exist karti hain (${repoList.count} fetched, REAL). Inke ilawa KOI repo/link/count/stars/language invent mat karo. Har repo ka real link: https://github.com/<full_name>`);
    if (repoList.repos && repoList.repos.length) {
      repoList.repos.forEach(r => lines.push(`  • ${r.full_name} — ${r.language || 'N/A'} ⭐${r.stars}${r.fork ? ' (fork)' : ''}${r.description ? ': ' + r.description.slice(0, 110) : ''}`));
    } else {
      lines.push('- No public repos found.');
    }
    blocks.push(lines.join('\n'));
  } catch (err) {
    console.log('[Chat] GitHub fetch skipped:', err.message);
    blocks.push('⚠️ GITHUB DATA FETCH FAILED (network). Kabhi bhi repo/count/link invent mat karo — batao ki fetch abhi fail hua.');
  }
  return blocks;
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

// POST /api/chat  { sessionId, message, model?, imageUrls?, documents? }
router.post('/', requireAuth, async (req, res) => {
  const { sessionId, message, model, imageUrls, documents } = req.body;
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

  // NEW: normalize attached documents (PDF/DOCX/etc. text extracted at
  // upload time by fileService/documentReaderService, forwarded here by the
  // frontend). Each item looks like { name, extractedText, textExtracted }.
  const userDocuments = Array.isArray(documents)
    ? documents.filter((d) => d && d.name).slice(0, 3)
    : [];

  // DEBUG LOG — visible in Vercel → Logs. Search "[chat] documents received"
  // to confirm whether the frontend is actually sending attached-file text,
  // and whether extraction produced real content or came back empty/failed.
  console.log(
    `[chat] documents received: ${userDocuments.length}` +
    (userDocuments.length
      ? ' | ' + userDocuments.map(d => `"${d.name}" textExtracted=${d.textExtracted} chars=${(d.extractedText || '').length}`).join(', ')
      : '')
  );

  const documentContext = userDocuments.length
    ? `\n━━━ 📄 ATTACHED DOCUMENT(S) — REAL extracted text, use ONLY this, never invent content ━━━\n${userDocuments
        .map((d) => {
          if (!d.textExtracted || !d.extractedText) {
            return `File: "${d.name}" — ⚠️ text could not be extracted (${d.extractionError || 'unsupported format'}). Tell Master honestly you cannot read this file's content instead of guessing.`;
          }
          return `File: "${d.name}"\n${d.extractedText}`;
        })
        .join('\n\n---\n\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : '';

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
    if (githubBlock && githubBlock.length) {
      githubBlock.forEach(b => contextBlocks.push(b));
    }
    const wantsSelfEdit = /improve (yourself|your code|khud)|self.?edit|self.?improve|apne aap ko|khud ko|code review karo|bug fix karo|better banao/i.test(promptMessage);
    if (wantsSelfEdit) {
      const selfEdit = require('../services/selfEditService');
      selfEdit.runSelfReview(req.userId, { autoApply: false }).catch(err => console.error('Self-review error:', err.message));
      contextBlocks.push(`🧬 SELF-EDIT MODE (Master asked you to improve yourself): a code self-review just started in the background. Tell Master it's running and that he'll get edit proposals as 🔔 notifications — he can approve/apply them in the HQ → Self-Edit workspace. Don't fabricate which edits were found yet.`);
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

    const binaryFileIntent = detectBinaryFileIntent(promptMessage);
    if (binaryFileIntent) {
      contextBlocks.push(`📎 BINARY FILE REQUEST DETECTED (${binaryFileIntent}): Master Nikhil is asking for a real .${binaryFileIntent} file. You MUST respond with a single \`\`\`filespec JSON block (format: "${binaryFileIntent}") as described in the REAL OFFICE FILES section — do NOT use a plain \`\`\`${binaryFileIntent} filename=... \`\`\` text block, it will produce a corrupt file.`);
    }

    if (userDocuments.length) {
      contextBlocks.push(`📄 DOCUMENT(S) ATTACHED: Master Nikhil ne ${userDocuments.length} file(s) attach ki hai(n) — real extracted text neeche "ATTACHED DOCUMENT(S)" block mein hai. Jo bhi answer/table/file banao wo SIRF is real extracted text se banao. Kabhi bhi apni taraf se problem statements, numbers, ya facts invent mat karo jo document mein nahi hain — agar kuch section extraction mein missing/unclear lage to Master ko honestly bata do.`);
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

━━━ 📎 REAL OFFICE FILES (.xlsx, .docx, .pdf, .pptx) — DO NOT use the fenced-block method above for these ━━━
Excel, Word, PDF, and PowerPoint files are BINARY formats — they cannot be written as plain text.
NEVER put xlsx/docx/pdf/pptx content inside a normal \`\`\`<language> filename=... \`\`\` block; that will produce a corrupt file Master Nikhil cannot open.

Instead, output a SINGLE \`\`\`filespec fenced block containing ONLY valid JSON (no comments, no trailing text) describing the file's structure. The backend turns this JSON into a real file using proper libraries.

  \`\`\`filespec
  { "format": "xlsx", "filename": "report.xlsx",
    "sheets": [ { "name": "Sheet1", "headers": ["Name","Score"], "rows": [["Alice",95],["Bob",88]] } ] }
  \`\`\`

Format-specific JSON shapes:

📊 xlsx → { "format":"xlsx", "filename":"...", "sheets":[ { "name":"...", "headers":[...], "rows":[[...],[...]] }, ... ] }
   (multiple sheets allowed — add more objects to the "sheets" array)

📝 docx → { "format":"docx", "filename":"...", "title":"optional doc title", "blocks":[
     { "type":"heading", "text":"...", "level":1 },
     { "type":"paragraph", "text":"..." },
     { "type":"bullets", "items":["...", "..."] },
     { "type":"table", "headers":[...], "rows":[[...],[...]] }
   ] }

📄 pdf → { "format":"pdf", "filename":"...", "title":"optional title", "sections":[ { "heading":"...", "body":"..." }, ... ] }

📽️ pptx → { "format":"pptx", "filename":"...", "slides":[ { "title":"...", "bullets":["...", "..."] }, ... ] }

Rules for filespec blocks:
- Output exactly ONE filespec block per file. If Master Nikhil asks for multiple files, generate them one at a time across separate turns, or ask which one he wants first.
- The JSON must be syntactically valid — it will be parsed with JSON.parse(). No trailing commas, no comments.
- Never fabricate a "download ready" message before this block — the block IS what triggers the real download.
- If unsure which format he wants (e.g. he just says "file bana do"), ask him — don't guess between xlsx/docx/pdf/pptx.
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
- builder block me title AUR instruction DONO hona chahiye (valid JSON). "instruction" EK NON-EMPTY STRING hona chahiye — kisi bhi haalat me empty ya missing instruction wala builder block mat bhejo (wo fail hota hai). Agar tum complete instruction nahi bana sakte, to delegate MAT karo.
- Bina complete builder block bheje "Builder ko de diya / project ban gaya" kabhi MAT bolo.
- Repo/search/simple sawaal Builder ko mat bhejo — wo tumhare apne skills se solve hote hain.
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

━━━ 🏆 HACKATHON WORKSPACE DETECTION ENGINE ━━━
When Master Nikhil pastes or mentions a Hackathon announcement, link, or details (e.g. ViCodathon 2026, Smart India Hackathon, Devpost link, prize pool details, registration deadline, dates):
1. Discuss the hackathon warmly, analyze its key highlights (prizes, dates, mode, tech stack ideas), and give your feedback.
2. ALWAYS output a \`\`\`hackathon block containing structured details so Master Nikhil gets a one-click "➕ Add to Hackathon Workspace" button directly in chat!

\`\`\`hackathon
{
  "title": "ViCodathon 2026",
  "link": "https://www.abtalks.in/hackathon?s=sar",
  "startDate": 1786147200000,
  "endDate": 1786320000000,
  "prize": "Prize Pool up to ₹20,000",
  "mode": "online",
  "description": "India's AI-First Vibe Coding Hackathon. Build an AI-powered project in 48 hours using Claude, ChatGPT, Gemini, Cursor, etc.",
  "rules": ["100% Online & Free", "Solo or Team up to 3", "Submission deadline 6 August 2026"]
}
\`\`\`

FIELDS:
- title: Clean hackathon name
- link: Registration / source URL (if available)
- startDate: Start timestamp in ms (or null)
- endDate: End timestamp in ms (or null)
- prize: Prize pool info string
- mode: "online" | "offline" | "unknown"
- description: Summary of hackathon
- rules: Array of rule strings / key requirements

In your text, explain: "🏆 Maine is hackathon ka auto-card generate kar diya hai! Neeche 'Add to Hackathon Workspace' button pe click karke ise apne workspace me add kar sakte ho."
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🚨 TRUTHFULNESS — NEVER FAKE-PROMISE (MOST IMPORTANT) ━━━
You are only allowed to promise Master Nikhil things that are ACTUALLY built. These are the ONLY real capabilities:
1. Live data (weather/news/stocks) works ONLY for New Delhi by default, OR for a city name Master gives you IN THE SAME MESSAGE (e.g. "Delhi ka weather"). You CANNOT remember multiple cities and auto-show their weather later. If Master asks about remembered locations, say: "Abhi multi-city auto-weather support nahi hai — main ise HQ me implement karwa sakta hoon, ya tum city name message me do, main abhi dikha dunga." NEVER say "ab se har chat me X ka weather dikhega".
2. Scheduled tasks are REAL: a \`\`\`schedule block creates a real task that fires later. But the task's "prompt" can only use data you already have — you CANNOT schedule a task that fetches a specific city's live weather unless that city was just given. Never schedule "auto-weather update" for a location you can't fetch.
3. File creation (filename blocks), memory facts, monthly memory, hackathon/stalking/routines workspaces, Builder delegation (collab mode), web research, and live pulse ARE real.
4. If Master asks to change the app's behaviour or UI (e.g. "live pulse me weather ki jagah ye dikhao", "chart kaisa banao"), DON'T promise it will happen automatically. Say honestly: "Ye feature abhi code me nahi hai, lekin main self-edit engine se ise implement kar sakta hoon" and ask if he wants you to implement it. NEVER show a fake confirmation card for an unimplemented feature.
5. NEVER invent temperatures, prices, headlines, or data. If you don't have real data, say so.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🐙 GITHUB RULE — ONLY REAL REPOS, NEVER INVENT ━━━
- Jab bhi GitHub ka sawaal aaye (profile, "mera github study kar", repo count, repos list, followers, "ye repo kya hai", koi github link paste), upar ka "🐙 GITHUB PROFILE" ya "📦 GITHUB REPO ANALYSIS" block REAL API data hai.
- SIRF wahi repos/languages/stars/counts/descriptions mention karo jo block me hain. Koi repo, link, count, language, ya stars apne dimaag se mat banao.
- Koi repo block me nahi hai → wo exist nahi karti (ya private hai) → kabhi mat batao, aur uska fake link mat do.
- Links hamesha sirf real full_name se: https://github.com/<owner>/<repo>. Kabhi guessed/broken link mat do — link 404 lag jayega.
- Repo ke baare me detail (code, tech stack) batate waqt ONLY actual file content use karo jo block me hai.
- Agar koi GitHub block nahi aaya (fetch fail / rate limit), khul ke bolo: "GitHub fetch abhi fail hua" — guess mat karo.
- REPO DHOONDHNA TUMHARI APNI SKILL HAI: "best <topic> repos do / find repos / <topic> repos" jaise sawaal pe upar '🐙 GITHUB SEARCH' block me REAL results milte hain (GitHub Search API se). USE WOHI. Repo-finding ko Builder ko DELEGATE MAT KARO — ye khud karo.
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
${memoryContext}${mediaEnrichment.mediaContext}${documentContext}`;

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
    const msg = /credits|quota|balance|afford/i.test(err.message)
      ? 'LLM call failed — credits/balance issue (OpenRouter pe credits add karo ya max_tokens kam rakho).'
      : 'LLM call failed';
    res.status(500).json({ error: msg, details: err.message });
  }
});

module.exports = router;
