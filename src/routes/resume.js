const express = require('express');
const multer = require('multer');
const resumeAuditEngine = require('../services/resumeAuditEngine');
const resumeMemoryService = require('../services/resumeMemoryService');
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
