const fetch = require('node-fetch');
const cheerio = require('cheerio');
const net = require('net');
const dns = require('dns').promises;

/**
 * Autonomous Web Crawler & Scraper Service
 * Scrapes HTML, JavaScript snippets, CSS styles, metadata, links, and readable text from any URL
 */

// Blocks SSRF — no localhost, private, link-local, or CGNAT hosts.
function isBlockedIp(ip) {
  const v4 = ip.split('.').map(Number);
  if (v4.length === 4 && v4.every(n => Number.isInteger(n))) {
    if (v4[0] === 10) return true;                                   // 10.0.0.0/8
    if (v4[0] === 127) return true;                                  // loopback
    if (v4[0] === 0) return true;                                    // 0.0.0.0/8
    if (v4[0] === 169 && v4[1] === 254) return true;                 // link-local
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return true;    // 172.16/12
    if (v4[0] === 192 && v4[1] === 168) return true;                 // 192.168/16
    if (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127) return true;   // CGNAT 100.64/10
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}

async function validatePublicUrl(targetUrl) {
  let u;
  try {
    u = new URL(targetUrl);
  } catch {
    throw new Error('Invalid URL provided.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local/private hosts are not allowed.');
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('Private IP addresses are not allowed.');
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error('URL resolves to a private address.');
  }
}

/**
 * Fetch with a hard AbortController timeout (kills the request completely).
 * node-fetch's `timeout` option only covers initial connection, NOT full response.
 */
function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .then(async (res) => {
      // Also abort if body takes too long — read text with a race
      const bodyPromise = res.text();
      const bodyTimer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Body read timeout')), timeoutMs)
      );
      const text = await Promise.race([bodyPromise, bodyTimer]);
      clearTimeout(timer);
      return { ok: res.ok, status: res.status, statusText: res.statusText, text };
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error(`Fetch timed out after ${timeoutMs}ms`);
      throw err;
    });
}

// Skip URLs that are login/auth/register pages (they hang or return no useful content)
function isUselessUrl(url) {
  const lower = String(url).toLowerCase();
  return /\/(login|signin|sign-in|auth|oauth|register|signup|sign-up|logout|callback)\b/.test(lower);
}

async function scrapeURL(targetUrl, timeoutMs = 8000) {
  try {
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    await validatePublicUrl(targetUrl);

    const { ok, status, statusText, text: html } = await fetchWithTimeout(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, timeoutMs);

    if (!ok) {
      throw new Error(`HTTP error ${status}: ${statusText}`);
    }

    const $ = cheerio.load(html);

    // Extract metadata
    const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || '';
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || $('meta[name="twitter:description"]').attr('content') || '';

    // Extract JSON-LD structured data (often embedded in Unstop / Devpost / Event pages for SEO)
    const jsonLdBlocks = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).html();
        if (text) {
          const json = JSON.parse(text);
          jsonLdBlocks.push(json);
        }
      } catch (e) { /* ignore invalid JSON-LD */ }
    });

    // Extract clean body text (removing script/style tags)
    $('script, style, noscript, svg, iframe').remove();
    const cleanText = $('body').text().replace(/\s+/g, ' ').trim();

    // Extract external JS script sources
    const scripts = [];
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) scripts.push(src);
    });

    // Extract external CSS stylesheet links
    const stylesheets = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) stylesheets.push(href);
    });

    // Extract page headings (H1, H2, H3)
    const headings = [];
    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text) headings.push(`${el.tagName.toUpperCase()}: ${text}`);
    });

    // Extract outgoing links for network crawling
    const links = [];
    const seenLinks = new Set();
    $('a[href]').each((_, el) => {
      if (links.length >= 30) return;
      const rawHref = $(el).attr('href');
      if (!rawHref) return;
      try {
        const parsedUrl = new URL(rawHref, targetUrl);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return;
        const href = parsedUrl.href.split('#')[0];
        if (seenLinks.has(href) || isUselessUrl(href)) return;
        seenLinks.add(href);
        const linkText = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 100);
        links.push({ url: href, text: linkText || parsedUrl.hostname });
      } catch (e) { /* ignore invalid URLs */ }
    });

    return {
      url: targetUrl,
      title,
      description,
      headings,
      jsonLd: jsonLdBlocks,
      scripts: scripts.slice(0, 10),
      stylesheets: stylesheets.slice(0, 10),
      links,
      contentSnippet: cleanText.slice(0, 5000), // First 5000 chars for context
      fullTextLength: cleanText.length,
    };
  } catch (err) {
    console.error(`scrapeURL error for ${targetUrl}:`, err.message);
    throw err;
  }
}

