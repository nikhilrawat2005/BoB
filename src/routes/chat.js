const fetch = require('node-fetch');
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
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

  const wantsArchitecture = /(?:inspect|kaise bani|architecture|tech stack|libraries|framework|reverse engineer|how it is built|how it is made)/i.test(message);

  try {
    const page = await crawler.scrapeURL(url, { inspectArchitecture: wantsArchitecture });
    if (!page || (!page.contentSnippet && !page.hiddenData)) return null;

    const lines = [];
    lines.push(`📄 WEBPAGE — ${page.title || url}`);
    if (page.description) lines.push(`Description: ${page.description}`);

    // If architecture inspection was requested
    if (wantsArchitecture && page.architecture) {
      lines.push(`🛠️ DETECTED TECH STACK & ARCHITECTURE:`);
      if (page.architecture.framework?.length) lines.push(`- Frameworks: ${page.architecture.framework.join(', ')}`);
      if (page.architecture.styling?.length) lines.push(`- Styling: ${page.architecture.styling.join(', ')}`);
      if (page.architecture.libraries?.length) lines.push(`- Libraries/FX: ${page.architecture.libraries.join(', ')}`);
    }

    // If Next.js or JSON-LD hidden data was extracted, inject the key props (concise)
    if (page.hiddenData) {
      if (page.hiddenData.nextData) {
        const nextJson = JSON.stringify(page.hiddenData.nextData).slice(0, 2000);
        lines.push(`⚡ HIDDEN CLIENT STATE (__NEXT_DATA__):\n${nextJson}`);
      } else if (page.hiddenData.jsonLd && page.hiddenData.jsonLd.length) {
        const jsonLdStr = JSON.stringify(page.hiddenData.jsonLd[0]).slice(0, 1500);
        lines.push(`⚡ STRUCTURED JSON-LD DATA:\n${jsonLdStr}`);
      }
    }

    if (page.headings && page.headings.length) lines.push(`Headings:\n${page.headings.slice(0, 8).join('\n')}`);
    if (page.contentSnippet) lines.push(`Page Content:\n${page.contentSnippet.slice(0, 3500)}`);

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
  
  // Require explicit repo/github/project search intent — do NOT trigger on random words like 'suggest' or 'find' alone
  const hasExplicitRepoIntent = /\b(?:github|repos?|repositories|source\s*code|github\s*links?|code\s*repos?)\b/i.test(m) ||
    (/\b(?:find|search|dhundh|dhoond|khoj|suggest|recommend|chahiye|do)\b/i.test(m) && /\b(?:repos?|projects?|github|codebase|solutions?)\b/i.test(m));
  return hasExplicitRepoIntent;
}

