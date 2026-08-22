const { callLLM } = require('./llmService');
const memory = require('./memoryService');

/**
   Multi-LLM Memory Manager Service
   Handles:
   1. Intermediary Routing (Detects if user asks about past chats/summaries or sets new rules)
   2. Auto Memory/Fact Extraction
   3. Weekly Chat Summarization
 */

/**
 * Intermediary Router: Classifies user prompt intent
 */
async function classifyIntent(message) {
  try {
    const prompt = `Analyze the following message from Master Nikhil.
Determine:
1. Is he asking about past chats, weekly summaries, or historical discussions? (isHistoryQuery: true/false)
2. Is he stating a fact, preference, or rule to remember? (isNewFact: true/false)

Message: "${message}"

Respond strictly in valid JSON format:
{ "isHistoryQuery": boolean, "isNewFact": boolean, "extractedFact": string or null }`;

    const { text } = await callLLM({
      role: 'router',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.1,
    });

    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return parsed;
  } catch (err) {
    console.error('Intermediary router error:', err.message);
    return { isHistoryQuery: false, isNewFact: false, extractedFact: null };
  }
}

/**
 * ISO-style week key (e.g. "2026-W31") — includes year AND week number so
 * summaries from different months/years never overwrite each other.
 */
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Month key (e.g. "2026-07"). */
function isoMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthId) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return monthId;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[+m[2] - 1]} ${m[1]}`;
}

function monthRange(monthId) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return monthId;
  const year = +m[1], mon = +m[2];
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));
  const fmt = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)} ${year}`;
}

/**
 * Close out any non-current months that were never finalized and export each
 * one as a downloadable markdown file. Safe to run often (idempotent).
 */
async function finalizeStaleMonths(userId) {
  try {
    const currentMonth = isoMonthKey(new Date());
    const existing = await memory.listMonthMemory(userId, 12);
    for (const month of existing) {
      if (month.id !== currentMonth && !month.finalized) {
        const content = buildMonthReportMarkdown(month.id, month.chunks || []);
        await memory.finalizeMonth(userId, month.id);
        await memory.saveMonthlyFile(userId, month.id, {
          filename: `Bob-Memory-${month.id}.md`,
          content,
          mime: 'text/markdown',
        });
        console.log(`[Memory] Finalized + exported ${month.id}`);
      }
    }
  } catch (err) {
    console.error('finalizeStaleMonths error:', err.message);
  }
}

