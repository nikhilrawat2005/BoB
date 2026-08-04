// ---------------------------------------------------------------------------
// Bob HQ — Self-Prompt Routine Engine
// Bob asks ITSELF on a schedule. Each routine holds a prompt + interval; when
// due, Bob gathers the relevant workspace context, runs the prompt, appends the
// answer to that workspace's own chat, and raises a notification. Master just
// receives output — he never has to prompt.
//
//   users/{uid}/routines/{id} → { id, title, prompt, intervalHours, nextRunAt,
//     lastRunAt, lastResult, active, workspace, target: { hackathonId?,
//     profileId? }, chatSessionId, createdAt, updatedAt }
//
// The GitHub Actions pump (POST /api/routines/pump, every 5 min) calls
// processDueRoutines(). hackathonService's auto-track uses this engine too.
// ---------------------------------------------------------------------------
const { db } = require('../config/firebase');
const memory = require('./memoryService');
const { callLLM } = require('./llmService');
const news = require('./newsService');
const stocks = require('./stocksService');

const VALID_WORKSPACES = ['vault', 'hackathon', 'stalking', 'bob', 'market', 'habit', 'custom'];

function coll(userId) {
  return db.collection('users').doc(userId).collection('routines');
}

function nowTs() { return Date.now(); }

// ── CRUD ─────────────────────────────────────────────────
async function createRoutine(userId, { title, prompt, intervalHours = 72, workspace = 'custom', target = null, active = true }) {
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    throw new Error('prompt is required (string under 4000 chars)');
  }
  const ws = VALID_WORKSPACES.includes(workspace) ? workspace : 'custom';
  const ref = coll(userId).doc();
  const now = nowTs();
  const routine = {
    id: ref.id,
    title: String(title || 'Routine').trim().slice(0, 120) || 'Routine',
    prompt: prompt.trim(),
    intervalHours: Math.max(1, Number(intervalHours) || 72),
    nextRunAt: now + (Math.max(1, Number(intervalHours) || 72) * 3600 * 1000),
    lastRunAt: null,
    lastResult: null,
    active: Boolean(active),
    workspace: ws,
    target: target || null,
    chatSessionId: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(routine);
  return routine;
}

