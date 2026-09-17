<div align="center">

# 🤖 BOB — Autonomous AI Companion & Engineering System

**One Node.js backend. One master user. Zero compromise.**
LLM orchestration • Structured memory • File vault • AI Resume/ATS engine • Builder workspace • Live crawlers • Autonomous scheduler • Self-editing • SEO engine

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](#%EF%B8%8F-quickstart)
[![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)](#)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?logo=firebase&logoColor=black)](#)
[![Cloudinary](https://img.shields.io/badge/Cloudinary-Storage-3448C5?logo=cloudinary&logoColor=white)](#)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-Multi--Key%20LLM%20Pool-8A2BE2)](#)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel&logoColor=white)](#%F0%9F%9A%80-deployment-vercel)
[![License](https://img.shields.io/badge/License-ISC-lightgrey)](#)

</div>

---

> Bob is a **single-owner personal engineering system** — not a SaaS template. Every module solves a real daily problem: chat with real context, remember everything, generate production-grade documents, and build a world-class ATS resume in one click.

## Core Capabilities

| # | Module | What it does |
|---|--------|--------------|
| 1 | 💬 **Chat & LLM Orchestration** | Multi-key OpenRouter rotation pool (up to 11 keys) with automatic failover; role-pinned keys; per-task model routing (`WRITER_MODEL`, `REVIEW_MODEL`, `AUDITOR_MODEL`, `VISION_MODEL`, `CHEAP_MODEL`) with capability-based fallback; tool-use + proactive insights |
| 2 | 🧠 **Structured Memory Bank** | Six Firestore-backed memory pillars: Habits & Preferences, Main Memory, Hackathons, Stalker Intelligence, Secret Vault, Builder & Codebase |
| 3 | 📁 **File Vault** | Cloudinary-backed storage with SHA-256 dedup; text extraction from PDF/DOCX/XLSX/code; real binary generation (`.xlsx` `.docx` `.pdf` `.pptx`); multi-file upload + clipboard paste |
| 4 | 🛠️ **Builder Workspace ("Bob the Builder")** | Dedicated persona with isolated key pool/model; reads GitHub repos (public/private) for self-aware context; planning, PRDs & prompt packs from an engineering knowledge base |
| 5 | 🕵️ **Stalker Intelligence** | Deep crawls LinkedIn, GitHub, X, Instagram, portfolio sites; extracts JSON-LD, tech-stack signals, bios |
| 6 | 🏆 **Hackathon Radar & Tracker** | Autonomous discovery feeds (Devpost/Unstop/Devfolio) via Google CSE + LLM enrichment, auto-expiry, live pulse; per-hackathon knowledge docs + scoped chat |
| 7 | ⏰ **Autonomous Routines & Scheduler** | Cron-driven hourly tick (GitHub Actions); reminders, daily routines, proactive notifications from vault/fact changes |
| 8 | 🔧 **Self-Edit Engine** | Bob proposes and logs diffs to its own codebase (`selfEditService`), capped by `SELF_EDIT_MAX_DIFF_CHARS` |
| 9 | 📈 **SEO Beast Engine** | Cap-free parallel crawl of every discoverable page (sitemap-seeded BFS, broken-link + PageSpeed checks, 4-pillar 100-scale scoring, keyword tracking, honest blocked-site detection, self-healing re-audit pump); multi-key AI analysis → Hinglish summary, action plan, deployable fix plan, HTML report |
| 10 | 📄 **AI Resume Builder & ATS Engine** | Flagship module — full pipeline from raw data to a one-page ATS-optimized PDF (see below) |
| 11 | ⚡ **Enhanced Clipboard & Multi-File** | SHA-256 dedup, multi-file clipboard paste, multi-chip preview UI, multi-modal vision/doc ingestion in `/api/chat` |

## Architecture (Condensed)

```
bob-backend/
├── src/
│   ├── server.js          # Express entrypoint, security headers, route mounting
│   ├── config/            # firebase.js, cloudinary.js
│   ├── middleware/auth.js # Firebase ID token verification (requireAuth)
│   ├── routes/            # 18 route groups (thin: parse + respond)
│   └── services/          # 35+ service modules (fat: business logic)
├── public/                # Frontend SPA (vanilla HTML5 + JS + CSS)
├── AI-Website-Engineering-System/  # Bob the Builder's reference playbooks
├── AGENTS.md              # Working rules (git workflow, etc.)
├── .env.example           # Full env var reference
├── vercel.json
└── package.json
```

**Design principles**
- 🧍 **Single-owner** — assumes one master user, so features stay radical and opinionated
- 🔥 **Firestore = source of truth** — everything lives in `users/{userId}/...`
- ☁️ **Cloudinary for binaries** — dedup'd via SHA-256, Firestore holds pointers
- 🧩 **Thin routes, fat services** — business logic is unit-testable in `src/services/`
- ⏱️ **Cron-by-call** — GitHub Actions hits authenticated tick endpoints; no always-on process

**Request lifecycle** — every call: `HTTPS + Bearer idToken → CORS/security headers → Firebase token verify → route → service (LLM/storage as needed) → Firestore/Cloudinary → JSON`.

## 🌟 Flagship: Resume Builder & ATS Engine

Complete AI resume production pipeline: scattered raw data in → one-page, ATS-optimized, clickable-link PDF out.

```
Feed (GitHub handle, smart links, base PDF,
      certs vault, resume notes)
   → LLM structuring (strict JSON schema, project preservation,
      personal-vs-client classification, max ATS keywords)
   → Delivery (PDFKit ATS-standard PDF, auto compact single-page,
      clickable hyperlinks, PDF metadata)
   → ATS audit (resumeAnalyzerService: bullet quality, keyword
      coverage, structure; downloadable audit PDF)
```

**Highlights**
- **One sync button** — crawls GitHub repos *and* does deep code inspection: reads `package.json` for real dependencies and full README descriptions (up to 70K chars) without truncation; also crawls pasted links for coding stats/badges
- **Resume Notes ("teach Bob")** — free-text notes as highest-priority instruction, enforced by a deterministic directive engine (`applyResumeNotesDirectives`, 12/12 tested scenarios): move projects to freelance/Experience, replace projects, add certifications, tweak summaries, filter skills
- **Prompt rules Bob lives by** — Hiration/Google-XYZ bullets (active verb → task → outcome), ATS keyword coverage, no invented contacts, clean bullet style, no ending periods, no invented metrics (`X%`/`Y users` placeholders strictly forbidden)
- **Self-audit refinement loop** — audits its own output and runs targeted refinement passes (temp 0.05) before you ever see it
- **Multi-candidate profiles** — profile CRUD for "Build for Friend" with dedup-aware deletion
- **Smart PDF engine** — standard layout, auto-compacts if overflow; clickable clean-label links never overlap the left column; PDF metadata set

**API surface** — `POST /api/resume/generate`, `/download-direct-pdf`, `/analyze`, `/analyze-generated`, `/download-audit-pdf`; `GET` `/profiles` `/profile` `/smart-links`; `POST` `/profile` `/sync/github` `/sync/coding` `/upload/base` `/upload/certificate` `/upload/documents`; `DELETE /api/resume/project/:title`.

## Deep Dives (short versions)

### 🏆 Hackathon Radar & Auto-Discovery
**Discovery:** Google CSE (Devpost/Unstop/Devfolio) → `quickCseFilter` → `llmFilterCse` (relevance scoring) → enrichment (deadline/prize/team/mode) → up to 10 cards, auto-expire.
- Cadence ~4 days (`DISCOVERY_INTERVAL_MS`), 15s per scrape, toggle persists
- `GET /api/live/pulse` → `{totalDiscovered, active, enabled, nextRunAt, lastRunAt}`
- **Tracker + scoped chat:** each hackathon holds `knowledge{summary, dates, prizes, links}`, participation flags, own session; `refreshKnowledge` re-scrapes but protects user-set dates; parses pasted announcements

### 📈 SEO Beast Engine
**Crawl:** sitemap-seeded BFS (12 parallel fetches, 9s each) → every discovered page up to a wall-clock deadline (90s new / 110s re-audit, memory-guarded at 10K pages). Cheerio on-page audit: title/meta/H1, word count, dup detection, thin-content & orphan detection.
**Honest blocked sites:** non-200 homepage → `siteAccessible:false`, zero-fabricated score, no LLM pass, deterministic "fix access first" note. Never scores a 403 page or invents CWV numbers.
**Scoring:** `round((technical + onpage + content + links)/4)`, each capped at 100; mobile PageSpeed + broken-link probe.
**Parallel LLM diagnostics** (`callLLMParallel` → `geminiPoolService.runParallelGemini`): one task per issue category (load-balanced, `concurrencyPerKey=2`), ≤6 merged recommendations; 3-panelist action plan (Executive/Sprint/Architecture → 95/100 target); per-key in-flight + 60s quarantine on 429, model-try chain (`gemma-4-26b-a4b-it` → `gemini-3.6-flash` → `gemini-2.5-flash`), OpenRouter fallback.
**Pump:** `POST /api/seo/pump` runs `processDueReAudits(3)` concurrently, 30-min stall guard, per-site `history{score, delta, at}`.
**Outputs:** action plan, deployable fix plan, self-contained HTML report (incl. crawl line), isolated audit-aware chat.

## Services Reference (key)

| Service | Responsibility |
|---|---|
| `llmService.js` / `geminiPoolService.js` | OpenRouter orchestration + multi-key Gemini pool with parallel dispatch & failover |
| `resumeProfileService.js` / `directPdfResumeService.js` / `resumeAnalyzerService.js` | Profile CRUD + deep GitHub crawler; resume structuring + PDFKit ATS engine; ATS audit |
| `fileService.js` / `documentReaderService.js` / `documentGenerator.js` | Cloudinary + SHA-256 dedup; text extraction; real office-file generation |
| `developerPlatformsService.js` | LeetCode / Codeforces / HackerRank / DEV.to extraction |
| `memoryService.js` / `behaviorEngine.js` / `proactiveAdvisor.js` | Memory pillars; trait detection; proactive notifications |
| `stalkingService.js` / `crawlerService.js` / `repoService.js` | Deep dossiers; generic scraping; GitHub repo reading |
| `builderService.js` (+ knowledge/task) | Bob the Builder persona |
| `selfEditService.js` | Self-edit propose/diff/history |
| `hackathonService.js` / `hackathonDiscoveryService.js` | Hackathon tracker + discovery feeds |
| `seoService.js` | Cap-free parallel crawl + 4-pillar scoring + multi-key LLM analysis |
| `routineService.js` / `schedulerService.js` / `statsService.js` | Routines, cron tasks, usage stats |

## API Endpoints

All `/api/*` routes (except `/api/health` and `/api/config`) require `Authorization: Bearer <firebase-id-token>`.

| Route | Purpose |
|---|---|
| `POST /api/auth/set-password` | Set/reset password for allow-listed email |
| `/api/chat` • `/api/sessions` | LLM chat w/ tool-use + streaming • sessions/history |
| `/api/memory` | CRUD for structured facts/memory |
| `/api/files` | Upload/view/download/delete/generate office files |
| `/api/research` | Crawl & LLM-analyze any URL |
| `/api/secret` | PIN-protected vault |
| `/api/notifications` | Proactive notifications |
| `/api/scheduler` • `/api/routines` | Cron tick + reminders • daily routines |
| `/api/live` | Weather/news/stocks + Hackathon Radar pulse |
| `/api/builder` | Bob the Builder workspace |
| `/api/hackathons` | Tracker + parse/scrape/knowledge/chat |
| `/api/stalking` | Profile list + deep crawl |
| `/api/hq` | Aggregated dashboard summary |
| `/api/self-edit` | Self-edit history/diffs |
| `/api/keys` | Anonymized OpenRouter key health |
| `/api/seo` | SEO audit/action plan/fix plan/report/chat |
| `/api/resume` | AI Resume & ATS Engine (see flagship) |

## Data Model

```
users/{userId}/
├── resume_profile/{profileId}    # personal, education, experience, projects[],
│                                  # skills, codingHandles/stats, certifications[],
│                                  # githubProjects[], smartLinks[], resumeNotes
├── sessions/{sessionId}
├── memory/...                    # 6 memory pillars
├── files/{fileId}                # Cloudinary pointer + SHA-256 hash + metadata
├── routines/...  notifications/...  seo_sites/...
```

## 🚀 Quickstart

```
git clone https://github.com/nikhilrawat2005/BoB.git
cd bob-backend && npm install
cp .env.example .env   # fill Firebase, Cloudinary, OpenRouter (see example)
npm run dev            # or npm start
```

Visit `http://localhost:3000`. Pure-logic services (incl. the offline PDF engine) run fine without Firebase keys in dev.

**Key env vars:** `OPENROUTER_API_KEY1..11`, `WRITER_MODEL`, `REVIEW_MODEL`, `AUDITOR_MODEL`, `VISION_MODEL`, `CHEAP_MODEL`, `GEMINI_API_KEY1+`, `ALLOWED_EMAILS`, `CRON_SECRET`, `SECRET_VAULT_PIN`. See `.env.example` for the full annotated reference.

## 🚢 Deployment (Vercel)

`git push origin main` → import repo in Vercel → copy every `.env` var → deploy → set `CRON_SECRET` in Vercel + GitHub Actions secrets → `tick.yml` calls the scheduler/SEO tick endpoints hourly.

> ⚠️ On serverless, the OpenRouter key pool is per-instance — prefer role-pinned keys (`BOB_API_KEY`, `CENTER_API_KEY`, `BUILDER_API_KEY`) and keep function memory/timeout generous for PDF + LLM calls.

## 🔐 Security Notes

- **Never commit `.env` or service-account JSON** — only `.env.example` placeholders. A leaked key = rotate immediately (Firebase Console → Settings → Service Accounts)
- `ALLOWED_EMAILS` is the single gate for `/api/auth/set-password` — keep tight
- `/api/keys` reports health only, never raw values
- `CRON_SECRET` protects tick endpoints; `SECRET_VAULT_PIN` gates the vault

## 📜 Project Rules

See `AGENTS.md`: commit after every change set → push `origin/main`; never commit `.env` (only `.env.example`); agents read `AI-Website-Engineering-System/` playbooks before building.

---

<div align="center">

**Built for one master user. Engineered like production.**

</div>