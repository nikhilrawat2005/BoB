# CORE-ARCH-001

## Architecture & Dependency System

**Document ID:** CORE-ARCH-001
**Version:** 1.0.0
**Category:** Core System
**Priority:** Highest
**Status:** Production

---

# Chapter 00 — Identity & Purpose

> This document defines the architecture of the AI Website Engineering Operating System. It establishes how engineering documents, industry systems, resource libraries, templates, and project assets are organized, connected, loaded, and managed.

Every AI must use this document to navigate the engineering ecosystem.

CORE-ARCH-001 is the structural counterpart to CORE-AI-001. Where CORE-AI-001 defines *how an AI must think and reason* during engineering work, CORE-ARCH-001 defines *how the System itself is organized* so that reasoning has a stable, navigable substrate to operate on. An AI that reasons correctly (per CORE-AI-001) but consults the wrong document, loads unnecessary context, or fails to respect ownership boundaries will still produce inconsistent or inefficient engineering outcomes. This document exists to eliminate that failure mode.

The architecture defined here is not a filing convention. It is an engineering discipline in its own right: every structural rule in this document — one responsibility per document, strict downward dependency flow, category-based loading — exists to keep the System's own knowledge base as maintainable, scalable, and consistent as the software the System is used to build. In this sense, CORE-ARCH-001 applies the Engineering Principles of CORE-AI-001 Section 0.8 (Maintainability, Scalability, Simplicity, Consistency) reflexively, to the System itself.

---

## 0.1 Mission

**Purpose**

The objective of this document is to create a predictable, modular, and scalable engineering architecture.

**Engineering Overview**

A documentation system that grows without architectural discipline becomes, over time, indistinguishable from an unstructured knowledge dump: rules duplicate across documents, ownership becomes ambiguous, and an AI consulting the System can no longer determine which document is authoritative for a given decision. CORE-ARCH-001's Mission is to prevent this outcome permanently, by defining structural invariants that hold regardless of how large the System eventually grows.

**Every document must have:**

- **One responsibility** — A document governs exactly one coherent domain of engineering concern. A document that governs two unrelated domains (e.g., both frontend component standards and industry-specific compliance rules) violates this invariant and must be split.
- **One owner** — For any given responsibility, exactly one document is authoritative. No responsibility may be co-owned, even partially, by two documents.
- **One purpose** — A document's content must serve its stated purpose exclusively. Content that serves a different purpose, even if topically adjacent, belongs in a different document.
- **One location** — A document occupies a single, fixed position in the Architecture Hierarchy (Section 0.6) and Document Category system (Section 0.7). It is not duplicated or referenced from multiple structural locations.

**Engineering Principles**

These four invariants — responsibility, ownership, purpose, location — are mutually reinforcing. Violating any one tends to produce violations of the others: a document with two responsibilities (violating "one responsibility") will tend to develop ambiguous ownership over its secondary responsibility (violating "one owner"), which in turn causes an AI navigating the System to be uncertain where to place its trust (violating predictable "one location" navigation).

**Validation**

Before a new document is introduced into the System, or an existing document is materially expanded, it should be tested against all four invariants: Can its responsibility be stated in a single sentence? Is there any other document that could plausibly claim ownership of the same content? Does every section serve the stated purpose? Does it belong at exactly one point in the hierarchy?

**Failure Conditions**

- A document whose responsibility requires a compound sentence to describe ("this document governs both X and Y") is a structural violation.
- Two documents that could both reasonably be consulted for the same rule indicate an ownership failure requiring resolution per Section 0.8.
- Content included because it is "related" rather than because it serves the document's stated purpose is scope creep and must be relocated.

---

## 0.2 Primary Objective

**Purpose**

To define the measurable architectural outcomes this document's rules must produce.

**Engineering Overview**

**The architecture must ensure:**

- **Clear document ownership** — At any point, an AI or human engineer can identify, without ambiguity, which single document governs a given rule or decision.
- **No duplicated responsibilities** — No engineering rule, standard, or piece of domain knowledge is authored in more than one location. Duplication is treated as a defect, not a redundancy safeguard, because duplicated content inevitably drifts out of sync over time.
- **Modular expansion** — New capability (new industries, new engineering domains, new resource libraries) can be added by introducing new documents that register into the existing hierarchy, without modifying the structural rules themselves.
- **Efficient context loading** — An AI operating on a given task loads only the documents relevant to that task's Category classification (Section 0.7), rather than the entire System, preserving reasoning efficiency and avoiding irrelevant context dilution.
- **Predictable document navigation** — Given a described engineering problem, the correct document to consult can be determined algorithmically from the Architecture Hierarchy and Category system, without requiring institutional memory or guesswork.
- **Long-term maintainability** — The System's own documentation can be revised, extended, and audited over time without the structural integrity established in Chapter 00 degrading.

