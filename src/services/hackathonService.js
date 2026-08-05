// ---------------------------------------------------------------------------
// Bob HQ — Hackathon Service
// Each hackathon = its OWN Firestore doc + its OWN chat session. The chat is
// strictly scoped to that hackathon's knowledge so no other conversation
// leaks in ("per-workspace context isolation").
//
//   users/{uid}/hackathons/{hackId} → { title, link, source, startDate,
//     endDate, mode, prize, description, rules[], winners, notes, status,
//     tracking, participating, pastParticipation, chatSessionId,
//     knowledge: { summary, dates[], prizes[], links[], scrapedAt },
//     autoRoutineId, createdAt, updatedAt }
//
// The GitHub Actions pump (POST /api/routines/pump) calls autoExpireAndRemind
// so hackathons auto-turn-off after their end date and Bob reminds Master
// about participated / ending ones.
// ---------------------------------------------------------------------------
const { db } = require('../config/firebase');
const memory = require('./memoryService');
const crawler = require('./crawlerService');
const { callLLM } = require('./llmService');

const DEFAULT_AUTO_INTERVAL_HOURS = 72; // every 3 days

function coll(userId) {
  return db.collection('users').doc(userId).collection('hackathons');
}

function nowTs() { return Date.now(); }

function detectSource(link, title) {
  const t = String(link || '').toLowerCase() + ' ' + String(title || '').toLowerCase();
  if (t.includes('unstop')) return 'unstop';
  if (t.includes('devpost')) return 'devpost';
  if (t.includes('abtalks')) return 'abtalks';
  if (t.includes('hackerearth')) return 'hackerearth';
  if (t.includes('codechef')) return 'codechef';
  return 'manual';
}

function statusFromDates(startDate, endDate) {
  const now = Date.now();
  if (endDate && endDate < now) return 'ended';
  if (startDate && startDate <= now && (!endDate || endDate >= now)) return 'live';
  if (startDate && startDate > now) return 'upcoming';
  return 'active';
}

async function parseFromText(userId, rawText) {
  if (!rawText || typeof rawText !== 'string') throw new Error('Raw text is required');
  const res = await callLLM({
    role: 'review',
    messages: [
      {
        role: 'system',
        content: 'You are a structured data extractor for hackathons. Analyze the user text and return clean JSON only (no markdown code fences). Extract title, link, startDate (timestamp ms or null), endDate (timestamp ms or null), prize, mode ("online"|"offline"|"unknown"), description (2-3 sentences max), rules (array of strings).'
      },
      {
        role: 'user',
        content: `Extract hackathon details from this text:\n\n${rawText}`
      }
    ],
    temperature: 0.2,
    max_tokens: 800
  });

  let parsed = {};
  try {
    parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim());
  } catch (e) {
    parsed = {};
  }

  // Fallbacks if LLM output missed timestamps
  const linkMatch = rawText.match(/https?:\/\/[^\s]+/i);
  const link = parsed.link || (linkMatch ? linkMatch[0] : '');
  const title = parsed.title || 'Untitled Hackathon';

  return {
    title,
    link,
    startDate: parsed.startDate || null,
    endDate: parsed.endDate || null,
    prize: parsed.prize || '',
    mode: parsed.mode || 'online',
    description: parsed.description || rawText.slice(0, 300),
    rules: Array.isArray(parsed.rules) ? parsed.rules : []
  };
}

