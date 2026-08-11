const path = require('path');
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
const builder = require('../services/builderService');
const knowledge = require('../services/builderKnowledgeService');
const repo = require('../services/repoService');
const tasks = require('../services/builderTaskService');
const memory = require('../services/memoryService');
const memoryManager = require('../services/memoryManager');

const BOBQUERY_RE = /```bobquery[\n\r]([\s\S]*?)```/g;
const PERSONAL_WORD_RE = /instagram|insta account|github account|meri details|personal data|personal info|mere baare|mere bare|mera account|profile/i;

// Auth for background pump (GitHub Actions): CRON_SECRET bearer if set, else Firebase auth.
function cronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (cronSecret) {
    if (provided === cronSecret) return next();
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }
  return requireAuth(req, res, next);
}

// Should this message become a background research task?
function detectTaskIntent(message) {
  const m = message.toLowerCase();
  const hasGitHub = /\bgithub\b/.test(m);
  const hasSearchVerb = /\b(search|dhundh?|dhoondh?|find|scan|discover|explore)\b/.test(m);
  const hasBg = /\bbackground\b/.test(m);
  const hasNoun = /\b(repos?|projects?|ideas?|libraries|frameworks|models|tools|apps?)\b/.test(m);
  if (hasGitHub && (hasSearchVerb || hasNoun || hasBg)) return true;
  if (hasBg && (hasSearchVerb || hasNoun)) return true;
  return false;
}

function getMimeType(filename) {
  const ext = (path.extname(filename || '').slice(1) || '').toLowerCase();
  const mimeMap = {
    html: 'text/html', css: 'text/css', js: 'application/javascript', jsx: 'application/javascript',
    ts: 'application/typescript', tsx: 'application/typescript', json: 'application/json',
    md: 'text/markdown', py: 'text/x-python', sql: 'text/x-sql', sh: 'text/x-sh',
    svg: 'image/svg+xml', yaml: 'text/yaml', yml: 'text/yaml', env: 'text/plain'
  };
  return mimeMap[ext] || 'text/plain';
}

