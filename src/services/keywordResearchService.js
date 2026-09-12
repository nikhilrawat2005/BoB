const crypto = require('crypto');
const fetch = require('node-fetch');
const { db } = require('../config/firebase');
const { fetchWithTimeout, validatePublicUrl, scrapeURL } = require('./crawlerService');
const { callLLMParallel } = require('./llmService');

// ═══════════════════════════════════════════════════════════════════════════
//  Keyword Research Service
//
//  Fully independent SEO keyword layer. It never touches seoService.js or
//  crawlerService.js internals — it only reuses their public, safe helpers
//  (fetchWithTimeout for SSRF-safe HTTP, scrapeURL for competitor pages) plus
//  the shared LLM key-bucket pool via llmService.callLLMParallel.
//
//  Google integrations (Google Ads Keyword Planner, Google Search Console)
//  are engaged ONLY when the corresponding env vars are present. They are
//  implemented as plain REST calls (node-fetch v2 — already a dependency) and
//  reuse the Firebase service-account to mint an OAuth token, so no extra npm
//  packages and no extra credential files are required. Without creds the
//  pipeline degrades gracefully to deterministic, clearly-labelled data
//  (source: 'estimated' | 'unavailable') instead of hard-failing.
//
//  Env vars used (all optional):
//    GOOGLE_ADS_DEVELOPER_TOKEN   — Google Ads API developer token
//    GOOGLE_ADS_CUSTOMER_ID       — Ads manager/account id (e.g. 1234567890)
//    GOOGLE_SEARCH_CONSOLE_PROPERTY — optional override for the GSC site URL
//    SERPAPI_KEY                  — SerpAPI key for keyword ranking lookups
//    BRAVE_API_KEY                — Brave Search for competitor discovery
//  The Firebase service account (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)
//  is used to mint short-lived Google API tokens when it is set up.
// ═══════════════════════════════════════════════════════════════════════════

const STOPWORDS = new Set([
  'a','an','the','and','or','but','for','nor','on','at','in','of','to','is','are','was','were',
  'with','without','by','from','as','be','been','being','this','that','these','those','it','its',
  'i','you','your','we','our','they','their','he','she','his','her','what','which','who','whom',
  'how','why','when','where','do','does','did','have','has','had','not','no','so','if','then',
  'than','too','very','can','will','just','about','into','over','under','again','further','once',
  'here','there','all','any','both','each','few','more','most','other','some','such','only','own',
  'same','also','etc','e.g','i.e','vs','please','check','see','using','use','used','get','got',
  'make','made','one','two','three','yourself','theirs','am','via','www','http','https','com','org',
  'net','in','the','a','an','is','of','for','and','to','on','at','by','your','site','website'
]);

const MODIFIERS = ['best','top','how to','how do i','near me','for beginners','online','free','price','review','vs','affordable','steps to'];
const CITIES = ['delhi','mumbai','bangalore','india'];

// ──────────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/[^\w\s'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function looksRoutable(url) {
  const u = domainOf(url);
  return !!u && u.includes('.');
}

function detectGoogleCreds() {
  return {
    hasAdsKey: !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID),
    hasGsc: !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
    hasOAuthClient: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REFRESH_TOKEN),
  };
}

// Ordered, deduped candidates for the GSC property string, most-likely first.
// GSC is picky: URL-prefix properties must include the trailing slash, while
// domain properties use "sc-domain:<domain>". A mismatched string yields 404.
function gscPropertyCandidates(siteUrl) {
  const candidates = [];
  const push = (s) => {
    if (s && !candidates.some(c => c === s)) candidates.push(s);
  };
  push((process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY || '').trim());
  if (!siteUrl) return candidates;
  const raw = String(siteUrl).trim();
  const bare = raw.replace(/\/+$/, '');
  push(bare);
  if (bare.startsWith('https://') && !bare.includes('www.')) push(bare.replace('https://', 'https://www.'));
  if (raw === bare) push(bare + '/');
  const dom = bare.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  push('sc-domain:' + dom);
  return candidates;
}

