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
const devPlatforms = require('./developerPlatformsService');
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

// ── Helper: Probe 12+ tech & social platforms for handle ──
async function probePlatformProfiles(handle) {
  if (!handle || handle.length < 2) return [];
  const platforms = [
    { name: 'GitHub', url: `https://github.com/${handle}` },
    { name: 'LeetCode', url: `https://leetcode.com/u/${handle}` },
    { name: 'CodeChef', url: `https://www.codechef.com/users/${handle}` },
    { name: 'Codeforces', url: `https://codeforces.com/profile/${handle}` },
    { name: 'HackerRank', url: `https://www.hackerrank.com/profile/${handle}` },
    { name: 'DEV.to', url: `https://dev.to/${handle}` },
    { name: 'Medium', url: `https://medium.com/@${handle}` },
    { name: 'Hashnode', url: `https://hashnode.com/@${handle}` },
    { name: 'Kaggle', url: `https://www.kaggle.com/${handle}` },
    { name: 'ProductHunt', url: `https://www.producthunt.com/@${handle}` },
    { name: 'X / Twitter', url: `https://x.com/${handle}` },
    { name: 'Instagram', url: `https://www.instagram.com/${handle}` },
  ];

  const found = [];
  const probeOne = async (p) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(p.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timer);
      if (res && (res.status === 200 || res.status === 301 || res.status === 302)) {
        found.push({ url: p.url, label: `${p.name} (@${handle})`, source: 'Handle Hunter', highValue: true });
      }
    } catch (e) { /* ignore timeout/404 */ }
  };

  await Promise.allSettled(platforms.map(probeOne));
  return found;
}