**Decision Logic**

Each of these six outcomes functions as an acceptance criterion for any architectural decision. A proposed change to the System's structure — for example, introducing a new document category, or altering the hierarchy — must be evaluated against all six before adoption. A change that improves one outcome while degrading another (e.g., a shortcut that improves loading efficiency but obscures ownership clarity) requires explicit justification and, where material, escalation per CORE-GOV-001.

**Success Criteria**

The architecture is functioning correctly if a new engineering document can be added to the System by any contributor, following the rules of this document alone, and the result integrates without requiring modification to any existing document's content.

---

## 0.3 Scope

**Purpose**

To define the specific structural domains this document governs.

**Engineering Overview**

**This specification governs:**

- **Folder Architecture** — The physical or logical organization of the System's document store, including the top-level category directories referenced in Section 0.6 (`00_Core` through `05_Project_Output`).
- **Document Categories** — The classification system (Category A through F, Section 0.7) that determines loading behavior and authority scope for every document in the System.
- **Document Hierarchy** — The vertical authority ordering from Master Prompt down to Project Output (Section 0.6), which determines precedence when documents interact.
- **Dependency Rules** — The constraints on which documents may reference or rely upon which other documents (Section 0.9), ensuring the System remains acyclic and predictable.
- **Ownership Rules** — The mechanism by which responsibility conflicts are identified and resolved (Section 0.8).
- **Loading Strategy** — The operational rules governing which documents an AI instance loads into active context for a given task, based on Category classification.
- **Cross References** — The permitted mechanisms by which one document may refer to another without violating the one-owner, one-location invariants of Section 0.1.
- **Expansion Rules** — The process by which new documents, categories, or hierarchy levels may be introduced as the System grows (Section 0.10).

**Dependencies**

This Scope section defines the structural domains; it does not itself define their content. Sections 0.6 through 0.10 of this chapter provide that content. Where a structural question arises that does not clearly map to one of the eight domains above, it should be treated as out of this document's scope and referred to CORE-GOV-001 for governance resolution.

---

## 0.4 Out of Scope

**Purpose**

To exclude engineering and domain content from this document, preserving its purely structural character.

**Engineering Overview**

**This document does not define:**

- **Engineering Logic** — The reasoning lifecycle and decision-making discipline an AI must follow is governed by CORE-AI-001, not by this document. CORE-ARCH-001 defines *where* rules live; CORE-AI-001 defines *how* an AI reasons using them.
- **UI Rules** — Interface composition standards belong to dedicated UI engineering documents residing within `01_Engineering_Systems`.
- **UX Rules** — Interaction and usability standards belong to dedicated UX engineering documents, similarly located within `01_Engineering_Systems`.
- **Frontend Standards** — Client-side technical conventions are content owned by frontend Engineering System documents, not by this architectural specification.
- **Backend Standards** — Server-side technical conventions are content owned by backend Engineering System documents.
- **Industry Knowledge** — Domain-specific rules (healthcare, e-commerce, travel, etc.) are owned by Industry System documents within `02_Industry_Systems`.
- **Resource Content** — Design tokens, color systems, and typography pairings are owned by Resource Library documents within `03_Resource_Libraries`.

**Those belong to their respective systems.**

**Engineering Notes**

This exclusion list mirrors, at the architectural layer, the same discipline CORE-AI-001 Section 0.4 applies at the behavioral layer. The two documents are structurally parallel by design: CORE-AI-001 excludes technical content because it governs reasoning, and CORE-ARCH-001 excludes technical content because it governs organization. Neither document should ever contain a UI rule, a backend convention, or a piece of industry knowledge — such content appearing in either document is a direct violation of the one-responsibility invariant (Section 0.1) and must be relocated to its owning system.

**Constraint**

An AI that identifies a technical or domain question while consulting this document must not attempt to answer it here. It must instead use the Architecture Hierarchy (Section 0.6) and Document Categories (Section 0.7) defined in this document to locate the correct owning document, and consult that document directly.

---

## 0.5 Core Philosophy

**Purpose**

To state the minimal structural principle from which all subsequent rules in this document are derived.

**Engineering Overview**

Every document should exist for one engineering purpose.

