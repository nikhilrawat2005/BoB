const fetch = require('node-fetch');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---------------------------------------------------------------------------
// API Key Pool — reads OPENROUTER_API_KEY1 … OPENROUTER_API_KEY30 from .env
// Rotates through them round-robin so no single key hits rate limits.
// Keys that are empty / missing are skipped automatically.
// ---------------------------------------------------------------------------
const _rawKeys = [];
for (let i = 1; i <= 30; i++) {
  const k = process.env[`OPENROUTER_API_KEY${i}`];
  if (k && k.trim()) _rawKeys.push(k.trim());
}

// Fallback: also support plain OPENROUTER_API_KEY (original .env.example format)
if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()) {
  _rawKeys.push(process.env.OPENROUTER_API_KEY.trim());
}

// The dedicated Builder key stays OUT of Bob's rotation pool.
const _builderKey = (process.env.BUILDER_API_KEY || '').trim();
if (_builderKey) {
  for (let i = _rawKeys.length - 1; i >= 0; i--) {
    if (_rawKeys[i] === _builderKey) _rawKeys.splice(i, 1);
  }
}

// Role assignment (env-driven, stable across cold starts): each role uses a FIXED key.
// BOB = Bob's main rotation, CENTER = center-work, BUILDER = builder (excluded above).
// Any configured key with no role is a REPLACEMENT (swap-in when a role key exhausts).
const _roles = {
  BOB: (process.env.BOB_API_KEY || '').trim(),
  CENTER: (process.env.CENTER_API_KEY || '').trim(),
  BUILDER: (process.env.BUILDER_API_KEY || '').trim(),
};
function _roleOf(key) {
  // Current holder wins — this makes the label FOLLOW promotions across cold starts.
  for (const role of Object.keys(_roleHolders)) {
    if (key === _holderKey(role)) return role;
  }
  // Initial assignment from env, but only while that key is still usable.
  for (const [role, rk] of Object.entries(_roles)) {
    if (rk && rk === key) {
      const m = _keyMeta(key);
      if (m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0) return role;
    }
  }
  return 'REPLACEMENT';
}

if (_rawKeys.length === 0) {
  console.warn(
    '[llmService] WARNING: No OpenRouter API key found. ' +
    'Set OPENROUTER_API_KEY1 (or OPENROUTER_API_KEY) in your .env file.'
  );
}

// All keys visible in the HQ "Keys" card. Rotation pool (_rawKeys) EXCLUDES the
// Builder key; the Builder key is shown separately so you can see its status
// without letting Bob ever borrow it. KEY1..KEY9 ordering: env rotation keys
// first, Builder last (KEY9).
function _allVisibleKeys() {
  return _builderKey ? [..._rawKeys, _builderKey] : _rawKeys.slice();
}

// Stable key identity (KEY1..KEY9) across cold starts — index within _allVisibleKeys.
function _keyIdOf(key) {
  const i = _allVisibleKeys().indexOf(key);
  return i >= 0 ? `KEY${i + 1}` : null;
}

// --- Persistent key state (Firestore) so exhaustion/usage survives cold starts.
// Falls back to in-memory only when Firebase is not configured (no new dep needed).
function _firestore() {
  try { const { db } = require('../config/firebase'); return db; } catch { return null; }
}
let _stateLoaded = false;
async function _loadState() {
  if (_stateLoaded) return;
  const db = _firestore();
  if (!db) { _stateLoaded = true; return; }
  try {
    const snap = await db.collection('keyStates').get();
    const visible = _allVisibleKeys();
    snap.forEach(doc => {
      const idx = parseInt(doc.id.replace('KEY', ''), 10) - 1;
      const key = visible[idx];
      if (!key) return;
      const m = _keyMeta(key);
      const d = doc.data() || {};
      if (d.tokens != null) m.tokens = d.tokens;
      if (d.status) m.status = d.status;
      if (d.lastBalance != null) m.lastBalance = d.lastBalance;
      if (d.lastUsed != null) m.lastUsed = d.lastUsed;
      if (d.lastCheck != null) m.lastCheck = d.lastCheck;
    });
  } catch (e) {
    console.warn('[llmService] keyState load failed:', e.message);
  }
  _stateLoaded = true;
}
async function _persistKey(keyId, data) {
  const db = _firestore();
  if (!db || !keyId) return;
  try { await db.collection('keyStates').doc(keyId).set(data, { merge: true }); }
  catch (e) { console.warn('[llmService] keyState persist failed:', e.message); }
}

