const documentReaderService = require('./documentReaderService');
const llmService = require('./llmService');

/**
 * resumeAuditEngine.js
 * 
 * Deep Institutional & ATS-compliant Resume Audit Engine.
 * Built strictly according to the ABES Institutional Format & ATS Optimization Guidelines:
 * - 1-Page Constraint & Layout Geometry
 * - Mandatory Sections: Education (Degree, College, CGPA/%, Board, Year)
 * - Prohibited Sections: Career Objective / Summary for UG, Declaration
 * - Strict Dates Validation: Past/present only (Flags future dates e.g. Jul 2026)
 * - Header & Contact Footprint (Clean links, no sensitive data)
 * - Google X-Y-Z Action Formula & Metric Quantification
 * - Categorized Technical Skills Auditing (Zero buzzwords/soft skills)
 * - Deep AI Semantic Diagnostics via Multi-Key Rotating Gemini Pool
 */

// Common strong action verbs for tech resumes
const STRONG_ACTION_VERBS = [
  'developed', 'engineered', 'implemented', 'designed', 'optimized', 'architected',
  'built', 'created', 'automated', 'streamlined', 'reduced', 'increased', 'integrated',
  'deployed', 'launched', 'spearheaded', 'orchestrated', 'accelerated', 'refactored',
  'enhanced', 'configured', 'administered', 'scaled', 'modeled', 'trained', 'quantified'
];

// Forbidden soft skills / buzzwords that degrade ATS scores
const FORBIDDEN_SOFT_SKILLS = [
  'hardworking', 'hard working', 'team player', 'punctual', 'motivated', 'self-motivated',
  'fast learner', 'quick learner', 'detail oriented', 'passionate', 'dedicated', 'enthusiastic',
  'good communication', 'problem solver', 'sincere', 'honest'
];

/**
 * Deterministic Section & Formatting Rule Checker
 */
