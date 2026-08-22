const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const memory = require('../services/memoryService');
const memoryManager = require('../services/memoryManager');

// GET /api/memory/unified  — Full aggregated memory hub dataset (Facts, Stalker Profiles, Hackathons)
router.get('/unified', requireAuth, async (req, res) => {
  try {
    const data = await memory.getUnifiedMemoryHub(req.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/stalker-insight/delete { profId, insightText }
router.post('/stalker-insight/delete', requireAuth, async (req, res) => {
  const { profId, insightText } = req.body;
  if (!profId || !insightText) return res.status(400).json({ error: 'profId and insightText required' });
  try {
    const ok = await memory.deleteProfileInsight(req.userId, profId, insightText);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/stalker-insight/add { profId, insightText }
router.post('/stalker-insight/add', requireAuth, async (req, res) => {
  const { profId, insightText } = req.body;
  if (!profId || !insightText) return res.status(400).json({ error: 'profId and insightText required' });
  try {
    const ok = await memory.addProfileInsight(req.userId, profId, insightText);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/hackathon-rule/delete { hackId, ruleText }
router.post('/hackathon-rule/delete', requireAuth, async (req, res) => {
  const { hackId, ruleText } = req.body;
  if (!hackId || !ruleText) return res.status(400).json({ error: 'hackId and ruleText required' });
  try {
    const ok = await memory.deleteHackathonRule(req.userId, hackId, ruleText);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/hackathon-rule/add { hackId, ruleText }
router.post('/hackathon-rule/add', requireAuth, async (req, res) => {
  const { hackId, ruleText } = req.body;
  if (!hackId || !ruleText) return res.status(400).json({ error: 'hackId and ruleText required' });
  try {
    const ok = await memory.addHackathonRule(req.userId, hackId, ruleText);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/facts
router.get('/facts', requireAuth, async (req, res) => {
  try {
    const facts = await memory.listFacts(req.userId);
    res.json({ facts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/facts  { text, category, sourceTitle, sourceType, sessionId }
router.post('/facts', requireAuth, async (req, res) => {
  const { text, category, sourceTitle, sourceType, sessionId } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (typeof text !== 'string' || text.length > 2000) {
    return res.status(400).json({ error: 'text must be a string under 2000 characters' });
  }
  try {
    const fact = await memory.addFact(req.userId, text, category, { sourceTitle, sourceType, sessionId });
    res.json({ fact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/memory/facts/:id
router.delete('/facts/:id', requireAuth, async (req, res) => {
  try {
    await memory.deleteFact(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/memory/facts/:id  { text, category, sourceTitle, sourceType, sessionId }
router.put('/facts/:id', requireAuth, async (req, res) => {
  const { text, category, sourceTitle, sourceType, sessionId } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Valid text is required' });
  }
  try {
    const updated = await memory.updateFact(req.userId, req.params.id, text.trim(), category, { sourceTitle, sourceType, sessionId });
    res.json({ success: true, fact: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/memory/facts/:id/category { category }
router.put('/facts/:id/category', requireAuth, async (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: 'category is required' });
  try {
    const updated = await memory.updateFactCategory(req.userId, req.params.id, category);
    res.json({ success: true, fact: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/page  { category, sourceTitle, sourceType, sessionId, points: [...] | content: "..." }
router.post('/page', requireAuth, async (req, res) => {
  const { category, sourceTitle, sourceType, sessionId, points, content } = req.body;
  if (!sourceTitle) return res.status(400).json({ error: 'sourceTitle is required' });
  try {
    const inputPoints = points || content || [];
    const result = await memory.savePageFacts(req.userId, {
      category: category || 'main',
      sourceTitle,
      sourceType: sourceType || 'chat',
      sessionId: sessionId || null,
      points: inputPoints,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/bulk-category  { category, points: [...] | content: "..." }
router.post('/bulk-category', requireAuth, async (req, res) => {
  const { category, points, content } = req.body;
  if (!category) return res.status(400).json({ error: 'category is required' });
  try {
    const inputPoints = points || content || [];
    const result = await memory.saveCategoryFacts(req.userId, category, inputPoints);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/bulk-all  { factsByCategory }
router.post('/bulk-all', requireAuth, async (req, res) => {
  const { factsByCategory } = req.body;
  try {
    const result = await memory.saveAllFactsBulk(req.userId, factsByCategory || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/consolidate — combine all monthly chunks + facts into individual editable points
router.post('/consolidate', requireAuth, async (req, res) => {
  try {
    const result = await memory.consolidateAllMemory(req.userId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/summarize-weekly — trigger rolling weekly summarizer across user sessions
router.post('/summarize-weekly', requireAuth, async (req, res) => {
  try {
    const result = await memoryManager.runWeeklyRollingSummarizer(req.userId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/sessions/:sessionId/summaries — get rolling summaries for a specific chat
router.get('/sessions/:sessionId/summaries', requireAuth, async (req, res) => {
  try {
    const summaries = await memory.listSessionSummaries(req.userId, req.params.sessionId);
    res.json({ summaries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/refresh  — manually run monthly summarizer + finalize stale months
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    await memoryManager.finalizeStaleMonths(req.userId);
    const summarized = await memoryManager.summarizeUserSessions(req.userId);
    await memoryManager.runWeeklyRollingSummarizer(req.userId);
    res.json({ ok: true, summarized: Boolean(summarized) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/memory/months  — list month memory (chunks) + exported monthly files
router.get('/months', requireAuth, async (req, res) => {
  try {
    const [months, files] = await Promise.all([
      memory.listMonthMemory(req.userId, 12),
      memory.listMonthlyFiles(req.userId, 12),
    ]);
    const enriched = months.map(m => ({
      monthId: m.id,
      label: memoryManager.monthLabel(m.id),
      range: memoryManager.monthRange(m.id),
      chunkCount: (m.chunks || []).length,
      finalized: Boolean(m.finalized),
      updatedAt: m.updatedAt || 0,
      preview: (m.chunks || []).length
        ? m.chunks[m.chunks.length - 1].points.slice(0, 140)
        : '',
    }));
    res.json({ months: enriched, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/months/:monthId/download  — download exported monthly .md file
router.get('/months/:monthId/download', requireAuth, async (req, res) => {
  try {
    const { monthId } = req.params;
    if (!/^\d{4}-\d{2}$/.test(monthId)) return res.status(400).json({ error: 'Invalid month id' });
    const file = await memory.getMonthlyFile(req.userId, monthId);
    if (!file) {
      // Fallback: build the report on the fly from memory chunks
      const month = await memory.getMonthMemory(req.userId, monthId);
      if (!month || !month.chunks || !month.chunks.length) {
        return res.status(404).json({ error: 'Monthly memory not found' });
      }
      const content = memoryManager.buildMonthReportMarkdown
        ? memoryManager.buildMonthReportMarkdown(monthId, month.chunks)
        : month.chunks.map(c => c.points).join('\n\n');
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="Bob-Memory-${monthId}.md"`);
      return res.send(content);
    }
    res.setHeader('Content-Type', file.mime || 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename || `Bob-Memory-${monthId}.md`}"`);
    res.send(file.content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/year/:year/download  — combine all finalized months of a year
router.get('/year/:year/download', requireAuth, async (req, res) => {
  try {
    const { year } = req.params;
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Invalid year' });
    const files = await memory.listMonthlyFiles(req.userId, 12);
    const yearFiles = files.filter(f => (f.id || '').startsWith(year + '-'));
    if (!yearFiles.length) return res.status(404).json({ error: 'No monthly files for this year' });
    const parts = yearFiles
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .map(f => f.content)
      .join('\n\n---\n\n');
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="Bob-Memory-Year-${year}.md"`);
    res.send(parts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
