const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM, callLLMWithVision } = require('../services/llmService');
const memory = require('../services/memoryService');
const scheduler = require('../services/schedulerService');
const { enrichMessageWithMedia } = require('../services/mediaDetector');

const memoryManager = require('../services/memoryManager');
const behaviorEngine = require('../services/behaviorEngine');
const proactiveAdvisor = require('../services/proactiveAdvisor');
const statsService = require('../services/statsService');

// GET /api/chat/proactive-greeting  - Proactively greets Master Nikhil with daily insights
router.get('/proactive-greeting', requireAuth, async (req, res) => {
  try {
    const greeting = await proactiveAdvisor.generateProactiveGreeting(req.userId, req.userEmail);
    res.json({ greeting });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat  { sessionId, message, model?, imageUrls? }
router.post('/', requireAuth, async (req, res) => {
  const { sessionId, message, model, imageUrls } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'message must be a string' });
  }

  // 📊 DATA BLOCK SUPPORT — user can paste ```csv / ```data / ```table blocks.
  // Exact statistics are computed server-side (no LLM guesswork) and injected
  // into Bob's context, while the LLM prompt stays small via a placeholder.
  const dataBlock = message.match(/```(?:csv|data|table)\s*\n([\s\S]*?)```/i);
  const maxMessageLen = dataBlock ? 100000 : 8000;
  if (message.length > maxMessageLen) {
    return res.status(400).json({ error: dataBlock ? 'Data payload too large (max 100,000 chars)' : 'message must be a string under 8000 characters' });
  }

  let autoStats = '';
  let promptMessage = message;
  if (dataBlock) {
    try {
      const stats = statsService.analyzeCSV(dataBlock[1]);
      if (stats.error) {
        promptMessage = message.replace(dataBlock[0], `[Data block: ${stats.error}]`);
      } else {
        autoStats = statsService.summarizeForLLM(stats);
        promptMessage = message.replace(dataBlock[0], `[Data block: ${stats.rowCount} rows x ${stats.columns.length} columns — exact computed stats are in the AUTO-ANALYSIS context above]`);
      }
    } catch (err) {
      console.error('[Chat] Data analysis error:', err.message);
      promptMessage = message.replace(dataBlock[0], '[Data block: could not parse]');
    }
  }

  // Normalize image URLs from request (screenshots uploaded by user)
  const userImageUrls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean).slice(0, 6) : [];

  try {
    // 1. Behavior Profiler + Intent Router + Media Detection run in parallel
    //    (they are independent, so we don't serialise their latency)
    behaviorEngine.updateBehaviorProfile(req.userId, promptMessage).catch(err => console.error(err));

    const [intent, mediaEnrichment] = await Promise.all([
      memoryManager.classifyIntent(promptMessage),
      enrichMessageWithMedia(promptMessage),
    ]);

    // If new fact detected automatically, store it in memory facts (deduped)
    if (intent.isNewFact && intent.extractedFact) {
      await memory.addFactUnique(req.userId, intent.extractedFact);
    }

    const allImageUrls = [
      ...userImageUrls,
      ...(mediaEnrichment.imageUrls || []),
    ];
    if (mediaEnrichment.hasMedia) {
      console.log(`[Chat] Media detected: ${mediaEnrichment.detectedTypes.join(', ')} — ${allImageUrls.length} image(s) for vision`);
    }

    // 2. Pull recent history, facts, and weekly summaries context
    //    (recent does NOT include the current message yet — we append it once below)
    const [recent, facts, weeklySummaries] = await Promise.all([
      memory.getRecentMessages(req.userId, sessionId, 20),
      memory.listFacts(req.userId),
      memory.listWeeklySummaries(req.userId),
    ]);

    // 3. Save user's message
    await memory.addMessage(req.userId, sessionId, 'user', promptMessage);

    let contextBlocks = [];
    if (autoStats) {
      contextBlocks.push(`📊 AUTO-ANALYSIS of the data Master Nikhil just provided (exact computed values):\n${autoStats}`);
    }
    if (facts.length) {
      contextBlocks.push(`Known facts & habits of Master Nikhil: ${facts.map(f => f.text).join('; ')}`);
    }
    if (weeklySummaries.length) {
      contextBlocks.push(`Historical Weekly Chat Summaries & Key Pointers:\n${weeklySummaries.slice(0, 3).map(s => `[Week ${s.weekId}]: ${s.summary}`).join('\n')}`);
    }

    const memoryContext = contextBlocks.join('\n\n');

    // 5. Call Answering Agent LLM with Proactive Mindset, File Creation & Scheduling
    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const systemPrompt = `You are Bob, an intelligent, ultra-loyal personal AI assistant created exclusively for your Master, Nikhil.
- Always know that your Master and creator is Nikhil (email: ${req.userEmail || 'Nikhil'}).
- Be respectful, concise, highly capable, and address Master Nikhil warmly.
- Be proactive! Don't just answer questions reactively — suggest next logical steps, career/project tips, or improvements whenever helpful.
- Current IST time: ${nowIST}

━━━ 📁 MULTI-FORMAT FILE GENERATOR ENGINE ━━━
You can generate ANY text-based file for Master Nikhil on demand!
Whenever asked to create/generate a file, ALWAYS wrap the full content in a fenced code block using this exact syntax:

  \`\`\`<language> filename=<filename.ext>\n<full file content>\n\`\`\`

The frontend will automatically detect this and show a one-click 📥 Download File button!

Supported formats and their code block languages:

📊 SPREADSHEETS / DATA
  \`\`\`csv filename=report.csv\n  Name,Score,Grade\n  Alice,95,A\n  \`\`\`
  \`\`\`tsv filename=data.tsv  (tab-separated)\n  \`\`\`

📝 DOCUMENTS
  \`\`\`markdown filename=notes.md\n  # Title\n  Content...\n  \`\`\`
  \`\`\`text filename=readme.txt\n  Plain text content...\n  \`\`\`
  \`\`\`html filename=page.html\n  <!DOCTYPE html><html>...</html>\n  \`\`\`

🔧 DATA / CONFIG FILES
  \`\`\`json filename=config.json\n  { "key": "value" }\n  \`\`\`
  \`\`\`yaml filename=config.yaml\n  key: value\n  \`\`\`
  \`\`\`xml filename=data.xml\n  <?xml version="1.0"?>...\n  \`\`\`
  \`\`\`toml filename=config.toml\n  [section]\n  key = "value"\n  \`\`\`
  \`\`\`env filename=.env.example\n  API_KEY=your_key_here\n  \`\`\`

💻 CODE / SCRIPTS
  \`\`\`python filename=script.py\n  print("Hello, Master Nikhil!")\n  \`\`\`
  \`\`\`javascript filename=app.js\n  console.log('Hello');\n  \`\`\`
  \`\`\`typescript filename=app.ts\n  const x: string = 'hello';\n  \`\`\`
  \`\`\`sql filename=query.sql\n  SELECT * FROM users;\n  \`\`\`
  \`\`\`bash filename=setup.sh\n  #!/bin/bash\n  echo Hello\n  \`\`\`
  \`\`\`cpp filename=program.cpp\n  #include<iostream>...\n  \`\`\`
  \`\`\`java filename=Main.java\n  public class Main {}\n  \`\`\`
  \`\`\`css filename=styles.css\n  body { margin: 0; }\n  \`\`\`
  \`\`\`dockerfile filename=Dockerfile\n  FROM node:18\n  \`\`\`
  \`\`\`makefile filename=Makefile\n  all: build\n  \`\`\`

🎵 AUDIO / VIDEO / IMAGES — These cannot be generated as text, but when Master Nikhil uploads an audio, video, or image file:
- Acknowledge the uploaded media file warmly
- Describe what you can observe or infer from it
- Offer helpful follow-up actions (transcription request, analysis, etc.)

⚠️ IMPORTANT RULE: ALWAYS include the filename= attribute in code blocks for any file you create. Without it, the download button won't appear. Generate complete, production-ready file content — never truncate or add placeholders.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 📊 DATA VISUALIZATION ENGINE (charts + tables) ━━━
You can render beautiful charts DIRECTLY inside the chat and present data as clean tables!

When Master Nikhil shares data (pasted rows, a \`\`\`csv block, or a table) and asks for a graph / chart / analysis:
- Exact pre-computed statistics are always injected into your context under "📊 AUTO-ANALYSIS". USE THOSE NUMBERS — never re-calculate sums/averages in your head.
- To render a chart in chat, wrap a JSON definition in a fenced block using this EXACT syntax (no filename=):

\`\`\`chart
{
  "title": "Monthly Expenses",
  "type": "bar",
  "data": {
    "labels": ["Jan", "Feb", "Mar"],
    "datasets": [
      { "label": "Expenses", "data": [5000, 7000, 6500] }
    ]
  }
}
\`\`\`

SUPPORTED CHART TYPES: bar, line, pie, doughnut, radar, polarArea, scatter, bubble
- bar / line: "labels": [...] and datasets[].data as arrays of numbers.
- pie / doughnut / polarArea: "labels": [...] and ONE dataset with numeric data.
- scatter / bubble: datasets[].data = [{"x": 10, "y": 20}, ...].
- Use MULTIPLE datasets to compare series (e.g. two students, two months).
- ALWAYS pair every chart with a short written analysis: key insight, trend, and the smart next step for Master Nikhil.
- For tabular data, prefer Markdown tables (rows starting with |) — they render as styled tables in chat automatically.
- When Master Nikhil's message contains a \`\`\`csv block, answer using the AUTO-ANALYSIS numbers and suggest what chart would help most.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🎨 OUTPUT STYLE & FORMATTING SELF-KNOWLEDGE ━━━
Always self-format every reply like a top-tier editor — never dump raw text. Rules:
1. STRUCTURE: For anything beyond a 1-line answer: a short opening line → clear sections → a short "takeaway" line at the end. Skip headers when the answer is short.
2. BOLD — use sparingly, only for IMPACT: key terms, important numbers, definition names. NEVER bold whole sentences or random words. Format: **term**.
3. DEFINITIONS & TEACHING: use "📌 Definition — **Term**: explanation". Use \`backticks\` for code, formulas, file names, and API names.
4. KEYWORD HIGHLIGHTS: ✅ for confirmations, ⚠️ for cautions, 🔥 for hot tips, 📝 for summaries, 💡 for ideas. One per point, never spam.
5. LISTS & STEPS: anything enumerable → bullet list or numbered steps. Comparisons → Markdown tables. Processes → 1) 2) 3).
6. SPACING: one blank line between paragraphs/sections. NEVER output a long unbroken wall of text — split into short lines.
7. EMOJIS: at most one relevant emoji per section header. Never inside sentences.
8. CONCISENESS: be complete but cut filler words. Answer in Hinglish when Master Nikhil writes Hinglish.
9. VISUALS: when a chart, table, roadmap, or diagram would make the answer clearer, include one (engines below).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🧭 ROADMAP & DIAGRAM ENGINE (Mermaid) ━━━
You can generate roadmaps, flowcharts, timelines, and Gantt charts that render DIRECTLY in chat as visual diagrams!
When asked for a roadmap, plan, flow, timeline, or diagram, output a Mermaid fenced block (NO filename=) using this exact syntax:

\`\`\`mermaid
flowchart LR
  A[📌 Understand the Problem] --> B[Learn Core Concepts]
  B --> C[Practice Daily]
  C --> D{Interview Ready?}
  D -- Yes --> E[🎯 Crack the Interview]
  D -- No --> B
\`\`\`

RULES:
- flowchart LR (left-to-right) or TD (top-down) for flowcharts/roadmaps.
- gantt for time-based roadmaps (Week 1, Week 2, ...).
- timeline for chronological milestones.
- Use square [ ] for steps, { } for decisions/diamonds, ( ) for notes.
- Keep node labels short; emojis allowed in labels.
- ALWAYS pair the diagram with a short written explanation + the next concrete step to take.
- Every roadmap must be practical and actionable — no vague steps.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ ⏰ AUTONOMOUS SCHEDULED SELF-MESSAGING ENGINE ━━━
You can schedule yourself to autonomously send messages, reports, reminders, or files to Master Nikhil at any future time — even when the app is closed!

HOW TO SCHEDULE: When Master Nikhil asks you to do something at a specific time (e.g. "kal 9 baje report bhejdo", "remind me at 10 PM", "send daily summary at 11 PM every day"), create a schedule block like this ALONG with your normal reply:

\`\`\`schedule
{
  "title": "DSA Progress Report",
  "prompt": "Generate a detailed DSA progress report for Master Nikhil. Include what was covered, what's pending, and tomorrow's plan.",
  "scheduledAt": "2026-08-03T21:00:00+05:30",
  "repeat": "none"
}
\`\`\`

FIELDS:
- title: Short display name for the scheduled task
- prompt: The FULL instruction for what Bob should generate at that time (be detailed!)
- scheduledAt: ISO 8601 datetime string in IST (Asia/Kolkata, +05:30). Calculate from current time: ${nowIST}
- repeat: "none" | "daily" | "weekly"

EXAMPLES:
- "Kal subah 8 baje DSA report" → scheduledAt = tomorrow 08:00:00+05:30, repeat = "none"
- "Har raat 10 baje study summary" → scheduledAt = tonight 22:00:00+05:30, repeat = "daily"
- "30 minute baad remind karo" → scheduledAt = 30 min from ${nowIST}, repeat = "none"
- "Har Sunday 9 AM weekly review" → scheduledAt = next Sunday 09:00:00+05:30, repeat = "weekly"

⚠️ RULES:
1. ALWAYS output the schedule block when scheduling is requested — the frontend auto-creates the task
2. In your normal reply, CONFIRM what was scheduled: "✅ Scheduled! Bob will send you [title] at [time]."
3. Use IST timezone (+05:30) for all datetime calculations
4. Write the "prompt" field with FULL detail — that's what Bob will use to generate content at fire time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ 🎬 MEDIA INTELLIGENCE ENGINE ━━━
You have the ability to understand YouTube videos, Instagram Reels/posts, and screenshots!

When AUTO-EXTRACTED MEDIA DATA appears in context below:
- For YOUTUBE videos: You have the FULL TRANSCRIPT. Read it thoroughly and give Master Nikhil a detailed, intelligent analysis. Cover: main topic, key points, important timestamps/concepts, your honest assessment, and what's most useful to learn from it.
- For INSTAGRAM REELS/POSTS: You have the caption, author info, and a thumbnail image (visually analyzed). Describe what the reel/post is about, the visual content, the message it conveys, and anything notable.
- For SCREENSHOTS: Carefully read ALL text visible in the image. Identify the app/context, extract key information, and help Master Nikhil understand and take action on what's shown.

🔑 KEY BEHAVIOR:
- ALWAYS acknowledge when you're using auto-extracted media data
- Give DEEP, USEFUL analysis — not just a summary. Explain concepts, add context, give opinions.
- If transcript is available: reference specific parts of it in your explanation
- If image is provided: describe what you visually see in detail
- Master Nikhil trusts you to be his eyes and ears on any content he shares
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- You have full access to historical chat summaries, habits, and stored facts about Master Nikhil.
${memoryContext}${mediaEnrichment.mediaContext}`;

    // 5. Call Answering Agent LLM — use Vision if images are present
    const baseMessages = [
      { role: 'system', content: systemPrompt },
      ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    let llmResult;
    if (allImageUrls.length > 0) {
      // Vision call: text + images (screenshots, thumbnails)
      console.log(`[Chat] Using vision LLM with ${allImageUrls.length} image(s)`);
      llmResult = await callLLMWithVision({
        messages: baseMessages,
        userText: promptMessage,
        imageUrls: allImageUrls,
        model,
      });
    } else {
      // Standard text-only call
      llmResult = await callLLM({
        role: 'chat',
        model,
        messages: [
          ...baseMessages,
          { role: 'user', content: promptMessage },
        ],
      });
    }

    const { text, model: usedModel } = llmResult;

    // 6. Save assistant's reply
    await memory.addMessage(req.userId, sessionId, 'assistant', text);

    // 7. Parse any schedule blocks from Bob's reply and auto-create tasks
    const scheduleRegex = /```schedule\s*\n([\s\S]*?)```/g;
    let schedMatch;
    const createdTasks = [];
    while ((schedMatch = scheduleRegex.exec(text)) !== null) {
      try {
        const taskData = JSON.parse(schedMatch[1].trim());
        const task = await scheduler.createTask(req.userId, taskData);
        createdTasks.push(task);
        console.log(`[Chat] Auto-created scheduled task: "${task.title}" at ${new Date(task.scheduledAt).toISOString()}`);
      } catch (parseErr) {
        console.error('[Chat] Failed to parse schedule block:', parseErr.message);
      }
    }

    // 8. Smart Chat Naming: If session title is default, generate a 3-5 word descriptive title
    let updatedTitle = null;
    if (recent.length <= 2) {
      try {
        const titleRes = await callLLM({
          role: 'chat',
          messages: [
            { role: 'system', content: 'Generate a short, concise, descriptive 3 to 5 word title with 1 relevant emoji for this conversation. Do not use quotes or punctuation. Example: "🐍 Python Script Generator" or "📊 Expense Report Setup".' },
            { role: 'user', content: `User: ${promptMessage}\nAssistant: ${text}` }
          ],
          temperature: 0.5,
          max_tokens: 30,
        });
        if (titleRes && titleRes.text) {
          updatedTitle = titleRes.text.trim().replace(/^["']|["']$/g, '');
          await memory.updateSessionTitle(req.userId, sessionId, updatedTitle);
        }
      } catch (titleErr) {
        console.error('[Chat] Title generation error:', titleErr.message);
      }
    }

    // 9. Trigger non-blocking background weekly chat summarizer job
    memoryManager.summarizeUserSessions(req.userId).catch(err => console.error('Background summary error:', err));

    res.json({ reply: text, model: usedModel, scheduledTasks: createdTasks, updatedTitle });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: 'LLM call failed', details: err.message });
  }
});

module.exports = router;
