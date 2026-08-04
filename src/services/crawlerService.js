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

async function scrapeURL(targetUrl) {
  try {
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    await validatePublicUrl(targetUrl);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata
    const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || '';
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';

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

    return {
      url: targetUrl,
      title,
      description,
      headings,
      scripts: scripts.slice(0, 10),
      stylesheets: stylesheets.slice(0, 10),
      contentSnippet: cleanText.slice(0, 4000), // First 4000 chars for context
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
    .slice(0, 20000);

  const dates = [];
  const dateRe = /(\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[, ]* \d{2,4})/gi;
  let m;
  while ((m = dateRe.exec(text)) !== null && dates.length < 8) {
    const d = m[1];
    if (!dates.some(x => x.toLowerCase() === d.toLowerCase())) dates.push(d);
  }

  const prize = [];
  const prizeRe = /(?:prize|prizes? pool|cash (?:prize|award)|rewards?)[:\s]+(?:up to\s+)?(?:₹|Rs\.?|INR|USD|\$)\s?[\d,]+(?:\s*[kK]|\s*lakh|\s*crore)?/gi;
  while ((m = prizeRe.exec(text)) !== null && prize.length < 5) {
    prize.push(m[0].slice(0, 120));
  }

  const mode = /(?:fully\s+)?(online|virtual|remote|offline|on[- ]site|in[- ]person)/i.test(text)
    ? (text.match(/(?:fully\s+)?(online|virtual|remote|offline|on[- ]site|in[- ]person)/i)[1].toLowerCase())
    : 'unknown';

  return { dates, prize, mode };
}

/**
 * Deep-crawl a page: scrape the main URL, then scrape up to `maxLinks`
 * internal links. Returns combined context for building rich knowledge panels.
 */
async function deepCrawl(targetUrl, { maxLinks = 5, sameDomain = true } = {}) {
  const main = await scrapeURL(targetUrl);
  let links = [];
  try {
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }
    await validatePublicUrl(targetUrl);
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 15000,
    });
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      const host = new URL(targetUrl).hostname.replace(/^www\./, '');
      links = extractLinks($, targetUrl, maxLinks * 4).filter(l => {
        if (!sameDomain) return true;
        try { return new URL(l.url).hostname.replace(/^www\./, '') === host; }
        catch { return false; }
      });
    }
  } catch (e) { /* best-effort link discovery */ }

  const subPages = [];
  const scraped = [];
  for (const l of links.slice(0, maxLinks)) {
    try {
      const sub = await scrapeURL(l.url);
      subPages.push({ url: sub.url, title: sub.title, contentSnippet: sub.contentSnippet });
      scraped.push(sub.url);
    } catch { /* skip failed sub-page */ }
  }

  return {
    main,
    links: links.slice(0, maxLinks).map(l => l.url),
    subPages,
    scrapedCount: scraped.length,
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