// ── Deep-crawl helper ─────────────────────────────────────
function extractLinks($, baseUrl, maxLinks) {
  const links = [];
  const seen = new Set();
  try { baseUrl = new URL(baseUrl); } catch { return links; }
  $('a[href]').each((_, el) => {
    if (links.length >= maxLinks) return false;
    const raw = $(el).attr('href');
    if (!raw) return;
    try {
      const u = new URL(raw, baseUrl.origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      const href = u.href.split('#')[0];
      if (seen.has(href)) return;
      // Skip login/register/auth pages
      if (isUselessUrl(href)) return;
      seen.add(href);
      const text = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 120);
      if (!text) return;
      links.push({ url: href, text });
    } catch { /* ignore bad links */ }
  });
  return links;
}

// Extract hackathon-style metadata: dates, prizes, deadlines, statuses
function extractEventMeta(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 25000);

  const dates = [];
  // Flexible regex for dates, date-ranges (e.g. 7-9 August 2026, 6th Aug 2026, 2026-08-06, Deadline: 6 August)
  const dateRe = /(\d{1,2}(?:\s*[-–—to\s]+\s*\d{1,2})?\s*(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[,\s]*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  let m;
  while ((m = dateRe.exec(text)) !== null && dates.length < 8) {
    const d = (m[1] || m[0] || '').trim();
    if (d && !dates.some(x => String(x || '').toLowerCase() === d.toLowerCase())) dates.push(d);
  }

  const prize = [];
  const prizeRe = /(?:prize|prizes? pool|cash (?:prize|award)|rewards?|prize money)[:\s]+(?:up to\s+)?(?:₹|Rs\.?|INR|USD|\$)\s?[\d,]+(?:\s*[kK]|\s*lakh|\s*crore)?/gi;
  while ((m = prizeRe.exec(text)) !== null && prize.length < 5) {
    prize.push(m[0].slice(0, 120));
  }

  const modeMatch = text.match(/(?:fully\s+)?(online|virtual|remote|offline|on[- ]site|in[- ]person)/i);
  const mode = modeMatch && modeMatch[1] ? modeMatch[1].toLowerCase() : 'unknown';

  return { dates, prize, mode };
}

/**
 * Deep-crawl a page: scrape the main URL only (no sub-pages for speed).
 * Sub-page crawling removed to stay within Vercel serverless time limits.
 */
async function deepCrawl(targetUrl, { maxLinks = 2, sameDomain = true } = {}) {
  const main = await scrapeURL(targetUrl, 10000);

  // Collect links from already-fetched content (no extra fetch)
  let links = [];
  try {
    const $ = cheerio.load(main.contentSnippet || '');
    // We already have the parsed page — just extract links from headings/content
    // But we need the raw HTML for link extraction; re-fetch is expensive.
    // Instead, just return the main URL as the only link.
    links = [targetUrl];
  } catch { /* ignore */ }

  return {
    main,
    links: links.slice(0, maxLinks),
    subPages: [],      // No sub-page crawling — keeps it fast
    scrapedCount: 0,
  };
}

/**
 * Scrape a batch of URLs in parallel and merge readable text.
 */
async function scrapeAll(urls, { maxSnippets = 4000 } = {}) {
  const list = (urls || []).slice(0, 6);
  const results = await Promise.allSettled(list.map(u => scrapeURL(u)));
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const combined = ok.map(p => `${p.title}\n${p.description}\n${p.contentSnippet}`).join('\n\n---\n\n');
  return {
    scraped: ok.length,
    failed: results.length - ok.length,
    pages: ok.map(p => ({ url: p.url, title: p.title })),
    combinedText: combined.slice(0, maxSnippets),
  };
}

module.exports = {
  scrapeURL,
  deepCrawl,
  scrapeAll,
  extractEventMeta,
};