function extractPackFiles(reply) {
  const files = [];
  if (!reply || typeof reply !== 'string') return files;
  const seen = new Set();

  // Pattern 1: ```lang filename=path/to/file or file="path/to/file"
  const P1 = /```([\w.+-]+)?\s+(?:filename|file)=["']?([^"'\n\r]+)["']?[\n\r]([\s\S]*?)```/gi;
  let m;
  while ((m = P1.exec(reply)) !== null) {
    const lang = (m[1] || 'text').toLowerCase().trim();
    const name = m[2].trim().replace(/^["']|["']$/g, '');
    const content = m[3];
    if (name && content && !seen.has(name)) {
      seen.add(name);
      files.push({ lang, name, content, mime: getMimeType(name) });
    }
  }

  // Pattern 2: ```lang:path/to/file or ```path/to/file.ext
  if (files.length === 0) {
    const P2 = /```([\w.+-]+)[:\/]([^\n\r]+)[\n\r]([\s\S]*?)```/g;
    while ((m = P2.exec(reply)) !== null) {
      const lang = m[1].toLowerCase().trim();
      const name = m[2].trim();
      const content = m[3];
      if (name.includes('.') && content && !seen.has(name)) {
        seen.add(name);
        files.push({ lang, name, content, mime: getMimeType(name) });
      }
    }
  }

  return files;
}

function extractNotes(reply) {
  const notes = [];
  const re = /^📌\s*(?:NOTE|DECISION|REMEMBER)\s*[:：]\s*(.+)$/gim;
  let m;
  while ((m = re.exec(reply)) !== null) {
    const t = m[1].trim();
    if (t) notes.push(t);
  }
  return notes;
}

// 👤 Bob profile bridge: Builder gets a READ-ONLY snapshot of Bob's memory about Master.
async function buildBobProfile(userId) {
  const [facts, monthMemory] = await Promise.all([
    memory.listFacts(userId).catch(() => []),
    memory.getMonthMemoryText(userId, memoryManager.isoMonthKey(new Date())).catch(() => ''),
  ]);
  const lines = [];
  if (facts.length) lines.push(`Facts & habits: ${facts.map(f => f.text).join('; ')}`);
  if (monthMemory) lines.push(`Current month memory: ${monthMemory}`);
  if (!lines.length) return null;
  return `👤 MASTER NIKHIL KA PROFILE (Bob ki yaad se — sirf inhi facts use karo, invent mat karo):\n${lines.join('\n')}`;
}

// 🤝 Live Bob consult: Builder literally asks Bob's LLM (with Bob's memory) a personal-data question.
async function consultBob(userId, question) {
  const [facts, monthMemory, sessions] = await Promise.all([
    memory.listFacts(userId).catch(() => []),
    memory.getMonthMemoryText(userId, memoryManager.isoMonthKey(new Date())).catch(() => ''),
    memory.listSessions(userId).catch(() => []),
  ]);
  let recentBlock = 'none';
  if (sessions.length) {
    const lines = [];
    const lists = await Promise.all(sessions.slice(0, 3).map(s => memory.getRecentMessages(userId, s.id, 15).catch(() => [])));
    lists.forEach((list, i) => {
      const title = String((sessions[i] && sessions[i].title) || 'chat').slice(0, 40);
      list.forEach(m => lines.push(`[${title}] ${m.role}: ${String(m.content).slice(0, 200)}`));
    });
    if (lines.length) recentBlock = lines.slice(0, 60).join('\n');
  }
  const sys = `You are Bob, Master Nikhil's personal AI assistant. Answer the question using ONLY your memory about him.
Facts & habits: ${facts.map(f => f.text).join('; ') || 'none'}
Current month memory: ${monthMemory || 'none'}
Recent conversations:\n${recentBlock}
Rules: Only state what you actually KNOW. If you don't know, say "mujhe is bare me data nahi hai". Never invent. Hinglish allowed. Be concise.`;
  try {
    const res = await callLLM({
      role: 'chat',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: question },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });
    return (res && res.text) || 'Bob ko is bare me data nahi mila.';
  } catch (err) {
    return 'Bob consult failed: ' + err.message;
  }
}

// Core one-turn Builder pipeline (shared by POST /chat and POST /delegate)
async function runBuilderTurn(userId, session, message, sender) {
  // Strip ```bobquery blocks (Builder asking Bob personal data) before storing/LLM
  let llmMessage = message;
  let bobAnswer = null;
  const bobQuestion = (message.match(BOBQUERY_RE) || [])[1];
  if (bobQuestion) {
    llmMessage = message.replace(BOBQUERY_RE, '').trim();
    bobAnswer = await consultBob(userId, bobQuestion.trim());
  } else if (PERSONAL_WORD_RE.test(message)) {
    bobAnswer = await consultBob(userId, `Master Nikhil ne Builder ko ye bheja: "${message.slice(0, 400)}" — iske liye meri personal details chahiye (like instagram account, github links, projects, preferences). Jo data tere paas hai wo bata.`);
  }

  // Detect project type
  let projectType = knowledge.resolveType(llmMessage || message) || session.projectType || null;
  if (projectType && projectType !== session.projectType) {
    await builder.updateBuilderSessionProjectType(userId, session.id, projectType);
    session.projectType = projectType;
  }

  // Save the incoming message (sender: 'user' for Master, 'bob' for Bob)
  await builder.addBuilderMessage(userId, session.id, 'user', llmMessage, sender === 'bob' ? 'bob' : 'user');

  const history = await builder.getBuilderMessages(userId, session.id, 40);
  const notes = await builder.getBuilderNotes(userId, session.id);
  const knowledgeContext = knowledge.buildKnowledgeContext(message);

  // Title from first real message
  if (history.length <= 2 && (session.title === 'New Project' || !session.title)) {
    const title = (llmMessage || message).replace(/\s+/g, ' ').slice(0, 45) || 'Project Plan';
    await builder.updateBuilderSessionTitle(userId, session.id, title);
    session.title = title;
  }

  const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  let systemPrompt = `${knowledge.BUILDER_PLAYBOOK}\n\n- Current IST time: ${nowIST}`;
  if (projectType) systemPrompt += `\n- Detected project type: ${projectType}`;
  if (knowledgeContext) systemPrompt += `\n\n${knowledgeContext}`;
  if (notes.length) {
    systemPrompt += `\n\n📌 PROJECT MEMORY (decisions you already made for this project — stay consistent):\n${notes.map(n => `- ${n}`).join('\n')}`;
  }

  // 👤 Bob profile (always) + 🤝 live Bob answer (when asked)
  const bobProfile = await buildBobProfile(userId);
  if (bobProfile) systemPrompt += `\n\n${bobProfile}`;
  if (bobAnswer) systemPrompt += `\n\n🤝 BOB KA JAWAAB (Bob ne apni yaad se ye bataya — isko personal data ke roop me use karo):\n${bobAnswer}`;

  // GitHub repo self-read
  let repoAnalysis = null;
  if (repo.extractRepoUrls(message).length) {
    repoAnalysis = await repo.analyzeRepo(message).catch(err => ({ status: 'error', message: err.message }));
  }
  if (repoAnalysis) {
    if (repoAnalysis.status === 'ok') {
      systemPrompt += `\n\n${repoAnalysis.context}\n\nINSTRUCTIONS: You just self-read this GitHub repo. Give Master Nikhil: (1) a crisp "ye project kya hai" summary (purpose, stack, architecture), (2) strengths, (3) the biggest GAPS / missing features / bugs & risks you found in the actual code, (4) a step-by-step improvement roadmap, (5) if he wants, generate the fix/new-feature files as filename blocks. Be concrete — reference actual files you read.`;
    } else if (repoAnalysis.status === 'private') {
      systemPrompt += `\n\n[BLOCKER] The repo "${repoAnalysis.repo.fullName}" is PRIVATE, so Bob the Builder could NOT read it. Respond kindly in Hinglish telling Master Nikhil: repo private hai — GitHub pe 'Make public' karne ko bolo (Settings → Danger Zone) aur link dobara bheje. Do NOT guess or invent anything about the codebase.`;
    } else {
      systemPrompt += `\n\n[BLOCKER] Repo read failed (${repoAnalysis.error || 'error'}): ${repoAnalysis.message}. Respond kindly in Hinglish: batao kya problem hai (link galat / repo private / rate limit) aur kya kare. Do NOT invent repo contents.`;
    }
  }

  // Background-task progress context
  if (/task|background|progress|kitne baje|eta|done|scan/i.test(message)) {
    const activeTasks = await tasks.listActiveTasks(userId).catch(() => []);
    if (activeTasks.length) {
      systemPrompt += `\n\n🧩 BACKGROUND TASKS (Master Nikhil may ask about these — report EXACTLY this status, do not guess):\n${activeTasks.map(tasks.formatTaskStatus).join('\n')}\nIf a task is DONE, tell him the report is already in this session. If he asks when it will finish, give the ETA shown above.`;
    }
  }

  const trimmedHistory = history.slice(-14).map(m => ({ role: m.role, content: m.content }));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
  ];

  const result = await callLLM({
    role: 'builder',
    persona: 'builder',
    messages,
    temperature: 0.4,
    max_tokens: 8000,
  });
  const reply = result.text;

  await builder.addBuilderMessage(userId, session.id, 'assistant', reply, 'builder');

  const newNotes = extractNotes(reply);
  for (const note of newNotes) {
    await builder.addBuilderNote(userId, session.id, note);
  }

  const packFiles = extractPackFiles(reply);
  let projectSaved = false;
  if (packFiles.length) {
    await builder.saveBuilderProject(userId, session.id, {
      name: (session.title && session.title !== 'New Project') ? session.title : (projectType || 'Untitled Project'),
      type: projectType,
      files: packFiles,
    });
    projectSaved = true;
  }

  return {
    reply,
    session,
    projectType,
    notesSaved: newNotes.length,
    projectSaved,
    repo: repoAnalysis ? {
      status: repoAnalysis.status,
      fullName: repoAnalysis.repo && repoAnalysis.repo.fullName,
      readCount: repoAnalysis.readCount || 0,
      totalFiles: repoAnalysis.stats ? repoAnalysis.stats.fileCount : 0,
    } : null,
    model: result.model,
    consultedBob: !!bobAnswer,
  };
}

