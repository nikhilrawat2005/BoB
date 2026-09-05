// ---------------------------------------------------------------------------
// Bob Resume Intelligence — Elite ATS Resume Analyzer Service
// Audits resumes across 6 key ATS pillars (Score, Strengths, Red Flags, STAR Bullets, Keywords, Action Plan)
// ---------------------------------------------------------------------------
const { callLLM } = require('./llmService');
const documentReader = require('./documentReaderService');

const PDFDocument = require('pdfkit');

/**
 * Deep audit of resume text against industry ATS benchmarks (Hiration / Google standard)
 */
async function auditResume({ resumeText, targetJobDescription = '' }) {
  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error('Resume content is too short or empty to analyze.');
  }

  const prompt = `You are a Principal Tech Recruiter and Merciless Fortune 500 ATS Auditor (following strict Hiration & Google XYZ standards).
Perform a deep, strict, zero-leniency review. Do NOT give generous scores. If bullets lack numbers, if certifications are passive without context, or if there are periods or vague verbs, score ruthlessly like Hiration.

RESUME CONTENT:
"""
${resumeText.slice(0, 25000)}
"""

${targetJobDescription && targetJobDescription.trim() ? `TARGET JOB VACANCY / DESCRIPTION:
"""
${targetJobDescription.slice(0, 10000)}
"""
Compare keywords and requirements directly against this job vacancy.` : 'No specific JD provided: evaluate against elite General Software Engineering / ATS benchmarks (Hiration/Google standard).'}

HIRATION AUDITING BENCHMARKS:
1. ATS Compliance (100% standard): Single column, no tables, standard headers.
2. Bullet-Level Cause-Effect: Action Verb + Core Task + Measurable Metric (%, latency, users, scale). If a bullet has no numbers, deduct points!
3. Period Checking: Resume bullets must NOT end in a period '.' (subtract points if trailing periods exist).
4. Certifications: Active accolades with context, not just passive document titles.
5. Overall ATS Score: 70-75% is standard for unquantified bullets; 80-88% for solid metrics; 90%+ ONLY if nearly every bullet has quantified XYZ outcomes.

RETURN ONLY A VALID JSON OBJECT (no markdown around it, no backticks, no comments, raw JSON only) matching this exact schema:
{
  "atsScore": 72,
  "verdict": "Tier-1 Ready | Strong Contender | Needs Polish | High Risk",
  "breakdown": {
    "impactAndMetrics": 65,
    "skillsRelevance": 88,
    "actionVerbs": 78,
    "formattingAndClarity": 95,
    "experienceDepth": 75
  },
  "executiveSummary": "2-3 sentences summarizing overall impression and competitiveness for top tech roles.",
  "strengths": [
    "Identified strength 1 (e.g. Published patent or competitive programming highlights)",
    "Identified strength 2"
  ],
  "criticalNegatives": [
    "Identified weakness or red flag 1 (e.g. Missing quantifiable metrics in project bullets)",
    "Identified weakness or red flag 2"
  ],
  "atsKeywordsFound": [
    "React", "Node.js", "Firebase", "Python"
  ],
  "missingRecommendedKeywords": [
    "Docker", "CI/CD", "Unit Testing", "System Architecture"
  ],
  "bulletImprovements": [
    {
      "original": "Worked on backend of the application and made APIs.",
      "improved": "Architected RESTful microservices in Node.js, reducing API response latency by 35% across 10k daily requests"
    }
  ],
  "actionPlan": [
    "Step 1: Quantify the outcomes in your secondary project...",
    "Step 2: Add specific unit testing / CI-CD keywords in the skills section..."
  ]
}`;

  const response = await callLLM({
    messages: [
      { role: 'system', content: 'You are an expert ATS resume evaluator who returns strict valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  });

  const rawText = (response && response.text) ? response.text : String(response);
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse ATS analysis from AI');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Audit an uploaded resume file Buffer (PDF/DOCX/TXT)
 */
async function auditResumeBuffer(fileBuffer, originalName, targetJobDescription = '') {
  const extraction = await documentReader.extractText(fileBuffer, originalName);
  if (!extraction || !extraction.text || extraction.text.trim().length < 50) {
    throw new Error(extraction?.error || 'Could not extract readable text from this file. Ensure it is a valid text-based PDF or DOCX.');
  }

  const analysis = await auditResume({
    resumeText: extraction.text,
    targetJobDescription
  });

  return {
    analysis,
    fileName: originalName,
    charCount: extraction.text.length,
    pageCount: extraction.pageCount || 1
  };
}

/**
 * Generate a PDF Audit Report for the candidate to download
 */
function buildAuditReportPdfBuffer(audit, resumeFileName = 'Resume') {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 45, right: 45 },
        bufferPages: true
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const primaryColor = '#0f172a';
      const secondaryColor = '#334155';
      const scoreColor = (audit.atsScore >= 85) ? '#10b981' : (audit.atsScore >= 70 ? '#f59e0b' : '#ef4444');

      // Title & Header
      doc.font('Helvetica-Bold').fontSize(18).fillColor(primaryColor).text('BoB ATS Resume Audit & Score Report', { align: 'center' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#64748b').text(`Audited Document: ${resumeFileName}  |  Generated on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, { align: 'center' });
      doc.moveDown(0.8);

      // Score Banner Box
      const bannerY = doc.y;
      doc.rect(doc.page.margins.left, bannerY, pageWidth, 55)
         .fillAndStroke('#f8fafc', '#cbd5e1');

      doc.font('Helvetica-Bold').fontSize(26).fillColor(scoreColor)
         .text(`${Math.round(audit.atsScore || 70)}%`, doc.page.margins.left + 20, bannerY + 14);

      doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor)
         .text(`ATS VERDICT: ${audit.verdict || 'Needs Optimization'}`, doc.page.margins.left + 95, bannerY + 12);

      doc.font('Helvetica').fontSize(8.5).fillColor(secondaryColor)
         .text('Screened against Fortune 500 & Hiration 50+ ATS parameters (Cause-Effect, Metrics, Keywords)', doc.page.margins.left + 95, bannerY + 28);

      doc.y = bannerY + 70;

      // Section Helper
      function addSection(title, icon = '') {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor).text(`${icon} ${title}`.trim());
        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(doc.page.margins.left, doc.y + 2).lineTo(doc.page.margins.left + pageWidth, doc.y + 2).stroke();
        doc.y += 6;
      }

      // Executive Summary
      addSection('Executive Auditor Verdict', '📋');
      doc.font('Helvetica').fontSize(9).fillColor(secondaryColor).text(audit.executiveSummary || 'Resume evaluated against modern tech recruiter standards.', { lineGap: 1.5 });

      // Breakdown Metrics
      if (audit.breakdown) {
        addSection('Scoring Dimensions Breakdown', '📊');
        const dimLabels = {
          impactAndMetrics: 'Impact & Quantified Metrics',
          skillsRelevance: 'Skills & Tech Relevance',
          actionVerbs: 'Action Verbs & Power Words',
          formattingAndClarity: 'ATS Formatting & Clarity',
          experienceDepth: 'Project & Experience Depth'
        };
        for (const [k, v] of Object.entries(audit.breakdown)) {
          const label = dimLabels[k] || k;
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(primaryColor).text(`${label}: `, { continued: true });
          doc.font('Helvetica').fillColor(secondaryColor).text(`${v}%`);
        }
      }

      // Strengths & Red Flags
      addSection('Key Strengths & Identified Positives', '✅');
      (audit.strengths || []).forEach(s => {
        doc.font('Helvetica').fontSize(8.5).fillColor('#059669').text(`•  ${s}`, { indent: 8, lineGap: 1.2 });
      });

      addSection('Critical Red Flags & Missing Elements', '⚠️');
      (audit.criticalNegatives || []).forEach(n => {
        doc.font('Helvetica').fontSize(8.5).fillColor('#dc2626').text(`•  ${n}`, { indent: 8, lineGap: 1.2 });
      });

      // Keywords
      addSection('ATS Keyword Analysis', '🏷️');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(primaryColor).text('Matched Keywords: ', { continued: true });
      doc.font('Helvetica').fillColor('#059669').text((audit.atsKeywordsFound || []).join(', ') || 'None detected');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(primaryColor).text('Recommended Missing Keywords: ', { continued: true });
      doc.font('Helvetica').fillColor('#d97706').text((audit.missingRecommendedKeywords || []).join(', ') || 'All major keywords covered');

      // Bullet Point Rewrites (Before vs After)
      if (audit.bulletImprovements && audit.bulletImprovements.length > 0) {
        addSection('Bullet Points Level-Up (Google XYZ / Hiration Formula)', '✍️');
        audit.bulletImprovements.slice(0, 3).forEach(b => {
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#dc2626').text('Original: ', { continued: true });
          doc.font('Helvetica').fillColor(secondaryColor).text(b.original);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#059669').text('ATS Upgrade: ', { continued: true });
          doc.font('Helvetica').fillColor(primaryColor).text(b.improved);
          doc.moveDown(0.25);
        });
      }

      // Action Plan
      if (audit.actionPlan && audit.actionPlan.length > 0) {
        addSection('Priority Action Plan to reach 98%+', '🎯');
        audit.actionPlan.forEach((step, idx) => {
          doc.font('Helvetica').fontSize(8.5).fillColor(secondaryColor).text(`${idx + 1}.  ${step}`, { indent: 8, lineGap: 1.2 });
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  auditResume,
  auditResumeBuffer,
  buildAuditReportPdfBuffer
};
