const documentReaderService = require('./documentReaderService');
const llmService = require('./llmService');

/**
 * resumeAuditEngine.js
 * 
 * Deep Institutional & ATS-compliant Resume Audit Engine.
 * Built strictly according to ABES Institutional Format & ATS Optimization Guidelines:
 * - 1-Page Constraint & Layout Geometry
 * - Strict Section Classification & Heading Disambiguation (Education vs Certifications)
 * - Garbled Text / Corrupted Font Encoding Sanity Audit
 * - Transparent Itemized Point-Deduction Math in Category Breakdowns
 * - PDF Hyperlink / URI Annotation Audit
 * - Duplicate Bullet / Concept Repetition Analysis (Jaccard similarity > 65%)
 * - Project Timeline Sanity Check (Month/Year recency)
 * - Deep AI Semantic Diagnostics via OpenRouter LLM Pool
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
 * Helper: Detect garbled text / broken font glyphs from PDF extraction
 */
function detectGarbledText(rawText, lines) {
  const brokenQuotesPattern = /['`"´’‘][A-Za-z0-9]{1,3}[>~\\^<]+|['`"´’‘][>~\\^<]{2,}/g;
  const symbolGluedPattern = /(?:[\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF\u00A4\u00A6\u00A7\u00A9\u00AE\u2122]+[A-Za-z0-9]+|[A-Za-z0-9]+[\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF\u00A4\u00A6\u00A7\u00A9\u00AE\u2122]+)/gu;
  const mojibakePattern = /[\uFFFD]|[\x00-\x08\x0E-\x1F\x7F-\x9F]|[\u00C0-\u00FF]{4,}/g;

  const foundSnippets = new Set();
  lines.forEach(l => {
    const trimmed = l.trim();
    if (!trimmed) return;
    const bq = trimmed.match(brokenQuotesPattern) || [];
    const sg = trimmed.match(symbolGluedPattern) || [];
    const mb = trimmed.match(mojibakePattern) || [];
    [...bq, ...sg, ...mb].forEach(s => foundSnippets.add(s.trim()));
  });

  return [...foundSnippets].filter(Boolean);
}

/**
 * Helper: Segment lines into standardized top-level resume sections
 */
function parseResumeSections(lines) {
  const KNOWN_HEADINGS = [
    { type: 'SUMMARY', regex: /^(summary|professional summary|career objective|objective)$/i },
    { type: 'TECHNICAL_SKILLS', regex: /^(technical skills|skills|technologies|core competencies|areas of expertise)$/i },
    { type: 'PROJECTS', regex: /^(projects|academic projects|key projects|personal projects)$/i },
    { type: 'EXPERIENCE', regex: /^(experience|work experience|employment history|internships|professional experience)$/i },
    { type: 'EDUCATION', regex: /^(education|academic qualifications|academics|scholastic qualifications)$/i },
    { type: 'CERTIFICATIONS_AND_ACADEMICS', regex: /^(certifications?\s*(&|and)\s*academics?)$/i },
    { type: 'CERTIFICATIONS', regex: /^(certifications?|licenses?(\s*(&|and)\s*certifications?)?)$/i },
    { type: 'ACHIEVEMENTS', regex: /^(achievements|honors?(\s*(&|and)\s*awards?)?|accomplishments)$/i },
    { type: 'PUBLICATIONS', regex: /^(publications|research papers)$/i },
    { type: 'DECLARATION', regex: /^(declaration)$/i }
  ];

  const sections = { HEADER: { heading: 'HEADER', lines: [] } };
  let currentKey = 'HEADER';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line is a section heading (short line, matches known section regex)
    let matchedHeading = null;
    if (trimmed.length < 50) {
      for (const h of KNOWN_HEADINGS) {
        if (h.regex.test(trimmed)) {
          matchedHeading = h;
          break;
        }
      }
    }

    if (matchedHeading) {
      currentKey = matchedHeading.type;
      if (!sections[currentKey]) {
        sections[currentKey] = { heading: trimmed, lines: [] };
      }
    } else {
      if (!sections[currentKey]) {
        sections[currentKey] = { heading: currentKey, lines: [] };
      }
      sections[currentKey].lines.push(trimmed);
    }
  }

  return sections;
}

/**
 * Helper: Tokenize text into words and 2-grams for Jaccard similarity
 */
function tokenizeForSimilarity(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  
  const wordSet = new Set(words);
  const bigramSet = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    bigramSet.add(`${words[i]} ${words[i + 1]}`);
  }
  return { wordSet, bigramSet };
}

function calculateJaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : (intersection / union);
}

/**
 * Deterministic Section & Formatting Rule Checker
 */
function analyzeDeterministicRules(rawText, metadata = {}) {
  const issues = [];
  const positivePoints = [];

  const lower = rawText.toLowerCase();
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // Categorized deductions for transparent breakdown math
  const deductionsByCategory = {
    atsFormatAndParseability: [],
    headerAndOnlinePresence: [],
    contentImpactAndActionVerbs: [],
    technicalSkillsAndKeywords: [],
    projectsAndExperienceQuality: []
  };

  function addDeduction(category, points, reason) {
    deductionsByCategory[category].push({ points: -Math.abs(points), reason });
  }

  // ── CHECK 0: Garbled Text / Broken Font Encoding Detector ──
  const garbledSnippets = detectGarbledText(rawText, lines);
  if (garbledSnippets.length > 0) {
    const quoted = garbledSnippets.slice(0, 3).map(s => `"${s}"`).join(', ');
    addDeduction('atsFormatAndParseability', 5, `Garbled font encoding detected (${quoted}) — re-export PDF from Word/LaTeX to fix broken glyphs`);
    issues.push({
      section: 'ATS Format & Geometry',
      severity: 'HIGH',
      rule: 'GARBLED_TEXT_DETECTED',
      deduction: 5,
      snippet: quoted,
      detail: `[-5 pts] PDF font encoding corruption detected (${quoted}). ATS parsers and recruiters will see broken glyphs. Fix: Re-export the PDF using standard Unicode fonts.`
    });
  } else {
    positivePoints.push({
      section: 'ATS Format & Geometry',
      badge: 'CLEAN_PDF_ENCODING',
      detail: 'Clean character encoding — no mojibake, orphaned glyphs, or corrupted font symbols detected.'
    });
  }

  // ── CHECK 1: Page Budget & Page 2 Line Count Bug Fix ──
  const pageCount = metadata.pageCount || 1;
  const pageTexts = metadata.pageTexts || [rawText];

  if (pageCount === 1) {
    positivePoints.push({
      section: 'ATS Format & Geometry',
      badge: 'STRICT_1_PAGE',
      detail: 'Optimal 1-page budget verified — conforms to ABES institutional & early career engineering standards.'
    });
  } else if (pageCount > 1) {
    const page2Text = (pageTexts[1] || '').trim();
    const page2NonEmptyLines = page2Text.split('\n').map(l => l.trim()).filter(Boolean);
    const lineCount = page2NonEmptyLines.length;
    const wordCount = (page2Text.match(/\S+/g) || []).length;
    const isNearlyEmpty = lineCount <= 2;

    addDeduction('atsFormatAndParseability', 15, `Resume spills onto Page 2 with ${lineCount} lines (${wordCount} words) — strictly 1 page required for UG`);
    issues.push({
      section: 'ATS Format & Geometry',
      severity: 'HIGH',
      rule: '1_PAGE_BUDGET',
      deduction: 15,
      detail: isNearlyEmpty
        ? `[-15 pts] Resume spills onto Page 2 with only ${lineCount} lines (${wordCount} words) — it is nearly empty. Tighten margins (0.5 inch), reduce body text to 10pt, and fit entirely on Page 1.`
        : `[-15 pts] Resume spans ${pageCount} pages (Page 2 has ${lineCount} lines, ${wordCount} words). UG engineering resumes must be strictly 1 page.`
    });
  }

  // ── CHECK 2: Forbidden Header "Resume" / "CV" ──
  const first5Lines = lines.slice(0, 5).join(' ').toLowerCase();
  if (/^(resume|curriculum vitae|cv)(\b|\:)/i.test(first5Lines) || first5Lines.includes('curriculum vitae')) {
    addDeduction('atsFormatAndParseability', 6, 'Forbidden "Resume" / "CV" title header wastes top margin space');
    issues.push({
      section: 'ATS Format & Geometry',
      severity: 'MEDIUM',
      rule: 'NO_RESUME_TITLE',
      deduction: 6,
      detail: '[-6 pts] Remove header title "Resume" / "CV". Candidate name should be the top-level bold heading.'
    });
  } else {
    positivePoints.push({
      section: 'ATS Format & Geometry',
      badge: 'CLEAN_TITLE',
      detail: 'No redundant "Resume/CV" title wasting top margin.'
    });
  }

  // ── CHECK 3: Declaration ──
  if (lower.includes('hereby declare') || lower.includes('declaration')) {
    addDeduction('atsFormatAndParseability', 10, 'Obsolete Declaration section ("I hereby declare...") present');
    issues.push({
      section: 'ATS Format & Geometry',
      severity: 'HIGH',
      rule: 'NO_DECLARATION',
      deduction: 10,
      detail: '[-10 pts] Declaration statement ("I hereby declare...") is obsolete in modern ATS standards. Delete this section entirely.'
    });
  }

  // ── CHECK 4: Summary / Career Objective for UG ──
  if (/\b(career objective|objective:|summary)\b/i.test(lower)) {
    addDeduction('atsFormatAndParseability', 5, 'Summary/Objective present (prohibited for UG engineering resumes)');
    issues.push({
      section: 'ATS Format & Geometry',
      severity: 'MEDIUM',
      rule: 'NO_SUMMARY_FOR_UG',
      deduction: 5,
      detail: '[-5 pts] Summary/Objective section is discouraged for UG engineering resumes (ABES PPT Guideline: use only for PG/5yr+ experience). Replace with project bullet.'
    });
  }

  // ── CHECK 5: Section Classification & Disambiguation (EDUCATION vs CERTIFICATIONS) ──
  const sections = parseResumeSections(lines);
  const educationSection = sections['EDUCATION'];
  const certAcademicsSection = sections['CERTIFICATIONS_AND_ACADEMICS'];
  const certSection = sections['CERTIFICATIONS'];

  // Academic entity detection
  const ACADEMIC_ENTITY_REGEX = /\b(b\.?tech|bachelor|b\.?e\.?|m\.?tech|diploma|cbse|aktu|university|college|cgpa|gpa|percentage|%|xii|x\b|12th|10th)\b/i;

  const hasEducationHeading = Boolean(educationSection);
  const educationText = educationSection ? educationSection.lines.join(' ') : '';
  const certAcademicsText = certAcademicsSection ? certAcademicsSection.lines.join(' ') : '';

  const educationHasAcademicEntities = ACADEMIC_ENTITY_REGEX.test(educationText);
  const certAcademicsHasAcademicEntities = ACADEMIC_ENTITY_REGEX.test(certAcademicsText);

  // Check degree details in the designated education text (or anywhere if section exists)
  const fullAcademicPool = `${educationText} ${certAcademicsText}`;
  const hasDegreeName = /\b(b\.?tech|bachelor|b\.?e\.?|diploma|m\.?tech)\b/i.test(fullAcademicPool);
  const hasInstitution = /\b(college|university|institute|aktu|school)\b/i.test(fullAcademicPool);
  const hasCGPA = /\b(cgpa|gpa|percentage|%)\b/i.test(fullAcademicPool);
  const hasGradYear = /\b(20(2[0-9]|[3-9]\d)|passing year|graduated|batch)\b/i.test(fullAcademicPool);

  if (certAcademicsSection && !educationSection && !certAcademicsHasAcademicEntities) {
    // Specifically clubbed under "Certifications & Academics" without degree details
    addDeduction('projectsAndExperienceQuality', 10, 'Dedicated Education section missing (found "Certifications & Academics" without degree/institution/CGPA)');
    issues.push({
      section: 'Projects & Quantified Outcomes',
      severity: 'HIGH',
      rule: 'CLUBBED_EDUCATION_NO_DETAILS',
      deduction: 10,
      detail: '[-10 pts] Dedicated Education section is missing (found \'Certifications & Academics\' header without degree, institution, or CGPA details).'
    });
  } else if (!hasEducationHeading && !certAcademicsSection) {
    addDeduction('projectsAndExperienceQuality', 10, 'Missing mandatory Education section (Degree, College, CGPA/%, Year)');
    issues.push({
      section: 'Projects & Quantified Outcomes',
      severity: 'HIGH',
      rule: 'MISSING_EDUCATION_SECTION',
      deduction: 10,
      detail: '[-10 pts] CRITICAL: No Education section found. College recruiters and ATS require: Degree (B.Tech CSE/ECE), Institution name, University (AKTU), CGPA/%, and Passing Year.'
    });
  } else if (!hasDegreeName || !hasInstitution || !hasCGPA || !hasGradYear) {
    const missing = [];
    if (!hasDegreeName) missing.push('Degree (e.g. B.Tech CSE)');
    if (!hasInstitution) missing.push('Institution / University');
    if (!hasCGPA) missing.push('CGPA or Percentage');
    if (!hasGradYear) missing.push('Passing Year');

    addDeduction('projectsAndExperienceQuality', 6, `Education details incomplete: missing ${missing.join(', ')}`);
    issues.push({
      section: 'Projects & Quantified Outcomes',
      severity: 'HIGH',
      rule: 'INCOMPLETE_EDUCATION_DETAILS',
      deduction: 6,
      detail: `[-6 pts] Education section is missing critical details: ${missing.join(' | ')}. Required: Degree, Institution, CGPA, and Passing Year.`
    });
  } else {
    positivePoints.push({
      section: 'Education',
      badge: 'EDUCATION_COMPLETE',
      detail: 'Education section with degree, institution, CGPA and passing year detected.'
    });
  }

  // ── CHECK 6: Sensitive Personal Info ──
  const sensitiveItems = [];
  if (/\b(dob|date of birth)\b/i.test(lower)) sensitiveItems.push('Date of Birth');
  if (/\b(father'?s? name|mother'?s? name)\b/i.test(lower)) sensitiveItems.push("Father's/Mother's Name");
  if (/\b(nationality|marital status|religion)\b/i.test(lower)) sensitiveItems.push('Nationality/Marital Status');
  if (/\b(permanent address|pin code|pincode)\b/i.test(lower)) sensitiveItems.push('Full Postal Address');

  if (sensitiveItems.length > 0) {
    const pts = Math.min(10, sensitiveItems.length * 3);
    addDeduction('headerAndOnlinePresence', pts, `Sensitive personal info detected (${sensitiveItems.join(', ')})`);
    issues.push({
      section: 'Header & Contact Footprint',
      severity: 'HIGH',
      rule: 'NO_SENSITIVE_DATA',
      deduction: pts,
      detail: `[-${pts} pts] Remove sensitive personal info: ${sensitiveItems.join(', ')}. Keep only City, State, Phone, Email, and URLs.`
    });
  } else {
    positivePoints.push({
      section: 'Header & Contact Footprint',
      badge: 'PROFESSIONAL_CONTACT_ONLY',
      detail: 'Clean contact footprint — no invasive personal details (DOB, marital status, full address).'
    });
  }

  // ── CHECK 7: Contact & Professional Links ──
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(rawText);
  const hasPhone = /(\+91[\-\s]?)?[6-9]\d{9}/.test(rawText) || /\b\d{10}\b/.test(rawText);
  const hasLinkedIn = /linkedin\.com/i.test(rawText) || lower.includes('linkedin');
  const hasGitHub = /github\.com/i.test(rawText) || lower.includes('github');
  const hasPortfolioOrDemo = lower.includes('.vercel.app') || lower.includes('.netlify.app') || lower.includes('live demo') || lower.includes('portfolio') || /https?:\/\/[^\s]+\.(com|app|io|dev)/i.test(rawText);

  if (!hasEmail) {
    addDeduction('headerAndOnlinePresence', 5, 'Professional email address missing or unparseable');
    issues.push({ section: 'Header & Contact Footprint', severity: 'HIGH', rule: 'MISSING_EMAIL', deduction: 5, detail: '[-5 pts] Professional email address is missing or not parseable from the PDF.' });
  }
  if (!hasPhone) {
    addDeduction('headerAndOnlinePresence', 4, 'Contact phone number missing');
    issues.push({ section: 'Header & Contact Footprint', severity: 'HIGH', rule: 'MISSING_PHONE', deduction: 4, detail: '[-4 pts] Contact phone number is missing.' });
  }
  if (!hasLinkedIn) {
    addDeduction('headerAndOnlinePresence', 3, 'LinkedIn profile URL missing');
    issues.push({ section: 'Header & Contact Footprint', severity: 'MEDIUM', rule: 'MISSING_LINKEDIN', deduction: 3, detail: '[-3 pts] No LinkedIn profile link found. Add: linkedin.com/in/username for recruiter verification.' });
  } else {
    positivePoints.push({ section: 'Header & Contact Footprint', badge: 'LINKEDIN_PRESENT', detail: 'LinkedIn profile link detected.' });
  }
  if (!hasGitHub) {
    addDeduction('headerAndOnlinePresence', 3, 'GitHub profile URL missing');
    issues.push({ section: 'Header & Contact Footprint', severity: 'MEDIUM', rule: 'MISSING_GITHUB', deduction: 3, detail: '[-3 pts] GitHub link missing. Crucial for developer shortlisting — add github.com/username.' });
  } else {
    positivePoints.push({ section: 'Header & Contact Footprint', badge: 'GITHUB_LINKED', detail: 'GitHub proof-of-work link detected.' });
  }

  // ── CHECK 7B: PDF Hyperlink / URI Annotation Audit ──
  const extractedLinks = (metadata.links || []).map(l => String(l).toLowerCase());
  const deployedUrlMatches = rawText.match(/\bhttps?:\/\/[^\s]+|[\w-]+\.(?:vercel\.app|netlify\.app|github\.io|dev|app)\b/gi) || [];
  const plainTextUrlsWithoutAnnotation = [];

  for (const urlText of deployedUrlMatches) {
    const clean = urlText.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const isAnnotated = extractedLinks.some(link => link.includes(clean));
    if (!isAnnotated) {
      plainTextUrlsWithoutAnnotation.push(urlText);
    }
  }

  if (plainTextUrlsWithoutAnnotation.length > 0) {
    const sample = plainTextUrlsWithoutAnnotation.slice(0, 2).join(', ');
    addDeduction('headerAndOnlinePresence', 2, `URLs written as plain text without clickable PDF URI annotations (${sample})`);
    issues.push({
      section: 'Header & Contact Footprint',
      severity: 'MEDIUM',
      rule: 'UNCLICKABLE_URL_ANNOTATIONS',
      deduction: 2,
      snippet: sample,
      detail: `[-2 pts] Deployed URL(s) appear as plain unlinked text without embedded PDF URI annotations: ${sample}. Recruiters reading PDFs cannot click them directly.`
    });
  } else if (hasPortfolioOrDemo && extractedLinks.length > 0) {
    positivePoints.push({
      section: 'Header & Contact Footprint',
      badge: 'CLICKABLE_PDF_HYPERLINKS',
      detail: `Verified ${extractedLinks.length} clickable PDF hyperlink annotations for repos and live deployments.`
    });
  }

  // ── CHECK 8: Soft Skills ──
  const detectedSoftSkills = FORBIDDEN_SOFT_SKILLS.filter(s => lower.includes(s));
  if (detectedSoftSkills.length > 0) {
    const pts = Math.min(6, detectedSoftSkills.length * 2);
    addDeduction('technicalSkillsAndKeywords', pts, `Generic soft skills detected (${detectedSoftSkills.join(', ')})`);
    issues.push({
      section: 'Hard Skills & Category Groups',
      severity: 'MEDIUM',
      rule: 'NO_SOFT_SKILLS_IN_RESUME',
      deduction: pts,
      snippet: detectedSoftSkills.join(', '),
      detail: `[-${pts} pts] Remove generic soft skills: (${detectedSoftSkills.join(', ')}). Replace with technical proficiencies or show traits inside project impact.`
    });
  }

  // ── CHECK 9: Certification Quality ──
  const certIncomplete = lower.includes('aws certificate') || lower.includes('prompting_certificate') || /certificate\s*\(verified/i.test(lower);
  const certMissingOrg = /\bcertif(icate|ication)\b/i.test(lower) && !/\b(amazon|google|microsoft|meta|coursera|udemy|nptel|aws|azure|ibm|oracle|cisco)\b/i.test(lower);
  if (certIncomplete) {
    addDeduction('technicalSkillsAndKeywords', 3, 'Incomplete/placeholder certification titles found (e.g. "aws certificate")');
    issues.push({
      section: 'Hard Skills & Category Groups',
      severity: 'MEDIUM',
      rule: 'GENERIC_CERT_NAME',
      deduction: 3,
      detail: '[-3 pts] One or more certifications use placeholder names (e.g. "aws certificate", "prompting_certificate"). Use: [Official Title] | [Issuing Org] | [Date].'
    });
  } else if (certMissingOrg) {
    issues.push({
      section: 'Hard Skills & Category Groups',
      severity: 'LOW',
      rule: 'CERT_MISSING_ISSUER',
      deduction: 0,
      detail: 'Certifications detected without clear issuing organizations. Mention official provider (AWS, Google, Meta) next to each.'
    });
  }

  // ── CHECK 10: Technical Skills Keywords Extraction ──
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

  if (detectedKeywordList.length >= 6) {
    positivePoints.push({
      section: 'Hard Skills & Category Groups',
      badge: 'SKILLS_DETECTED',
      detail: `Detected ${detectedKeywordList.length} hard technical keywords: ${detectedKeywordList.slice(0, 8).join(', ')}...`
    });
  } else {
    addDeduction('technicalSkillsAndKeywords', 4, 'Very few recognizable technical tools/frameworks detected');
    issues.push({
      section: 'Hard Skills & Category Groups',
      severity: 'MEDIUM',
      rule: 'FEW_TECH_KEYWORDS',
      deduction: 4,
      detail: '[-4 pts] Very few recognizable technical skills detected. Group skills into Languages, Frameworks, Developer Tools, and Core Concepts.'
    });
  }

  // ── CHECK 11: Quantified Impact & Action Verbs ──
  const numbersMatched = rawText.match(/\b\d+(\.\d+)?%|\b\d{1,4}\+?\s*(users|clients|students|ms|seconds|hours|queries|stars|downloads|requests|api|pages|lines|services)\b/gi) || [];
  if (numbersMatched.length >= 3) {
    positivePoints.push({
      section: 'Action Verbs & Google X-Y-Z',
      badge: 'METRICS_DRIVEN',
      detail: `Found ${numbersMatched.length} quantifiable metrics (${numbersMatched.slice(0, 4).join(', ')}). ATS systems prioritize measurable impact.`
    });
  } else {
    addDeduction('contentImpactAndActionVerbs', 8, 'Too few quantified metrics (X-Y-Z formula: Accomplished [X] as measured by [Y] by doing [Z])');
    issues.push({
      section: 'Action Verbs & Google X-Y-Z',
      severity: 'HIGH',
      rule: 'LACK_OF_METRICS',
      deduction: 8,
      detail: '[-8 pts] Insufficient quantifiable numbers/metrics. Apply Google X-Y-Z formula: "Accomplished [X] measured by [Y] by doing [Z]" (latency ms, % savings, user counts).'
    });
  }

  // ── CHECK 12: Duplicate Bullet / Concept Repetition Check (Jaccard > 65%) ──
  const bulletLines = lines.filter(l => /^[•\-\*]\s+/i.test(l) || l.startsWith('•') || l.startsWith('-'));
  const duplicatePairs = [];
  const tokenizedBullets = bulletLines.map(b => ({
    raw: b,
    tokens: tokenizeForSimilarity(b)
  }));

  for (let i = 0; i < tokenizedBullets.length; i++) {
    for (let j = i + 1; j < tokenizedBullets.length; j++) {
      const b1 = tokenizedBullets[i];
      const b2 = tokenizedBullets[j];
      const wordSim = calculateJaccard(b1.tokens.wordSet, b2.tokens.wordSet);
      if (wordSim >= 0.65) {
        duplicatePairs.push({
          sim: Math.round(wordSim * 100),
          snippet1: b1.raw.slice(0, 60),
          snippet2: b2.raw.slice(0, 60)
        });
      }
    }
  }

  if (duplicatePairs.length > 0) {
    const pair = duplicatePairs[0];
    addDeduction('contentImpactAndActionVerbs', 4, `Duplicate/repetitive concept across bullets (${pair.sim}% similarity)`);
    issues.push({
      section: 'Action Verbs & Google X-Y-Z',
      severity: 'MEDIUM',
      rule: 'DUPLICATE_BULLET_CONCEPT',
      deduction: 4,
      snippet: `"${pair.snippet1}..." vs "${pair.snippet2}..."`,
      detail: `[-4 pts] Duplicate concept/bullet text detected (${pair.sim}% overlap): "${pair.snippet1}..." vs "${pair.snippet2}...". Diversify descriptions across projects.`
    });
  }

  // ── CHECK 13: Project Timeline Sanity Check ──
  const projectSection = sections['PROJECTS'];
  if (projectSection && projectSection.lines.length > 0) {
    const projLines = projectSection.lines;
    const dateRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*20\d{2}|20(2[0-9]|[3-9]\d)\b/i;
    const hasProjectDates = projLines.some(l => dateRegex.test(l));

    if (!hasProjectDates) {
      addDeduction('projectsAndExperienceQuality', 4, 'Project dates missing — add Month/Year range to establish recency');
      issues.push({
        section: 'Projects & Quantified Outcomes',
        severity: 'MEDIUM',
        rule: 'MISSING_PROJECT_TIMELINES',
        deduction: 4,
        detail: '[-4 pts] Project dates missing — add Month/Year range to establish recency and chronological context.'
      });
    } else {
      positivePoints.push({
        section: 'Projects & Quantified Outcomes',
        badge: 'PROJECT_TIMELINES_PRESENT',
        detail: 'Project timelines (Month/Year) detected — establishes recency for recruiters.'
      });
    }
  }

  // Compute category scores with transparent deduction math
  const maxByCategory = {
    atsFormatAndParseability: 25,
    headerAndOnlinePresence: 15,
    contentImpactAndActionVerbs: 25,
    technicalSkillsAndKeywords: 15,
    projectsAndExperienceQuality: 20
  };

  const calculatedBreakdown = {};
  let totalScore = 0;

  for (const [cat, maxPts] of Object.entries(maxByCategory)) {
    const deductions = deductionsByCategory[cat];
    const totalDeducted = deductions.reduce((sum, d) => sum + Math.abs(d.points), 0);
    const catScore = Math.max(0, maxPts - totalDeducted);
    totalScore += catScore;

    calculatedBreakdown[cat] = {
      score: catScore,
      max: maxPts,
      deductions: deductions.map(d => ({ points: d.points, reason: d.reason })),
      verdict: deductions.length > 0
        ? deductions.map(d => `[${d.points} pts] ${d.reason}`).join(' | ')
        : 'Fully compliant with institutional and ATS guidelines.'
    };
  }

  return {
    rawScore: Math.max(0, Math.min(100, totalScore)),
    issues,
    positivePoints,
    metricsFound: numbersMatched,
    detectedKeywords: detectedKeywordList,
    calculatedBreakdown
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
    '1. Top 3 Priorities: Strictly 1 punchy line per priority (MAX 15 words each). Never write paragraph text here.',
    '2. Section-by-Section Deep Audit: Keep mistakesAndGaps (what is wrong + exact quote from resume) COMPLETELY SEPARATE from actionableAdvice (step-by-step fix instruction). NEVER repeat identical text in both fields.',
    '3. Bullet rewrites: only restructure EXISTING content. Use [X%] or [N users] as placeholders if data is missing — NEVER fabricate metrics.',
    '4. presentKeywords MUST come from the actual resume text — include keywords detected by parser.',
    '5. recommendedKeywordsToInject must only include skills/tools candidate likely knows based on project context.',
    '6. NEVER hallucinate certificates or degree details.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  const userPrompt = [
    'RESUME TEXT (verbatim — your ONLY source of truth):',
    '---',
    rawText.slice(0, 6000),
    '---',
    '',
    `DETERMINISTIC SCORE: ${deterministicResult.rawScore}/100`,
    `DETERMINISTIC ISSUES: ${JSON.stringify(deterministicResult.issues.map(i => `[${i.rule}] ${i.detail}`))}`,
    `KEYWORDS DETECTED: ${JSON.stringify(detectedKw)}`,
    '',
    'Return STRICT JSON ONLY — schema:',
    '{',
    '  "bulletPointAudits": [',
    '    {',
    '      "originalBullet": "<verbatim weak bullet from resume>",',
    '      "critique": "<concise structural/impact problem>",',
    '      "optimizedRewrite": "<action verb + existing content in X-Y-Z — use [X%] if metric absent>"',
    '    }',
    '  ],',
    '  "unverifiableMetrics": [',
    '    { "metric": "<quoted metric from resume>", "concern": "<why it may be hard to defend in interview>" }',
    '  ],',
    '  "structureClassificationIssues": [',
    '    { "item": "<project/role name>", "currentSection": "<where it appears>", "suggestedSection": "<where it should be>", "reason": "<why>" }',
    '  ],',
    '  "missingKeywordsAnalysis": {',
    '    "detectedDomain": "<domain from resume tech stack>",',
    '    "presentKeywords": ["<keywords from resume>"],',
    '    "recommendedKeywordsToInject": ["<skill with real context>"]',
    '  },',
    '  "executiveSummary": {',
    '    "oneLineVerdict": "<honest 1-sentence verdict based on resume content>",',
    '    "top3PrioritiesToReach75Plus": [',
    '      "<Priority 1: max 15 words>",',
    '      "<Priority 2: max 15 words>",',
    '      "<Priority 3: max 15 words>"',
    '    ]',
    '  },',
    '  "sectionsAudited": [',
    '    {',
    '      "sectionName": "<exact section name>",',
    '      "status": "<EXCELLENT|GOOD|NEEDS_IMPROVEMENT|CRITICAL_ERROR>",',
    '      "plusPoints": ["<specific strong aspect>"],',
    '      "mistakesAndGaps": ["<exact flaw citing quote from resume — distinct from action>"],',
    '      "actionableAdvice": "<concrete step-by-step fix instruction — distinct from flaw>"',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  try {
    const response = await llmService.callLLM({
      role: 'resume',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.05,
      maxTokens: 4096,
    });

    const rawOutput = (response && response.text) ? response.text : String(response || '');
    const cleanText = rawOutput
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleanText);
    if (parsed) {
      console.log(`[resumeAuditEngine] AI audit complete. Model: ${response.model}`);
      return parsed;
    }
  } catch (err) {
    console.error('[resumeAuditEngine] AI semantic analysis error:', err.message);
  }

  // Fallback: strictly deduplicated, concise
  return {
    bulletPointAudits: [],
    unverifiableMetrics: [],
    structureClassificationIssues: [],
    missingKeywordsAnalysis: {
      detectedDomain: 'Software Engineering (Deterministic Analysis)',
      presentKeywords: deterministicResult.detectedKeywords || [],
      recommendedKeywordsToInject: []
    },
    executiveSummary: {
      oneLineVerdict: deterministicResult.issues.length
        ? `${deterministicResult.issues.filter(i => i.severity === 'HIGH').length} critical structural issues detected by deterministic engine.`
        : 'Format verified against 1-page single-column rules with zero critical flags.',
      top3PrioritiesToReach75Plus: deterministicResult.issues
        .filter(i => i.severity === 'HIGH')
        .slice(0, 3)
        .map(i => {
          // Punchy summary <= 15 words
          if (i.rule.includes('EDUCATION')) return 'Add dedicated Education section with B.Tech, AKTU, CGPA, and Passing Year.';
          if (i.rule === '1_PAGE_BUDGET') return 'Compress spacing and margins to strictly fit resume on 1 single page.';
          if (i.rule === 'GARBLED_TEXT_DETECTED') return 'Re-export PDF with standard Unicode fonts to eliminate broken font glyphs.';
          if (i.rule === 'LACK_OF_METRICS') return 'Quantify project impact with measurable numbers and % improvements.';
          return `Resolve ${i.section} issue: clean up formatting and institutional compliance.`;
        })
    },
    sectionsAudited: deterministicResult.issues.map(i => ({
      sectionName: i.section,
      status: i.severity === 'HIGH' ? 'CRITICAL_ERROR' : 'NEEDS_IMPROVEMENT',
      plusPoints: [],
      mistakesAndGaps: [i.detail.replace(/^\[-\d+\s*pts\]\s*/i, '')],
      actionableAdvice: `Fix ${i.section}: Update section content according to institutional ATS guidelines.`
    }))
  };
}

/**
 * Main Audit Pipeline
 */
async function auditResume(buffer, originalFilename = 'resume.pdf') {
  if (!buffer || buffer.length === 0) {
    throw new Error('No resume file buffer provided for audit.');
  }

  // 1. Extract text, per-page texts, and embedded PDF hyperlink annotations
  const parsed = await documentReaderService.extractText(buffer, originalFilename);
  const rawText = parsed.text || '';
  if (!rawText.trim()) {
    throw new Error('Unable to extract text from document. Ensure it is not a scanned image PDF.');
  }

  const metadata = {
    pageCount: parsed.pageCount || 1,
    pageTexts: parsed.pageTexts || [rawText],
    links: parsed.links || [],
    fileType: parsed.type || originalFilename.split('.').pop()
  };

  // 2. Deterministic Rule Pass (transparent breakdown math & high-value checks)
  const deterministicResult = analyzeDeterministicRules(rawText, metadata);

  // 3. AI Semantic Pass
  const aiAudit = await auditWithAISemantic(rawText, deterministicResult);

  // 4. Score Calculation
  // Ground truth score is based directly on transparent deterministic rubric
  const overallAtsScore = deterministicResult.rawScore;
  const isCompliant = overallAtsScore >= 75 && !deterministicResult.issues.some(i => i.severity === 'HIGH');
  const performanceTier = overallAtsScore >= 85 ? 'Elite Standard (90-100)' :
    overallAtsScore >= 75 ? 'ATS Ready (75-89)' : 'Needs Improvement (<75)';

  // Build clean top 3 priorities (strictly 1 line <= 15 words)
  let top3Priorities = (aiAudit.executiveSummary && aiAudit.executiveSummary.top3PrioritiesToReach75Plus) || [];
  if (!top3Priorities.length || top3Priorities.some(p => p.length > 120)) {
    top3Priorities = deterministicResult.issues
      .filter(i => i.severity === 'HIGH' || i.severity === 'MEDIUM')
      .slice(0, 3)
      .map(i => {
        if (i.rule.includes('EDUCATION')) return 'Add dedicated Education section with B.Tech, AKTU, CGPA, and Passing Year.';
        if (i.rule === '1_PAGE_BUDGET') return 'Compress spacing and margins to strictly fit resume on 1 single page.';
        if (i.rule === 'GARBLED_TEXT_DETECTED') return 'Re-export PDF with standard Unicode fonts to eliminate broken font glyphs.';
        if (i.rule === 'LACK_OF_METRICS') return 'Quantify project impact with measurable numbers and % improvements.';
        if (i.rule === 'UNCLICKABLE_URL_ANNOTATIONS') return 'Add clickable PDF link annotations to deployed web app URLs.';
        if (i.rule === 'DUPLICATE_BULLET_CONCEPT') return 'Diversify project descriptions to eliminate duplicate concept phrasing.';
        return `Fix ${i.section} issue to align with ATS standards.`;
      });
  }

  // Deduplicate sectionsAudited to prevent identical Gaps and Action strings
  const cleanedSectionsAudited = (aiAudit.sectionsAudited || []).map(s => {
    let advice = s.actionableAdvice || '';
    const gaps = s.mistakesAndGaps || [];
    if (gaps.length > 0 && advice === gaps[0]) {
      advice = `Restructure the ${s.sectionName} section: follow standard institutional hierarchy and clean metrics.`;
    }
    return {
      sectionName: s.sectionName,
      status: s.status,
      plusPoints: s.plusPoints || [],
      mistakesAndGaps: gaps,
      actionableAdvice: advice
    };
  });

  return {
    success: true,
    filename: originalFilename,
    pageCount: metadata.pageCount,
    overallAtsScore,
    targetScore: 75,
    isAtsCompliant: isCompliant,
    performanceTier,
    scoreBreakdown: deterministicResult.calculatedBreakdown,
    deterministicIssues: deterministicResult.issues,
    positivePoints: deterministicResult.positivePoints,
    sectionsAudited: cleanedSectionsAudited,
    bulletPointAudits: aiAudit.bulletPointAudits || [],
    unverifiableMetrics: aiAudit.unverifiableMetrics || [],
    structureClassificationIssues: aiAudit.structureClassificationIssues || [],
    missingKeywordsAnalysis: aiAudit.missingKeywordsAnalysis || {},
    executiveSummary: {
      oneLineVerdict: (aiAudit.executiveSummary && aiAudit.executiveSummary.oneLineVerdict) || 'Comprehensive Institutional ATS Evaluation Complete',
      top3PrioritiesToReach75Plus: top3Priorities
    }
  };
}

module.exports = {
  auditResume,
  analyzeDeterministicRules,
  STRONG_ACTION_VERBS,
  FORBIDDEN_SOFT_SKILLS
};
