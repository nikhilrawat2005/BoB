const fetch = require('node-fetch');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---------------------------------------------------------------------------
// API Key Pool — reads OPENROUTER_API_KEY1 … OPENROUTER_API_KEY30 from .env
// _keyEnvName maps key value → its env variable name so KEY IDs stay stable.
// ---------------------------------------------------------------------------
const _rawKeys = [];
const _keyEnvName = new Map(); // key value → env var name (e.g. "OPENROUTER_API_KEY7")

for (let i = 1; i <= 30; i++) {
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

const _builderKeys = [];
for (let i = 1; i <= 30; i++) {
  const envName = `BUILDER_API_KEY${i}`;
  const raw = process.env[envName];
  if (raw && raw.trim() && !_builderKeys.includes(raw.trim())) {
    _builderKeys.push(raw.trim());
    _keyEnvName.set(raw.trim(), envName);
  }
}
{
  const b0 = (process.env.BUILDER_API_KEY || '').trim();
  if (b0 && !_builderKeys.includes(b0)) { _builderKeys.unshift(b0); _keyEnvName.set(b0, 'BUILDER_API_KEY'); }
}
for (const bk of _builderKeys) {
  for (let i = _rawKeys.length - 1; i >= 0; i--) {
    if (_rawKeys[i] === bk) _rawKeys.splice(i, 1);
  }
}

const _roles = {
  BOB: (process.env.BOB_API_KEY || '').trim(),
  CENTER: (process.env.CENTER_API_KEY || '').trim(),
  BUILDER: (process.env.BUILDER_API_KEY || '').trim(),
};

function _roleOf(key) {
  for (const role of Object.keys(_roleHolders)) {
    if (key === _holderKey(role)) return role;
  }
  for (const [role, rk] of Object.entries(_roles)) {
    if (rk && rk === key) {
      const m = _keyMeta(key);
      if (m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0) return role;
    }
  }
  if (_builderKeys.includes(key)) {
    const m = _keyMeta(key);
    if (m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0) return 'BUILDER';
  }
  return 'REPLACEMENT';
}

if (_rawKeys.length === 0 && _builderKeys.length === 0) {
  console.warn(
    '[llmService] WARNING: No OpenRouter API key found. ' +
    'Set OPENROUTER_API_KEY1 (or OPENROUTER_API_KEY) in your .env file.'
  );
}

function _allVisibleKeys() {
  return _builderKeys.length ? [..._rawKeys, ..._builderKeys] : _rawKeys.slice();
}

// Return stable key ID based on env var name (e.g. OPENROUTER_API_KEY20 → KEY20)
// so dashboard labels don't shift when a key is added/removed from the middle.
function _keyIdOf(key) {
  const envVar = _keyEnvName.get(key);
  if (envVar) {
    const match = envVar.match(/(\d+)$/);
    const num = match ? match[1] : '';
    if (envVar.startsWith('BUILDER_API_KEY')) return num ? `BUILDER${num}` : 'BUILDER';
    return num ? `KEY${num}` : 'KEY';
  }
  const i = _allVisibleKeys().indexOf(key);
  return i >= 0 ? `KEY${i + 1}` : null;
}

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
      // Match by stable key ID (env var based) first, fall back to last4 fingerprint.
      const docId = doc.id;
      const d = doc.data() || {};
      const key = visible.find(k => _keyIdOf(k) === docId) ||
                  (d.last4 ? visible.find(k => k.slice(-4) === d.last4) : null);

      if (!key) {
        // This doc refers to a key that was deleted from Vercel env — purge it.
        doc.ref.delete().catch(() => {});
        return;
      }
      const m = _keyMeta(key);
      const currentLast4 = key.slice(-4);

      // AUTO-HEALING: If key value was swapped (same position, different key), reset state.
      if (d.last4 && d.last4 !== currentLast4) {
        console.log(`[llmService] Key ${docId} replaced in env (${d.last4} -> ${currentLast4}). Resetting.`);
        m.tokens = 0; m.status = 'healthy'; m.lastBalance = 0; m.lastUsed = 0; m.lastCheck = 0;
        _persistKey(_keyIdOf(key), { last4: currentLast4, tokens: 0, status: 'healthy', lastBalance: 0, lastUsed: 0, lastCheck: 0 });
        return;
      }

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

function _freeReplacements(forRole) {
  const visible = _allVisibleKeys();
  const held = new Set();
  Object.entries(_roleHolders).forEach(([r, kid]) => {
    if (r === forRole || !kid) return;
    const idx = parseInt(String(kid).replace('KEY', ''), 10) - 1;
    if (visible[idx]) held.add(visible[idx]);
  });
  return visible.filter(k => {
    const m = _keyMeta(k);
    return m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0 && !held.has(k);
  }).sort((a, b) => {
    const na = _poolOf(_keyMeta(a)) === 'NEW' ? 1 : 0;
    const nb = _poolOf(_keyMeta(b)) === 'NEW' ? 1 : 0;
    return nb - na;
  });
}

// Promotion of a role to a fresh key from the shared bag
async function promoteReplacement(role) {
  const db = _firestore();
  const current = _holderKey(role);
  const replacements = _freeReplacements(role);
  if (!replacements.length) {
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
 */
const MAX_TOKENS_PER_KEY = Number(process.env.MAX_TOKENS_PER_KEY || 500000);
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
      // A positive balance means the key is alive — always mark healthy so that
      // newly added keys activate immediately on the next /credits check.
      if (balance < 0 || m.tokens >= MAX_TOKENS_PER_KEY) {
        m.status = 'exhausted';
      } else {
        m.status = 'healthy';
      }
      _persistKey(_keyIdOf(key), { last4: key.slice(-4), status: m.status, lastCheck: m.lastCheck, lastBalance: m.lastBalance, lastUsed: m.lastUsed, tokens: m.tokens });
      results.push({ keyId: _keyIdOf(key) || `KEY?`, role: _roleOf(key), pool: _poolOf(m), last4: key.slice(-4), status: m.status, balance, used, tokensUsed: m.tokens });
    } catch (e) {
      results.push({ keyId: _keyIdOf(key) || `KEY?`, role: _roleOf(key), pool: _poolOf(m), last4: key.slice(-4), status: m.status, balance: m.lastBalance, used: m.lastUsed, tokensUsed: m.tokens, error: e.message });
    }
  }
  return results;
}

