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

module.exports = {
  scrapeURL,
};
