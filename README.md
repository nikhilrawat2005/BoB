# 🤖 Bob — Autonomous AI Companion & Engineering System

Bob is a personal, autonomous AI backend built for Nikhil: one Node.js/Express server that ties together LLM chat (with tool-use), long-term structured memory, a file vault, a "vibecoding" builder workspace, hackathon + social-profile crawlers, live data feeds, autonomous routines/scheduling, self-editing, and an SEO auditor — all behind Firebase auth, with a vanilla-JS single-page frontend served from `public/`.

---

## 🏗️ Architecture Overview

```
bob-backend/
├── src/
│   ├── server.js                      # Express entrypoint, security headers, route mounting
│   ├── config/
│   │   ├── firebase.js                # Firebase Admin init (Auth + Firestore)
│   │   └── cloudinary.js              # Cloudinary storage config
│   ├── middleware/
│   │   └── auth.js                    # Firebase ID token verification (requireAuth)
│   ├── routes/                        # 17 route groups — see API table below
│   └── services/                      # 28 service modules — business logic layer
├── public/                            # Frontend SPA (HTML5 + vanilla JS + CSS3)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── AI-Website-Engineering-System/     # Reference playbooks Bob the Builder draws on
│   ├── 00-Core-System/                # Workflow, architecture, governance, quality rules
│   ├── 01-Engineering-System/         # Design, frontend, backend, SEO, business, deploy guides
│   ├── 02_Industry_Systems/           # Per-industry site blueprints (SaaS, commerce, etc.)
│   ├── 03_Resource_Libraries/         # Color palettes, font pairings, field taxonomy, stack guide
│   └── 04_Templates/                  # Prompt/brief/progress-report templates
├── AGENTS.md                          # Working rules Bob/agents must follow (git workflow, etc.)
├── .env.example                       # Full environment variable reference
├── vercel.json                        # Vercel serverless deployment config
└── package.json
```

---

## ⚡ Core Capabilities

### 1. 💬 Chat & LLM Orchestration
- Multi-key OpenRouter rotation pool (up to 11 keys) with automatic failover when a key exhausts credits.
- Role-pinned keys (`BOB_API_KEY`, `CENTER_API_KEY`, `BUILDER_API_KEY`) that survive restarts, plus generic replacement keys.
- Per-task model routing (`WRITER_MODEL`, `REVIEW_MODEL`, `AUDITOR_MODEL`, `VISION_MODEL`, `CHEAP_MODEL`) with automatic capability-based fallback (e.g. shifting off a text-only model when an image is attached, or off a small-context model when the prompt is too big).
- Tool-use / proactive insights layered into `/api/chat`.

### 2. 🧠 Structured Memory Bank
Six long-term memory pillars, all Firestore-backed:
- 🎯 Habits & Preferences — workflow, coding style, routines
- 🧠 Main Memory — general facts, goals, knowledge
- 🏆 Hackathons — problem statements, teammates, deadlines
- 🕵️ Stalker Intelligence — target profiles across social platforms
- 🔒 Secret Vault — PIN-protected credentials/notes
- 🛠️ Builder & Codebase — architecture notes, tech stack, dev progress

### 3. 📁 File Vault
- Cloudinary-backed upload/view/download/delete with Firestore metadata sync.
- Automatic text extraction (PDF/DOCX/XLSX/code) so Bob can reference file contents in chat.
- Real binary office file *generation* (`.xlsx`, `.docx`, `.pdf`, `.pptx`) via `documentGenerator`.

### 4. 🛠️ Builder Workspace ("Bob the Builder")
- Dedicated persona with its own key pool and model, isolated from the main chat pool.
- Reads GitHub repos (public, or private with a fine-grained PAT) for self-aware project context.
- Backed by `builderService`, `builderKnowledgeService`, `builderTaskService`, and the `AI-Website-Engineering-System` knowledge base for planning/PRDs/prompt packs.

### 5. 🕵️ Stalker Intelligence & Deep Crawler
- Crawls LinkedIn, GitHub, X, Instagram, and portfolio sites; extracts JSON-LD, tech stack signals, and bios.

### 6. 🏆 Hackathon Tracker
- Scrapes Devpost/Unstop listings for problem statements, requirements, and deadlines.

### 7. ⏰ Autonomous Routines & Scheduler
- Cron-driven (`GET/POST /api/scheduler/tick`, triggered hourly by GitHub Actions) reminders and daily routines, secured via `CRON_SECRET`.
- `proactiveAdvisor` generates notifications on its own from vault/fact changes.

### 8. 🔧 Self-Edit Engine
- Bob can propose and log diffs to its own codebase (`selfEditService`), capped by `SELF_EDIT_MAX_DIFF_CHARS`.

### 9. 📈 SEO Auditor
- Tracks and audits sites on a schedule, with the same cron-or-Firebase-auth pattern as the scheduler.

### 10. 📊 HQ Dashboard
- `/api/hq/summary` aggregates hackathons, profiles, routines, notifications, facts, monthly memory, files, and self-edits into one dashboard payload.

---

## 🔧 Services Reference (`src/services/`)

