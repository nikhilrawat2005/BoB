const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const seo = require('../services/seoService');

// Cron auth for the background pump (GitHub Actions) — CRON_SECRET bearer
function cronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (cronSecret) {
    if (provided === cronSecret) return next();
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }
  return requireAuth(req, res, next);
}

// GET /api/seo — list audited sites
router.get('/', requireAuth, async (req, res) => {
  try {
    const sites = await seo.listSites(req.userId);
    res.json({ sites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo  { url } — add website + run audit
router.post('/', requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  try {
    const site = await seo.createSite(req.userId, url);
    res.json({ site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/:id/analyze — re-audit
router.post('/:id/analyze', requireAuth, async (req, res) => {
  try {
    const site = await seo.reAudit(req.userId, req.params.id);
    res.json({ site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/seo/:id  { reAuditEnabled, reAuditIntervalHours } — scheduled re-audit settings
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const site = await seo.updateSiteSettings(req.userId, req.params.id, req.body || {});
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/:id — full site payload (audit + keywords + history) for refresh round-trips
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const site = await seo.getSite(req.userId, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/pump — background re-audit worker (GitHub Actions, every 5 min)
router.post('/pump', cronAuth, async (req, res) => {
  try {
    const results = await seo.processDueReAudits(1);
    res.json({ ok: true, audited: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/seo/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await seo.deleteSite(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/:id/actionplan — Level 4 Token-Optimized AI Action Plan
// body: { force: true } → re-generate even if a cached plan exists
router.post('/:id/actionplan', requireAuth, async (req, res) => {
  try {
    const force = Boolean((req.body || {}).force);
    const plan = await seo.generateAiActionPlan(req.userId, req.params.id, { force });
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/:id/fixplan — ready-to-deploy fix files for the latest audit
router.get('/:id/fixplan', requireAuth, async (req, res) => {
  try {
    const site = await seo.getSite(req.userId, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ plan: seo.generateFixPlan(site) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/:id/report — full HTML SEO report download
router.get('/:id/report', requireAuth, async (req, res) => {
  try {
    const site = await seo.getSite(req.userId, req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ html: seo.generateSeoReport(site) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/:id/keywords — tracked target keywords
router.get('/:id/keywords', requireAuth, async (req, res) => {
  try {
    const keywords = await seo.getKeywords(req.userId, req.params.id);
    res.json({ keywords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/:id/keywords  { keyword } — add target keyword
router.post('/:id/keywords', requireAuth, async (req, res) => {
  const { keyword } = req.body || {};
  try {
    const keywords = await seo.addKeyword(req.userId, req.params.id, keyword);
    res.json({ keywords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/seo/:id/keywords/:keyword — remove target keyword
router.delete('/:id/keywords/:keyword', requireAuth, async (req, res) => {
  try {
    const keywords = await seo.removeKeyword(req.userId, req.params.id, req.params.keyword);
    res.json({ keywords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/:id/chat
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const messages = await seo.chatList(req.userId, req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/:id/chat  { message }
router.post('/:id/chat', requireAuth, async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  if (message.length > 4000) return res.status(400).json({ error: 'message too long' });
  try {
    const data = await seo.chatSend(req.userId, req.params.id, message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;