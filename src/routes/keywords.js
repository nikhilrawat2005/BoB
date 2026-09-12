const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const seo = require('../services/seoService');
const kr = require('../services/keywordResearchService');

// Cron auth for the scheduled rankings refresh (GitHub Actions) — mirrors the
// seo.js /api/seo/pump pattern so the same CRON_SECRET can drive this endpoint.
function cronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (cronSecret) {
    if (provided === cronSecret) return next();
    return res.status(401).json({ error: 'Unauthorized cron call' });
  }
  return requireAuth(req, res, next);
}

function todayUrl(domain, url) {
  return (url || '').trim() || (domain ? `https://${domain}` : '');
}

// GET /api/keywords/:siteId — stored keyword research for a site
router.get('/:siteId', requireAuth, async (req, res) => {
  try {
    const site = await seo.getSite(req.userId, req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ keywordData: site.keywordData || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keywords/:siteId/research
// body: { locationTargets?, languageTargets?, userProvidedUrls?, ideaLimit?, rankLimit? }
router.post('/:siteId/research', requireAuth, async (req, res) => {
  const body = req.body || {};
  try {
    const site = await seo.getSite(req.userId, req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const keywordData = await kr.runKeywordResearch(req.userId, req.params.siteId, todayUrl(site.domain, site.url), site.audit || {}, {
      locationTargets: body.locationTargets,
      languageTargets: body.languageTargets,
      userProvidedUrls: body.userProvidedUrls,
      ideaLimit: body.ideaLimit,
      rankLimit: body.rankLimit,
    });
    res.json({ keywordData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keywords/:siteId/refresh-rankings — lightweight position-only refresh
router.post('/:siteId/refresh-rankings', requireAuth, async (req, res) => {
  try {
    const result = await kr.refreshAllRankings(req.userId, req.params.siteId);
    const site = await seo.getSite(req.userId, req.params.siteId);
    res.json({ keywordData: (site && site.keywordData) || null, refreshed: result.refreshed, siteId: result.siteId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keywords/:siteId/competitors — discover/refresh competitors
// body: { userProvidedUrls?, niche? }
router.post('/:siteId/competitors', requireAuth, async (req, res) => {
  const body = req.body || {};
  try {
    const site = await seo.getSite(req.userId, req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const url = todayUrl(site.domain, site.url);
    const competitors = await kr.findCompetitors(body.niche || site.keywordData && site.keywordData.seeds && site.keywordData.seeds[0] || '', url, body.userProvidedUrls);

    // Persist the competitor list on the site's keywordData.
    // The request is authoritative: from findCompetitors (user-provided URLs,
    // plus any auto-discovered ones) becomes the stored list when the caller
    // sends an explicit list or asks for discovery. Otherwise keep the stored
    // list untouched. This gives the Manage Competitors UI clean add/remove/
    // discover semantics.
    const kd = site.keywordData || { keywords: [], history: [], competitors: [] };
    const hasExplicit = Array.isArray(body.userProvidedUrls) && body.userProvidedUrls.length > 0;
    const base = (hasExplicit || body.discover) ? [] : (Array.isArray(kd.competitors) ? kd.competitors : []);
    const keyed = new Map();
    [...base, ...competitors].forEach(c => keyed.set(c.url, c));
    const merged = [...keyed.values()];
    const updated = { ...kd, competitors: merged, updatedAt: new Date().toISOString() };
    const { db } = require('../config/firebase');
    await db.collection('users').doc(req.userId).collection('seoSites').doc(req.params.siteId).set({ keywordData: updated }, { merge: true });

    res.json({ competitors: competitors, competitorsAll: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keywords/refresh-all — cron workers: siteless ranking refresh across sites
// IMPORTANT: must stay above any /:siteId route that could shadow it (different
// path depth, but keep the worker path stable and predictable).
router.post('/refresh-all', cronAuth, async (req, res) => {
  try {
    const sites = await seo.listSites(req.userId || process.env.SHARED_ADMIN_ID || 'nikhil_master_workspace');
    const processed = [];
    let limit = 5;
    for (const site of sites || []) {
      if (limit <= 0) break;
      let kd = null;
      try {
        const full = await seo.getSite(req.userId || process.env.SHARED_ADMIN_ID || 'nikhil_master_workspace', site.id);
        kd = full && full.keywordData;
      } catch { continue; }
      if (!kd || !Array.isArray(kd.keywords) || !kd.keywords.length) continue;
      try {
        const r = await kr.refreshAllRankings(req.userId || process.env.SHARED_ADMIN_ID || 'nikhil_master_workspace', site.id);
        processed.push(r);
        limit -= 1;
      } catch (err) {
        processed.push({ siteId: site.id, error: err.message });
      }
    }
    res.json({ ok: true, processed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;