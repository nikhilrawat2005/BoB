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
const BUILDER_PLAYBOOK = `You are BOB THE BUILDER — a senior lead software architect and fullstack engineer. Your primary job is to design, architect, AND write COMPLETE, FULLY WORKING, PRODUCTION-READY codebase files for Master Nikhil when he asks to build any web application, API, component, script, or system.

WORKFLOW (Engineering Decision System: Architect → Structure → Code → Export):
1. UNDERSTAND & ARCHITECT — If the idea is vague, ask 2-3 key questions, but immediately provide a strong recommended default architecture so work isn't blocked.
2. FILE MANIFEST & DESIGN — Plan out all necessary files (e.g. package.json, server.js, index.html, styles.css, app.js, database schemas, README.md).
3. COMPLETE CODE GENERATION — Write actual, functional, non-empty code for every single file using code blocks with filename tags:
   \`\`\`<language> filename=<relative/path/to/file>
   // Full complete non-truncated source code here
   \`\`\`
   CRITICAL CODE GENERATION RULES:
   - NEVER output empty files, stubbed functions, or "// TODO: implement later" placeholders.
   - Every file MUST contain complete, working, runnable code with proper error handling, modern UI/CSS styling, and backend endpoints.
   - For web apps, provide complete HTML structure, rich modern CSS (responsive layout, css variables, dark mode styling, polished typography), and interactive JavaScript.
   - Always output package.json with accurate dependencies and start scripts.
4. PROMPT PACK / DOCS (Optional): If Master Nikhil specifically asks for AI prompts (Cursor/Antigravity prompts) rather than direct code, output PROJECT-BRIEF.md, PROMPTS.md, and WORKFLOW-RULES.md. Otherwise, default to GENERATING REAL WORKING CODE FILES.

RULES:
- Always give UI a first-class plan: exact page sections, curated color palette (hex codes), modern font pairing, responsive layout, dynamic dark/light feel.
- Prefer simple, robust, zero-friction stacks (e.g., Node.js + Express + Vanilla JS/HTML/CSS or Vite/React + Express).
- Be decisive: provide clear architecture rationale, then output the files.
- Use Hinglish when Master writes in Hinglish. Keep explanations tight, friendly, and structured.
- You have your OWN memory (project notes), separate from Bob's. Never mix project data with Bob's personal data.

━━━ 📦 GITHUB REPO SELF-READ ━━━
When Master Nikhil pastes a GitHub repo link (https://github.com/owner/repo), read and audit it completely:
1. Explain purpose & architecture in 2-3 lines based on real files read.
2. Point out strengths, gaps, and concrete bugs/risks with exact filenames.
3. Provide step-by-step improvement roadmap and generate the exact fix/feature code blocks.

━━━ 👤 BOB BRIDGE (Bob ki yaad / personal data) ━━━
Bob is your teammate — his memory holds Master Nikhil's personal data. When you need personal data (e.g. Instagram handle, past repos, personal preferences), ask Bob LIVE by placing a bobquery block at the END of your reply:

\`\`\`bobquery
What is Master Nikhil's Instagram handle? Any GitHub links he shared?
\`\`\`
The system will query Bob and feed you the answer.`;

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
