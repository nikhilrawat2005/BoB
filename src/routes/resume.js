const express = require('express');
const multer = require('multer');
const resumeAuditEngine = require('../services/resumeAuditEngine');
const resumeMemoryService = require('../services/resumeMemoryService');
const resumeBuilderService = require('../services/resumeBuilderService');
const resumeStoreService = require('../services/resumeStoreService');
const { requireAuth } = require('../middleware/auth');
const { auth } = require('../config/firebase');

const router = express.Router();

// Memory storage for immediate processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

/**
 * Optional Auth helper: Extracts userId if Bearer token present
 */
async function getUserIdFromRequest(req) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ') && auth) {
      const token = authHeader.split('Bearer ')[1].trim();
      if (token) {
        const decoded = await auth.verifyIdToken(token);
        const sharedId = process.env.SHARED_ADMIN_ID || 'nikhil_master_workspace';
        return sharedId || decoded.uid;
      }
    }
  } catch (err) {
    // Non-blocking if token missing or invalid
  }
  return process.env.SHARED_ADMIN_ID || 'nikhil_master_workspace';
}

/**
 * ─────────────────────────────────────────────────────────────
 * 1. PERSISTENT PROFILE & STORE ENDPOINTS (Firestore Backed)
 * ─────────────────────────────────────────────────────────────
 */

/**
 * GET /api/resume/profile
 * Returns saved candidate profile, smartLinks, documents, and githubProjects
 */
