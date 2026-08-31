const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const llm = require('../services/llmService');

// GET /api/keys and /api/keys/health — 3-Block Dual-Queue Key Bag Health
router.get(['/', '/health'], requireAuth, async (req, res) => {
  try {
    const keys = await llm.checkKeyHealth();
    const snapshot = keys.map(k => ({ ...k, maxTokens: llm.MAX_TOKENS_PER_KEY }));
    const active = keys.filter(k => k.pool === 'ACTIVE');
    const exhausted = keys.filter(k => k.pool === 'EXHAUSTED');
    const geminiHealth = llm.getGeminiPoolHealth ? llm.getGeminiPoolHealth() : null;
    const bags = llm.getBagsSnapshot ? llm.getBagsSnapshot() : {};

    res.json({
      // Backward-compatible fields
      keys,
      activeCount: active.length,
      exhaustedCount: exhausted.length,
      newKeysLeft: 0,
      summary: {
        activeCount: active.length,
        totalKeys: keys.length,
        exhaustedCount: exhausted.length,
        allExhausted: active.length === 0 && keys.length > 0,
      },
      maxTokensPerKey: llm.MAX_TOKENS_PER_KEY,
      snapshot,

      // 3-Block Key Bag Structure
      bags,
      bobBag: bags.bobBag || null,
      builderBag: bags.builderBag || null,
      geminiBag: geminiHealth || bags.geminiBag || null,
      gemini: geminiHealth,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keys/verify-models
router.get('/verify-models', requireAuth, async (req, res) => {
  try {
    const result = await llm.verifyModels();
    res.json({
      ...result,
      roles: llm.MODEL_ROLES,
      dead: [...llm.DEAD_MODELS],
      fallback: llm.FALLBACK_MODEL,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keys/route-preview
router.get('/route-preview', requireAuth, (req, res) => {
  try {
    const { model, why } = llm.resolveModel({
      role: req.query.role || 'chat',
      hint: req.query.hint || undefined,
      needsVision: req.query.images === '1' || req.query.images === 'true',
      estTokens: Number(req.query.tokens || 0),
    });
    res.json({ model, why, caps: llm.MODEL_CAPS[model] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keys/reset
router.post('/reset', requireAuth, async (req, res) => {
  try {
    const results = await llm.resetKeyHealth();
    res.json({ ok: true, message: 'All 3 Key Bags reset. Fresh credit checks complete.', keys: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
