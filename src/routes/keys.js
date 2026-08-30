const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const llm = require('../services/llmService');

// GET /api/keys and /api/keys/health — combined OpenRouter + Gemini Pool health
router.get(['/', '/health'], requireAuth, async (req, res) => {
  try {
    const keys = await llm.checkKeyHealth();
    const snapshot = keys.map(k => ({ ...k, maxTokens: llm.MAX_TOKENS_PER_KEY }));
    const active = keys.filter(k => k.pool === 'ACTIVE');
    const exhausted = keys.filter(k => k.pool === 'EXHAUSTED');
    const geminiHealth = llm.getGeminiPoolHealth ? llm.getGeminiPoolHealth() : null;

    res.json({
      // Backward-compatible OpenRouter keys
      keys,
      activeCount: active.length,
      exhaustedCount: exhausted.length,
      newKeysLeft: keys.filter(k => k.pool === 'NEW' && k.role !== 'BUILDER').length,
      summary: {
        activeCount: active.length,
        totalKeys: keys.length,
        exhaustedCount: exhausted.length,
        allExhausted: active.length === 0 && keys.length > 0,
      },
      maxTokensPerKey: llm.MAX_TOKENS_PER_KEY,
      snapshot,

      // Dual Pool Health
      openRouter: {
        keys,
        activeCount: active.length,
        exhaustedCount: exhausted.length,
        totalKeys: keys.length,
        maxTokensPerKey: llm.MAX_TOKENS_PER_KEY,
      },
      gemini: geminiHealth,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keys/verify-models — on-demand sanity check of the model routing
// config against live OpenRouter data. Catches retired slugs (zero serving
// endpoints), models missing from MODEL_CAPS, and vision-capability drift.
//
// Deliberately NOT run at boot: on Vercel that would add a network round trip to
// every cold start. Hit this after changing any *_MODEL env var.
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

// GET /api/keys/route-preview — dry-run the router without spending a token.
// Example: /api/keys/route-preview?role=chat&hint=deepseek/deepseek-chat-v3&images=1
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

// POST /api/keys/reset — wipe all key states and run fresh credit checks.
// Use this after adding/removing keys in Vercel env to make changes take effect
// without waiting for the next cold start.
router.post('/reset', requireAuth, async (req, res) => {
  try {
    const results = await llm.resetKeyHealth();
    res.json({ ok: true, message: 'All keys reset to healthy. Fresh credit checks complete.', keys: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
