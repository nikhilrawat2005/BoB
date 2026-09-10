# Autonomous AI Website Tester — Final Plan

## 1. Goal

Given a URL, explore the site like a real human tester (real browser, no source
code access), figure out what the site *claims* to do and what it *should* do
for a user, then compare that against what it *actually* does — catching
functional bugs, UX/visual issues, cross-page content inconsistencies, and
false/unverified marketing claims ("AI-powered", "personalized", etc.) — and
produce an evidence-based report, not just a bug list.

---

## 2. What already exists in Bob vs what's new

| Piece | Status | Notes |
|---|---|---|
| `geminiPoolService.js` (11 keys) | **Reused as-is** | Scale/triage LLM calls |
| `llmService.js` builder bucket (19 OpenRouter keys, incl. Claude) | **Reused as-is** | Deep-reasoning LLM calls |
| `documentGenerator.js` → `generatePdf` | **Reused as-is** | Report PDF export |
| `fileService.js` | **Reused as-is** | Store screenshots + generated reports |
| `schedulerService.js` (`createTask`, `tick`) | **Reused as pattern** | Async job lifecycle for a test run |
| `crawlerService.js` (cheerio, static HTML) | **NOT reused/modified** | 5 other services depend on it (`seoService`, `stalkingService`, `hackathonService`, `routes/research`, `routes/chat`) — too risky to touch, and wrong tool anyway (no JS execution, no network layer visibility) |
| Browser automation | **New dependency: Playwright** | Nothing in current stack (`cheerio`, no puppeteer/playwright) can do real interaction, JS rendering, or network interception |
| `websiteTesterService.js` | **New file** | Core orchestration |
| `routes/websiteTester.js` (or nested under builder routes) | **New file** | Thin route layer |
| HQ integration | **New, small** | Shown as a card **under Builder** in HQ, not a fully separate top-level card |

**Governing principle:** upgrade existing services only where it makes them
strictly better; if an upgrade risks breaking current working behavior,
build a separate, isolated implementation instead of touching the original.

---

## 3. Why "crawler" ≠ this tool

`crawlerService.js` only fetches static HTML — no JS execution, no clicks, no
forms, no visibility into API/backend calls. It's fine for link/metadata
extraction (SEO, profile scraping) but useless for testing.

This tool needs a **real browser** (Playwright) so that when it clicks a
button or submits a form, it can observe:
- The resulting DOM/visual change (frontend correctness)
- The actual network request(s) fired to the backend — URL, payload, response
  status, response body, timing, errors (backend correctness, as a black box)

This means backend problems get caught **without ever reading backend source
code** — evidence is the request/response pair itself, reported as
"backend/API issue suspected" rather than a root-cause claim.

---

## 4. Pipeline

### Phase 1 — Discovery (new, isolated, Playwright-based)
- Crawl the site building a navigation map.
- Capture **both** visible clickable elements **and** DOM-present-but-hidden
  links/routes (collapsed menus, conditionally rendered nav, etc.) for max
  coverage.
- No fixed page/depth limit — mirror the pattern already used in
  `seoService.js`: a high safety cap (e.g. 10,000) + a wall-clock crawl
  deadline, not an arbitrary page count.

### Phase 2 — Purpose inference (Gemini)
- Read homepage/key pages to infer: site's actual purpose, stated features,
  expected user journeys, and any claims made ("AI-powered", "personalized",
  "real-time", "smart", "automated", etc.).

### Phase 3 — Sequential exploration & testing (Playwright)
- One page/flow at a time — deliberately **not parallel** at the browser
  level. This isn't a daily-run tool; output quality matters more than speed,
  and sequential execution keeps state simple and makes it easy to trace
  exactly which action caused which console/network event.
- Per page/flow: happy-path actions, plus invalid/empty/boundary inputs,
  repeated actions, back/refresh, multiple viewports.
- Capture per action: screenshot, console logs, network requests/responses,
  timing, accessibility signals.

### Phase 4 — Triage (Gemini, scale)
- Bulk pass over all captured screenshots/DOM snapshots.
- Flags: duplicate images, layout/alignment issues, inconsistent
  design/fonts, empty/unbalanced sections, responsive issues, unclear CTAs,
  cross-page content inconsistencies (pricing mismatches, missing sections,
  repeated blog/image content).

### Phase 5 — Deep verification (Claude, via builder/OpenRouter bucket)
- For claims ("AI-powered", "personalized", etc.): design controlled
  experiments (vary inputs, compare outputs) to verify or refute them.
- Root-cause reasoning on everything Phase 4 flagged.
- Assign severity + confidence, separate into:
  **confirmed issues / likely issues / UX observations / capability-verification results.**

### Phase 6 — Report assembly
- Structured findings, each with: URL, action performed, expected result,
  actual result, evidence (screenshot), category, severity, confidence.
- Output: HQ card (summary/status) + in-app detailed view + PDF export
  (via `documentGenerator.generatePdf`) + stored via `fileService`.
- **Web app only for now — no mobile app version.**

---

## 5. LLM key strategy

- Two existing pools reused, no new key infra:
  - **Gemini pool** (11 keys) — scale work: bulk screenshot/DOM triage.
  - **Builder/OpenRouter pool** (19 keys, includes Claude access) — deep
    reasoning: claim verification, root-cause analysis, report synthesis.
- **Parallelism is at the LLM-call level, not the browser level:** work in
  teams of **4 keys at a time** rather than one key per call — split across
  both buckets (e.g. 2 Gemini + 2 builder, or whichever split performs best
  in practice) to get speed on the LLM side without sacrificing output
  quality, while the actual browser exploration stays sequential.

---

## 6. Open items (deliberately deferred)

- **Auth/login-gated flows**: not yet decided how to handle. V1 plan is to
  scope to public/guest-accessible flows only, revisit auth as a phase 2
  once the core loop is working.

---

## 7. New files/deps summary

- `src/services/websiteTesterService.js` — new
- `src/routes/websiteTester.js` (or folded into builder routes) — new
- Small addition to `hq.js` (or builder's card logic) for the summary card
- New npm dependency: `playwright`
