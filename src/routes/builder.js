const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { callLLM } = require('../services/llmService');
const builder = require('../services/builderService');
const knowledge = require('../services/builderKnowledgeService');
const repo = require('../services/repoService');

const FILE_BLOCK_RE = /```([\w.+-]+)[ \t]+filename=([^\n\r]+)[\n\r]([\s\S]*?)```/g;

function extractPackFiles(reply) {
  const files = [];
  let m;
  while ((m = FILE_BLOCK_RE.exec(reply)) !== null) {
    files.push({
      lang: m[1].toLowerCase().trim(),
      name: m[2].trim(),
      content: m[3],
      mime: 'text/markdown',
    });
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

    // 2. Detect project type (message first, then session default)
    let projectType = knowledge.resolveType(message) || session.projectType || null;
    if (projectType && projectType !== session.projectType) {
      await builder.updateBuilderSessionProjectType(req.userId, session.id, projectType);
      session.projectType = projectType;
    }

    // 3. Save user message
    await builder.addBuilderMessage(req.userId, session.id, 'user', message.trim());

    // 4. Pull context (project-based memory, never Bob's personal data)
    const history = await builder.getBuilderMessages(req.userId, session.id, 40);
    const notes = await builder.getBuilderNotes(req.userId, session.id);
    const knowledgeContext = knowledge.buildKnowledgeContext(message);

    // 5. GitHub repo self-read: if the message contains a repo link, analyze it
    let repoAnalysis = null;
    if (repo.extractRepoUrls(message).length) {
      repoAnalysis = await repo.analyzeRepo(message).catch(err => ({ status: 'error', message: err.message }));
    }

    // 5b. Title from first real message
    if (history.length <= 2 && (session.title === 'New Project' || !session.title)) {
      const title = message.replace(/\s+/g, ' ').slice(0, 45) || 'Project Plan';
      await builder.updateBuilderSessionTitle(req.userId, session.id, title);
      session.title = title;
    }

    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    let systemPrompt = `${knowledge.BUILDER_PLAYBOOK}\n\n- Current IST time: ${nowIST}`;
    if (projectType) systemPrompt += `\n- Detected project type: ${projectType}`;
    if (knowledgeContext) systemPrompt += `\n\n${knowledgeContext}`;
    if (notes.length) {
      systemPrompt += `\n\n📌 PROJECT MEMORY (decisions you already made for this project — stay consistent):\n${notes.map(n => `- ${n}`).join('\n')}`;
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

    // 6. Build message list (trim history to last 14 messages)
    const trimmedHistory = history.slice(-14).map(m => ({ role: m.role, content: m.content }));
    const messages = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
    ];

    // 7. Call Builder LLM on its own key/model
    const result = await callLLM({
      role: 'builder',
      persona: 'builder',
      messages,
      temperature: 0.5,
      max_tokens: 4000,
    });

    const reply = result.text;

    // 8. Save assistant reply
    await builder.addBuilderMessage(req.userId, session.id, 'assistant', reply);

    // 9. Extract project memory notes from 📌 NOTE: lines
    const newNotes = extractNotes(reply);
    for (const note of newNotes) {
      await builder.addBuilderNote(req.userId, session.id, note);
    }

    // 10. Extract Prompt Pack files → persist as project
    const packFiles = extractPackFiles(reply);
    let projectSaved = false;
    if (packFiles.length) {
      await builder.saveBuilderProject(req.userId, session.id, {
        name: (session.title && session.title !== 'New Project') ? session.title : (projectType || 'Untitled Project'),
        type: projectType,
        files: packFiles,
      });
      projectSaved = true;
    }

    res.json({
      reply,
      sessionId: session.id,
      title: (session.title && session.title !== 'New Project') ? session.title : 'Project',
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
    });
  } catch (err) {
    console.error('[Builder] Error:', err.message);
    res.status(500).json({ error: 'Builder LLM call failed', details: err.message });
  }
});

module.exports = router;
