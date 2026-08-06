const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const llm = require('../services/llmService');

// GET /api/keys/health — anonymized key statuses for the "Keys Limit" HQ card.
// Full API keys are NEVER sent to the frontend — only last4 + balances + usage.
router.get('/health', requireAuth, async (req, res) => {
  try {
    const keys = await llm.checkKeyHealth();
    const snapshot = llm.keyHealthSnapshot();
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

module.exports = router;
