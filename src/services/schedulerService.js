const { db } = require('../config/firebase');
const { callLLM } = require('./llmService');
const memory = require('./memoryService');

// ─────────────────────────────────────────────────────────
// Firestore helpers for scheduledTasks collection
// users/{userId}/scheduledTasks/{taskId}
// ─────────────────────────────────────────────────────────

async function createTask(userId, { title, prompt, scheduledAt, repeat = 'none' }) {
  const ref = db.collection('users').doc(userId).collection('scheduledTasks').doc();
  const now = Date.now();

  // scheduledAt can be epoch ms or ISO string
  const fireAt = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : Number(scheduledAt);

  if (isNaN(fireAt)) throw new Error('Invalid scheduledAt — provide epoch ms or ISO date string.');

  const task = {
    id:        ref.id,
    userId,
    title:     title || 'Scheduled Message',
    prompt:    prompt || 'Give Master Nikhil a helpful update.',
    scheduledAt: fireAt,
    repeat,          // 'none' | 'daily' | 'weekly'
    status:    'pending',
    createdAt: now,
    firedAt:   null,
  };

  await ref.set(task);
  return task;
}

async function listTasks(userId, statusFilter = 'pending') {
  let query = db.collection('users').doc(userId).collection('scheduledTasks')
    .orderBy('scheduledAt', 'asc');

  if (statusFilter !== 'all') {
    query = query.where('status', '==', statusFilter);
  }

  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function cancelTask(userId, taskId) {
  const ref = db.collection('users').doc(userId).collection('scheduledTasks').doc(taskId);
  await ref.set({ status: 'cancelled' }, { merge: true });
}

// ─────────────────────────────────────────────────────────
// Fire a single task — generate content with LLM, push notification
// ─────────────────────────────────────────────────────────

async function fireTask(task) {
  const { userId, title, prompt, id, repeat, scheduledAt } = task;

  try {
    // 1. Pull user context (facts + recent summaries)
    const facts       = await memory.listFacts(userId);
    const summaries   = await memory.listWeeklySummaries(userId);

    const contextStr = [
      facts.length ? `Master Nikhil known facts: ${facts.map(f => f.text).join('; ')}` : '',
      summaries.length ? `Recent weekly focus: ${summaries[0]?.summary || ''}` : '',
    ].filter(Boolean).join('\n');

    // 2. Generate the scheduled message/report via LLM
    const systemMsg = `You are Bob, Master Nikhil's personal AI assistant.
This is an AUTONOMOUS SCHEDULED MESSAGE — you are self-sending this to Master Nikhil at the time he requested.
Be warm, direct, and useful. Start with "📬 Scheduled Message from Bob:" then deliver the content.
If Master Nikhil asked for a report/file, generate the file content using the filename= code block syntax.
Context about Master Nikhil:\n${contextStr || 'No extra context.'}`;

    const userMsg = `Generate the scheduled message/content for this task: "${prompt}"
Current time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;

    const { text } = await callLLM({
      role: 'writer',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg },
      ],
      temperature: 0.6,
      max_tokens: 4000,
    });

    // 3. Push as notification with full content as promptSnippet
    const shortPreview = text.slice(0, 80).replace(/\n/g, ' ') + (text.length > 80 ? '…' : '');
    await memory.addNotification(
      userId,
      `⏰ ${title}`,
      shortPreview,
      'scheduled',
      text   // full LLM output goes into promptSnippet so "Reply in Chat" gets the full content
    );

    // 4. Mark task as fired in Firestore
    const ref = db.collection('users').doc(userId).collection('scheduledTasks').doc(id);
    const nextFire = computeNextFire(scheduledAt, repeat);

    if (repeat !== 'none' && nextFire) {
      // Reschedule recurring tasks
      await ref.set({ status: 'pending', scheduledAt: nextFire, firedAt: Date.now() }, { merge: true });
    } else {
      await ref.set({ status: 'fired', firedAt: Date.now() }, { merge: true });
    }

    console.log(`[Scheduler] Fired task "${title}" for user ${userId}`);
    return true;

  } catch (err) {
    console.error(`[Scheduler] Error firing task ${id}:`, err.message);
    // Mark as error so it doesn't retry forever
    const ref = db.collection('users').doc(userId).collection('scheduledTasks').doc(id);
    await ref.set({ status: 'error', errorMsg: err.message }, { merge: true });
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// tick() — Called by Vercel Cron AND browser polling
// Scans ALL users' pending tasks and fires any that are due
// ─────────────────────────────────────────────────────────

async function tick() {
  const now = Date.now();
  // Look back 20 min (handles cron drift) and fire tasks due in that window
  const cutoff = now + (15 * 60 * 1000); // also fire tasks due in next 15 min buffer

  try {
    // Query across ALL users — tasks pending and due now
    const snap = await db.collectionGroup('scheduledTasks')
      .where('status', '==', 'pending')
      .where('scheduledAt', '<=', cutoff)
      .get();

    if (snap.empty) {
      console.log('[Scheduler] tick: no tasks due.');
      return { fired: 0 };
    }

    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Scheduler] tick: ${tasks.length} task(s) due.`);

    let fired = 0;
    for (const task of tasks) {
      const ok = await fireTask(task);
      if (ok) fired++;
    }

    return { fired, total: tasks.length };
  } catch (err) {
    console.error('[Scheduler] tick error:', err.message);
    return { fired: 0, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────
// Helper — compute next fire time for recurring tasks
// ─────────────────────────────────────────────────────────

function computeNextFire(lastScheduledAt, repeat) {
  if (!repeat || repeat === 'none') return null;
  const ms = repeat === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return lastScheduledAt + ms;
}

// ─────────────────────────────────────────────────────────
// Parse natural language time from Bob's schedule block
// e.g. "kal subah 8 baje" → epoch ms
// ─────────────────────────────────────────────────────────

function parseScheduleTime(isoOrMs) {
  if (typeof isoOrMs === 'number') return isoOrMs;
  const d = new Date(isoOrMs);
  if (!isNaN(d.getTime())) return d.getTime();
  return null;
}

module.exports = { createTask, listTasks, cancelTask, fireTask, tick, parseScheduleTime };
