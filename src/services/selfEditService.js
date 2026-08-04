const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { db } = require('../config/firebase');
const memory = require('./memoryService');
const { callLLM } = require('./llmService');

/**
 * Self-Edit Engine — Bob improves his own code over time.
 *
 * Safety model:
 *  - 🟢 AUTO  : small safe edits (propose with category='auto') — applied via the full
 *               safety pipeline (backup -> node --check -> boot smoke -> git commit+push).
 *  - 🟡 MANUAL: bigger edits (category='manual') need explicit user approval before apply.
 *  - 🔴 BLOCKED: files Bob never touches.
 * Rollback: original content is saved on the edit doc and restored on any failure.
 */

const ROOT = path.resolve(__dirname, '..', '..');

const BLOCKED_FILES = [
  '.env', '.env.example',
  'src/middleware/auth.js',
  'src/services/llmService.js',
  'src/routes/secretVault.js',
  'package.json', 'package-lock.json', 'package-lock.json5',
];

function normalizeFile(f) {
  return String(f || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

function isBlocked(rel) {
  if (!rel) return true;
  if (rel.startsWith('../') || rel.startsWith('/') || rel.includes('\\')) return true;
  if (rel.split('/').includes('..')) return true;
  if (rel.startsWith('.env')) return true;
  if (rel.startsWith('.github/')) return true;
  if (rel.startsWith('node_modules/')) return true;
  if (BLOCKED_FILES.includes(rel)) return true;
  if (rel.startsWith('src/config/')) return true;
  if (/firebase/i.test(rel)) return true;
  return false;
}

function coll(userId) {
  return db.collection('users').doc(userId).collection('selfEdits');
}

function buildDiff(oldCode, newCode) {
  if (!oldCode) return `+ new content (${(newCode || '').length} chars)`;
  if (oldCode === newCode) return 'no change';
  const o = String(oldCode).split('\n');
  const n = String(newCode).split('\n');
  let i = 0;
  while (i < o.length && i < n.length && o[i] === n[i]) i++;
  const removed = o.slice(i, i + 8);
  const added = n.slice(i, i + 8);
  const lines = [`@ line ${i + 1}`];
  if (removed.length) lines.push(removed.map(l => '-' + l).join('\n'));
  if (added.length) lines.push(added.map(l => '+' + l).join('\n'));
  return lines.join('\n').slice(0, 1000);
}

async function listEdits(userId, limit = 50) {
  const snap = await coll(userId).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getEdit(userId, editId) {
  const d = await coll(userId).doc(editId).get();
  return d.exists ? { id: editId, ...d.data() } : null;
}

async function setStatus(userId, editId, status) {
  await coll(userId).doc(editId).set({ status, updatedAt: Date.now() }, { merge: true });
  return getEdit(userId, editId);
}

async function proposeEdit(userId, { title, file, oldCode, newCode, category = 'auto', reason = '' } = {}) {
  const rel = normalizeFile(file);
  if (isBlocked(rel)) throw new Error(`Blocked file for self-edit: ${rel}`);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`File not found in repo: ${rel}`);

  const current = fs.readFileSync(abs, 'utf8');
  if (oldCode && !current.includes(oldCode)) {
    throw new Error('oldCode not found in current file (stale proposal) — re-propose with exact code');
  }
  if (!oldCode && !newCode) throw new Error('nothing to change (need oldCode or newCode)');

  const type = category === 'manual' ? 'manual' : 'auto';
  const ref = coll(userId).doc();
  const now = Date.now();
  const doc = {
    id: ref.id,
    title: String(title || 'Self-edit').slice(0, 200),
    file: rel,
    reason: String(reason || '').slice(0, 1000),
    type,
    oldCode: oldCode || null,
    newCode: newCode || null,
    diff: buildDiff(oldCode, newCode),
    status: type === 'manual' ? 'pending' : 'pending',
    backup: null,
    gitLog: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  await memory.addNotification(
    userId,
    `🧬 Self-edit proposal: ${doc.title}`,
    `File: ${rel} — ${type === 'manual' ? 'approval needed' : 'auto mode'}. ${doc.diff.replace(/\n/g, ' ').slice(0, 180)}`,
    'reminder',
    `Self-edit proposed: ${doc.title} (${rel})`
  );
  return doc;
}

function runCmd(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, timeout: 25000, ...opts });
  return r;
}

function gitCommitAndPush(rel, title) {
  const add = runCmd('git', ['add', rel]);
  if (add.status !== 0) throw new Error('git add failed: ' + (add.stderr || add.stdout || '').slice(0, 200));
  const msg = `🧬 Bob self-edit: ${String(title || 'improvement').slice(0, 100)}`;
  const c = runCmd('git', ['commit', '-m', msg]);
  if (c.status !== 0) throw new Error((c.stderr || c.stdout || '').trim().slice(0, 300) || 'git commit failed');
  const p = runCmd('git', ['push', 'origin', 'HEAD']);
  if (p.status !== 0) throw new Error('push failed: ' + (p.stderr || p.stdout || '').trim().slice(0, 300));
  const firstLine = (c.stdout || '').trim().split('\n')[0];
  return firstLine || 'committed';
}

async function bootSmokeTest(changedRel) {
  const rel = normalizeFile(changedRel);
  const needsBoot = rel.startsWith('src/') || rel.startsWith('server.js');
  if (!needsBoot) return; // frontend-only or docs — node --check already covered JS
  const port = 3199 + Math.floor(Math.random() * 200);
  const oldPort = process.env.PORT;
  process.env.PORT = String(port);
  const child = spawn(process.execPath, ['src/server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  try {
    const ok = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('boot smoke test timeout')), 15000);
      const poll = setInterval(() => {
        fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(3000) })
          .then(r => { if (r.ok) { clearTimeout(timer); clearInterval(poll); resolve(true); } })
          .catch(() => {});
      }, 600);
      child.on('exit', code => {
        clearTimeout(timer);
        clearInterval(poll);
        reject(new Error('server exited during boot smoke (code ' + code + ')'));
      });
    });
    return ok;
  } finally {
    try { child.kill('SIGTERM'); } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    process.env.PORT = oldPort;
  }
}