// ── Helper: Targeted Search Operator for LinkedIn posts & experience ──
async function scrapeLinkedInSnippets(handle, name) {
  const snippets = [];
  const queries = [];
  if (handle) {
    queries.push(`site:linkedin.com/in/${handle}`);
    queries.push(`"${handle}" "LinkedIn" post OR article OR experience OR project`);
  }
  if (name && name !== 'Unknown') {
    queries.push(`"${name}" site:linkedin.com/in/`);
    queries.push(`"${name}" site:linkedin.com/posts/`);
  }

  for (const q of queries) {
    try {
      const search = await web.searchWeb(q, { count: 4 });
      search.results.forEach(r => {
        if (r.snippet && r.snippet.length > 20) {
          snippets.push(`[LINKEDIN SNIPPET: ${r.title}]\nURL: ${r.url}\nContent: ${r.snippet}`);
        }
      });
    } catch (e) { /* best effort */ }
  }
  return snippets.join('\n\n');
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

    // Extract handle from primary link or profile name
    let handle = '';
    if (prof.link) {
      const m = prof.link.match(/(?:linkedin\.com\/in\/|github\.com\/|twitter\.com\/|x\.com\/|instagram\.com\/)([A-Za-z0-9_.-]+)/i);
      if (m) handle = m[1];
    }
    if (!handle && prof.name && !prof.name.includes(' ')) {
      handle = prof.name;
    }

    // ── Step 1: Scrape the primary link provided by the user ──
    if (prof.link) {
      try {
        const s = await crawler.scrapeURL(prof.link);
        raw.push(`[PRIMARY LINK: ${prof.link}]\nTitle: ${s.title}\nDescription: ${s.description}\nSnippet: ${s.contentSnippet}`);
        if (s.links && s.links.length) {
          s.links.forEach(l => {
            if (!seenUrls.has(l.url) && !isJunkUrl(l.url)) {
              seenUrls.add(l.url);
              collectedLinks.push({ url: l.url, label: l.text, source: 'Primary Link', highValue: isHighValueProfileUrl(l.url) });
            }
          });
        }
      } catch (e) {
        raw.push(`[PRIMARY LINK: ${prof.link}]\n(scrape failed: ${e.message})`);
      }
    }

    // ── Step 2: Handle Hunter probing disabled per user instruction ──
    // Only verified links found via direct scraping, search results, or APIs are included.

    // ── Step 3: Targeted LinkedIn Posts & Experience Mining ──
    const linkedinSnippets = await scrapeLinkedInSnippets(handle, prof.name);
    if (linkedinSnippets) {
      raw.push(linkedinSnippets);
    }

    const allText = raw.join('\n\n');
    let githubHandle = extractGitHubHandle(allText + ' ' + (prof.link || ''));

    // ── Step 3.5: Fetch Official Coding Platform Stats ONLY if explicitly discovered ──
    let codingStats = {};
    const textToScan = (prof.link || '') + ' ' + allText + ' ' + collectedLinks.map(l => l.url).join(' ');
    const handlesToFetch = {};
    if (textToScan.includes('leetcode.com/')) handlesToFetch.leetcode = handle;
    if (textToScan.includes('codeforces.com/')) handlesToFetch.codeforces = handle;
    if (textToScan.includes('hackerrank.com/')) handlesToFetch.hackerrank = handle;
    if (textToScan.includes('dev.to/')) handlesToFetch.devto = handle;

    if (Object.keys(handlesToFetch).length > 0 && handle) {
      try {
        codingStats = await devPlatforms.fetchAllDeveloperProfiles(handlesToFetch);
        if (Object.keys(codingStats).length > 0) {
          raw.push(`[CODING PLATFORM STATS]\n${JSON.stringify(codingStats, null, 2)}`);
        }
      } catch (e) {
        console.error('[stalking] Developer platform stats fetch error:', e.message);
      }
    }

    // ── Step 5: GitHub Deep API & package.json Mining ──
    const github = { handle: githubHandle, repos: [], analyzed: [], techStack: [] };
    if (githubHandle) {
      try {
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
          if (ghUser.blog && !seenUrls.has(ghUser.blog)) {
            const blogUrl = ghUser.blog.startsWith('http') ? ghUser.blog : 'https://' + ghUser.blog;
            seenUrls.add(blogUrl);
            collectedLinks.push({ url: blogUrl, label: `${ghUser.name || githubHandle}'s Portfolio/Website`, source: 'GitHub Profile', highValue: true });
          }
          if (ghUser.twitter_username) {
            const twitterUrl = `https://x.com/${ghUser.twitter_username}`;
            if (!seenUrls.has(twitterUrl)) {
              seenUrls.add(twitterUrl);
              collectedLinks.push({ url: twitterUrl, label: `@${ghUser.twitter_username} on X/Twitter`, source: 'GitHub Profile', highValue: true });
            }
          }
        }

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

          for (const r of reposList) {
            if (r.homepage && !seenUrls.has(r.homepage) && !isJunkUrl(r.homepage)) {
              seenUrls.add(r.homepage);
              collectedLinks.push({ url: r.homepage, label: `${r.name} — Deployed Live Demo`, source: 'GitHub Repo Homepage', highValue: true });
            }
          }

          // Scan READMEs and package.json of top 3 repos
          const topRepos = reposList.slice(0, 3);
          for (const r of topRepos) {
            try {
              const readmeRes = await fetch(`https://raw.githubusercontent.com/${r.full_name}/${r.default_branch || 'main'}/README.md`, { headers: ghHeaders });
              if (readmeRes.ok) {
                const readmeText = await readmeRes.text();
                raw.push(`[README: ${r.full_name}]\n${readmeText.slice(0, 3000)}`);
                const urlRe = /https?:\/\/[^\s\)\"\'<>\]]+/g;
                let m;
                while ((m = urlRe.exec(readmeText)) !== null) {
                  const url = m[0].replace(/[.,;!?]+$/, '');
                  if (!seenUrls.has(url) && !isJunkUrl(url)) {
                    seenUrls.add(url);
                    const isHV = isHighValueProfileUrl(url);
                    collectedLinks.push({ url, label: `${r.name} — README link`, source: 'README', highValue: isHV });
                  }
                }
              }

              // Scan package.json for tech dependencies
              const pkgRes = await fetch(`https://raw.githubusercontent.com/${r.full_name}/${r.default_branch || 'main'}/package.json`, { headers: ghHeaders });
              if (pkgRes.ok) {
                const pkg = await pkgRes.json();
                const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
                github.techStack.push(...deps.slice(0, 10));
              }
            } catch (e) { /* best effort */ }
          }
        }
      } catch (e) { console.error('[stalking] GitHub API error:', e.message); }
    }

    const allTextFinal = raw.join('\n\n');

    // LLM → structured profile card
    let card = null;
    try {
      const res = await callLLM({
        role: 'review',
        messages: [
          { role: 'system', content: 'You build a concise intelligence Profile Card from scraped research about a person/org. Reply with clean JSON only (no markdown fences).' },
          { role: 'user', content: `RESEARCH:\n\n${allTextFinal.slice(0, 16000)}\n\nGITHUB TECH DEPS:\n${JSON.stringify(github.techStack)}\n\nReturn JSON: { "name" (the ACTUAL person's real name), "headline" (job title/role), "bio" (2-3 sentences), "location", "links" (array of key URLs), "socials" (array of strings like "github/username"), "tech" (array of technologies/skills), "certifications" (array of hackathons, badges, or certifications found), "summary" (5-6 bullet insights as array of strings) }` },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      });
      card = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    } catch (e) { card = null; }

    // Deduplicate and filter links
    const validLinks = collectedLinks.filter(l => l.url && !isJunkUrl(l.url));

    const isCleanName = (n) => n && typeof n === 'string' && n.trim() !== '' && !n.toLowerCase().includes('unknown');
    const resolvedName = isCleanName(card?.name) 
      ? card.name.trim() 
      : (isCleanName(prof.name) ? prof.name.trim() : (handle || 'Unknown Profile'));

    const profileData = {
      headline: card?.headline || resolvedName,
      bio: card?.bio || 'No public bio available.',
      location: card?.location || 'unknown',
      links: card?.links || (prof.link ? [prof.link] : []),
      discoveredLinks: validLinks.sort((a, b) => (b.highValue ? 1 : 0) - (a.highValue ? 1 : 0)).slice(0, 20),
      socials: card?.socials || (githubHandle ? [`github/${githubHandle}`] : []),
      tech: [...new Set([...(card?.tech || []), ...github.techStack.slice(0, 8)])],
      certifications: card?.certifications || [],
      summary: card?.summary || [],
      githubHandle,
      githubRepos: github.repos,
      codingStats: codingStats || {},
      lastResearchAt: Date.now(),
    };

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

    // Save points into memory under this target user's name page
    if (Array.isArray(profileData.summary) && profileData.summary.length > 0) {
      for (const pt of profileData.summary.slice(0, 4)) {
        if (pt && pt.length > 5) {
          await memory.addFactUnique(userId, `[Stalker: ${resolvedName}] ${pt}`, 'stalker', {
            sourceTitle: resolvedName,
            sourceType: 'stalker',
            sessionId: prof.chatSessionId || null,
          }).catch(() => {});
        }
      }
    }

    return getProfile(userId, profId);
  } catch (err) {
    await coll(userId).doc(profId).set({ status: 'error', error: err.message, updatedAt: Date.now() }, { merge: true });
    throw err;
  }
}

