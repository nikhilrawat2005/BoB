const fetch = require('node-fetch');
const cheerio = require('cheerio');

/**
 * Autonomous Web Crawler & Scraper Service
 * Scrapes HTML, JavaScript snippets, CSS styles, metadata, links, and readable text from any URL
 */

async function scrapeURL(targetUrl) {
  try {
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

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