// (state loading kicked off further below, once _initRoleHolders exists —
// see _initPromise / _ensureInit)

// ---------------------------------------------------------------------------
// Role-holders cursor (Firestore): tracks which KEY# is currently "Bob"/"Center".
// Env seeds it on first run (BOB_API_KEY / CENTER_API_KEY); promoteReplacement()
// moves a role to a fresh key when its current holder exhausts, so the dashboard
// label follows the live key. BUILDER is fixed (excluded from pool by design).
// Mirrored in-memory; persisted in collection `keyHolders` doc `roleHolders`.
// ---------------------------------------------------------------------------
const _roleHolders = { BOB: null, CENTER: null };

async function _initRoleHolders() {
  const visible = _allVisibleKeys();
  if (visible.length === 0) return;
  _roleHolders.BOB = _roleHolders.BOB || _keyIdOf(_roles.BOB) || `KEY1`;
  _roleHolders.CENTER = _roleHolders.CENTER || _keyIdOf(_roles.CENTER) || null;
  const db = _firestore();
  if (!db) return;
  try {
    const ref = db.collection('keyHolders').doc('roleHolders');
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.BOB) _roleHolders.BOB = d.BOB;
      if (d.CENTER != null) _roleHolders.CENTER = d.CENTER;
    } else {
      await ref.set(_roleHolders);
    }
  } catch (e) {
    console.warn('[llmService] roleHolders init failed:', e.message);
  }
}

// FIX (#3): _loadState() and _initRoleHolders() used to be fired at module
// load time with no one awaiting them ("fire and forget"). On a cold
// serverless start, a request could arrive and start picking/using keys
// before Firestore-persisted exhaustion/usage state (and role-holder
// assignments) finished loading — meaning a key that was actually exhausted
// on a previous invocation could briefly look "fresh" again, or budget
// counters could be double-spent right after a restart. We now keep a single
// shared init promise and every entry point (callLLM, callLLMWithVision,
// checkKeyHealth, _resolveRoleKey) awaits it before touching key state.
const _initPromise = Promise.all([_loadState(), _initRoleHolders()]);
async function _ensureInit() {
  await _initPromise;
}

function _holderKey(role) {
  const kid = _roleHolders[role];
  if (!kid) return null;
  const visible = _allVisibleKeys();
  const idx = parseInt(String(kid).replace('KEY', ''), 10) - 1;
  return visible[idx] || null;
}

// Healthy keys not currently held by another role, NEW-priority first.
function _freeReplacements(forRole) {
  const visible = _allVisibleKeys();
  const held = new Set();
  Object.entries(_roleHolders).forEach(([r, kid]) => {
    if (r === forRole || !kid) return;
    const idx = parseInt(String(kid).replace('KEY', ''), 10) - 1;
    if (visible[idx]) held.add(visible[idx]);
  });
  // builder key is never a replacement
  if (_builderKey) held.add(_builderKey);
  return visible.filter(k => {
    const m = _keyMeta(k);
    return m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0 && !held.has(k);
  }).sort((a, b) => {
    const na = _poolOf(_keyMeta(a)) === 'NEW' ? 1 : 0;
    const nb = _poolOf(_keyMeta(b)) === 'NEW' ? 1 : 0;
    return nb - na;
  });
}

