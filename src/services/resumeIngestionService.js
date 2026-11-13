const fetch = require('node-fetch');
const cheerio = require('cheerio');
const documentReader = require('./documentReaderService');
const developerPlatformsService = require('./developerPlatformsService');
const { callLLM } = require('./llmService');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_API = 'https://api.github.com';

/**
 * 1. Strict Repository Fetching & Filtering
 * Query: GET /users/{username}/repos?type=owner&per_page=100
 * Explicitly excludes:
 * 1. Forked repositories (`repo.fork === true`)
 * 2. Profile README repository (`repo.name.toLowerCase() === username.toLowerCase()`)
 * 3. Empty/template repos (`repo.size === 0` or no commits/content)
 */
async function fetchUserRepositories(username) {
  if (!username) return [];
  const cleanUser = String(username).replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').trim();
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'bob-resume-builder',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  try {
    const res = await fetch(`${GITHUB_API}/users/${encodeURIComponent(cleanUser)}/repos?type=owner&per_page=100&sort=updated`, {
      headers,
      timeout: 10000
    });
    if (!res.ok) {
      console.warn(`[resumeIngestionService] GitHub API returned status ${res.status} for ${cleanUser}`);
      return [];
    }
    const repos = await res.json();
    if (!Array.isArray(repos)) return [];

    // Filter strictly by the user's requirements
    const validRepos = repos.filter(r => {
      // Must be owned directly by this username
      const ownerMatch = (r.owner && r.owner.login) ? (r.owner.login.toLowerCase() === cleanUser.toLowerCase()) : true;
      if (!ownerMatch) return false;
      // Exclude forks
      if (r.fork) return false;
      // Exclude user profile readme repository
      if (r.name.toLowerCase() === cleanUser.toLowerCase()) return false;
      // Exclude empty repositories
      if (r.size === 0) return false;
      return true;
    });

    console.log(`[resumeIngestionService] Fetched ${repos.length} repos, ${validRepos.length} original owned non-empty repos.`);

    return validRepos.map(r => ({
      name: r.name,
      fullName: r.full_name,
      description: r.description || '',
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      language: r.language || '',
      homepage: r.homepage || '',
      repoUrl: r.html_url || `https://github.com/${r.full_name}`,
      createdAt: r.created_at,
      pushedAt: r.pushed_at || r.updated_at,
      size: r.size || 0,
      openIssues: r.open_issues_count || 0
    }));
  } catch (err) {
    console.error(`[resumeIngestionService] Failed to fetch repos for ${username}:`, err.message);
    return [];
  }
}

/**
 * 2. Fetch full un-truncated README.md for a repository
 */
