const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const resumeProfile = require('../services/resumeProfileService');
const latexService = require('../services/latexResumeService');
const directPdfService = require('../services/directPdfResumeService');
const resumeAnalyzer = require('../services/resumeAnalyzerService');
const fileService = require('../services/fileService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

/**
 * 0. GET /api/resume/profiles — List all candidate profiles
 */
router.get('/profiles', requireAuth, async (req, res) => {
  try {
    const profiles = await resumeProfile.listCandidateProfiles(req.userId);
    res.json({ success: true, profiles });
  } catch (err) {
    console.error('[ResumeAPI] List Profiles Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 0b. DELETE /api/resume/profile/:profileId — Delete a friend / candidate profile
 */
router.delete('/profile/:profileId', requireAuth, async (req, res) => {
  try {
    const { profileId } = req.params;
    const result = await resumeProfile.deleteCandidateProfile(req.userId, profileId);
    res.json(result);
  } catch (err) {
    console.error('[ResumeAPI] Delete Profile Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 1. GET /api/resume/profile — Fetch Master or Specific Candidate Career Profile
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const profileId = req.query.profileId || 'master';
    const profile = await resumeProfile.getMasterProfile(req.userId, profileId);
    res.json({ success: true, profile });
  } catch (err) {
    console.error('[ResumeAPI] Get Profile Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 2. POST /api/resume/profile — Update Master or Specific Candidate Career Profile
 */
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const updated = await resumeProfile.saveMasterProfile(req.userId, req.body, profileId);
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
    const profileId = req.query.profileId || req.body.profileId || 'master';
    let { username } = req.body || {};
    if (username) {
      username = username.trim()
        .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
        .split('/')[0]
        .replace(/\/+$/, '');
    }
    if (!username) return res.status(400).json({ error: 'GitHub username is required' });

    const projects = await resumeProfile.syncGitHubProjects(username);
    
    // Save to target candidate profile, preserving excluded repos
    const profile = await resumeProfile.getMasterProfile(req.userId, profileId);
    const excluded = new Set(profile.excludedRepos || []);
    profile.githubUsername = username;
    profile.githubProjects = projects.filter(p => !excluded.has(p.title));
    await resumeProfile.saveMasterProfile(req.userId, profile, profileId);

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
 * 4. POST /api/resume/sync/coding — Sync Smart Links (LeetCode, CodeChef, Portfolios, Dev blogs, etc.)
 */
router.post('/sync/coding', requireAuth, async (req, res) => {
  try {
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const { links, handles } = req.body;

    if (Array.isArray(links)) {
      // Smart Links Flow
      const result = await resumeProfile.syncSmartLinks(req.userId, links, profileId);
      return res.json({
        success: true,
        smartLinks: result.smartLinks,
        items: result.smartLinksResult,
        stats: result.developerPlatforms
      });
    }

    // Legacy handles flow fallback
    const stats = await resumeProfile.syncDeveloperProfiles(handles || {});
    const profile = await resumeProfile.getMasterProfile(req.userId, profileId);
    profile.developerPlatforms = {
      ...(profile.developerPlatforms || {}),
      ...stats
    };
    profile.savedHandles = {
      ...(profile.savedHandles || {}),
      ...(handles || {})
    };
    await resumeProfile.saveMasterProfile(req.userId, profile, profileId);

    res.json({ success: true, stats, savedHandles: profile.savedHandles });
  } catch (err) {
    console.error('[ResumeAPI] Sync Coding/Links Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4b. GET /api/resume/smart-links — Fetch saved smart links and sync history
 */
router.get('/smart-links', requireAuth, async (req, res) => {
  try {
    const profileId = req.query.profileId || 'master';
    const profile = await resumeProfile.getMasterProfile(req.userId, profileId);
    res.json({
      success: true,
      smartLinks: profile.smartLinks || [],
      items: profile.smartLinksResult || [],
      developerPlatforms: profile.developerPlatforms || {}
    });
  } catch (err) {
    console.error('[ResumeAPI] Get Smart Links Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 5. POST /api/resume/upload/base — Upload & Parse Previous Resume (PDF)
 */
router.post('/upload/base', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
    const profileId = req.query.profileId || req.body.profileId || 'master';

    // 1. Upload to Cloudinary via fileService
    const storedFile = await fileService.uploadFile(req.userId, req.file);

    // 2. Parse text
    const parsed = await resumeProfile.parseResumePdf(req.file.buffer);

    // 3. Update candidate profile with baseResume reference
    const currentProfile = await resumeProfile.getMasterProfile(req.userId, profileId);
    currentProfile.baseResume = {
      fileId: storedFile.id,
      url: storedFile.url,
      originalName: req.file.originalname,
      uploadedAt: Date.now(),
      rawText: parsed.rawText
    };
    await resumeProfile.saveMasterProfile(req.userId, currentProfile, profileId);

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
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const uploadedFiles = req.files || (req.file ? [req.file] : []);
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No documents/certificates uploaded' });
    }

    const profile = await resumeProfile.getMasterProfile(req.userId, profileId);
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
    await resumeProfile.saveMasterProfile(req.userId, profile, profileId);

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
    const profileId = req.query.profileId || req.body.profileId || 'master';
    const { jobDescription, customPrompt, templateName, targetJobDescription } = req.body;
    const finalJD = jobDescription || targetJobDescription || '';

    // Fetch target candidate's full context
    let profile = await resumeProfile.getMasterProfile(req.userId, profileId);

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
    await resumeProfile.saveMasterProfile(req.userId, profile, profileId);

    // 1. Generate Structured Resume Data via LLM
    const structuredResult = await directPdfService.generateStructuredResumeData({
      profile,
      jobDescription: finalJD
    });

    // Save latest resume JSON to candidate profile
    profile.latestResumeData = structuredResult.data;
    await resumeProfile.saveMasterProfile(req.userId, profile, profileId);

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

/**
 * 9. POST /api/resume/analyze — Analyze any uploaded PDF / DOCX resume
 */
router.post('/analyze', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { targetJobDescription } = req.body || {};
    let fileBuffer = req.file ? req.file.buffer : null;
    let fileName = req.file ? req.file.originalname : 'resume.pdf';

    // If no file uploaded in this request, check if user provided raw text or has a stored baseResume
    if (!fileBuffer) {
      const { resumeText } = req.body || {};
      if (resumeText && resumeText.trim().length > 50) {
        const audit = await resumeAnalyzer.auditResume({
          resumeText,
          targetJobDescription
        });
        return res.json({ success: true, audit, fileName: 'Pasted Resume Text' });
      }

      const profile = await resumeProfile.getMasterProfile(req.userId);
      if (profile.baseResume?.rawText) {
        const audit = await resumeAnalyzer.auditResume({
          resumeText: profile.baseResume.rawText,
          targetJobDescription
        });
        return res.json({ success: true, audit, fileName: profile.baseResume.originalName || 'Base Resume' });
      }

      return res.status(400).json({ error: 'Please upload a PDF/DOCX resume or provide resume text to analyze.' });
    }

    const result = await resumeAnalyzer.auditResumeBuffer(fileBuffer, fileName, targetJobDescription);
    res.json({
      success: true,
      audit: result.analysis,
      fileName: result.fileName,
      charCount: result.charCount,
      pageCount: result.pageCount
    });
  } catch (err) {
    console.error('[ResumeAPI] Analyze Resume Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10. POST /api/resume/analyze-generated — Analyze currently generated resume data
 */
router.post('/analyze-generated', requireAuth, async (req, res) => {
  try {
    const { resumeData, targetJobDescription } = req.body || {};
    let data = resumeData;

    if (!data) {
      const profile = await resumeProfile.getMasterProfile(req.userId);
      data = profile.latestResumeData;
    }

    if (!data) {
      return res.status(400).json({ error: 'No generated resume data found to analyze. Please build one first.' });
    }

    // Convert structured JSON to readable text for deep evaluation
    const resumeText = JSON.stringify(data, null, 2);
    const audit = await resumeAnalyzer.auditResume({
      resumeText,
      targetJobDescription: targetJobDescription || ''
    });

    res.json({ success: true, audit, fileName: `${data.basics?.name || 'Candidate'}_Generated_Resume` });
  } catch (err) {
    console.error('[ResumeAPI] Analyze Generated Resume Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 11. POST /api/resume/download-audit-pdf — Download ATS Audit Report as PDF
 */
router.post('/download-audit-pdf', requireAuth, async (req, res) => {
  try {
    const { audit, fileName } = req.body || {};
    if (!audit) {
      return res.status(400).json({ error: 'Audit data is required to generate report PDF.' });
    }

    const reportBuffer = await resumeAnalyzer.buildAuditReportPdfBuffer(audit, fileName || 'Resume');
    const safeName = (fileName || 'Resume_Audit').replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_ATS_Report.pdf"`);
    res.setHeader('Content-Length', reportBuffer.length);
    res.end(reportBuffer);
  } catch (err) {
    console.error('[ResumeAPI] Download Audit PDF Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

