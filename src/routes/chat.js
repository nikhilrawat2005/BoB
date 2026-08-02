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

  // Normalize image URLs from request (screenshots uploaded by user)
  const userImageUrls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];

  try {
    // 1. Save user's message
    await memory.addMessage(req.userId, sessionId, 'user', message);

    // 2. Behavior Profiler: Learn habits asynchronously
    behaviorEngine.updateBehaviorProfile(req.userId, message).catch(err => console.error(err));

    // 3. Intermediary Router: Classify intent in real time
    const intent = await memoryManager.classifyIntent(message);

    // If new fact detected automatically, store it in memory facts
    if (intent.isNewFact && intent.extractedFact) {
      await memory.addFact(req.userId, intent.extractedFact);
    }

    // 3b. AUTO MEDIA DETECTION — extract YouTube/Instagram link data from message
    const mediaEnrichment = await enrichMessageWithMedia(message);
    const allImageUrls = [
      ...userImageUrls,
      ...(mediaEnrichment.imageUrls || []),
    ];
    if (mediaEnrichment.hasMedia) {
      console.log(`[Chat] Media detected: ${mediaEnrichment.detectedTypes.join(', ')} — ${allImageUrls.length} image(s) for vision`);
    }

    // 4. Pull recent history, facts, and weekly summaries context
    const recent = await memory.getRecentMessages(req.userId, sessionId, 20);
    const facts = await memory.listFacts(req.userId);
    const weeklySummaries = await memory.listWeeklySummaries(req.userId);

    let contextBlocks = [];
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
        userText: message,
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
          { role: 'user', content: message },
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
            { role: 'user', content: `User: ${message}\nAssistant: ${text}` }
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
    res.status(500).json({ error: 'LLM call failed', details: err.message });
  }
});

module.exports = router;