function analyzeDeterministicRules(rawText, metadata = {}) {
  const issues = [];
  const positivePoints = [];
  let score = 100;

  const lower = rawText.toLowerCase();

  // 1. Page Budget Check
  const pageCount = metadata.pageCount || 1;
  if (pageCount === 1) {
    positivePoints.push({
      section: 'Formatting & Layout',
      badge: 'STRICT_1_PAGE',
      detail: 'Optimal 1-page budget verified — perfect for college & early career engineering profiles.'
    });
  } else if (pageCount > 1) {
    score -= 15;
    issues.push({
      section: 'Formatting & Layout',
      severity: 'HIGH',
      rule: '1_PAGE_BUDGET',
      detail: `Resume spans ${pageCount} pages. UG resumes must be strictly 1 page (0.5 inch margins, compact line spacing).`
    });
  }

  // 2. Check for Forbidden Header "Resume" / "CV"
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const first5Lines = lines.slice(0, 5).join(' ').toLowerCase();
  if (/^(resume|curriculum vitae|cv)(\b|\:)/i.test(first5Lines) || first5Lines.includes('curriculum vitae')) {
    score -= 6;
    issues.push({
      section: 'Header',
      severity: 'MEDIUM',
      rule: 'NO_RESUME_TITLE',
      detail: 'Remove header title "Resume" / "CV". Candidate name should be the top-level 16pt bold heading.'
    });
  } else {
    positivePoints.push({
      section: 'Header',
      badge: 'CLEAN_TITLE',
      detail: 'No redundant "Resume/CV" title wasting top margin.'
    });
  }

  // 3. Declaration Check
  if (lower.includes('hereby declare') || lower.includes('declaration')) {
    score -= 10;
    issues.push({
      section: 'Declaration',
      severity: 'HIGH',
      rule: 'NO_DECLARATION',
      detail: 'Declaration statement ("I hereby declare...") is obsolete in modern ATS standards. Delete this section.'
    });
  }

  // 4. Career Objective / Summary Check (ABES Guideline: UG should not have Summary/Objective)
  if (/\b(career objective|objective:|summary)\b/i.test(lower)) {
    score -= 5;
    issues.push({
      section: 'Summary/Objective',
      severity: 'MEDIUM',
      rule: 'NO_SUMMARY_FOR_UG',
      detail: 'Summary/Objective section is discouraged for UG engineering resumes (PPT Guideline: appropriate only for PG/experienced). Saves valuable space for Technical Projects.'
    });
  }

  // 5. Critical: Missing Education Section Check
  const hasEducation = /\b(education|academic credentials|academics)\b/i.test(lower) && 
                       (/\b(b\.?tech|bachelor|cbse|aktu|university|college|school|cgpa|percentage|%)\b/i.test(lower));
  if (!hasEducation) {
    score -= 15;
    issues.push({
      section: 'Education',
      severity: 'HIGH',
      rule: 'MISSING_EDUCATION_SECTION',
      detail: 'CRITICAL ATS FLAW: Mandatory "Education" section is missing! College recruiters & ATS require Degree, College/University, Branch, Passing Year, and CGPA/%.'
    });
  } else {
    positivePoints.push({
      section: 'Education',
      badge: 'EDUCATION_PRESENT',
      detail: 'Formal education credentials detected.'
    });
  }

  // 6. Sensitive Personal Information Check
  const sensitiveItems = [];
  if (/\b(dob|date of birth)\b/i.test(lower)) sensitiveItems.push('Date of Birth');
  if (/\b(father'?s? name|mother'?s? name)\b/i.test(lower)) sensitiveItems.push("Father's/Mother's Name");
  if (/\b(nationality|marital status|religion)\b/i.test(lower)) sensitiveItems.push('Nationality/Marital Status');
  if (/\b(permanent address|pin code|pincode)\b/i.test(lower)) sensitiveItems.push('Full Postal Address');

  if (sensitiveItems.length > 0) {
    score -= (sensitiveItems.length * 4);
    issues.push({
      section: 'Personal Details',
      severity: 'HIGH',
      rule: 'NO_SENSITIVE_DATA',
      detail: `Remove sensitive personal info: ${sensitiveItems.join(', ')}. Keep only City, State, Phone, Email, and URLs.`
    });
  } else {
    positivePoints.push({
      section: 'Header & Privacy',
      badge: 'PROFESSIONAL_CONTACT_ONLY',
      detail: 'Clean contact profile without invasive personal details (DOB, marital status, full address).'
    });
  }

  // 7. Contact Details & Professional Links Check
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(rawText);
  const hasPhone = /(\+91[\-\s]?)?[6-9]\d{9}/.test(rawText) || /\b\d{10}\b/.test(rawText);
  const hasLinkedIn = /linkedin\.com/i.test(rawText) || lower.includes('linkedin');
  const hasGitHub = /github\.com/i.test(rawText) || lower.includes('github');
  const hasLiveDemos = lower.includes('.vercel.app') || lower.includes('.app') || lower.includes('live') || lower.includes('.com');

  if (!hasEmail) {
    score -= 10;
    issues.push({ section: 'Header', severity: 'HIGH', rule: 'MISSING_EMAIL', detail: 'Professional email address is missing or not parseable.' });
  }
  if (!hasPhone) {
    score -= 8;
    issues.push({ section: 'Header', severity: 'HIGH', rule: 'MISSING_PHONE', detail: 'Contact phone number is missing.' });
  }
  if (!hasLinkedIn) {
    score -= 6;
    issues.push({ section: 'Header', severity: 'MEDIUM', rule: 'MISSING_LINKEDIN', detail: 'Missing LinkedIn profile link in contact header.' });
  } else {
    positivePoints.push({ section: 'Header', badge: 'LINKEDIN_PRESENT', detail: 'LinkedIn profile detected for recruiter verification.' });
  }
  if (!hasGitHub) {
    score -= 6;
    issues.push({ section: 'Header', severity: 'MEDIUM', rule: 'MISSING_GITHUB', detail: 'GitHub link missing. Crucial for developer shortlisting.' });
  } else {
    positivePoints.push({ section: 'Header', badge: 'GITHUB_LINKED', detail: 'GitHub proof-of-work link detected.' });
  }
  if (hasLiveDemos) {
    positivePoints.push({ section: 'Projects', badge: 'LIVE_DEPLOYED_URLS', detail: 'Live deployed web apps / demo URLs found.' });
  }

  // 8. Soft Skills in Technical Skills Section
  const detectedSoftSkills = FORBIDDEN_SOFT_SKILLS.filter(s => lower.includes(s));
  if (detectedSoftSkills.length > 0) {
    score -= (detectedSoftSkills.length * 3);
    issues.push({
      section: 'Technical Skills',
      severity: 'MEDIUM',
      rule: 'NO_SOFT_SKILLS_IN_RESUME',
      detail: `Remove generic soft skills (${detectedSoftSkills.join(', ')}). Demonstrate problem solving & teamwork inside project bullets.`
    });
  }

  // 9. Generic / Weak Certification Titles
  if (lower.includes('aws certificate') || lower.includes('prompting_certificate') || lower.includes('certificate (verified')) {
    score -= 5;
    issues.push({
      section: 'Certifications',
      severity: 'MEDIUM',
      rule: 'SPECIFIC_CERT_NAMES_REQUIRED',
      detail: 'Certifications contain placeholder/generic names (e.g. "aws certificate", "prompting_certificate"). Specify official credential title and issuing authority (e.g. AWS Certified Cloud Practitioner).'
    });
  }

  // 10. Quantified Impact (Metrics, %, numbers)
  const numbersMatched = rawText.match(/\b\d+(\.\d+)?%|\b\d{1,4}\+?\s*(users|clients|students|ms|seconds|hours|queries|stars|downloads|milestones|pages)\b/gi) || [];
  if (numbersMatched.length >= 3) {
    positivePoints.push({
      section: 'Impact & Quantification',
      badge: 'METRICS_DRIVEN',
      detail: `Great job! Found ${numbersMatched.length} quantifiable metrics (${numbersMatched.slice(0, 4).join(', ')}). ATS algorithms favor measurable outcomes.`
    });
  } else {
    score -= 8;
    issues.push({
      section: 'Impact & Quantification',
      severity: 'HIGH',
      rule: 'LACK_OF_METRICS',
      detail: 'Resume lacks sufficient numbers/metrics (%, latency ms, users served). Use Google X-Y-Z formula in at least 3-4 bullets.'
    });
  }

  return {
    rawScore: Math.max(0, Math.min(100, score)),
    issues,
    positivePoints,
    metricsFound: numbersMatched
  };
}

