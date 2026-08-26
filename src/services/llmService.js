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
 * router silently shifts to a capable model and reports it in `routing`.
 *
 * @param {object}   opts
 * @param {string}   [opts.role='chat']  Role key from MODEL_ROLES.
 * @param {Array}    opts.messages       OpenAI-format messages array.
 * @param {string}   [opts.model]        Preferred slug (caller or user dropdown).
 * @param {string[]} [opts.imageUrls=[]] Image URLs. Non-empty ⇒ vision path.
 * @param {string}   [opts.userText]     Current user text for the vision path.
 *                                       Falls back to the last user message.
 * @param {number}   [opts.temperature]  Defaults to TEMPERATURE env or 0.2.
 * @param {number}   [opts.max_tokens]   Defaults to MAX_TOKENS env or 2000.
 * @param {string}   [opts.persona]      'builder' ⇒ use the dedicated key.
 * @returns {Promise<{text: string, model: string, usage: object|null, routing: string[]}>}
 */
async function callLLM({
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

  // --- Build the outgoing messages array -----------------------------------
  // With images, the trailing user message is rebuilt as multimodal content.
  // System and assistant history is always preserved untouched.
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

  // --- Choose the model ----------------------------------------------------
  // Plain chat + images ⇒ consult the dedicated `vision` role so VISION_MODEL
  // stays meaningful. Any other role keeps its own default and relies on the
  // capability shift inside resolveModel().
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

  const apiKey = persona === 'builder' ? _builderKeyOrPool() : await _resolveRoleKey('BOB');
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
    // Pass the already-resolved slug so the router does not run twice.
    if ((msg.includes('max_tokens')) && requestedMaxTokens > 1000) {
      console.warn(`[llmService] max_tokens limit hit (${requestedMaxTokens}). Retrying with max_tokens: 1500...`);
      return callLLM({
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
  };
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
  checkKeyHealth, keyHealthSnapshot, markKeyExhausted,
  _rawKeys, _keyMeta,
};
