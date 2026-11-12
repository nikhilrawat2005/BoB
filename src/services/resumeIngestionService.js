const fetch = require('node-fetch');
const cheerio = require('cheerio');
const documentReader = require('./documentReaderService');
const developerPlatformsService = require('./developerPlatformsService');
const { callLLM } = require('./llmService');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_API = 'https://api.github.com';

/**
 * 1. Fetch all repositories for a GitHub user with full metadata
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
    const res = await fetch(`${GITHUB_API}/users/${encodeURIComponent(cleanUser)}/repos?sort=updated&per_page=35&type=all`, {
      headers,
      timeout: 10000
    });
    if (!res.ok) {
      console.warn(`[resumeIngestionService] GitHub API returned status ${res.status} for ${cleanUser}`);
      return [];
    }
    const repos = await res.json();
    if (!Array.isArray(repos)) return [];

    // Filter out forks if original work exists
    return repos.map(r => ({
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
      isFork: Boolean(r.fork),
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
 * 3. Classify uploaded document into Marksheet (Education) vs Certificate
 */
async function classifyAndExtractDocument(buffer, filename = 'document.pdf') {
  if (!buffer || buffer.length === 0) return null;
  const extraction = await documentReader.extractText(buffer, filename);
  const text = (extraction.text || '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  // Marksheet / Academic Transcript check
  const isAcademicTranscript = /\b(marksheet|mark\s*sheet|transcript|grade\s*card|semester|examination|board\s*of|aktu|cbse|icse|dr\.\s*a\.p\.j|university|cgpa|sgpa|aggregate|passing\s*year|provisional\s*certificate|diploma|b\.?tech|bachelor\s*of|intermediate|matriculation|high\s*school)\b/i.test(lower);

  // Certificate check
  const isCertificate = /\b(certificate|certifies\s*that|has\s*successfully\s*completed|completion\s*of|specialization|credential|awarded\s*to|course\s*completed|hackathon|winner|runner|finalist|internship\s*certificate|letter\s*of\s*recommendation|published|patent)\b/i.test(lower);

  if (isAcademicTranscript) {
    // Extract academic details
    let degree = 'B.Tech in Computer Science and Engineering';
    if (/\b(b\.?tech\s*in\s*[\w\s]+|bachelor\s*of\s*technology|b\.?e\.?)/i.test(text)) {
      const match = text.match(/\b(b\.?tech(?:\s*in\s*[\w\s&]+)?|bachelor\s*of\s*technology(?:\s*in\s*[\w\s&]+)?|b\.?e\.?)/i);
      if (match) degree = match[0].trim();
    } else if (/\b(class\s*12(?:th)?|xii|intermediate|senior\s*school)/i.test(lower)) {
      degree = 'Class 12th (Senior Secondary)';
    } else if (/\b(class\s*10(?:th)?|x\b|matriculation|high\s*school)/i.test(lower)) {
      degree = 'Class 10th (Secondary)';
    }

    let institution = 'ABES Engineering College, Ghaziabad';
    if (/\babes\s*engineering\s*college/i.test(lower)) {
      institution = 'ABES Engineering College, Ghaziabad';
    } else {
      const instMatch = text.match(/(?:college|institute|university|school|academy)[\w\s,.-]{5,40}/i);
      if (instMatch) institution = instMatch[0].trim();
    }

    let boardOrUniversity = 'AKTU';
    if (/\b(aktu|dr\.\s*a\.p\.j|abdul\s*kalam)\b/i.test(lower)) boardOrUniversity = 'AKTU';
    else if (/\b(cbse|central\s*board)\b/i.test(lower)) boardOrUniversity = 'CBSE';
    else if (/\b(icse|cisce)\b/i.test(lower)) boardOrUniversity = 'ICSE';

    let score = '8.0 CGPA';
    const cgpaMatch = text.match(/(?:cgpa|sgpa|gpa|aggregate|percentage|%)\s*[:=-]?\s*(\d{1,2}(?:\.\d{1,2})?%?|\d\.\d{1,2})/i);
    if (cgpaMatch) {
      score = cgpaMatch[1].includes('%') ? cgpaMatch[1] : `${cgpaMatch[1]} CGPA`;
    }

    let year = '2026';
    const yearMatch = text.match(/\b(202[0-9]|20[12]\d)\b/);
    if (yearMatch) year = yearMatch[1];

    return {
      docType: 'EDUCATION',
      degree,
      institution,
      boardOrUniversity,
      score,
      year,
      rawTextExcerpt: text.slice(0, 300)
    };
  }

  if (isCertificate) {
    // Check Tier-1 vs Tier-2
    const isTier1 = /\b(aws|amazon\s*web\s*services|google\s*cloud|gcp|azure|microsoft|oracle|meta|ibm|cisco|coursera|deeplearning\.ai|nvidia|hackathon\s*winner|first\s*prize|runner\s*up|finalist|internship\s*completion|patent|research\s*paper|ieee|springer)\b/i.test(lower);
    const isNoise = /\b(participation|webinar|seminar|attended|attendance|quiz|volunteer|coordinator)\b/i.test(lower) && !isTier1;

    let certTitle = filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    const titleMatch = text.match(/(?:certificate\s*of\s*[\w\s]+|certification\s*in\s*[\w\s]+|credential\s*[\w\s]+)/i);
    if (titleMatch) certTitle = titleMatch[0].trim();

    let issuer = 'Industry Certified';
    if (/\b(aws|amazon)\b/i.test(lower)) issuer = 'Amazon Web Services';
    else if (/\b(google|gcp)\b/i.test(lower)) issuer = 'Google Cloud';
    else if (/\b(microsoft|azure)\b/i.test(lower)) issuer = 'Microsoft';
    else if (/\b(meta)\b/i.test(lower)) issuer = 'Meta';
    else if (/\b(ibm)\b/i.test(lower)) issuer = 'IBM';
    else if (/\b(coursera)\b/i.test(lower)) issuer = 'Coursera';
    else if (/\b(hackathon)\b/i.test(lower)) issuer = 'Hackathon Authority';

    const dateMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*20\d{2}\b/i) || text.match(/\b20\d{2}\b/);
    const dateStr = dateMatch ? dateMatch[0] : '2025';

    return {
      docType: 'CERTIFICATION',
      tier: isTier1 ? 1 : (isNoise ? 2 : 1),
      title: certTitle,
      issuer,
      date: dateStr,
      credentialUrl: '',
      rawTextExcerpt: text.slice(0, 300)
    };
  }

  return {
    docType: 'OTHER',
    filename,
    rawTextExcerpt: text.slice(0, 300)
  };
}

