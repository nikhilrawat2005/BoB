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
const fileService = require('./fileService');
const fetch = require('node-fetch');

/**
 * Fetch Candidate / Master Career Profile from Firestore
 */
async function getMasterProfile(userId, profileId = 'master') {
  if (!userId) return null;
  const safeProfileId = (profileId || 'master').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'master';
  const docRef = db.collection('users').doc(userId).collection('resume_profile').doc(safeProfileId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return {
      userId,
      profileId: safeProfileId,
      profileName: safeProfileId === 'master' ? 'Primary Profile (Self)' : safeProfileId,
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
  const data = snap.data();
  return {
    ...data,
    profileId: safeProfileId,
    profileName: data.profileName || (safeProfileId === 'master' ? 'Primary Profile (Self)' : safeProfileId)
  };
}

/**
 * Save or Update Candidate / Master Career Profile in Firestore
 */
async function saveMasterProfile(userId, profileData, profileId = 'master') {
  if (!userId) throw new Error('User ID required');
  const safeProfileId = (profileId || profileData?.profileId || 'master').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'master';
  const docRef = db.collection('users').doc(userId).collection('resume_profile').doc(safeProfileId);
  const payload = {
    ...profileData,
    userId,
    profileId: safeProfileId,
    profileName: profileData?.profileName || (safeProfileId === 'master' ? 'Primary Profile (Self)' : safeProfileId),
    updatedAt: Date.now()
  };
  await docRef.set(payload, { merge: true });
  return payload;
}

/**
 * List all candidate profiles created by this user
 */
async function listCandidateProfiles(userId) {
  if (!userId) return [];
  const colRef = db.collection('users').doc(userId).collection('resume_profile');
  const snap = await colRef.get();
  const profiles = [];
  snap.forEach(doc => {
    const d = doc.data() || {};
    profiles.push({
      profileId: doc.id,
      profileName: d.profileName || (doc.id === 'master' ? 'Primary Profile (Self)' : doc.id),
      githubUsername: d.githubUsername || '',
      updatedAt: d.updatedAt || null,
      isDefault: doc.id === 'master'
    });
  });

  // Ensure 'master' is always in the list
  if (!profiles.some(p => p.profileId === 'master')) {
    profiles.unshift({
      profileId: 'master',
      profileName: 'Primary Profile (Self)',
      githubUsername: '',
      updatedAt: null,
      isDefault: true
    });
  }
  return profiles;
}

/**
 * Delete a candidate profile (and its privately-owned saved files)
 */
async function deleteCandidateProfile(userId, profileId) {
  if (!userId || !profileId || profileId === 'master') {
    throw new Error('Cannot delete primary master profile');
  }

  const loadedDocRef = db.collection('users').doc(userId).collection('resume_profile').doc(profileId);

  // Collect file references (Cloudinary-backed Firestore records) owned by this profile
  const fileRefs = new Set();
  try {
    const snap = await loadedDocRef.get();
    const data = snap.exists ? snap.data() || {} : {};
    if (data.baseResume && data.baseResume.fileId) fileRefs.add(data.baseResume.fileId);
    (data.certifications || []).forEach(cert => {
      if (cert && cert.id) fileRefs.add(cert.id);
    });
  } catch (err) {
    console.warn(`[ResumeProfile] Could not read profile files for ${profileId}: ${err.message}`);
  }

  // Delete the Firestore profile doc first
  await loadedDocRef.delete();

  // Determine which files are still referenced by OTHER profiles (dedup/shared files)
  const sharedFileIds = new Set();
  if (fileRefs.size > 0) {
    try {
      const allDocs = await db.collection('users').doc(userId).collection('resume_profile').listDocuments();
      const snapshots = await Promise.all(allDocs.map(doc => doc.get()));
      snapshots.forEach(snapIt => {
        const d = snapIt.exists ? snapIt.data() || {} : {};
        if (d.baseResume && d.baseResume.fileId) sharedFileIds.add(d.baseResume.fileId);
        (d.certifications || []).forEach(cert => {
          if (cert && cert.id) sharedFileIds.add(cert.id);
        });
      });
    } catch (err) {
      console.warn('[ResumeProfile] Could not scan shared files:', err.message);
    }
  }

  const deletedFiles = [];
  const failedFiles = [];
  const sharedFiles = [];

  for (const fileId of fileRefs) {
    if (sharedFileIds.has(fileId)) {
      sharedFiles.push(fileId);
      continue;
    }
    try {
      await fileService.deleteFile(userId, fileId);
      deletedFiles.push(fileId);
    } catch (err) {
      console.warn(`[ResumeProfile] Failed to delete file ${fileId}: ${err.message}`);
      failedFiles.push(fileId);
    }
  }

  return {
    success: true,
    deleted: profileId,
    deletedFiles,
    failedFiles,
    sharedFiles
  };
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

    // 1. Fetch user public repositories (up to 100)
    const res = await fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=100`, { headers });
    if (!res.ok) {
      console.warn(`[ResumeProfile] Failed to fetch GitHub repos for ${username}: ${res.statusText}`);
      return [];
    }
    const repos = await res.json();
    if (!Array.isArray(repos)) return [];

    // Filter non-forked original repos
    const relevantRepos = repos.filter(r => !r.fork);

    // 2. Deep inspect repos (fetch languages & README snippets)
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
            // Clean markdown links and preserve rich feature descriptions up to 1800 chars
            readmeSummary = rawReadme
              .replace(/#+\s+/g, '')
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              .slice(0, 1800)
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
 * Sync custom smart links (portfolio, coding platforms, personal blogs, etc.)
 */
async function syncSmartLinks(userId, links = [], profileId = 'master') {
  const result = await developerPlatforms.fetchSmartLinks(links);
  const profile = await getMasterProfile(userId, profileId);

  // Preserve existing developer platforms and merge new data
  profile.developerPlatforms = {
    ...(profile.developerPlatforms || {}),
    ...(result.platforms || {})
  };

  profile.smartLinks = (links || []).map(l => ({
    label: (l.label || '').trim(),
    url: (l.url || '').trim()
  })).filter(l => l.url);

  profile.smartLinksResult = result.items || [];

  await saveMasterProfile(userId, profile, profileId);
  return {
    smartLinks: profile.smartLinks,
    smartLinksResult: profile.smartLinksResult,
    developerPlatforms: profile.developerPlatforms
  };
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
  listCandidateProfiles,
  deleteCandidateProfile,
  syncGitHubProjects,
  syncDeveloperProfiles,
  syncSmartLinks,
  parseResumePdf
};