function buildMonthReportMarkdown(monthId, chunks) {
  const body = (chunks || [])
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((c, i) => {
      const d = new Date(c.ts || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return `### Chunk ${i + 1} — ${d}\n\n${c.points || ''}`;
    })
    .join('\n\n');
  return `# 🧠 Bob — Monthly Memory Report\n\n**Month:** ${monthLabel(monthId)} (${monthRange(monthId)})\n\nThis file accumulates every key point, decision, and instruction Bob captured with Master Nikhil during the month. Nothing is overwritten — every 3-day chunk is appended.\n\n---\n\n${body || '_No key points captured this month._'}\n`;
}

/**
 * Background Auto-Summarizer for Monthly Memory
 * - Appends a new "chunk" every ~3 days (or when the month rolls over).
 * - ONLY summarizes messages that arrived AFTER the previous chunk, so key
 *   points never duplicate and old data is never lost.
 */
async function summarizeUserSessions(userId) {
  try {
    // First, close out any stale months (idempotent — cheap on every call)
    await finalizeStaleMonths(userId);

    const monthId = isoMonthKey(new Date());
    const month = await memory.getMonthMemory(userId, monthId);
    const lastChunkTs = (month && month.lastChunkTs) || 0;

    // 3-day cooldown (and never fire twice in the same month before day 3)
    if (lastChunkTs && Date.now() - lastChunkTs < 3 * 24 * 60 * 60 * 1000) return null;

    const sessions = await memory.listSessions(userId);
    if (!sessions || !sessions.length) return null;

    // Collect ONLY messages newer than the last chunk (from recent sessions)
    let newTranscript = '';
    for (const sess of sessions.slice(0, 5)) {
      const msgs = lastChunkTs
        ? await memory.getMessagesSince(userId, sess.id, lastChunkTs, 50)
        : await memory.getRecentMessages(userId, sess.id, 30);
      if (msgs.length) {
        newTranscript += `\n--- Session: ${sess.title || 'Chat'} ---\n`;
        msgs.forEach(m => {
          newTranscript += `${m.role.toUpperCase()}: ${m.content}\n`;
        });
      }
    }

    if (!newTranscript.trim()) return null;

    const summaryPrompt = `You are Bob's Memory Manager LLM.
Summarize the following new chat activity from Master Nikhil into high-value KEY POINTERS and KEY DECISIONS.
Include every important instruction, preference, goal, tech decision, personal detail, and account note.
Do NOT lose or omit anything meaningful. Keep each point short and bullet-style.

New Chat Activity:
${newTranscript}

Format: Return a concise bullet list of Key Pointers & Key Decisions.`;

    const { text } = await callLLM({
      role: 'memorySummarize',
      messages: [{ role: 'system', content: summaryPrompt }],
      temperature: 0.2,
    });

    // Append this chunk — previous chunks stay untouched
    await memory.saveMonthlyChunk(userId, monthId, text);
    return text;
  } catch (err) {
    console.error('Background summarizer error:', err.message);
    return null;
  }
}

/**
 * Hierarchical Rolling Weekly Summarizer per Session
 * - Every week (or on demand), rolls unsummarized messages + previous summary into a single clean summary.
 * - Saves into the session's memory timeline (Summary_W1, Summary_W2, etc.).
 */
async function runWeeklyRollingSummarizer(userId) {

  try {
    const sessions = await memory.listSessions(userId);
    if (!sessions || !sessions.length) return { sessionsProcessed: 0 };

    const currentWeekKey = isoWeekKey(new Date());
    let processedCount = 0;

    for (const sess of sessions) {
      const sessionId = sess.id;
      const latestSummaryData = await memory.getSessionLatestSummary(userId, sessionId);
      const lastMergedTs = latestSummaryData ? latestSummaryData.mergedThroughTs || latestSummaryData.ts || 0 : 0;

      // Fetch messages since last merged timestamp
      const msgs = lastMergedTs
        ? await memory.getMessagesSince(userId, sessionId, lastMergedTs, 60)
        : await memory.getRecentMessages(userId, sessionId, 60);

      // Only summarize if there are at least 4 new messages
      if (!msgs || msgs.length < 4) continue;

      let transcript = '';
      msgs.forEach(m => {
        const timeTag = m.timestamp ? ` [${m.timestamp}]` : '';
        transcript += `${m.role.toUpperCase()}${timeTag}: ${m.content}\n`;
      });

      const prevSummaryBlock = latestSummaryData && latestSummaryData.summaryText
        ? `\nPREVIOUS ROLLING SUMMARY:\n${latestSummaryData.summaryText}\n`
        : '';

      const prompt = `You are Bob's Rolling Memory Compressor.
You are compressing chat history for session: "${sess.title || 'Chat'}".
${prevSummaryBlock}
NEW MESSAGES TO INCORPORATE:
${transcript}

TASK:
Produce an updated, crystal-clear, and compact ROLLING SUMMARY of this session.
Merge the previous summary with new updates.
Format:
- 📌 Core Objective & Topics: (1-2 lines)
- 🛠️ Key Decisions & Technical Choices: (bullet points)
- 📝 Important Facts, Rules, & Notes: (bullet points)
- 🎯 Current Status & Next Steps: (1-2 lines)

Rules: Keep it under 250 words total. Do not omit crucial constraints or decisions.`;

      const { text } = await callLLM({
        role: 'memorySummarize',
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.2,
      });

      const nextCycleIndex = latestSummaryData ? (latestSummaryData.cycleIndex || 1) + 1 : 1;
      const weekLabel = `${currentWeekKey}-Cycle${nextCycleIndex}`;

      await memory.saveSessionWeeklySummary(userId, sessionId, weekLabel, text.trim(), {
        mergedThroughTs: Date.now(),
        messageCount: msgs.length,
        cycleIndex: nextCycleIndex,
      });

      processedCount++;
      console.log(`[Memory] Generated rolling summary for session "${sess.title}" (${weekLabel})`);
    }

    return { sessionsProcessed: processedCount };
  } catch (err) {
    console.error('runWeeklyRollingSummarizer error:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  classifyIntent,
  summarizeUserSessions,
  runWeeklyRollingSummarizer,
  finalizeStaleMonths,
  isoMonthKey,
  isoWeekKey,
  monthLabel,
  monthRange,
  buildMonthReportMarkdown,
};

