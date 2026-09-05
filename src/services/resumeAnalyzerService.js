// ---------------------------------------------------------------------------
// Bob Resume Intelligence — Elite ATS Resume Analyzer Service
// Audits resumes across 6 key ATS pillars (Score, Strengths, Red Flags, STAR Bullets, Keywords, Action Plan)
// ---------------------------------------------------------------------------
const { callLLM } = require('./llmService');
const documentReader = require('./documentReaderService');

/**
 * Deep audit of resume text against industry ATS benchmarks
 */
async function auditResume({ resumeText, targetJobDescription = '' }) {
  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error('Resume content is too short or empty to analyze.');
  }

  const prompt = `You are a Principal Tech Recruiter and Fortune 500 ATS Resume Auditor.
Perform a strict, deep, zero-fluff analysis of the following candidate resume.

RESUME CONTENT:
"""
${resumeText.slice(0, 25000)}
"""

${targetJobDescription && targetJobDescription.trim() ? `TARGET JOB VACANCY / DESCRIPTION:
"""
${targetJobDescription.slice(0, 10000)}
"""
Compare keywords and requirements directly against this job vacancy.` : 'No specific JD provided: evaluate against elite General Software Engineering / ATS benchmarks (Google/Harvard standard).'}

RETURN ONLY A VALID JSON OBJECT (no markdown around it, no backticks, no comments, raw JSON only) matching this exact schema:
{
  "atsScore": 85,
  "verdict": "Tier-1 Ready | Strong Contender | Needs Polish | High Risk",
  "breakdown": {
    "impactAndMetrics": 88,
    "skillsRelevance": 92,
    "actionVerbs": 80,
    "formattingAndClarity": 95,
    "experienceDepth": 85
  },
  "executiveSummary": "2-3 sentences summarizing overall impression and competitiveness for top tech roles.",
  "strengths": [
    "Identified strength 1 (e.g. Quantifiable impact in projects)",
    "Identified strength 2 (e.g. Published patent or competitive programming highlights)"
  ],
  "criticalNegatives": [
    "Identified weakness or red flag 1 (e.g. Passive voice or missing metrics in bullet points)",
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
      "improved": "Architected RESTful microservices in Node.js, reducing API response latency by 35% across 10k daily requests."
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

module.exports = {
  auditResume,
  auditResumeBuffer
};