/**
 * Force-reset ALL keys to healthy and run fresh live credit checks.
 * Hit /api/keys/reset after adding or removing keys in Vercel env.
 */
async function resetKeyHealth() {
  await _ensureInit();
  const db = _firestore();
  const visible = _allVisibleKeys();
  for (const key of visible) {
    const m = _keyMeta(key);
    m.tokens = 0; m.status = 'healthy'; m.lastBalance = 0; m.lastUsed = 0; m.lastCheck = 0;
    const keyId = _keyIdOf(key);
    if (db && keyId) {
      await db.collection('keyStates').doc(keyId).set(
        { last4: key.slice(-4), tokens: 0, status: 'healthy', lastBalance: 0, lastUsed: 0, lastCheck: 0 },
        { merge: true }
      ).catch(() => {});
    }
  }
  return checkKeyHealth(0);
}

/**
 * Call after each successful LLM response to bump the per-key token budget.
 * Pass the key actually used and response.usage.total_tokens.
 */
function _recordUsage(key, usedTokens) {
  if (!key || !usedTokens) return;
  const m = _keyMeta(key);
  m.tokens += usedTokens;
  if (m.tokens >= MAX_TOKENS_PER_KEY) m.status = 'exhausted';
  _persistKey(_keyIdOf(key), { last4: key.slice(-4), tokens: m.tokens, status: m.status, lastBalance: m.lastBalance, lastUsed: m.lastUsed });
}