// Mint a Google API access token.
// Preferred: a configured OAuth refresh token (GOOGLE_OAUTH_*).
// Fallback: exchange the Firebase service account (FIREBASE_CLIENT_EMAIL +
// FIREBASE_PRIVATE_KEY) for a short-lived offline JWT-backed bearer scoped to
// the requested Google scope. This lets Search Console / Ads work with the
// credentials the project already has.
async function getGoogleAccessToken(scope) {
  const { hasOAuthClient } = detectGoogleCreds();
  if (hasOAuthClient) {
    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('client_id', process.env.GOOGLE_OAUTH_CLIENT_ID);
    params.set('client_secret', process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    params.set('refresh_token', process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
    params.set('scope', scope);
    const body = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await body.json();
    if (!data.access_token) throw new Error(`Google OAuth failed: ${data.error || body.status}`);
    return data.access_token;
  }

  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('No Google credentials configured');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const assertion = `${b64(header)}.${b64(claims)}`;
  const signature = crypto.createSign('RSA-SHA256').update(assertion).sign(privateKey, 'base64');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${assertion}.${signature}`,
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google token exchange failed: ${data.error || res.status}`);
  return data.access_token;
}

// Health-check the Google Search Console integration before the first ranking
// lookup. Contacts the Search Console API, confirms the token works and that
// the chosen property is queryable. Never throws — returns a report object so
// the caller can log/display the outcome without aborting the pipeline.
// Returns { verified, gscUsed, property?, reachableSites?, reason?, message }.
async function autoVerifyGSC(siteUrl) {
  const { hasGsc, hasOAuthClient } = detectGoogleCreds();
  const gscUsed = hasGsc || hasOAuthClient;
  if (!gscUsed) {
    return {
      verified: false,
      gscUsed: false,
      reason: 'no-credentials',
      message: 'No GSC credentials configured (FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or GOOGLE_OAUTH_*). Ranking checks will fall back to SerpAPI or report unavailable.',
    };
  }
  if (process.env.GSC_ENABLED === 'false') {
    return { verified: false, gscUsed: true, reason: 'disabled', message: 'GSC is disabled via GSC_ENABLED=false.' };
  }

  let token;
  try {
    token = await getGoogleAccessToken('https://www.googleapis.com/auth/webmasters.readonly');
  } catch (err) {
    return { verified: false, gscUsed: true, reason: 'token-failed', message: `GSC token minting failed: ${err.message}` };
  }

  const candidates = gscPropertyCandidates(siteUrl);
  if (!candidates.length) {
    return { verified: false, gscUsed: true, reason: 'no-property', message: 'No GSC property to probe — set GOOGLE_SEARCH_CONSOLE_PROPERTY or pass the site URL.' };
  }

  // 1) Advisory: does the token see any matching property in the account list?
  try {
    const listRes = await withTimeout(
      fetch('https://searchconsole.googleapis.com/v1/sites', { headers: { Authorization: `Bearer ${token}` } }),
      'GSC sites list'
    );
    const listText = await listRes.text();
    const list = listText ? JSON.parse(listText) : {};
    if (listRes.ok && Array.isArray(list.siteEntry)) {
      const reachableSites = list.siteEntry.map(s => s.siteUrl);
      if (reachableSites.length) {
        const match = candidates.find(c => reachableSites.some(s => s === c || s === c.replace('//www.', '//') || c === s.replace('//www.', '//')));
        if (match) {
          // Put the exact match first so the probe uses the registered spelling.
          candidates.sort((a, b) => (a === match ? -1 : b === match ? 1 : 0));
        } else {
          return {
            verified: false,
            gscUsed: true,
            property: candidates[0],
            reachableSites,
            reason: 'property-not-listed',
            message: `Property (tried ${candidates.join(', ')}) is not in the account's Search Console site list. Reachable properties: ${reachableSites.join(', ') || 'none'}. Add "${reachableSites[0] || 'the property'}" as a user (Full permission) to firebase-adminsdk-fbsvc@bob-3ff28.iam.gserviceaccount.com, or set GOOGLE_SEARCH_CONSOLE_PROPERTY to a verified property.`,
          };
        }
      }
    }
  } catch (err) {
    // sites.list is advisory only — fall through to the authoritative probe.
  }

  // 2) Authoritative: run a real (tiny) Search Analytics query against each
  //    candidate property. Proves the token + property combo is queryable.
  const end = new Date();
  const start = new Date(Date.now() - 6 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const body = { startDate: fmt(start), endDate: fmt(end), dimensions: ['query'], rowLimit: 1 };
  const errors = [];
  for (const cand of candidates) {
    const url = `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(cand)}/searchAnalytics/query`;
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
        'GSC probe'
      );
      const resText = await res.text();
      if (res.ok) {
        return { verified: true, gscUsed: true, property: cand, message: 'GSC access verified — Search Console API reachable and property is queryable.' };
      }
      let detail = `GSC HTTP ${res.status}`;
      try { const j = resText ? JSON.parse(resText) : {}; detail = (j.error && j.error.message) || detail; } catch {}
      errors.push(`${cand} → ${detail}`);
    } catch (err) {
      errors.push(`${cand} → ${err.message}`);
    }
  }
  return { verified: false, gscUsed: true, property: candidates[0], reason: 'probe-failed', message: errors.join(' | ') };
}

// Deterministic-but-plausible synthetic keyword metrics. Used ONLY when no
// real keyword data source is configured, so the pipeline stays testable and
// honest (source is tagged 'estimated').
function estimateKeywordMetrics(keyword) {
  const h = crypto.createHash('sha1').update(String(keyword).toLowerCase()).digest();
  const v = (h[0] + (h[1] << 8) + (h[2] << 16)) % 4800 + 50;
  const volume = Math.round(v / 10) * 10;
  const competitionIndex = ((h[3] + (h[4] << 8)) % 10000) / 10000; // 0..1
  const competition = competitionIndex > 0.66 ? 'HIGH' : competitionIndex > 0.33 ? 'MEDIUM' : 'LOW';
  const cpcLowCents = 100 + ((h[5] << 8) % 300);            // $1.00..$3.99
  const cpcLow = +(cpcLowCents / 100).toFixed(2);
  const cpcHigh = +((cpcLowCents * (1.4 + (h[6] % 10) / 10)) / 100).toFixed(2);
  return { volume, competition, competitionIndex: +competitionIndex.toFixed(2), cpcLow, cpcHigh };
}

