const fetch = require('node-fetch');
const geminiPool = require('./geminiPoolService');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---------------------------------------------------------------------------
// 3-Block Dynamic Queue Key Bag Architecture
// Block 1: Bob Key Bag (Queue A: Active ⇄ Queue B: Cooldown/Rest)
// Block 2: Builder Key Bag (Queue A: Active ⇄ Queue B: Cooldown/Rest)
// Block 3: Gemini Burst Bag (Managed via geminiPoolService)
// ---------------------------------------------------------------------------

const _rawKeys = [];
const _keyEnvName = new Map();

// Loop up to 99 so high-numbered keys like OPENROUTER_API_KEY20..KEY38 are all loaded
for (let i = 1; i <= 99; i++) {
  const envName = `OPENROUTER_API_KEY${i}`;
  const raw = process.env[envName];
  if (raw && raw.trim() && !_rawKeys.includes(raw.trim())) {
    _rawKeys.push(raw.trim());
    _keyEnvName.set(raw.trim(), envName);
  }
}
if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()) {
  const k = process.env.OPENROUTER_API_KEY.trim();
  if (!_rawKeys.includes(k)) { _rawKeys.push(k); _keyEnvName.set(k, 'OPENROUTER_API_KEY'); }
}
if (process.env.BOB_API_KEY && process.env.BOB_API_KEY.trim()) {
  const k = process.env.BOB_API_KEY.trim();
  if (!_rawKeys.includes(k)) { _rawKeys.unshift(k); _keyEnvName.set(k, 'BOB_API_KEY'); }
}

const _builderKeys = [];
// Loop up to 99 for builder keys too
for (let i = 1; i <= 99; i++) {
  const envName = `BUILDER_API_KEY${i}`;
  const raw = process.env[envName];
  if (raw && raw.trim() && !_builderKeys.includes(raw.trim())) {
    _builderKeys.push(raw.trim());
    _keyEnvName.set(raw.trim(), envName);
  }
}
if (process.env.BUILDER_API_KEY && process.env.BUILDER_API_KEY.trim()) {
  const b0 = process.env.BUILDER_API_KEY.trim();
  if (!_builderKeys.includes(b0)) { _builderKeys.unshift(b0); _keyEnvName.set(b0, 'BUILDER_API_KEY'); }
}

// Remove builder keys from Bob pool if duplicate
for (const bk of _builderKeys) {
  for (let i = _rawKeys.length - 1; i >= 0; i--) {
    if (_rawKeys[i] === bk) _rawKeys.splice(i, 1);
  }
}

function _allVisibleKeys() {
  return _builderKeys.length ? [..._rawKeys, ..._builderKeys] : _rawKeys.slice();
}

function _keyIdOf(key) {
  const envVar = _keyEnvName.get(key);
  if (envVar) {
    const match = envVar.match(/(\d+)$/);
    const num = match ? match[1] : '';
    if (envVar.startsWith('BUILDER_API_KEY')) return num ? `BUILDER${num}` : 'BUILDER';
    if (envVar.startsWith('BOB_API_KEY')) return num ? `BOB${num}` : 'BOB';
    return num ? `KEY${num}` : 'KEY';
  }
  const i = _allVisibleKeys().indexOf(key);
  return i >= 0 ? `KEY${i + 1}` : null;
}

