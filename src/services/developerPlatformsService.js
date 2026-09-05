// ---------------------------------------------------------------------------
// Bob HQ — Developer Platforms Intelligence Service
// Fetches free official public data across developer & coding platforms:
//   - LeetCode (Public GraphQL)
//   - Codeforces (Official REST API)
//   - HackerRank (Public Badges API)
//   - DEV.to (Official REST API)
//   - GitHub (Official REST API)
// ---------------------------------------------------------------------------
const fetch = require('node-fetch');

/**
 * 1. LeetCode Public Stats via Free GraphQL Endpoint
 */
async function getLeetCodeStats(username) {
  if (!username) return null;
  const query = `
    query userPublicProfile($username: String!) {
      matchedUser(username: $username) {
        username
        profile {
          ranking
          userAvatar
          reputation
        }
        submitStats: submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
  `;
  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { username } }),
      timeout: 4000
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data?.data?.matchedUser;
    if (!user) return null;

    const stats = user.submitStats?.acSubmissionNum || [];
    return {
      platform: 'LeetCode',
      username,
      profileUrl: `https://leetcode.com/u/${username}`,
      ranking: user.profile?.ranking || 'N/A',
      solvedTotal: stats.find(s => s.difficulty === 'All')?.count || 0,
      solvedEasy: stats.find(s => s.difficulty === 'Easy')?.count || 0,
      solvedMedium: stats.find(s => s.difficulty === 'Medium')?.count || 0,
      solvedHard: stats.find(s => s.difficulty === 'Hard')?.count || 0
    };
  } catch (err) {
    console.error(`[DeveloperPlatforms] LeetCode fetch error for ${username}:`, err.message);
    return null;
  }
}

/**
 * 2. Codeforces Public Profile via Official REST API
 */
async function getCodeforcesStats(handle) {
  if (!handle) return null;
  try {
    const res = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`, { timeout: 4000 });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.result?.[0]) return null;

    const user = data.result[0];
    return {
      platform: 'Codeforces',
      handle,
      profileUrl: `https://codeforces.com/profile/${handle}`,
      rating: user.rating || 0,
      rank: user.rank || 'Unrated',
      maxRating: user.maxRating || 0,
      maxRank: user.maxRank || 'Unrated'
    };
  } catch (err) {
    console.error(`[DeveloperPlatforms] Codeforces fetch error for ${handle}:`, err.message);
    return null;
  }
}

/**
 * 3. HackerRank Public Badges
 */
async function getHackerRankStats(username) {
  if (!username) return null;
  try {
    const res = await fetch(`https://www.hackerrank.com/rest/hackers/${username}/badges`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 4000
    });
    if (!res.ok) return null;
    const data = await res.json();
    const badges = (data.models || []).map(b => ({
      badgeName: b.badge_name,
      stars: b.stars
    }));

    return {
      platform: 'HackerRank',
      username,
      profileUrl: `https://www.hackerrank.com/profile/${username}`,
      totalBadges: badges.length,
      badges
    };
  } catch (err) {
    console.error(`[DeveloperPlatforms] HackerRank fetch error for ${username}:`, err.message);
    return null;
  }
}

/**
 * 4. DEV.to Official REST API Articles
 */
async function getDevToArticles(username) {
  if (!username) return null;
  try {
    const res = await fetch(`https://dev.to/api/articles?username=${username}`, { timeout: 4000 });
    if (!res.ok) return null;
    const articles = await res.json();
    if (!Array.isArray(articles)) return null;

    return {
      platform: 'DEV.to',
      username,
      profileUrl: `https://dev.to/${username}`,
      articleCount: articles.length,
      topArticles: articles.slice(0, 5).map(a => ({
        title: a.title,
        url: a.url,
        publishedAt: a.readable_publish_date,
        tags: a.tag_list || []
      }))
    };
  } catch (err) {
    console.error(`[DeveloperPlatforms] DEV.to fetch error for ${username}:`, err.message);
    return null;
  }
}

