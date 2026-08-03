# Metadata

* **Document ID:** TEMPLATE-MASTER-PROMPT-001
* **Version:** 1.0.0
* **Category:** Template — Output Generation
* **Status:** Complete
* **Dependencies:** TEMPLATE-PROJECT-BRIEF-001, TEMPLATE-PROGRESS-REPORT-001
* **Scope:** The template used to generate the Master Prompt — the single prompt a user pastes into any AI coding tool (Claude Code, Cursor, etc.) to begin and later resume building their project
* **Last Updated:** 2026-07-31

---

# Purpose

This is the most operationally important file in the entire generated package. It is designed to work in **two distinct modes** — a first-run "start building" mode, and a "resume after context reset" mode — because a single AI coding session will rarely span an entire project. The user should never have to write their own resume instructions; this template gives them one prompt that adapts to either situation.

---

# TEMPLATE START — Copy everything below this line into the generated `MASTER-PROMPT.md`

```markdown
# Master Prompt for {{PROJECT_NAME}}

Paste the text below into your AI coding tool (Claude Code, Cursor, or any other AI-assisted coding environment) to begin or resume this project.

---

## PROMPT TO PASTE:

You are building "{{PROJECT_NAME}}." Before writing any code, read these files in this exact order:

1. `PROJECT-BRIEF.md` — what this project is, its scope, and its design/technical direction.
2. `WORKFLOW-RULES.md` — the engineering rules you must follow throughout this build.
3. `PROGRESS-REPORT.md` — if this file exists and has content, it tells you what has already been built and what remains. If it does not exist yet, this is a fresh start.

**If `PROGRESS-REPORT.md` does not exist or is empty (fresh start):**
- Create `PROGRESS-REPORT.md` now.
- In it, break down the full build into a checklist of concrete steps, derived from `PROJECT-BRIEF.md`'s feature list and `WORKFLOW-RULES.md`'s process.
- Mark every step as "Pending."
- Begin work on the first step.

**If `PROGRESS-REPORT.md` already has content (resuming):**
- Read it fully before doing anything else.
- Identify the first step marked "In Progress" or the first "Pending" step after the last "Completed" one.
- Continue from exactly that point. Do not restart or redo completed work unless `PROGRESS-REPORT.md` explicitly notes a problem with it.

**As you work, after completing any meaningful unit of work (a feature, a component, a fix):**
- Update `PROGRESS-REPORT.md` immediately: mark the relevant step "Completed," add a one-line note on what was done and any decisions made, and update the "Next Step" pointer at the top of the file.
- Do this before moving to the next step, not in a batch at the end of the session.

**If you reach the end of your context window or need to hand off to a new session:**
- Ensure `PROGRESS-REPORT.md` is fully up to date first.
- The user will start a new session with a short resume prompt (see below) — you do not need to do anything else to prepare for this.

**Throughout the build, follow every rule in `WORKFLOW-RULES.md` without exception**, including its quality, architecture, and documentation standards.

---

## RESUME PROMPT (use this in any new session after the first):

Read `PROGRESS-REPORT.md` and `WORKFLOW-RULES.md`, then continue building {{PROJECT_NAME}} from exactly where the progress report leaves off.
```

# TEMPLATE END

---

# Fill-Instructions

| Placeholder | Source |
| :--- | :--- |
| `{{PROJECT_NAME}}` | From `PROJECT-BRIEF.md`, Section 1 |

This template requires almost no per-project customization beyond the project name — its power is in being a **generic, reusable resume mechanism** that works identically regardless of what's being built, because all the project-specific detail lives in `PROJECT-BRIEF.md` and `WORKFLOW-RULES.md`, which the prompt simply instructs the AI to read.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-31 | Doc Architect | Initial creation of the Master Prompt template, covering both fresh-start and resume-after-reset modes. |
