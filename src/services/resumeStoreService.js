const { db } = require('../config/firebase');
const { fetchUserRepositories, classifyAndExtractDocument, sanitizeAndRepairStoredDoc } = require('./resumeIngestionService');
const developerPlatforms = require('./developerPlatformsService');
const fileService = require('./fileService');

const DEFAULT_PROFILE_ID = 'master';

/**
 * Normalizes profileId string
 */
function cleanProfileId(id) {
  return (id || DEFAULT_PROFILE_ID).trim().replace(/[^a-zA-Z0-9_-]/g, '_') || DEFAULT_PROFILE_ID;
}

/**
 * Get profile document reference
 */
function getProfileDocRef(userId, profileId = DEFAULT_PROFILE_ID) {
  const safeId = cleanProfileId(profileId);
  return db.collection('users').doc(userId).collection('resume_profile').doc(safeId);
}

/**
 * 1. Fetch Candidate / Master Profile from Firestore
 */
async function getResumeProfile(userId, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) return null;
  const docRef = getProfileDocRef(userId, profileId);
  const snap = await docRef.get();

  if (!snap.exists) {
    const defaultData = {
      userId,
      profileId: cleanProfileId(profileId),
      candidateName: 'Nikhil Rawat',
      email: 'nikhil2005114@gmail.com',
      phone: '+91-8700113731',
      location: 'Ghaziabad, India',
      githubUsername: 'nikhilrawat2005',
      smartLinks: [
        { label: 'LinkedIn', url: 'https://linkedin.com/in/nikhilrawat-dev' },
        { label: 'LeetCode', url: 'https://leetcode.com/u/nikhilrawat_dev' },
        { label: 'BoB Live', url: 'https://bob-jade-tau.vercel.app' },
        { label: 'The Falcon Tour', url: 'https://thefalcontour.com' }
      ],
      documents: [], // Array of { id, title, docType, originalName, url, fileHash, tier, extractedInfo, createdAt }
      githubProjects: [], // All synced repositories from GitHub
      excludedRepos: [], // List of repo names excluded from resume
      updatedAt: Date.now()
    };
    await docRef.set(defaultData, { merge: true });
    return defaultData;
  }

  const data = snap.data();
  const rawDocs = Array.isArray(data.documents) ? data.documents : [];
  let documentsRepaired = false;

  const repairedDocs = rawDocs.map(doc => {
    const repaired = sanitizeAndRepairStoredDoc(doc);
    if (JSON.stringify(repaired) !== JSON.stringify(doc)) {
      documentsRepaired = true;
    }
    return repaired;
  });

  if (documentsRepaired) {
    console.log(`[resumeStoreService] Auto-repaired ${repairedDocs.length} stored documents for ${userId}. Persisting back to Firestore...`);
    docRef.set({
      documents: repairedDocs,
      updatedAt: Date.now()
    }, { merge: true }).catch(err => {
      console.warn('[resumeStoreService] Error saving auto-repaired docs:', err.message);
    });
  }

  return {
    ...data,
    profileId: cleanProfileId(profileId),
    smartLinks: Array.isArray(data.smartLinks) ? data.smartLinks : [],
    documents: repairedDocs,
    githubProjects: Array.isArray(data.githubProjects) ? data.githubProjects : [],
    excludedRepos: Array.isArray(data.excludedRepos) ? data.excludedRepos : []
  };
}

/**
 * 2. Save / Update Basic Profile Fields & Links
 */
async function saveResumeProfile(userId, updateData, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const docRef = getProfileDocRef(userId, profileId);

  const payload = {
    ...updateData,
    userId,
    profileId: cleanProfileId(profileId),
    updatedAt: Date.now()
  };

  await docRef.set(payload, { merge: true });
  return await getResumeProfile(userId, profileId);
}

/**
 * 3. Add single or multiple documents turn-by-turn to Firestore
 * Uses fileService for Cloudinary storage + SHA-256 deduplication + document text extraction
 */
async function addDocument(userId, file, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  if (!file || !file.buffer) throw new Error('No file buffer provided');

  // 1. Upload file through fileService (handles Cloudinary + deduplication)
  let fileRecord;
  try {
    fileRecord = await fileService.uploadFile(userId, file);
  } catch (err) {
    console.error(`[resumeStoreService] fileService upload error for ${file.originalname}:`, err.message);
    // Fallback if Cloudinary has network issue: store minimal metadata
    fileRecord = {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      url: '',
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      createdAt: Date.now()
    };
  }

  // 2. Classify document (Education / Certification / Tier) using resumeIngestionService
  let classified = null;
  try {
    classified = await classifyAndExtractDocument(file.buffer, file.originalname);
  } catch (err) {
    console.warn(`[resumeStoreService] Classification warning for ${file.originalname}:`, err.message);
  }

  const newDoc = {
    id: fileRecord.id || ('doc_' + Date.now()),
    title: (classified && classified.title) || file.originalname.replace(/\.[^/.]+$/, ''),
    docType: (classified && classified.docType) || 'OTHER',
    tier: (classified && classified.tier) || 2,
    originalName: file.originalname,
    url: fileRecord.url || '',
    fileHash: fileRecord.fileHash || '',
    sizeBytes: file.size,
    extractedInfo: classified || null,
    createdAt: Date.now()
  };

  // 3. Atomically append or update in user's profile document list in Firestore
  const profile = await getResumeProfile(userId, profileId);
  const docs = profile.documents || [];

  // If already exists with same hash or ID, replace; otherwise append
  const existingIdx = docs.findIndex(d => (d.fileHash && d.fileHash === newDoc.fileHash) || d.id === newDoc.id);
  if (existingIdx >= 0) {
    docs[existingIdx] = newDoc;
  } else {
    docs.push(newDoc);
  }

  await getProfileDocRef(userId, profileId).update({
    documents: docs,
    updatedAt: Date.now()
  });

  return { addedDoc: newDoc, totalDocuments: docs.length, documents: docs };
}