/**
 * 5. CodeChef Public Profile Scraper
 */
const cheerio = require('cheerio');

async function getCodeChefStats(username) {
  if (!username) return null;
  try {
    const res = await fetch(`https://www.codechef.com/users/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = cheerio.load(html);

    const ratingRaw = doc('.rating-number').first().text().trim();
    const rating = parseInt(ratingRaw, 10) || 0;
    const stars = doc('.rating-star').first().text().trim() || 'Unrated';
    const globalRank = doc('.rating-ranks strong').first().text().trim() || 'N/A';

    return {
      platform: 'CodeChef',
      username,
      profileUrl: `https://www.codechef.com/users/${username}`,
      rating,
      stars,
      globalRank
    };
  } catch (err) {
    console.error(`[DeveloperPlatforms] CodeChef fetch error for ${username}:`, err.message);
    return null;
  }
}

/**
 * 6. Generic Portfolio / Webpage Profile Extractor
 * Fetches public HTML, extracts readable text, and extracts developer signals using LLM
 */
const { callLLM } = require('./llmService');

async function extractGenericWebProfile(url, customLabel = 'Portfolio') {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 7000
    });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = cheerio.load(html);

    // Remove noisy elements
    doc('script, style, noscript, svg, nav, footer, iframe').remove();
    const bodyText = doc('body').text().replace(/\s+/g, ' ').trim().slice(0, 3500);

    if (!bodyText || bodyText.length < 50) return null;

    // Use LLM to extract structured developer insights from portfolio / page
    const prompt = `You are a developer profile auditor. Extract key developer information from this website text.
URL: ${url}
Label: ${customLabel}
Page text:
"""
${bodyText}
"""

Return ONLY a valid JSON object matching:
{
  "platform": "${customLabel || 'Portfolio'}",
  "profileUrl": "${url}",
  "headline": "Short 1-line professional title or tagline",
  "skills": ["Skill1", "Skill2"],
  "projects": ["Project Name 1", "Project Name 2"],
  "achievements": ["Achievement or highlight 1"],
  "summary": "Brief 1-2 sentence developer summary"
}`;

    const llmRes = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    });

    const raw = (llmRes && llmRes.text) ? llmRes.text : String(llmRes);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return {
        platform: parsed.platform || customLabel || 'Portfolio',
        profileUrl: url,
        headline: parsed.headline || '',
        skills: parsed.skills || [],
        projects: parsed.projects || [],
        achievements: parsed.achievements || [],
        summary: parsed.summary || ''
      };
    }
    return {
      platform: customLabel || 'Portfolio',
      profileUrl: url,
      summary: bodyText.slice(0, 200)
    };
  } catch (err) {
    console.error(`[DeveloperPlatforms] Generic page extract error for ${url}:`, err.message);
    return null;
  }
}

/**
 * 7. Smart URL Dispatcher: Detect platform and extract username/handle
 */
function parsePlatformFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const str = rawUrl.trim();
  let pathname = '';
  let hostname = '';

  try {
    const urlObj = new URL(str.startsWith('http') ? str : `https://${str}`);
    hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    pathname = urlObj.pathname;
  } catch (e) {
    return null;
  }

  const parts = pathname.split('/').filter(Boolean);

  if (hostname.includes('leetcode.com')) {
    // /u/username or /username
    const user = (parts[0] === 'u' ? parts[1] : parts[0]) || '';
    return { type: 'leetcode', handle: user.replace(/\/+$/, '') };
  }
  if (hostname.includes('codechef.com')) {
    // /users/username or /username
    const user = (parts[0] === 'users' ? parts[1] : parts[0]) || '';
    return { type: 'codechef', handle: user.replace(/\/+$/, '') };
  }
  if (hostname.includes('codeforces.com')) {
    // /profile/handle
    const user = (parts[0] === 'profile' ? parts[1] : parts[0]) || '';
    return { type: 'codeforces', handle: user.replace(/\/+$/, '') };
  }
  if (hostname.includes('hackerrank.com')) {
    // /profile/username or /username
    const user = (parts[0] === 'profile' ? parts[1] : parts[0]) || '';
    return { type: 'hackerrank', handle: user.replace(/\/+$/, '') };
  }
  if (hostname.includes('dev.to')) {
    const user = parts[0] || '';
    return { type: 'devto', handle: user.replace(/\/+$/, '') };
  }
  if (hostname.includes('github.com')) {
    const user = parts[0] || '';
    return { type: 'github', handle: user.replace(/\/+$/, '') };
  }

  return { type: 'generic', url: str };
}