async function getRoutine(userId, routineId) {
  const doc = await coll(userId).doc(routineId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function listRoutines(userId) {
  const snap = await coll(userId).orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function updateRoutine(userId, routineId, patch = {}) {
  const clean = {};
  for (const k of ['title', 'prompt', 'intervalHours', 'active', 'workspace', 'target']) {
    if (k in patch) clean[k] = patch[k];
  }
  if ('intervalHours' in clean) clean.intervalHours = Math.max(1, Number(clean.intervalHours) || 72);
  if ('active' in clean && clean.active) {
    const r = await getRoutine(userId, routineId);
    if (r && !r.nextRunAt) clean.nextRunAt = nowTs() + clean.intervalHours * 3600 * 1000;
  }
  clean.updatedAt = nowTs();
  await coll(userId).doc(routineId).set(clean, { merge: true });
  return getRoutine(userId, routineId);
}

async function deleteRoutine(userId, routineId) {
  const r = await getRoutine(userId, routineId);
  if (r && r.chatSessionId) await memory.deleteSession(userId, r.chatSessionId).catch(() => {});
  await coll(userId).doc(routineId).delete();
  return { success: true };
}

// ── Workspace context builders ───────────────────────────
async function buildContext(userId, routine) {
  const parts = [];

  if (routine.workspace === 'vault') {
    const msgs = await memory.getVaultMessages(userId, 30);
    if (msgs.length) parts.push(`SECRET VAULT RECENT CONVERSATION:\n${msgs.map(m => `${m.role === 'user' ? 'Nikhil' : 'Bob'}: ${m.content}`).join('\n')}`);
  }

  if (routine.workspace === 'hackathon') {
    const hacks = require('./hackathonService');
    if (routine.target && routine.target.hackathonId) {
      const h = await hacks.getHackathon(userId, routine.target.hackathonId);
      if (h) parts.push(`HACKATHON: ${h.title}\n${await buildHackContextSafe(h)}`);
    } else {
      const list = await hacks.listHackathons(userId);
      if (list.length) {
        parts.push(`MY HACKATHONS:\n${list.map(h => `- ${h.title} [${h.status}]${h.participating ? ' (participating)' : ''}${h.tracking ? ' (tracking ON)' : ''}${h.endDate ? ' ends ' + new Date(h.endDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}`).join('\n')}`);
      } else {
        parts.push('MY HACKATHONS: (none added yet)');
      }
    }
  }

  if (routine.workspace === 'stalking') {
    const stalk = require('./stalkingService');
    if (routine.target && routine.target.profileId) {
      const p = await stalk.getProfile(userId, routine.target.profileId);
      if (p && p.profileData) parts.push(`PROFILE ${p.name}:\n${p.profileData.summary ? p.profileData.summary.map(s => '- ' + s).join('\n') : p.profileData.bio}`);
    } else {
      const list = await stalk.listProfiles(userId);
      if (list.length) parts.push(`TRACKED PROFILES:\n${list.map(p => `- ${p.name} [${p.status}]${p.profileData ? ' → ' + (p.profileData.tech || []).slice(0, 5).join(', ') : ''}`).join('\n')}`);
    }
  }

  if (routine.workspace === 'bob') {
    const facts = await memory.listFacts(userId);
    if (facts.length) parts.push(`FACTS ABOUT NIKHIL:\n${facts.map(f => '- ' + f.text).join('\n')}`);
  }

  if (routine.workspace === 'market') {
    try {
      const n = await news.getNews();
      if (n && n.articles && n.articles.length) {
        parts.push(`TOP NEWS:\n${n.articles.slice(0, 5).map(a => `- ${a.title} (${a.source || ''})`).join('\n')}`);
      }
    } catch (e) { parts.push('(news fetch failed)'); }
    try {
      const q = await stocks.getQuotes();
      if (q && q.quotes && q.quotes.length) {
        parts.push(`STOCKS:\n${q.quotes.map(s => `- ${s.symbol || s.name}: ${s.price}${s.changePct ? ' (' + s.changePct + '%)' : ''}`).join('\n')}`);
      }
    } catch (e) { parts.push('(stocks fetch failed)'); }
  }

  return parts.filter(Boolean).join('\n\n') || '(no additional context available)';
}

async function buildHackContextSafe(h) {
  const k = h.knowledge || {};
  return [
    `Status: ${h.status}`,
    `Link: ${h.link || '—'}`,
    h.endDate ? `End: ${new Date(h.endDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : '',
    h.prize ? `Prize: ${h.prize}` : '',
    k.summary ? `Summary: ${k.summary}` : '',
    k.rules && k.rules.length ? `Rules: ${k.rules.join(' | ')}` : '',
    h.notes ? `Notes: ${h.notes}` : '',
  ].filter(Boolean).join('\n');
}

// ── Workspace chat delivery ───────────────────────────────
async function deliverToWorkspace(userId, routine, text) {
  const memoryModule = memory;

  if (routine.workspace === 'vault') {
    await memoryModule.addVaultMessage(userId, 'assistant', text);
    return { channel: 'vault' };
  }

  if (routine.workspace === 'hackathon') {
    const hacks = require('./hackathonService');
    const targetId = routine.target && routine.target.hackathonId;
    if (targetId) {
      const h = await hacks.getHackathon(userId, targetId);
      if (h) {
        const sid2 = await hacks.ensureChatSession(userId, h);
        await memoryModule.addMessage(userId, sid2, 'assistant', text);
        return { channel: 'hackathon', sessionId: sid2 };
      }
    }
    // fallback: dedicated routine session
    const sid = await ensureRoutineSession(userId, routine);
    await memoryModule.addMessage(userId, sid, 'assistant', text);
    return { channel: 'hackathon', sessionId: sid };
  }

  if (routine.workspace === 'stalking') {
    const stalk = require('./stalkingService');
    const targetId = routine.target && routine.target.profileId;
    if (targetId) {
      const p = await stalk.getProfile(userId, targetId);
      if (p) {
        const sid = await stalk.ensureChatSession ? await stalk.ensureChatSession(userId, p) : null;
        if (sid) {
          await memoryModule.addMessage(userId, sid, 'assistant', text);
          return { channel: 'stalking', sessionId: sid };
        }
      }
    }
    const sid = await ensureRoutineSession(userId, routine);
    await memoryModule.addMessage(userId, sid, 'assistant', text);
    return { channel: 'stalking', sessionId: sid };
  }

  // bob / market / habit / custom → dedicated routine session
  const sid = await ensureRoutineSession(userId, routine);
  await memoryModule.addMessage(userId, sid, 'assistant', text);
  return { channel: routine.workspace, sessionId: sid };
}

async function ensureRoutineSession(userId, routine) {
  if (routine.chatSessionId) return routine.chatSessionId;
  const s = await memory.createSession(userId, `📅 ${routine.title}`);
  await coll(userId).doc(routine.id).set({ chatSessionId: s.id }, { merge: true });
  return s.id;
}

// ── Run one routine now ───────────────────────────────────
async function runRoutine(userId, routine) {
  const context = await buildContext(userId, routine);
  const systemPrompt = `You are Bob, Master Nikhil's personal AI, running an autonomous SELF-CHECK routine titled "${routine.title}".
This is a scheduled self-prompt — you decided it was time to check and report. Generate the result directly (no meta-commentary about being a routine). Keep it tight, specific, actionable. Use Hinglish when natural.`;
  const { text } = await callLLM({
    role: 'chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `ROUTINE PROMPT:\n${routine.prompt}\n\nCURRENT CONTEXT:\n${context}` },
    ],
    temperature: 0.4,
    max_tokens: 2500,
  });

  const delivered = await deliverToWorkspace(userId, routine, text);
  const preview = text.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 160);

  await memory.addNotification(
    userId,
    `📅 ${routine.title}`,
    preview,
    'reminder',
    text
  );

  const now = nowTs();
  const intervalMs = (routine.intervalHours || 72) * 3600 * 1000;
  const patch = {
    lastRunAt: now,
    lastResult: text,
    nextRunAt: now + intervalMs,
    updatedAt: now,
    chatSessionId: delivered.sessionId || routine.chatSessionId || null,
  };
  await coll(userId).doc(routine.id).set(patch, { merge: true });
  return { routineId: routine.id, text, delivered };
}

// ── Pump: run every due routine across all users ──────────
async function processDueRoutines({ maxRoutines = 5 } = {}) {
  const now = nowTs();
  const snap = await db.collectionGroup('routines')
    .where('active', '==', true)
    .where('nextRunAt', '<=', now)
    .limit(20)
    .get();
  const due = snap.docs
    .map(d => ({ __userId: d.ref.parent.parent.id, id: d.id, ...d.data() }))
    .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))
    .slice(0, maxRoutines);

  const results = [];
  for (const r of due) {
    const { __userId, ...routine } = r;
    try {
      const out = await runRoutine(__userId, routine);
      results.push({ id: r.id, ok: true });
    } catch (err) {
      // skip this run, schedule far future to avoid hot-loop
      await coll(__userId).doc(r.id).set({ nextRunAt: now + 24 * 3600 * 1000, lastRunAt: now, updatedAt: now }, { merge: true }).catch(() => {});
      results.push({ id: r.id, ok: false, error: err.message });
    }
  }
  return { processed: results.length, results };
}

module.exports = {
  createRoutine, getRoutine, listRoutines, updateRoutine, deleteRoutine,
  runRoutine, processDueRoutines, ensureRoutineSession,
};