| Service | Responsibility |
|---|---|
| `llmService.js` | OpenRouter orchestration, key rotation, model routing/fallback |
| `memoryService.js` / `memoryManager.js` | Structured facts, monthly memory, notifications |
| `behaviorEngine.js` | Trait/behavior detection from conversation |
| `proactiveAdvisor.js` | Auto-generates proactive notifications |
| `fileService.js` | Cloudinary upload/delete + Firestore sync |
| `documentReaderService.js` | Extracts text from PDF/DOCX/XLSX/code |
| `documentGenerator.js` | Generates real `.xlsx/.docx/.pdf/.pptx` files |
| `crawlerService.js` | Generic web page scraping + JSON-LD extraction |
| `repoService.js` | GitHub repo reading for Builder self-awareness |
| `builderService.js` / `builderKnowledgeService.js` / `builderTaskService.js` | Bob the Builder persona logic |
| `selfEditService.js` | Self-edit proposal/diff/history tracking |
| `hackathonService.js` | Devpost/Unstop scraping |
| `stalkingService.js` | Multi-network profile discovery |
| `instagramService.js` / `youtubeService.js` | Platform-specific scraping / transcripts |
| `mediaDetector.js` | Detects media type/links in content |
| `weatherService.js` / `newsService.js` / `stocksService.js` | Live data (Open-Meteo, RSS, Yahoo Finance) |
| `webSearchService.js` | General web search for research |
| `seoService.js` | Site SEO auditing |
| `routineService.js` / `schedulerService.js` | Daily routines and cron-driven tasks |
| `statsService.js` | Usage/stat aggregation |
| `developerPlatformsService.js` | Developer-platform integrations |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (20+ recommended)
- Firebase project (Auth + Firestore enabled)
- Cloudinary account
- At least one OpenRouter API key

### Installation
```bash
git clone https://github.com/nikhilrawat2005/BoB.git
cd bob-backend
npm install
cp .env.example .env
```

### Environment Configuration
Fill in `.env` — key sections (see `.env.example` for full inline docs):

```env
# OpenRouter — up to 11 rotating keys, optional role pinning
OPENROUTER_API_KEY1=sk-or-v1-...
BOB_API_KEY=
CENTER_API_KEY=
BUILDER_API_KEY1=
BUILDER_MODEL=deepseek/deepseek-chat-v3

# Model routing
WRITER_MODEL=google/gemini-2.5-flash-lite
REVIEW_MODEL=google/gemini-2.5-flash
VISION_MODEL=google/gemini-2.5-flash-lite
CHEAP_MODEL=google/gemini-2.5-flash-lite

# Firebase Admin
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Firebase Client (served via /api/config)
FIREBASE_CLIENT_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Access control
ALLOWED_EMAILS=you@example.com
SHARED_ADMIN_ID=nikhil_master_workspace
SECRET_VAULT_PIN=2005

# Cron (GitHub Actions -> scheduler/seo tick)
CRON_SECRET=

# Live data
DEFAULT_CITY=New Delhi
```

### Running Locally
```bash
npm run dev     # nodemon, auto-restart
npm start       # plain node
```
Visit `http://localhost:3000`.

---

## 📡 API Endpoints Reference

All `/api/*` routes (except `/api/health` and `/api/config`) require:
`Authorization: Bearer <firebase-id-token>` (or `?token=` query param for direct browser viewing).

| Route prefix | File | Purpose |
|---|---|---|
| `POST /api/auth/set-password` | `server.js` | Set/reset password for an allow-listed email, returns custom token |
| `/api/chat` | `chat.js` | LLM chat, tool-use, streaming |
| `/api/sessions` | `sessions.js` | Chat sessions + message history |
| `/api/memory` | `memory.js` | CRUD for structured facts/memory |
| `/api/files` | `files.js` | Upload / view / download / delete / generate office files |
| `/api/research` | `research.js` | Crawl & LLM-analyze any URL |
| `/api/secret` | `secretVault.js` | PIN-protected vault |
| `/api/notifications` | `notifications.js` | List/mark-read proactive notifications |
| `/api/scheduler` | `scheduler.js` | Cron tick, reminders |
| `/api/live` | `live.js` | Weather / news / stocks |
| `/api/builder` | `builder.js` | Bob the Builder workspace |
| `/api/hackathons` | `hackathons.js` | Hackathon list + scrape |
| `/api/stalking` | `stalking.js` | Profile list + deep crawl |
| `/api/routines` | `routines.js` | Daily autonomous routines |
| `/api/hq` | `hq.js` | Aggregated dashboard summary |
| `/api/self-edit` | `selfEdit.js` | Self-edit history/diffs |
| `/api/keys` | `keys.js` | Anonymized OpenRouter key health (no raw keys ever sent) |
| `/api/seo` | `seo.js` | SEO site tracking + audits (cron or user auth) |

---

## 🚢 Deployment (Vercel)

1. `git push origin main`
2. Import the repo into **Vercel**.
3. Copy every variable from `.env` into Vercel Project Settings → Environment Variables.
4. Deploy.
5. For hourly scheduler/SEO ticks, set the same `CRON_SECRET` in Vercel **and** in the GitHub repo's Actions secrets (used by `.github/workflows/tick.yml`, if present, to call `POST /api/scheduler/tick`).

---

## 📜 Project Rules
See `AGENTS.md` for the working agreement (e.g. commit after every change set, auto-push to `main`, never commit `.env`).
