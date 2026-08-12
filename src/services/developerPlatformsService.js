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
 * 5. Master Aggregator: Fetch all developer profiles in parallel
 */
async function fetchAllDeveloperProfiles(handles = {}) {
  const tasks = [];

  if (handles.leetcode) tasks.push(getLeetCodeStats(handles.leetcode));
  if (handles.codeforces) tasks.push(getCodeforcesStats(handles.codeforces));
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

module.exports = {
  getLeetCodeStats,
  getCodeforcesStats,
  getHackerRankStats,
  getDevToArticles,
  fetchAllDeveloperProfiles
};
