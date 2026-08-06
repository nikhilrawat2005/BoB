const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const llm = require('../services/llmService');

// Pool of FRESH OpenRouter keys (not yet active) kept for when active keys exhaust.
// Exposed ONLY as a count — never the key strings.
const NEW_KEYS_POOL = 5;

// GET /api/keys/health — anonymized key statuses for the "Keys Limit" HQ card.
// Full API keys are NEVER sent to the frontend — only last4 + balances + usage.
router.get('/health', requireAuth, async (req, res) => {
  try {
    const keys = await llm.checkKeyHealth();
    const snapshot = llm.keyHealthSnapshot();
    const active = keys.filter(k => k.pool === 'NEW' || k.pool === 'ACTIVE');
    const exhausted = keys.filter(k => k.pool === 'EXHAUSTED');
    res.json({
      keys,                         // [{ last4, balance, used, status, tokensUsed, maxTokens, lastCheck }]
      newKeysLeft: NEW_KEYS_POOL,   // count of fresh replacement keys available
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

module.exports = router;
