const fetch = require('node-fetch');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---------------------------------------------------------------------------
// API Key Pool — reads OPENROUTER_API_KEY1 … OPENROUTER_API_KEY11 from .env
// Rotates through them round-robin so no single key hits rate limits.
// Keys that are empty / missing are skipped automatically.
// ---------------------------------------------------------------------------
const _rawKeys = [];
for (let i = 1; i <= 11; i++) {
  const k = process.env[`OPENROUTER_API_KEY${i}`];
  if (k && k.trim()) _rawKeys.push(k.trim());
}

// Fallback: also support plain OPENROUTER_API_KEY (original .env.example format)
if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()) {
  _rawKeys.push(process.env.OPENROUTER_API_KEY.trim());
}

if (_rawKeys.length === 0) {
  console.warn(
    '[llmService] WARNING: No OpenRouter API key found. ' +
    'Set OPENROUTER_API_KEY1 (or OPENROUTER_API_KEY) in your .env file.'
  );
}

let _keyIndex = 0;

/**
 * Returns the next API key from the pool using round-robin rotation.
 * Throws if the pool is empty.
 */
function _nextKey() {
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
// ---------------------------------------------------------------------------
const MODEL_ROLES = {
  chat:            process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  writer:          process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  review:          process.env.REVIEW_MODEL   || 'anthropic/claude-sonnet-4',
  auditor:         process.env.AUDITOR_MODEL  || 'openai/gpt-4o',
  router:          process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
  memorySummarize: process.env.WRITER_MODEL   || 'google/gemini-2.0-flash-001',
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
 * @param {number} [opts.max_tokens]    - Defaults to MAX_TOKENS env var or 16000
 */
async function callLLM({ role = 'chat', messages, model, temperature, max_tokens }) {
  const selectedModel = model || MODEL_ROLES[role] || MODEL_ROLES.chat;
  const apiKey = _nextKey();

  const body = {
    model: selectedModel,
    messages,
    temperature: temperature ?? Number(process.env.TEMPERATURE ?? 0.2),
    max_tokens:  max_tokens  ?? Number(process.env.MAX_TOKENS  ?? 16000),
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
    const err = new Error(data.error.message || 'OpenRouter error');
    err.details = data.error;
    throw err;
  }

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
  const apiKey = _nextKey();

  // Build multimodal user content: text + images
  const userContent = [
    { type: 'text', text: userText },
    ...imageUrls.map(url => ({
      type: 'image_url',
      image_url: { url },
    })),
  ];

  // Replace the last user message (or append) with multimodal content
  const visionMessages = [
    ...messages.filter(m => m.role !== 'user' || messages.indexOf(m) < messages.length - 1),
    { role: 'user', content: userContent },
  ];

  const body = {
    model: selectedModel,
    messages: visionMessages,
    temperature: temperature ?? Number(process.env.TEMPERATURE ?? 0.2),
    max_tokens:  max_tokens  ?? Number(process.env.MAX_TOKENS  ?? 16000),
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
    const err = new Error(data.error.message || 'OpenRouter vision error');
    err.details = data.error;
    throw err;
  }

  return {
    text:  data.choices[0].message.content,
    model: selectedModel,
    usage: data.usage || null,
  };
}

module.exports = { callLLM, callLLMWithVision, MODEL_ROLES };