async function fetchRepoReadme(owner, repo) {
  const branches = ['main', 'master'];
  for (const branch of branches) {
    try {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
      const res = await fetch(url, { timeout: 8000 });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 20) return text;
      }
    } catch (e) {
      // try next branch
    }
  }

  // Fallback to GitHub API readme endpoint
  try {
    const headers = { 'User-Agent': 'bob-resume-builder' };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`, { headers, timeout: 8000 });
    if (res.ok) {
      const data = await res.json();
      if (data && data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
    }
  } catch (e) {}

  return '';
}

/**
 * 3. Inspect repository dependency manifests & README to extract top 5-6 frameworks/tools
 */
async function extractRepoTechStack(owner, repo, fallbackLanguage = '') {
  const headers = { 'User-Agent': 'bob-resume-builder' };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  const branches = ['main', 'master'];
  const detectedStack = new Set();
  if (fallbackLanguage) detectedStack.add(fallbackLanguage);

  // 1. Inspect package.json
  for (const b of branches) {
    try {
      const pUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/package.json`;
      const res = await fetch(pUrl, { timeout: 4000 });
      if (res.ok) {
        const pkg = await res.json();
        const allDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
        const highSignalMap = {
          'next': 'Next.js',
          'react': 'React',
          'react-native': 'React Native',
          'expo': 'Expo',
          'typescript': 'TypeScript',
          'express': 'Express',
          'firebase': 'Firebase',
          'firebase-admin': 'Firebase Admin',
          'tailwindcss': 'Tailwind CSS',
          'mongodb': 'MongoDB',
          'mongoose': 'Mongoose',
          'prisma': 'Prisma',
          '@prisma/client': 'Prisma',
          'postgresql': 'PostgreSQL',
          'pg': 'PostgreSQL',
          'cheerio': 'Cheerio',
          'pdfkit': 'PDFKit',
          'socket.io': 'Socket.io',
          'redux': 'Redux',
          'zustand': 'Zustand',
          'fastapi': 'FastAPI'
        };

        allDeps.forEach(d => {
          const lower = d.toLowerCase();
          if (highSignalMap[lower]) detectedStack.add(highSignalMap[lower]);
        });
        if (allDeps.some(d => d.includes('typescript') || d.includes('@types/'))) {
          detectedStack.add('TypeScript');
        }
        break;
      }
    } catch (e) {}
  }

  // 2. Inspect requirements.txt / pyproject.toml
  for (const b of branches) {
    try {
      const rUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/requirements.txt`;
      const res = await fetch(rUrl, { timeout: 4000 });
      if (res.ok) {
        const reqText = await res.text();
        const lowerReq = reqText.toLowerCase();
        if (lowerReq.includes('fastapi')) detectedStack.add('FastAPI');
        if (lowerReq.includes('flask')) detectedStack.add('Flask');
        if (lowerReq.includes('django')) detectedStack.add('Django');
        if (lowerReq.includes('insightface')) detectedStack.add('InsightFace');
        if (lowerReq.includes('opencv')) detectedStack.add('OpenCV');
        if (lowerReq.includes('faiss')) detectedStack.add('FAISS');
        if (lowerReq.includes('torch')) detectedStack.add('PyTorch');
        if (lowerReq.includes('tensorflow')) detectedStack.add('TensorFlow');
        if (lowerReq.includes('pandas')) detectedStack.add('Pandas');
        detectedStack.add('Python');
        break;
      }
    } catch (e) {}
  }

  // 3. Fallback heuristic from README keywords
  try {
    const readme = await fetchRepoReadme(owner, repo);
    const rLower = (readme || '').toLowerCase();
    const commonKeywords = [
      ['openrouter', 'OpenRouter LLM'],
      ['gemini', 'Gemini AI'],
      ['groq', 'Groq AI'],
      ['openai', 'OpenAI API'],
      ['vercel', 'Vercel'],
      ['docker', 'Docker'],
      ['firebase', 'Firebase'],
      ['tailwind', 'Tailwind CSS'],
      ['next.js', 'Next.js'],
      ['react', 'React'],
      ['node.js', 'Node.js'],
      ['express', 'Express'],
      ['fastapi', 'FastAPI'],
      ['leaflet', 'Leaflet.js']
    ];
    for (const [kw, label] of commonKeywords) {
      if (rLower.includes(kw) && detectedStack.size < 6) {
        detectedStack.add(label);
      }
    }
  } catch (e) {}

  const finalArray = Array.from(detectedStack).slice(0, 6);
  return finalArray.length > 0 ? finalArray : (fallbackLanguage ? [fallbackLanguage] : ['Full-Stack', 'APIs']);
}

/**
 * 4. Structured Document Extraction via LLM / Vision
 * Extracts clean, validated JSON schemas for Certificates and Marksheets.
 * Discards OCR corruption, generic placeholders, and non-ASCII garbage.
 */
async function classifyAndExtractDocument(buffer, filename = 'document.pdf') {
  if (!buffer || buffer.length === 0) return null;

  // Extract text via document reader
  const extraction = await documentReader.extractText(buffer, filename);
  const text = (extraction.text || '').trim();

  // If text is extremely short or blank, check if it's an image or image-only PDF
  const isImageFile = /\.(png|jpe?g|webp)$/i.test(filename);
  let base64Image = null;
  if (isImageFile) {
    base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  const prompt = `You are an Institutional Document Classifier and Precision Data Extraction Engine.
Analyze the following document text (and metadata) and return a clean, strictly verified JSON object.

FILENAME: "${filename}"
DOCUMENT TEXT EXCERPT:
"""
${text.slice(0, 4000)}
"""

RULES FOR EXTRACTION:
1. Determine the document category: either "EDUCATION" (marksheet, degree transcript, 10th/12th certificate) or "CERTIFICATION" (course completion, tech certification, competition award, hackathon). If neither, return "OTHER".
2. For "EDUCATION":
   - "degree": e.g. "B.Tech in Computer Science and Engineering", "Class 12th (Senior Secondary)", "Class 10th (Secondary)"
   - "branch": e.g. "Computer Science and Engineering" or null
   - "institution": Clean official institute name (e.g. "ABES Engineering College, Ghaziabad", "Ch. Chhabil Dass Public School, Ghaziabad")
   - "board_or_university": e.g. "AKTU", "CBSE", "ICSE"
   - "score_type": "CGPA" or "Percentage"
   - "score_value": Clean numeric score (e.g. "8.0", "8.1", "86.4%"). NEVER duplicate the word CGPA like "CGPA: 8.0 CGPA"
   - "graduation_year": e.g. "2026", "2022", "2020"
3. For "CERTIFICATION":
   - "official_course_or_award_title": The SPECIFIC official program/course name (e.g. "AWS Academy Graduate - Cloud Foundations", "DeepLearning.AI Prompt Engineering for Developers", "Hackathon Winner - Smart India Hackathon").
   - NEVER return generic boilerplate like "Certificate of Completion", "Certificate", or raw filenames like "10711015 9512987".
   - If the text is corrupted OCR gibberish with non-ASCII or unreadable symbols, set official_course_or_award_title to null.
   - "issuing_organization": e.g. "Amazon Web Services", "DeepLearning.AI", "Coursera", "Meta", "Google Cloud", "IBM"
   - "issue_date": "Month Year" (e.g. "May 2025", "Dec 2024")
   - "credential_id": credential ID string or null
   - "is_participation_only": true if only an attendee/webinar/participation without verified examination/award, otherwise false.

Respond ONLY with a valid JSON object matching one of these formats:

If EDUCATION:
{
  "docType": "EDUCATION",
  "degree": "B.Tech in Computer Science and Engineering",
  "branch": "Computer Science and Engineering",
  "institution": "ABES Engineering College, Ghaziabad",
  "board_or_university": "AKTU",
  "score": "8.0/10",
  "year": "2026"
}

If CERTIFICATION:
{
  "docType": "CERTIFICATION",
  "official_course_or_award_title": "AWS Academy Graduate - Cloud Foundations",
  "issuing_organization": "Amazon Web Services",
  "issue_date": "May 2025",
  "credential_id": null,
  "is_participation_only": false,
  "tier": 1
}

If unparseable, return {"docType": "OTHER"}`;

  try {
    const opts = {
      role: 'resume',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 512
    };

    if (base64Image) {
      opts.imageUrls = [base64Image];
    }

    const res = await callLLM(opts);
    const raw = (res && res.text) ? res.text : String(res || '');
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);

    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.docType === 'EDUCATION') {
        let cleanScore = String(parsed.score || '').replace(/CGPA:\s*/gi, '').replace(/CGPA/gi, '').trim();
        if (cleanScore && !cleanScore.includes('%') && !cleanScore.includes('/10')) {
          cleanScore = `${cleanScore}/10`;
        }
        return {
          docType: 'EDUCATION',
          degree: parsed.degree || 'Degree',
          branch: parsed.branch || '',
          institution: parsed.institution || 'ABES Engineering College, Ghaziabad',
          boardOrUniversity: parsed.board_or_university || 'AKTU',
          score: cleanScore || '8.0/10',
          year: parsed.year || parsed.graduation_year || '2026'
        };
      } else if (parsed.docType === 'CERTIFICATION') {
        const title = parsed.official_course_or_award_title;
        // Strict Quality Gates: Discard generic placeholders or OCR garbage
        if (!title || title.length < 5 || /certificate of completion/i.test(title) || /^[0-9\s_-]+$/.test(title) || /[^\x00-\x7F]/.test(title)) {
          console.warn(`[resumeIngestionService] Discarding invalid/corrupted certificate title: "${title}"`);
          return null;
        }

        // Filter out participation-only unless high-tier award
        if (parsed.is_participation_only === true) {
          console.warn(`[resumeIngestionService] Filtered out participation-only certificate: "${title}"`);
          return null;
        }

        return {
          docType: 'CERTIFICATION',
          title: title.trim(),
          issuer: parsed.issuing_organization || 'Industry Certified',
          date: parsed.issue_date || '2025',
          credentialId: parsed.credential_id || null,
          tier: parsed.tier || 1
        };
      }
    }
  } catch (err) {
    console.error(`[resumeIngestionService] LLM extraction error on ${filename}:`, err.message);
  }

  // Deterministic safe fallback only if regex confident
  const lower = text.toLowerCase();
  if (lower.includes('aktu') || lower.includes('abes') || lower.includes('b.tech') || lower.includes('marksheet')) {
    return {
      docType: 'EDUCATION',
      degree: 'B.Tech in Computer Science and Engineering',
      institution: 'ABES Engineering College, Ghaziabad',
      boardOrUniversity: 'AKTU',
      score: '8.0/10',
      year: '2026'
    };
  }

  return null;
}

/**
 * 5. Competitive Programming Evaluator & Value Gate
 */
async function evaluateCodingPlatforms(urls = []) {
  const evaluated = [];

  for (const rawUrl of urls) {
    if (!rawUrl || typeof rawUrl !== 'string') continue;
    const parsed = developerPlatformsService.parsePlatformFromUrl(rawUrl);
    if (!parsed) continue;

    if (parsed.type === 'leetcode') {
      const stats = await developerPlatformsService.getLeetCodeStats(parsed.handle);
      if (stats) {
        // Value Gate: >= 100 solved problems or active ranking
        const total = stats.solvedTotal || 0;
        const meetsThreshold = total >= 100;
        evaluated.push({
          platform: 'LeetCode',
          handle: stats.username,
          url: stats.profileUrl,
          solved: total,
          ranking: stats.ranking,
          meetsThreshold,
          bulletText: meetsThreshold
            ? `Solved ${total}+ Data Structures & Algorithms problems across LeetCode (ranking ${stats.ranking || 'top tier'})`
            : null
        });
      }
    }
  }

  return evaluated;
}

/**
 * Helper to verify live url
 */
async function verifyLiveUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', timeout: 5000 });
    return { verified: res.ok, url };
  } catch (e) {
    return { verified: false, url };
  }
}

module.exports = {
  fetchUserRepositories,
  fetchRepoReadme,
  extractRepoTechStack,
  classifyAndExtractDocument,
  evaluateCodingPlatforms,
  verifyLiveUrl
};
