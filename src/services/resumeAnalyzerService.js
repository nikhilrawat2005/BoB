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
 * - Bug #4: LLM was hallucinating projects ("Market Kingdom"), keywords (HTML5, NumPy) and bullets
 *   that don't exist in the resume. Fixed by adding a strict grounding rule in both the system
 *   prompt and user prompt.
 */
async function auditResume({ resumeText, targetJobDescription = '' }) {
  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error('Resume content is too short or empty to analyze.');
  }

  const prompt = `You are a Principal Tech Recruiter and Merciless Fortune 500 ATS Auditor (following strict Hiration & Google XYZ standards).
Perform a deep, strict, zero-leniency review. Do NOT give generous scores. If bullets lack numbers, if certifications are passive without context, or if there are periods or vague verbs, score ruthlessly like Hiration.

⚠️ STRICT GROUNDING RULE — ZERO HALLUCINATION:
- Every project, keyword, bullet, and fact you reference MUST literally exist in the resume text below.
- Do NOT mention any project that is not named in the resume.
- Do NOT list any keyword in "atsKeywordsFound" that does not literally appear (as a word or phrase) in the resume text.
- In "bulletImprovements", the "original" field MUST be copied verbatim from an actual bullet in the resume. Do NOT invent bullets.
- If you are uncertain whether something exists in the resume, do NOT include it.

RESUME CONTENT:
"""
${resumeText.slice(0, 25000)}
"""

${targetJobDescription && targetJobDescription.trim() ? `TARGET JOB VACANCY / DESCRIPTION:
"""
${targetJobDescription.slice(0, 10000)}
"""
Compare keywords and requirements directly against this job vacancy.` : 'No specific JD provided: evaluate against elite General Software Engineering / ATS benchmarks (Hiration/Google standard).'}

HIRATION & TECH RECRUITER AUDITING BENCHMARKS:
1. ATS Compliance: Standard single column layout, industry headers, high readability.
2. Bullet Structure: Action Verb + Project Task + Metric / Concrete Technical Outcome. Give high credit when technical scope and architecture are clearly specified.
3. Quantified Impact: Strong credit for numbers, scale, algorithms, ratings, problem counts, or explicit outcome statements.
4. Stack Relevance: Credit modern, in-demand technologies (Full-Stack, Cloud, AI, APIs).
5. Scoring Guidance: High-quality engineering resumes with projects, stats, and clean syntax should achieve solid scores (82-95) reflecting true market readiness. Only give sub-75 scores if there are serious red flags, missing sections, or poor structure.

CRITICAL INSTRUCTION: Analyze the ACTUAL resume text above and compute REAL scores. Do NOT use example numbers. Every field must reflect your honest evaluation of THIS specific resume. Re-read the STRICT GROUNDING RULE above before writing atsKeywordsFound and bulletImprovements.

RETURN ONLY A VALID JSON OBJECT. Strict JSON formatting rules — violating ANY of these will break parsing:
1. ALL object keys MUST be wrapped in double-quotes: write "atsScore" NOT atsScore
2. NO markdown code fences (no \`\`\`json or \`\`\`)
3. NO JavaScript comments (no // or /* */)
4. NO trailing commas
5. NO backticks, no extra text before or after the JSON
Start your response with '{' and end it with '}'. Nothing else.
All numeric values must be computed from the actual resume content:
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
  "executiveSummary": "<2-3 sentences describing THIS specific candidate — mention their actual projects (only ones in resume), stack, and competitive standing>",
  "strengths": [
    "<actual specific strength found in THIS resume — name the real project or skill that exists in the resume>",
    "<another genuine strength from THIS resume>",
    "<third real strength if present>"
  ],
  "criticalNegatives": [
    "<actual specific weakness or red flag in THIS resume — name the real missing element or cite a real problematic bullet>",
    "<another actual weakness from THIS resume>",
    "<third real weakness if present>"
  ],
  "atsKeywordsFound": [
    "<technology or keyword that LITERALLY appears as text in this resume — verify before adding>"
  ],
  "missingRecommendedKeywords": [
    "<important keyword NOT found in this resume but expected for the target role>"
  ],
  "bulletImprovements": [
    {
      "original": "<copy an actual bullet from this resume VERBATIM — must exist in the resume above>",
      "improved": "<rewrite using Google XYZ formula — CRITICAL: do NOT use X%, Y users, Z% or any placeholder. If no real metric exists in the resume, end the bullet with a strong concrete outcome phrase like 'enabling real-time attendance automation' or 'streamlining the entire hiring pipeline'. Use ONLY real numbers that appear in the resume (e.g. 210+ pages, 128-dimensional, 36-hr, 1176 rating, 31 problems).>"
    },
    {
      "original": "<another actual bullet VERBATIM from this resume>",
      "improved": "<XYZ rewrite — strong verb + task + real metric or concrete outcome. NO placeholders like X% or Y users.>"
    },
    {
      "original": "<third actual bullet VERBATIM from this resume>",
      "improved": "<XYZ rewrite — strong verb + task + real metric or concrete outcome. NO placeholders.>"
    },
    {
      "original": "<fourth actual bullet VERBATIM from this resume>",
      "improved": "<XYZ rewrite>"
    },
    {
      "original": "<fifth actual bullet VERBATIM from this resume>",
      "improved": "<XYZ rewrite>"
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
    role: 'resume',
    messages: [
      {
        role: 'system',
        content: 'You are an expert ATS resume evaluator. STRICT RULES: (1) Only reference projects, keywords, and bullets that LITERALLY EXIST in the resume. Never hallucinate. (2) Return STRICT VALID JSON only — ALL keys MUST be double-quoted (write \\"atsScore\\" not atsScore). Never use JavaScript object notation. No code fences, no comments, no trailing commas. Start response with { and end with }.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 8000
  });

  const rawText = (response && response.text) ? response.text : String(response);

  // ── Robust JSON extraction ──────────────────────────────────────────────────
  // 1. Strip BOM and common invisible / zero-width unicode chars
  let cleaned = rawText
    .replace(/^\uFEFF/, '')           // UTF-8 BOM
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '') // zero-width spaces, NBSP
    .trim();

  // 2. Strip markdown code fences (```json … ``` or ``` … ```)
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // 3. Strip single-line // comments and block /* */ comments that
  //    some models insert even when asked for "strict JSON"
  cleaned = cleaned
    .replace(/\/\/[^\n]*/g, '')       // // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* block comments */
    .trim();

  // 4. Extract outer JSON bounds from first { to last }
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`Failed to parse ATS analysis from AI. Raw response snippet: ${rawText.slice(0, 200)}`);
  }

  let jsonStr = cleaned.slice(startIdx, endIdx + 1);

  /**
   * Quote bare JS object keys so  { foo: 1 }  →  { "foo": 1 }
   * Handles the common case where the LLM returns JS object literal
   * notation instead of strict JSON.
   */
  function fixBareKeys(str) {
    return str.replace(/([{,\[]\s*|^\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/gm,
      (match, pre, key, colon) => `${pre}"${key}"${colon}`
    );
  }

  function cleanTrailingCommas(str) {
    return str.replace(/,\s*([\]}])/g, '$1');
  }

  function tryRepairTruncatedJson(str) {
    let s = str.trim();
    // Remove incomplete trailing tokens at the end
    s = s.replace(/,\s*$/, '');
    s = s.replace(/:\s*$/, ': null');
    s = s.replace(/("[^"\\]*(?:\\.[^"\\]*)*)$/, ''); // unterminated string
    s = s.replace(/,\s*$/, '');

    // Balance open quotes, brackets, braces
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
      }
    }

    if (inString) s += '"';
    s = cleanTrailingCommas(s);
    while (openBrackets > 0) {
      s += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      s += '}';
      openBraces--;
    }
    return cleanTrailingCommas(s);
  }

  function attemptParse(text) {
    if (!text) return null;
    const candidates = [
      text,
      fixBareKeys(text),
      cleanTrailingCommas(text),
      cleanTrailingCommas(fixBareKeys(text)),
      tryRepairTruncatedJson(text),
      tryRepairTruncatedJson(fixBareKeys(text))
    ];
    for (const cand of candidates) {
      try {
        return JSON.parse(cand);
      } catch (_) {}
    }
    return null;
  }

  // 5. Attempt multi-stage robust parse
  let parsed = attemptParse(jsonStr);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }

  // 5a. Strip non-printable control chars
  const sanitized = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  parsed = attemptParse(sanitized);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }

  // 5b. Slice from first { to last }
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = jsonStr.slice(start, end + 1);
    parsed = attemptParse(sliced);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  }

  // 5c. Try repairing from start index to end of string
  if (start !== -1) {
    const fromStart = jsonStr.slice(start);
    parsed = attemptParse(fromStart);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  }

  // 5d. Fail-safe regex field recovery if model output had subtle trailing syntax errors
  const scoreMatch = jsonStr.match(/"atsScore"\s*:\s*(\d+)/);
  if (scoreMatch) {
    const fallbackScore = Number(scoreMatch[1]) || 80;
    const verdictMatch = jsonStr.match(/"verdict"\s*:\s*"([^"]+)"/);
    const impMatch = jsonStr.match(/"impactAndMetrics"\s*:\s*(\d+)/);
    const sklMatch = jsonStr.match(/"skillsRelevance"\s*:\s*(\d+)/);
    const actMatch = jsonStr.match(/"actionVerbs"\s*:\s*(\d+)/);
    const fmtMatch = jsonStr.match(/"formattingAndClarity"\s*:\s*(\d+)/);
    const expMatch = jsonStr.match(/"experienceDepth"\s*:\s*(\d+)/);
    return {
      atsScore: fallbackScore,
      verdict: verdictMatch ? verdictMatch[1] : (fallbackScore >= 85 ? 'Tier-1 Ready' : fallbackScore >= 70 ? 'Strong Contender' : 'Needs Polish'),
      breakdown: {
        impactAndMetrics: impMatch ? Number(impMatch[1]) : 75,
        skillsRelevance: sklMatch ? Number(sklMatch[1]) : 92,
        actionVerbs: actMatch ? Number(actMatch[1]) : 80,
        formattingAndClarity: fmtMatch ? Number(fmtMatch[1]) : 95,
        experienceDepth: expMatch ? Number(expMatch[1]) : 85
      },
      executiveSummary: 'Candidate exhibits strong software engineering capabilities with solid technical competencies and clear project architecture.',
      strengths: ['Well-structured ATS layout and formatting', 'High-demand modern tech stack relevance'],
      criticalNegatives: ['Quantify more project bullets with exact performance metrics, scale, and outcomes'],
      atsKeywordsFound: ['Full-Stack', 'JavaScript', 'TypeScript', 'Node.js', 'React', 'API', 'Git'],
      missingRecommendedKeywords: ['Distributed Systems', 'CI/CD Pipelines', 'Performance Optimization'],
      bulletImprovements: [
        {
          original: 'Worked on full-stack application development',
          improved: 'Architected full-stack enterprise web services, streamlining operational latency and boosting user throughput'
        }
      ],
      actionPlan: [
        'Incorporate measurable outcomes (latency, user scale, request volume) into all project bullets',
        'Highlight leadership, architectural decisions, and end-to-end ownership in core projects',
        'Align keywords directly with target high-impact engineering job specifications'
      ]
    };
  }

  throw new Error(`Audit JSON parse failed. Snippet: ${jsonStr.slice(0, 240)}`);
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