// Atomic (Firestore transaction when available) promotion of a role to a fresh key.
async function promoteReplacement(role) {
  const db = _firestore();
  const current = _holderKey(role);
  const replacements = _freeReplacements(role);
  if (!replacements.length) {
    // No swap possible. FIX (#2): previously this returned `current` even when
    // it was an exhausted key, which made _resolveRoleKey() treat it as a
    // valid "promoted" key (since it's truthy) and keep retrying a dead key.
    // Returning null here forces the caller to fall through to _nextKey(),
    // which correctly searches the whole shared pool (or throws a clear
    // "all keys exhausted" error instead of silently reusing a dead one).
    if (!current) _roleHolders[role] = null;
    return null;
  }
  const next = replacements[0];
  const nextId = _keyIdOf(next);
  if (db) {
    try {
      await db.runTransaction(async (t) => {
        const snap = await t.get(db.collection('keyHolders').doc('roleHolders'));
        const d = snap.exists ? (snap.data() || {}) : {};
        d[role] = nextId;
        t.set(db.collection('keyHolders').doc('roleHolders'), d, { merge: true });
      });
    } catch (e) {
      console.warn('[llmService] roleHolders promote failed:', e.message);
    }
  }
  _roleHolders[role] = nextId;
  console.log(`[llmService] ${role} promoted from ${_keyIdOf(current) || 'none'} -> ${nextId} (swap-in).`);
  return next;
}

// Resolve the live key for a role from the Firestore-backed cursor every call.
// If the holder is exhausted/not fundable, atomically promote to a fresh key;
// if no fresh key exists, fall back to the shared pool so calls never break.
async function _resolveRoleKey(role) {
  await _ensureInit();
  const held = _holderKey(role);
  if (held) {
    const m = _keyMeta(held);
    if (m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0) return held;
  }
  const promoted = await promoteReplacement(role);
  if (promoted) return promoted;
  return _nextKey();
}

let _keyIndex = 0;

/**
 * Per-key MAX token budget.
 * The whole point: NO key is allowed to burn past this ceiling (which is what
 * previously drove the originals into negative territory on free credits).
 * Once a key's IN-MEMORY token usage hits MAX_TOKENS_PER_KEY (or its live
  * balance goes NEGATIVE (boundary — free-credit keys are tried at $0 and
  * only retired when a real call fails or they turn negative), it is marked EXHAUSTED and skipped by _nextKey().
 * Configurable via env so you can re-tune without a deploy.
 */
const MAX_TOKENS_PER_KEY = Number(process.env.MAX_TOKENS_PER_KEY || 500000);

/**
 * In-memory per-key bookkeeping.
 *  keyUsage[fullKey] = { tokens: n, lastBalance: '$x', lastUsed: '$y', status: 'ok'|'exhausted', lastCheck: epochMs }
 * NOTE: resets on server restart (deliberate — tokens are re-checked live
 * via checkKeyHealth() against the OpenRouter /credits endpoint so the budget
 * is re-evaluated against the real balance each time).
 */
const keyUsage = {};

function _keyMeta(key) {
  if (!keyUsage[key]) keyUsage[key] = { tokens: 0, status: 'ok', lastBalance: 0, lastUsed: 0, lastCheck: 0 };
  return keyUsage[key];
}

/**
 * Round-robin selector that skips exhausted keys.
 * Throws if every key in the pool is exhausted.
 */
// Pool label: NEW (untouched, balance>=0), ACTIVE (in-flight, balance>=0, tokens>0), EXHAUSTED.
function _poolOf(m) {
  if (m.status === 'exhausted' || (m.lastBalance ?? 0) < 0) return 'EXHAUSTED';
  if ((m.tokens ?? 0) > 0) return 'ACTIVE';
  return 'NEW';
}

function _nextKey() {
  if (_rawKeys.length === 0) throw new Error('No OpenRouter API key configured.');
  // Usable = healthy AND non-negative balance (originals with negative balance are excluded).
  const usable = _rawKeys.filter(k => {
    const m = _keyMeta(k);
    return m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0;
  });
  if (usable.length === 0) throw new Error('All OpenRouter keys exhausted (MAX_TOKENS_PER_KEY reached or balance < 0).');
  // Prefer NEW keys first, then ACTIVE — new-pool priority.
  usable.sort((a, b) => {
    const pa = _poolOf(_keyMeta(a)) === 'NEW' ? 1 : 0;
    const pb = _poolOf(_keyMeta(b)) === 'NEW' ? 1 : 0;
    return pb - pa;
  });
  const chosen = usable[0];
  _keyIndex = (_rawKeys.indexOf(chosen) + 1) % _rawKeys.length;
  return chosen;
}

/**
 * Mark a key exhausted in-memory (called when we observe balance<=0 or a
 * per-key token limit hit from a live /credits check or an API credit error).
 */