// ---------------------------------------------------------------------------
// Dedicated "Bob the Builder" keys — planning/architecture persona runs on its
// own key pool (BUILDER_API_KEY1..N, declared above) so it never fights the
// main Bob pool for rate limits. Rotates within that pool, skips exhausted /
// negative-balance builder keys, and only falls back to the shared Bob pool
// when every builder key is dead (so builder features never hard-fail).
// ---------------------------------------------------------------------------
async function _builderKeyOrPool() {
  await _ensureInit();
  if (_builderKeys.length) {
    const usable = _builderKeys.filter(k => {
      const m = _keyMeta(k);
      return m.status !== 'exhausted' && (m.lastBalance ?? 0) >= 0;
    });
    if (usable.length) {
      // New keys first, then active — mirrors _nextKey()'s pool priority.
      usable.sort((a, b) => {
        const pa = _poolOf(_keyMeta(a)) === 'NEW' ? 1 : 0;
        const pb = _poolOf(_keyMeta(b)) === 'NEW' ? 1 : 0;
        return pb - pa;
      });
      return usable[0];
    }
    console.warn('[llmService] All builder keys exhausted — falling back to the shared Bob pool.');
  }
  if (_rawKeys.length === 0) throw new Error('No OpenRouter API key configured.');
  const key = _rawKeys[_keyIndex % _rawKeys.length];
  _keyIndex++;
  return key;
}

// ---------------------------------------------------------------------------
// Model Roles
// Priority: per-role env vars > hardcoded defaults
// WRITER_MODEL  → main chat / writing tasks
// REVIEW_MODEL  → reviewing / reasoning tasks
// AUDITOR_MODEL → auditing / safety checks
// BUILDER_MODEL → "Bob the Builder" persona (planning/architecture)
// VISION_MODEL  → screenshots / thumbnails / image analysis
// CHEAP_MODEL   → router + summarizer calls that only emit a few tokens
// ---------------------------------------------------------------------------

// Safe universal default: vision-capable, 1M context, cheapest tier.
// Used whenever a configured slug turns out to be retired or unusable.
const FALLBACK_MODEL = 'google/gemini-2.5-flash-lite';

const MODEL_ROLES = {
  chat:            process.env.WRITER_MODEL   || FALLBACK_MODEL,
  writer:          process.env.WRITER_MODEL   || FALLBACK_MODEL,
  review:          process.env.REVIEW_MODEL   || 'google/gemini-2.5-flash',
  auditor:         process.env.AUDITOR_MODEL  || 'google/gemini-2.5-flash',
  // Router/classifier/summarizer work returns ~30 tokens of JSON. It never needs
  // a strong model, so it gets the cheapest tier available.
  router:          process.env.CHEAP_MODEL    || process.env.WRITER_MODEL || FALLBACK_MODEL,
  memorySummarize: process.env.CHEAP_MODEL    || process.env.WRITER_MODEL || FALLBACK_MODEL,
  builder:         process.env.BUILDER_MODEL  || 'deepseek/deepseek-chat-v3',
  vision:          process.env.VISION_MODEL   || FALLBACK_MODEL,
};

// ---------------------------------------------------------------------------
// Model capability registry
//
// This is the piece that lets Bob pick a model by itself instead of the caller
// (or the user's dropdown) having to know what each model can do.
//
//   vision  - accepts image_url content parts
//   ctx     - context window in tokens
//   costIn  - USD per 1M input tokens  (used to pick the CHEAPEST valid option)
//   costOut - USD per 1M output tokens (informational / dashboards)
//   tier    - 1 cheap · 2 mid · 3 premium
//
// Verified against https://openrouter.ai/api/v1/models. If you add a new slug to
// .env, add it here too — an unknown slug is treated as "capabilities unknown"
// and will be shifted away from whenever a hard requirement (images, context
// size) has to be guaranteed. Run verifyModels() to re-check against live data.
// ---------------------------------------------------------------------------
const MODEL_CAPS = {
  'google/gemini-2.5-flash-lite': { vision: true,  ctx: 1000000, costIn: 0.10, costOut: 0.40,  tier: 1 },
  'google/gemini-2.5-flash':      { vision: true,  ctx: 1000000, costIn: 0.30, costOut: 2.50,  tier: 2 },
  'deepseek/deepseek-chat-v3':    { vision: false, ctx:  163840, costIn: 0.26, costOut: 1.03,  tier: 1 },
  'deepseek/deepseek-chat':       { vision: false, ctx:  163840, costIn: 0.26, costOut: 1.03,  tier: 1 },
  'openai/gpt-4o':                { vision: true,  ctx:  128000, costIn: 2.50, costOut: 10.00, tier: 3 },
  'anthropic/claude-sonnet-4':    { vision: true,  ctx: 1000000, costIn: 3.00, costOut: 15.00, tier: 3 },
};

