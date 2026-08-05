/**
 * newsService.js
 * Free top-headlines via RSS feeds (NO API key required).
 * Caches per-feed for 30 minutes. Uses a tiny regex RSS parser
 * (no extra dependency) that handles RSS 2.0 <item> entries.
 */

// ─────────────────────────────────────────────────────────
// Category → feed URL(s). All are public, key-free RSS feeds.
// ─────────────────────────────────────────────────────────
const FEEDS = {
  top:    [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
  ],
  india:  [
    'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
    'https://www.thehindu.com/feeder/default.rss',
  ],
  world:  [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
  ],
  tech:   [
    'https://hnrss.org/frontpage',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
  ],
  sports: [
    'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
    'https://feeds.bbci.co.uk/sport/cricket/rss.xml',
  ],
  business: [
    'https://feeds.bbci.co.uk/news/business/rss.xml',
  ],
};

const CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

async function cached(key, fn) {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BobBackend/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '') // strip any leftover HTML tags
    .trim();
}

function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 30) {
    const body = m[1];
    const title = decodeEntities((body.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]);
    const link = ((body.match(/<link>([\s\S]*?)<\/link>/) || [, ''])[1]).trim();
    if (title && link) items.push({ title, link });
  }
  return items;
}

/**
 * Fetch headlines for a category.
 * Returns [{ title, link }, ...] (max `limit`).
 */
async function getNews(category = 'top', limit = 5) {
  const cat = (FEEDS[category] ? category : 'top');
  const urls = FEEDS[cat];

  const items = await cached(`news:${cat}`, async () => {
    const collected = [];
    const settled = await Promise.allSettled(urls.map(url => fetchText(url)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        collected.push(...parseRSS(r.value));
      }
    }
    // de-dupe by title
    const seen = new Set();
    const unique = [];
    for (const it of collected) {
      const key = String((it && it.title) || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(it);
      }
    }
    return unique;
  });

  return items.slice(0, limit);
}

/** Compact numbered list ready for the LLM context. */
function formatNews(headlines) {
  if (!headlines || !headlines.length) return null;
  return headlines
    .map((h, i) => `${i + 1}. ${h.title}`)
    .join('\n');
}

module.exports = { getNews, formatNews, FEEDS, parseRSS };
