# Metadata

* **Document ID:** TEMPLATE-PROJECT-BRIEF-001
* **Version:** 1.0.0
* **Category:** Template — Output Generation
* **Status:** Complete
* **Dependencies:** 02_Industry_Systems/*.md, 03_Resource_Libraries/*.md
* **Scope:** The template used to generate a user-facing Project Brief — the first file in every generated MD pack, summarizing the discovery conversation into a single reference document
* **Last Updated:** 2026-07-31

---

# Purpose

This is the template the system fills in after a discovery conversation with a user, to produce `PROJECT-BRIEF.md` — the first file in their generated package. It gives both the user and any AI coding tool they use a single, complete snapshot of what's being built and why, so nothing discussed in discovery gets lost once the user moves into an AI coding tool.

**How this is used:** every `{{PLACEHOLDER}}` below is filled from the discovery conversation. Sections marked *(if applicable)* are omitted entirely if not relevant to the project rather than left as empty headers.

---

# TEMPLATE START — Copy everything below this line into the generated `PROJECT-BRIEF.md`

```markdown
# Project Brief: {{PROJECT_NAME}}

*Generated on {{DATE}} from a discovery conversation. This document is the source of truth for what this project is — refer back to it whenever scope or direction is unclear.*

---

## 1. What This Project Is

**One-line summary:** {{ONE_LINE_SUMMARY}}

**Industry category:** {{INDUSTRY_CATEGORY}} (governed by `{{INDUSTRY_SYSTEMS_FILE}}`)

**Primary goal:** {{PRIMARY_CONVERSION_GOAL}}

**Target audience:** {{TARGET_AUDIENCE}}

---

## 2. Scope

**In scope for this build:**
{{IN_SCOPE_LIST}}

**Explicitly out of scope (for now):**
{{OUT_OF_SCOPE_LIST}}

---

## 3. Core Features (from Industry Systems MVP Baseline)

**Must-have (non-negotiable):**
{{MUST_HAVE_FEATURES}}

**Phase 2 (later, not in initial build):**
{{PHASE_2_FEATURES}}

---

## 4. Design Direction

**Color palette:** {{COLOR_OPTION_NAME}} ({{COLOR_HEX_LIST}}) — from `color-palette-guide.md`, Section {{COLOR_SECTION}}

**Font pairing:** {{FONT_PAIRING_NAME}} — from `font-pairing-guide.md`, Section {{FONT_SECTION}}

**Overall mood/tone:** {{DESIGN_MOOD_DESCRIPTION}}

---

## 5. Technical Direction

**Recommended platform stack** (from `platform-stack-guide.md`, selected for this project's context):

| Function | Chosen Platform | Reason |
| :--- | :--- | :--- |
{{PLATFORM_STACK_TABLE_ROWS}}

**Key data entities for this project** (from the applicable Industry Systems file, Module 2):
{{DATA_ENTITIES_SUMMARY}}

---

## 6. Discovery Notes

{{ADDITIONAL_CONTEXT_FROM_DISCOVERY_CONVERSATION}}

---

## 7. What's in This Package

This brief is accompanied by:
- `MASTER-PROMPT.md` — paste this into your AI coding tool to begin building
- `WORKFLOW-RULES.md` — the engineering rules the AI should follow throughout the build
- `PROGRESS-REPORT.md` — created automatically once building starts, tracks what's done and what's next
```

# TEMPLATE END

---

# Fill-Instructions for Each Placeholder

| Placeholder | Source |
| :--- | :--- |
| `{{PROJECT_NAME}}` | User-provided during discovery |
| `{{ONE_LINE_SUMMARY}}` | Synthesized from discovery answers |
| `{{INDUSTRY_CATEGORY}}` / `{{INDUSTRY_SYSTEMS_FILE}}` | Looked up via `field-taxonomy.md` based on the user's stated field |
| `{{PRIMARY_CONVERSION_GOAL}}` | From the applicable Industry Systems file, Module 1 |
| `{{MUST_HAVE_FEATURES}}` / `{{PHASE_2_FEATURES}}` | From the applicable Industry Systems file, Module 3, filtered by what the user confirmed they need |
| `{{COLOR_OPTION_NAME}}` / `{{FONT_PAIRING_NAME}}` | From the user's selection among options mapped in `field-taxonomy.md` |
| `{{PLATFORM_STACK_TABLE_ROWS}}` | From `platform-stack-guide.md`, one row per function relevant to this project |
| `{{DATA_ENTITIES_SUMMARY}}` | From the applicable Industry Systems file, Module 2 |

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-31 | Doc Architect | Initial creation of the Project Brief template. |
