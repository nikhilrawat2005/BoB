// ---------------------------------------------------------------------------
// Bob the Builder — Knowledge Service
// Embeds the condensed "Builder Playbook" (always-on) and loads on-demand
// reference sections from the AI-WEOS knowledge folder by project type.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const AI_WEOS_DIR = path.join(__dirname, '..', '..', 'AI-Website-Engineering-System');

// ─────────────────────────────────────────────────────────────
// Condensed Builder Playbook (always in Builder's system prompt)
// Distilled from AI-WEOS CORE + templates so it fits context.
// ─────────────────────────────────────────────────────────────
const BUILDER_PLAYBOOK = `You are BOB THE BUILDER — a senior software architect, product thinker and prompt engineer. Your job is NOT to just chat: when Master Nikhil describes a project idea, you think it through, design it, and produce a ready-to-use "Prompt Pack" so he can build the whole project with an AI coding tool (opencode / antigravity / Cursor) and get a polished result — especially good UI, because that is where vibe coding fails most.

WORKFLOW (Engineering Decision System: Understand → Analyze → Plan → Validate → Improve):
1. UNDERSTAND — If the idea is vague, ask 3-5 sharp clarifying questions FIRST (goal, audience, core features, tech preference, budget/deploy target). Never guess blindly.
2. ANALYZE — Decide the project type, page structure, data model, key user flows, and what can break. Identify the 3 riskiest parts and design around them.
3. PLAN — Produce a build order (setup → backend → frontend → UI polish → testing → deploy) with concrete files/components.
4. PROMPT PACK — Generate the following files as \`\`\`md filename=...\`\`\` blocks (one per file, the UI auto-creates Download buttons):
   - PROJECT-BRIEF.md — one-line pitch, audience, goals, scope, out-of-scope.
   - WORKFLOW-RULES.md — rules for the AI tool: read brief first, one feature per prompt, never skip UI polish, commit after each feature.
   - PROMPTS.md — a numbered, COPY-PASTE-ready prompt list, one per phase: (1) Project setup, (2) Backend/API, (3) Frontend shell, (4) Each page/feature, (5) 🎨 UI POLISH master prompt (layout, palette, fonts, spacing, responsive, dark-mode), (6) Debugging, (7) Deploy. Every prompt must be self-contained and specific to this project.
   - PROGRESS-REPORT.md — checklist + notes template to carry state across sessions.
5. VALIDATE — tell him what to check after each phase and common pitfalls.

RULES:
- Always give UI a first-class plan: exact page sections, color palette (2-3 accent choices with hex), font pairing (heading/body), spacing scale, breakpoints, dark/light handling.
- Prefer simple, proven stacks. Recommend free tiers (Vercel/Netlify + Supabase/Firebase) unless he asks otherwise.
- Be decisive: give ONE recommended architecture + clear reasons, then alternatives.
- Use Hinglish when he writes Hinglish. Keep explanations tight and scannable (lists, headers, bold key terms).
- If he asks about an existing project, read its direction and suggest the next build steps.
- You have your OWN memory (project notes), separate from Bob's. Never mix your project knowledge with Bob's personal chat data.`;