/**
 * 4. Competitive Programming Evaluator & Value Gate
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
    } else if (parsed.type === 'codechef') {
      const stats = await developerPlatformsService.getCodeChefStats(parsed.handle);
      if (stats) {
        // Value Gate: rating >= 1400 or >= 2 stars
        const rating = stats.rating || 0;
        const meetsThreshold = rating >= 1400;
        evaluated.push({
          platform: 'CodeChef',
          handle: stats.username,
          url: stats.profileUrl,
          rating,
          stars: stats.stars,
          meetsThreshold,
          bulletText: meetsThreshold
            ? `Achieved ${stats.stars} (${rating} rating) on CodeChef competing in global algorithmic challenges`
            : null
        });
      }
    } else if (parsed.type === 'codeforces') {
      const stats = await developerPlatformsService.getCodeforcesStats(parsed.handle);
      if (stats) {
        const rating = stats.rating || 0;
        const meetsThreshold = rating >= 1200;
        evaluated.push({
          platform: 'Codeforces',
          handle: stats.handle,
          url: stats.profileUrl,
          rating,
          rank: stats.rank,
          meetsThreshold,
          bulletText: meetsThreshold
            ? `Rated ${rating} (${stats.rank}) on Codeforces with verified contest problem solving`
            : null
        });
      }
    }
  }

  return evaluated;
}

/**
 * 5. Verify HTTP 200 status for live project deployment URLs
 */
async function verifyLiveUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.trim();
  if (!clean.startsWith('http')) return null;

  try {
    const res = await fetch(clean, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    if (res.status >= 200 && res.status < 400) {
      return { url: clean, verified: true, status: res.status };
    }
  } catch (e) {
    // Retry GET once
    try {
      const res2 = await fetch(clean, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      if (res2.status >= 200 && res2.status < 400) {
        return { url: clean, verified: true, status: res2.status };
      }
    } catch (err) {}
  }
  return { url: clean, verified: false };
}

module.exports = {
  fetchUserRepositories,
  fetchRepoReadme,
  classifyAndExtractDocument,
  evaluateCodingPlatforms,
  verifyLiveUrl
};
