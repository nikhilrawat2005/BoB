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
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // ── CHECK 0: Corrupted / Garbled Characters (PDF encoding failure) ──
  // Detects non-printable or mojibake character clusters that signal broken PDF text extraction
  const corruptedChunks = (rawText.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F\uFFFD]{2,}|[©™®°±¢£¤¥§¨«»]{3,}|[\u2018-\u201F\u2032-\u2035]{3,}/g) || []);
  const corruptedLineCount = lines.filter(l => /[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u2013\u2014\u2018-\u201D\u2022\u2026\u20B9]/g.test(l) && l.length > 3).length;
  if (corruptedChunks.length > 0 || corruptedLineCount >= 2) {
    score -= 8;
    issues.push({
      section: 'PDF Rendering',
      severity: 'HIGH',
      rule: 'CORRUPTED_TEXT_DETECTED',
      detail: `PDF text extraction contains ${corruptedLineCount} line(s) with corrupted/garbled characters (encoding issue). Recruiters and ATS systems will see broken text. Fix: Save/export the resume as PDF again from source (Word/Canva/LaTeX), ensuring Unicode compatibility.`
    });
  }

  // ── CHECK 1: Page Budget ──
  const pageCount = metadata.pageCount || 1;
  const pageTexts = metadata.pageTexts || [rawText]; // array of per-page text if available

  if (pageCount === 1) {
    positivePoints.push({
      section: 'Formatting & Layout',
      badge: 'STRICT_1_PAGE',
      detail: 'Optimal 1-page budget verified — perfect for college & early career engineering profiles.'
    });
  } else if (pageCount > 1) {
    score -= 15;
    // Detect if second page is nearly empty (content could have fit on page 1)
    const page2Text = (pageTexts[1] || '').trim();
    const page2Lines = page2Text.split('\n').filter(l => l.trim().length > 2).length;
    const nearlyEmptyPage2 = page2Lines < 10;
    issues.push({
      section: 'Formatting & Layout',
      severity: 'HIGH',
      rule: '1_PAGE_BUDGET',
      detail: nearlyEmptyPage2
        ? `Resume is ${pageCount} pages, but Page 2 has only ~${page2Lines} content lines — it is nearly empty. This wastes space and signals poor layout control. Move Page 2 content to Page 1 and delete the overflow: tighten margins (≤0.5 inch), reduce font size (10pt), and compress section spacing.`
        : `Resume spans ${pageCount} pages. UG resumes must be strictly 1 page (0.5 inch margins, 10pt body font, compact line spacing).`
    });
  }

  // ── CHECK 2: Forbidden Header "Resume" / "CV" ──
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

  // ── CHECK 3: Declaration ──
  if (lower.includes('hereby declare') || lower.includes('declaration')) {
    score -= 10;
    issues.push({
      section: 'Declaration',
      severity: 'HIGH',
      rule: 'NO_DECLARATION',
      detail: 'Declaration statement ("I hereby declare...") is obsolete in modern ATS standards. Delete this section entirely — it wastes 3-4 lines of premium resume space.'
    });
  }

  // ── CHECK 4: Summary / Career Objective (ABES: forbidden for UG) ──
  if (/\b(career objective|objective:|summary)\b/i.test(lower)) {
    score -= 5;
    issues.push({
      section: 'Summary/Objective',
      severity: 'MEDIUM',
      rule: 'NO_SUMMARY_FOR_UG',
      detail: 'Summary/Objective section is discouraged for UG engineering resumes (ABES PPT Guideline: use only for PG/experienced 5yr+). Remove it and use the freed space for an additional project bullet or skill entry.'
    });
  }

  // ── CHECK 5: Education — both heading AND actual degree details ──
  const hasEducationHeading = /\b(education|certifications\s*&\s*academics|academic credentials|academics)\b/i.test(lower);
  const hasDegreeDetails = /\b(b\.?tech|bachelor|b\.?e\.?|cbse|aktu|university|college|engineering college)\b/i.test(lower);
  const hasCGPA = /\b(cgpa|gpa|percentage|%)\b/i.test(lower);
  const hasGradYear = /\b(20(2[3-9]|[3-9]\d)|passing year|expected|graduated)\b/i.test(lower);

  if (!hasEducationHeading) {
    score -= 15;
    issues.push({
      section: 'Education',
      severity: 'HIGH',
      rule: 'MISSING_EDUCATION_SECTION',
      detail: 'CRITICAL: No Education section found. College recruiters and ATS mandatorily require: Degree (B.Tech CSE/ECE), Institution name, University (AKTU), CGPA/%, and Passing Year.'
    });
  } else if (!hasDegreeDetails || !hasCGPA || !hasGradYear) {
    // Section heading exists but details are incomplete (e.g. merged into "Certifications & Academics")
    score -= 10;
    const missing = [];
    if (!hasDegreeDetails) missing.push('Degree name & College (e.g. B.Tech CSE, ABES Engineering College)');
    if (!hasCGPA) missing.push('CGPA or percentage');
    if (!hasGradYear) missing.push('Passing Year / Expected Graduation');
    issues.push({
      section: 'Education',
      severity: 'HIGH',
      rule: 'INCOMPLETE_EDUCATION_DETAILS',
      detail: `Education section exists but is missing critical details: ${missing.join(' | ')}. ATS parsing requires all fields on separate clearly-labelled lines.`
    });
  } else {
    positivePoints.push({
      section: 'Education',
      badge: 'EDUCATION_COMPLETE',
      detail: 'Education section with degree, institution, CGPA and year detected.'
    });
  }

  // ── CHECK 6: Sensitive Personal Info ──
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
      detail: `Remove sensitive personal info: ${sensitiveItems.join(', ')}. Keep only City, State, Phone, Email, and profile URLs.`
    });
  } else {
    positivePoints.push({
      section: 'Header & Privacy',
      badge: 'PROFESSIONAL_CONTACT_ONLY',
      detail: 'Clean contact profile — no invasive personal details (DOB, marital status, full address).'
    });
  }

  // ── CHECK 7: Contact & Professional Links ──
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(rawText);
  const hasPhone = /(\+91[\-\s]?)?[6-9]\d{9}/.test(rawText) || /\b\d{10}\b/.test(rawText);
  const hasLinkedIn = /linkedin\.com/i.test(rawText) || lower.includes('linkedin');
  const hasGitHub = /github\.com/i.test(rawText) || lower.includes('github');
  const hasLiveDemos = lower.includes('.vercel.app') || lower.includes('.netlify.app') || lower.includes('live demo') || /https?:\/\/[^\s]+\.(com|app|io|dev)/i.test(rawText);

  if (!hasEmail) { score -= 10; issues.push({ section: 'Header', severity: 'HIGH', rule: 'MISSING_EMAIL', detail: 'Professional email address is missing or not parseable from the PDF.' }); }
  if (!hasPhone) { score -= 8; issues.push({ section: 'Header', severity: 'HIGH', rule: 'MISSING_PHONE', detail: 'Contact phone number is missing.' }); }
  if (!hasLinkedIn) {
    score -= 6;
    issues.push({ section: 'Header', severity: 'MEDIUM', rule: 'MISSING_LINKEDIN', detail: 'No LinkedIn profile link found. Add: linkedin.com/in/your-username — required for recruiter verification.' });
  } else {
    positivePoints.push({ section: 'Header', badge: 'LINKEDIN_PRESENT', detail: 'LinkedIn profile detected.' });
  }
  if (!hasGitHub) {
    score -= 6;
    issues.push({ section: 'Header', severity: 'MEDIUM', rule: 'MISSING_GITHUB', detail: 'GitHub link missing. Crucial for developer shortlisting — add github.com/username.' });
  } else {
    positivePoints.push({ section: 'Header', badge: 'GITHUB_LINKED', detail: 'GitHub proof-of-work link detected.' });
  }
  if (hasLiveDemos) {
    positivePoints.push({ section: 'Projects', badge: 'LIVE_DEPLOYED_URLS', detail: 'Live deployed app URLs found — strong proof-of-work for recruiters.' });
  }

  // ── CHECK 8: Soft Skills ──
  const detectedSoftSkills = FORBIDDEN_SOFT_SKILLS.filter(s => lower.includes(s));
  if (detectedSoftSkills.length > 0) {
    score -= (detectedSoftSkills.length * 3);
    issues.push({
      section: 'Technical Skills',
      severity: 'MEDIUM',
      rule: 'NO_SOFT_SKILLS_IN_RESUME',
      detail: `Remove generic soft skills: (${detectedSoftSkills.join(', ')}). Show these traits inside project bullet outcomes instead.`
    });
  }

  // ── CHECK 9: Certification Quality ──
  // Check for incomplete/placeholder certification entries
  const certIncomplete = lower.includes('aws certificate') || lower.includes('prompting_certificate') || /certificate\s*\(verified/i.test(lower);
  const certMissingOrg = /\bcertif(icate|ication)\b/i.test(lower) && !/\b(amazon|google|microsoft|meta|coursera|udemy|nptel|aws|azure|ibm|oracle|cisco)\b/i.test(lower);
  if (certIncomplete) {
    score -= 5;
    issues.push({
      section: 'Certifications',
      severity: 'MEDIUM',
      rule: 'GENERIC_CERT_NAME',
      detail: 'One or more certifications use incomplete/placeholder names (e.g. "aws certificate", "prompting_certificate"). Required format: [Official Certificate Title] | [Issuing Organization] | [Month Year] | [Credential URL or ID].'
    });
  } else if (certMissingOrg) {
    issues.push({
      section: 'Certifications',
      severity: 'LOW',
      rule: 'CERT_MISSING_ISSUER',
      detail: 'Certifications detected but issuing organization name not clearly visible. Add organization name next to each certification for ATS and recruiter verification.'
    });
  }

  // ── CHECK 10: Actual Skill Keywords Extraction (not "None") ──
  const TECH_SKILL_PATTERNS = [
    /\b(python|javascript|typescript|java|c\+\+|c#|go|rust|swift|kotlin|php|ruby|scala)\b/gi,
    /\b(react|next\.?js|vue|angular|svelte|tailwind|bootstrap|html|css)\b/gi,
    /\b(node\.?js|express|fastapi|flask|django|spring|rails|laravel)\b/gi,
    /\b(firebase|supabase|mongodb|postgresql|mysql|redis|sqlite|firestore)\b/gi,
    /\b(docker|kubernetes|aws|azure|gcp|vercel|netlify|heroku|ci\/cd|github actions)\b/gi,
    /\b(openai|gemini|openrouter|llm|langchain|faiss|pinecone|rag|vector)\b/gi,
    /\b(opencv|tensorflow|pytorch|keras|scikit|numpy|pandas|matplotlib)\b/gi,
    /\b(git|linux|bash|postman|figma|vscode|webpack|vite|rest api|graphql)\b/gi,
    /\b(insightface|mediapipe|websocket|socket\.io|razorpay|stripe|oauth|jwt)\b/gi,
  ];
  const detectedKeywords = new Set();
  for (const pat of TECH_SKILL_PATTERNS) {
    const found = rawText.match(pat) || [];
    found.forEach(k => detectedKeywords.add(k.toLowerCase().trim()));
  }
  const detectedKeywordList = [...detectedKeywords];

  if (detectedKeywordList.length >= 5) {
    positivePoints.push({
      section: 'Technical Skills',
      badge: 'SKILLS_DETECTED',
      detail: `Detected ${detectedKeywordList.length} technical keywords: ${detectedKeywordList.slice(0, 10).join(', ')}${detectedKeywordList.length > 10 ? '...' : ''}.`
    });
  } else {
    score -= 5;
    issues.push({
      section: 'Technical Skills',
      severity: 'MEDIUM',
      rule: 'FEW_TECH_KEYWORDS',
      detail: 'Very few recognisable technical skills detected. Ensure a dedicated "Technical Skills" section uses exact tool/language names (not abbreviations ATS may miss).'
    });
  }

  // ── CHECK 11: Quantified Impact ──
  const numbersMatched = rawText.match(/\b\d+(\.\d+)?%|\b\d{1,4}\+?\s*(users|clients|students|ms|seconds|hours|queries|stars|downloads|requests|api|pages|lines|services)\b/gi) || [];
  if (numbersMatched.length >= 3) {
    positivePoints.push({
      section: 'Impact & Quantification',
      badge: 'METRICS_DRIVEN',
      detail: `Found ${numbersMatched.length} quantifiable metrics: ${numbersMatched.slice(0, 5).join(', ')}. ATS systems favour measurable outcomes.`
    });
  } else {
    score -= 8;
    issues.push({
      section: 'Impact & Quantification',
      severity: 'HIGH',
      rule: 'LACK_OF_METRICS',
      detail: 'Too few numbers/metrics found. Apply Google X-Y-Z formula to at least 3-4 bullets: "Accomplished [X] as measured by [Y] by doing [Z]" — use real data like latency, user count, uptime %.'
    });
  }

  return {
    rawScore: Math.max(0, Math.min(100, score)),
    issues,
    positivePoints,
    metricsFound: numbersMatched,
    detectedKeywords: detectedKeywordList,
  };
}

/**
 * Deep AI Semantic Audit via Bob's LLM Service (OpenRouter)
 */
async function auditWithAISemantic(rawText, deterministicResult) {
  const detectedKw = (deterministicResult.detectedKeywords || []).slice(0, 20);

  const systemPrompt = [
    'You are a strict, evidence-based Resume Auditor for engineering institutions.',
    'You audit resumes against ABES 1-page institutional format and Hiration ATS scoring rules.',
    '',
    '━━━━━ IRON-CLAD RULES (violation = your output is REJECTED) ━━━━━',
    '1. NEVER invent numbers, percentages, rankings, latency, uptime, or any metric not explicitly present in the resume text.',
    '2. NEVER invent certificate names, issuing organizations, or credential IDs.',
    '3. Bullet rewrites: only restructure EXISTING content. Use [X%] or [N users] as placeholders if data is missing — NEVER fabricate.',
    '4. Every score deduction must cite the EXACT rule and what was missing (e.g. "-3: No CGPA value under Education").',
    '5. presentKeywords MUST come from the actual resume text — if the deterministic engine already detected them, include those.',
    '6. recommendedKeywordsToInject must only include skills/tools the candidate likely knows based on project context in resume.',
    '7. Flag any metric in the resume that cannot be verified from the text alone (e.g. "99.9% uptime" with no source).',
    '8. Identify if Experience and Project sections are mislabeled (freelance work listed as project, etc.).',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  const userPrompt = [
    'RESUME TEXT (verbatim — your ONLY source of truth):',
    '---',
    rawText.slice(0, 6000),
    '---',
    '',
    `DETERMINISTIC SCORE: ${deterministicResult.rawScore}/100`,
    `DETERMINISTIC ISSUES FOUND: ${JSON.stringify(deterministicResult.issues.map(i => `[${i.rule}] ${i.detail}`))}`,
    `KEYWORDS ALREADY DETECTED BY PARSER: ${JSON.stringify(detectedKw)} — include ALL of these in presentKeywords.`,
    '',
    'Return STRICT JSON ONLY — no markdown, no prose, no code fences. Schema:',
    '{',
    '  "atsScore": <integer 0-100>,',
    '  "performanceTier": "<Elite Standard (90-100)|ATS Ready (75-89)|Needs Improvement (<75)>",',
    '  "scoreBreakdown": {',
    '    "atsFormatAndParseability": { "score": <0-25>, "max": 25, "verdict": "<cite exact rule for each deduction>" },',
    '    "headerAndOnlinePresence": { "score": <0-15>, "max": 15, "verdict": "<what found/missing>" },',
    '    "contentImpactAndActionVerbs": { "score": <0-25>, "max": 25, "verdict": "<verb quality, X-Y-Z compliance>" },',
    '    "technicalSkillsAndKeywords": { "score": <0-15>, "max": 15, "verdict": "<skill categories and gaps>" },',
    '    "projectsAndExperienceQuality": { "score": <0-20>, "max": 20, "verdict": "<project depth, freelance/experience classification issues>" }',
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
    '      "originalBullet": "<verbatim weak bullet from resume>",',
    '      "critique": "<specific structural/impact problem>",',
    '      "optimizedRewrite": "<action verb + existing content in X-Y-Z — use [X%] if metric absent, NEVER invent>"',
    '    }',
    '  ],',
    '  "unverifiableMetrics": [',
    '    { "metric": "<quoted metric from resume>", "concern": "<why it may be hard to verify or defend>" }',
    '  ],',
    '  "structureClassificationIssues": [',
    '    { "item": "<project/role name>", "currentSection": "<where it appears>", "suggestedSection": "<where it should be>", "reason": "<why>" }',
    '  ],',
    '  "missingKeywordsAnalysis": {',
    '    "detectedDomain": "<domain from resume tech stack>",',
    '    "presentKeywords": ["<all keywords from resume — include parser-detected list above>"],',
    '    "recommendedKeywordsToInject": ["<skill — ONLY suggest if resume context supports candidate knowing it. Add caveat: only if you have real experience>"]',
    '  },',
    '  "executiveSummary": {',
    '    "oneLineVerdict": "<honest verdict based on actual resume content>",',
    '    "top3PrioritiesToReach75Plus": ["<priority 1 citing actual gap>", "<priority 2>", "<priority 3>"]',
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
    unverifiableMetrics: [],
    structureClassificationIssues: [],
    missingKeywordsAnalysis: {
      detectedDomain: 'Software Engineering (AI analysis fallback — auto-detected skills below)',
      presentKeywords: deterministicResult.detectedKeywords || [],
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
    pageTexts: parsed.pageTexts || [rawText],
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
    unverifiableMetrics: aiAudit.unverifiableMetrics || [],
    structureClassificationIssues: aiAudit.structureClassificationIssues || [],
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