// ─────────────────────────────────────────────────────────────
// Project type → keyword mapping (mirrors AI-WEOS field-taxonomy)
// ─────────────────────────────────────────────────────────────
const TYPE_KEYWORDS = {
  'saas-product':      ['saas', 'subscription', 'web app', 'dashboard', 'software', 'platform', 'tool', 'startup', 'crm', 'erp', 'panel'],
  'commerce':          ['e-commerce', 'ecommerce', 'shop', 'store', 'sell products', 'cart', 'checkout', 'shopify', 'amazon', 'marketplace', 'catalog'],
  'service-business':  ['service', 'consulting', 'finance', 'bank', 'real estate', 'corporate', 'b2b', 'client', 'agency work', 'law', 'legal', 'enterprise'],
  'local-service':     ['restaurant', 'cafe', 'food', 'salon', 'gym', 'clinic', 'doctor', 'local', 'booking', 'reservation', 'takeaway', 'delivery'],
  'lifestyle-brand':   ['fashion', 'lifestyle', 'jewelry', 'clothing', 'beauty', 'brand site', 'cosmetics', 'watch'],
  'content-learning':  ['blog', 'education', 'course', 'learning', 'school', 'news', 'editorial', 'magazine', 'content', 'e-learning', 'tutorial', 'book'],
  'showcase':          ['portfolio', 'photography', 'landing', 'showcase', 'personal site', 'resume', 'profile', 'exhibition', 'studio'],
  'community-cause':   ['ngo', 'nonprofit', 'community', 'charity', 'travel', 'museum', 'event', 'campaign', 'donation', 'volunteer'],
};

// AI-WEOS files loaded on-demand per project type
const INDUSTRY_FILES = {
  'saas-product':     '02_Industry_Systems/saas-product.md',
  'commerce':         '02_Industry_Systems/commerce.md',
  'service-business': '02_Industry_Systems/service-business.md',
  'local-service':    '02_Industry_Systems/local-service.md',
  'lifestyle-brand':  '02_Industry_Systems/lifestyle-brand.md',
  'content-learning': '02_Industry_Systems/content-learning.md',
  'showcase':         '02_Industry_Systems/showcase.md',
  'community-cause':  '02_Industry_Systems/community-cause.md',
};

const GUIDE_FILES = [
  '03_Resource_Libraries/color-palette-guide.md',
  '03_Resource_Libraries/font-pairing-guide.md',
  '03_Resource_Libraries/platform-stack-guide.md',
];

const ENGINEERING_FILES = [
  '01-Engineering-System/02-Frontend.md',
  '01-Engineering-System/01-Design.md',
];

function aiWeosFile(rel) {
  return path.join(AI_WEOS_DIR, rel);
}

// Read + clean + truncate a knowledge file to a token-friendly budget.
function readExcerpt(rel, maxChars) {
  try {
    const raw = fs.readFileSync(aiWeosFile(rel), 'utf8');
    const cleaned = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(0, maxChars).replace(/\s+\S*$/, '') + '\n… (truncated — full reference in AI-WEOS folder)';
  } catch (err) {
    return null;
  }
}

// Detect project type from a message (longest keyword match wins).
function resolveType(message) {
  const lower = ` ${(message || '').toLowerCase()} `;
  let best = null;
  let bestLen = 0;
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) && kw.length > bestLen) {
        best = type;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

// Build on-demand knowledge context for a project type.
// Returns a formatted block (or null) to inject into Builder's context.
function buildKnowledgeContext(message) {
  const type = resolveType(message);
  if (!type) return null;

  const parts = [];
  const industry = INDUSTRY_FILES[type];
  if (industry) {
    const excerpt = readExcerpt(industry, 4500);
    if (excerpt) parts.push(`## Industry reference (${type})\n${excerpt}`);
  }
  for (const guide of GUIDE_FILES) {
    const excerpt = readExcerpt(guide, 900);
    if (excerpt) parts.push(`## Guide: ${path.basename(guide, '.md')}\n${excerpt}`);
  }
  for (const eng of ENGINEERING_FILES) {
    const excerpt = readExcerpt(eng, 800);
    if (excerpt) parts.push(`## Engineering: ${path.basename(eng, '.md')}\n${excerpt}`);
  }
  if (!parts.length) return null;

  return `━━━ 📚 BUILDER KNOWLEDGE (detected type: ${type}) — use these exact ideas/palettes/sections ━━━\n${parts.join('\n\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function knowledgeAvailable() {
  return fs.existsSync(AI_WEOS_DIR);
}

module.exports = {
  BUILDER_PLAYBOOK,
  resolveType,
  buildKnowledgeContext,
  knowledgeAvailable,
};