// ── Per-profile chat (context-isolated) ───────────────────
async function ensureChatSession(userId, prof) {
  if (prof.chatSessionId) return prof.chatSessionId;
  const s = await memory.createSession(userId, `🕵️ ${prof.name}`, 'stalker');
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

// ── Command detection ─────────────────────────────────────
function detectChatCommand(msg) {
  const m = String(msg || '').trim();
  const low = m.toLowerCase();

  // re-research / research again
  if (/^(re[- ]?research|research (again|phir se|dubara)|phir se research|dubara research)/i.test(m))
    return { type: 're_research' };

  // clear links / remove links / links hatao / clear all links
  if (/^(clear|remove|delete|hatao) (all )?(discovered )?links?/i.test(m) || /(links|link) (clear|remove|delete|hatao)/i.test(m) || /sab links (remove|hatao|delete)/i.test(m))
    return { type: 'clear_links' };

  // clear insights / remove insights
  if (/^(clear|remove|delete|hatao) (all )?insights?/i.test(m) || /insights (clear|remove|delete|hatao)/i.test(m))
    return { type: 'clear_insights' };

  // find more links / aur links dhundo
  if (/^(find more links|aur links (dhundo|dhoond)|more links|links dhundo)/i.test(m))
    return { type: 'find_links' };

  // deep dive / deep study / aur study karo
  if (/^(deep[- ]?dive|deep[- ]?study|aur (zyada|jyada|deep|aur) (study|research) karo?|aur study karo?|aur research karo?)/i.test(m))
    return { type: 'deep_study' };

  // add insight / add this
  const addInsight = m.match(/^(add (insight|this|fact|info|information):?)\s+(.+)/is);
  if (addInsight) return { type: 'add_insight', value: addInsight[3].trim() };

  // add tech / add skills
  const addTech = m.match(/^add (tech|skill|technology|stack):?\s+(.+)/i);
  if (addTech) return { type: 'add_tech', value: addTech[2].trim() };

  // add link
  const addLink = m.match(/^add link:?\s+(https?:\/\/\S+)/i);
  if (addLink) return { type: 'add_link', value: addLink[1].trim() };

  // edit bio
  const editBio = m.match(/^(edit|update|correct|change) bio:?\s+(.+)/is);
  if (editBio) return { type: 'edit_bio', value: editBio[2].trim() };

  // edit headline
  const editHL = m.match(/^(edit|update|correct|change) headline:?\s+(.+)/is);
  if (editHL) return { type: 'edit_headline', value: editHL[2].trim() };

  // edit location
  const editLoc = m.match(/^(edit|update|correct|change) location:?\s+(.+)/is);
  if (editLoc) return { type: 'edit_location', value: editLoc[2].trim() };

  // correct name
  const editName = m.match(/^(correct|fix|update|change) name:?\s+(.+)/is);
  if (editName) return { type: 'edit_name', value: editName[2].trim() };

  // correct this: field = value
  const correctThis = m.match(/^correct this:?\s+(\w+)\s*=\s*(.+)/is);
  if (correctThis) return { type: 'correct_field', field: correctThis[1].toLowerCase().trim(), value: correctThis[2].trim() };

  return null; // no command — normal chat
}

// ── Patch profile data from a chat command ────────────────
async function patchProfileFromChat(userId, profId, command) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');
  const pd = prof.profileData || {};

  let patch = {};
  let reply = '';

  switch (command.type) {
    case 'clear_links': {
      patch = { profileData: { ...pd, discoveredLinks: [] } };
      reply = `✅ Profile ke saare Discovered Links clear/remove kar diye hain!`;
      break;
    }
    case 'clear_insights': {
      patch = { profileData: { ...pd, summary: [] } };
      reply = `✅ Profile ke saare Insights clear/remove kar diye hain!`;
      break;
    }
    case 'add_insight': {
      const existing = pd.summary || [];
      if (!existing.includes(command.value)) existing.push(command.value);
      patch = { profileData: { ...pd, summary: existing } };
      reply = `✅ Insight add ho gaya profile card me:\n"${command.value}"`;
      break;
    }
    case 'add_tech': {
      const existing = pd.tech || [];
      const newItems = command.value.split(/[,،]+/).map(t => t.trim()).filter(Boolean);
      const merged = [...new Set([...existing, ...newItems])];
      patch = { profileData: { ...pd, tech: merged } };
      reply = `✅ Tech stack update ho gaya: ${newItems.join(', ')} add kiya.`;
      break;
    }
    case 'add_link': {
      const existing = pd.links || [];
      if (!existing.includes(command.value)) existing.push(command.value);
      const discoveredLinks = pd.discoveredLinks || [];
      const alreadyInDiscovered = discoveredLinks.some(l => l.url === command.value);
      if (!alreadyInDiscovered) {
        discoveredLinks.unshift({ url: command.value, label: command.value, source: 'User Added', highValue: true });
      }
      patch = { profileData: { ...pd, links: existing, discoveredLinks } };
      reply = `✅ Link add ho gaya profile card me:\n${command.value}`;
      break;
    }
    case 'edit_bio': {
      patch = { profileData: { ...pd, bio: command.value } };
      reply = `✅ Bio update ho gaya:\n"${command.value}"`;
      break;
    }
    case 'edit_headline': {
      patch = { profileData: { ...pd, headline: command.value } };
      reply = `✅ Headline update ho gaya:\n"${command.value}"`;
      break;
    }
    case 'edit_location': {
      patch = { profileData: { ...pd, location: command.value } };
      reply = `✅ Location update ho gaya: ${command.value}`;
      break;
    }
    case 'edit_name': {
      const updatedPd = { ...pd };
      if (!updatedPd.headline || updatedPd.headline === 'Unknown' || updatedPd.headline === prof.name) {
        updatedPd.headline = command.value;
      }
      patch = { name: command.value, profileData: updatedPd };
      reply = `✅ Name fix ho gaya: "${command.value}"`;
      break;
    }
    case 'correct_field': {
      if (command.field === 'name') {
        const updatedPd = { ...pd };
        if (!updatedPd.headline || updatedPd.headline === 'Unknown' || updatedPd.headline === prof.name) {
          updatedPd.headline = command.value;
        }
        patch = { name: command.value, profileData: updatedPd };
      } else {
        patch = { profileData: { ...pd, [command.field]: command.value } };
      }
      reply = `✅ "${command.field}" correct ho gaya:\n"${command.value}"`;
      break;
    }
    default:
      reply = 'Command samajh nahi aaya — please phir se try karo.';
  }

  if (Object.keys(patch).length) {
    patch.updatedAt = Date.now();
    await coll(userId).doc(profId).set(patch, { merge: true });
  }

  return { reply, updatedProfile: await getProfile(userId, profId) };
}

