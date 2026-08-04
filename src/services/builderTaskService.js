// ---------------------------------------------------------------------------
// Bob the Builder — Background Task Engine
// Long-running jobs (e.g. "GitHub pe location-tracking projects dhundh aur
// report banao") run in the BACKEND as Firestore-backed tasks. A GitHub
// Actions workflow hits POST /api/builder/tasks/pump every 5 minutes; each
// pump invocation advances a task by exactly ONE step (search / one repo
// analysis / final report). When a task completes it self-messages Master
// Nikhil (assistant message in the builder session + a notification), so he
// never has to ask twice.
//
//   users/{uid}/builderTasks/{taskId} → {command, type, status, query,
//     maxRepos, repos[], analyses[], result, sessionId, plan[], currentStep,
//     totalSteps, createdAt, startedAt, finishedAt, error, heartbeat}
// ---------------------------------------------------------------------------
const { db } = require('../config/firebase');
const { callLLM } = require('./llmService');
const builder = require('./builderService');
const memory = require('./memoryService');
const repo = require('./repoService');

const PUMP_EVERY_MIN = 5;
const DEFAULT_MAX_REPOS = 3;

function tasksColl(userId) {
  return db.collection('users').doc(userId).collection('builderTasks');
}

// ── Query extraction: turn a command like
//    "github me location tracking ke projects dhundh aur report banao"
//    into a GitHub search query like "location tracking"
function extractSearchQuery(command) {
  const raw = command
    .replace(/\b(?:search(?:ing)?|scan|find|dhundh\w*|dhoondh\w*|discover|explore)\b/gi, ' ')
    .replace(/\b(?:github|repos?|repositories|projects?|idea|ideas|features?|frameworks?|libraries?|apps?)\b/gi, ' ')
    .replace(/\b(?:free|best|top|new|cool|crazy|awesome|interesting|open\s*source|for|of|on|with|to|from|about)\b/gi, ' ')
    .replace(/\b(?:me|pe|main|and|aur|karo|karna|kar|banaye?|banao?|batao|chahiye|mujhe|report|final|ke|ki|ka|ko|se|ho|hai|hain|tha|the|ye|yeh|vo|wo|ab|bas|sirf|itne|kisi|bhi|har)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (raw.length >= 3) return raw.slice(0, 80).trim();
  // Fallback: strip only framing words, keep topic words (e.g. "open source projects")
  return command
    .replace(/\b(?:search(?:ing)?|scan|find|dhundh\w*|dhoondh\w*|discover|explore|github|repos?)\b/gi, ' ')
    .replace(/\b(?:mujhe|batao|chahiye|banao?|banaye?|karo|karna|kar|report|final|ke|ki|ka|ko|se|me|pe|main|aur|and)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ── Task creation ─────────────────────────────────────────
async function createTask(userId, { command, sessionId = null }) {
  const query = extractSearchQuery(command);
  const plan = [
    { kind: 'search', label: `GitHub search: "${query}"`, status: 'pending' },
    { kind: 'repos', label: `Analyze top ${DEFAULT_MAX_REPOS} repos`, status: 'pending' },
    { kind: 'report', label: 'Generate final report + self-message', status: 'pending' },
  ];
  const now = Date.now();
  const ref = tasksColl(userId).doc();
  const task = {
    id: ref.id,
    command: command.trim(),
    type: 'github_scan',
    status: 'queued',
    query,
    maxRepos: DEFAULT_MAX_REPOS,
    repos: [],
    analyses: [],
    result: null,
    sessionId: sessionId || null,
    plan,
    currentStep: 0,
    totalSteps: plan.length,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    heartbeat: null,
  };
  await ref.set(task);
  return { task, etaMinutes: estimateMinutes(task) };
}

async function getTask(userId, taskId) {
  const doc = await tasksColl(userId).doc(taskId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function listTasks(userId, limit = 10) {
  const snap = await tasksColl(userId).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function listActiveTasks(userId) {
  const snap = await tasksColl(userId).where('status', 'in', ['queued', 'running']).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// ── Progress / ETA helpers ────────────────────────────────
function estimateMinutes(task) {
  const done = task.plan.filter(s => s.status === 'done').length;
  const remaining = Math.max(1, (task.totalSteps || 1) - done);
  return Math.max(1, remaining * PUMP_EVERY_MIN + 1);
}

function formatEtaIST(msFromNow) {
  return new Date(Date.now() + msFromNow).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
  });
}

function formatTaskStatus(task) {
  const done = task.plan.filter(s => s.status === 'done').length;
  const total = task.totalSteps || 1;
  if (task.status === 'done') {
    return `✅ Task "${task.command.slice(0, 60)}" — DONE (${total}/${total} steps, ${task.finishedAt ? new Date(task.finishedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : ''}). Report is in this session.`;
  }
  if (task.status === 'error') {
    return `❌ Task "${task.command.slice(0, 60)}" — FAILED: ${task.error || 'unknown error'}`;
  }
  return `⏳ Task "${task.command.slice(0, 60)}" — ${done}/${total} steps done. ~${estimateMinutes(task)} min left (eta ${formatEtaIST(estimateMinutes(task) * 60 * 1000)} IST).`;
}

// ── Step machine: advance ONE task by ONE step ────────────
async function processNextTask() {
  const task = await pickTask();
  if (!task) return { processed: false };

  // Find the first pending step
  const stepIdx = task.plan.findIndex(s => s.status === 'pending');
  if (stepIdx === -1) return { processed: false };

  const step = task.plan[stepIdx];
  step.status = 'running';
  task.heartbeat = Date.now();
  await tasksColl(task.userId).doc(task.id).set(
    { plan: task.plan, heartbeat: task.heartbeat, status: task.status },
    { merge: true }
  );

  try {
    if (step.kind === 'search') {
      const res = await repo.searchRepos(task.query, task.maxRepos + 2);
      if (res.error) {
        await failTask(task, res.message || res.error);
        return { processed: true, failed: true, error: res.message };
      }
      task.repos = res.items.map(i => i.full_name).slice(0, task.maxRepos);
      task.totalSteps = 2 + Math.max(1, Math.min(task.repos.length, task.maxRepos));
      step.detail = task.repos.length
        ? task.repos.join(', ')
        : 'Koi repo nahi mila — try broader keywords.';
      if (!task.repos.length) {
        step.status = 'done';
        task.currentStep = stepIdx + 1;
        // jump straight to report (with empty analyses)
        await saveTask(task);
        return { processed: true, step: 'search', repos: task.repos };
      }
    } else if (step.kind === 'repos') {
      const next = task.repos[task.analyses.length];
      if (!next) {
        step.status = 'done';
        task.currentStep = stepIdx + 1;
        await saveTask(task);
        return { processed: true, step: 'repos-done' };
      }
      const a = await repo.analyzeRepo(next).catch(err => ({
        status: 'error', repo: { fullName: next }, error: 'read', message: err.message,
      }));
      task.analyses.push({
        full_name: next,
        status: a.status,
        readCount: a.readCount || 0,
        error: a.error || null,
        message: a.message || null,
        context: a.context || null,
      });
      if (a.status === 'ok' && a.repo) {
        step.detail = `${a.repo.fullName} read (${a.readCount} files)`;
      } else {
        step.detail = `${next} — ${a.error || a.status} (${a.message || 'failed'})`;
      }
      if (task.analyses.length >= Math.max(1, Math.min(task.repos.length, task.maxRepos))) {
        step.status = 'done';
      }
      task.currentStep = stepIdx + (step.status === 'done' ? 1 : 0);
      await saveTask(task);
      return { processed: true, step: 'repo', repo: next, status: a.status };
    } else if (step.kind === 'report') {
      const report = await generateReport(task);
      task.result = report;
      task.status = 'done';
      task.finishedAt = Date.now();
      step.status = 'done';
      task.currentStep = task.totalSteps;
      await saveTask(task);
      await selfMessage(userIdOf(task), task);
      return { processed: true, step: 'report', done: true };
    }
  } catch (err) {
    await failTask(task, err.message);
    return { processed: true, failed: true, error: err.message };
  }

  await saveTask(task);
  return { processed: true, step: step.kind };
}

function userIdOf(task) {
  return task.__userId;
}

async function saveTask(task) {
  const { __userId, ...data } = task;
  await tasksColl(userIdOf(task)).doc(task.id).set(data, { merge: true });
}

async function failTask(task, message) {
  task.status = 'error';
  task.error = message;
  task.finishedAt = Date.now();
  for (const s of task.plan) if (s.status === 'running') s.status = 'pending';
  await saveTask(task);
  try {
    await selfMessage(userIdOf(task), task);
  } catch (e) { /* ignore */ }
}

// ── Pick the next task to work on ─────────────────────────
async function pickTask() {
  // Prefer the oldest queued task across all users.
  let snap = await db.collectionGroup('builderTasks')
    .where('status', '==', 'queued').limit(5).get();
  let docs = snap.docs.map(d => ({ __userId: d.ref.parent.parent.id, id: d.id, ...d.data() }));
  if (!docs.length) {
    // Reclaim stale running tasks (>2 min old — crashed invocation)
    snap = await db.collectionGroup('builderTasks')
      .where('status', '==', 'running').limit(10).get();
    docs = snap.docs
      .map(d => ({ __userId: d.ref.parent.parent.id, id: d.id, ...d.data() }))
      .filter(t => !t.startedAt || Date.now() - (t.startedAt || 0) > 120000);
  }
  if (!docs.length) return null;
  docs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const task = docs[0];
  if (task.status === 'queued') task.startedAt = task.startedAt || Date.now();
  task.status = 'running';
  return task;
}

// ── Final report generation (LLM, builder persona/key) ────
async function generateReport(task) {
  const ok = task.analyses.filter(a => a.status === 'ok');
  const failed = task.analyses.filter(a => a.status !== 'ok');

  const body = ok.map(a => `\n\n### 📦 ${a.full_name} (read ${a.readCount} files)\n${a.context || '(no context)'}`).join('');
  const failedNote = failed.length
    ? `\n\n⚠️ Ye repos read nahi ho paye: ${failed.map(f => `${f.full_name} (${f.error || f.status}: ${f.message || 'unknown'})`).join('; ')}.`
    : '';

  const systemPrompt = `You are Bob the Builder's autonomous RESEARCH ENGINE.
Master Nikhil gave you this command: "${task.command}"
You searched GitHub for "${task.query}" and self-read the top repos (real files). Below is the actual code context.`;

  const userPrompt = `Produce a FINAL, actionable research report in clean markdown (NO fenced \\\`\\\`\\\` wrapper around the whole thing, no filename= block — it is sent as a chat message):

# 📦 GitHub Discovery Report — ${task.query}

## 🎯 The Ask
${task.command}

## 🔎 Top Repos Found
(For each repo analyzed: name, stars if known, what it is, why it matters)

## ⚙️ How They Actually Work
(Real technical breakdown from the files you read — mention actual file paths, key functions/patterns)

## 🧠 What's Worth Stealing
(3-6 specific ideas we can implement in our own projects, with "how" notes)

## 🛠️ Step-by-Step Implementation Plan
(Concrete ordered steps)

## 🔗 Links
${ok.map(a => `- ${a.full_name}`).join('\n')}
${failedNote}

Context from read repos:${body}

Be concrete, honest, and practical. If nothing was readable, say so clearly and suggest better search terms.`;

  const res = await callLLM({
    role: 'builder',
    persona: 'builder',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 4000,
  });
  return res.text || 'Report generate nahi hui.';
}

// ── Self-message on completion / failure ──────────────────
async function selfMessage(userId, task) {
  const report = task.result || (task.status === 'error'
    ? `⚠️ Task fail ho gaya: ${task.error}\nCommand: ${task.command}`
    : null);
  if (!report) return;

  // Target session: the one the command came from, else create a report session.
  let sid = task.sessionId;
  if (!sid) {
    const s = await builder.createBuilderSession(userId, { title: '📦 ' + task.query.slice(0, 40) || 'GitHub Scan' });
    sid = s.id;
  }
  await builder.addBuilderMessage(userId, sid, 'assistant', report);

  const preview = report.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 160);
  await memory.addNotification(
    userId,
    task.status === 'error' ? '🏗️ Builder Task Failed' : '🏗️ Builder Task Complete',
    preview,
    'reminder',
    report
  );
}

module.exports = {
  createTask, getTask, listTasks, listActiveTasks,
  processNextTask, extractSearchQuery, formatTaskStatus, estimateMinutes,
};