// ── CRUD ─────────────────────────────────────────────────
async function createHackathon(userId, { title, link, source, startDate, endDate, mode = 'unknown', prize = '', description = '', rules = [], participating = false, tracking = true }) {
  const cleanLink = String(link || '').trim();
  const name = (title || '').trim() || (cleanLink ? new URL(cleanLink).hostname.replace(/^www\./, '') : 'Untitled Hackathon');
  const ref = coll(userId).doc();
  const now = nowTs();
  const hack = {
    id: ref.id,
    title: name,
    link: cleanLink,
    source: source || detectSource(cleanLink, name),
    startDate: startDate ? Number(startDate) : null,
    endDate: endDate ? Number(endDate) : null,
    mode: mode || 'unknown',
    prize: prize || '',
    description: description || '',
    rules: Array.isArray(rules) ? rules : [],
    winners: '',
    notes: '',
    status: statusFromDates(startDate ? Number(startDate) : null, endDate ? Number(endDate) : null),
    tracking: Boolean(tracking),
    participating: Boolean(participating),
    pastParticipation: false,
    chatSessionId: null,
    autoRoutineId: null,
    knowledge: (description || prize || rules.length) ? {
      summary: description,
      title: name,
      dates: [],
      prizes: prize ? [prize] : [],
      mode: mode || 'online',
      rules: Array.isArray(rules) ? rules : [],
      eligibility: '',
      winners: '',
      links: cleanLink ? [cleanLink] : [],
      scrapedAt: now,
    } : null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(hack);
  if (hack.link) {
    try { await refreshKnowledge(userId, hack.id); } catch (e) { /* knowledge is best-effort */ }
  }
  if (hack.tracking) {
    try { hack.autoRoutineId = await ensureAutoRoutine(userId, hack.id); } catch (e) { /* no routine */ }
  }
  await ref.set({ autoRoutineId: hack.autoRoutineId || null, updatedAt: nowTs() }, { merge: true });
  return getHackathon(userId, hack.id);
}

async function getHackathon(userId, hackId) {
  const doc = await coll(userId).doc(hackId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function listHackathons(userId) {
  const snap = await coll(userId).orderBy('createdAt', 'desc').get();
  const hacks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const now = Date.now();
  for (const h of hacks) {
    const st = statusFromDates(h.startDate, h.endDate);
    if (st !== h.status) {
      h.status = st;
      await coll(userId).doc(h.id).set({ status: st }, { merge: true });
    }
    h.statusColor = st === 'ended' ? 'grey' : (h.participating || h.pastParticipation ? 'green' : 'amber');
  }
  return hacks;
}

async function updateHackathon(userId, hackId, patch = {}) {
  const allowed = ['title', 'link', 'source', 'startDate', 'endDate', 'mode', 'prize', 'description', 'rules', 'winners', 'notes', 'participating', 'pastParticipation', 'tracking', 'status'];
  const clean = {};
  for (const k of allowed) {
    if (k in patch) clean[k] = patch[k];
  }
  if ('endDate' in clean || 'startDate' in clean) {
    const h = await getHackathon(userId, hackId);
    const sd = clean.startDate !== undefined ? clean.startDate : (h ? h.startDate : null);
    const ed = clean.endDate !== undefined ? clean.endDate : (h ? h.endDate : null);
    clean.status = statusFromDates(sd, ed);
  }
  clean.updatedAt = nowTs();
  await coll(userId).doc(hackId).set(clean, { merge: true });

  const h = await getHackathon(userId, hackId);
  if (h && h.tracking && !h.autoRoutineId) {
    const rid = await ensureAutoRoutine(userId, hackId);
    await coll(userId).doc(hackId).set({ autoRoutineId: rid }, { merge: true });
  }
  if (h && !h.tracking && h.autoRoutineId) {
    await disableAutoRoutine(userId, hackId, h.autoRoutineId);
    await coll(userId).doc(hackId).set({ autoRoutineId: null }, { merge: true });
  }
  return getHackathon(userId, hackId);
}

async function deleteHackathon(userId, hackId) {
  const h = await getHackathon(userId, hackId);
  if (h) {
    if (h.autoRoutineId) await disableAutoRoutine(userId, hackId, h.autoRoutineId);
    if (h.chatSessionId) await memory.deleteSession(userId, h.chatSessionId).catch(() => {});
  }
  await coll(userId).doc(hackId).delete();
  return { success: true };
}

// ── Knowledge: scrape link + LLM extraction ──────────────

/**
 * Resolve a stored hackathon link to the actual content URL.
 * Handles login-redirect patterns like:
 *   https://www.abtalks.in/login?from=/hackathon/register
 * → https://www.abtalks.in/hackathon/register
 */
function resolveHackathonUrl(rawLink) {
  try {
    const u = new URL(rawLink);
    // Pattern: /login?from=<path>  (abtalks, hackerearth, etc.)
    if ((u.pathname === '/login' || u.pathname.endsWith('/login')) && u.searchParams.has('from')) {
      const fromPath = u.searchParams.get('from'); // e.g. "/hackathon/register"
      return `${u.origin}${fromPath}`;
    }
    // Pattern: /signin?redirect=<url> or /auth?next=<url>
    for (const param of ['redirect', 'redirect_uri', 'next', 'returnUrl', 'return_to']) {
      if (u.searchParams.has(param)) {
        const val = u.searchParams.get(param);
        try {
          // If it's a full URL
          const redir = new URL(val);
          return redir.href;
        } catch {
          // Relative path
          return `${u.origin}${val.startsWith('/') ? '' : '/'}${val}`;
        }
      }
    }
  } catch (e) { /* not a valid URL, return as-is */ }
  return rawLink;
}

async function refreshKnowledge(userId, hackId) {
  const h = await getHackathon(userId, hackId);
  if (!h) throw new Error('Hackathon not found');
  if (!h.link) throw new Error('Hackathon has no link to scrape');

  // Resolve login-redirect URLs before scraping
  const scrapeUrl = resolveHackathonUrl(h.link);
  if (scrapeUrl !== h.link) {
    console.log(`refreshKnowledge: resolved login-redirect\n  from: ${h.link}\n  to:   ${scrapeUrl}`);
  }

  // Step 1: Scrape ONLY the main hackathon page (single fetch, hard timeout)
  let scraped = { title: h.title, description: h.description || '', headings: [], contentSnippet: h.description || '' };
  try {
    scraped = await crawler.scrapeURL(scrapeUrl, 12000); // 12s hard timeout
  } catch (e) {
    console.error('refreshKnowledge scrape fallback:', e.message);
    // Continue with existing data — don't crash
  }

  const meta = crawler.extractEventMeta(scraped.contentSnippet || '');

  const combinedText = [
    `TITLE: ${scraped.title}`,
    `DESCRIPTION: ${scraped.description}`,
    ...(scraped.headings || []),
    scraped.contentSnippet,
  ].join('\n').slice(0, 6000);

  // Step 2: LLM extraction (only if we got some meaningful content)
  let extracted = null;
  const todayStr = new Date().toISOString().slice(0, 10); // e.g. "2026-08-05"
  if (combinedText.length > 100) {
    try {
      const res = await callLLM({
        role: 'review',
        messages: [
          {
            role: 'system',
            content: `You extract structured hackathon details from raw scraped web content. Reply with clean JSON only (no markdown fences).
TODAY'S DATE: ${todayStr}. If the page shows multiple years (e.g. 2024, 2025, 2026), always prefer the UPCOMING or CURRENT edition (closest to today or in the future). Never return a date from a past edition if a future/current edition exists on the page.`
          },
          { role: 'user', content: `Scraped content:\n\n${combinedText}\n\nReturn JSON: { "title", "startDate" (YYYY-MM-DD or null), "endDate" (YYYY-MM-DD or null), "mode" ("online"/"offline"/"unknown"), "prize", "description" (2-3 sentences), "rules" (array, max 6), "eligibility", "winners" (known past winners, else "") }` },
        ],
        temperature: 0.2,
        max_tokens: 800,
      });
      extracted = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    } catch (e) {
      extracted = null;
    }
  }

  const knowledge = {
    summary: extracted?.description || scraped.description || (scraped.contentSnippet || '').slice(0, 600),
    title: extracted?.title || scraped.title || h.title,
    dates: meta.dates.length ? meta.dates : (extracted?.startDate ? [extracted.startDate] : []),
    prizes: meta.prize.length ? meta.prize : (extracted?.prize ? [extracted.prize] : []),
    mode: extracted?.mode || meta.mode || h.mode || 'unknown',
    rules: extracted?.rules || h.rules || [],
    eligibility: extracted?.eligibility || '',
    winners: extracted?.winners || h.winners || '',
    links: [...new Set([h.link, scrapeUrl])], // original + resolved (deduped)
    scrapedUrl: scrapeUrl,
    scrapedAt: nowTs(),
  };

  const patch = {
    knowledge,
    mode: knowledge.mode,
    prize: knowledge.prizes[0] || h.prize || '',
    title: knowledge.title,
    description: knowledge.summary || h.description || '',
    updatedAt: nowTs(),
  };

  // ── Guard: only overwrite dates if scraped date is NOT in the past ──────────
  // Prevents a 2025 historical edition from overwriting the user's 2026 dates.
  const nowMs = Date.now();
  if (extracted?.startDate) {
    const scrapedStart = new Date(extracted.startDate).getTime();
    const userStart = h.startDate || 0;
    // Accept scraped date only if it's upcoming/today OR user had no date set
    if (!userStart || scrapedStart >= nowMs - 24 * 60 * 60 * 1000) {
      patch.startDate = scrapedStart;
    } else {
      console.log(`refreshKnowledge: ignoring stale scraped startDate ${extracted.startDate} (user has ${new Date(userStart).toISOString().slice(0,10)})`);
    }
  }
  if (extracted?.endDate) {
    const scrapedEnd = new Date(extracted.endDate).getTime();
    const userEnd = h.endDate || 0;
    // Accept scraped end date only if it's in the future OR user had none
    if (!userEnd || scrapedEnd >= nowMs) {
      patch.endDate = scrapedEnd;
    } else {
      console.log(`refreshKnowledge: ignoring stale scraped endDate ${extracted.endDate} (user has ${new Date(userEnd).toISOString().slice(0,10)})`);
    }
  }

  patch.status = statusFromDates(
    patch.startDate !== undefined ? patch.startDate : h.startDate,
    patch.endDate !== undefined ? patch.endDate : h.endDate
  );
  await coll(userId).doc(hackId).set(patch, { merge: true });
  return getHackathon(userId, hackId);
}

// ── Per-hackathon chat session (context-isolated) ────────
async function ensureChatSession(userId, hack) {
  if (hack.chatSessionId) return hack.chatSessionId;

  // Try to find an existing session with matching title before creating a new one
  try {
    const sessions = await memory.listSessions(userId);
    const expectedTitle = `🏆 ${hack.title}`;
    const match = sessions.find(s => s.title === expectedTitle);
    if (match) {
      await coll(userId).doc(hack.id).set({ chatSessionId: match.id }, { merge: true });
      console.log(`ensureChatSession: re-linked existing session ${match.id} for hack="${hack.title}"`);
      return match.id;
    }
  } catch (e) { /* best-effort */ }

  const s = await memory.createSession(userId, `🏆 ${hack.title}`);
  await coll(userId).doc(hack.id).set({ chatSessionId: s.id }, { merge: true });
  return s.id;
}

async function buildHackContext(userId, hack) {
  const k = hack.knowledge || {};
  const lines = [
    `HACKATHON: ${hack.title}`,
    `Link: ${hack.link || '—'}`,
    `Source: ${hack.source}`,
    `Status: ${hack.status}`,
    `Participating: ${hack.participating ? 'YES' : 'no'}${hack.pastParticipation ? ' (participated before)' : ''}`,
    hack.startDate ? `Start: ${new Date(hack.startDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Start: unknown',
    hack.endDate ? `End: ${new Date(hack.endDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'End: unknown',
    hack.mode !== 'unknown' ? `Mode: ${hack.mode}` : '',
    hack.prize ? `Prize: ${hack.prize}` : '',
    k.summary ? `Summary: ${k.summary}` : '',
    k.rules && k.rules.length ? `Rules:\n${k.rules.map(r => '- ' + r).join('\n')}` : '',
    k.eligibility ? `Eligibility: ${k.eligibility}` : '',
    k.winners ? `Past winners: ${k.winners}` : '',
    hack.notes ? `My notes:\n${hack.notes}` : '',
    `Known dates from page: ${(k.dates || []).join(', ') || 'none'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function chatSend(userId, hackId, message) {
  const hack = await getHackathon(userId, hackId);
  if (!hack) throw new Error('Hackathon not found');

  const sid = await ensureChatSession(userId, hack);
  await memory.addMessage(userId, sid, 'user', message);

  const recent = await memory.getRecentMessages(userId, sid, 20);
  const context = await buildHackContext(userId, hack);

  const systemPrompt = `You are Bob, Master Nikhil's personal AI, inside the "${hack.title}" HACKATHON WORKSPACE.
This chat is STRICTLY about this hackathon only. Never bring up vault, stalking, other hackathons, or other chats.
Help with ideation, planning, team formation, tech stack, implementation, submission prep, and timelines.

HACKATHON KNOWLEDGE:
${context}

Be practical and specific. Use Hinglish when natural.`;
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

async function chatList(userId, hackId) {
  const hack = await getHackathon(userId, hackId);
  if (!hack) throw new Error('Hackathon not found');

  let sessionId = hack.chatSessionId;

  // ── Auto-recover lost chatSessionId ──────────────────────
  // If chatSessionId is missing, scan sessions for one with a matching title.
  // This heals the case where the Firestore field was accidentally cleared.
  if (!sessionId) {
    try {
      const sessions = await memory.listSessions(userId);
      const expectedTitle = `🏆 ${hack.title}`;
      const match = sessions.find(s => s.title === expectedTitle);
      if (match) {
        sessionId = match.id;
        // Re-link so future loads don't need to scan
        await coll(userId).doc(hackId).set({ chatSessionId: sessionId }, { merge: true });
        console.log(`chatList: recovered lost chatSessionId=${sessionId} for hack="${hack.title}"`);
      }
    } catch (e) {
      console.error('chatList: session recovery scan failed:', e.message);
    }
  }

  if (!sessionId) return [];
  try {
    return await memory.getRecentMessages(userId, sessionId, 100);
  } catch (e) {
    console.error(`chatList: getRecentMessages failed for session ${sessionId}:`, e.message);
    return [];
  }
}

// ── Auto-routine (every-3-days tracking) ─────────────────
// Routines live in users/{uid}/routines — handled by routineService.
async function ensureAutoRoutine(userId, hackId) {
  const routines = require('./routineService');
  const existing = await routines.listRoutines(userId);
  const found = existing.find(r => r.target && r.target.hackathonId === hackId);
  if (found) return found.id;
  const r = await routines.createRoutine(userId, {
    title: `🏆 ${(await getHackathon(userId, hackId)).title} — auto-track`,
    prompt: 'Analyze the current status of this hackathon: any updates to dates, prizes, rules, deadlines, or important announcements. Note what I should do next (prepare ideation, register, form team, build MVP, submit). Keep it short and actionable.',
    intervalHours: DEFAULT_AUTO_INTERVAL_HOURS,
    workspace: 'hackathon',
    target: { hackathonId: hackId },
    active: true,
  });
  return r.id;
}

async function disableAutoRoutine(userId, hackId, routineId) {
  const routines = require('./routineService');
  try {
    await routines.updateRoutine(userId, routineId, { active: false });
  } catch (e) { /* ignore */ }
}

// ── Pump: auto-expire + reminders (called every 5 min) ───
async function autoExpireAndRemind() {
  const now = Date.now();
  let processed = 0;
  const snap = await db.collectionGroup('hackathons').get();
  for (const doc of snap.docs) {
    const uid = doc.ref.parent.parent.id;
    const h = { id: doc.id, ...doc.data() };
    const ended = h.endDate && h.endDate < now;
    const st = statusFromDates(h.startDate, h.endDate);

    if (ended && h.status !== 'ended') {
      await coll(uid).doc(h.id).set({
        status: 'ended',
        tracking: false,
        pastParticipation: h.participating,
        updatedAt: now,
      }, { merge: true });
      if (h.autoRoutineId) {
        try { await disableAutoRoutine(uid, h.id, h.autoRoutineId); } catch (e) {}
        await coll(uid).doc(h.id).set({ autoRoutineId: null }, { merge: true });
      }
      await memory.addNotification(
        uid,
        `🏆 Hackathon ended: ${h.title}`,
        h.participating
          ? `Participated hackathon khatam ho gaya. Master, achha attempt tha — submission/progress apne notes me daal dena.`
          : `"${h.title}" ka end date nikal gaya. Toggle automatically OFF ho gaya.`
      );
      processed++;
      continue;
    }

    // Remind for participating hackathons nearing end (within 48h) — at most once
    if ((h.participating || h.status === 'active') && h.endDate && !ended) {
      const msLeft = h.endDate - now;
      if (msLeft > 0 && msLeft < 48 * 60 * 60 * 1000) {
        const remindKey = `hackRemind-${h.id}`;
        const flagDoc = await db.collection('users').doc(uid).collection('pumpFlags').doc(remindKey).get();
        if (!flagDoc.exists) {
          await memory.addNotification(
            uid,
            `⏰ ${h.title} ending soon`,
            `Sirf ${Math.ceil(msLeft / 3600000)} hours left! Last push karo — submit karna mat bhoolna.`
          );
          await db.collection('users').doc(uid).collection('pumpFlags').doc(remindKey).set({ ts: now });
          processed++;
        }
      }
    }
  }
  return { processed };
}

module.exports = {
  createHackathon, getHackathon, listHackathons, updateHackathon, deleteHackathon,
  refreshKnowledge, chatSend, chatList, ensureAutoRoutine, autoExpireAndRemind, statusFromDates, parseFromText,
};