// Slugs that still RESOLVE on OpenRouter but have ZERO serving endpoints, so any
// call using them fails. These are silently replaced instead of burning a key
// attempt on a guaranteed error.
const DEAD_MODELS = new Set([
  'google/gemini-2.0-flash-001',
]);

function _capsFor(model) {
  return MODEL_CAPS[model] || null;
}

/** Cheapest non-dead model in MODEL_CAPS satisfying `predicate`, else null. */
function _pickCheapest(predicate) {
  let best = null;
  for (const [slug, caps] of Object.entries(MODEL_CAPS)) {
    if (DEAD_MODELS.has(slug)) continue;
    if (!predicate(caps, slug)) continue;
    if (!best || caps.costIn < best.caps.costIn) best = { slug, caps };
  }
  return best ? best.slug : null;
}

/**
 * Rough token estimate for a messages array (~4 chars per token).
 * Image parts are charged a flat ~1k tokens each, which is the right ballpark
 * for Gemini/GPT-4o tiling. Only used to decide whether a prompt will FIT —
 * it never needs to be exact, just not wildly low.
 */
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

/**
 * THE model router. Single place that decides which model actually runs.
 *
 * Pure function — no network, no side effects beyond console warnings — so it is
 * safe to call on every request and easy to unit test.
 *
 * Shift order:
 *   1. configured/hinted slug is retired      → role default, else FALLBACK_MODEL
 *   2. images attached but model is text-only → cheapest vision-capable model
 *   3. prompt won't fit the context window    → cheapest roomy-enough model
 *
 * @param {object}  opts
 * @param {string}  [opts.role='chat']      Role key from MODEL_ROLES.
 * @param {string}  [opts.hint]             Caller/user preference. Honoured unless
 *                                          it cannot do the job.
 * @param {boolean} [opts.needsVision=false] True when image parts are present.
 * @param {number}  [opts.estTokens=0]      Estimated prompt size; 0 = skip check.
 * @returns {{model: string, why: string[]}} Chosen slug + why it was chosen.
 */
function resolveModel({ role = 'chat', hint, needsVision = false, estTokens = 0 } = {}) {
  const why = [];
  let model = hint || MODEL_ROLES[role] || MODEL_ROLES.chat || FALLBACK_MODEL;

  // 1. Retired slug → never send it.
  if (DEAD_MODELS.has(model)) {
    const roleDefault = MODEL_ROLES[role];
    const next = roleDefault && !DEAD_MODELS.has(roleDefault) ? roleDefault : FALLBACK_MODEL;
    why.push(`dead-slug:${model}->${next}`);
    model = next;
  }

  // 2. Vision requirement is hard — a blind model simply cannot answer.
  if (needsVision) {
    const caps = _capsFor(model);
    if (!caps) {
      const swap = _pickCheapest((c) => c.vision) || FALLBACK_MODEL;
      if (swap !== model) {
        console.warn(
          `[llmService] "${model}" has unknown capabilities and images are attached. ` +
          `Shifting to "${swap}". Add "${model}" to MODEL_CAPS to keep using it for vision.`
        );
        why.push(`unknown-caps-vision:${model}->${swap}`);
        model = swap;
      }
    } else if (caps.vision !== true) {
      const swap = _pickCheapest((c) => c.vision) || FALLBACK_MODEL;
      if (swap !== model) {
        why.push(`needs-vision:${model}->${swap}`);
        model = swap;
      }
    }
  }

  // 3. Context requirement. 0.8 leaves headroom for the completion itself.
  if (estTokens > 0) {
    const caps = _capsFor(model);
    if (caps && estTokens > caps.ctx * 0.8) {
      const swap = _pickCheapest(
        (c) => c.ctx >= estTokens * 1.25 && (!needsVision || c.vision)
      );
      if (swap && swap !== model) {
        why.push(`needs-context:${estTokens}tok:${model}->${swap}`);
        model = swap;
      }
    }
  }

  return { model, why };
}