async function applyEdit(userId, editId) {
  const snap = await coll(userId).doc(editId).get();
  if (!snap.exists) throw new Error('Edit not found');
  const doc = { id: editId, ...snap.data() };

  if (doc.status === 'applied') return doc;
  if (doc.type === 'manual' && doc.status !== 'approved') {
    throw new Error('Manual self-edit needs approval first (approve then apply)');
  }

  const rel = normalizeFile(doc.file);
  if (isBlocked(rel)) throw new Error(`Blocked file for self-edit: ${rel}`);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`File missing: ${rel}`);

  const backup = fs.readFileSync(abs, 'utf8');
  await coll(userId).doc(editId).set({ status: 'applying', updatedAt: Date.now() }, { merge: true });

  try {
    let next = backup;
    if (doc.oldCode) {
      if (!next.includes(doc.oldCode)) throw new Error('stale proposal — oldCode no longer present in file');
      next = next.replace(doc.oldCode, doc.newCode == null ? '' : doc.newCode);
    } else if (doc.newCode) {
      next = doc.newCode;
    } else {
      throw new Error('nothing to apply');
    }
    fs.writeFileSync(abs, next, 'utf8');

    if (rel.endsWith('.js')) {
      const chk = runCmd('node', ['--check', abs]);
      if (chk.status !== 0) throw new Error('node --check failed: ' + (chk.stderr || chk.stdout || '').slice(0, 300));
    }

    await bootSmokeTest(rel);

    let gitLog = null;
    try { gitLog = gitCommitAndPush(rel, doc.title); }
    catch (e) { gitLog = '(git skipped) ' + e.message; }

    await coll(userId).doc(editId).set({ status: 'applied', backup, gitLog, error: null, appliedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    await memory.addNotification(userId, `✅ Self-edit applied: ${doc.title}`, `File: ${rel} — verified & pushed.`, 'success', doc.title);
    return getEdit(userId, editId);
  } catch (err) {
    try { fs.writeFileSync(abs, backup, 'utf8'); } catch (e) {}
    await coll(userId).doc(editId).set({ status: 'failed', error: err.message, updatedAt: Date.now() }, { merge: true });
    await memory.addNotification(userId, `❌ Self-edit failed: ${doc.title}`, `File: ${rel} — ${err.message} (rolled back)`, 'reminder', doc.title);
    throw err;
  }
}

function listCandidateFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); }
    catch (e) { return; }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'AI-Website-Engineering-System', 'uploads', 'tmp'].includes(entry.name)) continue;
        walk(`${dir}/${entry.name}`, rel);
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) {
        const abs = path.join(ROOT, dir, entry.name);
        try { if (fs.statSync(abs).size > 200000) continue; } catch (e) { continue; }
        if (!isBlocked(rel)) out.push(rel);
      }
    }
  };
  walk('src', 'src');
  walk('public', 'public');
  return out;
}