// ── Find more links (fresh search + merge) ────────────────
async function findMoreLinks(userId, profId) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');

  const pd = prof.profileData || {};
  const existingUrls = new Set([
    ...(pd.links || []),
    ...(pd.discoveredLinks || []).map(l => l.url),
  ]);

  const { isHighValueProfileUrl, isJunkUrl } = crawler;
  const newLinks = [];

  // Extract handle from primary link or githubHandle
  let handle = pd.githubHandle || '';
  if (!handle && prof.link) {
    const m = prof.link.match(/(?:linkedin\.com\/in\/|github\.com\/|twitter\.com\/|x\.com\/|instagram\.com\/)([A-Za-z0-9_.-]+)/i);
    if (m) handle = m[1];
  }

  // Targeted search queries
  const queries = [];
  if (handle) {
    queries.push(`"${handle}"`);
    queries.push(`"${prof.name}" "${handle}"`);
    queries.push(`"${handle}" portfolio OR github OR linkedin OR twitter OR blog`);
  } else {
    queries.push(`"${prof.name}" developer profile OR portfolio OR github`);
    queries.push(`"${prof.name}" site:linkedin.com OR site:github.com OR site:twitter.com`);
  }

  for (const q of queries) {
    try {
      const search = await web.searchWeb(q, { count: 5 });
      for (const r of search.results) {
        if (!r.url || existingUrls.has(r.url) || isJunkUrl(r.url)) continue;

        const isHV = isHighValueProfileUrl(r.url);
        const lowerUrl = r.url.toLowerCase();
        const lowerTitle = (r.title || '').toLowerCase();
        const lowerHandle = handle ? handle.toLowerCase() : '';

        // Strict relevance check: must be a high-value profile URL OR contain the handle/name
        const isRelevant = isHV || (lowerHandle && (lowerUrl.includes(lowerHandle) || lowerTitle.includes(lowerHandle)));

        if (isRelevant) {
          existingUrls.add(r.url);
          newLinks.push({ url: r.url, label: r.title || r.url, source: 'Find More Search', highValue: isHV });
        }
      }
    } catch (e) { /* best effort */ }
  }

  // Also try scraping top 2 new high-value links
  const toScrape = newLinks.filter(l => l.highValue).slice(0, 2);
  for (const item of toScrape) {
    try {
      const s = await crawler.scrapeURL(item.url, 4000);
      if (s.links) {
        s.links.filter(l => isHighValueProfileUrl(l.url)).slice(0, 4).forEach(l => {
          if (!existingUrls.has(l.url) && !isJunkUrl(l.url)) {
            existingUrls.add(l.url);
            newLinks.push({ url: l.url, label: l.text || l.url, source: 'Find More Crawl', highValue: true });
          }
        });
      }
    } catch (e) { /* best effort */ }
  }

  if (newLinks.length === 0) {
    return { reply: 'Bhai maine kafi dhundha — koi naye links nahi mile jo already profile me na ho. Koi specific link paste karo `add link: [url]` se!', updatedProfile: prof };
  }

  // Merge new links into discoveredLinks
  const merged = [...(pd.discoveredLinks || []), ...newLinks];
  await coll(userId).doc(profId).set({
    profileData: { ...pd, discoveredLinks: merged },
    updatedAt: Date.now(),
  }, { merge: true });

  const highV = newLinks.filter(l => l.highValue);
  const reply = `🔍 ${newLinks.length} naye links mile!\n\n${highV.length ? `**High-value links:**\n${highV.map(l => `• ${l.url}`).join('\n')}\n\n` : ''}Profile card me "Discovered Links" section me dekho.`;
  return { reply, updatedProfile: await getProfile(userId, profId) };
}