Every engineering purpose should have one owner.

Every owner should have one source of truth.

**Core Concepts**

This three-statement chain is the architectural equivalent of CORE-AI-001's Core Philosophy (Section 0.5 of that document). Where CORE-AI-001's philosophy is a *sequence* (Understand → Deliver), CORE-ARCH-001's philosophy is a *chain of identity* (purpose → owner → source of truth). Each link in the chain constrains the next:

1. A document's existence is justified only by a single, well-defined engineering purpose. A document without a clear purpose should not exist; a document whose purpose can be described only vaguely is a candidate for restructuring.
2. Once a purpose is established, exactly one document owns it. Ownership is not shared, not partial, and not contextual — it does not vary based on which AI instance or which project is asking.
3. The owning document is, by definition, the single source of truth for its purpose. Any other document, resource, or AI-generated inference that contradicts the owning document is incorrect by construction, not by degree.

**Decision Logic**

When evaluating whether new content belongs in an existing document or requires a new one, the test is: does this content share the same purpose as the target document? If yes, and the target document is the established owner of that purpose, the content belongs there. If the content serves a distinct purpose, even a closely related one, a new document — or a new section within a more appropriate existing document — is required.

**Engineering Notes**

This philosophy is intentionally minimal. Its brevity is itself an architectural choice: a foundational philosophy statement that is easy to hold in mind is more likely to be consistently applied than an elaborate one. All of the more detailed mechanics in Sections 0.6 through 0.10 are elaborations of this three-statement chain, not additions to it.

---

## 0.6 Architecture Hierarchy

**Purpose**

To define the vertical authority and loading order of the System's document layers.

**Engineering Overview**

```
Master Prompt
     ↓
00_Core
     ↓
01_Engineering_Systems
     ↓
02_Industry_Systems
     ↓
03_Resource_Libraries
     ↓
04_Templates
     ↓
05_Project_Output
```

**Never bypass hierarchy.**

**Layer Definitions**

- **Master Prompt** — The System's highest authority, governing identity and operating boundaries above all engineering concerns. Referenced but not owned by this document (see CORE-AI-001 Section 0.9 for its role in the decision hierarchy).
- **00_Core** — The Core System documents (CORE-AI-001, CORE-ARCH-001, CORE-GOV-001, CORE-QUALITY-001, CORE-WORKFLOW-001). Always authoritative, System-wide, and always loaded regardless of project type (Category A, Section 0.7).
- **01_Engineering_Systems** — Technical domain specifications (frontend, backend, infrastructure, etc.) that implement Core System principles. Loaded when the task's technical domain requires them.
- **02_Industry_Systems** — Domain-specific rule sets applicable when a project belongs to a recognized industry category. Loaded based on Project Profile classification.
- **03_Resource_Libraries** — Reusable design and content assets (color systems, typography, component libraries). Loaded on demand during execution.
- **04_Templates** — Pre-built structural starting points for common project types. Loaded specifically during generation stages.
- **05_Project_Output** — The generated, project-specific artifacts produced by executing the System against a real engagement. This layer is generated, not authored; it depends on all layers above it but is depended upon by none.

**Rules**

1. Each layer may depend only on layers above it in the hierarchy (i.e., depend downward toward more foundational layers — see Section 0.9 for the precise direction convention).
2. No layer may be skipped when resolving a rule: an AI may not consult `02_Industry_Systems` for a rule that `00_Core` already governs, even if the industry document happens to restate it, because doing so risks drift between the two.
3. `05_Project_Output` is a terminal layer. Nothing in the System depends on generated project output; it is the hierarchy's product, not one of its structural components.

**Engineering Notes**

This hierarchy is the physical/organizational realization of CORE-AI-001's Single Source of Truth tiers (CORE-AI-001 Section 0.9). The two enumerations are intentionally aligned: Master Prompt, Core Systems, Engineering Systems, Industry Systems, and Resource Libraries appear in both documents in matching relative order, because CORE-AI-001 defines authority for decision-making and CORE-ARCH-001 defines the structural layer that authority lives in. `04_Templates` and `05_Project_Output` are architecture-specific extensions, since CORE-AI-001's decision hierarchy does not need to address generated output directly.

---

## 0.7 Document Categories

**Purpose**

To define the classification system that determines how and when each document in the System is loaded into active AI context.

**Engineering Overview**

| Category | Type | Loading Behavior |
|---|---|---|
| A | Core System | Always Loaded |
| B | Engineering System | Load When Required |
| C | Industry System | Load Based On Project |
| D | Resource Library | Load On Demand |
| E | Template | Load During Generation |
| F | Project Assets | Generated During Execution |