/**
 * On-demand health check for every slug referenced by MODEL_ROLES / MODEL_CAPS.
 * Deliberately NOT called at boot — on Vercel that would add a network round
 * trip to every cold start. Call it from an admin endpoint when you change
 * models, and it will catch retired slugs and vision-capability drift for you.
 *
 * @returns {Promise<{ok: boolean, checked: number, problems: Array}>}
 */
async function verifyModels() {
  const slugs = new Set([...Object.values(MODEL_ROLES), ...Object.keys(MODEL_CAPS)]);
  const problems = [];

  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter model list failed: HTTP ${res.status}`);
  const { data } = await res.json();

  // Index by BOTH `id` and `canonical_slug`. Some working slugs are aliases that
  // never appear as an `id` in the listing — e.g. "deepseek/deepseek-chat-v3" is
  // an alias of "deepseek/deepseek-chat" and calls succeed, but a naive id-only
  // lookup would wrongly report it as not-found.
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
      problems.push({
        slug,
        issue: 'vision-mismatch',
        detail: `MODEL_CAPS says vision=${caps.vision}, OpenRouter says image input=${mods.includes('image')}`,
      });
    }

    if (DEAD_MODELS.has(slug)) {
      problems.push({ slug, issue: 'marked-dead', detail: 'Listed in DEAD_MODELS; replaced automatically.' });
    }
  }

  return { ok: problems.length === 0, checked: slugs.size, problems };
}


// ---------------------------------------------------------------------------
// Core caller
// ---------------------------------------------------------------------------

/**
 * Unified LLM caller — handles text-only AND multimodal (text + image) calls,
 * and chooses the model itself via resolveModel().
 *
 * `model` is a HINT, not a command. If the hinted slug is retired, or is
 * text-only while images are attached, or is too small for the prompt, the
//   costIn  - USD per 1M input tokens  (used to pick the CHEAPEST valid option)
//   costOut - USD per 1M output tokens (informational / dashboards)
//   tier    - 1 cheap · 2 mid · 3 premium
//
// Verified against https://openrouter.ai/api/v1/models. If you add a new slug to
// .env, add it here too — an unknown slug is treated as "capabilities unknown"
// and will be shifted away from whenever a hard requirement (images, context
// size) has to be guaranteed. Run verifyModels() to re-check against live data.
// ---------------------------------------------------------------------------
const MODEL_CAPS = {
  'google/gemini-2.5-flash-lite': { vision: true,  ctx: 1000000, costIn: 0.10, costOut: 0.40,  tier: 1 },
  'google/gemini-2.5-flash':      { vision: true,  ctx: 1000000, costIn: 0.30, costOut: 2.50,  tier: 2 },
  'deepseek/deepseek-chat-v3':    { vision: false, ctx:  163840, costIn: 0.26, costOut: 1.03,  tier: 1 },
  'deepseek/deepseek-chat':       { vision: false, ctx:  163840, costIn: 0.26, costOut: 1.03,  tier: 1 },
  'openai/gpt-4o':                { vision: true,  ctx:  128000, costIn: 2.50, costOut: 10.00, tier: 3 },
  'anthropic/claude-sonnet-4':    { vision: true,  ctx: 1000000, costIn: 3.00, costOut: 15.00, tier: 3 },
};

// Slugs that still RESOLVE on OpenRouter but have ZERO serving endpoints, so any
// call using them fails. These are silently replaced instead of burning a key
// attempt on a guaranteed error.
const DEAD_MODELS = new Set([
  'google/gemini-2.0-flash-001',
]);

function _capsFor(model) {
  return MODEL_CAPS[model] || null;
}

/** Cheapest non-dead model in MODEL_CAPS satisfying `predicate`, else null. */
function _pickCheapest(predicate) {
  let best = null;
  for (const [slug, caps] of Object.entries(MODEL_CAPS)) {
    if (DEAD_MODELS.has(slug)) continue;
    if (!predicate(caps, slug)) continue;
    if (!best || caps.costIn < best.caps.costIn) best = { slug, caps };
  }
  return best ? best.slug : null;
}

/**
 * Rough token estimate for a messages array (~4 chars per token).
 * Image parts are charged a flat ~1k tokens each, which is the right ballpark
 * for Gemini/GPT-4o tiling. Only used to decide whether a prompt will FIT —
 * it never needs to be exact, just not wildly low.
 */
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

/**
 * THE model router. Single place that decides which model actually runs.
 *
 * Pure function — no network, no side effects beyond console warnings — so it is
 * safe to call on every request and easy to unit test.
 *
 * Shift order:
 *   1. configured/hinted slug is retired      → role default, else FALLBACK_MODEL
 *   2. images attached but model is text-only → cheapest vision-capable model
 *   3. prompt won't fit the context window    → cheapest roomy-enough model
 *
 * @param {object}  opts
 * @param {string}  [opts.role='chat']      Role key from MODEL_ROLES.
 * @param {string}  [opts.hint]             Caller/user preference. Honoured unless
 *                                          it cannot do the job.
 * @param {boolean} [opts.needsVision=false] True when image parts are present.
 * @param {number}  [opts.estTokens=0]      Estimated prompt size; 0 = skip check.
 * @returns {{model: string, why: string[]}} Chosen slug + why it was chosen.
 */
function resolveModel({ role = 'chat', hint, needsVision = false, estTokens = 0 } = {}) {
  const why = [];
  let model = hint || MODEL_ROLES[role] || MODEL_ROLES.chat || FALLBACK_MODEL;

  // 1. Retired slug → never send it.
  if (DEAD_MODELS.has(model)) {
    const roleDefault = MODEL_ROLES[role];
    const next = roleDefault && !DEAD_MODELS.has(roleDefault) ? roleDefault : FALLBACK_MODEL;
    why.push(`dead-slug:${model}->${next}`);
    model = next;
  }

  // 2. Vision requirement is hard — a blind model simply cannot answer.
  if (needsVision) {
    const caps = _capsFor(model);
    if (!caps) {
      const swap = _pickCheapest((c) => c.vision) || FALLBACK_MODEL;
      if (swap !== model) {
        console.warn(
          `[llmService] "${model}" has unknown capabilities and images are attached. ` +
          `Shifting to "${swap}". Add "${model}" to MODEL_CAPS to keep using it for vision.`
        );
        why.push(`unknown-caps-vision:${model}->${swap}`);
        model = swap;
      }
    } else if (caps.vision !== true) {
      const swap = _pickCheapest((c) => c.vision) || FALLBACK_MODEL;
      if (swap !== model) {
        why.push(`needs-vision:${model}->${swap}`);
        model = swap;
      }
    }
  }

  // 3. Context requirement. 0.8 leaves headroom for the completion itself.
  if (estTokens > 0) {
    const caps = _capsFor(model);
    if (caps && estTokens > caps.ctx * 0.8) {
      const swap = _pickCheapest(
        (c) => c.ctx >= estTokens * 1.25 && (!needsVision || c.vision)
      );
      if (swap && swap !== model) {
        why.push(`needs-context:${estTokens}tok:${model}->${swap}`);
        model = swap;
      }
    }
  }

  return { model, why };
}

/**
 * On-demand health check for every slug referenced by MODEL_ROLES / MODEL_CAPS.
 * Deliberately NOT called at boot — on Vercel that would add a network round
 * trip to every cold start. Call it from an admin endpoint when you change
 * models, and it will catch retired slugs and vision-capability drift for you.
 *
 * @returns {Promise<{ok: boolean, checked: number, problems: Array}>}
 */
async function verifyModels() {
  const slugs = new Set([...Object.values(MODEL_ROLES), ...Object.keys(MODEL_CAPS)]);
  const problems = [];

  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter model list failed: HTTP ${res.status}`);
  const { data } = await res.json();

  // Index by BOTH `id` and `canonical_slug`. Some working slugs are aliases that
  // never appear as an `id` in the listing — e.g. "deepseek/deepseek-chat-v3" is
  // an alias of "deepseek/deepseek-chat" and calls succeed, but a naive id-only
  // lookup would wrongly report it as not-found.
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
      problems.push({
        slug,
        issue: 'vision-mismatch',
        detail: `MODEL_CAPS says vision=${caps.vision}, OpenRouter says image input=${mods.includes('image')}`,
      });
    }

    if (DEAD_MODELS.has(slug)) {
      problems.push({ slug, issue: 'marked-dead', detail: 'Listed in DEAD_MODELS; replaced automatically.' });
    }
  }

  return { ok: problems.length === 0, checked: slugs.size, problems };
}