/**
 * 4. Remove a document by docId from Firestore
 */
async function removeDocument(userId, docId, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const profile = await getResumeProfile(userId, profileId);
  const filtered = (profile.documents || []).filter(d => d.id !== docId && d.originalName !== docId);

  await getProfileDocRef(userId, profileId).update({
    documents: filtered,
    updatedAt: Date.now()
  });

  return { success: true, removedId: docId, remaining: filtered.length, documents: filtered };
}

/**
 * 5. Update or Add a Smart Link (or batch of links)
 */
async function saveSmartLinks(userId, smartLinks, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const validLinks = (smartLinks || [])
    .filter(l => l && l.url && String(l.url).trim().length > 0)
    .map(l => ({
      label: (l.label || autolabelLink(l.url)).trim(),
      url: String(l.url).trim()
    }));

  await getProfileDocRef(userId, profileId).update({
    smartLinks: validLinks,
    updatedAt: Date.now()
  });

  return validLinks;
}

/**
 * 6. Remove a smart link
 */
async function removeSmartLink(userId, urlToRemove, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const profile = await getResumeProfile(userId, profileId);
  const updatedLinks = (profile.smartLinks || []).filter(l => l.url !== urlToRemove);

  await getProfileDocRef(userId, profileId).update({
    smartLinks: updatedLinks,
    updatedAt: Date.now()
  });

  return updatedLinks;
}

/**
 * 7. Sync GitHub repositories and store full list in Firestore
 */
async function syncGitHubRepos(userId, githubUsername, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const cleanUser = String(githubUsername).replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').trim();
  if (!cleanUser) throw new Error('GitHub username is required');

  const repos = await fetchUserRepositories(cleanUser);

  // Preserve existing excluded list
  const profile = await getResumeProfile(userId, profileId);
  const excludedSet = new Set(profile.excludedRepos || []);

  const repoRecords = repos.map(r => ({
    name: r.name,
    fullName: r.fullName,
    description: r.description || '',
    stars: r.stars || 0,
    forks: r.forks || 0,
    language: r.language || '',
    homepage: r.homepage || '',
    repoUrl: r.repoUrl || `https://github.com/${r.fullName}`,
    isExcluded: excludedSet.has(r.name),
    pushedAt: r.pushedAt || ''
  }));

  await getProfileDocRef(userId, profileId).update({
    githubUsername: cleanUser,
    githubProjects: repoRecords,
    updatedAt: Date.now()
  });

  return {
    githubUsername: cleanUser,
    repos: repoRecords,
    total: repoRecords.length,
    excludedCount: repoRecords.filter(r => r.isExcluded).length
  };
}

/**
 * 8. Toggle / Exclude or Include a GitHub repo from resume
 */
async function toggleRepoExclusion(userId, repoName, exclude = true, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const profile = await getResumeProfile(userId, profileId);
  let excluded = new Set(profile.excludedRepos || []);

  if (exclude) {
    excluded.add(repoName);
  } else {
    excluded.delete(repoName);
  }

  const updatedExcluded = Array.from(excluded);
  const updatedProjects = (profile.githubProjects || []).map(r => ({
    ...r,
    isExcluded: excluded.has(r.name)
  }));

  await getProfileDocRef(userId, profileId).update({
    excludedRepos: updatedExcluded,
    githubProjects: updatedProjects,
    updatedAt: Date.now()
  });

  return {
    repoName,
    isExcluded: exclude,
    excludedRepos: updatedExcluded,
    githubProjects: updatedProjects
  };
}

/**
 * 9. Reset all repo exclusions
 */
async function resetRepoExclusions(userId, profileId = DEFAULT_PROFILE_ID) {
  if (!userId) throw new Error('User ID required');
  const profile = await getResumeProfile(userId, profileId);
  const updatedProjects = (profile.githubProjects || []).map(r => ({
    ...r,
    isExcluded: false
  }));

  await getProfileDocRef(userId, profileId).update({
    excludedRepos: [],
    githubProjects: updatedProjects,
    updatedAt: Date.now()
  });

  return { success: true, githubProjects: updatedProjects };
}

/**
 * Helper to auto-label links
 */
function autolabelLink(url) {
  const lower = (url || '').toLowerCase();
  if (lower.includes('leetcode.com')) return 'LeetCode';
  if (lower.includes('codechef.com')) return 'CodeChef';
  if (lower.includes('codeforces.com')) return 'Codeforces';
  if (lower.includes('hackerrank.com')) return 'HackerRank';
  if (lower.includes('github.com')) return 'GitHub';
  if (lower.includes('linkedin.com')) return 'LinkedIn';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.split('.')[0];
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Portfolio';
  } catch {
    return 'Portfolio';
  }
}

module.exports = {
  getResumeProfile,
  saveResumeProfile,
  addDocument,
  removeDocument,
  saveSmartLinks,
  removeSmartLink,
  syncGitHubRepos,
  toggleRepoExclusion,
  resetRepoExclusions,
  autolabelLink
};