**Category Definitions**

- **Category A — Core System, Always Loaded.** These documents (Chapter 00 of CORE-AI-001, CORE-ARCH-001, and their peer Core documents) form the non-negotiable baseline context for every AI operating in the System, regardless of task. They are loaded unconditionally at the start of any engagement.
- **Category B — Engineering System, Load When Required.** Technical domain documents are loaded only when the task at hand engages that domain. A task involving no backend work does not require backend Engineering System documents to be loaded, preserving context efficiency.
- **Category C — Industry System, Load Based On Project.** These documents are loaded based on the Project Profile's declared or inferred industry classification (see CORE-AI-001 Section 0.9). A travel-industry project loads travel Industry System documents; an unrelated industry's documents remain unloaded.
- **Category D — Resource Library, Load On Demand.** Design and content resources are loaded at the specific point of execution where they are needed (e.g., a color palette resource loaded only when a visual design decision is actively being made), rather than held in context throughout the engagement.
- **Category E — Template, Load During Generation.** Templates are loaded specifically during the Execute stage of the CORE-AI-001 lifecycle (CORE-AI-001 Section 0.5), when a structural starting point is being instantiated, and are not relevant context outside that stage.
- **Category F — Project Assets, Generated During Execution.** These are not pre-authored documents at all; they are the output artifacts produced by the System acting on a specific project. They are written, not loaded, and become part of the Project Profile once created.

**Validation**

Every document in the System must be assigned exactly one Category. A document with ambiguous category membership (e.g., content that is partly always-relevant and partly domain-specific) violates the one-responsibility invariant (Section 0.1) and should be split along category lines.

**Engineering Notes**

The Category system exists to solve a concrete efficiency and correctness problem: an AI instance with unlimited context could, in principle, load the entire System for every task, but doing so dilutes relevant signal, increases the risk of applying inapplicable rules, and does not scale as the System grows. Category-based loading ensures that context scales with task relevance, not with total System size.

---

## 0.8 Responsibility Rule

**Purpose**

To define the mechanism for detecting and resolving duplicate ownership within the System.

**Engineering Overview**

Every responsibility belongs to exactly one document.

No duplicate ownership is allowed.

If duplication exists, the owner document becomes the source of truth.

**Rules**

1. **Single ownership is the default state.** When a new responsibility is identified — a new rule, standard, or domain of knowledge — it must be assigned to exactly one document before being authored anywhere.
2. **Duplication is a defect, not a feature.** If, through independent authoring or System growth, the same responsibility is found expressed in two documents, this is treated as an error requiring correction, not as helpful redundancy.
3. **Resolution favors the established owner.** When duplication is discovered, the document with the more specific, more original, or more structurally appropriate claim to the responsibility (per Section 0.6's hierarchy and Section 0.7's category system) becomes the sole source of truth. The duplicate content is removed from the non-owning document, which may retain a cross-reference (Section 0.3) pointing to the owner instead.

**Decision Logic**

When two documents appear to address the same responsibility, ownership is resolved by hierarchy position first (a `00_Core` document outranks a `01_Engineering_Systems` document for any responsibility both address) and by specificity second (a document whose stated purpose more precisely matches the responsibility in question outranks a more general document at the same hierarchy level).

**Failure Conditions**

- Two documents at the same hierarchy level both claiming authority over the same rule with no resolution recorded.
- A lower-hierarchy document restating, rather than referencing, a rule owned by a higher-hierarchy document — this is a duplication risk even when the restated content currently matches, since the two copies can drift independently over time.
- A responsibility with no identifiable owning document at all, discovered only when an AI cannot determine which document governs a needed rule.

**Engineering Notes**

This rule operationalizes the "one owner" clause of the Core Philosophy (Section 0.5). It is the mechanism CORE-GOV-001 invokes when a governance review surfaces a structural conflict between two documents' content.

---

## 0.9 Document Dependency

**Purpose**

To define the permitted direction of reference between documents, ensuring the System remains free of circular or unpredictable dependencies.

**Engineering Overview**

Documents may depend on lower-level systems.

Lower-level systems must never depend on higher-level systems.

Dependencies must always flow downward.

**Core Concepts**

"Downward" in this context refers to movement from more foundational, System-wide layers toward more specific, contextual layers, following the Architecture Hierarchy order in Section 0.6: Master Prompt → `00_Core` → `01_Engineering_Systems` → `02_Industry_Systems` → `03_Resource_Libraries` → `04_Templates` → `05_Project_Output`. A document at a given layer may reference and rely upon documents at the same or higher (more foundational) layers, but never upon documents at a lower (more specific) layer.