function parseLooseJsonArray(text) {
  const cleaned = (text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeKeyword(k) {
  return String(k || '').toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function withTimeout(promise, label, ms = 20000) {
  let timer;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutP]);
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. extractSeedKeywords(auditData, siteUrl)
//    Pulls candidate topic keywords out of an existing SEO audit payload.
// ──────────────────────────────────────────────────────────────────────────────

function extractSeedKeywords(auditData = {}, siteUrl = '') {
  const audit = auditData || {};
  const signals = audit.signals || {};
  const pages = Array.isArray(audit.crawledPages) ? audit.crawledPages : [];
  const checks = Array.isArray(audit.keywordChecks) ? audit.keywordChecks : [];

  const corpus = [];
  if (checks.length) {
    checks.forEach(c => {
      if (c && c.keyword) corpus.push(c.keyword);
    });
  }
  if (signals.title) corpus.push(signals.title);
  if (signals.metaDescription) corpus.push(signals.metaDescription);
  if (Array.isArray(signals.h1Texts)) signals.h1Texts.forEach(t => corpus.push(t));
  if (signals.ogTitle) corpus.push(signals.ogTitle);
  pages.slice(0, 40).forEach(p => {
    if (p && p.title) corpus.push(p.title);
  });

  const phrases = new Map();
  const bump = (key) => phrases.set(key, (phrases.get(key) || 0) + 1);

  corpus.forEach(raw => {
    const clean = stripHtml(raw).toLowerCase();
    if (clean.length < 3) return;
    const tokens = clean.split(/[\s-]+/).filter(Boolean);
    const segment = [];
    tokens.forEach(tok => {
      const tk = tok.replace(/[^a-z0-9]/g, '');
      if (tk.length < 2) return;
      if (STOPWORDS.has(tk)) {
        if (segment.length) {
          bump(segment.join(' '));
          if (segment.length > 1) bump(segment.slice(-2).join(' '));
          segment.length = 0;
        }
        return;
      }
      segment.push(tk);
    });
    if (segment.length) {
      bump(segment.join(' '));
      if (segment.length > 1) bump(segment.slice(-2).join(' '));
    }
  });

  const scored = [...phrases.entries()]
    .filter(([phrase]) => {
      const words = phrase.split(' ').filter(w => w.length > 2);
      return words.length >= 1 && words.length <= 4 && phrase.length >= 3;
    })
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length));

  // Take high-frequency phrases, then backfill with unique longer phrases so
  // the seed set stays topically rich.
  const seeds = [];
  const seen = new Set();
  for (const [phrase, count] of scored) {
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    const score = count >= 2 ? count * 10 : 5;
    seeds.push(phrase);
    if (seeds.length >= 14) break;
  }
  for (const [phrase] of scored) {
    if (seeds.length >= 20) break;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    seeds.push(phrase);
  }
  return seeds.slice(0, 20);
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. getKeywordIdeas(seedKeywords, locationTargets, languageTargets)
//    Returns keyword ideas with volume / competition / CPC.
//    Tries: Google Ads Keyword Planner REST → deterministic estimation.
// ──────────────────────────────────────────────────────────────────────────────

async function fetchGoogleAdsKeywordIdeas(seedKeywords = []) {
  const token = await getGoogleAccessToken('https://www.googleapis.com/auth/adwords');
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/[^0-9]/g, '');
  const geo = (process.env.GOOGLE_ADS_GEO_TARGET || '2840').trim(); // 2840 = India

  const url = `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:generateKeywordIdeas`;
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        keywordSeed: { keywords: seedKeywords.slice(0, 20) },
        language: 'en',
        geoTargetConstants: [`geoTargetConstant/${geo}`],
        includeAdultKeywords: false,
        seedKeywordPublishFlag: 'NO_PUBLISH',
      }),
    }),
    'Google Ads Keyword Ideas'
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${(data.error && data.error.message) || JSON.stringify(data).slice(0, 300)}`);

  const ideas = [];
  (data.results || []).forEach(result => {
    (result.keywordIdeas || []).forEach(k => {
      const m = k.keywordPlanMetrics || {};
      const compIdx = typeof m.competitionIndex === 'number' ? m.competitionIndex / 100 : null;
      ideas.push({
        keyword: k.text,
        volume: m.averageMonthlySearches || 0,
        competition: compIdx == null ? 'MEDIUM' : compIdx > 0.66 ? 'HIGH' : compIdx > 0.33 ? 'MEDIUM' : 'LOW',
        competitionIndex: compIdx == null ? null : +compIdx.toFixed(2),
        cpcLow: m.lowTopOfPageBidMicros ? +(m.lowTopOfPageBidMicros / 1000000).toFixed(2) : null,
        cpcHigh: m.highTopOfPageBidMicros ? +(m.highTopOfPageBidMicros / 1000000).toFixed(2) : null,
        source: 'google-ads',
      });
    });
  });
  return ideas.filter(i => i.keyword);
}

async function getKeywordIdeas(seedKeywords = [], locationTargets = [], languageTargets = ['en']) {
  const { hasAdsKey } = detectGoogleCreds();
  let ideas = [];

  if (hasAdsKey) {
    try {
      ideas = await fetchGoogleAdsKeywordIdeas(seedKeywords);
    } catch (err) {
      console.warn('[keywords] Google Ads Keyword Planner unavailable, falling back to estimation:', err.message);
    }
  }

  if (ideas.length === 0) {
    // Deterministic idea expansion so the pipeline always produces useful output.
    const base = seedKeywords.filter(Boolean).map(k => String(k).trim()).slice(0, 12);
    const candidates = [];
    base.forEach(kw => {
      candidates.push(kw);
      // only decorate phrases that don't already carry a modifier
      const isModified = MODIFIERS.some(m => kw === m || kw.startsWith(`${m} `));
      if (!isModified) {
        MODIFIERS.forEach(m => candidates.push(`${m} ${kw}`));
      }
    });
    // City-qualified variants for local intent.
    base.forEach(kw => CITIES.forEach(city => candidates.push(`${kw} in ${city}`)));

    const seen = new Set();
    const out = [];
    candidates.forEach(raw => {
      const kw = normalizeKeyword(raw);
      if (!kw || seen.has(kw)) return;
      if (kw.split(' ').length > 6) return;
      if (/(\w+) \1/.test(kw)) return;          // "best best" style duplicates
      if (/\s(in|for|on) (and|the|a)\b/.test(kw)) return; // trailing glue junk
      if (/^(near me|how do i)\b/.test(kw) && kw.split(' ').length < 3) return; // thin modifiers
      seen.add(kw);
      const metrics = estimateKeywordMetrics(kw);
      out.push({ keyword: kw, ...metrics, source: 'estimated' });
    });
    ideas = out.slice(0, 30);
  }

  const languageFilter = (languageTargets || []).length ? new Set(languageTargets.map(l => String(l).toLowerCase())) : null;
  if (languageFilter) {
    // crude filter — mostly informational; scripts are Latin-letter based here
    ideas = ideas.filter(i => /^[\x20-\x7E]+$/.test(i.keyword || ''));
  }
  return ideas;
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. checkKeywordRanking(keyword, siteUrl)
//    GSC Search Analytics first, SerpAPI fallback. Same return shape:
//    { keyword, position, source: 'gsc'|'serpapi'|'unavailable', impressions?, clicks?, ctr? }
// ──────────────────────────────────────────────────────────────────────────────

const SERPAPI_TOP = 100;

async function gscCheck(keyword, siteUrl) {
  const token = await getGoogleAccessToken('https://www.googleapis.com/auth/webmasters.readonly');
  const candidates = gscPropertyCandidates(siteUrl);
  const end = new Date();
  const start = new Date(Date.now() - 27 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const body = {
    startDate: fmt(start),
    endDate: fmt(end),
    dimensions: ['query'],
    rowLimit: 100,
  };
  const needle = normalizeKeyword(keyword);
  const errors = [];
  for (const cand of candidates) {
    const url = `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(cand)}/searchAnalytics/query`;
    let res;
    try {
      res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
        'GSC Search Analytics'
      );
    } catch (err) {
      errors.push(`${cand} → ${err.message}`);
      continue;
    }
    const data = await res.json();
    if (!res.ok) {
      errors.push(`${cand} → GSC ${res.status}: ${(data.error && data.error.message) || 'property not accessible'}`);
      continue;
    }
    const row = (data.rows || []).find(r => normalizeKeyword(r.keys && r.keys[0]) === needle);
    if (!row) return { found: false, source: 'gsc' };
    return {
      found: true,
      source: 'gsc',
      position: Math.round(row.position),
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
    };
  }
  throw new Error(errors.join(' | ') || 'GSC not reachable');
}

async function serpApiCheck(keyword, siteUrl) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { found: false, source: 'serpapi' };
  const host = domainOf(siteUrl);
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({
      engine: 'google',
      q: keyword,
      api_key: apiKey,
      gl: 'in',
      num: '20',
      ...(page > 0 ? { page: String(page + 1) } : {}),
    });
    const res = await withTimeout(
      fetchWithTimeout(`https://serpapi.com/search.json?${qs.toString()}`, {}, 15000),
      `SerpAPI ${keyword}`
    );
    if (!res.ok) {
      let detail = `SerpAPI HTTP ${res.status}`;
      try { const j = JSON.parse(res.text); detail = j.error || detail; } catch {}
      throw new Error(detail);
    }
    let j;
    try { j = JSON.parse(res.text); } catch { throw new Error('SerpAPI returned non-JSON'); }
    const org = Array.isArray(j.organic_results) ? j.organic_results : [];
    const offset = page * 20;
    for (let i = 0; i < org.length; i++) {
      const link = org[i] && org[i].link;
      if (link && domainOf(link) === host) {
        return { found: true, source: 'serpapi', position: offset + i + 1 };
      }
    }
    if (j.pagination && j.pagination.current === SERPAPI_TOP) break;
    if (org.length === 0) break;
  }
  return { found: false, source: 'serpapi' };
}