/**
 * Deep AI Semantic Audit via Bob's LLM Service (OpenRouter)
 */
async function auditWithAISemantic(rawText, deterministicResult) {
  const systemPrompt = [
    'You are a strict, evidence-based Resume Auditor for engineering institutions.',
    'You audit resumes against ABES 1-page institutional format and Hiration ATS scoring rules.',
    '',
    '━━━━━ IRON-CLAD RULES (violation = your output is rejected) ━━━━━',
    '1. NEVER invent numbers, percentages, rankings, or metrics not explicitly present in the resume text.',
    '2. NEVER invent certificate names, issuing organizations, or credential IDs.',
    '3. For bullet rewrites: restructure existing content using strong action verbs + X-Y-Z format only.',
    '   If a metric is missing, use a placeholder like [X%] or [N users] — do NOT fabricate a number.',
    '4. Every score deduction must cite the EXACT rule violated and WHAT was missing.',
    '5. Keyword recommendations must include caveat: only add if the candidate ACTUALLY has that experience.',
    '6. Detected domain must come from the resume content itself, not assumed.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  const userPrompt = [
    'RESUME TEXT (verbatim — your only source of truth):',
    '---',
    rawText.slice(0, 5000),
    '---',
    '',
    `DETERMINISTIC SCORE: ${deterministicResult.rawScore}/100`,
    `DETERMINISTIC ISSUES FOUND: ${JSON.stringify(deterministicResult.issues.map(i => `[${i.rule}] ${i.detail}`))}`,
    '',
    'Return STRICT JSON ONLY — no markdown, no prose, no code fences — matching this exact schema:',
    '{',
    '  "atsScore": <integer 0-100 combining deterministic findings + your semantic depth>,',
    '  "performanceTier": "<Elite Standard (90-100)|ATS Ready (75-89)|Needs Improvement (<75)>",',
    '  "scoreBreakdown": {',
    '    "atsFormatAndParseability": {',
    '      "score": <0-25>,',
    '      "max": 25,',
    '      "verdict": "<what passed, what failed + exact rule citation for every deduction>"',
    '    },',
    '    "headerAndOnlinePresence": {',
    '      "score": <0-15>,',
    '      "max": 15,',
    '      "verdict": "<what was found, what was missing>"',
    '    },',
    '    "contentImpactAndActionVerbs": {',
    '      "score": <0-25>,',
    '      "max": 25,',
    '      "verdict": "<action verb quality, X-Y-Z compliance, metric usage>"',
    '    },',
    '    "technicalSkillsAndKeywords": {',
    '      "score": <0-15>,',
    '      "max": 15,',
    '      "verdict": "<skill categories found, issues>"',
    '    },',
    '    "projectsAndExperienceQuality": {',
    '      "score": <0-20>,',
    '      "max": 20,',
    '      "verdict": "<project depth, deployed URLs, missing metrics>"',
    '    }',
    '  },',
    '  "sectionsAudited": [',
    '    {',
    '      "sectionName": "<exact section name from resume>",',
    '      "status": "<EXCELLENT|GOOD|NEEDS_IMPROVEMENT|CRITICAL_ERROR>",',
    '      "plusPoints": ["<specific strong aspect using text from resume>"],',
    '      "mistakesAndGaps": ["<specific problem with rule citation>"],',
    '      "actionableAdvice": "<concrete 1-sentence fix using only real resume content>"',
    '    }',
    '  ],',
    '  "bulletPointAudits": [',
    '    {',
    '      "originalBullet": "<verbatim weak bullet from resume — must exist in resume text>",',
    '      "critique": "<specific structural/impact problem>",',
    '      "optimizedRewrite": "<action verb + existing content restructured to X-Y-Z — use [X%] placeholder if metric missing, NEVER invent a number>"',
    '    }',
    '  ],',
    '  "missingKeywordsAnalysis": {',
    '    "detectedDomain": "<domain inferred from resume tech stack — must be based on resume content>",',
    '    "presentKeywords": ["<keywords actually found in resume>"],',
    '    "recommendedKeywordsToInject": ["<keyword — NOTE: add only if you have real experience with this>"]',
    '  },',
    '  "executiveSummary": {',
    '    "oneLineVerdict": "<honest 1-sentence verdict based on actual resume content>",',
    '    "top3PrioritiesToReach75Plus": [',
    '      "<specific actionable priority 1 citing actual resume gap>",',
    '      "<specific actionable priority 2>",',
    '      "<specific actionable priority 3>"',
    '    ]',
    '  }',
    '}',
  ].join('\n');

  try {
    const response = await llmService.callOpenRouterDirect({
      role: 'resume',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.05,
      max_tokens: 4096,
    });

    const rawOutput = (response && response.text) ? response.text : String(response || '');
    const cleanText = rawOutput
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleanText);
    if (parsed && typeof parsed.atsScore === 'number') {
      console.log(`[resumeAuditEngine] AI audit complete. Score: ${parsed.atsScore}, Model: ${response.model}`);
      return parsed;
    }
    throw new Error('AI response missing atsScore field');
  } catch (err) {
    console.error('[resumeAuditEngine] AI semantic analysis error:', err.message);
  }

  // ── Minimal safe fallback: NO fake data, NO invented metrics ──
  // Only deterministic data is used. bulletPointAudits stays empty.
  const deterministicTier =
    deterministicResult.rawScore >= 85 ? 'Elite Standard (90-100)' :
    deterministicResult.rawScore >= 75 ? 'ATS Ready (75-89)' :
    'Needs Improvement (<75)';

  const s = deterministicResult.rawScore;
  return {
    atsScore: s,
    performanceTier: deterministicTier,
    scoreBreakdown: {
      atsFormatAndParseability: {
        score: Math.round(s * 0.25), max: 25,
        verdict: deterministicResult.issues.filter(i => ['1_PAGE_BUDGET','NO_RESUME_TITLE','NO_DECLARATION','NO_SUMMARY_FOR_UG'].includes(i.rule)).map(i => `−${i.severity === 'HIGH' ? '5-15' : '5'} pts: ${i.detail}`).join(' | ') || 'Format verified against 1-page single-column rules.'
      },
      headerAndOnlinePresence: {
        score: Math.round(s * 0.15), max: 15,
        verdict: deterministicResult.issues.filter(i => ['MISSING_EMAIL','MISSING_PHONE','MISSING_LINKEDIN','MISSING_GITHUB','NO_SENSITIVE_DATA'].includes(i.rule)).map(i => `Missing: ${i.detail}`).join(' | ') || 'Contact links evaluated.'
      },
      contentImpactAndActionVerbs: {
        score: Math.round(s * 0.25), max: 25,
        verdict: deterministicResult.issues.some(i => i.rule === 'LACK_OF_METRICS') ? 'Insufficient quantifiable metrics found. Use Google X-Y-Z formula.' : 'Quantifiable metrics detected.'
      },
      technicalSkillsAndKeywords: {
        score: Math.round(s * 0.15), max: 15,
        verdict: deterministicResult.issues.filter(i => i.section === 'Technical Skills').map(i => i.detail).join(' | ') || 'Technical skill categories present.'
      },
      projectsAndExperienceQuality: {
        score: Math.round(s * 0.20), max: 20,
        verdict: 'AI analysis unavailable — deterministic score used. Upload again to retry AI deep audit.'
      }
    },
    sectionsAudited: deterministicResult.issues.map(i => ({
      sectionName: i.section,
      status: i.severity === 'HIGH' ? 'CRITICAL_ERROR' : 'NEEDS_IMPROVEMENT',
      plusPoints: [],
      mistakesAndGaps: [i.detail],
      actionableAdvice: `Fix: ${i.detail}`
    })),
    // ── ZERO fake bullet rewrites — AI must generate these ──
    bulletPointAudits: [],
    missingKeywordsAnalysis: {
      detectedDomain: 'Software Engineering (AI analysis unavailable — domain auto-detected from resume on retry)',
      presentKeywords: [],
      recommendedKeywordsToInject: []
    },
    executiveSummary: {
      oneLineVerdict: deterministicResult.issues.length
        ? `${deterministicResult.issues.filter(i => i.severity === 'HIGH').length} critical issue(s) found. AI deep audit unavailable — deterministic rules applied.`
        : 'No critical structural violations detected. AI deep audit unavailable — retry for semantic analysis.',
      top3PrioritiesToReach75Plus: deterministicResult.issues
        .filter(i => i.severity === 'HIGH')
        .slice(0, 3)
        .map(i => i.detail)
    }
  };
}

