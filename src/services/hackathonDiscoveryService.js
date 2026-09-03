// ---------------------------------------------------------------------------
// Bob — Hackathon Discovery Service
//
// Automatically discovers CSE-related hackathons from 3 platforms:
//   • Devpost   (devpost.com/hackathons)
//   • Unstop    (unstop.com/hackathons)
//   • Devfolio  (devfolio.co/hackathons)
//
// Runs every 4 days via the scheduler tick.
// Filters only: Web Dev, AI/ML, Automation, DSA, App Dev hackathons.
// Stores cards in: users/{uid}/hackathonDiscovery/{id}
// Meta stored in:  users/{uid}/hackathonDiscoveryMeta/meta
//
// Flow:
//   runDiscovery → scrape all 3 → LLM filter → dedupe → store new cards
//   listDiscovery → return non-expired, non-dismissed cards
//   saveDiscovery → move card to hackathons collection
//   dismissDiscovery → mark dismissed + add to seenLinks
//   autoExpireDiscovery → remove cards whose registration deadline passed
// ---------------------------------------------------------------------------

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { db } = require('../config/firebase');
const { callLLM } = require('./llmService');
const hackathonService = require('./hackathonService');

// ── Constants ────────────────────────────────────────────
const DISCOVERY_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000; // 4 days
const MAX_CARDS = 10; // max cards shown at one time
const SCRAPE_TIMEOUT = 15000; // 15s per platform

// CSE domain keywords for quick pre-filter
const CSE_INCLUDE = [
  'web', 'frontend', 'backend', 'fullstack', 'full stack', 'react', 'node', 'next.js', 'nextjs',
  'ai', 'ml', 'machine learning', 'deep learning', 'nlp', 'llm', 'generative', 'artificial intelligence',
  'automation', 'bot', 'scripting', 'devops', 'workflow',
  'algorithm', 'data structure', 'competitive', 'coding', 'dsa',
  'android', 'ios', 'mobile app', 'flutter', 'react native',
  'app', 'software', 'developer', 'tech', 'hackathon', 'build', 'startup',
  'open source', 'api', 'cloud', 'database', 'javascript', 'python',
];

const CSE_EXCLUDE = [
  'electrical', 'mechanical', 'civil', 'networking', 'cybersecurity', 'cyber security',
  'iot hardware', 'robotics', 'embedded', 'pcb', 'circuit', 'vlsi', 'hardware design',
  'pharmacy', 'medical', 'finance only', 'marketing only', 'business only',
];

// ── Firestore helpers ─────────────────────────────────────
function discoveryColl(userId) {
  return db.collection('users').doc(userId).collection('hackathonDiscovery');
}

function metaRef(userId) {
  return db.collection('users').doc(userId).collection('hackathonDiscoveryMeta').doc('meta');
}

async function getMeta(userId) {
  const snap = await metaRef(userId).get();
  return snap.exists ? snap.data() : { lastRunAt: 0, nextRunAt: 0, seenLinks: [] };
}

async function setMeta(userId, patch) {
  await metaRef(userId).set(patch, { merge: true });
}

// ── Scraping helpers ──────────────────────────────────────
function makeFetchHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

async function safeFetch(url, timeoutMs = SCRAPE_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: makeFetchHeaders(), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── Platform scrapers ─────────────────────────────────────

/**
 * Devpost: https://devpost.com/hackathons?challenge_type=online&status=open
 * Renders basic HTML with .challenge-listing cards
 */
async function scrapeDevpost() {
  const items = [];
  try {
    const html = await safeFetch('https://devpost.com/hackathons?challenge_type=online&status=open&order_by=deadline');
    const $ = cheerio.load(html);

    $('.challenge-listing, .hackathon-tile, article.hackathon-tile, .challenge-tile').each((_, el) => {
      try {
        const title = $(el).find('h2, h3, .title, .challenge-title').first().text().trim();
        const link = $(el).find('a').first().attr('href') || '';
        const prize = $(el).find('.prize-amount, .prize, .prizes').first().text().trim();
        const deadline = $(el).find('.submission-period, .deadline, .date').first().text().trim();
        const tags = [];
        $(el).find('.theme-label, .challenge-label, .tag, .category').each((_, t) => {
          const tag = $(t).text().trim();
          if (tag) tags.push(tag);
        });

        if (title && link) {
          items.push({
            title,
            link: link.startsWith('http') ? link : `https://devpost.com${link}`,
            prize,
            deadlineText: deadline,
            tags,
            platform: 'devpost',
          });
        }
      } catch (e) { /* skip bad card */ }
    });

    // Fallback: look for JSON-LD or data attributes
    if (items.length === 0) {
      $('a[href*="/hackathons/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 5 && href.includes('/hackathons/')) {
          items.push({
            title,
            link: href.startsWith('http') ? href : `https://devpost.com${href}`,
            prize: '',
            deadlineText: '',
            tags: [],
            platform: 'devpost',
          });
        }
      });
    }
  } catch (e) {
    console.warn('[HackDiscovery] Devpost scrape failed:', e.message);
  }
  console.log(`[HackDiscovery] Devpost: found ${items.length} raw items`);
  return items;
}

