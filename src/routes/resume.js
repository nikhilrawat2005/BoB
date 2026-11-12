const express = require('express');
const multer = require('multer');
const resumeAuditEngine = require('../services/resumeAuditEngine');
const resumeMemoryService = require('../services/resumeMemoryService');
const resumeBuilderService = require('../services/resumeBuilderService');
const { auth } = require('../config/firebase');

const router = express.Router();

// Memory storage for immediate processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
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
        return decoded.uid;
      }
    }
  } catch (err) {
    // Non-blocking if token missing or invalid
  }
  return null;
}

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
 * Ingests:
 *  - githubUsername (query GitHub REST API & un-truncated READMEs)
 *  - documents (multi-file uploads: marksheets & certificates)
 *  - urls (LeetCode, Codeforces, Portfolio, deployed apps)
 * Compiles a guaranteed 1-page ATS PDF with clickable links, audits it until score >= 90,
 * and returns the verified PDF binary + audit report.
 */
router.post('/build', upload.array('documents', 10), async (req, res) => {
  try {
    const {
      name = 'Nikhil Rawat',
      email = 'nikhil2005114@gmail.com',
      phone = '+91-8700113731',
      location = 'Ghaziabad, India',
      githubUsername = 'nikhilrawat2005'
    } = req.body;

    let parsedUrls = [];
    if (req.body.urls) {
      try {
        parsedUrls = typeof req.body.urls === 'string' ? JSON.parse(req.body.urls) : req.body.urls;
      } catch (e) {
        parsedUrls = String(req.body.urls).split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
      }
    }

    const uploadedFiles = (req.files || []).map(f => ({
      buffer: f.buffer,
      filename: f.originalname
    }));

    const buildResult = await resumeBuilderService.buildAutonomousResume({
      name,
      email,
      phone,
      location,
      githubUsername,
      uploadedFiles,
      urls: parsedUrls
    });

    // Save to user audit memory if authenticated
    const userId = await getUserIdFromRequest(req);
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