router.get('/profile', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';
    const profile = await resumeStoreService.getResumeProfile(userId, profileId);
    return res.json({ success: true, profile });
  } catch (error) {
    console.error('[ResumeRoute] Error getting profile:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resume/profile
 * Updates basic candidate profile fields
 */
router.post('/profile', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const updated = await resumeStoreService.saveResumeProfile(userId, req.body, profileId);
    return res.json({ success: true, profile: updated });
  } catch (error) {
    console.error('[ResumeRoute] Error updating profile:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resume/document/upload
 * Turn-by-turn document upload (1 or multiple files). Saves to Cloudinary & Firestore permanently.
 */
router.post('/document/upload', upload.array('files', 10), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';

    const uploaded = req.files || [];
    if (uploaded.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided for upload.' });
    }

    const addedDocs = [];
    for (const f of uploaded) {
      const resDoc = await resumeStoreService.addDocument(userId, {
        buffer: f.buffer,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      }, profileId);
      addedDocs.push(resDoc.addedDoc);
    }

    const currentProfile = await resumeStoreService.getResumeProfile(userId, profileId);
    return res.json({
      success: true,
      added: addedDocs,
      documents: currentProfile.documents
    });
  } catch (error) {
    console.error('[ResumeRoute] Error uploading document:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/resume/document/:docId
 * Remove an existing document from Firestore
 */
router.delete('/document/:docId', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';
    const { docId } = req.params;

    const result = await resumeStoreService.removeDocument(userId, docId, profileId);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[ResumeRoute] Error removing document:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resume/links
 * Update all or specific smart links (LeetCode, GitHub, Portfolio, etc.)
 */
router.post('/links', express.json(), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const { links } = req.body;

    const updatedLinks = await resumeStoreService.saveSmartLinks(userId, links, profileId);
    return res.json({ success: true, smartLinks: updatedLinks });
  } catch (error) {
    console.error('[ResumeRoute] Error saving links:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/resume/links
 * Remove a specific smart link by URL
 */
router.delete('/links', express.json(), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';
    const { url } = req.body;

    const updatedLinks = await resumeStoreService.removeSmartLink(userId, url, profileId);
    return res.json({ success: true, smartLinks: updatedLinks });
  } catch (error) {
    console.error('[ResumeRoute] Error removing link:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resume/github/sync
 * Sync repositories from GitHub for a user and store them in Firestore
 */
router.post('/github/sync', express.json(), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, error: 'GitHub username is required.' });
    }

    const result = await resumeStoreService.syncGitHubRepos(userId, username, profileId);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[ResumeRoute] Error syncing GitHub repos:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resume/github/repo-toggle
 * Toggle inclusion/exclusion of a repository from the resume
 */
router.post('/github/repo-toggle', express.json(), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const { repoName, exclude } = req.body;

    if (!repoName) {
      return res.status(400).json({ success: false, error: 'Repository name required.' });
    }

    const result = await resumeStoreService.toggleRepoExclusion(userId, repoName, Boolean(exclude), profileId);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[ResumeRoute] Error toggling repo exclusion:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/resume/github/reset
 * Reset all repository exclusions
 */
router.post('/github/reset', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';

    const result = await resumeStoreService.resetRepoExclusions(userId, profileId);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[ResumeRoute] Error resetting repo exclusions:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Compatibility alias for mobile app:
 * POST /api/resume/upload/documents
 */
router.post('/upload/documents', upload.array('files', 10), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';
    const uploaded = req.files || [];
    const addedDocs = [];
    for (const f of uploaded) {
      const resDoc = await resumeStoreService.addDocument(userId, {
        buffer: f.buffer,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      }, profileId);
      addedDocs.push(resDoc.addedDoc);
    }
    const profile = await resumeStoreService.getResumeProfile(userId, profileId);
    return res.json({ success: true, added: addedDocs, documents: profile.documents });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Compatibility alias for mobile app:
 * POST /api/resume/sync/github
 */
router.post('/sync/github', express.json(), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const { username } = req.body;
    const result = await resumeStoreService.syncGitHubRepos(userId, username, profileId);
    return res.json({ success: true, projects: result.repos, total: result.total });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Compatibility alias for mobile app:
 * DELETE /api/resume/project/:title
 */
router.delete('/project/:title', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';
    const { title } = req.params;
    const result = await resumeStoreService.toggleRepoExclusion(userId, title, true, profileId);
    return res.json({ success: true, removed: title, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Compatibility alias for mobile app:
 * POST /api/resume/repos/reset
 */
router.post('/repos/reset', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || 'master';
    const result = await resumeStoreService.resetRepoExclusions(userId, profileId);
    return res.json({ success: true, projects: result.githubProjects });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});


/**
 * ─────────────────────────────────────────────────────────────
 * 2. AUDIT & AUTONOMOUS BUILDER EXECUTION
 * ─────────────────────────────────────────────────────────────
 */

/**
 * POST /api/resume/audit
 * Upload a PDF or DOCX file to receive a full institutional & ATS audit report,
 * and automatically persist the score history to user memory.
 */
router.post('/audit', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'No resume file uploaded. Please upload a PDF or DOCX file with key "resume".'
      });
    }

    const filename = req.file.originalname || 'resume.pdf';
    const auditReport = await resumeAuditEngine.auditResume(req.file.buffer, filename);

    // Save to user audit memory history
    const userId = await getUserIdFromRequest(req);
    let historyMeta = null;
    let pastAudits = [];

    if (userId) {
      const savedDoc = await resumeMemoryService.saveAuditRecord(userId, auditReport);
      pastAudits = await resumeMemoryService.getAuditHistory(userId, 5);
      if (savedDoc) {
        historyMeta = {
          scoreDelta: savedDoc.scoreDelta,
          previousScore: savedDoc.previousScore,
          previousDate: savedDoc.previousDate,
          savedAt: savedDoc.createdAt
        };
      }
    }

    return res.json({
      success: true,
      report: auditReport,
      historyMeta,
      history: pastAudits
    });
  } catch (error) {
    console.error('[ResumeAuditRoute] Error processing audit:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze resume'
    });
  }
});

/**
 * POST /api/resume/build
 * Autonomous Evidence-Based ATS Resume Builder Engine:
 * Reads stored Firestore evidence (saved docs, links, selected repos) + any new overrides.
 */
router.post('/build', upload.array('documents', 10), async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const profileId = req.query.profileId || req.body.profileId || 'master';

    // Fetch existing stored evidence from Firestore
    let storedProfile = null;
    if (userId) {
      storedProfile = await resumeStoreService.getResumeProfile(userId, profileId);
    }

    const {
      name = (storedProfile?.candidateName || 'Nikhil Rawat'),
      email = (storedProfile?.email || 'nikhil2005114@gmail.com'),
      phone = (storedProfile?.phone || '+91-8700113731'),
      location = (storedProfile?.location || 'Ghaziabad, India'),
      githubUsername = (storedProfile?.githubUsername || 'nikhilrawat2005')
    } = req.body;

    let parsedUrls = [];
    if (req.body.urls) {
      try {
        parsedUrls = typeof req.body.urls === 'string' ? JSON.parse(req.body.urls) : req.body.urls;
      } catch (e) {
        parsedUrls = String(req.body.urls).split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
      }
    } else if (storedProfile?.smartLinks?.length) {
      parsedUrls = storedProfile.smartLinks.map(l => l.url);
    }

    const uploadedFiles = (req.files || []).map(f => ({
      buffer: f.buffer,
      filename: f.originalname
    }));

    // If new files were uploaded during build, also persist them turn-by-turn to Firestore
    if (userId && uploadedFiles.length > 0) {
      for (const uf of (req.files || [])) {
        try {
          await resumeStoreService.addDocument(userId, {
            buffer: uf.buffer,
            originalname: uf.originalname,
            mimetype: uf.mimetype,
            size: uf.size
          }, profileId);
        } catch (e) {
          console.warn('[ResumeRoute] Background doc store warning:', e.message);
        }
      }
      storedProfile = await resumeStoreService.getResumeProfile(userId, profileId);
    }

    const buildResult = await resumeBuilderService.buildAutonomousResume({
      name,
      email,
      phone,
      location,
      githubUsername,
      uploadedFiles,
      storedDocuments: storedProfile?.documents || [],
      excludedRepos: storedProfile?.excludedRepos || [],
      urls: parsedUrls
    });

    // Save to user audit memory if authenticated
    let historyMeta = null;
    let pastAudits = [];
    if (userId) {
      const savedDoc = await resumeMemoryService.saveAuditRecord(userId, buildResult.auditReport);
      pastAudits = await resumeMemoryService.getAuditHistory(userId, 5);
      if (savedDoc) {
        historyMeta = {
          scoreDelta: savedDoc.scoreDelta,
          previousScore: savedDoc.previousScore,
          previousDate: savedDoc.previousDate,
          savedAt: savedDoc.createdAt
        };
      }
    }

    // Convert PDF buffer to Base64 so frontend can download directly or preview in iframe
    const pdfBase64 = buildResult.pdfBuffer.toString('base64');

    return res.json({
      success: true,
      filename: buildResult.filename,
      pdfBase64,
      downloadUrl: `/api/resume/download-generated?fn=${encodeURIComponent(buildResult.filename)}`,
      report: buildResult.auditReport,
      resumeSpec: buildResult.resumeSpec,
      historyMeta,
      history: pastAudits
    });
  } catch (error) {
    console.error('[ResumeRoute] Error in autonomous resume build:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to autonomously build ATS resume'
    });
  }
});

/**
 * POST /api/resume/download-pdf-direct
 * Directly stream a compiled PDF from a Base64 string or JSON spec
 */
router.post('/download-pdf-direct', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const { pdfBase64, filename = 'resume.pdf' } = req.body;
    if (!pdfBase64) return res.status(400).send('No PDF data provided');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return res.status(500).send('Failed to generate PDF download');
  }
});

/**
 * GET /api/resume/history
 * Fetch past audit attempts and score progress for authenticated user
 */
router.get('/history', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return res.json({ success: true, history: [] });
    }

    const history = await resumeMemoryService.getAuditHistory(userId, 10);
    return res.json({
      success: true,
      history
    });
  } catch (err) {
    console.error('[ResumeAuditRoute] Error fetching history:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/resume/audit-text
 * Audit raw extracted resume text directly
 */
router.post('/audit-text', async (req, res) => {
  try {
    const { text, filename = 'resume.txt', pageCount = 1 } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Text payload is empty.'
      });
    }

    const deterministic = resumeAuditEngine.analyzeDeterministicRules(text, { pageCount });
    return res.json({
      success: true,
      deterministicScore: deterministic.rawScore,
      deterministicIssues: deterministic.issues,
      positivePoints: deterministic.positivePoints
    });
  } catch (error) {
    console.error('[ResumeAuditRoute] Error analyzing text:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