/**
 * Unstop: https://unstop.com/hackathons?domain=it-software&deadline=upcoming
 * Partially server-rendered; we grab what we can from static HTML
 */
async function scrapeUnstop() {
  const items = [];
  try {
    const html = await safeFetch('https://unstop.com/hackathons?domain=it-software&deadline=upcoming');
    const $ = cheerio.load(html);

    // Unstop renders some data in JSON in script tags
    let jsonData = null;
    $('script[type="application/json"], script#__NEXT_DATA__').each((_, el) => {
      try {
        const text = $(el).html() || '';
        if (text.includes('hackathon') || text.includes('competition')) {
          jsonData = JSON.parse(text);
        }
      } catch (e) { /* skip */ }
    });

    // Try parsing competition data from NEXT_DATA
    if (jsonData) {
      const traverse = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(traverse);
          return;
        }
        // Look for competition objects
        if (obj.title && (obj.public_url || obj.url || obj.slug)) {
          const link = obj.public_url || `https://unstop.com/${obj.slug || ''}`;
          items.push({
            title: obj.title,
            link: link.startsWith('http') ? link : `https://unstop.com${link}`,
            prize: obj.prizes?.length ? String(obj.prizes[0]?.prize_amount || '') : (obj.prize || ''),
            deadlineText: obj.reg_end_date || obj.deadline || '',
            tags: (obj.tags || []).map((t) => t.name || t).filter(Boolean),
            platform: 'unstop',
          });
        }
        Object.values(obj).forEach(traverse);
      };
      traverse(jsonData);
    }

    // Fallback: HTML card scrape
    if (items.length === 0) {
      $('.opportunity-card, .comp-card, [class*="listing"], [class*="card"]').each((_, el) => {
        try {
          const title = $(el).find('h2, h3, h4, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const prize = $(el).find('[class*="prize"], [class*="amount"]').first().text().trim();
          if (title && link) {
            items.push({
              title,
              link: link.startsWith('http') ? link : `https://unstop.com${link}`,
              prize,
              deadlineText: '',
              tags: [],
              platform: 'unstop',
            });
          }
        } catch (e) { /* skip */ }
      });
    }
  } catch (e) {
    console.warn('[HackDiscovery] Unstop scrape failed:', e.message);
  }
  console.log(`[HackDiscovery] Unstop: found ${items.length} raw items`);
  return items;
}

/**
 * Devfolio: https://devfolio.co/hackathons
 * Renders open hackathons in static HTML
 */
async function scrapeDevfolio() {
  const items = [];
  try {
    const html = await safeFetch('https://devfolio.co/hackathons');
    const $ = cheerio.load(html);

    // Devfolio uses styled-components, look for card anchors
    $('a[href*="devfolio.co/"], a[href^="/"]').each((_, el) => {
      try {
        const href = $(el).attr('href') || '';
        if (!href.includes('/hackathons/') && !href.match(/devfolio\.co\/[a-z0-9-]{4,}$/i)) return;

        const title = $(el).find('h2, h3, h4, p, span').filter((_, t) => $(t).text().trim().length > 5).first().text().trim()
          || $(el).text().trim();
        const prize = $(el).find('[class*="prize"], [class*="amount"]').first().text().trim();

        if (title && title.length > 5) {
          items.push({
            title,
            link: href.startsWith('http') ? href : `https://devfolio.co${href}`,
            prize,
            deadlineText: '',
            tags: [],
            platform: 'devfolio',
          });
        }
      } catch (e) { /* skip */ }
    });

    // Fallback: script-tag JSON
    if (items.length === 0) {
      $('script').each((_, el) => {
        try {
          const text = $(el).html() || '';
          if (!text.includes('hackathon')) return;
          const match = text.match(/\{.*"hackathons".*\}/s);
          if (match) {
            const data = JSON.parse(match[0]);
            const hacks = data.hackathons || data.data?.hackathons || [];
            hacks.forEach((h) => {
              if (h.name || h.title) {
                items.push({
                  title: h.name || h.title,
                  link: h.url || `https://${h.slug}.devfolio.co`,
                  prize: h.prize || '',
                  deadlineText: h.ends_at || h.registration_ends_at || '',
                  tags: (h.tags || []),
                  platform: 'devfolio',
                });
              }
            });
          }
        } catch (e) { /* skip */ }
      });
    }
  } catch (e) {
    console.warn('[HackDiscovery] Devfolio scrape failed:', e.message);
  }
  console.log(`[HackDiscovery] Devfolio: found ${items.length} raw items`);
  return items;
}