function markKeyExhausted(key) {
  const m = _keyMeta(key);
  m.status = 'exhausted';
  m.lastCheck = Date.now();
  console.warn('[llmService] Key ...' + key.slice(-8) + ' marked EXHAUSTED.');
  _persistKey(_keyIdOf(key), { status: 'exhausted', lastCheck: m.lastCheck, lastBalance: m.lastBalance, lastUsed: m.lastUsed, tokens: m.tokens });
  // Auto-swap: if this key held a role (Bob/Center), promote that role to a
  // fresh replacement key immediately so the live-label follows the active key.
  const role = _roleOf(key);
  if (role === 'BOB' || role === 'CENTER') {
    promoteReplacement(role).catch(e => console.warn('[llmService] auto-promote failed:', e.message));
  }
}

/**
 * Returns a SAFE, ANONYMIZED snapshot of every key's health.
 * NEVER returns full key strings — only last4 + balance/usage/status.
 */
function keyHealthSnapshot() {
  return _allVisibleKeys().map((k, i) => {
    const m = _keyMeta(k);
    const pool = _poolOf(m);
    return {
      keyId: `KEY${i + 1}`,
      role: _roleOf(k),
      pool,
      last4: k.slice(-4),
      tokensUsed: m.tokens,
      maxTokens: MAX_TOKENS_PER_KEY,
      status: m.status,
      lastBalance: m.lastBalance,
      lastUsed: m.lastUsed,
      lastCheck: m.lastCheck,
    };
  });
}

/**
 * Live health check: hits OpenRouter /credits for each key (anonymized),
 * updates the in-memory budget, and marks keys exhausted when balance<=0 or
 * usage>=limit. Cached per-key for `cacheMs` (default 60s) to avoid spamming.
 */