// ---------------------------------------------------------------------------
// Core caller
// ---------------------------------------------------------------------------

const geminiPool = require('./geminiPoolService');

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
  if (why.length) {
    console.log(`[llmService] model routing → ${selectedModel} (${why.join(' | ')})`);
  }

  const apiKey = persona === 'builder' ? await _builderKeyOrPool() : await _resolveRoleKey('BOB');
  const requestedMaxTokens = max_tokens ?? Number(process.env.MAX_TOKENS ?? 2000);

  const body = {
    model: selectedModel,
    messages: finalMessages,
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
    if ((msg.includes('max_tokens')) && requestedMaxTokens > 1000) {
      console.warn(`[llmService] max_tokens limit hit (${requestedMaxTokens}). Retrying with max_tokens: 1500...`);
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
  _recordUsage(apiKey, usedTokens);

  return {
    text:    data.choices[0].message.content,
    model:   selectedModel,
    usage:   data.usage || null,
    routing: why,
    provider: 'openrouter',
  };
}

/**
 * Unified Smart LLM caller:
 * Automatically routes bursty, non-continuous workloads (SEO, Research, Hackathons, Stalker, Memory)
 * to the free Gemini 11-key rotating pool to save OpenRouter credits, with instant fallback to
 * OpenRouter if Gemini fails or rate limits. Interactive chat and builder loops stay on OpenRouter.
 */
async function callLLM(opts = {}) {
  const {
    role = 'chat',
    imageUrls = [],
    useGeminiPool,
    preferOpenRouter,
  } = opts;

  const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0;
  const isNonContinuous = NON_CONTINUOUS_ROLES.has(role) || useGeminiPool === true;

  // If bursty non-continuous task without image inputs and OpenRouter is not forced -> Use Gemini Pool with Fallback
  if (isNonContinuous && !hasImages && !preferOpenRouter) {
    return geminiPool.callGeminiWithFallback(opts, () => callOpenRouterDirect(opts));
  }

  // Otherwise, use OpenRouter fast pool directly
  return callOpenRouterDirect(opts);
}

// ---------------------------------------------------------------------------
// Vision caller — backwards-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * @deprecated Call callLLM({ imageUrls, userText, ... }) instead — it handles
 * text and vision through one code path and one router. This wrapper only
 * exists so older call sites keep working unchanged.
 */
async function callLLMWithVision({ messages, userText, imageUrls = [], model, temperature, max_tokens }) {
  return callLLM({
    role: 'vision',
    messages,
    userText,
    imageUrls,
    model,
    temperature,
    max_tokens,
  });
}

module.exports = {
  callLLM, callLLMWithVision, MODEL_ROLES,
  // Model routing
  MODEL_CAPS, DEAD_MODELS, FALLBACK_MODEL,
  resolveModel, estimateTokens, verifyModels,
  MAX_TOKENS_PER_KEY,
  checkKeyHealth, keyHealthSnapshot, markKeyExhausted, resetKeyHealth,
  getGeminiPoolHealth: geminiPool.getGeminiPoolHealth,
  _rawKeys, _keyMeta,
};
