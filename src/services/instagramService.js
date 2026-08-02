const fetch = require('node-fetch');
const cheerio = require('cheerio');

/**
 * Instagram Service — Extracts data from any public Instagram post, Reel, or video URL.
 * Uses oEmbed API + HTML meta tag scraping (no API key, fully free).
 * Visual analysis is done by passing the thumbnail to a vision LLM.
 */

/**
 * Detects if a URL is an Instagram link.
 */
function isInstagramUrl(url) {
  return /instagram\.com\/(p|reel|tv|reels)\/[a-zA-Z0-9_-]+/i.test(url);
}

/**
 * Fetches Instagram post/reel data via oEmbed API.
 * Returns title, thumbnail, author — no auth needed for public posts.
 */
async function fetchViaOEmbed(url) {
  try {
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=640`;
    const res = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    });

    if (!res.ok) return null;
    const data = await res.json();

    return {
      title: data.title || '',
      author: data.author_name || '',
      thumbnailUrl: data.thumbnail_url || null,
      mediaType: data.type || 'rich',
      providerName: data.provider_name || 'Instagram',
    };
  } catch (err) {
    console.error('[instagramService] oEmbed fetch failed:', err.message);
    return null;
  }
}

/**
 * Scrapes the Instagram page HTML to extract structured data from meta tags.
 * Instagram embeds JSON-LD and Open Graph data in public pages.
 */
async function fetchViaHTMLScrape(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 12000,
    });

    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const result = {};

    // Open Graph meta tags
    result.ogTitle       = $('meta[property="og:title"]').attr('content') || '';
    result.ogDescription = $('meta[property="og:description"]').attr('content') || '';
    result.ogImage       = $('meta[property="og:image"]').attr('content') || null;
    result.ogVideo       = $('meta[property="og:video"]').attr('content') || null;
    result.ogType        = $('meta[property="og:type"]').attr('content') || '';

    // Twitter card
    result.twitterTitle  = $('meta[name="twitter:title"]').attr('content') || '';
    result.twitterDesc   = $('meta[name="twitter:description"]').attr('content') || '';
    result.twitterImage  = $('meta[name="twitter:image"]').attr('content') || null;

    // Extract caption from description (Instagram puts "caption • author" in og:description)
    const rawDesc = result.ogDescription || result.twitterDesc || '';
    // Extract the caption text (before the "likes" / "comments" count part)
    const captionMatch = rawDesc.match(/^(.*?)(?:\s*\d+\s*(?:Likes|Comments|Followers)|\s*$)/is);
    result.caption = captionMatch ? captionMatch[1].trim() : rawDesc.trim();

    // Detect if it's a Reel
    result.isReel = url.includes('/reel/') || result.ogType === 'video';

    // Best thumbnail: og:image preferred
    result.thumbnailUrl = result.ogImage || result.twitterImage || null;

    return result;
  } catch (err) {
    console.error('[instagramService] HTML scrape failed:', err.message);
    return null;
  }
}

/**
 * Main entry point — given any Instagram URL, returns full context for Bob.
 * Tries oEmbed first, falls back to HTML scraping.
 */
async function getInstagramContext(url) {
  // Run both in parallel for best coverage
  const [oembedData, htmlData] = await Promise.all([
    fetchViaOEmbed(url),
    fetchViaHTMLScrape(url),
  ]);

  if (!oembedData && !htmlData) {
    return {
      success: false,
      error: 'Instagram post ka data fetch nahi ho saka. Post private ho sakti hai ya Instagram ne block kar diya.',
    };
  }

  // Merge the best data from both sources
  const merged = {
    title:        oembedData?.title       || htmlData?.ogTitle       || htmlData?.twitterTitle || '',
    author:       oembedData?.author      || '',
    caption:      htmlData?.caption       || htmlData?.ogDescription  || oembedData?.title || '',
    thumbnailUrl: oembedData?.thumbnailUrl || htmlData?.thumbnailUrl  || null,
    isReel:       htmlData?.isReel        || url.includes('/reel/')   || false,
    videoUrl:     htmlData?.ogVideo       || null,
  };

  const mediaTypeLabel = merged.isReel ? '🎬 INSTAGRAM REEL' : '📸 INSTAGRAM POST';

  let contextText = `${mediaTypeLabel} DATA:\n`;
  contextText += `URL: ${url}\n`;
  if (merged.author)  contextText += `Author: @${merged.author}\n`;
  if (merged.title && merged.title !== merged.caption) contextText += `Title: ${merged.title}\n`;
  if (merged.caption) contextText += `Caption/Description: "${merged.caption}"\n`;
  if (merged.isReel)  contextText += `Type: Video Reel\n`;
  if (merged.thumbnailUrl) contextText += `[Thumbnail available for visual analysis]\n`;

  return {
    success:      true,
    type:         merged.isReel ? 'instagram_reel' : 'instagram_post',
    thumbnailUrl: merged.thumbnailUrl,
    context:      contextText,
    isReel:       merged.isReel,
  };
}

module.exports = { isInstagramUrl, getInstagramContext };
