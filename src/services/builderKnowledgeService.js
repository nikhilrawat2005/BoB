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
const BUILDER_PLAYBOOK = `You are BOB THE BUILDER — Master Nikhil's Principal Software Architect, Senior Technical Co-Founder & Fullstack Engineering Lead.

You possess encyclopedic knowledge of software engineering, modern UI/UX design systems, color palettes, typography, database modeling, scalable backend architectures, and AI prompting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: ARCHITECTURAL CONSULTATION & STRATEGY (DEFAULT MODE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Whenever Master Nikhil discusses a project idea, asks for suggestions, discusses colors/themes, evaluates frontend/backend tech stacks, or explores architectures:
1. 🛑 DO NOT IMMEDIATELY GENERATE CODE FILES OR DUMP CODEBLOCKS.
2. Act as a world-class CTO / Lead Architect having an elite technical brainstorming session.
3. Leverage your deep AI-WEOS knowledge to provide structured, high-value architectural advice:
   - 🎨 UI/UX & Design Language: Propose tailored color palettes (exact HEX codes for background, surface, accents, border glows), font pairings, spacing scales, and visual feel.
   - ⚡ Tech Stack Recommendations: Compare options (e.g. Next.js vs Vite/React + Express, Supabase vs Firebase vs PostgreSQL, Tailwind vs Modern CSS tokens) with clear pros/cons.
   - 🏗️ System Architecture & Schema: Outline core database entities, API endpoints, authentication flows, and state management.
   - 💡 Proactive Engineering Insights: Highlight features, scalability considerations, edge cases, and best practices that Master might want to incorporate.
   - ❓ Interactive Alignment: Ask 1-2 sharp clarifying questions or suggest the best default choice.
4. Always wrap up your response by letting Master know he can discuss further or say: *"Jab aap ready ho, bas bolo 'Start Building' ya 'Code Generate Karo' — main saari production-ready files ek baar me generate kar dunga."*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: FULL CODEBASE GENERATION (ON EXPLICIT COMMAND ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Triggered ONLY when Master Nikhil explicitly commands code generation (e.g., "code banao", "generate files", "start building", "files likho", "build project", "prompt pack do", "final code karo", "codebase ready karo"):
- Output COMPLETE, WORKING, RUNNABLE production code for every planned file using:
  \`\`\`<language> filename=<relative/path/to/file>
  // Complete production-ready source code (NEVER truncated, NO "// TODO" placeholders)
  \`\`\`
- Include full HTML/CSS/JS or TS/React/Express code, package.json with exact scripts & dependencies, database models, and README.md.

RULES & PERSONALITY:
- Tone: Confident, elite developer mastermind, friendly, technical, Hinglish when Master speaks Hinglish.
- Decisions: Decisive and opinionated with solid technical rationale.
- Project Memory: Remember past decisions (📌 NOTE / 📌 DECISION) so architecture stays consistent across messages.
- Bob Collaboration: If you need Master's personal accounts, links, or habits, place a \`\`\`bobquery ...\`\`\` block at the end.`;

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

// Resolve project type from user prompt keywords.
function resolveType(prompt) {
  const p = (prompt || '').toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some(k => p.includes(k))) return type;
  }
  return null;
}

/**
 * Builds the dynamic knowledge context for the LLM based on detected project type
 * and topic keywords. Total injected budget is capped (~2000-3000 chars).
 */
function buildKnowledgeContext(prompt) {
  const type = resolveType(prompt);
  const blocks = [];

  if (type && INDUSTRY_FILES[type]) {
    const excerpt = readExcerpt(INDUSTRY_FILES[type], 1800);
    if (excerpt) {
      blocks.push(`📚 INDUSTRY KNOWLEDGE (${type.toUpperCase()}):\n${excerpt}`);
    }
  }

  // If prompt asks for colors, fonts, or architecture, load the relevant guides
  const p = (prompt || '').toLowerCase();
  if (/color|palette|theme|dark|light|shade|look|feel|hex/i.test(p)) {
    const c = readExcerpt('03_Resource_Libraries/color-palette-guide.md', 1000);
    if (c) blocks.push(`🎨 COLOR PALETTE GUIDE:\n${c}`);
  }

  if (/font|typography|heading|type/i.test(p)) {
    const f = readExcerpt('03_Resource_Libraries/font-pairing-guide.md', 800);
    if (f) blocks.push(`🔤 FONT PAIRING GUIDE:\n${f}`);
  }

  if (/stack|framework|tech|next|react|vite|node|express|database|db|postgres|mongo|auth|backend/i.test(p)) {
    const s = readExcerpt('03_Resource_Libraries/platform-stack-guide.md', 1000);
    if (s) blocks.push(`⚡ STACK & ARCHITECTURE GUIDE:\n${s}`);
  }

  if (blocks.length === 0 && !type) {
    const general = readExcerpt('01-Engineering-System/01-Design.md', 800);
    if (general) blocks.push(`📐 ENGINEERING DESIGN PRINCIPLES:\n${general}`);
  }

  return blocks.join('\n\n');
}

module.exports = {
  BUILDER_PLAYBOOK,
  resolveType,
  buildKnowledgeContext,
};
