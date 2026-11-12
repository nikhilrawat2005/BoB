const express = require('express');
const multer = require('multer');
const resumeAuditEngine = require('../services/resumeAuditEngine');

const router = express.Router();

// Memory storage for immediate processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

/**
 * POST /api/resume/audit
 * Upload a PDF or DOCX file to receive a full institutional & ATS audit report
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

    return res.json({
      success: true,
      report: auditReport
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
 * POST /api/resume/audit-text
 * Audit raw extracted resume text directly (useful for testing or direct text paste)
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
