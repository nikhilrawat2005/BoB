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
    if (prof.link) seenUrls.add(prof.link);

    if (prof.link) {
      try {
        const s = await crawler.scrapeURL(prof.link);
        raw.push(`[LINK: ${prof.link}]\nTitle: ${s.title}\nDescription: ${s.description}\nSnippet: ${s.contentSnippet}`);
        if (s.links && s.links.length) {
          s.links.forEach(l => {
            if (!seenUrls.has(l.url)) {
              seenUrls.add(l.url);
              collectedLinks.push({ url: l.url, label: l.text, source: 'Pasted Link' });
            }
          });
        }
      } catch (e) {
        raw.push(`[LINK: ${prof.link}]\n(scrape failed: ${e.message})`);
      }
    }

    // Web search the name (with context)
    const q = prof.name + (prof.link ? '' : ' developer github profile');
    const search = await web.searchWeb(q, { count: 6 });
    raw.push(`[WEB SEARCH: ${q}]\n${search.results.map(r => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join('\n')}`);

    search.results.forEach(r => {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        collectedLinks.push({ url: r.url, label: r.title, source: 'Web Search' });
      }
    });

    // Scrape top 3 discovered external links for deep intelligence
    const deepToScrape = collectedLinks.slice(0, 3);
    for (const item of deepToScrape) {
      try {
        const sub = await crawler.scrapeURL(item.url, 5000);
        if (sub.contentSnippet) {
          raw.push(`[DEEP CRAWL: ${item.url}]\nTitle: ${sub.title}\nSnippet: ${sub.contentSnippet.slice(0, 2000)}`);
        }
        if (sub.links && sub.links.length) {
          sub.links.slice(0, 5).forEach(l => {
            if (!seenUrls.has(l.url)) {
              seenUrls.add(l.url);
              collectedLinks.push({ url: l.url, label: l.text, source: 'Sub Page' });
            }
          });
        }
      } catch (e) { /* best effort deep scrape */ }
    }

    const allText = raw.join('\n\n');
    let githubHandle = extractGitHubHandle(allText + ' ' + (prof.link || ''));

    // GitHub discovery
    const github = { handle: githubHandle, repos: [], analyzed: [] };
    if (githubHandle) {
      try {
        const res = await repo.searchRepos(githubHandle, 5);
        if (res.items && res.items.length) {
          github.repos = res.items.map(i => ({ name: i.full_name, description: i.description || '', stars: i.stargazers_count || 0, url: i.html_url || `https://github.com/${i.full_name}` }));
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
      } catch (e) { /* github best-effort */ }
    }

    // LLM → structured profile card
    let card = null;
    try {
      const res = await callLLM({
        role: 'review',
        messages: [
          { role: 'system', content: 'You build a concise intelligence Profile Card from scraped research about a person/org. Reply with clean JSON only (no markdown fences).' },
          { role: 'user', content: `RESEARCH:\n\n${allText.slice(0, 15000)}\n\nGITHUB:\n${JSON.stringify(github)}\n\nReturn JSON: { "headline", "bio" (2-3 sentences), "location", "links" (array of key URLs), "socials" (array of strings like "github/username" or "x/handle"), "tech" (array of technologies/skills), "summary" (5-6 bullet insights as array of strings) }` },
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
      discoveredLinks: collectedLinks.slice(0, 15),
      socials: card?.socials || (githubHandle ? [`github/${githubHandle}`] : []),
      tech: card?.tech || [],
      summary: card?.summary || [],
      githubHandle,
      githubRepos: github.repos,
      analyzedRepos: github.analyzed,
      lastResearchAt: Date.now(),
    };

    await coll(userId).doc(profId).set({
      profileData,
      status: 'ready',
      name: card?.headline || prof.name,
      updatedAt: Date.now(),
    }, { merge: true });

    await memory.addNotification(
      userId,
      `🕵️ Stalking complete: ${prof.name}`,
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