**Rules**

1. A Core System document (`00_Core`) may not depend on an Engineering System document (`01_Engineering_Systems`), an Industry System document, a Resource Library, a Template, or Project Output. Core documents must remain self-contained relative to everything below them in the hierarchy.
2. An Engineering System document may depend on Core System documents but not on Industry System documents, Resource Libraries, Templates, or Project Output.
3. An Industry System document may depend on both Core and Engineering System documents but not on Resource Libraries, Templates, or Project Output.
4. This pattern continues down the hierarchy: each layer may depend on any layer above it, and no layer below it.
5. `05_Project_Output`, as the terminal layer (Section 0.6), may depend on any and all layers above it, since it is the generated product of the entire System acting in concert.

**Decision Logic**

Before authoring a cross-reference from one document to another, the AI must confirm the referenced document sits at the same or a higher hierarchy layer. A reference in the opposite direction is a dependency violation and must be restructured — typically by relocating the shared content to a layer both documents can depend on, per the Responsibility Rule (Section 0.8).

**Constraints**

- This rule guarantees the System's dependency graph is acyclic by construction, since no reference can ever point downward, making circular dependency structurally impossible rather than merely discouraged.
- Violations of this rule are treated as architectural defects of equal severity to a duplicated responsibility (Section 0.8), because both produce the same failure mode: unpredictable, non-authoritative document resolution.

**Engineering Notes**

This downward-only dependency rule is what allows `00_Core` documents — including this one and CORE-AI-001 — to remain stable even as the System's Engineering, Industry, and Resource layers expand extensively. Because nothing above depends on anything below, growth at the lower layers can never force revision at the Core layer, directly supporting the Long-Term Philosophy in Section 0.10.

---

## 0.10 Long-Term Philosophy

**Purpose**

To define the standard by which the System's architectural growth over time should be judged.

**Engineering Overview**

The architecture must support unlimited expansion.

Adding new industries, engineering systems, resources, or templates must never require restructuring the core architecture.

**Only register new modules.**

**Core Concepts**

This section defines the System's scalability contract at the architectural level, complementing CORE-AI-001's Long-Term Philosophy (CORE-AI-001 Section 0.10), which addresses scalability of reasoning quality. Here, the concern is scalability of structure: as the System accumulates more Engineering Systems, more Industry Systems, more Resource Libraries, and more Templates, the foundational layers — Master Prompt and `00_Core` — must remain untouched.

**Engineering Principles**

- **Expansion by registration, not by restructuring.** A new industry system is added by creating a new document within `02_Industry_Systems` and registering it into the Category C loading logic (Section 0.7). It does not require modifying `00_Core`, `01_Engineering_Systems`, or the Architecture Hierarchy itself.
- **Downward-only dependency (Section 0.9) is what makes registration-only expansion possible.** Because lower layers can never be depended upon by higher layers, adding a new lower-layer document can never introduce a dependency that higher layers must account for.
- **One responsibility, one owner (Section 0.1, 0.5) prevents redundant modules.** Before registering a new module, its responsibility must be confirmed as genuinely novel — not already owned by an existing document — per the Responsibility Rule (Section 0.8).

**Future Scalability**

As the AI Website Engineering Operating System is extended with additional industries, technical domains, or resource categories, each addition should be validated against three tests before registration:

1. Does this module have a single, clearly stated responsibility not already owned elsewhere?
2. Does this module depend only on layers at or above its own position in the Architecture Hierarchy?
3. Does registering this module require any change to `00_Core` or the Master Prompt? If yes, the proposed module is not a simple registration and must be evaluated as a structural revision under CORE-GOV-001 rather than treated as routine expansion.

**Success Criteria**

The architecture's long-term health is measured by the ratio of new capability introduced through module registration versus capability introduced through Core document modification. A healthy System approaches an asymptote where `00_Core` modification frequency trends toward zero even as total System capability continues to grow.

**Engineering Notes**

This section closes the architectural chapter by tying together every preceding rule: the Category system (0.7) defines what gets registered where, the Responsibility Rule (0.8) prevents duplicate registration, the Dependency Rule (0.9) guarantees registration never destabilizes the foundation, and this section states the resulting growth model explicitly. Any future architectural proposal should be tested against this section before being adopted into the System.

---

# End of Chapter 00