async function checkKeywordRanking(keyword, siteUrl) {
  const { hasGsc, hasOAuthClient } = detectGoogleCreds();
  const gscAvailable = hasGsc || hasOAuthClient;
  const base = { keyword: normalizeKeyword(keyword) || String(keyword).trim() };

  if (gscAvailable && process.env.GSC_ENABLED !== 'false') {
    try {
      const r = await gscCheck(keyword, siteUrl);
      if (r.found) {
        return {
          ...base,
          position: r.position || null,
          source: 'gsc',
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: r.ctr,
          measuredAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn(`[keywords] GSC check failed for "${keyword}", falling back to SerpAPI:`, err.message);
    }
  }

  if (process.env.SERPAPI_KEY) {
    try {
      const r = await serpApiCheck(keyword, siteUrl);
      return {
        ...base,
        position: r.found ? r.position : null,
        source: 'serpapi',
        measuredAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn(`[keywords] SerpAPI check failed for "${keyword}":`, err.message);
      return { ...base, position: null, source: 'unavailable', measuredAt: new Date().toISOString(), error: err.message };
    }
  }

  return { ...base, position: null, source: 'unavailable', measuredAt: new Date().toISOString() };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. recordRankingSnapshot(siteId, keyword, rankingResult)
//    Appends a time-series snapshot to the stored keywordData keyword.
//    Append-always (same-day entries are updated in place instead of
//    duplicated, older snapshots are never overwritten).
// ──────────────────────────────────────────────────────────────────────────────

async function recordRankingSnapshot(userId, siteId, keyword, rankingResult) {
  const coll = db.collection('users').doc(userId).collection('seoSites');
  const ref = coll.doc(siteId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Site not found');
  const site = snap.data() || {};
  const kd = site.keywordData || { keywords: [] };
  const keywords = Array.isArray(kd.keywords) ? kd.keywords : [];
  const kw = normalizeKeyword(keyword);
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today,
    position: rankingResult.position ?? null,
    source: rankingResult.source || 'unavailable',
    ...(rankingResult.impressions != null ? { impressions: rankingResult.impressions } : {}),
    ...(rankingResult.clicks != null ? { clicks: rankingResult.clicks } : {}),
    ...(rankingResult.ctr != null ? { ctr: rankingResult.ctr } : {}),
  };

  let idx = keywords.findIndex(k => normalizeKeyword(k.keyword || '') === kw);
  if (idx === -1) {
    keywords.push({
      keyword: kw,
      volume: 0,
      competition: 'MEDIUM',
      competitionIndex: null,
      cpcLow: null,
      cpcHigh: null,
      currentRank: null,
      priority: 'medium',
      rankHistory: [entry],
    });
    idx = keywords.length - 1;
  } else {
    const history = Array.isArray(keywords[idx].rankHistory) ? keywords[idx].rankHistory : [];
    const sameDay = history.find(h => h.date === today);
    if (sameDay) {
      Object.assign(sameDay, entry);
    } else {
      history.push(entry);
    }
    keywords[idx].rankHistory = history.slice(-30);
    keywords[idx].currentRank = entry.position;
  }

  const prev = kd.history || [];
  const nowIso = new Date().toISOString();
  kd.keywords = keywords;
  kd.lastRankingCheck = nowIso;
  kd.score = computeKeywordHealth(keywords, kd.score);
  kd.history = appendHealthHistory(prev, kd.score, nowIso);

  await ref.set({ keywordData: kd }, { merge: true });
  return keywords[idx];
}

function appendHealthHistory(prev, score, atIso) {
  const arr = Array.isArray(prev) ? prev : [];
  const entry = { date: atIso.slice(0, 10), score };
  if (arr.length && arr[arr.length - 1].date === entry.date) {
    arr[arr.length - 1] = entry;
  } else {
    arr.push(entry);
  }
  return arr.slice(-10);
}

function computeKeywordHealth(keywords = [], prevScore) {
  if (!keywords.length) return prevScore != null ? prevScore : 0;
  let total = 0;
  keywords.forEach(k => {
    let s = 25; // base for having identified the keyword
    const ci = typeof k.competitionIndex === 'number' ? k.competitionIndex : 0.5;
    s += Math.round((1 - ci) * 25);
    const v = typeof k.volume === 'number' ? k.volume : 0;
    s += Math.min(25, Math.round(v / 500) * 5);
    if (k.currentRank == null) {
      s += 0;
    } else if (k.currentRank <= 3) {
      s += 25;
    } else if (k.currentRank <= 10) {
      s += 18;
    } else if (k.currentRank <= 30) {
      s += 10;
    } else {
      s += 4;
    }
    total += Math.max(0, Math.min(100, s));
  });
  return Math.round(total / keywords.length);
}

function priorityFor(k) {
  const needsRank = k.currentRank == null;
  const lowComp = typeof k.competitionIndex === 'number' ? k.competitionIndex < 0.4 : (k.competition === 'LOW');
  const bigVolume = typeof k.volume === 'number' ? k.volume >= 1000 : false;
  if (needsRank && bigVolume && lowComp) return 'high';
  if (needsRank && lowComp) return 'high';
  if (needsRank) return 'medium';
  if (!lowComp && (k.currentRank == null || k.currentRank > 30)) return 'medium';
  if (bigVolume && k.currentRank != null && k.currentRank <= 30) return 'medium';
  return 'low';
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. findCompetitors(niche, siteUrl, userProvidedUrls)
//    User URLs first (validated), then auto-discovery via Brave Search (when
//    configured) or the LLM pool, then reachability check.
// ──────────────────────────────────────────────────────────────────────────────

async function validateAndFetchTitle(url) {
  try {
    await validatePublicUrl(url);
  } catch (err) {
    return null;
  }
  try {
    const res = await withTimeout(fetchWithTimeout(url, {}, 12000), `Competitor fetch ${url}`);
    if (!res.ok) return null;
    const m = res.text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    return { url, reachable: true, title: m ? stripHtml(m[1]).slice(0, 180) : '' };
  } catch {
    return null;
  }
}

async function findCompetitors(niche = '', siteUrl = '', userProvidedUrls = []) {
  const mine = domainOf(siteUrl);
  const found = [];
  const seen = new Set();

  const add = (url, source) => {
    if (!url || !looksRoutable(url)) return;
    const u = url.replace(/\/+$/, '');
    const d = domainOf(u);
    if (!d || d === mine || seen.has(d)) return;
    seen.add(d);
    found.push({ url: u, source });
  };

  (Array.isArray(userProvidedUrls) ? userProvidedUrls : []).forEach(u => add(String(u).trim(), 'user'));

  const topic = niche || '';

  if (found.length === 0 && process.env.BRAVE_API_KEY) {
    try {
      const qs = new URLSearchParams({ q: `${topic} ${mine}`.trim(), count: '8', source: 'web', result_filter: 'web' });
      const res = await withTimeout(
        fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?${qs.toString()}`, {
          headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
        }, 15000),
        'Brave competitor search'
      );
      if (res.ok) {
        const j = JSON.parse(res.text);
        (j.web && j.web.results || []).forEach(r => add(r.url, 'auto-discovered'));
      }
    } catch (err) {
      console.warn('[keywords] Brave competitor discovery failed:', err.message);
    }
  }

  if (found.length === 0) {
    // LLM-assisted discovery as a final fallback.
    try {
      const tasks = [{
        messages: [
          { role: 'system', content: 'You are a competitor research analyst. Reply ONLY with valid JSON, no markdown. Return a JSON array of 5 objects {url, title} pointing at real competitors for a website in the given niche.' },
          { role: 'user', content: JSON.stringify({ niche: topic, mySite: siteUrl }) },
        ],
        temperature: 0.2,
        max_tokens: 600,
      }];
      const results = await callLLMParallel(tasks, { role: 'seo', persona: 'builder', concurrencyPerKey: 2, model: process.env.SEO_MODEL });
      const arr = parseLooseJsonArray(results[0] && results[0].text);
      (Array.isArray(arr) ? arr : []).forEach(r => add(r.url || r, 'auto-discovered'));
    } catch (err) {
      console.warn('[keywords] LLM competitor discovery failed:', err.message);
    }
  }

  // Reachability check + titles for the final list (bounded).
  const checked = [];
  for (const c of found.slice(0, 6)) {
    const info = await validateAndFetchTitle(c.url);
    if (info) checked.push({ url: c.url, source: c.source, title: info.title });
    else checked.push({ url: c.url, source: c.source, reachable: false });
  }
  return checked;
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. analyzeCompetitorGaps(mySiteContent, competitorUrls, keywordList)
//    Keyword-vs-competitor coverage matrix + optional LLM insight.
// ──────────────────────────────────────────────────────────────────────────────

async function analyzeCompetitorGaps(mySiteContent = '', competitorUrls = [], keywordList = []) {
  const myText = String(mySiteContent || '').toLowerCase();
  const keywords = (Array.isArray(keywordList) ? keywordList : []).slice(0, 25);
  const urls = (Array.isArray(competitorUrls) ? competitorUrls : []).slice(0, 5);

  const coverage = {};
  keywords.forEach(k => {
    const kw = String(k).toLowerCase();
    coverage[kw] = { keyword: kw, myCovered: myText.includes(kw), competitorCovered: 0, competitors: [] };
  });

  for (const comp of urls) {
    try {
      const scraped = await withTimeout(scrapeURL(comp.url || comp), `Scrape ${comp.url || comp}`, 15000);
      const scrapedText = typeof scraped === 'object' && scraped
        ? `${scraped.title || ''} ${scraped.description || ''} ${scraped.contentSnippet || ''}`
        : '';
      const compText = stripHtml(scrapedText).toLowerCase();
      keywords.forEach(k => {
        const kw = String(k).toLowerCase();
        if (compText.includes(kw)) {
          coverage[kw].competitorCovered += 1;
          coverage[kw].competitors.push(domainOf(comp.url || comp) || comp);
        }
      });
    } catch (err) {
      console.warn(`[keywords] Competitor scrape skipped for ${comp.url || comp}:`, err.message);
    }
  }

  const gaps = keywords.map(k => {
    const c = coverage[String(k).toLowerCase()];
    const gapScore = c.myCovered ? (c.competitorCovered === 0 ? 0 : 0.4) : c.competitorCovered > 0 ? 1 : 0.3;
    return {
      keyword: c.keyword,
      myCovered: c.myCovered,
      competitorsCovering: c.competitorCovered,
      coveringSites: c.competitors.slice(0, 3),
      gapScore,
      note: c.myCovered
        ? (c.competitorCovered === 0 ? 'You cover it, competitors largely ignore it — a defensive win.' : 'Covered by both — maintain depth.')
        : (c.competitorCovered > 0 ? 'Competitors rank for this and you have little/no coverage — a content gap.' : 'Wide open topic — nobody observed covering it, high upside.'),
    };
  }).sort((a, b) => b.gapScore - a.gapScore);

  let llmInsights = null;
  try {
    const gapsForLlm = gaps.slice(0, 10).map(g => ({ keyword: g.keyword, gapScore: g.gapScore, note: g.note }));
    const tasks = [{
      messages: [
        { role: 'system', content: 'You are an SEO strategist. Reply ONLY with valid JSON, no markdown. Return a JSON object {"summary": "1-2 sentence niche gap summary", "quickWins": ["3 short actionable content ideas"], "keywordsToAvoid": ["up to 3"]}.' },
        { role: 'user', content: JSON.stringify({ mySiteContentExcerpt: String(mySiteContent || '').slice(0, 1500), gaps: gapsForLlm }) },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }];
    const results = await callLLMParallel(tasks, { role: 'seo', persona: 'builder', concurrencyPerKey: 2, model: process.env.SEO_MODEL });
    const parsed = tryParseJsonObject(results[0] && results[0].text);
    if (parsed) llmInsights = parsed;
  } catch (err) {
    console.warn('[keywords] Gap LLM insights unavailable:', err.message);
  }

  return { gaps, llmInsights };
}

function tryParseJsonObject(text) {
  const cleaned = (text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. generateGrowthActions(keywordData, competitorGaps, siteUrl)
//    LLM-first (same role/persona/model routing as seoService), deterministic
//    fallback so growthActions are always produced.
// ──────────────────────────────────────────────────────────────────────────────

async function generateGrowthActions(keywordData = {}, competitorGaps = null, siteUrl = '') {
  const keywords = Array.isArray(keywordData.keywords) ? keywordData.keywords : [];
  const sorted = keywords.slice().sort((a, b) => (priorityOrder(b) - priorityOrder(a)) || ((a.currentRank == null) - (b.currentRank == null)));
  const llmInput = sorted.slice(0, 20).map(k => ({
    keyword: k.keyword,
    volume: k.volume,
    competition: k.competition,
    competitionIndex: k.competitionIndex,
    currentRank: k.currentRank,
    priority: k.priority || '',
  }));
  const gapsInput = (competitorGaps && Array.isArray(competitorGaps.gaps) ? competitorGaps.gaps : []).slice(0, 10);

  let actions = null;
  try {
    const tasks = [{
      messages: [
        { role: 'system', content: `You are an action-planning SEO expert for ${siteUrl}. Reply ONLY with valid JSON, no markdown, no code fences. Return a JSON array of up to 8 objects with EXACTLY these keys: {keyword, issue, recommendation, category, priority}. category must be one of: "content","onpage","links","technical". priority must be one of: "high","medium","low". Every recommendation must be concrete and executable.` },
        { role: 'user', content: JSON.stringify({ keywords: llmInput, competitorGaps: gapsInput }) },
      ],
      temperature: 0.3,
      max_tokens: 800,
    }];
    const results = await callLLMParallel(tasks, { role: 'seo', persona: 'builder', concurrencyPerKey: 2, model: process.env.SEO_MODEL });
    const arr = parseLooseJsonArray(results[0] && results[0].text);
    if (Array.isArray(arr)) {
      actions = arr
        .filter(a => a && a.keyword && a.recommendation)
        .slice(0, 10)
        .map(a => ({
          keyword: String(a.keyword),
          issue: String(a.issue || 'Needs improvement'),
          recommendation: String(a.recommendation),
          category: ['content', 'onpage', 'links', 'technical'].includes(a.category) ? a.category : 'content',
          priority: ['high', 'medium', 'low'].includes(a.priority) ? a.priority : 'medium',
        }));
    }
  } catch (err) {
    console.warn('[keywords] Growth actions LLM call failed, using deterministic fallback:', err.message);
  }

  if (!actions || !actions.length) {
    actions = buildFallbackActions(keywords, competitorGaps);
  }
  return actions;
}

function priorityOrder(k) {
  return k.currentRank == null ? 3 : k.currentRank <= 10 ? 2 : k.currentRank <= 30 ? 1 : 0;
}

function buildFallbackActions(keywords, competitorGaps) {
  const actions = [];
  const gaps = (competitorGaps && Array.isArray(competitorGaps.gaps)) ? competitorGaps.gaps : [];
  const gapKeywords = gaps.filter(g => g.gapScore > 0.5).map(g => g.keyword);

  keywords.slice(0, 8).forEach(k => {
    if (k.currentRank == null) {
      actions.push({
        keyword: k.keyword,
        issue: 'Not ranking on page 1 yet',
        recommendation: `Publish a dedicated page/section targeting "${k.keyword}" with a matching title tag, H1 and 900+ words of genuinely useful content, then link to it from the homepage.`,
        category: 'content',
        priority: priorityFor(k),
      });
    } else if (k.currentRank > 10) {
      actions.push({
        keyword: k.keyword,
        issue: `Ranking around position ${k.currentRank} — just outside page 1`,
        recommendation: `Improve on-page relevance for "${k.keyword}": add it to the H1, first paragraph and image alt text, and earn 2-3 internal links from your strongest pages.`,
        category: 'onpage',
        priority: 'medium',
      });
    }
  });

  gapKeywords.slice(0, 4).forEach(kw => {
    if (!actions.some(a => a.keyword === kw)) {
      actions.push({
        keyword: kw,
        issue: 'Competitor content gap — rivals cover it, you do not',
        recommendation: `Create a comparison/guide article for "${kw}" answering the questions your competitors miss, with a linkable stats section.`,
        category: 'content',
        priority: 'high',
      });
    }
  });

  if (keywords.some(k => k.currentRank != null && k.currentRank > 0 && k.currentRank <= 30)) {
    actions.push({
      keyword: keywords.find(k => k.currentRank != null && k.currentRank <= 30)?.keyword || '',
      issue: 'Page-1 ranking close to being a top-3 result',
      recommendation: 'Add structured data (FAQ/HowTo) and refresh the snippet-focused answer to win the featured snippet for this keyword.',
      category: 'technical',
      priority: 'medium',
    });
  }

  if (actions.length === 0) {
    actions.push({
      keyword: keywords[0] ? keywords[0].keyword : 'core topics',
      issue: 'No ranking data captured yet',
      recommendation: 'Run "Refresh Rankings" to capture live positions, then focus on the highest-volume, lowest-competition keyword first.',
      category: 'content',
      priority: 'medium',
    });
  }
  return actions.slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. Orchestrator — runKeywordResearch(userId, siteId, siteUrl, auditData, opts)
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTS = { ideaLimit: 20, rankLimit: 8, locationTargets: [], languageTargets: ['en'], userProvidedUrls: [] };

async function runKeywordResearch(userId, siteId, siteUrl, auditData = {}, options = {}) {
  const opts = { ...DEFAULT_OPTS, ...(options || {}) };
  const coll = db.collection('users').doc(userId).collection('seoSites');
  const siteSnap = await coll.doc(siteId).get();
  const site = siteSnap.exists ? siteSnap.data() : {};
  const url = site.url || siteUrl || site.domain;
  if (!url) throw new Error('Site URL is required');

  const results = {};

  // 1) Seeds
  results.seeds = extractSeedKeywords(auditData, url);
  const tracked = Array.isArray(site.keywords) ? site.keywords : [];
  const seeds = [...new Set([...results.seeds, ...tracked.map(k => String(k).toLowerCase())])].slice(0, 20);

  // 2) Ideas
  results.ideas = await getKeywordIdeas(seeds, opts.locationTargets, opts.languageTargets);
  const ideas = results.ideas.slice(0, opts.ideaLimit || 20);

  if (!ideas.length) throw new Error('No keyword ideas could be generated');

  // 3) Rankings for the top candidates (after verifying GSC access once)
  results.gscVerification = await autoVerifyGSC(url);
  const rankTargets = ideas.slice(0, opts.rankLimit || 8);
  for (const idea of rankTargets) {
    try {
      const rank = await checkKeywordRanking(idea.keyword, url);
      const curRank = rank.position != null ? rank.position : null;
      idea.currentRank = curRank;
    } catch (err) {
      console.warn(`[keywords] Ranking check skipped for "${idea.keyword}":`, err.message);
    }
  }

  // 4) Competitors
  const niche = seeds[0] || domainOf(url);
  const competitors = await findCompetitors(niche, url, opts.userProvidedUrls);

  // 5) Competitor gaps
  const myContent = [
    auditData.summary,
    auditData.signals && auditData.signals.title,
    auditData.signals && auditData.signals.metaDescription,
    Array.isArray(auditData.signals && auditData.signals.h1Texts) ? auditData.signals.h1Texts.join(' ') : '',
    Array.isArray(auditData.crawledPages) ? auditData.crawledPages.slice(0, 20).map(p => p.title).join(' ') : '',
  ].filter(Boolean).join(' | ');

  results.competitorGaps = await analyzeCompetitorGaps(myContent, competitors, ideas.map(i => i.keyword));

  // 6) Growth actions
  const keywordDataDraft = {
    keywords: ideas.map(i => ({
      keyword: i.keyword,
      volume: i.volume,
      competition: i.competition,
      competitionIndex: i.competitionIndex,
      cpcLow: i.cpcLow,
      cpcHigh: i.cpcHigh,
      currentRank: i.currentRank ?? null,
      source: i.source || 'estimated',
      rankHistory: i.rankHistory || [],
      priority: 'medium',
    })),
  };
  results.actions = await generateGrowthActions(keywordDataDraft, results.competitorGaps, url);

  // 7) Assemble + persist
  const prev = site.keywordData || {};
  const mergedKeywords = mergeKeywordData((prev.keywords || []), keywordDataDraft.keywords);
  mergedKeywords.forEach(k => { k.priority = priorityFor(k); });

  const score = computeKeywordHealth(mergedKeywords, typeof prev.score === 'number' ? prev.score : null);
  const nowIso = new Date().toISOString();
  const firstRankSource = mergedKeywords.map(k => k.rankHistory && k.rankHistory[k.rankHistory.length - 1]).find(r => r && r.source && r.source !== 'unavailable');

  const keywordData = {
    score,
    history: appendHealthHistory(prev.history || [], score, nowIso),
    lastFullResearch: nowIso,
    lastRankingCheck: nowIso,
    rankingSource: firstRankSource ? firstRankSource.source : (process.env.SERPAPI_KEY ? 'serpapi' : (process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? 'google-ads' : 'estimated')),
    keywords: mergedKeywords,
    competitors: Array.isArray(prev.competitors) ? mergeCompetitors(prev.competitors, competitors) : competitors,
    growthActions: results.actions,
    competitorGaps: results.competitorGaps && results.competitorGaps.gaps ? results.competitorGaps.gaps.slice(0, 15) : [],
    gapInsights: results.competitorGaps && results.competitorGaps.llmInsights,
    seeds: results.seeds.slice(0, 20),
    meta: {
      ideaSource: results.ideas[0] && results.ideas[0].source,
      seeder: 'audit',
      gscVerification: results.gscVerification || null,
    },
    updatedAt: nowIso,
  };

  await coll.doc(siteId).set({ keywordData, updatedAt: nowIso }, { merge: true });
  return keywordData;
}

function mergeCompetitors(existing = [], fresh = []) {
  const map = new Map();
  existing.forEach(c => map.set(domainOf(c.url), c));
  fresh.forEach(c => { if (!map.has(domainOf(c.url))) map.set(domainOf(c.url), c); });
  return [...map.values()];
}

function mergeKeywordData(existing = [], fresh = []) {
  const map = new Map();
  existing.forEach(k => map.set(normalizeKeyword(k.keyword), k));
  fresh.forEach(k => {
    const key = normalizeKeyword(k.keyword);
    const prev = map.get(key);
    if (prev) {
      // preserve previously captured rankings/history, refresh metrics
      map.set(key, {
        ...prev,
        ...k,
        rankHistory: Array.isArray(prev.rankHistory) && prev.rankHistory.length ? prev.rankHistory : k.rankHistory || [],
        currentRank: prev.currentRank != null ? prev.currentRank : k.currentRank,
      });
    } else {
      map.set(key, k);
    }
  });
  return [...map.values()];
}

// ──────────────────────────────────────────────────────────────────────────────
// 9. refreshAllRankings(userId, siteId) — lightweight ranking-only refresh
// ──────────────────────────────────────────────────────────────────────────────

async function refreshAllRankings(userId, siteId) {
  const coll = db.collection('users').doc(userId).collection('seoSites');
  const snap = await coll.doc(siteId).get();
  if (!snap.exists) throw new Error('Site not found');
  const site = snap.data() || {};
  const kd = site.keywordData || {};
  const keywords = Array.isArray(kd.keywords) ? kd.keywords : [];
  if (!keywords.length) return { siteId, refreshed: 0, skipped: true };

  const url = site.url || site.domain || '';
  const source = process.env.SERPAPI_KEY ? 'serpapi' : (process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? 'google-ads' : 'estimated');
  let refreshed = 0;

  for (const kw of keywords) {
    if (!kw || !kw.keyword) continue;
    try {
      const rank = await checkKeywordRanking(kw.keyword, url);
      await recordRankingSnapshot(userId, siteId, kw.keyword, rank);
      refreshed += 1;
    } catch (err) {
      console.warn(`[keywords] refresh failed for "${kw.keyword}" on ${siteId}:`, err.message);
    }
  }

  // touch rankingSource after the loop (recordRankingSnapshot already updated score/history)
  return { siteId, refreshed, keywords: keywords.length, source };
}

module.exports = {
  extractSeedKeywords,
  getKeywordIdeas,
  checkKeywordRanking,
  recordRankingSnapshot,
  findCompetitors,
  analyzeCompetitorGaps,
  generateGrowthActions,
  runKeywordResearch,
  refreshAllRankings,
  autoVerifyGSC,
  computeKeywordHealth,
  priorityFor,
  parseLooseJsonArray,
};