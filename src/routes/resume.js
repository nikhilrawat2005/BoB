const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const resumeProfile = require('../services/resumeProfileService');
const latexService = require('../services/latexResumeService');
const fileService = require('../services/fileService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

/**
 * 1. GET /api/resume/profile — Fetch Master Career Profile
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const profile = await resumeProfile.getMasterProfile(req.userId);
    res.json({ success: true, profile });
  } catch (err) {
    console.error('[ResumeAPI] Get Profile Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 2. POST /api/resume/profile — Update Master Career Profile
 */
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const updated = await resumeProfile.saveMasterProfile(req.userId, req.body);
    res.json({ success: true, profile: updated });
  } catch (err) {
    console.error('[ResumeAPI] Save Profile Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. POST /api/resume/sync/github — Crawl GitHub repos & project READMEs
 */
router.post('/sync/github', requireAuth, async (req, res) => {
  try {
    let { username } = req.body || {};
    if (username) {
      username = username.trim()
        .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
        .split('/')[0]
        .replace(/\/+$/, '');
    }
    if (!username) return res.status(400).json({ error: 'GitHub username is required' });

    const projects = await resumeProfile.syncGitHubProjects(username);
    res.json({ success: true, projects });
  } catch (err) {
    console.error('[ResumeAPI] Sync GitHub Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. POST /api/resume/sync/coding — Sync LeetCode, Codeforces, HackerRank stats
 */
router.post('/sync/coding', requireAuth, async (req, res) => {
  try {
    const { handles } = req.body; // { leetcode, codeforces, hackerrank }
    const stats = await resumeProfile.syncDeveloperProfiles(handles || {});
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[ResumeAPI] Sync Coding Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 5. POST /api/resume/upload/base — Upload & Parse Previous Resume (PDF)
 */
router.post('/upload/base', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    // 1. Upload to Cloudinary via fileService
    const storedFile = await fileService.uploadFile(req.userId, req.file);

    // 2. Parse text
    const parsed = await resumeProfile.parseResumePdf(req.file.buffer);

    // 3. Update master profile with baseResume reference
    const currentProfile = await resumeProfile.getMasterProfile(req.userId);
    currentProfile.baseResume = {
      fileId: storedFile.id,
      url: storedFile.url,
      originalName: req.file.originalname,
      uploadedAt: Date.now(),
      rawText: parsed.rawText
    };
    await resumeProfile.saveMasterProfile(req.userId, currentProfile);

    res.json({
      success: true,
      baseResume: currentProfile.baseResume,
      message: 'Base resume uploaded and stored in Cloudinary successfully'
    });
  } catch (err) {
    console.error('[ResumeAPI] Upload Base Resume Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 6. POST /api/resume/upload/certificate & /upload/documents
 * Supports uploading multiple certificates, 10th/12th marksheets, degrees, etc. in one go.
 */
router.post(['/upload/certificate', '/upload/documents'], requireAuth, upload.array('files', 15), async (req, res) => {
  try {
    const uploadedFiles = req.files || (req.file ? [req.file] : []);
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No documents/certificates uploaded' });
    }

    const profile = await resumeProfile.getMasterProfile(req.userId);
    const existingCerts = profile.certifications || [];
    const addedRecords = [];

    for (const file of uploadedFiles) {
      // 1. Upload to Cloudinary with SHA-256 deduplication
      const storedFile = await fileService.uploadFile(req.userId, file);

      // 2. Identify category based on filename (Marksheet, Degree, Certificate)
      const cleanTitle = file.originalname.replace(/\.[^/.]+$/, '').trim();
      let category = 'Certificate';
      if (/10th|12th|marksheet|grade|transcript|report|cbse|icse/i.test(cleanTitle)) {
        category = 'Marksheet / Academic Record';
      } else if (/degree|diploma|btech|b\.tech|bca|mca|bsc/i.test(cleanTitle)) {
        category = 'Degree / Diploma';
      }

      const docRecord = {
        id: storedFile.id,
        title: cleanTitle,
        category,
        issuer: req.body.issuer || 'Verified Academic/Cert Authority',
        url: storedFile.url,
        createdAt: Date.now()
      };

      // Check if already in profile list
      const exists = existingCerts.some(c => c.id === storedFile.id || (c.title === cleanTitle && c.url === storedFile.url));
      if (!exists) {
        existingCerts.push(docRecord);
      }
      addedRecords.push(docRecord);
    }

    profile.certifications = existingCerts;
    await resumeProfile.saveMasterProfile(req.userId, profile);

    res.json({
      success: true,
      added: addedRecords,
      totalCount: existingCerts.length,
      certifications: existingCerts
    });
  } catch (err) {
    console.error('[ResumeAPI] Upload Documents/Certificates Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 7. POST /api/resume/generate — Generate Tailored LaTeX Resume & Compile to PDF
 */
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { jobDescription, customPrompt, templateName } = req.body;

    // Fetch user's full context
    const profile = await resumeProfile.getMasterProfile(req.userId);

    // Generate tailored LaTeX code
    const genResult = await latexService.generateLatexResume({
      profile,
      jobDescription,
      templateName: templateName || 'jake'
    });

    // Try PDF compilation & Cloudinary persistence
    const pdfResult = await latexService.buildAndStoreResumePdf(
      req.userId,
      genResult.latexCode,
      jobDescription ? 'tailored_resume' : 'master_resume'
    );

    res.json({
      success: true,
      latexCode: genResult.latexCode,
      pdfUrl: pdfResult.pdfUrl,
      isTargeted: genResult.isTargeted,
      message: pdfResult.pdfUrl ? 'PDF compiled successfully' : 'LaTeX code generated. (PDF compile fallback available)'
    });
  } catch (err) {
    console.error('[ResumeAPI] Generate Resume Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
