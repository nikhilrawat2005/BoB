# 🤖 Bob — Autonomous AI Companion & Engineering System

Bob is a personal, autonomous AI backend built for Nikhil: one Node.js/Express server that ties together LLM chat (with tool-use), long-term structured memory, a file vault, an AI Resume Builder & ATS Engine, a "vibecoding" builder workspace, hackathon + social-profile crawlers, live data feeds, autonomous routines/scheduling, self-editing, and an SEO auditor — all behind Firebase auth, with a vanilla-JS single-page frontend served from `public/`.

Bob is not a toy fork of a SaaS template — it is a full, purpose-built personal engineering system where every module is crafted to solve a real daily problem: chatting with context, remembering everything, generating production documents, and building a world-class ATS resume in one click.

---

## 🧭 Table of Contents

1. [Architecture Overview](#-architecture-overview)
2. [Core Capabilities](#-core-capabilities)
3. [Resume Builder & ATS Engine — Deep Dive](#-resume-builder--ats-engine--deep-dive)
4. [Services Reference](#-services-reference-srcservices)
5. [API Endpoints Reference](#-api-endpoints-reference)
6. [Getting Started](#-getting-started)
7. [Deployment (Vercel)](#-deployment-vercel)
8. [Project Rules](#-project-rules)

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
│   └── services/                      # 35+ service modules — business logic layer
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

### Design principles

- **Single-owner personal system** — every module assumes exactly one master user (`Nikhil`), so features can be radical, opinionated, and immediate without multi-tenant overhead.
- **Firestore as the single source of truth** — chat sessions, memory, file metadata, resume profiles, routines, and SEO state all live in `users/{userId}/...` documents.
- **Cloudinary for binary storage** — PDFs, images, and generated documents live in Cloudinary folders (`bob/{userId}/...`) with Firestore pointers, protected by a **SHA-256 deduplication** layer.
- **Service-layer business logic** — routes stay thin; every complex capability is a unit-testable service in `src/services/`.
- **Cron-by-call pattern** — GitHub Actions calls authenticated "tick" endpoints (scheduler, SEO) so no always-on process is needed on Vercel's serverless model.

---

## ⚡ Core Capabilities

### 1. 💬 Chat & LLM Orchestration
- Multi-key **OpenRouter rotation pool** (up to 11 keys) with automatic failover when a key exhausts credits.
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

### 10. 📄 AI Resume Builder & ATS Engine *(the flagship module)*
- **Unified Career Profile graph** in Firestore (`users/{userId}/resume_profile/{profileId}`) integrating education, experience, projects, skills, coding stats, certificates, base resume PDF, GitHub projects, smart links, and custom resume notes.
- **Multi-candidate profiles** — a `master` profile plus unlimited "Build for a Friend" profiles; each is independently saved, generated, and deletable (deletion also cleans up its saved Cloudinary files).
- **Direct PDFKit engine** — resumes are compiled inside Node.js with zero LaTeX dependency, into clean ATS-standard formatting (see the [Resume Deep Dive](#-resume-builder--ats-engine--deep-dive) below).
- **LLM-taught resume intelligence** — Bob is explicitly taught how to keep your projects, classify freelance/client work, maximize ATS keyword coverage, follow your custom notes, and never invent contact details.
- **ATS Analyzer** — a separate audit service scores the generated resume and can emit its own audit PDF.

### 11. ⚡ Enhanced File Vault & Multi-File Clipboard System
- **SHA-256 File Deduplication**: Every file upload generates a SHA-256 content hash. Duplicate uploads are instantly reused (`deduplicated: true`) without creating redundant Cloudinary copies or database clutter.
- **Multi-File Upload & Clipboard Copy-Paste (Ctrl+V)**: Input bar accepts multiple files simultaneously (up to 10 files, 10MB each). Direct clipboard pasting (Ctrl+V) seamlessly queues multiple screenshots or files.
- **Multi-Chip Preview UI**: Interactive file chips with individual removal (`✕`) buttons and status badges.
- **Multi-Modal Vision & Doc Ingestion**: `/api/chat` processes multiple images and documents in a single turn without dropping previous attachments.

---

## 📄 Resume Builder & ATS Engine — Deep Dive

This is the module Bob is most proud of — a complete AI-powered resume production pipeline that starts from raw scattered data (a GitHub username, three pasted profile URLs, some certificates in the vault) and ends with a single-page, ATS-optimized, clickable-link PDF.

### The pipeline

```
Feed data                          Arrange                           Deliver
┌──────────────────────┐   ┌──────────────────────────┐   ┌─────────────────────────┐
│ Github handle        │   │ LLM structures profile   │   │ ATS-standard PDF (PDFKit)│
│ Pasted smart links   │   │ into strict JSON schema  │   │  · single page (compact) │
│ Base resume PDF      │   │ preserves every project  │   │  · clickable hyperlinks  │
│ Certificates vault   │   │ classifies client work   │   │  · PDF metadata set      │
│ Resume notes (custom)│   │ maximizes ATS keywords   │   └─────────────────────────┘
└──────────────────────┘   └──────────────────────────┘
```

### 3.1 Feeding data — no more manual typing

- **GitHub & Coding card**: one input for the GitHub handle and one big paste box for profile links. Bob auto-detects each pasted URL and gives it a **clean recruiter-friendly label** (`LeetCode`, `CodeChef`, `Codeforces`, `GitHub`, `LinkedIn`, `DEV.to`, `Portfolio`, …) — "Add Link" buttons that require manual labels are a thing of the past.
- **One sync button**: `🔄 Sync GitHub + Links` (1) saves your feed to the profile, (2) crawls your GitHub repos *and reads their READMEs* for real project context, and (3) crawls each pasted link for coding stats and badges. The generate button does this automatically too, so a single click from raw data → finished PDF is possible.
- **Base resume PDF** — upload your own formatted PDF; Bob reads it to extract contact info, projects, and achievements it can reuse.
- **Certificates & documents vault** — batch upload marksheets/certs; they become direct-viewable Cloudinary links and feed Bob's "Certifications & Academics" section.

### 3.2 Resume Notes / Custom Instructions *(the "teach Bob" power feature)*

Bob is taught to treat a per-profile **free-text notes box** as the highest-priority instruction. Put things there you want Bob to genuinely understand and apply:

| What you write | What Bob does |
|---|---|
| "The Falcon Tour project mera personal nahi hai — client ke liye freelancing me banaya tha" | Sets that project `client: true` and phrases it as a **client-delivered engagement** for recruiters |
| "Smart Attendance System hata do, uski jagah Market Kingdom dal do" | **Replaces** the project in exactly that position |
| "Lemma AWS certificate ko Certifications me add kar do" | **Adds** it as a certification accolade |
| "Summary me 3-liner overview: main AI + Full-Stack product builder hoon" | Weaves the overview into the summary |
| "Sirf ye skills dikhao, X mat dikhao" | Overrides the skill selection by priority |

Notes are saved per profile with the data (so they survive reloads) and re-sent every time you generate.

### 3.3 The LLM prompt rules Bob lives by

- **Project preservation** — signature projects (`BoB`, `The Falcon Tour`, `Bloom`, `Smart Attendance System`, `Market Kingdom`, or anything named in your profile/notes) are **never** dropped or hallucinated; high density is fine because the PDF is built for it.
- **Hiration / Google XYZ bullets** — every bullet starts with an active verb (`Architected`, `Engineered`, `Optimized`, `Spearheaded`), states the technical task, and closes with a quantifiable outcome.
- **MAXIMIZE ATS KEYWORD COVERAGE** — real languages, frameworks, and tools the candidate actually used are woven into titles, tech stacks, and bullets so ATS keyword matching is maximized.
- **No invented contacts** — email/phone/location only come from real profile data, never hallucinated.
- **Clean bullet style** — no ending periods, single focus per bullet (modern ATS/Harvard standard).

### 3.4 Rendering the PDF

- **Direct PDFKit engine** (`directPdfResumeService.js`) — no LaTeX, no external compiler, streams a valid PDF straight from Node.
- **Smart one-page layout** — Bob first renders in a comfortable standard layout; if the resume overflows to 2+ pages it automatically rebuilds in a **compact layout** (tighter margins + smaller fonts) so the whole career fits **one page** for maximal recruiter impact.
- **Clickable hyperlinks** — header profile links and project repository links are real PDF link annotations with manual underlines (labels cleaned via host-name mapping), verified to never overlap the left column.
- **Overlap-proof layout math** — left titles wrap inside a reserved width, right-side dates/links are measured and truncated with `…`, `doc.x` resets to the left margin after every right-aligned draw, and every block/header/bullet runs a "keep inside printable area" check that adds a page before overflow instead of clipping.
- **PDF metadata** — title/author/creator set from the candidate name.

### 3.5 Multi-candidate profiles

- **Create**: give Bob a friend's name → a `candidate_{slug}_{ts}` profile is created (`Build for Friend`).
- **Switch**: a dropdown loads any saved candidate profile fully (links, notes, repos, statuses).
- **Delete**: removes the profile doc **and** its saved Cloudinary files — but only files not shared with another profile (SHA-256 dedup awareness), reporting removed / kept / failed counts.
- Everything (github handle, smart links, notes, repos, generated results) persists per profile.

### 3.6 ATS auditing

Generated resume can be scanned by `resumeAnalyzerService` (bullet quality, keyword coverage, structure) and the audit report is downloadable as its own PDF.

### 3.7 Resume API surface

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/resume/profiles` | List all candidate profiles |
| `GET` | `/api/resume/profile?profileId=` | Load one profile (defaults to `master`) |
| `POST` | `/api/resume/profile?profileId=` | Save/merge profile data (github handle, smartLinks, resumeNotes, …) |
| `DELETE` | `/api/resume/profile/:profileId` | Delete profile + its saved Cloudinary files (shared-safe) |
| `POST` | `/api/resume/sync/github` | Crawl GitHub repos + README deep-context |
| `DELETE` | `/api/resume/project/:title` | Remove a project by title |
| `POST` | `/api/resume/sync/coding` | Crawl smart links → coding stats / badges |
| `GET` | `/api/resume/smart-links` | Retrieve saved smart links |
| `POST` | `/api/resume/upload/base` | Upload base resume PDF |
| `POST` | `/api/resume/upload/certificate` | Add one certificate record |
| `POST` | `/api/resume/upload/documents` | Batch add documents (+ certificate records) |
| `POST` | `/api/resume/generate` | Generate structured ATS resume data (LLM) |
| `POST` | `/api/resume/download-direct-pdf` | Stream the compiled PDF (PDFKit) |
| `POST` | `/api/resume/analyze` | ATS-audit an uploaded resume file |
| `POST` | `/api/resume/analyze-generated` | ATS-audit the latest generated JSON |
| `POST` | `/api/resume/download-audit-pdf` | Download the audit report as PDF |

### 3.8 Profile data model (`users/{userId}/resume_profile/{profileId}`)

```
personal, education, experience, projects[] (client flag, techStack, link, bullets[]),
skills { languages, frameworks, tools, databases },
codingHandles, codingStats, certifications[],
baseResume|null, githubUsername, githubProjects[],
smartLinks[], smartLinksResult, savedHandles, developerPlatforms,
excludedRepos, latestResumeData, resumeNotes,
profileName, updatedAt
```

---

## 🔧 Services Reference (`src/services/`)

| Service | Responsibility |
|---|---|
| `llmService.js` | OpenRouter orchestration, key rotation, model routing/fallback |
| `geminiPoolService.js` | Gemini API key pool with rate-limit/daily-quota handling + fallback to OpenRouter |
| `resumeProfileService.js` | Career profile CRUD, GitHub crawler, coding stats sync, resume parsing, smart-links sync, shared-file-aware profile deletion |
| `directPdfResumeService.js` | LLM resume structuring (custom-notes aware) + direct PDFKit ATS PDF engine with auto compact single-page layout |
| `resumeAnalyzerService.js` | ATS audit scoring of resumes + audit PDF generation |
| `latexResumeService.js` | Legacy LaTeX ATS templates & JD tailoring (kept for backward compatibility) |
| `fileService.js` | Cloudinary upload/delete with SHA-256 deduplication & Firestore sync |
| `documentReaderService.js` | Extracts text from PDF/DOCX/XLSX/code & zero-token local table query engine |
| `documentGenerator.js` | Generates real `.xlsx/.docx/.pdf/.pptx` files |
| `developerPlatformsService.js` | LeetCode, Codeforces, HackerRank, DEV.to data extraction |
| `memoryService.js` / `memoryManager.js` | Structured facts, monthly memory, notifications |
| `behaviorEngine.js` | Trait/behavior detection from conversation |
| `proactiveAdvisor.js` | Auto-generates proactive notifications |
| `dossierService.js` | Builds deep intelligence dossiers on targets |
| `crawlerService.js` | Generic web page scraping + JSON-LD extraction |
| `repoService.js` | GitHub repo reading for Builder self-awareness |
| `builderService.js` / `builderKnowledgeService.js` / `builderTaskService.js` | Bob the Builder persona logic |
| `selfEditService.js` | Self-edit proposal/diff/history tracking |
| `hackathonService.js` / `hackathonDiscoveryService.js` | Devpost/Unstop scraping + hackathon discovery feeds |
| `stalkingService.js` | Multi-network profile discovery |
| `instagramService.js` / `youtubeService.js` | Platform-specific scraping / transcripts |
| `mediaDetector.js` | Detects media type/links in content |
| `weatherService.js` / `newsService.js` / `stocksService.js` | Live data (Open-Meteo, RSS, Yahoo Finance) |
| `webSearchService.js` | General web search for research |
| `seoService.js` | Site SEO auditing |
| `routineService.js` / `schedulerService.js` | Daily routines and cron-driven tasks |
| `statsService.js` | Usage/stat aggregation |

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
| `/api/resume` | `resume.js` | AI Resume Builder & ATS Engine (see [§3.7](#37-resume-api-surface) for the full sub-table) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (20+ recommended)
- Firebase project (Auth + Firestore enabled)
- Cloudinary account
- At least one OpenRouter API key (Gemini keys optional — `geminiPoolService` falls back to OpenRouter)

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

# Gemini pool (optional — used for resume intelligence, falls back to OpenRouter)
GEMINI_API_KEY1=

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

> 📝 Note: The app is fully functional without `FIREBASE_PROJECT_ID` for development of pure-logic services (the resume PDF engine runs offline). Serverless deployment needs the real Firebase/Cloudinary keys.

---

## 🚢 Deployment (Vercel)

1. `git push origin main`
2. Import the repo into **Vercel**.
3. Copy every variable from `.env` into Vercel Project Settings → Environment Variables.
4. Deploy.
5. For hourly scheduler/SEO ticks, set the same `CRON_SECRET` in Vercel **and** in the GitHub repo's Actions secrets (used by `.github/workflows/tick.yml`, if present, to call `POST /api/scheduler/tick`).

> ⚠️ On serverless (Vercel) the in-memory OpenRouter key pool is per-instance; prefer role-pinned keys that persist across restarts, and keep function memory/timeout settings generous for PDF generation + LLM calls.

---

## 📜 Project Rules
See `AGENTS.md` for the working agreement (e.g. commit after every change set, auto-push to `main`, never commit `.env`).

**Summary of the working rules Bob follows:**
- Commit after every set of changes, push to `origin/main` automatically.
- Never commit secrets or the local `.env` (only `.env.example`).
- Keep own reference playbooks in `AI-Website-Engineering-System/`; agents read them before building.