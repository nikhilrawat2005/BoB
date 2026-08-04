// ---------------------------------------------------------------------------
// Bob HQ — Key-Free Web Search Service
// Search provider cascade (no user API key required):
//   1. Brave Search API  — only if BRAVE_API_KEY is set in .env
//   2. DuckDuckGo HTML   — primary key-free source
//   3. Bing HTML         — fallback key-free source
// Returns { query, provider, results: [{ title, url, snippet }] }
// ---------------------------------------------------------------------------
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function cleanSnippet(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function searchBrave(query, count) {
  const key = (process.env.BRAVE_API_KEY || '').trim();
  if (!key) return null;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key, 'User-Agent': UA },
    timeout: 15000,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const results = (data.web && data.web.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    snippet: cleanSnippet(r.description),
  }));
  return results.length ? results : null;
}

async function searchDuckDuckGo(query, count) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    timeout: 20000,
  });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];
  $('.result').each((_, el) => {
    const a = $(el).find('.result__a').first();
    const sn = $(el).find('.result__snippet').first();
    const href = (a.attr('href') || '');
    // DDG wraps real URLs in redirect links (uddg=...)
    let real = href;
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.searchParams.get('uddg')) real = u.searchParams.get('uddg');
    } catch (e) { /* keep raw */ }
    const title = a.text().trim();
    if (title && real.startsWith('http')) {
      results.push({ title, url: real, snippet: cleanSnippet(sn.text()) });
    }
  });
  if (!results.length) throw new Error('No DDG results');
  return results.slice(0, count);
}

async function searchBing(query, count) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    timeout: 20000,
  });
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];
  $('li.b_algo').each((_, el) => {
    const a = $(el).find('h2 a').first();
    const sn = $(el).find('.b_caption p, .b_lineclamp').first();
    const title = a.text().trim();
    const href = (a.attr('href') || '');
    if (title && href.startsWith('http')) {
      results.push({ title, url: href, snippet: cleanSnippet(sn.text()) });
    }
  });
  if (!results.length) throw new Error('No Bing results');
  return results.slice(0, count);
}

/**
 * Search the web. Provider cascade: Brave (if key) → DuckDuckGo → Bing.
 * Never throws on provider failure — returns whatever it could get.
 */
async function searchWeb(query, { count = 8 } = {}) {
  const cleanQuery = String(query || '').trim().slice(0, 300);
  if (!cleanQuery) return { query: '', provider: 'none', results: [] };

  const brave = await searchBrave(cleanQuery, count).catch(() => null);
  if (brave) return { query: cleanQuery, provider: 'brave', results: brave };

  try {
    return { query: cleanQuery, provider: 'duckduckgo', results: await searchDuckDuckGo(cleanQuery, count) };
  } catch (e) {
    try {
      return { query: cleanQuery, provider: 'bing', results: await searchBing(cleanQuery, count) };
    } catch (e2) {
      return { query: cleanQuery, provider: 'none', results: [], error: `${e.message} / ${e2.message}` };
    }
  }
}

module.exports = { searchWeb };