/**
 * 8. Master Aggregator: Fetch all developer profiles in parallel (legacy handles support)
 */
async function fetchAllDeveloperProfiles(handles = {}) {
  const tasks = [];

  if (handles.leetcode) tasks.push(getLeetCodeStats(handles.leetcode));
  if (handles.codeforces) tasks.push(getCodeforcesStats(handles.codeforces));
  if (handles.codechef) tasks.push(getCodeChefStats(handles.codechef));
  if (handles.hackerrank) tasks.push(getHackerRankStats(handles.hackerrank));
  if (handles.devto) tasks.push(getDevToArticles(handles.devto));

  const results = await Promise.allSettled(tasks);
  
  const profiles = {};
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value) {
      profiles[r.value.platform.toLowerCase()] = r.value;
    }
  });

  return profiles;
}

/**
 * 9. Smart Links Aggregator: Fetches arbitrary list of { label, url }
 */
async function fetchSmartLinks(links = []) {
  if (!Array.isArray(links) || links.length === 0) return { platforms: {}, items: [] };

  const tasks = links.map(async (item) => {
    const url = item.url ? item.url.trim() : '';
    const label = item.label ? item.label.trim() : '';
    if (!url) return null;

    const detected = parsePlatformFromUrl(url);
    if (!detected) return null;

    let data = null;
    let category = 'custom';

    try {
      if (detected.type === 'leetcode' && detected.handle) {
        data = await getLeetCodeStats(detected.handle);
        category = 'coding';
      } else if (detected.type === 'codechef' && detected.handle) {
        data = await getCodeChefStats(detected.handle);
        category = 'coding';
      } else if (detected.type === 'codeforces' && detected.handle) {
        data = await getCodeforcesStats(detected.handle);
        category = 'coding';
      } else if (detected.type === 'hackerrank' && detected.handle) {
        data = await getHackerRankStats(detected.handle);
        category = 'coding';
      } else if (detected.type === 'devto' && detected.handle) {
        data = await getDevToArticles(detected.handle);
        category = 'blog';
      } else if (detected.type === 'github') {
        category = 'github';
        data = { platform: 'GitHub', username: detected.handle, profileUrl: url };
      } else {
        // Generic portfolio / custom website crawler + LLM analysis
        data = await extractGenericWebProfile(url, label || 'Portfolio');
        category = 'portfolio';
      }
    } catch (e) {
      console.error(`[SmartLinks] Failed to fetch data for ${url}:`, e.message);
    }

    return {
      label: label || data?.platform || detected.type,
      url,
      type: detected.type,
      category,
      success: Boolean(data),
      data: data || null
    };
  });

  const resolved = await Promise.all(tasks);
  const validItems = resolved.filter(Boolean);

  const platforms = {};
  validItems.forEach(item => {
    if (item.success && item.data) {
      const key = (item.data.platform || item.label || item.type).toLowerCase().replace(/[^a-z0-9]/g, '_');
      platforms[key] = item.data;
    }
  });

  return {
    platforms,
    items: validItems
  };
}

module.exports = {
  getLeetCodeStats,
  getCodeforcesStats,
  getCodeChefStats,
  getHackerRankStats,
  getDevToArticles,
  extractGenericWebProfile,
  parsePlatformFromUrl,
  fetchAllDeveloperProfiles,
  fetchSmartLinks
};