// GET /api/builder/sessions
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await builder.listBuilderSessions(req.userId, 40);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/builder/projects
router.get('/projects', requireAuth, async (req, res) => {
  try {
    const projects = await builder.listBuilderProjects(req.userId, 40);
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/builder/projects/:id/zip — Download generated codebase as a .zip file
router.get('/projects/:id/zip', requireAuth, async (req, res) => {
  try {
    const { buffer, filename } = await builder.generateProjectZip(req.userId, req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[Builder ZIP] Export error:', err.message);
    res.status(404).json({ error: 'Zip generation failed', details: err.message });
  }
});

// GET /api/builder/sessions/:id/messages
router.get('/sessions/:id/messages', requireAuth, async (req, res) => {
  try {
    const [messages, notes, project] = await Promise.all([
      builder.getBuilderMessages(req.userId, req.params.id, 60),
      builder.getBuilderNotes(req.userId, req.params.id),
      builder.getBuilderProject(req.userId, req.params.id),
    ]);
    res.json({ messages, notes, project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/builder/sessions/:id
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    await builder.deleteBuilderSession(req.userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/builder/tasks — queue a background research task
router.post('/tasks', requireAuth, async (req, res) => {
  try {
    const { command, sessionId } = req.body;
    if (!command || typeof command !== 'string' || command.trim().length < 3) {
      return res.status(400).json({ error: 'command is required (min 3 chars)' });
    }
    const { task, etaMinutes } = await tasks.createTask(req.userId, { command: command.trim(), sessionId: sessionId || null });
    setTimeout(() => tasks.processNextTask().catch(() => {}), 0);
    res.json({
      ok: true,
      task: { id: task.id, status: task.status, query: task.query, totalSteps: task.totalSteps, etaMinutes },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/builder/tasks — list tasks (newest first)
router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const taskList = await tasks.listTasks(req.userId, 10);
    res.json({ tasks: taskList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/builder/tasks/pump — background worker, called every 5 min by
// the GitHub Actions workflow (.github/workflows/task-pump.yml). Advances one
// task by one step, so long jobs finish in the backend without any request open.
router.post('/tasks/pump', cronAuth, async (req, res) => {
  try {
    const result = await tasks.processNextTask();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/builder/chat  { sessionId?, message }
router.post('/chat', requireAuth, async (req, res) => {
  const { sessionId, message } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 12000) {
    return res.status(400).json({ error: 'message must be under 12000 characters' });
  }

  try {
    // 1. Ensure a session exists
    let session = sessionId ? await builder.getBuilderSession(req.userId, sessionId) : null;
    if (!session) {
      session = await builder.createBuilderSession(req.userId, { title: 'New Project' });
    }

    // 1.5 Background research task? (e.g. "github me X ke projects dhundh aur report banao")
    if (detectTaskIntent(message)) {
      await builder.addBuilderMessage(req.userId, session.id, 'user', message.trim(), 'user');

      const hist = await builder.getBuilderMessages(req.userId, session.id, 5);
      if (hist.length <= 2 && (session.title === 'New Project' || !session.title)) {
        const title = message.replace(/\s+/g, ' ').slice(0, 45) || 'Project Plan';
        await builder.updateBuilderSessionTitle(req.userId, session.id, title);
        session.title = title;
      }

      const { task, etaMinutes } = await tasks.createTask(req.userId, { command: message.trim(), sessionId: session.id });
      const reply =
`✅ Background task ban gaya! 🏗️

**Command:** "${message.trim()}"
**Plan:** GitHub pe "${task.query}" search → top repos read karke samjhunga → final report banaunga.

⏱️ Approx time: ~${etaMinutes} min (backend har 5 min me progress karta hai, ${task.totalSteps} steps).
📌 Jab complete hoga, report yahi session me + notification me aa jayegi — dobara poochna nahi padega.
💬 Progress poochhne ke liye: "task progress" likho.`;
      await builder.addBuilderMessage(req.userId, session.id, 'assistant', reply, 'builder');
      setTimeout(() => tasks.processNextTask().catch(() => {}), 0);

      return res.json({
        reply,
        sessionId: session.id,
        title: (session.title && session.title !== 'New Project') ? session.title : 'Project',
        task: { id: task.id, query: task.query, totalSteps: task.totalSteps, etaMinutes },
        taskStarted: true,
        model: 'background',
      });
    }

    // 2. One full Builder turn (user message → Builder reply + notes + pack files)
    const out = await runBuilderTurn(req.userId, session, message.trim(), 'user');

    res.json({
      reply: out.reply,
      sessionId: session.id,
      title: (session.title && session.title !== 'New Project') ? session.title : 'Project',
      projectType: out.projectType,
      notesSaved: out.notesSaved,
      projectSaved: out.projectSaved,
      repo: out.repo,
      consultedBob: out.consultedBob,
      model: out.model,
    });
  } catch (err) {
    console.error('[Builder] Error:', err.message);
    res.status(500).json({ error: 'Builder LLM call failed', details: err.message });
  }
});

// POST /api/builder/delegate  { sessionId?, title?, instruction }
// Bob sends a planning task to Bob the Builder: creates/reuses a Builder session,
// posts Bob's message there (sender 'bob'), Builder replies, user gets a notification.
router.post('/delegate', requireAuth, async (req, res) => {
  const { sessionId, title, instruction } = req.body;
  if (!instruction || typeof instruction !== 'string' || instruction.trim().length === 0) {
    return res.status(400).json({ error: 'instruction is required' });
  }
  if (instruction.length > 12000) {
    return res.status(400).json({ error: 'instruction must be under 12000 characters' });
  }

  try {
    let session = sessionId ? await builder.getBuilderSession(req.userId, sessionId) : null;
    if (!session) {
      session = await builder.createBuilderSession(req.userId, {
        title: (title && title.trim()) ? title.trim().slice(0, 60) : 'New Project',
      });
    }

    const out = await runBuilderTurn(req.userId, session, instruction.trim(), 'bob');

    const preview = out.reply.split('\n').slice(0, 3).join('\n').slice(0, 160);
    await memory.addNotification(
      req.userId,
      '🏗️ Builder ne jawab diya',
      preview,
      'reminder',
      out.reply
    );

    res.json({
      ok: true,
      sessionId: session.id,
      title: (session.title && session.title !== 'New Project') ? session.title : 'Project',
      reply: out.reply,
      projectType: out.projectType,
      notesSaved: out.notesSaved,
      projectSaved: out.projectSaved,
      repo: out.repo,
      consultedBob: out.consultedBob,
      model: out.model,
    });
  } catch (err) {
    console.error('[Builder] Delegate error:', err.message);
    res.status(500).json({ error: 'Builder delegation failed', details: err.message });
  }
});

module.exports = router;
