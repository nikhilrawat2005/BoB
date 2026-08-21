const fetch = require('node-fetch');
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
const fileService = require('../services/fileService');
const documentReader = require('../services/documentReaderService');

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
const TOPIC_STOPWORDS = new Set(['github', 'git', 'repos', 'repo', 'repositories', 'repository', 'projects', 'project', 'mera', 'meri', 'mere', 'apna', 'apni', 'sab', 'saare', 'kuch', 'regarding', 'sih', 'hackathon', 'smart india hackathon', 'problem', 'statements', 'problem statements']);

function extractTopic(m) {
  let cleaned = String(m || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();

  // Pattern 0: Extract domain from queries like "tum in sab hi problem statement ke according mujhe ache ache probelm statment se realted repos find kar ke do"
  // or "smart city problem statement repos"
  const pRelated = cleaned.match(/(?:related|regarding|ke liye|se related|based on|for)\s+([A-Za-z0-9 &+_\/-]{2,50}?)\s*(?:repos?|projects?|github|code)?$/i);

  // Pattern 1: SIH / hackathon domain
  const pSIH = cleaned.match(/(?:SIH|smart\s*india\s*hackathon|hackathon)\s+(?:ke\s+liye\s+|ke\s+|related\s+)?([A-Za-z][A-Za-z0-9 &+_\/-]{2,40}?)\s+(?:repos?|github|projects?|code|solution)/i)
    || cleaned.match(/([A-Za-z][A-Za-z0-9 &+_\/-]{2,40}?)\s+(?:SIH|hackathon)\s+(?:repos?|github|projects?|code|solution)/i);

  // Pattern 2: Topic AFTER "regarding / related to / about / for / ke regarding"
  const pAfterKeyword = cleaned.match(/(?:(?:ke\s+)?regarding|related\s+to|about|for|ke\s+baare\s+me|ke\s+liye)\s+([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})/i);

  // Pattern 3: Multi-word topic BEFORE "regarding / ke liye / related"
  const pBeforeRegarding = cleaned.match(/^([A-Za-z][A-Za-z0-9 .&+_\/-]{2,50}?)\s+(?:ke\s+(?:regarding|related|liye|baare)|regarding|related\s+to)/i);

  // Pattern 4: Direct search verbs (e.g. "find location tracking repos" or "dhundo ai projects")
  const pVerbs = cleaned.match(/(?:find|search|dhundh[o]?|dhoond[o]?|khoj[o]?|suggest|recommend)\s+(\d+\s+)?([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})\s*(?:repos?|projects?|code|repositories)?/i);

  // Pattern 5: Direct noun phrase
  const pNoun = cleaned.match(/([A-Za-z0-9][A-Za-z0-9 .&+_\/-]{1,50})\s+(?:repos?|projects?|repositories)/i);

  let topic = (pSIH && pSIH[1]) ||
              (pRelated && pRelated[1]) ||
              (pBeforeRegarding && pBeforeRegarding[1]) ||
              (pAfterKeyword && pAfterKeyword[1]) ||
              (pVerbs && (pVerbs[2] || pVerbs[1])) ||
              (pNoun && pNoun[1]) ||
              cleaned;

  let prev;
  do {
    prev = topic;
    topic = topic
      .replace(/(?:\btum\b|\bin\b|\bsab\b|\bhi\b|\bprobelm\b|\bproblem\b|\bstatement\b|\bstatements\b|\bke\b|\baccording\b|\bmujhe\b|\bache\b|\bacche\b|\baccha\b|\brealted\b|\brelated\b|\brepos?\b|\bprojects?\b|\bregarding\b|\bka\b|\bki\b|\bko\b|\bme\b|\bpe\b|\bpar\b|\bdo\b|\bkarke\b|\bkar\s+ke\s+do\b|\bbatao\b|\bbata\b|\bchahiye\b|\bdhoondo?\b|\bdhundho?\b|\bfind\b|\bsearch\b|\bkaro\b|\bhai\b|\bhain\b|\bgood\b|\bgreat\b|\bkoi\b|\bone\b|\bany\b|\bsome\b|\bnhi\b|\bnahi\b|\bplz\b|\bplease\b|\bSIH\b|\bhackathon\b)\s*$/i, '')
      .replace(/^(?:tum|in|sab|hi|probelm|problem|statement|statements|github|git|pe|par|me|se|ke|ka|ki|ko|the|a|an|some|best|top|kya|koi|good|acha|accha|any|abhi|mere|mera|apne|apna|apni|find|search|dhundh|dhoond|khoj|kar|sakte|ho|SIH|hackathon)\s+/i, '')
      .trim();
  } while (topic !== prev);

  if (TOPIC_STOPWORDS.has(String(topic || '').toLowerCase())) {
    // If the stripped topic is a stopword or general hackathon request, default to high-value hackathon starter search
    return 'hackathon starter template';
  }
  return topic || 'hackathon starter template';
}

function searchIntent(m) {
  if (/\bgithub\.com\/([A-Za-z0-9_.-]+)\b|\@[A-Za-z0-9_.-]+\b/i.test(m)) return false;
  // If user asks about their own profile/account, that's not a general search
  if (/\b(?:mera\s+github|meri\s+profile|my\s+profile|my\s+repos|mere\s+repos|mere\s+kitne\s+repo|my\s+github|followers)\b/i.test(m)) return false;
  
  const hasKeyword = /\b(?:repos?|projects?|repositories|source\s*code|github|dhundh[oa]?|dhoond[oa]?|khoj[oa]?|search|find|suggest|recommend|probelm|problem\s*statements?|hackathon)\b/i.test(m);
  return hasKeyword;
}

async function fetchGitHub(message) {
  const m = String(message || '');
  if (!/\bgithub\b|\brepos?\b|\brepositories\b|\bprojects?\b|\bprofile\b|\bdhoond\b|\bdhundh\b|\bkhoj\b|\bsearch\b|\bfind\b|\bSIH\b|\bhackathon\b|\bproblem\s*statements?\b/i.test(m)) return null;
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

  // 1b) Repo SEARCH intent (e.g. "best location tracking repos do", "SIH repos", "problem statement repos")
  if (searchIntent(m)) {
    const topic = extractTopic(m);
    const res = await repoService.searchRepos(topic, 6).catch(() => ({ error: 'network', message: 'GitHub search call failed.' }));
    if (res.error) {
      blocks.push(`⚠️ GITHUB SEARCH FAILED (REAL reason): ${res.message} — KABHI bhi repo/star/link invent mat karo. Honestly bolo search fail hui.`);
    } else if (res.items && res.items.length) {
      const lines = [];
      lines.push(`🐙 GITHUB SEARCH RESULTS for "${topic}" (REAL GitHub Search API, sorted by stars) — USE ONLY THESE EXACT DETAILS:`);
      res.items.forEach((r, i) => {
        const repoUrl = r.html_url || `https://github.com/${r.full_name}`;
        lines.push(
          `${i + 1}. [${r.full_name}](${repoUrl}) — Language: ${r.language || 'N/A'} | ⭐ ${r.stars} | 🍴 ${r.forks} forks` +
          `\n   🔗 ${repoUrl}` +
          `\n   Description: ${r.description ? r.description.slice(0, 180) : '(no description)'}`
        );
      });
      lines.push('\n🚨 STRICT RULE: Sirf upar di gayi REAL repos hi output karo. Inke links copy paste karo: [owner/repo](exact_url). NEVER fabricate any fake repo name, stars, or GitHub link. Agar Master ne specific problem statement manga hai, to inhi real repos se relate karke solution propose karo.');
      blocks.push(lines.join('\n'));
    } else {
      blocks.push(`🐙 GITHUB SEARCH for "${topic}" (REAL API): koi repo nahi mili — honestly batao ki is exact keyword par repo nahi mili.`);
    }
    return blocks;
  }

  // 2) Explicit Profile request (e.g. "mera github", "@username")
  const asksProfile = /\b(?:mera\s+github|meri\s+profile|my\s+profile|my\s+repos|mere\s+repos|mere\s+kitne\s+repo|my\s+github|followers|following|profile)\b/i.test(m);
  if (asksProfile) {
    let username = (m.match(/github\.com\/([A-Za-z0-9_.-]+)/) || [])[1];
    if (!username && /@([A-Za-z0-9_.-]+)\b/.test(m)) username = m.match(/@([A-Za-z0-9_.-]+)\b/)[1];
    username = username || process.env.GITHUB_USERNAME || 'nikhilrawat2005';
    try {
      const [profile, repoList] = await Promise.all([
        repoService.getUserProfile(username),
        repoService.listUserRepos(username, 100),
      ]);
      if (profile.error || repoList.error) {
        blocks.push(`⚠️ GITHUB DATA FETCH FAILED (REAL reason): ${profile.message || repoList.message}. KABHI bhi repo name, count, stars, language ya link invent mat karo.`);
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
      blocks.push('⚠️ GITHUB DATA FETCH FAILED (network). Kabhi bhi repo/count/link invent mat karo.');
    }
    return blocks;
  }

  return null;
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

  // NEW: normalize attached documents (PDF/DOCX/XLSX/etc. text extracted at
  // upload time or fetched from URL on-the-fly if missing)
  const rawDocs = Array.isArray(documents)
    ? documents.filter((d) => d && d.name).slice(0, 3)
    : [];

  const userDocuments = await Promise.all(
    rawDocs.map(async (d) => {
      // 1. If text is already present and extracted, use it directly
      if (d.textExtracted && d.extractedText) return d;

      // 2. If fileId is present, check Firestore directly for extractedText or URL
      let targetUrl = d.url;
      if (d.id) {
        try {
          const fileRecord = await fileService.getFile(req.userId, d.id);
          if (fileRecord) {
            if (fileRecord.textExtracted && fileRecord.extractedText) {
              return {
                name: fileRecord.originalName || d.name,
                extractedText: fileRecord.extractedText,
                textExtracted: true,
                extractionError: null,
              };
            }
            if (fileRecord.url) targetUrl = fileRecord.url;
          }
        } catch (e) {
          console.warn('[chat] getFile lookup error:', e.message);
        }
      }

      // 3. Download binary from Cloudinary / URL and extract text using documentReader
      if (targetUrl) {
        try {
          const res = await fetch(targetUrl);
          if (res.ok) {
            const buf = await res.buffer();
            const extResult = await documentReader.extractText(buf, d.name);
            if (extResult.supported && extResult.text) {
              return {
                name: d.name,
                extractedText: extResult.text,
                textExtracted: true,
                extractionError: null,
              };
            }
          }
        } catch (e) {
          console.warn('[chat] on-the-fly doc extract failed:', e.message);
        }
      }
      return d;
    })
  );


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

    // Fetch session title for page-linked memory
    const sessionSnap = await require('../config/firebase').db.collection('users').doc(req.userId).collection('sessions').doc(sessionId).get().catch(() => null);
    const sessionTitle = (sessionSnap && sessionSnap.exists && sessionSnap.data()?.title) || 'Main Chat';

    // Explicit memory command check (zero extra LLM calls)
    const isExplicitMemoryCommand = /(yaad\s*(rakh|rakhna|kar\s*lo|karo)|remember\s*(this|that|to)|note\s*this|save\s*in\s*memory)/i.test(promptMessage);
    if (isExplicitMemoryCommand) {
      const cleanFact = promptMessage
        .replace(/^(bob|bhai|hey|please)?\s*(yaad\s*(rakh|rakhna|kar\s*lo|karo)|remember\s*(this|that|to)|note\s*this|save\s*in\s*memory)\s*(ki|that|:|,)?\s*/i, '')
        .trim();
      if (cleanFact.length > 3) {
        await memory.addFactUnique(req.userId, cleanFact, null, {
          sourceTitle: sessionTitle,
          sourceType: 'chat',
          sessionId,
        });
      }
    }

    const [mediaEnrichment, liveBlock, webpageBlock, githubBlock] = await Promise.all([
      enrichMessageWithMedia(promptMessage),
      fetchLiveData(promptMessage),
      fetchWebpage(promptMessage),
      fetchGitHub(promptMessage),
    ]);

    const allImageUrls = [
      ...userImageUrls,
      ...(mediaEnrichment.imageUrls || []),
    ];
    if (mediaEnrichment.hasMedia) {
      console.log(`[Chat] Media detected: ${mediaEnrichment.detectedTypes.join(', ')} — ${allImageUrls.length} image(s) for vision`);
    }

    // 2. Pull recent history & Dynamic Scoped Memory (Habits + Current Chat Session Only)
    const [recent, scopedMem] = await Promise.all([
      memory.getRecentMessages(req.userId, sessionId, 20),
      memory.getDynamicScopedMemory(req.userId, { sessionId, sessionTitle }),
    ]);

    // 3. Save user's message
    await memory.addMessage(req.userId, sessionId, 'user', promptMessage);

    let contextBlocks = [];
    if (liveBlock) {
      contextBlocks.push(liveBlock);
    }

    // Dynamic Memory Slot A: Core Habits & Preferences (Always active)
    if (scopedMem.habits && scopedMem.habits.length) {
      contextBlocks.push(`🎯 HABITS & PREFERENCES of Master Nikhil:\n${scopedMem.habits.map(f => `- ${f.text}`).join('\n')}`);
    }

    // Dynamic Memory Slot B: Active Chat Session Memory (Only this chat's points)
    if (scopedMem.scoped && scopedMem.scoped.length) {
      contextBlocks.push(`💬 CURRENT CHAT MEMORY ("${sessionTitle}"):\n${scopedMem.scoped.map(f => `- ${f.text}`).join('\n')}`);
    }

    // Entity Workspace on-demand injection (Only when user explicitly asks/mentions)
    const mentionsHackathons = /\b(hackathon|hackathons|devpost|unstop|participant|participating|submission|prize pool)\b/i.test(promptMessage);
    if (mentionsHackathons) {
      const hacks = await require('../services/hackathonService').listHackathons(req.userId).catch(() => []);
      if (hacks && hacks.length) {
        contextBlocks.push(`🏆 HACKATHON WORKSPACE (Master Nikhil's active hackathons):\n${hacks.map(h => `- ${h.title} [${h.status}${h.participating ? ', participating ✓' : ''}]${h.endDate ? ` ends ${new Date(h.endDate).toLocaleDateString('en-IN')}` : ''}`).join('\n')}`);
      }
    }

    const mentionsStalker = /\b(stalk|stalking|researched profile|target profile)\b/i.test(promptMessage);
    if (mentionsStalker) {
      const stalkers = await require('../services/stalkingService').listProfiles(req.userId).catch(() => []);
      if (stalkers && stalkers.length) {
        contextBlocks.push(`🕵️ STALKING WORKSPACE (Researched target profiles):\n${stalkers.map(s => `- ${s.name} [${s.status}]${s.link ? ` ${s.link}` : ''}`).join('\n')}`);
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

━━━ 📁 FILE GENERATION RULES — READ CAREFULLY ━━━
🚨 RULE 1: JAB TAK MASTER EXPLICITLY FILE NA MAANGE, TAB TAK KOI BHI FILE YA \`\`\`filespec / \`\`\`markdown filename=... BLOCK MAT BANAO!
- Normal chat messages, questions, explanations, ya link maangne par text / formatted chat mein answer do. Unwanted .md files create karke chat clutter mat karo.
- Only create a file when Master explicitly says: "file bana do", "excel file banao", "pdf do", "export as document", "downloadable file do", etc.

🚨 RULE 2: SMART FORMAT SELECTION — APNE AAP .md FILE MAT BANAO:
- Jab data, tabular information, rows/columns, ya list of problem statements/repos manga jaye: **Excel (.xlsx)** use karo via \`\`\`filespec block.
- Jab detailed report, project documentation, ya formal summary mangi jaye: **Word (.docx)** ya **PDF (.pdf)** use karo via \`\`\`filespec block.
- Markdown (.md) SIRF tab banao jab Master explicitly bole: "markdown file do" ya code repo README.md manga ho.

🚨 RULE 3: ZERO DUMMY/EMPTY CONTENT:
- Kabhi bhi placeholder files mat banao jaise `[Problem 1](link1)`, `[Link Here]`, `...`, ya empty templates.
- File ke andar REAL, complete, fully populated actual data, real titles, aur real information honi chahiye.

Whenever Master explicitly asks for a file, use the appropriate format below:

━━━ 📎 REAL OFFICE FILES (.xlsx, .docx, .pdf, .pptx) — PREFERRED FOR REPORTS & DATA ━━━
Excel, Word, PDF, and PowerPoint files are BINARY formats. Output a SINGLE \`\`\`filespec fenced block containing valid JSON.

  \`\`\`filespec
  { "format": "xlsx", "filename": "report.xlsx",
    "sheets": [ { "name": "Sheet1", "headers": ["Name","Score"], "rows": [["Alice",95],["Bob",88]] } ] }
  \`\`\`

Format-specific JSON shapes:
📊 xlsx → { "format":"xlsx", "filename":"...", "sheets":[ { "name":"...", "headers":[...], "rows":[[...],[...]] } ] }
📝 docx → { "format":"docx", "filename":"...", "title":"...", "blocks":[ { "type":"heading", "text":"...", "level":1 }, { "type":"paragraph", "text":"..." }, { "type":"bullets", "items":["..."] }, { "type":"table", "headers":[...], "rows":[[...]] } ] }
📄 pdf → { "format":"pdf", "filename":"...", "title":"...", "sections":[ { "heading":"...", "body":"..." } ] }
📽️ pptx → { "format":"pptx", "filename":"...", "slides":[ { "title":"...", "bullets":["..."] } ] }

━━━ 💻 TEXT/CODE FILES (Markdown, Scripts, Configs) ━━━
Use syntax: \`\`\`<language> filename=<filename.ext>\n<full content>\n\`\`\`
- \`\`\`csv filename=data.csv\`\`\`
- \`\`\`python filename=script.py\`\`\`
- \`\`\`json filename=config.json\`\`\`
- \`\`\`markdown filename=readme.md\`\`\` (ONLY if explicitly asked for markdown)
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

━━━ 🐙 GITHUB RULE — ONLY REAL REPOS & CLEAN LINKS, NEVER INVENT ━━━
- Jab bhi GitHub ka sawaal aaye (profile, "mera github study kar", repo count, repos list, followers, "ye repo kya hai", koi github link paste), upar ka "🐙 GITHUB PROFILE" ya "📦 GITHUB REPO ANALYSIS" block REAL API data hai.
- SIRF wahi repos/languages/stars/counts/descriptions mention karo jo block me hain. Koi repo, link, count, language, ya stars apne dimaag se mat banao.

🚨 ABSOLUTE BAN — FAKE GITHUB LINKS: Tu KABHI BHI apne dimaag se koi github.com URL nahi banega. Agar upar koi "🐙 GITHUB SEARCH" block nahi hai, to iska matlab hai real search nahi hua — aur tujhe honestly bol dena chahiye: "Mujhe real GitHub search results abhi nahi mile — main dobara dhundh sakta hoon agar tum topic clearly bolo." SIH, hackathon, ya kisi bhi problem domain ke liye repos dhundhne pe SIRF "🐙 GITHUB SEARCH" block ke results use kar. Agar wo block nahi aaya to FAKE REPOS MAT BANAO — chahe kitna bhi helpful lagta ho.

🔗 LINK FORMAT — CRITICAL RULE (READ THIS CAREFULLY):
  CORRECT ✅ : [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes)
  WRONG ❌   : ([https://github.com/kubernetes/kubernetes]**) — outer brackets + ** BANNED
  WRONG ❌   : [name]([https://github.com/...]) — URL inside brackets BANNED
  WRONG ❌   : <strong> tags, %3C, \) outside URL, HTML entities in URLs — ALL BANNED
  RULE: Copy the EXACT URL from the "🔗" line in the context block — word-for-word. Do NOT reconstruct or modify the URL in any way.

- Koi repo block me nahi hai → wo exist nahi karti (ya private hai) → kabhi mat batao, aur uska fake link mat do.
- Repo ke baare me detail (code, tech stack) batate waqt ONLY actual file content use karo jo block me hai.
- Agar koi GitHub block nahi aaya (fetch fail / rate limit), khul ke bolo: "GitHub fetch abhi fail hua" — guess mat karo.
- REPO DHOONDHNA TUMHARI APNI SKILL HAI: "best <topic> repos do / find repos / <topic> repos / SIH ke liye repos" jaise sawaal pe upar '🐙 GITHUB SEARCH' block me REAL results milte hain (GitHub Search API se). USE WOHI. Repo-finding ko Builder ko DELEGATE MAT KARO — ye khud karo.
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

    // 8. Smart Chat Naming: If session title is default or new, generate a 3-5 word descriptive title
    let updatedTitle = null;
    const isDefaultTitle = !sessionTitle || /^New Chat\b|^Main Chat$/i.test(sessionTitle.trim()) || sessionTitle.trim().length === 0;
    if (isDefaultTitle || recent.length <= 2) {
      try {
        const titleRes = await callLLM({
          role: 'chat',
          messages: [
            { role: 'system', content: 'Generate a short, punchy 3 to 5 word title with 1 relevant leading emoji for this chat based on the user request. Output ONLY the title, no quotes, no extra words. Example: "🐍 Python Web Scraper" or "⚛️ React Auth Guide".' },
            { role: 'user', content: `User: ${promptMessage.slice(0, 350)}\nAssistant: ${text.slice(0, 250)}` }
          ],
          temperature: 0.4,
          max_tokens: 60,
        });
        if (titleRes && titleRes.text) {
          const cleanText = titleRes.text.trim().replace(/^["']|["']$/g, '').replace(/^#+\s*/, '').trim();
          if (cleanText.length > 2 && cleanText.length < 80) {
            updatedTitle = cleanText;
          }
        }
      } catch (titleErr) {
        console.warn('[Chat] Title LLM error (using heuristic fallback):', titleErr.message);
      }

      // Fallback heuristic if LLM failed or returned invalid string
      if (!updatedTitle && isDefaultTitle) {
        const cleanPrompt = promptMessage
          .replace(/[^\w\s\u0900-\u097F]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const stopWords = new Set(['karo', 'batao', 'mujhe', 'karna', 'kaise', 'please', 'help', 'with', 'about', 'want', 'what', 'when', 'where', 'bhai', 'bolo', 'hello', 'hey', 'ka', 'ki', 'ke', 'hai', 'hain', 'mein', 'par', 'ko', 'se']);
        const words = cleanPrompt.split(' ').filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
        if (words.length) {
          const capWords = words.slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
          updatedTitle = `💬 ${capWords.join(' ')}`;
        } else {
          updatedTitle = `💬 Chat ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
        }
      }

      if (updatedTitle) {
        await memory.updateSessionTitle(req.userId, sessionId, updatedTitle);
        await memory.syncSessionFactTitles(req.userId, sessionId, updatedTitle);
      }
    }

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