// ── Deep study on existing data ───────────────────────────
async function deepStudyProfile(userId, profId) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');

  const pd = prof.profileData || {};
  const raw = [];
  const { isJunkUrl } = crawler;

  // Re-crawl existing primary + high-value links
  const toCrawl = [
    ...(pd.links || []).map(u => ({ url: u, label: 'Primary Link' })),
    ...(pd.discoveredLinks || []).filter(l => l.highValue).slice(0, 3),
  ].slice(0, 5);

  for (const item of toCrawl) {
    try {
      const s = await crawler.scrapeURL(item.url || item, 6000);
      if (s.contentSnippet) {
        raw.push(`[RE-CRAWL: ${item.url || item}]\nTitle: ${s.title}\nContent: ${s.contentSnippet.slice(0, 3000)}`);
      }
    } catch (e) { /* best effort */ }
  }

  // Additional targeted search
  try {
    const q = `${prof.name} ${pd.tech && pd.tech.length ? pd.tech.slice(0, 3).join(' ') : ''} projects work achievements`;
    const search = await web.searchWeb(q, { count: 5 });
    raw.push(`[DEEP SEARCH]\n${search.results.map(r => `- ${r.title}\n  ${r.snippet}`).join('\n')}`);
  } catch (e) { /* best effort */ }

  if (!raw.length) {
    return { reply: 'Deep study ke liye koi crawlable links nahi mile. Pehle kuch links add karo `add link: [url]` se!', updatedProfile: prof };
  }

  // LLM — extract additional insights from fresh data
  const context = buildProfileContext(prof);
  let newInsights = [];
  try {
    const res = await callLLM({
      role: 'review',
      messages: [
        { role: 'system', content: 'You are a deep intelligence analyst. Given existing profile data and newly scraped content, extract NEW insights not already in the profile. Return JSON array of insight strings only.' },
        { role: 'user', content: `EXISTING PROFILE:\n${context}\n\nNEW SCRAPED DATA:\n${raw.join('\n\n').slice(0, 12000)}\n\nReturn JSON array of 3-6 NEW specific insights (things not already covered). Each insight should be a complete sentence.` },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });
    newInsights = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(newInsights)) newInsights = [];
  } catch (e) { newInsights = []; }

  // Merge new insights with existing
  const existingInsights = pd.summary || [];
  const merged = [...new Set([...existingInsights, ...newInsights])];

  await coll(userId).doc(profId).set({
    profileData: { ...pd, summary: merged, lastResearchAt: Date.now() },
    updatedAt: Date.now(),
  }, { merge: true });

  const reply = newInsights.length
    ? `🧠 Deep study complete! **${newInsights.length} naye insights** mile:\n\n${newInsights.map(i => `• ${i}`).join('\n')}`
    : '🧠 Deep study kiya — sab existing data already covered tha. Koi genuinely naya nahi mila. Aur specific angle chahiye toh bolo!';

  return { reply, updatedProfile: await getProfile(userId, profId) };
}

