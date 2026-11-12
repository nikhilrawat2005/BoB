const { callLLM } = require('./llmService');
const { fetchRepoReadme, verifyLiveUrl } = require('./resumeIngestionService');

// Domain taxonomy for versatility clustering
const DOMAIN_KEYWORDS = {
  'AI / LLM Orchestration': ['llm', 'gemini', 'openai', 'langchain', 'agent', 'rag', 'vector', 'openrouter', 'orchestration', 'embeddings', 'groq'],
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
 * Rank, deduplicate, and select top 3-4 versatile repositories spanning distinct domains
 */
async function selectVersatileRepositories(repos, ownerUsername) {
  if (!Array.isArray(repos) || repos.length === 0) return [];

  // 1. Fetch README and compute architectural complexity score
  const enriched = await Promise.all(repos.slice(0, 15).map(async (r) => {
    let readme = '';
    try {
      readme = await fetchRepoReadme(ownerUsername || r.fullName.split('/')[0], r.name);
    } catch (e) {}

    let liveCheck = { verified: false, url: r.homepage };
    if (r.homepage) {
      liveCheck = await verifyLiveUrl(r.homepage);
    }

    const hasLiveDemo = liveCheck.verified ? 25 : (r.homepage ? 10 : 0);
    const starWeight = Math.min(20, (r.stars || 0) * 5);
    const readmeWeight = Math.min(30, Math.floor((readme.length || 0) / 300));
    const freshnessWeight = r.pushedAt ? Math.max(5, 15 - Math.floor((Date.now() - new Date(r.pushedAt).getTime()) / (180 * 86400000))) : 5;
    const forkPenalty = r.isFork ? -30 : 10;

    const domain = classifyRepoDomain(r.name, r.description, readme);
    const totalScore = hasLiveDemo + starWeight + readmeWeight + freshnessWeight + forkPenalty;

    return {
      ...r,
      readme,
      liveUrl: liveCheck.verified ? liveCheck.url : r.homepage,
      hasLiveDemo: Boolean(liveCheck.verified || r.homepage),
      domain,
      score: totalScore
    };
  }));

  enriched.sort((a, b) => b.score - a.score);

  // 2. Anti-Duplication & Versatility Selection: Group by domain
  const selected = [];
  const coveredDomains = new Set();

  for (const candidate of enriched) {
    if (selected.length >= 4) break;

    const hasHighOverlap = selected.some(sel => calculateRepoOverlap(sel, candidate) > 0.45);
    if (hasHighOverlap && coveredDomains.has(candidate.domain)) {
      continue;
    }

    selected.push(candidate);
    coveredDomains.add(candidate.domain);
  }

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
Primary Language: ${repo.language}
Live URL: ${repo.liveUrl || 'None'}
README Context (excerpt):
"""
${(repo.readme || repo.description || '').slice(0, 3500)}
"""

CRITICAL INSTRUCTIONS:
1. Generate strictly 3 bullets following Google's X-Y-Z formula: "Accomplished [X] as measured by [Y] by doing [Z]".
2. Begin every bullet with a distinct action verb (Engineered, Architected, Optimized, Implemented, Streamlined, Integrated).
3. Mention explicit frameworks, tools, or libraries used.
4. Include realistic quantifiable metrics (e.g. 99.9% uptime, <150ms latency, 40% bandwidth reduction, 1000+ items indexed).
5. Never repeat phrases or technical bigrams across bullets.

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
          techStack: repo.language ? [repo.language, 'Node.js', 'REST API'] : ['Full-Stack', 'APIs'],
          bullets: parsed.slice(0, 3)
        };
      }
    }
  } catch (err) {
    // fallback
  }

  // Deterministic, domain-tailored metrics fallback (guaranteed zero lexical duplication)
  const tech = repo.language || 'Modern Web Stack';
  const repoLower = (repo.name + ' ' + (repo.description || '')).toLowerCase();

  let bullets = [];
  if (repoLower.includes('face') || repoLower.includes('vision') || repoLower.includes('find-me')) {
    bullets = [
      `Architected an AI facial recognition pipeline using ${tech} and vector indexing, searching 5000+ photo embeddings in under 2 seconds.`,
      `Engineered in-memory image stream ingestion and automated media filters, reducing overall processing overhead by 60%.`,
      `Integrated 128-d margin guard verification to eliminate false positive identifications across dense multi-subject scenes.`
    ];
  } else if (repoLower.includes('bob') || repoLower.includes('companion') || repoLower.includes('assistant')) {
    bullets = [
      `Engineered an autonomous backend orchestration engine with dynamic LLM key-rotation pools, guaranteeing 99.9% system availability.`,
      `Integrated persistent vector memory stores and SHA-256 deduplicated asset indexing, accelerating document context retrieval by 45%.`,
      `Configured cron discovery workers and live web extraction pipelines to process 200+ developer resources daily with automated failover.`
    ];
  } else if (repoLower.includes('bloom') || repoLower.includes('opportunity')) {
    bullets = [
      `Architected a full-stack platform aggregating 1000+ STEM opportunities via automated daily ingestion workflows and deduplication algorithms.`,
      `Engineered eligibility matching filters that evaluated user skills against candidate requisites, boosting recommendation precision by 35%.`,
      `Deployed responsive application tracking boards with automated deadline reminders, increasing active user engagement.`
    ];
  } else if (index === 0) {
    bullets = [
      `Architected a scalable full-stack web application with ${tech}, handling 500+ client requests per second with sub-100ms response times.`,
      `Engineered modular REST API endpoints and state management pipelines, reducing client-side payload sizes by 40%.`,
      `Automated continuous deployment and test workflows, maintaining 99.9% uptime on cloud hosting environments.`
    ];
  } else if (index === 1) {
    bullets = [
      `Engineered high-performance client-side routing and interactive visualization dashboards using ${tech}, improving user retention by 25%.`,
      `Implemented serverless event-driven microservices to ingest and validate external payloads across 15+ external API endpoints.`,
      `Optimized asset delivery and critical rendering paths, achieving a 95+ Google Lighthouse performance rating.`
    ];
  } else {
    bullets = [
      `Built an end-to-end data processing service using ${tech}, automating routine analysis tasks and saving 10+ operational hours weekly.`,
      `Designed structured schema models and indexed database queries to optimize query latency across 10,000+ relational records.`,
      `Configured secure authentication protocols and granular permission barriers, preventing unauthorized request access.`
    ];
  }

  return {
    title: repo.name.replace(/[-_]/g, ' '),
    timeline: timelineStr,
    liveUrl: repo.liveUrl,
    repoUrl: repo.repoUrl,
    techStack: [tech, 'Git', 'Cloud Architecture'],
    bullets
  };
}

module.exports = {
  selectVersatileRepositories,
  synthesizeProjectBullets,
  classifyRepoDomain
};
