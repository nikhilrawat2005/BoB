const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const llm = require('../services/llmService');

// GET /api/keys/health — anonymized key statuses for the "Keys Limit" HQ card.
// Full API keys are NEVER sent to the frontend — only last4 + balances + usage.
router.get('/health', requireAuth, async (req, res) => {
  try {
    // FIX: keyHealthSnapshot() and checkKeyHealth() used to be called back-to-back
    // as two independent reads of the same in-memory keyUsage map. checkKeyHealth()
    // does a live /credits fetch + mutates status (exhausted/healthy) per key; the
    // old code then called keyHealthSnapshot() straight after, which re-reads the
    // (now possibly-just-mutated, or if another request interleaved, differently
    // mutated) map from scratch. That's two separate reads of shared mutable state
    // with no atomicity between them, so `keys` and `snapshot` could legitimately
    // disagree (e.g. a concurrent request marks a key exhausted between the two
    // calls, or lastCheck caching means one call is a live result and the other is
    // stale). Fix: do ONE read (checkKeyHealth) and derive `snapshot` from that same
    // result set — single source of truth, always consistent.
    const keys = await llm.checkKeyHealth();
    const snapshot = keys.map(k => ({ ...k, maxTokens: llm.MAX_TOKENS_PER_KEY }));
    const active = keys.filter(k => k.pool === 'ACTIVE');
    const exhausted = keys.filter(k => k.pool === 'EXHAUSTED');
    res.json({
      keys,                         // [{ last4, balance, used, status, tokensUsed, maxTokens, lastCheck }]
      newKeysLeft: keys.filter(k => k.pool === 'NEW' && k.role !== 'BUILDER').length,
      summary: {
        activeCount: active.length,
        totalKeys: keys.length,
        exhaustedCount: exhausted.length,
        allExhausted: active.length === 0 && keys.length > 0,
      },
      maxTokensPerKey: llm.MAX_TOKENS_PER_KEY,
      snapshot,
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

module.exports = router;
