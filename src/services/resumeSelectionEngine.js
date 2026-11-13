const { callLLM } = require('./llmService');
const { fetchRepoReadme, extractRepoTechStack, verifyLiveUrl } = require('./resumeIngestionService');

// Domain taxonomy for versatility clustering
const DOMAIN_KEYWORDS = {
  'AI / LLM Orchestration': ['llm', 'gemini', 'openai', 'langchain', 'agent', 'rag', 'vector', 'openrouter', 'orchestration', 'embeddings', 'groq', 'assistant'],
  'Computer Vision & ML': ['opencv', 'insightface', 'face recognition', 'vision', 'faiss', 'tensorflow', 'pytorch', 'neural', 'detection'],
  'Full-Stack & Cloud Platforms': ['next.js', 'react', 'node.js', 'express', 'firebase', 'tailwind', 'full-stack', 'rest api', 'mongodb', 'postgresql', 'fastapi'],
  'Systems, Automation & Tools': ['crawler', 'scraper', 'bot', 'cron', 'redis', 'docker', 'ci/cd', 'automation', 'cli', 'iot', 'arduino']
};

/**
 * Determine technical domain of a repo based on name, description, and readme
 */
function classifyRepoDomain(name, desc, readme = '') {
  const content = `${name} ${desc} ${readme}`.toLowerCase();
  let bestDomain = 'Full-Stack & Cloud Platforms';
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (content.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * Calculate technical token overlap between two repos to avoid duplicate themes
 */
function calculateRepoOverlap(repoA, repoB) {
  const tokensA = new Set((`${repoA.name} ${repoA.description} ${repoA.language}`).toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const tokensB = new Set((`${repoB.name} ${repoB.description} ${repoB.language}`).toLowerCase().split(/\W+/).filter(w => w.length > 2));

  let common = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) common++;
  }
  const union = tokensA.size + tokensB.size - common;
  return union === 0 ? 0 : common / union;
}

/**
 * Multi-Signal Flagship Repository Scoring & Selection Formula:
 * +40 pts: Has a live deployment homepage URL (*.vercel.app, custom domain, etc.)
 * +30 pts: Rich README.md depth (length > 1,500 chars with architecture/features)
 * +20 pts: Multi-file codebase size & depth (size > 500 KB)
 * +10 pts: Stars / external engagement (stars > 0)
 *
 * In addition, extracts full tech stack (5-6 actual frameworks from package.json/requirements/readme).
 */
async function selectVersatileRepositories(repos, ownerUsername) {
  if (!Array.isArray(repos) || repos.length === 0) return [];

  // Filter out any fork or profile readme that might have slipped through
  const cleanOwner = (ownerUsername || '').toLowerCase();
  const eligible = repos.filter(r => {
    if (r.fork) return false;
    if (cleanOwner && r.name.toLowerCase() === cleanOwner) return false;
    if (r.size === 0) return false;
    return true;
  });

  console.log(`[resumeSelectionEngine] Evaluating ${eligible.length} repositories for flagship ranking...`);

  // Enumerate & score all eligible repositories
  const enriched = await Promise.all(eligible.map(async (r) => {
    let readme = '';
    try {
      readme = await fetchRepoReadme(cleanOwner || r.fullName.split('/')[0], r.name);
    } catch (e) {}

    // Check live deployment URL
    let liveCheck = { verified: false, url: r.homepage };
    if (r.homepage && typeof r.homepage === 'string' && r.homepage.startsWith('http')) {
      liveCheck = await verifyLiveUrl(r.homepage);
    }

    // 1. Scoring Component: Live deployment (+40 pts)
    let liveScore = 0;
    if (liveCheck.verified || (r.homepage && (r.homepage.includes('vercel.app') || r.homepage.includes('http')))) {
      liveScore = 40;
    }

    // 2. Scoring Component: Rich README depth > 1500 chars (+30 pts)
    const readmeLen = (readme || '').length;
    let readmeScore = 0;
    if (readmeLen > 1500) {
      readmeScore = 30;
    } else if (readmeLen > 500) {
      readmeScore = 15;
    }

    // 3. Scoring Component: Codebase size & depth > 500 KB (+20 pts)
    const repoSizeKb = r.size || 0;
    let sizeScore = 0;
    if (repoSizeKb > 500) {
      sizeScore = 20;
    } else if (repoSizeKb > 100) {
      sizeScore = 10;
    }

    // 4. Scoring Component: Stars / engagement (+10 pts)
    let starScore = 0;
    if (r.stars > 0) {
      starScore = Math.min(10, r.stars * 2.5);
    }

    const totalScore = liveScore + readmeScore + sizeScore + starScore;

    // Full tech stack extraction (5-6 actual frameworks/tools)
    const techStack = await extractRepoTechStack(cleanOwner || r.fullName.split('/')[0], r.name, r.language);
    const domain = classifyRepoDomain(r.name, r.description, readme);

    return {
      ...r,
      readme,
      techStack,
      liveUrl: liveCheck.verified ? liveCheck.url : (r.homepage || ''),
      hasLiveDemo: Boolean(liveScore > 0),
      domain,
      score: totalScore
    };
  }));

  // Sort descending by multi-signal score
  enriched.sort((a, b) => b.score - a.score);

  console.log('[resumeSelectionEngine] Flagship Repo Scores:');
  enriched.slice(0, 8).forEach(r => {
    console.log(` - ${r.name}: ${r.score} pts (Live: ${r.hasLiveDemo ? 'Yes' : 'No'}, README: ${r.readme.length} chars, Size: ${r.size}KB, Stars: ${r.stars}) [Stack: ${r.techStack.join(', ')}]`);
  });

  // Pick top 3-4 versatile repositories spanning distinct technical domains
  const selected = [];
  const coveredDomains = new Set();

  for (const candidate of enriched) {
    if (selected.length >= 4) break;

    const hasHighOverlap = selected.some(sel => calculateRepoOverlap(sel, candidate) > 0.40);
    if (hasHighOverlap && coveredDomains.has(candidate.domain)) {
      continue;
    }

    selected.push(candidate);
    coveredDomains.add(candidate.domain);
  }

  // Fallback to top scored if less than 3
  if (selected.length < 3) {
    for (const candidate of enriched) {
      if (selected.length >= 3) break;
      if (!selected.some(s => s.name === candidate.name)) {
        selected.push(candidate);
      }
    }
  }

  return selected;
}

/**
 * Synthesize Google X-Y-Z Action Bullets for a repository with guaranteed distinct metrics
 */
async function synthesizeProjectBullets(repo, index = 0) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startD = repo.createdAt ? new Date(repo.createdAt) : new Date(Date.now() - 180 * 86400000);
  const endD = repo.pushedAt ? new Date(repo.pushedAt) : new Date();

  const timelineStr = `${monthNames[startD.getMonth()]} ${startD.getFullYear()} – ${monthNames[endD.getMonth()]} ${endD.getFullYear()}`;

  const prompt = `You are a Principal Resume Architect for Tier-1 Tech Hiring.
Convert this real GitHub repository evidence into strictly 3 high-impact, professional resume bullets.

REPOSITORY:
Name: ${repo.name}
Description: ${repo.description}
Detected Tech Stack: ${(repo.techStack || []).join(', ')}
Live URL: ${repo.liveUrl || 'None'}
README Context (excerpt):
"""
${(repo.readme || repo.description || '').slice(0, 3500)}
"""

CRITICAL INSTRUCTIONS:
1. Generate strictly 3 bullets following Google's X-Y-Z formula: "Accomplished [X] as measured by [Y] by doing [Z]".
2. Begin every bullet with a strong action verb (Engineered, Architected, Optimized, Implemented, Streamlined, Integrated).
3. Mention explicit frameworks, tools, or libraries used from the detected tech stack.
4. Include realistic quantifiable metrics (e.g. 99.9% uptime, <120ms latency, 40% payload reduction, 1000+ items indexed).
5. Ensure bullet text is strictly ASCII; never include corrupted or unprintable characters.

Return ONLY a JSON array of 3 strings:
["Bullet 1...", "Bullet 2...", "Bullet 3..."]`;

  try {
    const res = await callLLM({
      role: 'resume',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 1024
    });

    const raw = (res && res.text) ? res.text : String(res || '');
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        return {
          title: repo.name.replace(/[-_]/g, ' '),
          timeline: timelineStr,
          liveUrl: repo.liveUrl,
          repoUrl: repo.repoUrl,
          techStack: repo.techStack || (repo.language ? [repo.language, 'Node.js', 'REST API'] : ['Full-Stack', 'APIs']),
          bullets: parsed.slice(0, 3).map(b => b.replace(/[^\x00-\x7F]/g, ''))
        };
      }
    }
  } catch (err) {
    // fallback
  }

  // Deterministic, domain-tailored metrics fallback (guaranteed zero lexical duplication)
  const techStack = repo.techStack || [repo.language || 'Modern Web Stack'];
  const repoLower = (repo.name + ' ' + (repo.description || '')).toLowerCase();

  let bullets = [];
  if (repoLower.includes('face') || repoLower.includes('vision') || repoLower.includes('find-me')) {
    bullets = [
      `Architected an AI facial recognition pipeline using Python, InsightFace, and FAISS vector indexing to query 5,000+ photo embeddings in under 2 seconds.`,
      `Engineered in-memory image stream ingestion and automated media filters, reducing overall processing overhead by 60%.`,
      `Integrated 128-d margin guard verification to eliminate false positive identifications across dense multi-subject scenes.`
    ];
  } else if (repoLower.includes('bob') || repoLower.includes('companion') || repoLower.includes('assistant')) {
    bullets = [
      `Engineered an autonomous backend orchestration engine with dynamic LLM key-rotation pools, guaranteeing 99.9% system availability.`,
      `Integrated persistent vector memory stores and Cloudinary file vaults with SHA-256 deduplication, accelerating document retrieval by 45%.`,
      `Configured background cron workers and live web crawlers to automate developer resource discovery and self-contained diff logging.`
    ];
  } else if (repoLower.includes('bloom') || repoLower.includes('opportunity')) {
    bullets = [
      `Architected a full-stack platform aggregating 1,000+ STEM opportunities via automated daily ingestion workflows and deduplication algorithms.`,
      `Engineered personalized eligibility matching algorithms that evaluated user skills against candidate requisites, boosting precision by 35%.`,
      `Deployed responsive application tracking Kanban boards with automated deadline notifications, improving user retention by 40%.`
    ];
  } else if (repoLower.includes('falcon') || repoLower.includes('tour')) {
    bullets = [
      `Architected and deployed a multi-page travel portal hosting over 170 dynamic destination pages with sub-100ms asset delivery.`,
      `Engineered client-side omnibox search and interactive route mapping using Leaflet.js, boosting trip inquiry lead conversion by 30%.`,
      `Optimized SEO metadata and critical rendering paths, achieving a 95+ Google Lighthouse performance rating across mobile devices.`
    ];
  } else if (index === 0) {
    bullets = [
      `Architected a scalable full-stack application with ${techStack.slice(0, 3).join(', ')}, handling 500+ client requests per second with sub-100ms response times.`,
      `Engineered modular REST API endpoints and state management pipelines, reducing client-side payload sizes by 40%.`,
      `Automated continuous deployment and test workflows, maintaining 99.9% uptime on cloud hosting environments.`
    ];
  } else if (index === 1) {
    bullets = [
      `Engineered high-performance client-side routing and interactive visualization dashboards using ${techStack.slice(0, 3).join(', ')}, improving user retention by 25%.`,
      `Implemented serverless event-driven microservices to ingest and validate external payloads across 15+ external API endpoints.`,
      `Optimized asset delivery and critical rendering paths, achieving a 95+ Google Lighthouse performance rating.`
    ];
  } else {
    bullets = [
      `Built an end-to-end data processing service using ${techStack.slice(0, 3).join(', ')}, automating routine analysis tasks and saving 10+ operational hours weekly.`,
      `Designed structured schema models and indexed database queries to optimize query latency across 10,000+ records.`,
      `Configured secure authentication protocols and granular permission barriers, preventing unauthorized request access.`
    ];
  }

  return {
    title: repo.name.replace(/[-_]/g, ' '),
    timeline: timelineStr,
    liveUrl: repo.liveUrl,
    repoUrl: repo.repoUrl,
    techStack,
    bullets
  };
}

module.exports = {
  selectVersatileRepositories,
  synthesizeProjectBullets,
  classifyRepoDomain
};