async function chatSend(userId, profId, message) {
  const prof = await getProfile(userId, profId);
  if (!prof) throw new Error('Profile not found');

  // ── Command Detection ────────────────────────────────────
  const command = detectChatCommand(message);

  if (command) {
    // Async background operations
    if (command.type === 'find_links') {
      const result = await findMoreLinks(userId, profId);
      // Save to chat history
      const sid = await ensureChatSession(userId, prof);
      await memory.addMessage(userId, sid, 'user', message);
      await memory.addMessage(userId, sid, 'assistant', result.reply);
      return { reply: result.reply, action: 'data_updated', updatedProfile: result.updatedProfile };
    }

    if (command.type === 'deep_study') {
      const sid = await ensureChatSession(userId, prof);
      await memory.addMessage(userId, sid, 'user', message);
      // Start deep study in background, return immediate ack
      deepStudyProfile(userId, profId).then(async result => {
        await memory.addMessage(userId, sid, 'assistant', result.reply);
      }).catch(err => console.error('[stalking] deep study error:', err.message));
      return { reply: '🔍 Deep study shuru ho gayi... thoda wait karo. Profile card update hogi. Tum tab tak kuch aur pucho!', action: 'studying', updatedProfile: prof };
    }

    if (command.type === 're_research') {
      const sid = await ensureChatSession(userId, prof);
      await memory.addMessage(userId, sid, 'user', message);
      researchProfile(userId, profId).then(async updated => {
        await memory.addMessage(userId, sid, 'assistant', `✅ Re-research complete! Profile card refresh kar di gayi hai.`);
      }).catch(err => console.error('[stalking] re-research error:', err.message));
      return { reply: '🔄 Fresh re-research background me shuru ho gaya hai! Clean search engine se research ho raha hai, thodi der me card update hoga.', action: 'studying', updatedProfile: prof };
    }

    // Synchronous data patch commands
    const patchTypes = ['clear_links','clear_insights','add_insight','add_tech','add_link','edit_bio','edit_headline','edit_location','edit_name','correct_field'];
    if (patchTypes.includes(command.type)) {
      const result = await patchProfileFromChat(userId, profId, command);
      const sid = await ensureChatSession(userId, prof);
      await memory.addMessage(userId, sid, 'user', message);
      await memory.addMessage(userId, sid, 'assistant', result.reply);
      return { reply: result.reply, action: 'data_updated', updatedProfile: result.updatedProfile };
    }
  }

  // ── Normal conversational chat ───────────────────────────
  const sid = await ensureChatSession(userId, prof);
  await memory.addMessage(userId, sid, 'user', message);
  const recent = await memory.getRecentMessages(userId, sid, 20);
  const context = buildProfileContext(prof);

  const systemPrompt = `You are Bob inside Master Nikhil's STALKING WORKSPACE for "${prof.name}".
This chat is STRICTLY about this person/profile only. Help analyze their work, find opportunities, prepare outreach, or figure out how to approach/collaborate.
Never bring up vault, hackathons, or other chats.

PROFILE KNOWLEDGE:
${context}

COMMANDS USER CAN USE (mention these when relevant):
- "clear links" or "remove links" → removes all junk discovered links from profile card
- "clear insights" → removes all insights from profile card
- "re-research" → re-runs full clean deep research on this person
- "add insight: [text]" → adds to profile card insights
- "add tech: [skill1, skill2]" → adds to tech stack
- "add link: [url]" → adds a link to profile
- "edit bio: [text]" → updates bio
- "edit headline: [text]" → updates headline
- "edit location: [place]" → updates location
- "correct name: [name]" → fixes the name
- "find more links" → Bob searches for more links
- "deep dive" → Bob does deeper research on this person

IMPORTANT: NEVER claim you have removed or modified links or profile data unless you used an actual command. If user wants to remove bad/junk links, tell them to type "clear links" or "re-research"!
Be sharp, specific, and honest about what is known vs guessed. Use Hinglish when natural.`;

  const { text, model } = await callLLM({
    role: 'chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recent.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content })),
    ],
  });
  await memory.addMessage(userId, sid, 'assistant', text);
  return { reply: text, model, sessionId: sid, action: 'chat' };
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
