const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const resumeProfile = require('../services/resumeProfileService');
const latexService = require('../services/latexResumeService');
const directPdfService = require('../services/directPdfResumeService');
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
    
    // Save to master profile, preserving excluded repos
    const profile = await resumeProfile.getMasterProfile(req.userId);
    const excluded = new Set(profile.excludedRepos || []);
    profile.githubUsername = username;
    profile.githubProjects = projects.filter(p => !excluded.has(p.title));
    await resumeProfile.saveMasterProfile(req.userId, profile);

    res.json({ success: true, projects: profile.githubProjects, total: profile.githubProjects.length });
  } catch (err) {
    console.error('[ResumeAPI] Sync GitHub Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3b. DELETE /api/resume/project/:title — Exclude/remove a project from resume profile
 */
router.delete('/project/:title', requireAuth, async (req, res) => {
  try {
    const { title } = req.params;
    const profile = await resumeProfile.getMasterProfile(req.userId);
    const existing = profile.githubProjects || [];
    profile.githubProjects = existing.filter(p => p.title.toLowerCase() !== title.toLowerCase());
    
    // Remember in excludedRepos list so re-scraping does not re-add it
    const excluded = profile.excludedRepos || [];
    if (!excluded.includes(title)) {
      excluded.push(title);
    }
    profile.excludedRepos = excluded;

    await resumeProfile.saveMasterProfile(req.userId, profile);
    res.json({ success: true, removed: title, remaining: profile.githubProjects.length });
  } catch (err) {
    console.error('[ResumeAPI] Delete Project Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. POST /api/resume/sync/coding — Sync LeetCode, Codeforces, HackerRank stats
 */
router.post('/sync/coding', requireAuth, async (req, res) => {
  try {
    const { handles } = req.body; // { leetcode, codechef, codeforces, hackerrank }
    const stats = await resumeProfile.syncDeveloperProfiles(handles || {});
    
    // Save handles & stats permanently to master profile
    const profile = await resumeProfile.getMasterProfile(req.userId);
    profile.developerPlatforms = {
      ...(profile.developerPlatforms || {}),
      ...stats
    };
    profile.savedHandles = {
      ...(profile.savedHandles || {}),
      ...(handles || {})
    };
    await resumeProfile.saveMasterProfile(req.userId, profile);

    res.json({ success: true, stats, savedHandles: profile.savedHandles });
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
    const { jobDescription, customPrompt, templateName, targetJobDescription } = req.body;
    const finalJD = jobDescription || targetJobDescription || '';

    // Fetch user's full context
    let profile = await resumeProfile.getMasterProfile(req.userId);

    // Auto-re-scrape fresh projects from GitHub if username is saved
    if (profile.githubUsername) {
      try {
        const freshProjects = await resumeProfile.syncGitHubProjects(profile.githubUsername);
        if (freshProjects && freshProjects.length > 0) {
          const excluded = new Set(profile.excludedRepos || []);
          profile.githubProjects = freshProjects.filter(p => !excluded.has(p.title));
        }
      } catch (ghErr) {
        console.warn('[ResumeAPI] Auto re-scrape GitHub skip:', ghErr.message);
      }
    }

    // Auto-re-scrape coding stats if handles are saved
    if (profile.savedHandles && Object.keys(profile.savedHandles).length > 0) {
      try {
        const freshStats = await resumeProfile.syncDeveloperProfiles(profile.savedHandles);
        if (freshStats && Object.keys(freshStats).length > 0) {
          profile.developerPlatforms = {
            ...(profile.developerPlatforms || {}),
            ...freshStats
          };
        }
      } catch (codeErr) {
        console.warn('[ResumeAPI] Auto re-scrape Coding skip:', codeErr.message);
      }
    }

    // Save updated fresh state back to profile
    await resumeProfile.saveMasterProfile(req.userId, profile);

    // 1. Generate Structured Resume Data via LLM
    const structuredResult = await directPdfService.generateStructuredResumeData({
      profile,
      jobDescription: finalJD
    });

    // Save latest resume JSON to profile
    profile.latestResumeData = structuredResult.data;
    await resumeProfile.saveMasterProfile(req.userId, profile);

    res.json({
      success: true,
      resumeData: structuredResult.data,
      isTargeted: structuredResult.isTargeted,
      message: 'ATS Resume successfully generated.'
    });
  } catch (err) {
    console.error('[ResumeAPI] Generate Resume Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 8. POST /api/resume/download-direct-pdf — Generate and stream PDF binary directly
 */
router.post('/download-direct-pdf', requireAuth, async (req, res) => {
  try {
    const { resumeData, filename } = req.body;
    let data = resumeData;

    if (!data) {
      const profile = await resumeProfile.getMasterProfile(req.userId);
      data = profile.latestResumeData;
    }

    if (!data) {
      return res.status(400).json({ error: 'No resume data found. Please generate resume first.' });
    }

    const pdfBuffer = await directPdfService.buildDirectPdfBuffer(data);
    const downloadName = filename || `${(data.basics?.name || 'Resume').replace(/\s+/g, '_')}_Resume.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error('[ResumeAPI] Direct PDF Download Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
