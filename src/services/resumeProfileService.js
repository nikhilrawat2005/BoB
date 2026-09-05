// ---------------------------------------------------------------------------
// Bob Resume Intelligence — Master Profile Service
// Aggregates:
//   1. Cloudinary Stored Documents (Base Resume, Certifications)
//   2. GitHub Repositories (Tech stacks, descriptions, README extracts)
//   3. Developer Platforms (LeetCode, Codeforces, HackerRank stats)
//   4. Structured Profile Graph stored in Firestore
// ---------------------------------------------------------------------------
const { db } = require('../config/firebase');
const developerPlatforms = require('./developerPlatformsService');
const documentReader = require('./documentReaderService');
const fetch = require('node-fetch');

/**
 * Fetch Master Career Profile from Firestore
 */
async function getMasterProfile(userId) {
  if (!userId) return null;
  const docRef = db.collection('users').doc(userId).collection('resume_profile').doc('master');
  const snap = await docRef.get();
  if (!snap.exists) {
    return {
      userId,
      personal: {},
      education: [],
      experience: [],
      projects: [],
      skills: { languages: [], frameworks: [], tools: [], databases: [] },
      codingHandles: { github: '', leetcode: '', codeforces: '', hackerrank: '', linkedin: '' },
      codingStats: {},
      certifications: [],
      baseResume: null,
      updatedAt: null
    };
  }
  return snap.data();
}

/**
 * Save or Update Master Career Profile in Firestore
 */
async function saveMasterProfile(userId, profileData) {
  if (!userId) throw new Error('User ID required');
  const docRef = db.collection('users').doc(userId).collection('resume_profile').doc('master');
  const payload = {
    ...profileData,
    userId,
    updatedAt: Date.now()
  };
  await docRef.set(payload, { merge: true });
  return payload;
}

/**
 * Crawl & Extract Deep Context from user's GitHub account
 */
async function syncGitHubProjects(username) {
  if (!username) return [];
  try {
    const headers = { 'User-Agent': 'Bob-Assistant' };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    // 1. Fetch user public repositories
    const res = await fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=15`, { headers });
    if (!res.ok) {
      console.warn(`[ResumeProfile] Failed to fetch GitHub repos for ${username}: ${res.statusText}`);
      return [];
    }
    const repos = await res.json();
    if (!Array.isArray(repos)) return [];

    // Filter non-forked repos with descriptions or stars
    const relevantRepos = repos
      .filter(r => !r.fork)
      .sort((a, b) => (b.stargazers_count + b.forks_count) - (a.stargazers_count + a.forks_count))
      .slice(0, 8);

    // 2. Deep inspect top repos (fetch languages & README snippet)
    const projectPromises = relevantRepos.map(async (repo) => {
      let languages = [];
      let readmeSummary = '';

      try {
        const langRes = await fetch(repo.languages_url, { headers });
        if (langRes.ok) {
          const langData = await langRes.json();
          languages = Object.keys(langData).slice(0, 5);
        }
      } catch (err) {
        // Ignore language fail
      }

      try {
        const readmeRes = await fetch(`https://api.github.com/repos/${username}/${repo.name}/readme`, { headers });
        if (readmeRes.ok) {
          const readmeData = await readmeRes.json();
          if (readmeData.content) {
            const rawReadme = Buffer.from(readmeData.content, 'base64').toString('utf8');
            // Clean markdown headings & keep concise first 600 chars
            readmeSummary = rawReadme
              .replace(/#+\s+/g, '')
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              .slice(0, 500)
              .trim();
          }
        }
      } catch (err) {
        // Ignore readme fail
      }

      return {
        title: repo.name,
        description: repo.description || '',
        githubUrl: repo.html_url,
        liveUrl: repo.homepage || '',
        techStack: languages.length > 0 ? languages : [repo.language].filter(Boolean),
        stars: repo.stargazers_count,
        summary: readmeSummary || repo.description || ''
      };
    });

    return await Promise.all(projectPromises);
  } catch (err) {
    console.error('[ResumeProfile] GitHub Sync error:', err.message);
    return [];
  }
}

/**
 * Deep Refresh all online developer platforms stats
 */
async function syncDeveloperProfiles(handles = {}) {
  const stats = await developerPlatforms.fetchAllDeveloperProfiles(handles);
  return stats;
}

/**
 * Parse an uploaded Resume PDF and return structured profile hints
 */
async function parseResumePdf(buffer) {
  const extraction = await documentReader.extractText(buffer, 'resume.pdf');
  return {
    rawText: extraction.text || '',
    pageCount: extraction.pageCount
  };
}

module.exports = {
  getMasterProfile,
  saveMasterProfile,
  syncGitHubProjects,
  syncDeveloperProfiles,
  parseResumePdf
};
