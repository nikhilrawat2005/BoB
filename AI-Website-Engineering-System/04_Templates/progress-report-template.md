# Metadata

* **Document ID:** TEMPLATE-PROGRESS-REPORT-001
* **Version:** 1.0.0
* **Category:** Template — Output Generation
* **Status:** Complete
* **Dependencies:** TEMPLATE-PROJECT-BRIEF-001, TEMPLATE-MASTER-PROMPT-001
* **Scope:** The template an AI coding tool creates and continuously updates during a build — the persistent memory mechanism that allows work to resume correctly across multiple, separate AI sessions
* **Last Updated:** 2026-07-31

---

# Purpose

This file does not get pre-filled by the discovery system the way `PROJECT-BRIEF.md` does — it starts as this empty skeleton, and the AI coding tool (per the instructions in `MASTER-PROMPT.md`) creates and updates it live during the build itself. It is included here as a template so that every project's progress report has the same predictable structure, which is what makes the Master Prompt's resume logic reliable regardless of which AI tool or session is reading it.

---

# TEMPLATE START — This is the skeleton an AI coding tool should create as `PROGRESS-REPORT.md` at the start of a build

```markdown
# Progress Report: {{PROJECT_NAME}}

**Last updated:** {{TIMESTAMP}}
**Next step:** {{NEXT_STEP_DESCRIPTION}}

---

## Build Checklist

- [ ] {{STEP_1_DESCRIPTION}}
- [ ] {{STEP_2_DESCRIPTION}}
- [ ] {{STEP_3_DESCRIPTION}}
- [ ] ...continue for every step derived from PROJECT-BRIEF.md's feature list...

*(Each item's status: Pending → In Progress → Completed. Mark exactly one item "In Progress" at a time — never leave the current step ambiguous.)*

---

## Completed Steps Log

*(Append one entry per completed step, most recent last. Never delete prior entries — this log is the project's build history.)*

### {{STEP_DESCRIPTION}} — Completed {{TIMESTAMP}}
{{ONE_TO_THREE_LINES_ON_WHAT_WAS_DONE_AND_ANY_NOTABLE_DECISIONS}}

---

## Open Issues / Known Gaps

*(Anything flagged but not yet resolved — a workaround used that should be revisited, a decision deferred, a bug noted but not yet fixed.)*

- {{ISSUE_DESCRIPTION}} — noted {{TIMESTAMP}}

---

## Decisions Made During Build

*(Any decision made during the build that wasn't already specified in PROJECT-BRIEF.md — e.g., a specific library choice, a naming convention, a scope clarification. This prevents the same decision being re-litigated or contradicted in a future session.)*

- {{DECISION_DESCRIPTION}} — decided {{TIMESTAMP}}, reason: {{REASON}}
```

# TEMPLATE END

---

# Rules for How This File Must Be Maintained (for the AI building the project)

1. **Update immediately after each completed unit of work** — not in a batch at session end. A session can end unexpectedly (context limit, connection loss); the report must always reflect true current state.
2. **Never mark something "Completed" that wasn't actually finished and verified** — an inaccurate progress report is worse than an outdated one, since it causes a future session to skip work that still needs doing.
3. **Keep exactly one item "In Progress" at a time** — this is what lets a resuming session find its exact starting point without ambiguity.
4. **Never delete the Completed Steps Log** — it is the project's audit trail and helps a future session understand *why* something was built a certain way, not just *that* it was built.
5. **Log every deviation from `PROJECT-BRIEF.md`** in the Decisions Made section — if a build decision diverges from what was originally planned, record it here so it isn't silently lost or later contradicted.

---

# Fill-Instructions

Unlike the other two templates, this one is **not filled by the discovery system** — it is filled live, incrementally, by the AI coding tool during the actual build, following `MASTER-PROMPT.md`'s instructions. The placeholders above describe what each AI-generated entry should contain, not values supplied in advance.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-31 | Doc Architect | Initial creation of the Progress Report template and its maintenance rules. |
