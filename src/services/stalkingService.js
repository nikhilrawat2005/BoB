// ---------------------------------------------------------------------------
// Bob HQ — Stalking Service (deep-dive intelligence)
// Builds a rich Profile Card for any person / site:
//   web search → scrape top results → GitHub discovery → repo read → LLM card
//
//   users/{uid}/stalkingProfiles/{profId} → { id, name, link, status,
//     profileData: { headline, bio, location, links[], socials[],
//       githubHandle, githubRepos[], tech[], summary, insights[],
//       lastResearchAt }, notes, chatSessionId, createdAt, updatedAt, error }
// ---------------------------------------------------------------------------
const { db } = require('../config/firebase');
const memory = require('./memoryService');
const crawler = require('./crawlerService');
const web = require('./webSearchService');
const repo = require('./repoService');
const { callLLM } = require('./llmService');

function coll(userId) {
  return db.collection('users').doc(userId).collection('stalkingProfiles');
}

function extractGitHubHandle(text) {
  const m = String(text || '').match(/github\.com\/([A-Za-z0-9_.-]+)/);
  return m ? m[1].replace(/\/.*$/, '') : null;
}

async function getProfile(userId, profId) {
  const doc = await coll(userId).doc(profId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function listProfiles(userId) {
  const snap = await coll(userId).orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function createProfile(userId, { name, link, notes = '' }) {
  const ref = coll(userId).doc();
  const now = Date.now();
  const prof = {
    id: ref.id,
    name: String(name || '').trim() || (link ? new URL(link).hostname.replace(/^www\./, '') : 'Unknown'),
    link: String(link || '').trim(),
    status: 'idle',
    profileData: null,
    notes: String(notes || ''),
    chatSessionId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(prof);
  return prof;
}

async function deleteProfile(userId, profId) {
  const p = await getProfile(userId, profId);
  if (p && p.chatSessionId) await memory.deleteSession(userId, p.chatSessionId).catch(() => {});
  await coll(userId).doc(profId).delete();
  return { success: true };
}

async function updateProfile(userId, profId, patch = {}) {
  const clean = {};
  for (const k of ['name', 'link', 'notes', 'profileData', 'status']) {
    if (k in patch) clean[k] = patch[k];
  }
  clean.updatedAt = Date.now();
  await coll(userId).doc(profId).set(clean, { merge: true });
  return getProfile(userId, profId);
}

// ── Deep-dive research pipeline ──────────────────────────
async function researchProfile(userId, profId) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');

  await coll(userId).doc(profId).set({ status: 'researching', error: null, updatedAt: Date.now() }, { merge: true });

  try {
    const raw = [];
    const collectedLinks = [];
    const seenUrls = new Set();
    const { isHighValueProfileUrl, isJunkUrl } = crawler;
    if (prof.link) seenUrls.add(prof.link);

    // ── Step 1: Scrape the primary link provided by the user ──
    if (prof.link) {
      try {
        const s = await crawler.scrapeURL(prof.link);
        raw.push(`[LINK: ${prof.link}]\nTitle: ${s.title}\nDescription: ${s.description}\nSnippet: ${s.contentSnippet}`);
        // Only keep high-value profile/project links from the primary page
        if (s.links && s.links.length) {
          s.links.forEach(l => {
            if (!seenUrls.has(l.url) && !isJunkUrl(l.url)) {
              seenUrls.add(l.url);
              collectedLinks.push({ url: l.url, label: l.text, source: 'Primary Link', highValue: isHighValueProfileUrl(l.url) });
            }
          });
        }
      } catch (e) {
        raw.push(`[LINK: ${prof.link}]\n(scrape failed: ${e.message})`);
      }
    }

    // ── Step 2: Web search ──
    const q = prof.name + (prof.link ? '' : ' developer github profile portfolio');
    const search = await web.searchWeb(q, { count: 6 });
    raw.push(`[WEB SEARCH: ${q}]\n${search.results.map(r => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join('\n')}`);
    search.results.forEach(r => {
      if (r.url && !seenUrls.has(r.url) && !isJunkUrl(r.url)) {
        seenUrls.add(r.url);
        collectedLinks.push({ url: r.url, label: r.title, source: 'Web Search', highValue: isHighValueProfileUrl(r.url) });
      }
    });

    const allText = raw.join('\n\n');
    let githubHandle = extractGitHubHandle(allText + ' ' + (prof.link || ''));

    // ── Step 3: GitHub REST API — pull real profile bio, blog, twitter ──
    const github = { handle: githubHandle, repos: [], analyzed: [] };
    if (githubHandle) {
      try {
        // Fetch the GitHub user profile via API for blog/twitter/social links
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
        const ghHeaders = {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'bob-the-builder',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {}),
        };
        const ghProfileRes = await fetch(`https://api.github.com/users/${encodeURIComponent(githubHandle)}`, { headers: ghHeaders });
        if (ghProfileRes.ok) {
          const ghUser = await ghProfileRes.json();
          raw.push(`[GITHUB PROFILE]\nName: ${ghUser.name || ''}\nBio: ${ghUser.bio || ''}\nLocation: ${ghUser.location || ''}\nBlog: ${ghUser.blog || ''}\nTwitter: ${ghUser.twitter_username || ''}\nPublic Repos: ${ghUser.public_repos}\nFollowers: ${ghUser.followers}`);
          // Blog (portfolio) link from GitHub profile
          if (ghUser.blog && !seenUrls.has(ghUser.blog)) {
            const blogUrl = ghUser.blog.startsWith('http') ? ghUser.blog : 'https://' + ghUser.blog;
            seenUrls.add(blogUrl);
            collectedLinks.push({ url: blogUrl, label: `${ghUser.name || githubHandle}'s Portfolio/Website`, source: 'GitHub Profile', highValue: true });
          }
          // Twitter from GitHub profile
          if (ghUser.twitter_username) {
            const twitterUrl = `https://x.com/${ghUser.twitter_username}`;
            if (!seenUrls.has(twitterUrl)) {
              seenUrls.add(twitterUrl);
              collectedLinks.push({ url: twitterUrl, label: `@${ghUser.twitter_username} on X/Twitter`, source: 'GitHub Profile', highValue: true });
            }
          }
        }

        // Fetch top repos via GitHub API (not search) to get accurate list
        const reposRes = await fetch(`https://api.github.com/users/${encodeURIComponent(githubHandle)}/repos?sort=updated&per_page=10&type=owner`, { headers: ghHeaders });
        if (reposRes.ok) {
          const reposList = await reposRes.json();
          github.repos = reposList.slice(0, 8).map(r => ({
            name: r.full_name,
            description: r.description || '',
            stars: r.stargazers_count || 0,
            url: r.html_url,
            homepage: r.homepage || null,
            language: r.language || null,
          }));

          // Add homepage (deployed project links) from repos
          for (const r of reposList) {
            if (r.homepage && !seenUrls.has(r.homepage) && !isJunkUrl(r.homepage)) {
              seenUrls.add(r.homepage);
              collectedLinks.push({ url: r.homepage, label: `${r.name} — Live Demo`, source: 'GitHub Repo Homepage', highValue: true });
            }
          }

          // Scan READMEs of top 3 repos for deployed project links
          const topRepos = reposList.slice(0, 3);
          for (const r of topRepos) {
            try {
              const readmeRes = await fetch(`https://raw.githubusercontent.com/${r.full_name}/${r.default_branch || 'main'}/README.md`, { headers: ghHeaders });
              if (readmeRes.ok) {
                const readmeText = await readmeRes.text();
                raw.push(`[README: ${r.full_name}]\n${readmeText.slice(0, 3000)}`);
                // Extract all URLs from README
                const urlRe = /https?:\/\/[^\s\)\"\'<>\]]+/g;
                let m;
                while ((m = urlRe.exec(readmeText)) !== null) {
                  const url = m[0].replace(/[.,;!?]+$/, ''); // strip trailing punctuation
                  if (!seenUrls.has(url) && !isJunkUrl(url)) {
                    seenUrls.add(url);
                    const isHV = isHighValueProfileUrl(url);
                    collectedLinks.push({ url, label: `${r.name} — README link`, source: 'README', highValue: isHV });
                  }
                }
              }
            } catch (e) { /* best effort README scan */ }
          }

          // Analyze top repo for code intelligence
          if (github.repos.length > 0) {
            const top = github.repos[0];
            const a = await repo.analyzeRepo(top.name).catch(err => ({ status: 'error', error: 'read', message: err.message }));
            github.analyzed = [{
              full_name: top.name,
              status: a.status || 'ok',
              readCount: a.readCount || 0,
              message: a.message || null,
              context: (a.context || '').slice(0, 4000),
            }];
          }
        }
      } catch (e) { console.error('[stalking] GitHub API error:', e.message); }
    }

    // ── Step 4: Deep-crawl only high-value discovered links ──
    const highValueToScrape = collectedLinks.filter(l => l.highValue).slice(0, 3);
    for (const item of highValueToScrape) {
      try {
        const sub = await crawler.scrapeURL(item.url, 5000);
        if (sub.contentSnippet) {
          raw.push(`[DEEP CRAWL: ${item.url}]\nTitle: ${sub.title}\nSnippet: ${sub.contentSnippet.slice(0, 2000)}`);
        }
        // From this page, only pick additional high-value profile links
        if (sub.links && sub.links.length) {
          sub.links.filter(l => isHighValueProfileUrl(l.url)).slice(0, 5).forEach(l => {
            if (!seenUrls.has(l.url)) {
              seenUrls.add(l.url);
              collectedLinks.push({ url: l.url, label: l.text, source: 'Deep Crawl', highValue: true });
            }
          });
        }
      } catch (e) { /* best effort */ }
    }

    const allTextFinal = raw.join('\n\n');

    // LLM → structured profile card
    let card = null;
    try {
      const res = await callLLM({
        role: 'review',
        messages: [
          { role: 'system', content: 'You build a concise intelligence Profile Card from scraped research about a person/org. Reply with clean JSON only (no markdown fences).' },
          { role: 'user', content: `RESEARCH:\n\n${allTextFinal.slice(0, 15000)}\n\nGITHUB:\n${JSON.stringify(github)}\n\nReturn JSON: { "name" (the ACTUAL person's real name like "Narayan Singh" — NOT their job title or role), "headline" (their job title/role/tagline), "bio" (2-3 sentences), "location", "links" (array of key URLs), "socials" (array of strings like "github/username" or "x/handle"), "tech" (array of technologies/skills), "summary" (5-6 bullet insights as array of strings) }` },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      });
      card = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    } catch (e) { card = null; }

    const profileData = {
      headline: card?.headline || prof.name,
      bio: card?.bio || 'No bio found — research completed.',
      location: card?.location || 'unknown',
      links: card?.links || (prof.link ? [prof.link] : []),
      discoveredLinks: collectedLinks.sort((a, b) => (b.highValue ? 1 : 0) - (a.highValue ? 1 : 0)).slice(0, 15),
      socials: card?.socials || (githubHandle ? [`github/${githubHandle}`] : []),
      tech: card?.tech || [],
      summary: card?.summary || [],
      githubHandle,
      githubRepos: github.repos,
      analyzedRepos: github.analyzed,
      lastResearchAt: Date.now(),
    };

    // Use the LLM-extracted real name (e.g. "Narayan Singh"), NOT the headline/role.
    // Fall back to the original name provided by the user.
    const resolvedName = card?.name || prof.name;

    await coll(userId).doc(profId).set({
      profileData,
      status: 'ready',
      name: resolvedName,
      updatedAt: Date.now(),
    }, { merge: true });

    await memory.addNotification(
      userId,
      `🕵️ Stalking complete: ${resolvedName}`,
      `Deep-dive done — ${profileData.summary.length ? profileData.summary[0].slice(0, 120) : 'Profile card ready.'}`
    );
    return getProfile(userId, profId);
  } catch (err) {
    await coll(userId).doc(profId).set({ status: 'error', error: err.message, updatedAt: Date.now() }, { merge: true });
    throw err;
  }
}

// ── Per-profile chat (context-isolated) ───────────────────
async function ensureChatSession(userId, prof) {
  if (prof.chatSessionId) return prof.chatSessionId;
  const s = await memory.createSession(userId, `🕵️ ${prof.name}`);
  await coll(userId).doc(prof.id).set({ chatSessionId: s.id }, { merge: true });
  return s.id;
}

function buildProfileContext(prof) {
  const p = prof.profileData || {};
  const lines = [
    `PROFILE: ${prof.name}`,
    prof.link ? `Link: ${prof.link}` : '',
    p.headline ? `Headline: ${p.headline}` : '',
    p.location && p.location !== 'unknown' ? `Location: ${p.location}` : '',
    p.bio ? `Bio: ${p.bio}` : '',
    p.tech && p.tech.length ? `Tech/Topics: ${p.tech.join(', ')}` : '',
    p.socials && p.socials.length ? `Socials: ${p.socials.join(', ')}` : '',
    p.githubRepos && p.githubRepos.length ? `GitHub repos:\n${p.githubRepos.map(r => `- ${r.name} (${r.stars}★) ${r.description || ''}`).join('\n')}` : '',
    p.analyzedRepos && p.analyzedRepos.length ? `Analyzed repo:\n${p.analyzedRepos.map(r => `${r.full_name}: ${(r.context || r.message || '').slice(0, 1500)}`).join('\n')}` : '',
    p.summary && p.summary.length ? `Key insights:\n${p.summary.map(s => '- ' + s).join('\n')}` : '',
    prof.notes ? `My notes:\n${prof.notes}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

async function chatSend(userId, profId, message) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');

  const sid = await ensureChatSession(userId, prof);
  await memory.addMessage(userId, sid, 'user', message);
  const recent = await memory.getRecentMessages(userId, sid, 20);
  const context = buildProfileContext(prof);

  const systemPrompt = `You are Bob inside Master Nikhil's STALKING WORKSPACE for "${prof.name}".
This chat is STRICTLY about this person/profile only. Help analyze their work, find opportunities, prepare outreach, or figure out how to approach/collaborate.
Never bring up vault, hackathons, or other chats.

PROFILE KNOWLEDGE:
${context}

Be sharp, specific, and honest about what is known vs guessed. Use Hinglish when natural.`;
  const { text, model } = await callLLM({
    role: 'chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recent.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content })),
    ],
  });
  await memory.addMessage(userId, sid, 'assistant', text);
  return { reply: text, model, sessionId: sid };
}

async function chatList(userId, profId) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');
  if (!prof.chatSessionId) return [];
  return memory.getRecentMessages(userId, prof.chatSessionId, 100);
}

module.exports = {
  createProfile, getProfile, listProfiles, updateProfile, deleteProfile,
  researchProfile, chatSend, chatList,
};
