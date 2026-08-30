const fs = require('fs');
const path = require('path');

/**
 * Gemini Multi-Key Rotating Pool Service
 * 
 * Manages an 11-key pool of Google Gemini API keys for non-continuous,
 * bursty workloads (SEO, Deep Research, Hackathons, Stalker, Memory, Document Parsing, etc.).
 * Includes automatic rate-limit rotation (15 RPM / 1,000 RPD per key) and
 * seamless OpenRouter fallback if all Gemini keys are busy/exhausted.
 */

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || 'gemma-4-26b-a4b-it',
  'gemini-2.5-flash',
];
const DAILY_LIMIT_PER_KEY = Number(process.env.GEMINI_DAILY_LIMIT_PER_KEY || 1000);

// ── Load Gemini Keys ──────────────────────────────────────────
function loadGeminiKeys() {
  const keys = [];
  
  // 1. Check geminikeys.txt in backend root
  try {
    const keyFilePath = path.join(__dirname, '..', '..', 'geminikeys.txt');
    if (fs.existsSync(keyFilePath)) {
      const lines = fs.readFileSync(keyFilePath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const key = trimmed.includes('=') ? trimmed.split('=').slice(1).join('=').trim() : trimmed;
        if (key && key.length > 20 && !keys.includes(key)) {
          keys.push(key);
        }
      }
    }
  } catch (e) {
    console.warn('[geminiPool] Could not read geminikeys.txt:', e.message);
  }

  // 2. Check environment variables GEMINI_API_KEY1..30 & GEMINI_API_KEY
  for (let i = 1; i <= 30; i++) {
    const k = (process.env[`GEMINI_API_KEY${i}`] || '').trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  const single = (process.env.GEMINI_API_KEY || '').trim();
  if (single && !keys.includes(single)) keys.push(single);

  return keys;
}

const _rawGeminiKeys = loadGeminiKeys();

// ── In-Memory Key State & Rotation Tracker ──────────────────
const _keyStates = _rawGeminiKeys.map((key, idx) => ({
  index: idx + 1,
  key,
  keySuffix: key.slice(-4),
  status: 'active', // 'active' | 'rate_limited' | 'exhausted'
  requestsToday: 0,
  dailyLimit: DAILY_LIMIT_PER_KEY,
  lastUsedAt: null,
  rateLimitedUntil: 0,
  lastError: null,
}));

let _cursor = 0;
let _lastDayReset = new Date().getUTCDate();

// Daily midnight quota reset check
function checkDailyReset() {
  const currentDay = new Date().getUTCDate();
  if (currentDay !== _lastDayReset) {
    _lastDayReset = currentDay;
    for (const k of _keyStates) {
      k.requestsToday = 0;
      if (k.status === 'exhausted') k.status = 'active';
      k.rateLimitedUntil = 0;
    }
    console.log('[geminiPool] Daily quota counters reset for all Gemini keys.');
  }
}

// Get the next usable key using round-robin with automatic un-quarantine
function getNextGeminiKey() {
  checkDailyReset();
  if (_keyStates.length === 0) return null;

  const now = Date.now();
  const total = _keyStates.length;

  for (let attempt = 0; attempt < total; attempt++) {
    const idx = (_cursor + attempt) % total;
    const k = _keyStates[idx];

    // Auto un-quarantine after temporary rate limit period (60s)
    if (k.status === 'rate_limited' && now > k.rateLimitedUntil) {
      k.status = 'active';
    }

    if (k.status === 'active' && k.requestsToday < k.dailyLimit) {
      _cursor = (idx + 1) % total;
      return k;
    }
  }

  return null; // All keys are exhausted or rate limited
}

function markKeyRateLimited(keyObj, durationMs = 60000, errorMsg = '') {
  if (!keyObj) return;
  keyObj.status = 'rate_limited';
  keyObj.rateLimitedUntil = Date.now() + durationMs;
  keyObj.lastError = errorMsg;
  console.warn(`[geminiPool] Key #${keyObj.index} (..${keyObj.keySuffix}) rate-limited for ${durationMs / 1000}s: ${errorMsg}`);
}

function markKeyExhausted(keyObj, errorMsg = '') {
  if (!keyObj) return;
  keyObj.status = 'exhausted';
  keyObj.lastError = errorMsg;
  console.warn(`[geminiPool] Key #${keyObj.index} (..${keyObj.keySuffix}) daily quota exhausted: ${errorMsg}`);
}

// ── Format Conversion: OpenAI Messages -> Gemini Request Body ──
function formatOpenAiToGemini(messages = []) {
  let systemInstruction = null;
  const systemTexts = [];
  const contents = [];

  for (const m of messages) {
    if (!m) continue;
    const role = m.role || 'user';
    const textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);

    if (role === 'system') {
      systemTexts.push(textContent);
    } else if (role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: textContent }] });
    } else {
      contents.push({ role: 'user', parts: [{ text: textContent }] });
    }
  }

  if (systemTexts.length > 0) {
    systemInstruction = {
      parts: [{ text: systemTexts.join('\n\n') }],
    };
  }

  // Ensure contents has at least one message
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  // Merge consecutive messages of the same role (Gemini requires alternating roles)
  const mergedContents = [];
  for (const c of contents) {
    const last = mergedContents[mergedContents.length - 1];
    if (last && last.role === c.role) {
      last.parts[0].text += '\n\n' + c.parts[0].text;
    } else {
      mergedContents.push({ role: c.role, parts: [{ text: c.parts[0].text }] });
    }
  }

  return { systemInstruction, contents: mergedContents };
}