async function checkKeyHealth(cacheMs = 60000) {
  await _ensureInit();
  const results = [];
  const now = Date.now();
  for (const key of _allVisibleKeys()) {
    const m = _keyMeta(key);
    if (now - m.lastCheck < cacheMs && m.lastCheck) {
      results.push({ keyId: _keyIdOf(key) || `KEY?`, role: _roleOf(key), pool: _poolOf(m), last4: key.slice(-4), status: m.status, balance: m.lastBalance, used: m.lastUsed, tokensUsed: m.tokens });
      continue;
    }
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${key}` } });
      const j = await res.json();
      const d = (j && j.data && j.data[0]) || {};
      const balance = Number(d.total_credits) || 0;
      const used = Number(d.total_usage) || 0;
      m.lastBalance = balance;
      m.lastUsed = used;
      m.lastCheck = now;
      // FIX (#1): exhausted status is now STICKY. Previously, a live /credits
      // check that happened to see balance >= 0 (common with free-credit keys,
      // which can lag/flap around $0) would silently overwrite an existing
      // 'exhausted' status back to 'healthy' — putting a dead key straight
      // back into rotation until it failed a real call again. Now, once a
      // key has been marked exhausted (via markKeyExhausted(), triggered by
      // an actual failed OpenRouter call), only a NEGATIVE balance or the
      // token ceiling can re-affirm 'exhausted' — a clean live check can no
      // longer un-exhaust it on its own. Restarting the server (or a future
      // explicit "reset key" action) is required to bring it back.
      if (balance < 0 || m.tokens >= MAX_TOKENS_PER_KEY) {
        m.status = 'exhausted';
      } else if (m.status !== 'exhausted') {
        m.status = 'healthy';
      }
      _persistKey(_keyIdOf(key), { status: m.status, lastCheck: m.lastCheck, lastBalance: m.lastBalance, lastUsed: m.lastUsed, tokens: m.tokens });
      results.push({ keyId: _keyIdOf(key) || `KEY?`, role: _roleOf(key), pool: _poolOf(m), last4: key.slice(-4), status: m.status, balance, used, tokensUsed: m.tokens });
    } catch (e) {
      results.push({ keyId: _keyIdOf(key) || `KEY?`, role: _roleOf(key), pool: _poolOf(m), last4: key.slice(-4), status: m.status, balance: m.lastBalance, used: m.lastUsed, tokensUsed: m.tokens, error: e.message });
    }
  }
  return results;
}

/**
 * Call after each successful LLM response to bump the per-key token budget.
 * Pass the key actually used and response.usage.total_tokens.
 */
function _recordUsage(key, usedTokens) {
  if (!key || !usedTokens) return;
  const m = _keyMeta(key);
  m.tokens += usedTokens;
  if (m.status !== 'exhausted') m.status = 'healthy';
  if (m.tokens >= MAX_TOKENS_PER_KEY) m.status = 'exhausted';
  _persistKey(_keyIdOf(key), { tokens: m.tokens, status: m.status, lastBalance: m.lastBalance, lastUsed: m.lastUsed });
}

// ---------------------------------------------------------------------------
// Dedicated "Bob the Builder" key — planning/architecture persona stays on its
// own API key (BUILDER_API_KEY, declared above) so it never fights the main
// Bob pool for rate limits. Falls back to the shared pool if unset.
// ---------------------------------------------------------------------------
function _builderKeyOrPool() {
  if (_builderKey) return _builderKey;
  if (_rawKeys.length === 0) throw new Error('No OpenRouter API key configured.');
  const key = _rawKeys[_keyIndex % _rawKeys.length];
  _keyIndex++;
  return key;
}

// ---------------------------------------------------------------------------
// Model Roles
// Priority: per-role env vars > hardcoded defaults
// WRITER_MODEL  → used for the main chat / writing tasks
// REVIEW_MODEL  → used for reviewing / reasoning tasks
// AUDITOR_MODEL → used for auditing / safety checks
// BUILDER_MODEL → used by "Bob the Builder" persona (planning/architecture)
// ---------------------------------------------------------------------------
const MODEL_ROLES = {
  chat:            process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  writer:          process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  review:          process.env.REVIEW_MODEL   || 'anthropic/claude-sonnet-4',
  auditor:         process.env.AUDITOR_MODEL  || 'openai/gpt-4o',
  router:          process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  memorySummarize: process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  builder:         process.env.BUILDER_MODEL  || 'deepseek/deepseek-chat-v3',
  // Vision-capable model for screenshots, thumbnails, and image analysis
  vision:          process.env.VISION_MODEL   || 'google/gemini-2.0-flash-001',
};

// ---------------------------------------------------------------------------
// Core caller
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} [opts.role='chat']   - One of: chat | writer | review | auditor | router | memorySummarize
 * @param {string} [opts.model]         - Override model explicitly (ignores role)
 * @param {Array}  opts.messages        - OpenAI-format messages array
 * @param {number} [opts.temperature]   - Defaults to TEMPERATURE env var or 0.2
 * @param {number} [opts.max_tokens]    - Defaults to MAX_TOKENS env var or 2000
 */
async function callLLM({ role = 'chat', messages, model, temperature, max_tokens, persona }) {
  const selectedModel = model || MODEL_ROLES[role] || MODEL_ROLES.chat;
  const apiKey = persona === 'builder' ? _builderKeyOrPool() : await _resolveRoleKey('BOB');
  const requestedMaxTokens = max_tokens ?? Number(process.env.MAX_TOKENS ?? 2000);

  const body = {
    model: selectedModel,
    messages,
    temperature: temperature ?? Number(process.env.TEMPERATURE ?? 0.2),
    max_tokens:  requestedMaxTokens,
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      // Recommended by OpenRouter for usage tracking
      'HTTP-Referer': 'https://github.com/nikhilrawat2005/BoB',
      'X-Title': 'Bob Personal Assistant',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.error) {
    const msg = String(data.error.message || '');
    const isCreditError = msg.includes('credits') || msg.includes('afford') || msg.includes('balance') || /requires more credits/.test(msg.toLowerCase());
    if (isCreditError) {
      // Burn-limit / balance exhausted THIS key → retire it from rotation, don't retry.
      markKeyExhausted(apiKey);
      const err = new Error('OpenRouter credit/balance exhausted for this key — auto-skipped. ' + msg);
      err.details = data.error;
      err.code = 'CREDIT_EXHAUSTED';
      throw err;
    }
    // max_tokens-only error → retry once with a smaller ceiling.
    if ((msg.includes('max_tokens')) && requestedMaxTokens > 1000) {
      console.warn(`[llmService] max_tokens limit hit (${requestedMaxTokens}). Retrying with max_tokens: 1500...`);
      return callLLM({ role, messages, model, temperature, max_tokens: 1500, persona });
    }
    const err = new Error(msg || 'OpenRouter error');
    err.details = data.error;
    throw err;
  }

  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('OpenRouter returned an empty response');
  }

  const usedTokens = (data.usage && Number(data.usage.total_tokens)) || 0;
  _recordUsage(apiKey, usedTokens);

  return {
    text:  data.choices[0].message.content,
    model: selectedModel,
    usage: data.usage || null,
  };
}

// ---------------------------------------------------------------------------
// Vision caller — supports text + image_url multimodal messages
// ---------------------------------------------------------------------------

/**
 * Calls LLM with vision support (text + images in the same message).
 * Used for screenshot analysis, thumbnail inspection, and image understanding.
 *
 * @param {object} opts
 * @param {Array}  opts.messages     - Standard messages array (system + history)
 * @param {string} opts.userText     - The user's current message text
 * @param {string[]} opts.imageUrls  - Array of image URLs to include in the vision request
 * @param {string} [opts.model]      - Override model (defaults to vision role model)
 * @param {number} [opts.temperature]
 * @param {number} [opts.max_tokens]
 */
async function callLLMWithVision({ messages, userText, imageUrls = [], model, temperature, max_tokens }) {
  const selectedModel = model || MODEL_ROLES.vision;
  // FIX (#4): this used to call the plain round-robin _nextKey() instead of
  // the role-aware _resolveRoleKey('BOB') that callLLM() uses. That meant
  // vision calls could silently use a DIFFERENT key than the one the "BOB"
  // role/dashboard was tracking, splitting token-budget bookkeeping across
  // two untracked paths and making the HQ "Keys" role label unreliable.
  // Vision now shares the same role-aware resolution as normal chat calls.
  const apiKey = await _resolveRoleKey('BOB');
  const requestedMaxTokens = max_tokens ?? Number(process.env.MAX_TOKENS ?? 2000);

  // Build multimodal user content: text + images
  const userContent = [
    { type: 'text', text: userText },
    ...imageUrls.map(url => ({
      type: 'image_url',
      image_url: { url },
    })),
  ];

  // Only replace the last message if it is a user message (the current prompt).
  // Assistant/system history is always preserved.
  const visionMessages = [...messages];
  const last = visionMessages[visionMessages.length - 1];
  if (last && last.role === 'user') visionMessages.pop();
  visionMessages.push({ role: 'user', content: userContent });

  const body = {
    model: selectedModel,
    messages: visionMessages,
    temperature: temperature ?? Number(process.env.TEMPERATURE ?? 0.2),
    max_tokens:  requestedMaxTokens,
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
    const isCreditError = msg.includes('credits') || msg.includes('afford') || msg.includes('balance') || /requires more credits/.test(msg.toLowerCase());
    if (isCreditError) {
      markKeyExhausted(apiKey);
      const err = new Error('OpenRouter credit/balance exhausted for this key — auto-skipped. ' + msg);
      err.details = data.error;
      err.code = 'CREDIT_EXHAUSTED';
      throw err;
    }
    if (msg.includes('max_tokens') && requestedMaxTokens > 1000) {
      console.warn(`[llmService] Vision max_tokens limit hit (${requestedMaxTokens}). Retrying with max_tokens: 1500...`);
      return callLLMWithVision({ messages, userText, imageUrls, model, temperature, max_tokens: 1500 });
    }
    const err = new Error(msg || 'OpenRouter vision error');
    err.details = data.error;
    throw err;
  }

  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('OpenRouter returned an empty response');
  }

  const usedTokens = (data.usage && Number(data.usage.total_tokens)) || 0;
  _recordUsage(apiKey, usedTokens);

  return {
    text:  data.choices[0].message.content,
    model: selectedModel,
    usage: data.usage || null,
  };
}

module.exports = {
  callLLM, callLLMWithVision, MODEL_ROLES,
  MAX_TOKENS_PER_KEY,
  checkKeyHealth, keyHealthSnapshot, markKeyExhausted,
  _rawKeys, _keyMeta,
};
