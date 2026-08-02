const { getYouTubeContext, extractVideoId } = require('./youtubeService');
const { getInstagramContext, isInstagramUrl } = require('./instagramService');

/**
 * Media Detector — Auto-detects YouTube and Instagram links in any message text.
 * Fetches context (transcripts, captions, thumbnails) and returns enriched data
 * that gets injected into Bob's LLM context automatically.
 */

// Regex patterns for link detection
const YOUTUBE_PATTERN = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})[^\s]*/gi;
const INSTAGRAM_PATTERN = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv|reels)\/[a-zA-Z0-9_-]+\/?[^\s]*/gi;
const GENERAL_URL_PATTERN = /https?:\/\/[^\s]+/gi;

/**
 * Finds all YouTube URLs in a text string.
 */
function findYouTubeLinks(text) {
  const matches = [];
  let match;
  const regex = new RegExp(YOUTUBE_PATTERN.source, 'gi');
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return [...new Set(matches)]; // deduplicate
}

/**
 * Finds all Instagram URLs in a text string.
 */
function findInstagramLinks(text) {
  const matches = [];
  let match;
  const regex = new RegExp(INSTAGRAM_PATTERN.source, 'gi');
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return [...new Set(matches)];
}

/**
 * Main enrichment function — given a user's message text, automatically:
 * 1. Detects YouTube/Instagram links
 * 2. Fetches their data (transcripts, captions, thumbnails)
 * 3. Returns structured context to inject into Bob's LLM prompt
 *
 * @param {string} messageText - The raw user message
 * @returns {Promise<{
 *   mediaContext: string,       // Text context to inject into system prompt
 *   imageUrls: string[],        // Thumbnail URLs for vision analysis
 *   hasMedia: boolean,          // Whether any media was found
 *   detectedTypes: string[],    // e.g. ['youtube', 'instagram_reel']
 * }>}
 */
async function enrichMessageWithMedia(messageText) {
  const youtubeLinks = findYouTubeLinks(messageText);
  const instagramLinks = findInstagramLinks(messageText);

  const hasMedia = youtubeLinks.length > 0 || instagramLinks.length > 0;

  if (!hasMedia) {
    return { mediaContext: '', imageUrls: [], hasMedia: false, detectedTypes: [] };
  }

  const contextParts = [];
  const imageUrls = [];
  const detectedTypes = [];

  console.log(`[mediaDetector] Detected links — YouTube: ${youtubeLinks.length}, Instagram: ${instagramLinks.length}`);

  // Process YouTube links (limit to 2 to avoid timeout)
  for (const ytUrl of youtubeLinks.slice(0, 2)) {
    try {
      console.log(`[mediaDetector] Fetching YouTube data for: ${ytUrl}`);
      const ytContext = await getYouTubeContext(ytUrl);
      if (ytContext.success) {
        contextParts.push(ytContext.context);
        detectedTypes.push('youtube');
        // Add thumbnail for visual analysis if available
        if (ytContext.thumbnailUrl) {
          imageUrls.push(ytContext.thumbnailUrl);
        }
      } else {
        contextParts.push(`📺 YouTube URL detected: ${ytUrl}\nNote: ${ytContext.error}`);
        detectedTypes.push('youtube_failed');
      }
    } catch (err) {
      console.error(`[mediaDetector] YouTube processing error:`, err.message);
      contextParts.push(`📺 YouTube URL detected: ${ytUrl}\nNote: Data fetch failed — ${err.message}`);
    }
  }

  // Process Instagram links (limit to 2)
  for (const igUrl of instagramLinks.slice(0, 2)) {
    try {
      console.log(`[mediaDetector] Fetching Instagram data for: ${igUrl}`);
      const igContext = await getInstagramContext(igUrl);
      if (igContext.success) {
        contextParts.push(igContext.context);
        detectedTypes.push(igContext.type);
        // Add thumbnail for vision analysis
        if (igContext.thumbnailUrl) {
          imageUrls.push(igContext.thumbnailUrl);
        }
      } else {
        contextParts.push(`📸 Instagram URL detected: ${igUrl}\nNote: ${igContext.error}`);
        detectedTypes.push('instagram_failed');
      }
    } catch (err) {
      console.error(`[mediaDetector] Instagram processing error:`, err.message);
      contextParts.push(`📸 Instagram URL detected: ${igUrl}\nNote: Data fetch failed — ${err.message}`);
    }
  }

  const mediaContext = contextParts.length > 0
    ? `\n━━━ 🎬 AUTO-EXTRACTED MEDIA DATA ━━━\n${contextParts.join('\n\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : '';

  return { mediaContext, imageUrls, hasMedia: contextParts.length > 0, detectedTypes };
}

module.exports = { enrichMessageWithMedia, findYouTubeLinks, findInstagramLinks };