async function fetchGitHub(message, docContext) {
  const m = String(message || '');
  if (!/\bgithub\b|\brepos?\b|\brepositories\b|\bprofile\b/i.test(m) && !searchIntent(m)) return null;
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

  // 1b) Repo SEARCH intent
  if (searchIntent(m)) {
    let searchQueries = [];

    if (docContext && docContext.length > 50) {
      // Parse actual problem titles from the extracted document text.
      // Excel sheets are rendered as markdown tables: | col | col |
      // We pick the column that looks like a "problem title/statement" column.
      const titleCandidates = [];

      // Match table rows — grab the 2nd, 3rd or 4th cell (usually title/statement)
      const tableRows = docContext.match(/\|([^\|\n]+)\|([^\|\n]+)\|([^\|\n]+)?/g) || [];
      for (const row of tableRows) {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        // Skip header-like rows (all short words or dashes)
        for (const cell of cells) {
          const clean = cell.replace(/[-_*#]/g, '').trim();
          // A good title: 15-120 chars, not all numbers, not a date-like
          if (clean.length >= 15 && clean.length <= 120 && /[a-zA-Z]{4,}/.test(clean) && !/^\d{4}-\d{2}/.test(clean)) {
            titleCandidates.push(clean);
          }
        }
      }

      // Deduplicate and take up to 6 best candidates (longest = most descriptive)
      const uniqueTitles = [...new Set(titleCandidates)]
        .sort((a, b) => b.length - a.length)
        .slice(0, 6);

      // Build search queries: use the actual problem title words, trimmed to ~60 chars
      uniqueTitles.forEach(t => {
        // Strip SIH problem codes like SIH25001 from start
        const q = t.replace(/^SIH\s*\d+\s*[-–]?\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 70);
        if (q.length >= 8 && !searchQueries.includes(q)) searchQueries.push(q);
      });

      // Fallback: if no titles extracted, use message topic + generic domain keywords
      if (searchQueries.length === 0) {
        const mainTopic = extractTopic(m);
        searchQueries = [mainTopic !== 'hackathon starter template' ? mainTopic : 'smart india hackathon solution AI'];
      }
    } else {
      searchQueries = [extractTopic(m)];
    }

    console.log('[chat] GitHub search queries:', searchQueries);

    const allItems = [];
    const seenRepos = new Set();

    for (const query of searchQueries.slice(0, 5)) {
      const res = await repoService.searchRepos(query, 3).catch(() => ({ error: 'network', message: 'GitHub search call failed.' }));
      if (!res.error && res.items) {
        for (const item of res.items) {
          if (!seenRepos.has(item.full_name)) {
            seenRepos.add(item.full_name);
            allItems.push({ ...item, _query: query });
          }
        }
      }
    }

    if (allItems.length) {
      const finalItems = allItems.slice(0, 10);

      // Pre-format the EXACT output we want. This gets appended AFTER the LLM response
      // so the LLM cannot hallucinate — it never sees or generates repo links.
      const repoLines = [];
      repoLines.push(`\n\n---\n🐙 **GitHub Repos (Real — ${finalItems.length} found via GitHub Search API)**\n`);
      finalItems.forEach((r, i) => {
        const repoUrl = r.html_url || `https://github.com/${r.full_name}`;
        repoLines.push(
          `**${i + 1}. [${r.full_name}](${repoUrl})**\n` +
          `   📌 Language: \`${r.language || 'N/A'}\` | ⭐ ${r.stars} stars | 🍴 ${r.forks} forks\n` +
          `   📝 ${r.description ? r.description.slice(0, 160) : '(no description)'}\n`
        );
      });
      repoLines.push(`> ℹ️ Yeh ${finalItems.length} real repos GitHub Search API se mili hain. Jo repos nahi mili unke liye fake links nahi diye gaye.`);

      // Context for LLM: tell it NOT to list repos (we'll append them), just give intro text
      const contextLines = [
        `🐙 GITHUB SEARCH COMPLETE: ${finalItems.length} real repos mili hain. Inhe GITHUB_REPOS_APPENDED section mein append kiya jayega automatically.`,
        `IMPORTANT: Tum repo links/names/stars bilkul mat likho apne response mein — sirf ek short intro do jaise "Maine GitHub par search ki, yahan real repos hain:" aur phir ruk jao. Repos automatically append ho jayengi.`,
        `Search kiya topics: ${[...new Set(finalItems.map(r => r._query))].join(', ')}`,
      ];
      blocks.push(contextLines.join('\n'));

      // Return both context block AND the pre-built repos section
      blocks._repoSection = repoLines.join('\n');
    } else {
      const failedQueries = searchQueries.join(', ');
      blocks.push(`🐙 GITHUB SEARCH (REAL API): "${failedQueries}" — koi bhi repo nahi mili. Honestly batao: "Is topic par GitHub par abhi koi relevant public repo nahi mili." KABHI bhi fake repos mat banao.`);
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
          // Zero-Token Local Query Engine: filter to relevant rows/paragraphs only
          const filteredText = documentReader.queryDocumentContext(d.extractedText, promptMessage);
          return `File: "${d.name}"\n${filteredText}`;
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

    // Comprehensive Memory Command & Intent Check:
    // Matches: "yaad rakh", "yaad rakhna", "remember this", "save in memory", "memory me update/store/rakh",
    // "store akrdo memory me" (typos), "store/save ... memory me", "memory me ... store/save", "track rakho", etc.
    const isExplicitMemoryCommand = /(?:yaad\s*(?:rakh|rakhna|kar\s*lo|karo)|remember\s*(?:this|that|to)?|note\s*(?:this|down)?|save\s*in\s*memory|memory\s*me\s*(?:update|add|save|rakh|daal|store|kr|kar)|(?:store|save|rakh|daal)\s*\w*\s*memory\s*me|memory\s*me\s*\w*\s*(?:store|save|rakh|daal|kr|kar)|track\s*(?:rakh|rakho|karo|karte\s*chalo)|(?:store|save)\s*(?:kar\s*(?:do|lo|dena)|[a-z]*do|[a-z]*lo)\s*memory|memory\s*(?:update|mein|me))/i.test(promptMessage);
    if (isExplicitMemoryCommand) {
      let cleanFact = promptMessage
        .replace(/^(?:bob|bhai|hey|please|bro|sun|suno)?[\s,:!-]*/i, '')
        .replace(/(?:ye|yeh|isko|isse|apni|meri)?\s*memory\s*me\s*(?:update\s*karte\s*chalo|update\s*karo|save\s*kar\s*lo|add\s*karo|store\s*karo|rakho)\s*(?:ki|that|:|,)?\s*/i, '')
        .replace(/(?:yaad\s*(?:rakh|rakhna|kar\s*lo|karo)|remember\s*(?:this|that|to)?|note\s*(?:this|down)?|save\s*in\s*memory)\s*(?:ki|that|:|,)?\s*/i, '')
        .trim();

      if (!cleanFact || cleanFact.length < 3) {
        cleanFact = promptMessage.trim();
      }

      if (cleanFact.length >= 3) {
        await memory.addFactUnique(req.userId, cleanFact, null, {
          sourceTitle: sessionTitle,
          sourceType: 'chat',
          sessionId,
        }).catch(err => console.error('[Memory] addFactUnique explicit error:', err.message));
      }
    }

    const [mediaEnrichment, liveBlock, webpageBlock, githubBlock] = await Promise.all([
      enrichMessageWithMedia(promptMessage),
      fetchLiveData(promptMessage),
      fetchWebpage(promptMessage),
      fetchGitHub(promptMessage, documentContext),
    ]);

    // Extract pre-built repo section (bypasses LLM hallucination entirely)
    const prebuiltRepoSection = (githubBlock && githubBlock._repoSection) || null;

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

    // Dynamic Memory Slot B: Active Chat Session's Rolling Weekly Summary (Previous compressed history)
    if (scopedMem.rollingSummary) {
      contextBlocks.push(`📜 PREVIOUS CHAT ROLLING SUMMARY ("${sessionTitle}"):\n${scopedMem.rollingSummary}`);
    }

    // Dynamic Memory Slot C: Active Chat Session Memory Points
    if (scopedMem.scoped && scopedMem.scoped.length) {
      contextBlocks.push(`💬 CURRENT CHAT KEY POINTS ("${sessionTitle}"):\n${scopedMem.scoped.map(f => `- ${f.text}`).join('\n')}`);
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
        contextBlocks.push(`🔎 DEEP RESEARCH WORKSPACE (Researched target profiles):\n${stalkers.map(s => `- ${s.name} [${s.status}]${s.link ? ` ${s.link}` : ''}`).join('\n')}`);
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
      contextBlocks.push(`📎 BINARY FILE REQUEST DETECTED (${binaryFileIntent}): Master Nikhil is asking for a real .${binaryFileIntent} file. You MUST respond with a single \`\`\`filespec JSON block (format: "${binaryFileIntent}") as described in the FILE GENERATION section — do NOT use a plain \`\`\`${binaryFileIntent} filename=... \`\`\` text block.`);
    }

    if (userDocuments.length) {
      contextBlocks.push(`📄 DOCUMENT(S) ATTACHED: Master Nikhil ne ${userDocuments.length} file(s) attach ki hai(n) — real extracted text neeche "ATTACHED DOCUMENT(S)" block mein hai. Jo bhi answer/table/file banao wo SIRF is real extracted text se banao. Kabhi bhi apni taraf se facts invent mat karo.`);
    }

    const memoryContext = contextBlocks.join('\n\n');

    // 5. Modular Dynamic System Prompt Builder (Token Optimizer)
    // Only inject specialized rule modules when explicitly needed by user's message or context.
    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // 1. CORE BASE PROMPT (~280 tokens — always active)
    const promptModules = [
      `You are Bob, an intelligent, ultra-loyal personal AI assistant created exclusively for your Master, Nikhil.
- Always know that your Master and creator is Nikhil (email: ${req.userEmail || 'Nikhil'}).
- Be respectful, concise, highly capable, and address Master Nikhil warmly in Hinglish/English.
- Be proactive! Suggest logical next steps, improvements, or tips whenever helpful.
- Current IST time: ${nowIST}

━━━ 🎨 OUTPUT STYLE & FORMATTING ━━━
- Structured & clean: short opening line → clear bullet points/sections → concise takeaway.
- Use bold sparingly (**key terms**). Use \`backticks\` for code, formulas, and filenames.
- Lists for steps; Markdown tables for comparisons. Keep spacing clean (no unbroken text walls).

━━━ 🧠 PERSISTENT MEMORY PROTOCOL ━━━
When Master Nikhil shares important personal info, asks you to remember/track progress (like solved questions, goals, habits, preferences, tech rules, decisions), YOU MUST capture and save it permanently into his Memory database.

TRIGGER PHRASES (always save when you detect these — even with typos):
- "yaad rakh", "yaad rakhna", "remember this", "memory me store", "store karo memory me"
- "store akrdo memory me", "store kardo", "save karo", "track rakho"
- ANY message asking you to note/save/remember facts about the user's progress

To save a memory fact, output a clean memory block at the END of your response:
\`\`\`memory
{ "fact": "Nikhil ne 3 LeetCode problems solve ki hain: Two Sum, Remove Element, Contains Duplicate", "category": "main" }
\`\`\`
Categories: "habits" (habits/personal bio), "main" (core progress/stats/facts), "builder" (tech stack/architecture), "hackathons" (hackathon details).
You can output one or more \`\`\`memory ... \`\`\` blocks whenever new milestones or facts need to be saved.
RULE: If you say "I've updated my memory" or "Got it, I'll remember", you MUST emit a \`\`\`memory block — no exceptions.`
    ];

    // 2. FILE GENERATOR MODULE (~250 tokens — only if explicit file creation requested)
    const wantsFile = binaryFileIntent || /(?:file bana|generate file|export as|downloadable file|create (?:xlsx|docx|pdf|csv|json) file|\bcreate file\b|\bsave file\b)/i.test(promptMessage);
    if (wantsFile) {
      promptModules.push(`━━━ 📁 FILE GENERATION ENGINE ━━━
🚨 CRITICAL RULE: Only output a file block if you are generating the complete downloadable content right now.
For REAL Office files (.xlsx, .docx, .pdf, .pptx), output a SINGLE \`\`\`filespec block:
📊 xlsx: \`\`\`filespec\n{ "format":"xlsx", "filename":"name.xlsx", "sheets":[{"name":"Sheet1","headers":["Col1","Col2"],"rows":[["Val1","Val2"]]}] }\n\`\`\`
📝 docx: \`\`\`filespec\n{ "format":"docx", "filename":"name.docx", "title":"Doc Title", "blocks":[{"type":"heading","text":"...","level":1},{"type":"paragraph","text":"..."},{"type":"bullets","items":["..."]},{"type":"table","headers":[...],"rows":[[...]]}] }\n\`\`\`
📄 pdf:  \`\`\`filespec\n{ "format":"pdf", "filename":"name.pdf", "title":"Doc Title", "sections":[{"heading":"...","body":"..."}] }\n\`\`\`
📽️ pptx: \`\`\`filespec\n{ "format":"pptx", "filename":"name.pptx", "slides":[{"title":"...","bullets":["..."]}] }\n\`\`\`
For text/code files: \`\`\`<language> filename=<name.ext>\n<complete code>\n\`\`\` (csv, py, js, json, etc.).
NEVER output an empty file or filespec block.`);
    }

    // 3. DATA VISUALIZATION / CHARTS MODULE (~160 tokens — only if CSV/data present)
    const wantsChart = autoStats || /(?:generate chart|render chart|create graph|plot chart|bar chart|pie chart)/i.test(promptMessage);
    if (wantsChart) {
      promptModules.push(`━━━ 📊 DATA VISUALIZATION ENGINE ━━━
To render interactive charts directly in chat, use fenced block (no filename):
\`\`\`chart\n{ "title": "Chart Title", "type": "bar|line|pie|doughnut", "data": { "labels": ["A","B"], "datasets": [{ "label": "Metric", "data": [10, 20] }] } }\n\`\`\`
For tables: Use Markdown tables (| col1 | col2 |).`);
    }

    // 4. ROADMAP / MERMAID DIAGRAM MODULE (~120 tokens — only if diagram/flow/roadmap requested)
    const wantsDiagram = /(?:roadmap|flowchart|diagram|architecture flow|timeline|gantt|process flow)/i.test(promptMessage);
    if (wantsDiagram) {
      promptModules.push(`━━━ 🧭 ROADMAP & DIAGRAM ENGINE (Mermaid) ━━━
When asked for a flowchart, roadmap, or timeline, output a Mermaid block (no filename):
\`\`\`mermaid\nflowchart LR\n  A[Step 1] --> B[Step 2] --> C{Decision}\n  C -- Yes --> D[Goal]\n\`\`\``);
    }

    // 5. SCHEDULER MODULE (~160 tokens — only if scheduling or time reminder mentioned)
    const wantsSchedule = /(?:remind me|schedule a|schedule task|kal\s+\d|every day at|har din at|alarm lagao|notify me at)/i.test(promptMessage);
    if (wantsSchedule) {
      promptModules.push(`━━━ ⏰ SCHEDULED SELF-MESSAGING ━━━
When Master asks to schedule something, output a \`\`\`schedule block:
\`\`\`schedule\n{ "title": "Task Name", "prompt": "Detailed task instructions", "scheduledAt": "ISO_8601_IST_STRING", "repeat": "none|daily|weekly" }\n\`\`\``);
    }

    // 6. BUILDER DELEGATION MODULE (~140 tokens — only if explicit delegation requested)
    const wantsBuilder = req.body.collab || /(?:delegate to builder|builder ko assign|builder se code karwao|builder ko task de do|architect blueprint banao)/i.test(promptMessage);
    if (wantsBuilder) {
      promptModules.push(`━━━ 🏗️ BUILDER DELEGATION ━━━
🚨 CRITICAL RULE: Only output a \`\`\`builder block when you are assigning an immediate, complete instruction to Bob the Builder.
\`\`\`builder\n{ "title": "Project Title", "instruction": "Full detailed context and instructions for Bob the Builder" }\n\`\`\`
NEVER output an empty \`\`\`builder block or quote it in casual conversation sentences.`);
    }

    // 7. HACKATHON WORKSPACE MODULE (~120 tokens — only if hackathon mentioned)
    const wantsHackathon = /(?:hackathon|sih|devpost|unstop|vicodathon|prize pool|competition)/i.test(promptMessage);
    if (wantsHackathon) {
      promptModules.push(`━━━ 🏆 HACKATHON WORKSPACE ━━━
When analyzing a hackathon, output a structured card:
\`\`\`hackathon\n{ "title": "Hackathon Name", "link": "url", "prize": "...", "mode": "online|offline", "description": "...", "rules": [...] }\n\`\`\``);
    }

    // 8. MEDIA INTELLIGENCE MODULE (~120 tokens — only if video/reel/image present)
    if (mediaEnrichment.hasMedia || allImageUrls.length > 0) {
      promptModules.push(`━━━ 🎬 MEDIA INTELLIGENCE ENGINE ━━━
Auto-extracted media data is provided in context below. Read full transcript/captions and visually describe screenshot/image details accurately.`);
    }

    // Combine active modules
    const systemPrompt = `${promptModules.join('\n\n')}\n\n- You have full access to historical chat summaries, habits, and stored facts about Master Nikhil.\n${memoryContext}${mediaEnrichment.mediaContext}${documentContext}`;


    // 5. Call Answering Agent LLM.
    // One call, one router. callLLM() detects the images itself and auto-shifts
    // to a vision-capable model if the requested/configured one is text-only,
    // or to a bigger-context model if the prompt (docs, history, crawls) is too
    // large. `model` from the client is a HINT, not a hard override.
    const baseMessages = [
      { role: 'system', content: systemPrompt },
      ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    if (allImageUrls.length > 0) {
      console.log(`[Chat] ${allImageUrls.length} image(s) attached — vision routing engaged`);
    }

    const llmResult = await callLLM({
      role: 'chat',
      model,
      messages: [
        ...baseMessages,
        { role: 'user', content: promptMessage },
      ],
      userText: promptMessage,
      imageUrls: allImageUrls,
    });

    if (llmResult.routing && llmResult.routing.length) {
      console.log(`[Chat] model auto-shifted → ${llmResult.model} (${llmResult.routing.join(' | ')})`);
    }

    let { text, model: usedModel } = llmResult;

    // If we have verified real GitHub repos from GitHub Search API:
    // Strip any hallucinated markdown GitHub links `[...](https://github.com/...)` that the LLM generated in its text,
    // so Master only ever gets 100% real verified working repos.
    if (prebuiltRepoSection) {
      // Remove hallucinated `[title](https://github.com/...)` or bare `https://github.com/...` from LLM's body text
      let sanitizedText = (text || '')
        .replace(/\[([^\]]+)\]\(https?:\/\/github\.com\/[^\)]+\)/gi, '$1')
        .replace(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi, '')
        .trim();

      text = sanitizedText + prebuiltRepoSection;
    }

    // 6. Parse and extract any ```memory blocks from Bob's reply, then save them to memory database
    const memoryBlockRegex = /```memory\s*\n([\s\S]*?)```/g;
    let memMatch;
    while ((memMatch = memoryBlockRegex.exec(text)) !== null) {
      try {
        const memData = JSON.parse(memMatch[1].trim());
        const factText = memData.fact || memData.text;
        const factCat = memData.category || null;
        if (factText && factText.trim().length > 2) {
          await memory.addFactUnique(req.userId, factText.trim(), factCat, {
            sourceTitle: sessionTitle,
            sourceType: 'chat',
            sessionId,
          });
          console.log(`[Chat] Auto-saved memory fact from Bob: "${factText.trim()}"`);
        }
      } catch (memErr) {
        console.warn('[Chat] Failed to parse memory block:', memErr.message);
      }
    }

    // Strip ```memory blocks from assistant text so Master gets clean readable response
    text = text.replace(/```memory\s*\n[\s\S]*?```\n?/g, '').trim();

    // Save assistant's reply
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

    // 9. Background Memory Summarizer:
    // Periodically and automatically rolls up long conversations into compact weekly summaries
    // Runs in the background (non-blocking) so user response is never delayed.
    if (recent && recent.length >= 8) {
      memoryManager.runWeeklyRollingSummarizer(req.userId).catch((sumErr) => {
        console.warn('[Memory] Background rolling summarizer notice:', sumErr.message);
      });
    }

    res.json({
      reply: text,
      model: usedModel,
      // Non-empty when the router shifted off the requested model (e.g. images
      // attached to a text-only model). Lets the UI explain the swap.
      routing: llmResult.routing || [],
      scheduledTasks: createdTasks,
      updatedTitle,
    });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    const msg = /credits|quota|balance|afford/i.test(err.message)
      ? 'LLM call failed — credits/balance issue (OpenRouter pe credits add karo ya max_tokens kam rakho).'
      : 'LLM call failed';
    res.status(500).json({ error: msg, details: err.message });
  }
});

module.exports = router;