function _firestore() {
  try { const { db } = require('../config/firebase'); return db; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Dual-Queue Key Bag Manager Class
// ---------------------------------------------------------------------------
const MAX_TOKENS_PER_KEY = Number(process.env.MAX_TOKENS_PER_KEY || 500000);

class DualQueueKeyBag {
  constructor(name, rawKeyList) {
    this.name = name;
    this.keys = rawKeyList.map((key, idx) => ({
      key,
      keyId: _keyIdOf(key) || `${name}_${idx + 1}`,
      last4: key.slice(-4),
      role: name,
      status: 'active', // 'active' | 'cooldown'
      tokens: 0,
      lastBalance: 0,
      lastUsed: 0,
      lastCheck: 0,
      cooldownUntil: 0,
      lastError: null,
    }));

    this.queueA = [...this.keys]; // Active Working Queue
    this.queueB = [];             // Cooldown / Next-Day Rest Queue
    this.cursor = 0;
    this.lastResetDay = new Date().getUTCDate();
  }

  checkDailyReset() {
    const today = new Date().getUTCDate();
    if (today !== this.lastResetDay) {
      this.lastResetDay = today;
      this.resetDaily();
    }
  }

  resetDaily() {
    for (const k of this.keys) {
      k.status = 'active';
      k.cooldownUntil = 0;
      k.lastError = null;
    }
    this.queueA = [...this.keys];
    this.queueB = [];
    this.cursor = 0;
    console.log(`[llmService] Daily reset completed for ${this.name} Key Bag.`);
  }

  getKey() {
    this.checkDailyReset();
    const now = Date.now();

    // 1. Check if any keys in Queue B (cooldown) have recovered
    for (let i = this.queueB.length - 1; i >= 0; i--) {
      const k = this.queueB[i];
      if (k.status === 'cooldown' && now > k.cooldownUntil) {
        k.status = 'active';
        this.queueB.splice(i, 1);
        if (!this.queueA.some(x => x.key === k.key)) {
          this.queueA.push(k);
        }
      }
    }

    // 2. If Queue A is empty, try to recover any ready keys from Queue B
    if (this.queueA.length === 0 && this.queueB.length > 0) {
      const ready = this.queueB.filter(k => now > k.cooldownUntil);
      if (ready.length > 0) {
        this.queueA = ready;
        this.queueB = this.queueB.filter(k => now <= k.cooldownUntil);
      }
    }

    if (this.queueA.length === 0) return null;

    this.cursor = this.cursor % this.queueA.length;
    const chosen = this.queueA[this.cursor];
    this.cursor = (this.cursor + 1) % this.queueA.length;
    return chosen;
  }

  markCooldown(keyStr, durationMs = 60000, reason = '') {
    const target = this.keys.find(k => k.key === keyStr);
    if (!target) return;
    target.status = 'cooldown';
    target.cooldownUntil = Date.now() + durationMs;
    target.lastError = reason;

    // Move to Queue B if in Queue A
    const aIdx = this.queueA.findIndex(k => k.key === keyStr);
    if (aIdx !== -1) {
      this.queueA.splice(aIdx, 1);
    }
    if (!this.queueB.some(k => k.key === keyStr)) {
      this.queueB.push(target);
    }
    console.warn(`[llmService] ${this.name} Key ...${target.last4} moved to Queue B (cooldown ${durationMs/1000}s): ${reason}`);
  }

  recordUsage(keyStr, tokens) {
    const target = this.keys.find(k => k.key === keyStr);
    if (!target || !tokens) return;
    target.tokens += tokens;
    target.lastUsed = Date.now();
    // NOTE: Token count is tracked for display ONLY.
    // Keys NEVER move to Queue B based on token count.
    // Only a live 429 / rate-limit response triggers markCooldown().
    _persistKey(target.keyId, {
      last4: target.last4,
      tokens: target.tokens,
      status: target.status,
      lastBalance: target.lastBalance,
      lastUsed: target.lastUsed,
    });
  }

  getSnapshot() {
    return {
      name: this.name,
      totalKeys: this.keys.length,
      activeCount: this.queueA.length,
      queueACount: this.queueA.length,
      queueBCount: this.queueB.length,
      queueA: this.queueA.map(k => ({ keyId: k.keyId, last4: k.last4, status: k.status, tokensUsed: k.tokens, lastBalance: k.lastBalance })),
      queueB: this.queueB.map(k => ({ keyId: k.keyId, last4: k.last4, status: k.status, cooldownUntil: k.cooldownUntil, tokensUsed: k.tokens })),
      keys: this.keys.map(k => ({
        keyId: k.keyId,
        role: this.name,
        pool: this.queueA.some(q => q.key === k.key) ? 'ACTIVE' : (this.queueB.some(q => q.key === k.key) ? 'EXHAUSTED' : 'NEW'),
        last4: k.last4,
        tokensUsed: k.tokens,
        status: k.status === 'active' ? 'healthy' : 'cooldown',
        balance: k.lastBalance,
        used: k.lastUsed,
        cooldownUntil: k.cooldownUntil,
        lastError: k.lastError,
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// Key Pool Distribution: Always split shared pool 50/50 between Bob and Builder.
//
// Rule: _rawKeys (OPENROUTER_API_KEY2..KEY20) are ALWAYS split evenly.
//   Bob    → first half  (e.g. KEY2 .. KEY11, 10 keys)
//   Builder → second half (e.g. KEY12 .. KEY20, 9 keys)
//
// If dedicated BUILDER_API_KEY* env vars also exist, those are PREPENDED to
// Builder's half (deduped) — they don't override the split.
// ---------------------------------------------------------------------------
const total     = _rawKeys.length;
const bobCount  = Math.ceil(total / 2); // Bob gets the slightly larger half
const _bobPoolKeys     = _rawKeys.slice(0, bobCount);
const _builderHalf     = _rawKeys.slice(bobCount);

// Prepend any dedicated BUILDER_API_KEY* keys to Builder's half (deduplicate)
const _builderPoolKeys = [
  ..._builderKeys.filter(k => !_builderHalf.includes(k)),
  ..._builderHalf,
];

console.log(`[llmService] Key split → Bob=${_bobPoolKeys.length} keys | Builder=${_builderPoolKeys.length} keys (${_builderKeys.length} dedicated + ${_builderHalf.length} shared)`);

// Instantiate Bob Bag and Builder Bag
const _bobBag     = new DualQueueKeyBag('BOB',     _bobPoolKeys);
const _builderBag = new DualQueueKeyBag('BUILDER', _builderPoolKeys.length ? _builderPoolKeys : _bobPoolKeys);

async function _persistKey(keyId, data) {
  const db = _firestore();
  if (!db || !keyId) return;
  try { await db.collection('keyStates').doc(keyId).set(data, { merge: true }); }
  catch (e) { console.warn('[llmService] keyState persist failed:', e.message); }
}

let _stateLoaded = false;
async function _loadState() {
  if (_stateLoaded) return;
  const db = _firestore();
  if (!db) { _stateLoaded = true; return; }
  try {
    const snap = await db.collection('keyStates').get();
    const all = [..._bobBag.keys, ..._builderBag.keys];
    snap.forEach(doc => {
      const docId = doc.id;
      const d = doc.data() || {};
      const target = all.find(k => k.keyId === docId || k.last4 === d.last4);
      if (target) {
        if (d.tokens != null) target.tokens = d.tokens;
        if (d.lastBalance != null) target.lastBalance = d.lastBalance;
        if (d.lastUsed != null) target.lastUsed = d.lastUsed;
        if (d.lastCheck != null) target.lastCheck = d.lastCheck;
      }
    });
  } catch (e) {
    console.warn('[llmService] keyState load failed:', e.message);
  }
  _stateLoaded = true;
}

const _initPromise = _loadState();
async function _ensureInit() {
  await _initPromise;
}

// ---------------------------------------------------------------------------
// Health Checks & Snapshot
// ---------------------------------------------------------------------------
async function checkKeyHealth(cacheMs = 60000) {
  await _ensureInit();
  const allBags = [_bobBag, _builderBag];
  const results = [];
  const now = Date.now();

  for (const bag of allBags) {
    for (const keyObj of bag.keys) {
      if (now - keyObj.lastCheck < cacheMs && keyObj.lastCheck) {
        results.push({
          keyId: keyObj.keyId,
          role: bag.name,
          pool: bag.queueA.some(q => q.key === keyObj.key) ? 'ACTIVE' : 'EXHAUSTED',
          last4: keyObj.last4,
          status: keyObj.status === 'active' ? 'healthy' : 'cooldown',
          balance: keyObj.lastBalance,
          used: keyObj.lastUsed,
          tokensUsed: keyObj.tokens,
        });
        continue;
      }
      try {
        const res = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${keyObj.key}` } });
        const j = await res.json();
        const d = (j && j.data && j.data[0]) || {};
        const balance = Number(d.total_credits) || 0;
        const used = Number(d.total_usage) || 0;
        keyObj.lastBalance = balance;
        keyObj.lastUsed = used;
        keyObj.lastCheck = now;

        // NOTE: We NEVER call markCooldown here.
        // Balance and token data are updated for display only.
        // Only a live 429 during callOpenRouterDirect() moves a key to Queue B.

        _persistKey(keyObj.keyId, { last4: keyObj.last4, status: keyObj.status, lastCheck: now, lastBalance: balance, lastUsed: used, tokens: keyObj.tokens });
        results.push({
          keyId: keyObj.keyId,
          role: bag.name,
          pool: bag.queueA.some(q => q.key === keyObj.key) ? 'ACTIVE' : 'EXHAUSTED',
          last4: keyObj.last4,
          status: keyObj.status === 'active' ? 'healthy' : 'cooldown',
          balance,
          used,
          tokensUsed: keyObj.tokens,
        });
      } catch (e) {
        results.push({
          keyId: keyObj.keyId,
          role: bag.name,
          pool: bag.queueA.some(q => q.key === keyObj.key) ? 'ACTIVE' : 'EXHAUSTED',
          last4: keyObj.last4,
          status: keyObj.status === 'active' ? 'healthy' : 'cooldown',
          balance: keyObj.lastBalance,
          used: keyObj.lastUsed,
          tokensUsed: keyObj.tokens,
          error: e.message,
        });
      }
    }
  }
  return results;
}

function keyHealthSnapshot() {
  return [..._bobBag.getSnapshot().keys, ..._builderBag.getSnapshot().keys];
}

async function resetKeyHealth() {
  _bobBag.resetDaily();
  _builderBag.resetDaily();
  const db = _firestore();
  const all = [..._bobBag.keys, ..._builderBag.keys];
  for (const k of all) {
    k.tokens = 0;
    k.status = 'active';
    k.lastBalance = 0;
    k.cooldownUntil = 0;
    if (db) {
      await db.collection('keyStates').doc(k.keyId).set(
        { last4: k.last4, tokens: 0, status: 'healthy', lastBalance: 0, lastUsed: 0, lastCheck: 0 },
        { merge: true }
      ).catch(() => {});
    }
  }
  return checkKeyHealth(0);
}

// ---------------------------------------------------------------------------
// Model Roles & Capabilities
// ---------------------------------------------------------------------------
const MODEL_ROLES = {
  chat:     process.env.CHAT_MODEL     || 'google/gemini-2.5-flash-lite',
  builder:  process.env.BUILDER_MODEL  || 'google/gemini-2.5-flash',
  vision:   process.env.VISION_MODEL   || 'google/gemini-2.5-flash',
  fast:     process.env.FAST_MODEL     || 'google/gemini-2.5-flash-lite',
  research: process.env.RESEARCH_MODEL || 'google/gemini-2.5-flash',
  seo:      process.env.SEO_MODEL      || 'google/gemini-2.5-flash',
  review:   process.env.REVIEW_MODEL   || 'google/gemini-2.5-flash',
};

const FALLBACK_MODEL = process.env.FALLBACK_MODEL || 'google/gemini-2.5-flash-lite';

const MODEL_CAPS = {
  'google/gemini-2.5-flash-lite': { vision: true,  ctx: 1000000, costIn: 0.10, costOut: 0.40,  tier: 1 },
  'google/gemini-2.5-flash':      { vision: true,  ctx: 1000000, costIn: 0.30, costOut: 2.50,  tier: 2 },
  'deepseek/deepseek-chat-v3':    { vision: false, ctx:  163840, costIn: 0.26, costOut: 1.03,  tier: 1 },
  'deepseek/deepseek-chat':       { vision: false, ctx:  163840, costIn: 0.26, costOut: 1.03,  tier: 1 },
  'openai/gpt-4o':                { vision: true,  ctx:  128000, costIn: 2.50, costOut: 10.00, tier: 3 },
  'anthropic/claude-sonnet-4':    { vision: true,  ctx: 1000000, costIn: 3.00, costOut: 15.00, tier: 3 },
};

const DEAD_MODELS = new Set([
  'google/gemini-2.0-flash-001',
]);

function _capsFor(model) {
  return MODEL_CAPS[model] || null;
}

function _pickCheapest(predicate) {
  let best = null;
  for (const [slug, caps] of Object.entries(MODEL_CAPS)) {
    if (DEAD_MODELS.has(slug)) continue;
    if (!predicate(caps, slug)) continue;
    if (!best || caps.costIn < best.caps.costIn) best = { slug, caps };
  }
  return best ? best.slug : null;
}

function estimateTokens(messages, extraText = '') {
  let chars = String(extraText || '').length;
  for (const m of messages || []) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && part.type === 'text') chars += String(part.text || '').length;
        else if (part && part.type === 'image_url') chars += 4000;
      }
    }
  }
  return Math.ceil(chars / 4);
}

function resolveModel({ role = 'chat', hint, needsVision = false, estTokens = 0 } = {}) {
  const why = [];
  let model = hint || MODEL_ROLES[role] || MODEL_ROLES.chat || FALLBACK_MODEL;

  if (DEAD_MODELS.has(model)) {
    const roleDefault = MODEL_ROLES[role];
    const next = roleDefault && !DEAD_MODELS.has(roleDefault) ? roleDefault : FALLBACK_MODEL;
    why.push(`dead-slug:${model}->${next}`);
    model = next;
  }

  if (needsVision) {
    const caps = _capsFor(model);
    if (!caps || !caps.vision) {
      const swap = _pickCheapest((c) => c.vision) || FALLBACK_MODEL;
      if (swap !== model) {
        why.push(`needs-vision:${model}->${swap}`);
        model = swap;
      }
    }
  }

  if (estTokens > 0) {
    const caps = _capsFor(model);
    if (caps && estTokens > caps.ctx * 0.8) {
      const swap = _pickCheapest((c) => c.ctx >= estTokens * 1.25 && (!needsVision || c.vision));
      if (swap && swap !== model) {
        why.push(`needs-context:${estTokens}tok:${model}->${swap}`);
        model = swap;
      }
    }
  }

  return { model, why };
}

async function verifyModels() {
  const slugs = new Set([...Object.values(MODEL_ROLES), ...Object.keys(MODEL_CAPS)]);
  const problems = [];
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter model list failed: HTTP ${res.status}`);
  const { data } = await res.json();
  const live = new Map();
  for (const m of data || []) {
    if (m.id) live.set(m.id, m);
    if (m.canonical_slug && !live.has(m.canonical_slug)) live.set(m.canonical_slug, m);
  }
  for (const slug of slugs) {
    const m = live.get(slug);
    if (!m) {
      problems.push({ slug, issue: 'not-found', detail: 'No such model id on OpenRouter.' });
      continue;
    }
    const mods = (m.architecture && m.architecture.input_modalities) || [];
    const caps = MODEL_CAPS[slug];
    if (!caps) {
      problems.push({ slug, issue: 'missing-from-MODEL_CAPS', detail: `modalities: ${mods.join(', ')}` });
    } else if (caps.vision !== mods.includes('image')) {
      problems.push({ slug, issue: 'vision-mismatch', detail: `vision=${caps.vision}, remote=${mods.includes('image')}` });
    }
    if (DEAD_MODELS.has(slug)) {
      problems.push({ slug, issue: 'marked-dead', detail: 'Listed in DEAD_MODELS' });
    }
  }
  return { ok: problems.length === 0, checked: slugs.size, problems };
}

// ---------------------------------------------------------------------------
// Core Dispatcher
// ---------------------------------------------------------------------------
const NON_CONTINUOUS_ROLES = new Set([
  'seo',
  'research',
  'review',
  'memorySummarize',
  'writer',
  'router',
]);

async function callOpenRouterDirect({
  role = 'chat',
  messages,
  model,
  imageUrls = [],
  userText,
  temperature,
  max_tokens,
  persona,
}) {
  await _ensureInit();
  const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0;
  let finalMessages = Array.isArray(messages) ? messages : [];

  if (hasImages) {
    let text = userText;
    if (text == null) {
      const lastUser = [...finalMessages].reverse().find((m) => m.role === 'user');
      text = lastUser && typeof lastUser.content === 'string' ? lastUser.content : '';
    }
    const userContent = [
      { type: 'text', text },
      ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
    ];
    finalMessages = [...finalMessages];
    const last = finalMessages[finalMessages.length - 1];
    if (last && last.role === 'user') finalMessages.pop();
    finalMessages.push({ role: 'user', content: userContent });
  }

  const effectiveRole = hasImages && role === 'chat' ? 'vision' : role;
  const { model: selectedModel, why } = resolveModel({
    role: effectiveRole,
    hint: model,
    needsVision: hasImages,
    estTokens: estimateTokens(finalMessages),
  });

  // Select key from targeted Key Bag
  const bag = persona === 'builder' ? _builderBag : _bobBag;
  const keyObj = bag.getKey() || (persona === 'builder' ? _bobBag.getKey() : _builderBag.getKey());

  if (!keyObj) {
    throw new Error(`All OpenRouter keys for ${persona === 'builder' ? 'Builder' : 'Bob'} are currently in cooldown or rate-limited.`);
  }

  const apiKey = keyObj.key;
  const requestedMaxTokens = max_tokens ?? Number(process.env.MAX_TOKENS ?? 2000);
  const body = {
    model: selectedModel,
    messages: finalMessages,
    temperature: temperature ?? Number(process.env.TEMPERATURE ?? 0.2),
    max_tokens: requestedMaxTokens,
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/nikhilrawat2005/BoB',
      'X-Title': 'Bob Personal Assistant',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.error) {
    const msg = String(data.error.message || '');
    const isRateLimitOrCredit = res.status === 429 || msg.includes('credits') || msg.includes('afford') || msg.includes('balance') || msg.includes('rate limit') || /requires more credits/.test(msg.toLowerCase());

    if (isRateLimitOrCredit) {
      bag.markCooldown(apiKey, 60000, msg);
      // Auto retry once with next key from queue
      const nextKeyObj = bag.getKey();
      if (nextKeyObj && nextKeyObj.key !== apiKey) {
        console.warn(`[llmService] Retrying with next key from Queue A: ${nextKeyObj.keyId}`);
        return callOpenRouterDirect({
          role, messages, model: selectedModel, imageUrls, userText,
          temperature, max_tokens, persona,
        });
      }
      const err = new Error('OpenRouter rate limit or credit exhausted: ' + msg);
      err.details = data.error;
      throw err;
    }

    if ((msg.includes('max_tokens')) && requestedMaxTokens > 1000) {
      return callOpenRouterDirect({
        role, messages, model: selectedModel, imageUrls, userText,
        temperature, max_tokens: 1500, persona,
      });
    }

    const err = new Error(msg || 'OpenRouter error');
    err.details = data.error;
    throw err;
  }

  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('OpenRouter returned an empty response');
  }

  const usedTokens = (data.usage && Number(data.usage.total_tokens)) || 0;
  bag.recordUsage(apiKey, usedTokens);

  return {
    text: data.choices[0].message.content,
    model: selectedModel,
    usage: data.usage || null,
    routing: why,
    provider: 'openrouter',
    keyId: keyObj.keyId,
  };
}

async function callLLM(opts = {}) {
  const {
    role = 'chat',
    imageUrls = [],
    useGeminiPool,
    preferOpenRouter,
  } = opts;

  const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0;
  const isNonContinuous = NON_CONTINUOUS_ROLES.has(role) || useGeminiPool === true;

  // Non-continuous burst tasks -> Route to Gemini Burst Bag with OpenRouter Fallback
  if (isNonContinuous && !hasImages && !preferOpenRouter) {
    return geminiPool.callGeminiWithFallback(opts, () => callOpenRouterDirect(opts));
  }

  // Interactive and builder loops -> Route to OpenRouter Bag (Bob or Builder)
  return callOpenRouterDirect(opts);
}

async function callLLMWithVision(opts) {
  return callLLM({ role: 'vision', ...opts });
}

module.exports = {
  callLLM,
  callLLMWithVision,
  MODEL_ROLES,
  MODEL_CAPS,
  DEAD_MODELS,
  FALLBACK_MODEL,
  resolveModel,
  estimateTokens,
  verifyModels,
  MAX_TOKENS_PER_KEY,
  checkKeyHealth,
  keyHealthSnapshot,
  resetKeyHealth,
  getGeminiPoolHealth: geminiPool.getGeminiPoolHealth,
  getBagsSnapshot: () => ({
    bobBag: _bobBag.getSnapshot(),
    builderBag: _builderBag.getSnapshot(),
    geminiBag: geminiPool.getGeminiPoolHealth(),
  }),
};
