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


// ── HTML stripper (fixes scraped prize like "$<span>10,000</span>") ──────
function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')    // remove all HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
 * Devpost: Uses Devpost public AJAX API with fallback to HTML parsing
 */
async function scrapeDevpost() {
  const items = [];
  try {
    // 1. First attempt: Devpost public JSON API
    const apiUrl = 'https://devpost.com/api/hackathons?challenge_type[]=online&status[]=open';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);
    const res = await fetch(apiUrl, {
      headers: {
        ...makeFetchHeaders(),
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const rawHacks = data.hackathons || [];
      for (const h of rawHacks) {
        if (h.title && h.url) {
          items.push({
            title: h.title,
            link: h.url,
            prize: h.prize_amount ? stripHtml(String(h.prize_amount)) : '',
            deadlineText: h.submission_period_dates || '',
            tags: (h.themes || []).map(t => t.name || t).filter(Boolean),
            platform: 'devpost',
          });
        }
      }
    }
  } catch (e) {
    console.warn('[HackDiscovery] Devpost API failed, falling back to HTML:', e.message);
  }

  // Fallback: HTML scraping
  if (items.length === 0) {
    try {
      const html = await safeFetch('https://devpost.com/hackathons?challenge_type=online&status=open&order_by=deadline');
      const $ = cheerio.load(html);

      $('.challenge-listing, .hackathon-tile, article.hackathon-tile, .challenge-tile').each((_, el) => {
        try {
          const title = $(el).find('h2, h3, .title, .challenge-title').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const rawPrize = $(el).find('.prize-amount, .prize, .prizes').first().html() || $(el).find('.prize-amount, .prize, .prizes').first().text();
          const prize = stripHtml(rawPrize || '');
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
        } catch (_) {}
      });
    } catch (e) {
      console.warn('[HackDiscovery] Devpost HTML scrape failed:', e.message);
    }
  }

  console.log(`[HackDiscovery] Devpost: found ${items.length} raw items`);
  return items;
}

/**
 * Unstop: Uses Unstop public search API with fallback to HTML parsing
 */
async function scrapeUnstop() {
  const items = [];
  try {
    // 1. First attempt: Unstop public API
    const apiUrl = 'https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=20';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);
    const res = await fetch(apiUrl, {
      headers: {
        ...makeFetchHeaders(),
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      const rawList = json.data?.data || json.data || [];
      for (const op of rawList) {
        const title = op.title || op.name;
        if (!title) continue;
        const slug = op.public_url || op.seo_url || (op.slug ? `https://unstop.com/${op.slug}` : '');
        const prize = op.prizes?.length ? String(op.prizes[0]?.prize_amount || op.prizes[0]?.title || '') : (op.prize || '');
        const deadline = op.regn_end_date || op.reg_end_date || op.deadline || '';
        const tags = Array.isArray(op.filters) ? op.filters.map(f => f.name || f).filter(Boolean) : [];

        items.push({
          title,
          link: slug.startsWith('http') ? slug : `https://unstop.com/${slug}`,
          prize,
          deadlineText: deadline,
          tags,
          platform: 'unstop',
        });
      }
    }
  } catch (e) {
    console.warn('[HackDiscovery] Unstop API failed, falling back to HTML:', e.message);
  }

  // Fallback: HTML scrape
  if (items.length === 0) {
    try {
      const html = await safeFetch('https://unstop.com/hackathons?domain=it-software&deadline=upcoming');
      const $ = cheerio.load(html);

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
        } catch (_) {}
      });
    } catch (e) {
      console.warn('[HackDiscovery] Unstop HTML scrape failed:', e.message);
    }
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
        if (href.includes('/applied') || href.includes('/open') || href.includes('/explore')) return;

        const title = $(el).find('h2, h3, h4, p, span').filter((_, t) => $(t).text().trim().length > 5).first().text().trim()
          || $(el).text().trim();
        const prize = $(el).find('[class*="prize"], [class*="amount"]').first().text().trim();

        if (title && title.length > 5 && !title.toLowerCase().includes('your hackathons') && !title.toLowerCase().includes('all open')) {
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

// ── Helper to scrape readable text snippet from individual hackathon page ──
async function fetchPageSnippet(url) {
  if (!url || !url.startsWith('http')) return '';
  try {
    const html = await safeFetch(url, 9000);
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, noscript, svg').remove();

    // Prefer main content areas (Devpost: #challenge-overview, .content, main)
    let content = $('#challenge-overview, #challenge-body, .challenge-content, article, main').text().replace(/\s+/g, ' ').trim();
    if (!content || content.length < 200) {
      content = $('body').text().replace(/\s+/g, ' ').trim();
    }
    // Truncate to first 3500 chars to fit in LLM prompt nicely
    return content.slice(0, 3500);
  } catch (e) {
    return '';
  }
}

// ── LLM Summarizer ────────────────────────────────────────
/**
 * For each filtered item, fetch real page content, generate deep build details + prize basis
 */
async function enrichItem(item) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cleanRawPrize = stripHtml(item.prize || '');
  
  // 1. Fetch real page content from hackathon link
  const pageSnippet = await fetchPageSnippet(item.link);

  try {
    const res = await callLLM({
      role: 'review',
      messages: [
        {
          role: 'system',
          content: `You are an elite technical hackathon advisor for computer engineering students. 
Analyze the provided hackathon details and webpage content. Extract accurate, deep, and actionable facts. 
Reply ONLY clean JSON (no markdown fences, no backticks).
TODAY: ${todayStr}.`,
        },
        {
          role: 'user',
          content: `HACKATHON: "${item.title}" (${item.platform})
URL: ${item.link}
Tags: ${item.tags.join(', ') || 'CSE, Software'}
Prize text: ${cleanRawPrize}
Deadline: ${item.deadlineText}

REAL WEBPAGE CONTENT EXTRACT:
${pageSnippet || 'Webpage content could not be retrieved directly; use hackathon title, tags, and your verified knowledge base.'}

Generate JSON with these exact fields:
{
  "summary": "1-2 sentences giving high-level hook: what this hackathon is and the main challenge goal.",
  "whatToBuild": "3-4 concise lines describing EXPLICITLY what participants need to build (e.g. project type, tech stack, APIs or SDKs to use, submission deliverables like working demo/video/GitHub PR).",
  "prize": "Clean prize string (e.g. '$10,000 USD' or '₹2,50,000' or 'Swags & Mentorship'). Clean all HTML tags.",
  "prizeBasis": "How prizes are awarded / judging criteria (e.g. 'Judged on Technical Implementation, Innovation, Practical Impact, and Working Demo Video').",
  "hasCertificates": true,
  "certificatesInfo": "Yes (Participation certificate for all valid submissions) OR No / Cash & Swags only",
  "fee": "Free Entry or registration fee amount",
  "mode": "online | offline | hybrid",
  "location": "City/venue name if offline, or 'Virtual / Global' if online",
  "seatsStatus": "Open | Filling Fast | Limited",
  "tags": ["2-4 specific tech tags like AI/ML, Web Dev, Mobile App, DSA"],
  "teamSize": "e.g. 1-4 Members, Solo or Team",
  "eligibility": "1 concise sentence: who can participate (e.g. Students & developers worldwide)",
  "registrationDeadline": "YYYY-MM-DD or null",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null"
}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });

    const parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    return {
      ...item,
      summary: parsed.summary || `${item.title} — CSE hackathon hosted on ${item.platform}.`,
      whatToBuild: parsed.whatToBuild || `Build and submit a working software project focusing on ${item.tags.join(', ') || 'technology and innovation'}.`,
      prize: stripHtml(parsed.prize || cleanRawPrize || 'Prizes & Recognition'),
      prizeBasis: parsed.prizeBasis || 'Evaluated on Innovation, Technical Depth, Usability, and Final Presentation.',
      hasCertificates: parsed.hasCertificates !== false,
      certificatesInfo: parsed.certificatesInfo || 'Certificate of Participation provided for valid project submissions.',
      fee: parsed.fee || 'Free Entry',
      mode: parsed.mode || 'online',
      location: parsed.location || (parsed.mode === 'offline' ? 'In-Person Venue' : 'Virtual / Online'),
      seatsStatus: parsed.seatsStatus || 'Open',
      tags: (parsed.tags && parsed.tags.length) ? parsed.tags : item.tags.slice(0, 4),
      teamSize: parsed.teamSize || '1-4 Members',
      eligibility: parsed.eligibility || 'Open to all developers & students',
      registrationDeadline: parsed.registrationDeadline ? new Date(parsed.registrationDeadline).getTime() : null,
      startDate: parsed.startDate ? new Date(parsed.startDate).getTime() : null,
      endDate: parsed.endDate ? new Date(parsed.endDate).getTime() : null,
    };
  } catch (e) {
    console.warn(`[HackDiscovery] Enrich failed for "${item.title}":`, e.message);
    return {
      ...item,
      summary: `${item.title} — Software engineering & hackathon challenge on ${item.platform}.`,
      whatToBuild: `Build and deploy an innovative software application or tool related to ${item.tags.join(', ') || 'CSE'}.`,
      prize: cleanRawPrize || 'Prizes & Recognition',
      prizeBasis: 'Evaluated on innovation, working implementation, and demo quality.',
      hasCertificates: true,
      certificatesInfo: 'Participation certificate usually provided upon verified submission.',
      fee: 'Free Entry',
      mode: 'online',
      location: 'Virtual / Online',
      seatsStatus: 'Open',
      tags: item.tags.length ? item.tags.slice(0, 4) : ['Web Dev', 'AI/ML'],
      teamSize: '1-4 Members',
      eligibility: 'Open to developers & students',
      registrationDeadline: null,
      startDate: null,
      endDate: null,
    };
  }
}

// ── Main Discovery Runner ─────────────────────────────────
async function runDiscovery(userId, force = false) {
  const now = Date.now();
  const meta = await getMeta(userId);

  // Check if discovery is paused by the user (unless forced)
  if (!force && meta.enabled === false) {
    console.log('[HackDiscovery] Discovery is paused by user.');
    return { paused: true };
  }

  // Check if 4 days have passed (unless forced)
  if (!force && meta.nextRunAt && now < meta.nextRunAt) {
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
      whatToBuild: item.whatToBuild || '',
      prize: item.prize || '',
      prizeBasis: item.prizeBasis || '',
      hasCertificates: item.hasCertificates !== false,
      certificatesInfo: item.certificatesInfo || 'Certificate provided for valid submissions',
      fee: item.fee || 'Free Entry',
      mode: item.mode || 'online',
      location: item.location || 'Virtual / Online',
      seatsStatus: item.seatsStatus || 'Open',
      tags: item.tags || [],
      teamSize: item.teamSize || '1-4 Members',
      eligibility: item.eligibility || 'Open to developers & students',
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
