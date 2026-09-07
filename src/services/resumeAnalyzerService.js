// ---------------------------------------------------------------------------
// Bob Resume Intelligence — Elite ATS Resume Analyzer Service
// Audits resumes across 6 key ATS pillars (Score, Strengths, Red Flags, STAR Bullets, Keywords, Action Plan)
// ---------------------------------------------------------------------------
const { callLLM } = require('./llmService');
const documentReader = require('./documentReaderService');

const PDFDocument = require('pdfkit');

/**
 * Deep audit of resume text against industry ATS benchmarks (Hiration / Google standard)
 *
 * FIX HISTORY:
 * - Bug #1: Prompt schema had hardcoded literal numbers ("atsScore": 72, breakdown: 65/88/78/95/75).
 *   LLMs treat numbers in the "schema" as the desired output and copy them verbatim instead of
 *   computing real values. Fixed by using descriptive instruction strings as placeholder values.
 * - Bug #2: strengths/criticalNegatives had "(e.g. Published patent...)" text. LLMs sometimes
 *   echo these example strings back in the output. Fixed by using instruction-style placeholder text.
 * - Bug #3: max_tokens defaulted to 2000 which truncated the full JSON response mid-way through
 *   bulletImprovements/actionPlan causing parse failures. Fixed by passing max_tokens: 4000.
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

CRITICAL INSTRUCTION: Analyze the ACTUAL resume text above and compute REAL scores. Do NOT use example numbers. Every field must reflect your honest evaluation of THIS specific resume.

RETURN ONLY A VALID JSON OBJECT (no markdown, no backticks, no comments, raw JSON only). All numeric values must be computed from the actual resume content:
{
  "atsScore": <compute the real overall ATS score for THIS resume — integer 0-100>,
  "verdict": "<pick exactly one based on the actual score: Tier-1 Ready | Strong Contender | Needs Polish | High Risk>",
  "breakdown": {
    "impactAndMetrics": <integer 0-100: rate how well THIS resume quantifies achievements with numbers, percentages, scale>,
    "skillsRelevance": <integer 0-100: rate how relevant and comprehensive the tech stack is in THIS resume>,
    "actionVerbs": <integer 0-100: rate the strength of action verbs in THIS resume's bullet points>,
    "formattingAndClarity": <integer 0-100: rate the ATS-friendliness and clarity of THIS resume's format>,
    "experienceDepth": <integer 0-100: rate the complexity, leadership, and impact depth of THIS resume's projects>
  },
  "executiveSummary": "<2-3 sentences describing THIS specific candidate — mention their actual projects, stack, and competitive standing>",
  "strengths": [
    "<actual specific strength found in THIS resume — name the real project or skill>",
    "<another genuine strength from THIS resume>",
    "<third real strength if present>"
  ],
  "criticalNegatives": [
    "<actual specific weakness or red flag in THIS resume — name the real missing element or cite a problematic bullet>",
    "<another actual weakness from THIS resume>",
    "<third real weakness if present>"
  ],
  "atsKeywordsFound": [
    "<technology or keyword that literally appears in this resume>"
  ],
  "missingRecommendedKeywords": [
    "<important keyword NOT found in this resume but expected for the target role>"
  ],
  "bulletImprovements": [
    {
      "original": "<copy an actual bullet from this resume verbatim>",
      "improved": "<rewrite using Google XYZ formula: Accomplished [X] as measured by [Y] by doing [Z] — include real metrics>"
    },
    {
      "original": "<another actual bullet from this resume verbatim>",
      "improved": "<XYZ formula rewrite with specific quantified impact>"
    },
    {
      "original": "<third actual bullet from this resume verbatim>",
      "improved": "<XYZ formula rewrite with specific quantified impact>"
    }
  ],
  "actionPlan": [
    "<Step 1: specific actionable improvement tailored to THIS candidate's actual resume gaps>",
    "<Step 2: specific action based on THIS resume's actual weaknesses>",
    "<Step 3: specific action based on THIS resume's actual weaknesses>",
    "<Step 4: specific action based on THIS resume's actual weaknesses>"
  ]
}`;

  const response = await callLLM({
    messages: [
      { role: 'system', content: 'You are an expert ATS resume evaluator. Analyze the actual resume content provided and return a strict valid JSON object only. Compute all scores from the real resume — do not echo example numbers.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 4000
  });

  const rawText = (response && response.text) ? response.text : String(response);

  // Strip markdown code fences if the model wraps the JSON despite instructions
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
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
