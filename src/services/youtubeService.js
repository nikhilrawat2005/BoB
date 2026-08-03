const { YoutubeTranscript } = require('youtube-transcript');

/**
 * YouTube Service — Extracts video transcripts automatically from any YouTube URL.
 * No API key required. Works on any public video with captions enabled.
 */

/**
 * Extracts the YouTube video ID from any URL format:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 */
function extractVideoId(url) {
  try {
    const patterns = [
      /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{6,})/,
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{6,})/,
      /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{6,})/,
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/,
      /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{6,})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches and formats the transcript for a YouTube video.
 * Returns the full text with timestamps stripped for clean reading.
 */
async function fetchTranscript(videoId) {
  try {
    // Try English first, then any available language
    let transcriptItems;
    try {
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    } catch {
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    }

    if (!transcriptItems || transcriptItems.length === 0) {
      return null;
    }

    // Combine all transcript parts into readable text
    const fullText = transcriptItems
      .map(item => item.text.trim())
      .filter(t => t.length > 0)
      .join(' ')
      .replace(/\[.*?\]/g, '') // Remove [Music], [Applause] etc.
      .replace(/\s+/g, ' ')
      .trim();

    const totalDurationSec = transcriptItems.reduce((sum, item) => sum + (item.duration || 0), 0);
    const durationMin = Math.round(totalDurationSec / 60);

    return {
      text: fullText,
      wordCount: fullText.split(' ').length,
      durationMinutes: durationMin,
      segmentCount: transcriptItems.length,
    };
  } catch (err) {
    console.error(`[youtubeService] Transcript fetch failed for ${videoId}:`, err.message);
    return null;
  }
}

/**
 * Fetches basic video metadata from YouTube's oEmbed endpoint (no API key needed).
 */
async function fetchVideoMetadata(videoId) {
  try {
    const fetch = require('node-fetch');
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl, { timeout: 8000 });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || '',
      author: data.author_name || '',
      thumbnailUrl: data.thumbnail_url || '',
    };
  } catch {
    return null;
  }
}

/**
 * Main entry point — given any YouTube URL, returns full context for Bob.
 * Includes video metadata + complete transcript.
 */
async function getYouTubeContext(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return { success: false, error: 'YouTube video ID extract nahi ho saka is URL se.' };
  }

  // Fetch metadata and transcript in parallel
  const [metadata, transcript] = await Promise.all([
    fetchVideoMetadata(videoId),
    fetchTranscript(videoId),
  ]);

  if (!transcript && !metadata) {
    return { success: false, error: 'YouTube video ka data fetch nahi ho saka.' };
  }

  let contextText = `📺 YOUTUBE VIDEO DATA:\n`;
  if (metadata) {
    contextText += `Title: "${metadata.title}"\n`;
    contextText += `Channel: ${metadata.author}\n`;
  }
  contextText += `Video ID: ${videoId}\n`;
  contextText += `URL: ${url}\n`;

  if (transcript) {
    contextText += `Duration: ~${transcript.durationMinutes} minutes\n`;
    contextText += `\n📝 FULL TRANSCRIPT (${transcript.wordCount} words):\n`;
    // Limit to ~6000 chars to avoid overwhelming context
    contextText += transcript.text.slice(0, 6000);
    if (transcript.text.length > 6000) {
      contextText += `\n...[transcript continues, ${transcript.text.length - 6000} more chars]`;
    }
  } else {
    contextText += `\n⚠️ Transcript unavailable (captions disabled on this video). Video metadata only.`;
  }

  return {
    success: true,
    type: 'youtube',
    videoId,
    thumbnailUrl: metadata?.thumbnailUrl || null,
    context: contextText,
  };
}

module.exports = { extractVideoId, fetchTranscript, getYouTubeContext };