// ── CSE Quick Pre-filter (keyword based) ─────────────────
function quickCseFilter(item) {
  const text = `${item.title} ${item.tags.join(' ')}`.toLowerCase();

  // Hard exclude non-CSE
  for (const kw of CSE_EXCLUDE) {
    if (text.includes(kw)) return false;
  }

  // Must include at least one CSE signal
  for (const kw of CSE_INCLUDE) {
    if (text.includes(kw)) return true;
  }

  // If title has no strong exclude — give benefit of doubt (LLM will decide)
  return true;
}

// ── LLM CSE Relevance Filter ──────────────────────────────
/**
 * Filter items via LLM batch — confirm each is CSE-relevant
 * (Web Dev / AI-ML / Automation / DSA / App Dev only)
 */
async function llmFilterCse(items) {
  if (!items.length) return [];

  // Build compact list for LLM
  const inputList = items.map((it, i) => `${i + 1}. "${it.title}" [${it.platform}] tags: ${it.tags.slice(0, 4).join(', ') || 'none'}`).join('\n');

  try {
    const res = await callLLM({
      role: 'review',
      messages: [
        {
          role: 'system',
          content: `You are a hackathon relevance classifier for a Computer Science student (Nikhil, B.Tech CSE).
INCLUDE only hackathons related to: Web Development, AI/ML, Automation, DSA/Algorithms, Mobile App Dev, Software Engineering, Open Source, Cloud Computing.
EXCLUDE: Electrical, Mechanical, Civil, Networking infra, Hardware/Robotics, Cybersecurity CTF, Finance-only, Marketing-only challenges.
Reply with ONLY a JSON array of numbers representing the indices (1-based) of hackathons that SHOULD BE INCLUDED. Example: [1,3,5]`,
        },
        {
          role: 'user',
          content: `Classify these hackathons — which ones are CSE/software relevant?\n\n${inputList}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const raw = res.text.replace(/```json|```/g, '').trim();
    const indices = JSON.parse(raw);
    if (!Array.isArray(indices)) return items;

    return items.filter((_, i) => indices.includes(i + 1));
  } catch (e) {
    console.warn('[HackDiscovery] LLM filter failed, using all items:', e.message);
    return items;
  }
}

// ── LLM Summarizer ────────────────────────────────────────
/**
 * For each filtered item, generate a proper summary + extract structured data
 */
async function enrichItem(item) {
  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    const res = await callLLM({
      role: 'review',
      messages: [
        {
          role: 'system',
          content: `You extract structured hackathon info. Reply ONLY clean JSON (no markdown fences).
TODAY: ${todayStr}. Prefer upcoming/future dates.`,
        },
        {
          role: 'user',
          content: `Hackathon: "${item.title}" from ${item.platform}
Tags: ${item.tags.join(', ') || 'none'}
Prize: ${item.prize || 'unknown'}
Deadline text: ${item.deadlineText || 'unknown'}

Generate JSON: {
  "summary": "3-4 sentence description of what this hackathon is about, who should participate, and what to build",
  "prize": "cleaned prize string or empty",
  "mode": "online|offline|hybrid|unknown",
  "tags": ["array of 2-4 relevant tech tags like AI/ML, Web Dev, DSA"],
  "teamSize": "e.g. 1-4 or Solo or unknown",
  "eligibility": "who can participate",
  "registrationDeadline": "YYYY-MM-DD or null",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null"
}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    return {
      ...item,
      summary: parsed.summary || `${item.title} — hackathon from ${item.platform}.`,
      prize: parsed.prize || item.prize || '',
      mode: parsed.mode || 'online',
      tags: parsed.tags || item.tags.slice(0, 4),
      teamSize: parsed.teamSize || 'unknown',
      eligibility: parsed.eligibility || '',
      registrationDeadline: parsed.registrationDeadline ? new Date(parsed.registrationDeadline).getTime() : null,
      startDate: parsed.startDate ? new Date(parsed.startDate).getTime() : null,
      endDate: parsed.endDate ? new Date(parsed.endDate).getTime() : null,
    };
  } catch (e) {
    console.warn(`[HackDiscovery] Enrich failed for "${item.title}":`, e.message);
    return {
      ...item,
      summary: `${item.title} — a hackathon from ${item.platform}.`,
      mode: 'online',
      tags: item.tags.slice(0, 4),
      teamSize: 'unknown',
      eligibility: '',
      registrationDeadline: null,
      startDate: null,
      endDate: null,
    };
  }
}

// ── Main Discovery Runner ─────────────────────────────────
async function runDiscovery(userId) {
  const now = Date.now();
  const meta = await getMeta(userId);

  // Check if discovery is paused by the user
  if (meta.enabled === false) {
    console.log('[HackDiscovery] Discovery is paused by user.');
    return { paused: true };
  }

  // Check if 4 days have passed
  if (meta.nextRunAt && now < meta.nextRunAt) {
    const hoursLeft = Math.ceil((meta.nextRunAt - now) / 3600000);
    console.log(`[HackDiscovery] Not yet time. Next run in ~${hoursLeft}h`);
    return { skipped: true, nextRunAt: meta.nextRunAt };
  }

  console.log('[HackDiscovery] Starting discovery run...');

  // 1. Scrape all 3 platforms in parallel
  const [devpostItems, unstopItems, devfolioItems] = await Promise.allSettled([
    scrapeDevpost(),
    scrapeUnstop(),
    scrapeDevfolio(),
  ]);

  const allItems = [
    ...(devpostItems.status === 'fulfilled' ? devpostItems.value : []),
    ...(unstopItems.status === 'fulfilled' ? unstopItems.value : []),
    ...(devfolioItems.status === 'fulfilled' ? devfolioItems.value : []),
  ];

  console.log(`[HackDiscovery] Total raw items: ${allItems.length}`);

  // 2. Remove already-seen links
  const seenLinks = new Set(meta.seenLinks || []);
  const unseenItems = allItems.filter((it) => {
    const normalLink = it.link.split('?')[0].toLowerCase().trim();
    return !seenLinks.has(normalLink);
  });

  console.log(`[HackDiscovery] After dedup: ${unseenItems.length} new items`);

  if (unseenItems.length === 0) {
    // Still update the next run time
    await setMeta(userId, { lastRunAt: now, nextRunAt: now + DISCOVERY_INTERVAL_MS });
    return { added: 0, nextRunAt: now + DISCOVERY_INTERVAL_MS };
  }

  // 3. Quick keyword pre-filter
  const preFiltered = unseenItems.filter(quickCseFilter);
  console.log(`[HackDiscovery] After keyword filter: ${preFiltered.length} items`);

  // 4. LLM CSE filter (batch)
  const llmFiltered = await llmFilterCse(preFiltered);
  console.log(`[HackDiscovery] After LLM filter: ${llmFiltered.length} items`);

  // 5. Limit to top MAX_CARDS
  const toAdd = llmFiltered.slice(0, MAX_CARDS);

  // 6. Enrich each item (LLM summary + structured data)
  const enriched = [];
  for (const item of toAdd) {
    const rich = await enrichItem(item);
    enriched.push(rich);
  }

  // 7. Save to Firestore
  const coll = discoveryColl(userId);
  const batch = db.batch();
  const newSeenLinks = [...seenLinks];

  for (const item of enriched) {
    const ref = coll.doc();
    batch.set(ref, {
      id: ref.id,
      title: item.title,
      platform: item.platform,
      link: item.link,
      summary: item.summary,
      prize: item.prize || '',
      mode: item.mode || 'online',
      tags: item.tags || [],
      teamSize: item.teamSize || 'unknown',
      eligibility: item.eligibility || '',
      registrationDeadline: item.registrationDeadline || null,
      startDate: item.startDate || null,
      endDate: item.endDate || null,
      scrapedAt: now,
      discoveredAt: now,
      status: 'new',
      savedHackathonId: null,
    });
    const normalLink = item.link.split('?')[0].toLowerCase().trim();
    newSeenLinks.push(normalLink);
  }

  await batch.commit();

  // 8. Update meta
  await setMeta(userId, {
    lastRunAt: now,
    nextRunAt: now + DISCOVERY_INTERVAL_MS,
    seenLinks: newSeenLinks.slice(-500), // keep last 500 to prevent unbounded growth
  });

  console.log(`[HackDiscovery] Added ${enriched.length} new hackathons for user ${userId}`);
  return { added: enriched.length, nextRunAt: now + DISCOVERY_INTERVAL_MS };
}

// ── List Discovery ────────────────────────────────────────
async function listDiscovery(userId) {
  await autoExpireDiscovery(userId); // cleanup expired before listing
  // Use single where clause to avoid composite index requirement,
  // then sort and limit in memory
  const snap = await discoveryColl(userId)
    .where('status', '==', 'new')
    .get();

  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Sort by newest first, limit to MAX_CARDS
  items.sort((a, b) => (b.discoveredAt || 0) - (a.discoveredAt || 0));
  return items.slice(0, MAX_CARDS);
}

// ── Save Discovery → Hackathons ───────────────────────────
async function saveDiscovery(userId, discoveryId, participating = false) {
  const docRef = discoveryColl(userId).doc(discoveryId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('Discovery card not found');

  const item = { id: snap.id, ...snap.data() };

  // Create in hackathons collection
  const hack = await hackathonService.createHackathon(userId, {
    title: item.title,
    link: item.link,
    source: item.platform,
    startDate: item.startDate || null,
    endDate: item.endDate || null,
    mode: item.mode || 'online',
    prize: item.prize || '',
    description: item.summary || '',
    rules: [],
    participating: Boolean(participating),
    tracking: true,
  });

  // Mark discovery as saved
  await docRef.set({
    status: 'saved',
    savedHackathonId: hack.id,
  }, { merge: true });

  return hack;
}

// ── Dismiss Discovery ─────────────────────────────────────
async function dismissDiscovery(userId, discoveryId) {
  const docRef = discoveryColl(userId).doc(discoveryId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('Discovery card not found');

  const item = snap.data();

  // Mark dismissed
  await docRef.set({ status: 'dismissed' }, { merge: true });

  // Add to seenLinks so it never appears again
  const meta = await getMeta(userId);
  const seenLinks = new Set(meta.seenLinks || []);
  const normalLink = (item.link || '').split('?')[0].toLowerCase().trim();
  if (normalLink) seenLinks.add(normalLink);
  await setMeta(userId, { seenLinks: [...seenLinks].slice(-500) });

  return { success: true };
}

// ── Auto-expire ───────────────────────────────────────────
async function autoExpireDiscovery(userId) {
  const now = Date.now();
  const snap = await discoveryColl(userId)
    .where('status', '==', 'new')
    .get();

  const batch = db.batch();
  let expiredCount = 0;

  for (const doc of snap.docs) {
    const item = doc.data();
    // Expire if registration deadline passed
    if (item.registrationDeadline && item.registrationDeadline < now) {
      batch.delete(doc.ref);
      expiredCount++;
    }
    // Also expire if it's been in the list for > 8 days without interaction
    if (!item.registrationDeadline && item.discoveredAt && (now - item.discoveredAt) > 8 * 24 * 60 * 60 * 1000) {
      batch.delete(doc.ref);
      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    await batch.commit();
    console.log(`[HackDiscovery] Auto-expired ${expiredCount} cards for user ${userId}`);
  }

  return { expired: expiredCount };
}

// ── Get meta info (for frontend to know last/next run time) ──
async function getDiscoveryMeta(userId) {
  return getMeta(userId);
}

// ── Toggle discovery on/off ───────────────────────────────
async function toggleDiscovery(userId, enable) {
  await setMeta(userId, { enabled: Boolean(enable) });
  console.log(`[HackDiscovery] Discovery ${enable ? 'ENABLED' : 'PAUSED'} for user ${userId}`);
  return { enabled: Boolean(enable) };
}

module.exports = {
  runDiscovery,
  listDiscovery,
  saveDiscovery,
  dismissDiscovery,
  autoExpireDiscovery,
  getDiscoveryMeta,
  toggleDiscovery,
};