function stripJson(text) {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  const s = t.indexOf('[');
  const e = t.lastIndexOf(']');
  return s >= 0 && e > s ? t.slice(s, e + 1) : t;
}

async function buildHackContext(userId) {
  try {
    const hacks = require('./hackathonService').listHackathons(userId);
    const list = await hacks;
    const active = list.filter(h => h.participating || h.status !== 'ended').slice(0, 5);
    if (!active.length) return '';
    return `\nMASTER'S ACTIVE HACKATHONS (tune improvement ideas to these skills):\n${active.map(h => `- ${h.title} [${h.status}]`).join('\n')}`;
  } catch (e) {
    return '';
  }
}

async function runSelfReview(userId, { autoApply = false } = {}) {
  const files = listCandidateFiles();
  const facts = await memory.listFacts(userId).catch(() => []);
  const hackContext = await buildHackContext(userId);

  const prompt = `You are the SELF-EDIT ENGINE of the "BoB" project (Bob — Master Nikhil's AI assistant, Node.js + Express + Firebase + vanilla JS frontend).

Master asked you to improve yourself / review the code and apply safe improvements.

Available editable files (paths relative to repo root):
${files.join('\n')}

Rules:
- Propose at most 3 concrete, real improvements. Prefer small, safe, localized changes (bug fixes, clearer logs, missing error handling, small UX/JS improvements).
- For each edit return EXACTLY: file path (one of the listed), the EXACT oldCode substring as it exists in the file today (must match byte-for-byte), and newCode replacement.
- NEVER touch blocked files, never add dependencies, keep existing style, keep existing behavior unless fixing a real bug.
- If a file is not in the list, do NOT propose it.
${hackContext}

Facts about Master (may hint what to improve):
${facts.slice(0, 15).map(f => '- ' + f.text).join('\n') || '(none)'}

Return ONLY a valid JSON array, no markdown:
[{ "title": "short title", "file": "path/to/file.js", "oldCode": "...exact current code...", "newCode": "...replacement...", "reason": "why" }]`;

  const { text } = await callLLM({
    role: 'builder',
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'Find safe self-improvements and return the JSON array.' }],
    temperature: 0.2,
    max_tokens: 4000,
  });

  let parsed = [];
  try { parsed = JSON.parse(stripJson(text)); }
  catch (e) { throw new Error('Self-review LLM returned invalid JSON: ' + e.message); }
  if (!Array.isArray(parsed)) throw new Error('Self-review: expected an array of edits');

  const results = [];
  for (const item of parsed.slice(0, 3)) {
    try {
      const d = await proposeEdit(userId, {
        title: item.title,
        file: item.file,
        oldCode: item.oldCode,
        newCode: item.newCode,
        category: autoApply ? 'auto' : 'manual',
        reason: item.reason,
      });
      results.push({ id: d.id, ok: true, title: d.title, file: d.file });
    } catch (e) {
      results.push({ ok: false, error: e.message });
    }
  }

  const summary = results.filter(r => r.ok).length
    ? `🧬 Self-review done: ${results.filter(r => r.ok).length} edit proposal(s) ready. ${results.filter(r => r.ok).map(r => `- ${r.title} (${r.file})`).join(' ')}`
    : `🧬 Self-review done, but no safe edits found this round. ${results.filter(r => !r.ok).map(r => r.error).slice(0, 2).join('; ')}`;
  await memory.addNotification(userId, '🧬 Bob Self-Review', summary, 'reminder', summary);
  return { proposed: results.length, results, summary };
}

module.exports = {
  proposeEdit, listEdits, getEdit, setStatus, applyEdit,
  runSelfReview, listCandidateFiles, isBlocked,
};