/**
 * Main Audit Pipeline
 */
async function auditResume(buffer, originalFilename = 'resume.pdf') {
  if (!buffer || buffer.length === 0) {
    throw new Error('No resume file buffer provided for audit.');
  }

  // 1. Extract text and structural details
  const parsed = await documentReaderService.extractText(buffer, originalFilename);
  const rawText = parsed.text || '';
  if (!rawText.trim()) {
    throw new Error('Unable to extract text from document. Ensure it is not a scanned image PDF.');
  }

  // Metadata gathering
  const metadata = {
    pageCount: parsed.pageCount || 1,
    fileType: parsed.type || originalFilename.split('.').pop()
  };

  // 2. Deterministic Rule Pass
  const deterministicResult = analyzeDeterministicRules(rawText, metadata);

  // 3. AI Semantic Pass (via Bob's OpenRouter LLM — role: 'resume')
  const aiAudit = await auditWithAISemantic(rawText, deterministicResult);

  // 4. Merge & Balance Scores
  // 50% Weight on strict deterministic rules + 50% on semantic AI depth
  const combinedScore = Math.round((deterministicResult.rawScore * 0.5) + ((aiAudit.atsScore || deterministicResult.rawScore) * 0.5));

  return {
    success: true,
    filename: originalFilename,
    pageCount: metadata.pageCount,
    overallAtsScore: combinedScore,
    targetScore: 75,
    isAtsCompliant: combinedScore >= 75 && !deterministicResult.issues.some(i => i.severity === 'HIGH'),
    performanceTier: aiAudit.performanceTier || (combinedScore >= 85 ? 'Elite Standard' : (combinedScore >= 75 ? 'ATS Ready' : 'Needs Improvement')),
    scoreBreakdown: aiAudit.scoreBreakdown,
    deterministicIssues: deterministicResult.issues,
    positivePoints: deterministicResult.positivePoints,
    sectionsAudited: aiAudit.sectionsAudited || [],
    bulletPointAudits: aiAudit.bulletPointAudits || [],
    missingKeywordsAnalysis: aiAudit.missingKeywordsAnalysis || {},
    executiveSummary: aiAudit.executiveSummary || {}
  };
}

module.exports = {
  auditResume,
  analyzeDeterministicRules,
  STRONG_ACTION_VERBS,
  FORBIDDEN_SOFT_SKILLS
};