// ── Call Gemini Direct REST API ──────────────────────────────
async function callGeminiDirect({
  messages,
  model,
  temperature = 0.2,
  max_tokens = 2048,
}) {
  const maxAttempts = _keyStates.length || 1;
  let lastError = null;
  const modelsToTry = model ? [model, ...GEMINI_MODELS.filter(m => m !== model)] : GEMINI_MODELS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyObj = getNextGeminiKey();
    if (!keyObj) {
      throw new Error('All Gemini keys are currently rate-limited or daily quota exhausted.');
    }

    const { systemInstruction, contents } = formatOpenAiToGemini(messages);
    const body = {
      contents,
      generationConfig: {
        temperature: Number(temperature) || 0.2,
        maxOutputTokens: Number(max_tokens) || 2048,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    for (const activeModel of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${keyObj.key}`;

      try {
        keyObj.lastUsedAt = Date.now();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          const errMsg = (data.error && data.error.message) || `HTTP ${res.status}`;
          const isRateLimit = res.status === 429 || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota exceeded') || errMsg.includes('rate limit');

          if (isRateLimit) {
            markKeyRateLimited(keyObj, 60000, errMsg);
            lastError = new Error(errMsg);
            break; // Try next key
          } else {
            // If model is unsupported, try next fallback model
            if (errMsg.includes('not found') || errMsg.includes('no longer available')) {
              continue;
            }
            keyObj.lastError = errMsg;
            throw new Error(`Gemini API error on Key #${keyObj.index}: ${errMsg}`);
          }
        }

        const candidate = data.candidates && data.candidates[0];
        if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
          throw new Error('Gemini API returned an empty response.');
        }

        const outputText = candidate.content.parts.map(p => p.text || '').join('');
        keyObj.requestsToday++;

        const usage = data.usageMetadata ? {
          prompt_tokens: data.usageMetadata.promptTokenCount || 0,
          completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
          total_tokens: data.usageMetadata.totalTokenCount || 0,
        } : null;

        return {
          text: outputText,
          model: activeModel,
          usage,
          provider: 'gemini',
          keyIndex: keyObj.index,
          keySuffix: keyObj.keySuffix,
        };
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError' || err.message.includes('timeout')) {
          markKeyRateLimited(keyObj, 30000, 'Request timeout');
          break;
        }
      }
    }
  }

  throw lastError || new Error('All Gemini keys failed.');
}

// ── Master Caller with OpenRouter Fallback ────────────────────
async function callGeminiWithFallback(opts = {}, openRouterFallbackFn) {
  try {
    if (_keyStates.length > 0) {
      return await callGeminiDirect(opts);
    }
  } catch (geminiErr) {
    console.warn(`[geminiPool] Gemini pool error (${geminiErr.message}) → Falling back to OpenRouter pool.`);
  }

  // Graceful Fallback to OpenRouter
  if (typeof openRouterFallbackFn === 'function') {
    return await openRouterFallbackFn(opts);
  }

  throw new Error('Gemini failed and no OpenRouter fallback function provided.');
}

// ── Health Snapshot for Dashboard & Keys Screen ──────────────
function getGeminiPoolHealth() {
  checkDailyReset();
  const activeKeys = _keyStates.filter(k => k.status === 'active' && k.requestsToday < k.dailyLimit);
  const rateLimitedKeys = _keyStates.filter(k => k.status === 'rate_limited');
  const exhaustedKeys = _keyStates.filter(k => k.status === 'exhausted' || k.requestsToday >= k.dailyLimit);
  const totalRequestsToday = _keyStates.reduce((sum, k) => sum + (k.requestsToday || 0), 0);
  const dailyCapacity = _keyStates.length * DAILY_LIMIT_PER_KEY;

  return {
    totalKeys: _keyStates.length,
    activeCount: activeKeys.length,
    rateLimitedCount: rateLimitedKeys.length,
    exhaustedCount: exhaustedKeys.length,
    totalRequestsToday,
    dailyCapacity,
    keys: _keyStates.map(k => ({
      index: k.index,
      keySuffix: k.keySuffix,
      status: k.status,
      requestsToday: k.requestsToday,
      dailyLimit: k.dailyLimit,
      lastUsedAt: k.lastUsedAt,
      lastError: k.lastError,
    })),
  };
}

module.exports = {
  callGeminiDirect,
  callGeminiWithFallback,
  getGeminiPoolHealth,
  loadGeminiKeys,
  _keyStates,
};
