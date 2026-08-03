# Metadata

- **Document ID:** CORE-DESIGN-001
- **Version:** 1.0.0
- **Category:** Engineering System
- **Status:** Active
- **Dependencies:**
  - CORE-ARCH-001 (Architecture Engineering System)
  - CORE-CONTEXT-001 (Context Engineering System)
  - CORE-QUALITY-001 (Quality Engineering System)
  - CORE-AI-001 (AI Engineering System)
- **Scope:** UI Design, UX Design, Visual Systems, Design Principles, Design Systems, Accessibility, Layout, Typography, Color Theory, Motion Design, User Psychology, Design Workflow, Component Systems, Responsive Design, Enterprise Design Standards, AI-assisted Design
- **Last Updated:** 2026-07-28

---

# Table of Contents

1. [Identity & Purpose](#identity--purpose)
2. [Foundations](#foundations)
   - Design Engineering
   - Design Tokens
   - Visual Hierarchy
   - Spacing & Layout Systems
   - Typography System
   - Color System
   - Accessibility Engineering
   - Motion Design
   - User Psychology & Cognitive Engineering
3. [Complete Knowledge Base](#complete-knowledge-base)
   - Module 1: Design System Architecture
   - Module 2: Component Design Engineering
   - Module 3: Responsive & Adaptive Design
   - Module 4: Design-to-Code Pipeline
   - Module 5: AI-Assisted Design Engineering
   - Module 6: Layout Engineering
   - Module 7: Interaction Design Engineering
   - Module 8: Form Engineering
   - Module 9: Iconography System
   - Module 10: Information Architecture
   - Module 11: Design Handoff & Specification
4. [Decision Frameworks](#decision-frameworks)
5. [Enterprise Standards](#enterprise-standards)
6. [AI Engineering](#ai-engineering)
7. [Quality Standards](#quality-standards)
8. [Cross References](#cross-references)
9. [Glossary](#glossary)
10. [Revision History](#revision-history)

---

# Identity & Purpose

## Mission

Establish design as a measurable, systematic engineering discipline—not an artistic afterthought. Define the complete specification for translating user needs, brand intent, and technical constraints into predictable, scalable, and accessible visual interfaces through codified principles, reusable systems, and deterministic workflows.

## Primary Objective

Provide the single source of truth for all design engineering decisions within AI-WEOS. Enable any engineer, designer, or AI system to produce interfaces that are internally consistent, externally coherent, measurably accessible, and technically sound without requiring subjective aesthetic judgment as the primary decision mechanism.

## Scope

- Visual design principles as engineering constraints
- Component-level design specification
- Layout systems and spatial mathematics
- Typography as a measured system
- Color as a functional, accessible token system
- Motion design as purposeful, performant behavior
- Accessibility as non-negotiable specification
- Responsive and adaptive design strategies
- Design system architecture and governance
- User psychology and cognitive load engineering
- Enterprise design standardization
- AI-assisted design generation, validation, and reasoning

## Out of Scope

- Brand identity creation (logos, naming, brand strategy)
- Marketing creative direction
- Illustration style development
- Content strategy
- User research methodology (referenced, not defined)
- Business strategy or product-market fit

## Engineering Philosophy

Design is the deterministic application of constraints. Beauty emerges from precision, not inspiration. Every visual decision must have a functional justification, a measurable outcome, and a systematic implementation path. Aesthetic preference is not an engineering input—user need, cognitive science, accessibility requirements, and technical feasibility are.

## Engineering Mindset

- **Constraint-driven:** Design within boundaries, not despite them
- **Systematic:** Every element belongs to a broader, coherent system
- **Measurable:** Visual outcomes are testable against criteria
- **Repeatable:** Same inputs produce same outputs
- **Inclusive:** Design that excludes is failed engineering
- **Performant:** Beauty must not compromise speed
- **Technology-neutral:** Principles transcend frameworks
- **AI-native:** Design knowledge structured for machine reasoning

## Core Principles

1. **Accessibility is not a feature—it is the baseline specification**
2. **Consistency reduces cognitive load—reduce, reuse, don't reinvent**
3. **Every pixel must justify its existence functionally**
4. **Design systems are living engineering artifacts, not static documentation**
5. **Motion communicates state—treat it as information, not decoration**
6. **Type exists to be read—legibility precedes aesthetics**
7. **Color conveys meaning—never rely on color alone**
8. **Layout is spatial logic—grid, flow, hierarchy must be mathematically sound**
9. **Responsive is not adaptive—devices are endpoints, not design targets**
10. **Design tokens are the atomic truth—all implementations derive from tokens**

## First Principles

- **Visual hierarchy is information architecture rendered spatially**
- **Affordance is the probability a user correctly predicts interaction outcome**
- **Consistency is the elimination of unnecessary decision-making**
- **Proximity implies relationship—space is semantic**
- **Every interface is a conversation—design choreographs turn-taking**
- **Cognitive load is a finite budget—spend it only on user goals**
- **Perceived performance is performance—design shapes perception of time**

---

# Foundations

## Design Engineering

### Definition

Design Engineering is the systematic application of visual, spatial, and behavioral constraints to create interfaces that are functional, accessible, performant, and measurably effective. It treats design as a deterministic output of rules, tokens, and systems rather than subjective creative expression.

### Purpose

Bridge the gap between raw visual creativity and production engineering. Eliminate the "design handoff" as a distinct phase by embedding design decisions into engineering artifacts (tokens, components, constraints) that flow directly into implementation.

### Why It Exists

Traditional design-to-development workflows suffer from:
- Lossy translation between design tools and code
- Inconsistent interpretation of visual intent
- Accessibility treated as post-hoc remediation
- Duplicated decision-making across teams
- Design debt accumulating faster than technical debt

Design Engineering solves these by making design a codified, version-controlled, testable engineering artifact.

### Mental Model

```
[User Needs + Brand Constraints + Technical Limits]
    ↓
[Design Tokens] → [Component Specs] → [Layout Rules] → [Behavior States]
    ↓
[Validated Interface]
```

Design decisions flow in one direction. Tokens are source of truth. Components are token compositions. Layouts are component arrangements. States are behavioral rules. Never reverse the flow.

### Relationship with Other Concepts

- **Design System:** The operational implementation of Design Engineering
- **Component Architecture (CORE-ARCH-001):** Consumes design specifications as constraints
- **Context Engineering (CORE-CONTEXT-001):** Provides user context that drives design decisions
- **Quality Engineering (CORE-QUALITY-001):** Validates design outputs against specifications

### Trade-offs

| Approach | Benefit | Cost |
|----------|---------|------|
| Rigid token system | Consistency | Reduced creative flexibility |
| Component-first design | Reusability | Initial abstraction overhead |
| Constraint-driven layout | Predictability | Complex edge cases require explicit rules |
| Automated accessibility | Compliance | May miss nuanced human judgment |

### Common Misunderstandings

- **"Design Engineering eliminates creativity"** — It eliminates redundant decision-making, freeing creativity for novel problems
- **"Design systems stifle innovation"** — Systems handle the known; innovation addresses the unknown
- **"Accessibility constraints limit design"** — Constraints produce more inventive, robust solutions
- **"Tokens are just variables"** — Tokens are semantic contracts between design intent and implementation

---

## Design Tokens

### Definition

Design tokens are named, typed, version-controlled entities that store visual design decisions. They are the atomic units of a design system—the indivisible source of truth from which all visual implementation derives.

### Purpose

Decouple design decisions from implementation technology. A token represents a design choice (e.g., `color-surface-primary`) independent of how that choice manifests in CSS, SwiftUI, Compose, or any future technology.

### Why It Exists

Without tokens, design decisions are buried in:
- Hard-coded values across codebases
- Unversioned design tool files
- Tribal knowledge in designers' minds
- Inconsistent naming conventions

Tokens make design decisions explicit, searchable, and mechanically transformable.

### Mental Model

```
Design Decision → Token Name → Token Value → Platform Output
"Primary brand blue" → color-brand-primary → #0066FF → CSS var, Swift Color, Compose Color
```

Tokens are the middle abstraction. Never skip directly from decision to platform output. Never hard-code values that correspond to tokenized decisions.

### Token Taxonomy

| Category | Examples | Purpose |
|----------|----------|---------|
| Color | `color-surface-primary`, `color-text-on-surface` | Visual hierarchy, state, branding |
| Typography | `font-family-body`, `font-size-heading-xl` | Readability, hierarchy, rhythm |
| Spacing | `space-inset-md`, `space-stack-lg` | Layout consistency, visual rhythm |
| Sizing | `size-component-button-height` | Component consistency |
| Border/Radius | `radius-container-card`, `border-width-focus` | Visual style, focus indicators |
| Shadow/Elevation | `elevation-modal`, `elevation-tooltip` | Depth, layering |
| Motion | `duration-transition-fast`, `easing-enter-decelerate` | Temporal behavior |
| Opacity | `opacity-disabled`, `opacity-overlay` | State communication |
| Breakpoint | `breakpoint-viewport-tablet` | Responsive thresholds |

### Token Tiers

**Tier 1: Global Tokens (Primitives)**
Raw values with no semantic meaning. The palette.
```
blue-500: #0066FF
space-16: 16px
```

**Tier 2: Alias Tokens (Semantic)**
Purpose-mapped references to primitives.
```
color-action-primary: {blue-500}
space-component-gap: {space-16}
```

**Tier 3: Component Tokens (Specific)**
Component-scoped semantic tokens.
```
button-primary-background: {color-action-primary}
button-padding-x: {space-component-gap}
```

### Token Naming Convention

Pattern: `[category]-[concept]-[variant]-[state]`

```
color-surface-primary-hover
font-size-body-lg
space-inset-card-md
```

Rules:
- Use lowercase kebab-case
- Category first for grouping
- Concept describes purpose, not appearance
- State as suffix when applicable
- Never use color names (no `color-blue`, use `color-brand` or `color-info`)
- Never use size descriptors as sole differentiator (no `space-1`, `space-2`)

### Trade-offs

| Decision | Rationale |
|----------|-----------|
| Many granular tokens vs few broad tokens | Granular: consistency, harder governance. Broad: flexibility, potential drift |
| Tier system depth | 3 tiers sufficient for most enterprises; more tiers add indirection without value |
| Token vs utility class | Tokens for design decisions; utility classes for composition convenience |

---

## Visual Hierarchy

### Definition

Visual hierarchy is the systematic arrangement of interface elements to communicate their relative importance, relationship, and sequence of interaction through spatial positioning, size, color, contrast, and typographic treatment.

### Purpose

Enable users to instantly parse what matters, what relates to what, and what action to take next—without reading every element. Hierarchy offloads cognition to pre-attentive visual processing.

### Why It Exists

Flat interfaces with no hierarchy force users to manually scan and compare every element. This is cognitively expensive, error-prone, and slow. Hierarchy is the primary mechanism for reducing time-to-comprehension.

### Mental Model

```
Most Important → Largest, Highest Contrast, Isolated, Primary Position
    ↓
Secondary → Medium, Moderate Contrast, Grouped
    ↓
Tertiary → Smallest, Lowest Contrast, Dense
```

The user's eye should follow a deliberate path. Design the path. Never let the path emerge accidentally.

### Hierarchy Levers

| Lever | Mechanism | Strength | Notes |
|-------|-----------|----------|-------|
| Size | Larger = more important | Very Strong | Overuse flattens hierarchy |
| Color/Contrast | Higher contrast = more important | Strong | Must pass accessibility ratios |
| Position | Top/Left = first seen (LTR) | Strong | Culture-dependent |
| Whitespace | More isolation = more important | Moderate | Expensive in dense UIs |
| Motion | Moving elements demand attention | Very Strong | Use sparingly; overuse causes chaos |
| Typography weight | Bolder = more important | Moderate | Must have contrasting weights available |
| Depth/Elevation | Higher = more important | Weak | Subtle; not universally perceived |

### Hierarchy Validation Questions

1. Can a user identify the primary action in under 200ms?
2. Does the visual hierarchy match the information hierarchy?
3. Is the reading/scanning path intentional and testable?
4. Do any elements compete for the same hierarchy level unintentionally?
5. Does the hierarchy hold when viewed at 400% zoom?

---

## Spacing & Layout Systems

### Definition

A spacing system is a mathematically defined set of spatial relationships governing the distance between, within, and around interface elements. A layout system is the structural framework that organizes elements in two-dimensional space.

### Purpose

Eliminate arbitrary spatial decisions. Create visual rhythm, predictable relationships, and consistent density across an entire interface.

### Why It Exists

Arbitrary spacing produces visual noise. Humans perceive spatial inconsistency even when they cannot articulate it. Systematic spacing creates subconscious order and reduces cognitive effort.

### Mental Model

Space is not empty. Space is a container for relationship. The distance between two elements communicates their relationship strength. Smaller gaps = stronger relationship. Larger gaps = weaker relationship, grouping boundaries.

### Spacing Scale

Base unit: `4px` (or `0.25rem`)

| Token | Value (px) | Value (rem) | Use |
|-------|------------|-------------|-----|
| `space-0` | 0 | 0 | No space, tight coupling |
| `space-1` | 4 | 0.25 | Icon-to-label, inline elements |
| `space-2` | 8 | 0.5 | Related elements within component |
| `space-3` | 12 | 0.75 | Component internal padding |
| `space-4` | 16 | 1 | Standard component gap |
| `space-5` | 20 | 1.25 | Related component groups |
| `space-6` | 24 | 1.5 | Section internal padding |
| `space-8` | 32 | 2 | Section separation |
| `space-10` | 40 | 2.5 | Major section breaks |
| `space-12` | 48 | 3 | Page-level separation |
| `space-16` | 64 | 4 | Hero/feature separation |
| `space-20` | 80 | 5 | Layout-level separation |
| `space-24` | 96 | 6 | Extreme separation |

Never use values outside the defined scale.

### Layout Models

| Model | Mechanism | Best For | Limitations |
|-------|-----------|----------|-------------|
| Grid | Columns + rows + gutters | Page-level structure | Rigid; complex nested grids |
| Flexbox | Single-axis distribution | Component internals, lists | One-dimensional |
| Stack | Vertical/horizontal sequential spacing | Forms, feeds, cards | Linear only |
| Inline | Text-flow wrapping | Chips, tags, inline actions | Unpredictable wrapping |
| Absolute/Overlay | Positioned relative to container | Modals, tooltips, floating elements | Responsive fragility |
| Masonry | Dense packing with column flow | Image galleries | Reflow unpredictability |

### Layout Principles

1. **Single-axis decisions:** Prefer layout models that constrain one axis. Flexbox (1D) > Grid (2D) when possible.
2. **Content-driven sizing:** Allow content to determine size within constraints. Avoid fixed sizes.
3. **Avoid magic numbers:** Every spacing value must derive from the spacing scale.
4. **Consistent density:** Maintain uniform information density within a view.
5. **Spatial grouping:** Elements closer together must be more related.

### Anti-patterns

- Using margin where padding is appropriate (margin leaks relationship)
- Deeply nested layout containers (layout thrashing, complexity)
- Mixing spacing scales within a single component
- Using `gap` and `margin` on the same container
- Fixed pixel values for text containers (responsive fragility)

---

## Typography System

### Definition

A typography system is the complete specification of typeface selection, sizing scale, weight hierarchy, line height, letter spacing, and typographic rhythm governing all text in an interface.

### Purpose

Ensure every character rendered is optimally legible, appropriately styled for its semantic role, and contributes to visual hierarchy. Typography is the primary carrier of information—its engineering must be flawless.

### Why It Exists

Type is not decoration. Type is information architecture rendered in glyphs. Poor typography degrades comprehension, increases cognitive load, and excludes users with visual or cognitive disabilities. Systematic typography eliminates these failures.

### Mental Model

```
Semantic Role → Typography Token → Visual Properties → Rendered Text
"Page heading" → font-heading-xl → 2rem, 700w, 1.1lh → Visual output
```

Always start from semantic role. Never start from "I want this to look bigger."

### Type Scale

Mathematical scale based on `1.25` (Major Third) for web, `1.333` (Perfect Fourth) for dense data applications.

| Level | Size (rem) | Size (px at 16px base) | Semantic Use |
|-------|------------|------------------------|--------------|
| `text-xs` | 0.75 | 12 | Captions, legal, metadata |
| `text-sm` | 0.875 | 14 | Secondary body, labels |
| `text-base` | 1 | 16 | Primary body, inputs |
| `text-md` | 1.125 | 18 | Emphasized body |
| `text-lg` | 1.25 | 20 | Subheadings, lead text |
| `text-xl` | 1.5 | 24 | H4, card titles |
| `text-2xl` | 1.875 | 30 | H3, section headings |
| `text-3xl` | 2.25 | 36 | H2, page subheadings |
| `text-4xl` | 3 | 48 | H1, page titles |
| `text-5xl` | 3.75 | 60 | Hero headings |
| `text-6xl` | 4.5 | 72 | Display text |

### Weight Scale

| Weight | Value | Use |
|--------|-------|-----|
| Light | 300 | Large display text only |
| Regular | 400 | Body text |
| Medium | 500 | Emphasized body, labels |
| Semibold | 600 | Subheadings, UI elements |
| Bold | 700 | Headings, strong emphasis |
| Extrabold | 800 | Hero, display (rare) |

Never use weight to compensate for poor contrast. Weight is for hierarchy, not readability.

### Line Height

| Context | Line Height | Rationale |
|---------|-------------|-----------|
| Body text | 1.5–1.6 | Optimal reading comfort |
| Headings | 1.1–1.3 | Tight for visual cohesion |
| UI labels | 1.2–1.4 | Compact for density |
| Code | 1.5–1.7 | Character clarity |
| Long-form reading | 1.6–1.8 | Reduced eye fatigue |

Line height expressed as unitless multiplier relative to font size.

### Line Length (Measure)

Optimal: `45–75` characters per line.
Never exceed `80` characters for body text.
Code may extend to `100` characters.

### Font Stack Strategy

```
Primary: System font stack (performance, zero latency)
Secondary: Optimized web font (brand differentiation)
Fallback: Generic family (robustness)
```

Font stack must include:
1. Preferred font (system or web)
2. Similar system font
3. Generic fallback
4. Metric adjustment to prevent layout shift

### Anti-patterns

- Using display fonts for body text
- Overriding system font rendering (anti-aliasing, smoothing)
- Setting font-size on parent and relying on em cascade unpredictably
- Using all-caps for readability-critical text
- Justified text on web without hyphenation
- Pure black text on pure white background (excessive contrast strain)
- Text in images (accessibility failure, unsearchable, unselectable)

### Typography Accessibility

- Minimum body text size: `16px` (prevents iOS zoom on input focus)
- Minimum contrast ratio: `4.5:1` for body text, `3:1` for large text (≥18px bold or ≥24px regular)
- Never communicate information through font styling alone (WCAG 1.3.1)
- Respect user font size preferences (use `rem`, not `px`)
- Support text resizing up to 200% without loss of content or functionality (WCAG 1.4.4)

---

## Color System

### Definition

A color system is the complete specification of color roles, relationships, accessibility constraints, and thematic variation governing all color usage in an interface.

### Purpose

Transform color from subjective aesthetic choice into a functional, measurable, accessible system where every color serves a defined purpose and meets objective criteria.

### Why It Exists

Color is the most misused design element. Arbitrary color produces inaccessible interfaces, inconsistent branding, and interfaces that fail for color-blind users. A systematic approach eliminates these failures.

### Mental Model

```
Semantic Role → Color Token → Value (HSL) → Accessibility Check → Output
"Primary action" → color-action-primary → H:220 S:100 L:50 → Contrast 7:1 ✓ → #0044FF
```

Every color assignment flows through accessibility validation. No exceptions.

### Color Roles

| Role | Purpose | Characteristics |
|------|---------|-----------------|
| **Brand** | Brand identity expression | Distinctive, consistent |
| **Action** | Interactive elements, CTAs | High contrast, attention-drawing |
| **Surface** | Backgrounds, containers | Neutral, non-distracting |
| **Text** | Content, labels | Maximum readability |
| **Border** | Separation, structure | Subtle, structural |
| **Status** | Feedback, state communication | Semantically associated (red≠error universally) |
| **Data** | Charts, visualizations | Distinguishable, accessible palette |

### Accessibility Requirements (WCAG 2.2 AA minimum, AAA target)

| Element | Ratio | Level |
|---------|-------|-------|
| Body text | 4.5:1 | AA |
| Large text (≥18px bold or ≥24px) | 3:1 | AA |
| UI components, boundaries | 3:1 | AA |
| Body text | 7:1 | AAA |
| Large text | 4.5:1 | AAA |

**Non-text contrast (WCAG 1.4.11):**
- UI component boundaries: 3:1 minimum
- Focus indicators: 3:1 minimum
- Charts/data visualization elements: 3:1 minimum

### Color Blindness Considerations

Design for deuteranopia (red-green, ~6% males), protanopia (red, ~1% males), tritanopia (blue-yellow, rare).

Never use red/green as sole status indicators. Always pair with:
- Icons
- Text labels
- Patterns
- Position

Tooling: Simulate all interfaces in deuteranopia and achromatopsia before release.

### Dark Mode System

Dark mode is not inverted light mode. It is a distinct thematic variation.

| Principle | Light Mode | Dark Mode |
|-----------|------------|-----------|
| Surface elevation | Shadows | Lighter surfaces |
| Text contrast | Dark on light | Light on dark (reduced contrast for comfort) |
| Saturation | Full saturation | Desaturated (vibrant colors glow/bleed) |
| Shadows | Effective | Ineffective; use elevation through lightness |

Dark mode tokens must be separate but semantically equivalent:
```
color-surface-primary: light(#FFFFFF), dark(#121212)
color-text-primary: light(#1A1A1A), dark(#E0E0E0)
```

Never invert colors automatically. Design dark mode intentionally.

### Color Generation Algorithm

For programmatic palette generation (AI or tooling):

```
1. Define brand hue (HSL)
2. Generate tints (increase L, decrease S) for light variants
3. Generate shades (decrease L, increase S) for dark variants
4. Validate all combinations against contrast requirements
5. Generate semantic mapping based on role
6. Validate color-blind simulations
```

### Anti-patterns

- Naming colors by their value (`color-blue-500`) instead of role (`color-action-primary`)
- Using opacity to create color variants (unpredictable compositing)
- Dark mode via CSS invert filter
- Relying solely on color for status or data distinction
- Using pure black (#000) or pure white (#FFF) in large areas
- Exceeding 3-5 brand colors (diminishing distinctiveness)

---

## Accessibility Engineering

### Definition

Accessibility Engineering is the systematic practice of designing and implementing interfaces that are perceivable, operable, understandable, and robust for all users, regardless of ability, device, or context.

### Purpose

Ensure no user is excluded from accessing or interacting with the interface due to design decisions. Accessibility is not a feature—it is the minimum viable specification for any interface component.

### Why It Exists

Exclusionary design is failed engineering. Legal compliance (ADA, Section 508, EAA) is the floor, not the ceiling. Accessible design benefits all users—keyboard navigation serves power users, captions serve noisy environments, high contrast serves low-light conditions.

### Mental Model

```
Perceivable → Operable → Understandable → Robust (POUR)
```

Every interface must satisfy all four principles. If any fails, the component is incomplete.

### WCAG Conformance Level

Target: **WCAG 2.2 Level AA** minimum.
Aspire: **WCAG 2.2 Level AAA** where feasible without disproportionate burden.

### Accessibility Checklist by Concern

#### Perceivable

| Requirement | WCAG | Verification |
|-------------|------|-------------|
| All non-text content has text alternative | 1.1.1 | Automated + manual |
| Captions for all multimedia | 1.2.2 | Manual |
| Content is not reliant on sensory characteristics alone | 1.3.3 | Manual review |
| Color not sole means of conveying information | 1.4.1 | Color blindness simulation |
| Contrast meets minimum ratios | 1.4.3 | Automated contrast checker |
| Text resizes to 200% without content loss | 1.4.4 | Manual zoom test |
| Content on hover/focus is dismissible, hoverable, persistent | 1.4.13 | Manual |

#### Operable

| Requirement | WCAG | Verification |
|-------------|------|-------------|
| All functionality available from keyboard | 2.1.1 | Manual tab-through |
| No keyboard traps | 2.1.2 | Manual |
| Sufficient time or ability to extend time limits | 2.2.1 | Manual |
| No content that causes seizures (3 flashes/second) | 2.3.1 | Automated |
| Bypass blocks (skip links) | 2.4.1 | Automated + manual |
| Descriptive page titles | 2.4.2 | Automated |
| Focus order preserves meaning | 2.4.3 | Manual |
| Link purpose clear from text alone | 2.4.4 | Automated |
| Multiple ways to locate pages | 2.4.5 | Manual |
| Visible focus indicator | 2.4.7 | Manual |

#### Understandable

| Requirement | WCAG | Verification |
|-------------|------|-------------|
| Language of page programmatically determined | 3.1.1 | Automated |
| Consistent navigation | 3.2.3 | Manual |
| Consistent identification | 3.2.4 | Manual |
| Labels or instructions for inputs | 3.3.2 | Automated |
| Error identification and suggestion | 3.3.1, 3.3.3 | Manual |
| Error prevention (legal, financial, data) | 3.3.4 | Manual |

#### Robust

| Requirement | WCAG | Verification |
|-------------|------|-------------|
| Valid, complete HTML parsing | 4.1.1 | Automated |
| Name, Role, Value for all UI components | 4.1.2 | Automated + manual |
| Status messages programmatically communicated | 4.1.3 | Automated + manual |

### Focus Management

Focus is the cursor of accessibility. Every interactive element must:
1. Be focusable (unless intentionally excluded)
2. Display a visible focus indicator (3:1 contrast minimum)
3. Follow a logical tab order
4. Not trap focus except in modals/dialogs
5. Return focus to trigger element when modal/dialog closes

### Screen Reader Considerations

- Announce dynamic content changes via ARIA live regions
- Use semantic HTML elements (no `<div>` buttons)
- Provide accessible names for all interactive elements
- Decorative elements must be hidden from screen readers (`aria-hidden="true"`)
- Complex widgets must follow ARIA authoring practices

### Enterprise Accessibility Governance

1. Automated testing in CI/CD pipeline (axe-core, pa11y)
2. Manual keyboard audit per sprint
3. Screen reader testing (VoiceOver, NVDA, JAWS) per release
4. Accessibility regression test suite
5. VPAT/ACR documentation updated quarterly
6. Accessibility champion per engineering team

---

## Motion Design

### Definition

Motion Design is the systematic use of animation and transitions to communicate state changes, spatial relationships, user action feedback, and temporal hierarchy within an interface.

### Purpose

Transform time into information. Motion must serve a functional purpose: orienting users, providing feedback, reducing perceived wait time, and clarifying spatial relationships. Motion without purpose is decoration; decoration is noise; noise degrades usability.

### Why It Exists

Humans perceive change through time. Static interfaces provide no temporal context for state transitions. Motion fills this gap, making state changes comprehensible instead of jarring. Additionally, well-crafted motion makes interfaces feel responsive, improving perceived performance without actual performance improvements.

### Mental Model

```
Event → Duration → Easing → Property Animation → Outcome
User click → 150ms → Ease-out → Scale + opacity → Perceived response
```

Every animation has: trigger, duration, easing, affected properties, and intended communication. If you cannot articulate what the animation communicates, remove it.

### Motion Principles

| Principle | Description | Application |
|-----------|-------------|-------------|
| **Purposeful** | Every motion communicates something | Don't animate "because it looks nice" |
| **Performant** | GPU-composited properties only | `transform`, `opacity`; never `width`, `height`, `top`, `left` |
| **Fast** | 100–400ms for UI transitions | User perception threshold: ~100ms; annoyance threshold: >500ms |
| **Natural** | Easing curves mimic physical motion | Ease-out for entering, ease-in for exiting |
| **Consistent** | Same action = same motion signature | Builds user mental model |
| **Respectful** | Respect `prefers-reduced-motion` | No animation or essential-only when set |

### Duration Guidelines

| Context | Duration | Rationale |
|---------|----------|-----------|
| Micro-interactions (hover, click feedback) | 100–200ms | Perceived as instantaneous |
| Component transitions (show/hide) | 200–300ms | Noticeable but not sluggish |
| Page transitions | 300–400ms | Clear context change |
| Complex animations (onboarding, illustration) | 500–1000ms | Deliberate, engaging |
| Loading indicators | Continuous until complete | Communicates ongoing process |

Never exceed 400ms for functional UI transitions. The user should never wait for animation.

### Easing Curves

```
Ease-out: Fast start, slow end (objects entering view)
Ease-in: Slow start, fast end (objects exiting view)
Ease-in-out: Slow start, slow end (objects moving within view)
Linear: Never use for UI (robotic, unnatural)
```

Standard tokenized easing:
```
easing-default: cubic-bezier(0.4, 0, 0.2, 1)   // Material standard
easing-enter: cubic-bezier(0, 0, 0.2, 1)       // Entering elements
easing-exit: cubic-bezier(0.4, 0, 1, 1)        // Exiting elements
easing-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55) // Emphasized (use sparingly)
```

### Performant Animation

Only animate properties that trigger compositing, not layout or paint:

**Safe (composite-only):**
- `transform` (translate, scale, rotate)
- `opacity`

**Dangerous (triggers layout/paint):**
- `width`, `height`
- `top`, `left`, `right`, `bottom`
- `margin`, `padding`
- `border-width`
- `box-shadow` (can be OK with `will-change`)

Rule: If you need to animate layout-triggering properties, there is a design problem. Redesign to use `transform`.

### prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Or better: design motionless states as the default, enhance with motion when allowed.

### Anti-patterns

- Animating on page load without user interaction
- Infinite animation loops (spinners are the only acceptable exception)
- Parallax without respecting reduced motion
- Stagger delays exceeding 500ms total
- Animating layout properties and causing layout thrashing
- Scroll-jacking
- Auto-playing video or animation without user control

---

## User Psychology & Cognitive Engineering

### Definition

The systematic application of cognitive psychology principles to interface design, treating human attention, memory, perception, and decision-making as engineering constraints.

### Purpose

Design interfaces that work with human cognitive architecture, not against it. Predict user behavior, reduce errors, and optimize for comprehension speed by understanding the mechanical limits of human information processing.

### Why It Exists

Users do not read interfaces—they scan, guess, and satisfice. Designing for idealized users who read every word and rationally evaluate every option produces interfaces that fail in reality. Cognitive engineering designs for humans as they are: pattern-matching, attention-limited, error-prone, and goal-driven.

### Mental Model

```
User Goal → Attention Allocation → Pattern Recognition → Decision → Action
```

Design optimizes each stage: clarify the goal, capture attention, make patterns obvious, simplify decisions, and make actions unambiguous.

### Cognitive Load Budget

Humans can hold approximately **4±1 chunks** of information in working memory at once. Every element in an interface consumes budget. If budget is exhausted on interface comprehension, none remains for the user's actual task.

**Budget allocation priority:**
1. User's task goal (highest priority—must preserve)
2. Navigation/orientation
3. Interface instruction
4. Brand expression (lowest priority—first to sacrifice)

### Cognitive Biases Relevant to Interface Design

| Bias | Definition | Design Implication |
|------|------------|-------------------|
| **Hick's Law** | Decision time increases with options | Minimize choices; progressive disclosure |
| **Fitts's Law** | Time to target = f(distance, size) | Large touch targets; edge-anchored actions |
| **Jakob's Law** | Users prefer familiar patterns | Use platform conventions; don't reinvent |
| **Miller's Law** | Working memory ≈ 7±2 (revised: 4±1) | Chunk information; don't exceed 5 nav items |
| **Peak-End Rule** | Users judge by peak + end experience | Optimize critical moments; pleasant endings |
| **Von Restorff Effect** | Distinctive items are remembered | Make primary action visually distinct |
| **Serial Position Effect** | First and last items best remembered | Put critical items first or last in lists |
| **Aesthetic-Usability Effect** | Attractive things perceived as more usable | Polish matters; but don't sacrifice function |

### Progressive Disclosure

Reveal complexity on demand, not by default. Every interface should have:
1. **Default state:** Most common path visible, 80% use case
2. **Expanded state:** Advanced options, 15% use case
3. **Expert state:** Power features, 5% use case (may be hidden behind settings)

Never expose all complexity at once. The interface is not a feature checklist.

### Recognition Over Recall

Users recognize things more easily than they recall them. Implications:
- Use icons with labels, not icons alone (for critical actions)
- Show options; don't require remembering commands
- Auto-complete, don't require full recall
- History and recents, don't require re-navigation

### Error Engineering

| Error Type | Strategy | Implementation |
|------------|----------|----------------|
| Slips (correct intention, wrong execution) | Prevention | Constraints, confirmation, undo |
| Mistakes (wrong intention) | Education | Clear information, warnings, previews |
| Lapses (forgotten intention) | Reminders | State persistence, progress indicators |

Error messages must:
1. Say what happened in plain language
2. Say why it happened
3. Say how to fix it
4. Never blame the user

### Anti-patterns

- Dark patterns (intentionally deceptive design)
- Confirmshaming ("No, I don't want to save money")
- Hidden costs revealed at checkout
- Forced continuity (hard-to-cancel subscriptions)
- Privacy-intrusive defaults
- Excessive notifications demanding attention
- Interrupting user flow for non-critical information

---

# Complete Knowledge Base

## Module 1: Design System Architecture

### Definition

A Design System is the integrated set of design tokens, components, patterns, guidelines, and governance processes that enable teams to produce consistent, accessible, on-brand interfaces at scale. It is a living engineering product, not static documentation.

### Architecture

```
┌─────────────────────────────────────────────┐
│                 Design Tokens                │
│         (Atomic visual decisions)            │
├─────────────────────────────────────────────┤
│              Component Library               │
│    (Token compositions with behavior)        │
├─────────────────────────────────────────────┤
│             Pattern Library                  │
│    (Component compositions solving tasks)    │
├─────────────────────────────────────────────┤
│              Page Templates                  │
│     (Pattern compositions for page types)    │
├─────────────────────────────────────────────┤
│           Governance & Contribution          │
│    (Processes, versioning, quality gates)    │
└─────────────────────────────────────────────┘
```

### Design System Maturity Model

| Level | Characteristics | Key Metric |
|-------|----------------|------------|
| **1: Ad-hoc** | No shared system; copy-paste across codebases | Design inconsistency rate >40% |
| **2: Documented** | Style guide exists; manual adherence | Time-to-consistent-component >2 days |
| **3: Centralized** | Shared component library; some tokens | Component reuse rate >60% |
| **4: Automated** | Design tokens drive all platforms; CI/CD validation | Token-to-code drift <5% |
| **5: Intelligent** | AI-assisted consistency; auto-suggested components; predictive design | New feature design time <4 hours |

### Enterprise Implementation

**Team structure:**
- **Design System Lead:** Product owner for the system
- **Design Engineers:** Build and maintain components
- **Design Technologists:** Token architecture, tooling, CI/CD
- **Accessibility Specialist:** Embedded, not consultative
- **Documentation Engineer:** System documentation as code

**Governance model:**
- Proposals via RFC (Request for Comment) process
- Design System Council reviews breaking changes
- Weekly office hours for consumers
- Deprecation policy: 2-release notice before removal
- Contribution model: Inner-source with quality gates

### Decision Framework

**When to build a Design System:**
- 3+ products sharing a brand
- 10+ engineers implementing UI
- Inconsistency causing user-facing issues
- Accessibility compliance required across portfolio
- Design velocity cannot meet product velocity

**When NOT to build a Design System:**
- Single product, small team
- Pre-product-market-fit experimentation
- No dedicated maintenance capacity
- Organization unwilling to enforce adoption

### Common Mistakes

- Building the system in isolation (no consumer feedback)
- Designing components without real content/data
- Prioritizing aesthetic completeness over functional coverage
- No migration strategy for existing products
- Failing to version the system
- Documentation as afterthought
- No accessibility requirements in component acceptance criteria

---

## Module 2: Component Design Engineering

### Definition

A component is a self-contained, reusable UI element that encapsulates visual appearance (via tokens), behavior (via state management), and accessibility (via semantic markup) into a single, versioned artifact with a defined API.

### Component Anatomy

```
Component
├── Visual Layer (tokens → appearance)
│   ├── Default state
│   ├── Variants (size, style, hierarchy)
│   └── Themes (light, dark, brand)
├── Behavioral Layer (state machine)
│   ├── States: idle, hover, focus, active, disabled, loading, error
│   └── Transitions between states
├── Accessibility Layer
│   ├── Semantic role
│   ├── Keyboard interaction
│   ├── Screen reader announcement
│   └── Focus management
├── API Layer
│   ├── Props/Parameters
│   ├── Events/Callbacks
│   ├── Slots/Children
│   └── Ref/Imperative handle
└── Documentation
    ├── Usage guidelines
    ├── Accessibility notes
    ├── Design token mapping
    └── Code examples
```

### Component Specification Template

Every component must be specified with:

```
Name: [ComponentName]
Purpose: [What user task it enables]
Variants: [Size, hierarchy, style variants]
Tokens: [Referenced design tokens]
States: [Complete state list]
Keyboard: [Expected keyboard behavior]
ARIA: [Roles, labels, descriptions]
Events: [API events]
Content Model: [What content it accepts]
Responsive Behavior: [How it adapts]
Performance Budget: [Size, render time]
Accessibility: [Specific WCAG criteria addressed]
```

### Component Design Principles

1. **Single Responsibility:** One component, one primary task
2. **Composable:** Components combine to form patterns
3. **Context-independent:** Component functions regardless of where it's placed
4. **Content-agnostic:** Works with any reasonable content
5. **Accessible by default:** Cannot use component incorrectly in an inaccessible way
6. **Testable:** Every state reachable and verifiable in isolation

### Component Hierarchy

| Level | Examples | Rules |
|-------|----------|-------|
| **Atoms** | Button, Input, Icon, Label, Badge | No composition; self-contained |
| **Molecules** | SearchBar, FormField, Card, ModalTrigger | Compose atoms only |
| **Organisms** | Header, Footer, DataTable, Form | Compose molecules and atoms |
| **Templates** | Page layouts, Dashboard layout | Compose organisms; define slots |
| **Pages** | Specific instances with real content | Not in the system; product-specific |

### State Enumeration

Every interactive component must define all states:

```
- Idle (default, resting)
- Hover (mouse over, non-touch)
- Focus (keyboard focused)
- Active (being pressed/activated)
- Disabled (not interactive)
- Loading (async operation in progress)
- Error (operation failed)
- Success (operation completed, temporary)
- Empty (no content to display, for data components)
```

Unhandled states are bugs. Every state must be visually distinct and accessible.

### Component Quality Checklist

- [ ] All states designed and implemented
- [ ] Keyboard accessible (Tab, Enter, Escape, Arrow keys as appropriate)
- [ ] Screen reader announces state changes
- [ ] Focus visible and logical
- [ ] Contrast meets AA minimum
- [ ] Content resizes to 200%
- [ ] Touch target minimum 44x44px (WCAG 2.5.5 AAA, 24x24px minimum)
- [ ] No layout shift on content change
- [ ] Animations respect reduced motion
- [ ] Works in forced-colors mode
- [ ] Design tokens used (no hardcoded values)
- [ ] Variants exhaustively defined
- [ ] Error boundaries defined
- [ ] Loading state non-destructive (no content loss)

---

## Module 3: Responsive & Adaptive Design

### Definition

Responsive Design is a fluid layout strategy where interfaces reflow and adapt continuously based on viewport or container size. Adaptive Design delivers distinct layouts at predefined breakpoints. Modern engineering uses responsive as the primary strategy with adaptive enhancements for major context shifts.

### Core Distinction

| | Responsive | Adaptive |
|-|------------|----------|
| Layout change | Continuous, fluid | Discrete, at breakpoints |
| Implementation | Flexible grids, relative units | Media queries, container queries |
| Content | Same content, reflowed | May change content/functionality |
| Device knowledge | None required | Context-aware |
| Maintenance | Single codebase | Per-breakpoint logic |

### Breakpoint System

**Do not use device-specific breakpoints.** Use content-driven breakpoints.

| Name | Min-width | Typical use trigger |
|------|-----------|---------------------|
| `xs` | 0 | Default, single-column |
| `sm` | 640px | Two-column when content fits |
| `md` | 768px | Tablet portrait, sidebars appear |
| `lg` | 1024px | Tablet landscape, fuller layouts |
| `xl` | 1280px | Desktop, multi-column |
| `2xl` | 1536px | Large desktop, constrained max-width |

**Breakpoint definition rule:** Add a breakpoint when the design breaks, not when a device width is reached.

### Fluid Typography

```
font-size: clamp(min, preferred, max)
font-size: clamp(1rem, 0.8rem + 1vw, 1.5rem)
```

Fluid type scales smoothly between viewport sizes without breakpoints. Use sparingly—most type should be discrete from the type scale.

### Container Queries

Preferred over media queries when component behavior depends on its container, not the viewport:

```css
@container (min-width: 400px) {
  .card { /* two-column layout */ }
}
```

Media queries: page-level layout.
Container queries: component-level layout.

### Responsive Patterns

| Pattern | Description | When to use |
|---------|-------------|-------------|
| Column drop | Columns stack vertically | Simple content hierarchy |
| Mostly fluid | Fluid with max-width, stacks at small sizes | Content-focused sites |
| Layout shifter | Explicit layout changes per breakpoint | Complex dashboards |
| Off-canvas | Hidden panel reveals on interaction | Navigation, filters |
| Overflow scroll | Horizontal scroll for overflowing content | Data tables, tab bars |

### Responsive Images

```html
<img
  src="image-800.jpg"
  srcset="image-400.jpg 400w, image-800.jpg 800w, image-1200.jpg 1200w"
  sizes="(max-width: 600px) 100vw, 50vw"
  alt="Descriptive text"
/>
```

Art direction: `<picture>` element for different aspect ratios/crops.

### Testing

Test at every breakpoint and in between. Do not test only at breakpoint boundaries. Fluid designs have no boundaries—they must work at all widths.

---

## Module 4: Design-to-Code Pipeline

### Definition

The Design-to-Code Pipeline is the systematic process of transforming design specifications (tokens, component specs, layouts) into production code with zero manual translation, zero interpretation ambiguity, and automated quality validation.

### Workflow

```
Design Tokens (JSON/YAML)
    ↓
Style Dictionary / Token Transformer
    ↓
Platform-specific variables (CSS, Swift, Kotlin, etc.)
    ↓
Component Code (consuming tokens)
    ↓
Visual Regression Testing
    ↓
Accessibility Automated Testing
    ↓
Production Build
```

### Token Transformation

Tokens stored in a platform-agnostic format (JSON, YAML) transformed to platform-specific outputs:

**Input (design-tokens.json):**
```json
{
  "color": {
    "action": {
      "primary": {
        "value": "#0066FF",
        "type": "color"
      }
    }
  }
}
```

**Output (CSS):**
```css
:root {
  --color-action-primary: #0066FF;
}
```

**Output (Swift):**
```swift
extension Color {
  static let actionPrimary = Color(hex: "#0066FF")
}
```

### Design Handoff Artifacts

No "handoff." Replace with shared artifacts:

1. **Token file** (single source of visual truth)
2. **Component specification** (states, API, accessibility)
3. **Visual reference** (screenshots for visual regression baseline)
4. **Interaction specification** (motion duration, easing, trigger)

### Quality Gates

| Gate | Tool | Pass Criteria |
|------|------|---------------|
| Token validity | Style Dictionary build | No build errors |
| Contrast compliance | axe-core, custom checker | AA minimum all combinations |
| Visual regression | Chromatic, Percy | Zero unexpected changes |
| Component tests | Storybook, Testing Library | All states render correctly |
| Accessibility audit | axe-core, pa11y | Zero violations |
| Bundle size | Bundlesize, custom | Within budget |

### Anti-patterns

- Exporting CSS from design tools (lossy, unmaintainable)
- Screenshot-based "pixel-perfect" comparison (fragile, false positives)
- Manual token synchronization
- Design files as source of truth for implementation values
- Skipping visual regression on "minor" changes

---

## Module 5: AI-Assisted Design Engineering

### Definition

AI-Assisted Design Engineering is the use of large language models and generative AI to produce, validate, and reason about design specifications, tokens, components, and layouts within the constraints defined by this document.

### AI Capabilities in Design Engineering

| Capability | Current Reliability | Validation Required |
|------------|---------------------|---------------------|
| Token generation from brand inputs | High | Manual review of naming |
| Accessibility contrast checking | Very High | Confirm against WCAG calculator |
| Component state enumeration | High | Designer review for edge cases |
| Responsive breakpoint suggestion | Medium | Content testing required |
| Color palette generation | Medium | Accessibility validation mandatory |
| Layout code generation | Medium | Visual regression testing |
| Motion specification | Low | Manual review always required |
| User psychology application | Medium | Expert review for context |
| Typography scale generation | High | Readability testing |
| Anti-pattern detection | High | Context-dependent |

### AI Reasoning Strategy

When AI generates or evaluates design decisions, it must:
1. Reference explicit constraints from this document
2. Validate against measurable criteria (contrast ratios, token existence, spacing scale adherence)
3. Flag subjective judgments and request human input
4. Never invent new tokens or patterns without explicit instruction
5. Default to accessibility-safe choices
6. Explain reasoning by mapping to specific principles

### Context Required for AI Design Generation

```
Required:
- Brand identity (primary colors, typography preference, tone)
- Accessibility target level (AA, AAA)
- Platform constraints (web, iOS, Android)
- Existing token file (if extending)

Optional but valuable:
- User research insights
- Competitor design references
- Performance budgets
- Historical design decisions and rationale
```

### Common AI Hallucinations in Design

| Hallucination | Reality | Mitigation |
|---------------|---------|------------|
| "This color combination passes AA" | Contrast may fail | Always run automated checker |
| "This layout works at all screen sizes" | Breakpoints untested | Require explicit responsive spec |
| "This component follows all WCAG criteria" | Only visual criteria considered | Require full accessibility checklist |
| "Motion duration of 800ms is appropriate" | Exceeds UX guidelines | Validate against motion duration table |
| "I've created consistent tokens" | Naming convention violated | Validate against token naming rules |

### AI Validation Rules

AI must validate all generated design output against:
1. Token naming convention
2. Spacing scale adherence
3. Color contrast requirements
4. Typography scale membership
5. Component state completeness
6. Accessible labeling requirements
7. Motion duration limits
8. Responsive breakpoint logic

### Human-in-the-Loop Requirements

AI design output requires human review for:
- Brand alignment (subjective)
- User experience appropriateness (contextual)
- Motion design subtlety (aesthetic)
- Content hierarchy appropriateness (task-dependent)
- Cultural sensitivity (nuanced)
- Innovation beyond established patterns (requires judgment)

---

## Module 6: Layout Engineering

### Definition

Layout Engineering is the systematic arrangement of interface elements within a defined spatial container using geometric rules, alignment principles, and distribution algorithms to achieve predictable, responsive, and semantically meaningful spatial organization.

### Purpose

Transform spatial organization from intuitive arrangement into a deterministic, repeatable system where every element's position is justified by relationship, hierarchy, and responsive behavior—never by arbitrary placement.

### Why It Exists

Manual layout produces inconsistency across pages, viewports, and teams. Layout engineering establishes spatial rules that scale across an entire application, ensuring visual coherence and reducing per-page layout decisions to composition of known patterns.

### Mental Model

```
Container → Direction → Alignment → Distribution → Spacing → Output
"Page" → Vertical → Start-aligned → Equal width → 24px gap → Stack layout
```

Never position elements absolutely unless overlaying. Always compose layouts from flow-based primitives.

### Layout Primitives

| Primitive | Axis | Behavior | Use Case |
|-----------|------|----------|----------|
| **Stack** | Single (vertical or horizontal) | Sequential element flow | Forms, lists, card groups, toolbars |
| **Grid** | Dual (rows + columns) | Two-dimensional placement | Page layouts, dashboards, galleries |
| **Inline** | Horizontal with wrap | Text-like flow | Chips, tags, breadcrumbs |
| **Center** | Both | Single element centered in container | Empty states, hero content, modals |
| **Side-by-Side** | Horizontal | Two elements with defined ratio | Master-detail, media + content |
| **Overlay** | Z-axis | Element positioned above another | Modals, tooltips, popovers, badges |

### Alignment System

| Property | Values | Effect |
|----------|--------|--------|
| **Main Axis** | start, center, end, space-between, space-around, space-evenly | Distribution along primary flow |
| **Cross Axis** | start, center, end, stretch | Alignment perpendicular to flow |
| **Self** | auto, start, center, end, stretch | Override for individual element |

**Alignment decision rules:**
- Text-heavy containers: cross-axis start (natural reading)
- Action bars: main-axis end (right-aligned actions in LTR)
- Empty states: center-center
- Form labels: cross-axis center with inputs
- Card groups: stretch to equal height

### Layout Patterns

#### Master-Detail

```
┌──────────┬───────────────────┐
│          │                   │
│  Master  │      Detail       │
│  List    │      Content      │
│          │                   │
└──────────┴───────────────────┘
```

- Ratio: 1:3 or 1:2 (master:detail)
- Collapses to stack on small viewports (master → detail)
- Master often scrollable independently
- Detail typically scrollable with full content

#### Holy Grail

```
┌──────────────────────────────┐
│            Header            │
├──────┬───────────┬───────────┤
│ Nav  │  Content  │  Sidebar  │
│      │           │           │
├──────┴───────────┴───────────┤
│            Footer            │
└──────────────────────────────┘
```

- Three-column with header and footer
- Center column fluid, sidebars fixed
- Collapses: Header → Nav (off-canvas or above) → Content → Sidebar (below) → Footer

#### Dashboard Grid

```
┌──────────┬───────────────────┐
│  Card 1  │     Card 2        │
├──────────┼─────────┬─────────┤
│ Card 3   │ Card 4  │ Card 5  │
│  (2x)    │         │         │
└──────────┴─────────┴─────────┘
```

- CSS Grid with defined template areas
- Cards span defined columns/rows
- Collapses to single column with cards in source order
- Dense packing algorithm preferred

### Responsive Layout Strategy

```
Default (mobile-first): Single column stack
    ↓
@media min-width 640px: Two-column where content benefits
    ↓
@media min-width 1024px: Sidebar + content where navigation exists
    ↓
@media min-width 1280px: Multi-column for dense data
```

Never design desktop-first and collapse. Design mobile-first and enhance. Mobile-first forces content prioritization. Desktop-first encourages feature stuffing.

### Container Width Management

| Container Type | Max Width | Use |
|----------------|-----------|-----|
| Full-bleed | 100% | Hero images, backgrounds |
| Wide | 1200px | Dashboards, data-heavy views |
| Standard | 800px | Article reading, forms |
| Narrow | 600px | Focused tasks, wizards, auth |

**Container nesting rule:** Inner containers must be ≤ outer container width. Never overflow containers horizontally without explicit scroll affordance.

### Layout Anti-patterns

- Fixed positioning without scroll consideration (overlaps, inaccessible content)
- Deep nesting of layout containers (>4 levels)
- Mixing grid and flexbox for same-dimensional layout
- Using `position: absolute` for flow content
- Setting explicit heights on content containers
- Overflow hidden that clips essential content
- Z-index battles (>10 explicit z-index values)
- Negative margins for layout adjustment

### Layout Performance

- Avoid layout thrashing (read-then-write DOM operations)
- Use `contain` CSS property for isolated layout subtrees
- Prefer `gap` over `margin` for spacing (single source, no collapse issues)
- Virtualize long lists (render only visible items)
- `content-visibility: auto` for below-fold content

---

## Module 7: Interaction Design Engineering

### Definition

Interaction Design Engineering is the systematic specification of how users manipulate interface elements, how the system responds, and how state transitions are communicated across time, ensuring every interaction is predictable, accessible, and purposeful.

### Purpose

Define the complete behavioral contract between user and interface. Every click, tap, keypress, gesture, and voice command must have a defined outcome. Unhandled interactions are undefined behavior; undefined behavior is a bug.

### Mental Model

```
User Intent → Input Event → System Response → State Transition → Feedback → New State
```

The user must:
1. Know what is interactive (affordance)
2. Know what will happen (predictability)
3. Know what happened (feedback)
4. Know the current state (visibility of system status)

### Interaction States (Complete Enumeration)

Every interactive element cycles through states:

```
Idle ↔ Hover ↔ Focus ↔ Active → (Loading) → (Success | Error) → Idle
                                   ↓
                              (Disabled)
```

| State | Trigger | Visual | Duration |
|-------|---------|--------|----------|
| Idle | Default | Resting appearance | Indefinite |
| Hover | Pointer enters | Subtle highlight | While pointer present |
| Focus | Tab/click | Focus ring | While focused |
| Active | Press/click down | Depressed/darkened | ~100ms |
| Disabled | `disabled` attribute | Greyed out, reduced opacity | Indefinite |
| Loading | Async operation start | Spinner/skeleton | Until complete |
| Success | Operation success | Brief confirmation | ~2000ms auto-dismiss |
| Error | Operation failure | Error state + message | Until user dismisses |

### Input Modalities

| Modality | Characteristics | Design Implications |
|----------|-----------------|---------------------|
| **Mouse** | High precision, hover possible | Hover states, right-click, tooltips |
| **Touch** | Low precision, no hover | Larger targets (44px), no hover-only info |
| **Keyboard** | Sequential, no coordinates | Focus order, shortcuts, skip links |
| **Screen Reader** | Semantic, non-visual | ARIA, headings, landmarks |
| **Voice** | Command-based, ambiguous | Clear labels, simple commands |
| **Switch** | Binary input, sequential | Simplified navigation, timing |
| **Stylus** | High precision, pressure | Similar to mouse + pressure sensitivity |

Design for all modalities. Never rely on a single modality for critical functionality (WCAG 2.5.6).

### Gesture System

| Gesture | Touch Equivalent | Accessibility Alternative |
|---------|------------------|---------------------------|
| Tap | Click | Enter/Space key |
| Double Tap | Double Click | Button with confirmation |
| Long Press | Right-click | Context menu button |
| Swipe | Scroll | Scrollbar, arrow keys |
| Pinch | Zoom | Zoom controls, Ctrl+/- |
| Drag | Move | Cut/paste, move buttons |
| Multi-touch | Complex interactions | Alternative mode or workflow |

### Feedback Timing (Doherty Threshold)

```
< 100ms: Perceived as instantaneous
100–300ms: Perceived as responsive
300–1000ms: System is working (needs indicator)
1000–10000ms: User attention may wander (needs progress indicator + estimate)
> 10000ms: User will switch tasks (needs background processing + notification)
```

### Error Prevention Patterns

| Pattern | Mechanism | Example |
|---------|-----------|---------|
| Constraint | Prevent invalid input | Date picker instead of text input |
| Confirmation | Require explicit confirm | "Delete account?" dialog |
| Undo | Allow reversal | Toast with "Undo" button |
| Preview | Show outcome before commit | Email preview before send |
| Guard | Disable destructive action | Greyed-out "Submit" until form valid |
| Forgiveness | Accept variations | Flexible date formats, case-insensitive |

### Anti-patterns

- Disabled buttons with no explanation of why disabled
- Submitting forms and clearing on error
- No loading indicator for operations >300ms
- Success/error messages that disappear before reading
- Hover-revealed critical information (inaccessible on touch)
- Double-tap required where single tap expected
- Swipe actions without visible affordance
- Intercepting browser back button

---

## Module 8: Form Engineering

### Definition

Form Engineering is the systematic design and specification of data collection interfaces that maximize completion rates, minimize errors, and ensure accessibility through structured layout, validation strategy, and input optimization.

### Purpose

Forms are the primary mechanism for user data input. Poor form design is the leading cause of user abandonment, data quality issues, and accessibility failures. Form engineering treats every form field as a conversation between system and user, optimized for clarity and error recovery.

### Why It Exists

Users do not enjoy filling forms. Every field is a demand on user attention and effort. Form engineering minimizes this friction while ensuring data quality, making the form as short as possible and as clear as necessary.

### Mental Model

```
Form = Σ (Label + Input + Help + Validation + Feedback + State)
```

Every field is a self-contained interaction with complete lifecycle. Forms compose fields into a single-task flow.

### Form Structure

```
Form
├── Title (what this form accomplishes)
├── Description (why, what's needed)
├── Sections (logical grouping)
│   ├── Section Heading
│   ├── Fields
│   │   ├── Label (required indicator if applicable)
│   │   ├── Input (appropriate type)
│   │   ├── Help text (format, requirements)
│   │   ├── Validation message (error state)
│   │   └── Success indicator (optional)
│   └── Section-level actions
├── Form-level actions (Submit, Cancel, Save draft)
└── Form-level feedback (global errors, success)
```

### Input Type Selection

| Data Type | Best Input | Why |
|-----------|------------|-----|
| Short text (<50 chars) | `<input type="text">` | Single line expected |
| Long text | `<textarea>` | Multi-line expected |
| Number | `<input type="number">` | Numeric keyboard on mobile |
| Date | `<input type="date">` | Native date picker |
| Email | `<input type="email">` | Email keyboard, basic validation |
| Phone | `<input type="tel">` | Phone keyboard |
| URL | `<input type="url">` | URL keyboard |
| Single choice (≤5 options) | Radio buttons | All options visible |
| Single choice (>5 options) | Select/Combobox | Space-efficient |
| Multiple choice | Checkboxes | Independent selection |
| Boolean toggle | Checkbox or Switch | Immediate application |
| Color | `<input type="color">` | Native color picker |
| File | `<input type="file">` | Native file browser |
| Range | `<input type="range">` | Imprecise value selection |

Never use a custom input when a semantic native input exists. Custom inputs break accessibility, mobile experience, and platform integration without significant engineering to restore them.

### Label Engineering

| Label Position | Best For | Avoid When |
|----------------|----------|------------|
| Top-aligned | Most forms, fastest completion | Extremely dense UIs |
| Left-aligned | Long forms, scanning labels | Short viewports, long labels |
| Floating (inside→top) | Space-constrained, material-style | Accessibility concerns, cognitive load |
| Placeholder-only | Never | Inaccessible, disappears on focus |

**Label rules:**
- Always visible when field has value
- Concise but descriptive
- Consistent capitalization
- Required fields marked with asterisk + text note ("* Required")
- Optional fields marked "(optional)"—never mark required alone

### Validation Strategy

```
Client-side: Immediate, inline, field-level (improves UX)
Server-side: Authoritative, on-submit (enforces data integrity)
```

| Timing | Mechanism | Use For |
|--------|-----------|---------|
| On blur | Validate when field loses focus | Most fields |
| On input | Validate as user types | Password strength, character count |
| On submit | Validate all at once | Final check, server errors |
| After submit | Server response | Uniqueness, business logic |

**Validation message rules:**
1. Identify the field (associate via `aria-describedby`)
2. Say what's wrong in plain language
3. Say how to fix it
4. Show message adjacent to field (not in a toaster)

### Form Submission States

```
Idle → Submitting (button disabled, shows loading) → Success (redirect/message) | Error (show errors)
```

Never leave form submit button enabled during submission. Prevent double-submit. If submission fails, preserve all user input.

### Multi-step Form Pattern

Use when form exceeds 5-7 fields or represents distinct logical steps.

```
Step 1 → Step 2 → Step 3 → Review → Submit
```

Requirements:
- Progress indicator (steps completed, current, remaining)
- Back navigation preserves input
- Data persisted between steps (localStorage or state)
- Can resume incomplete form
- Final step is review before submit

### Form Accessibility

- All inputs have programmatically associated labels
- Error messages linked via `aria-describedby`
- Required fields have `required` attribute AND visual indicator
- Tab order follows visual order
- Focus moves to first error on validation failure
- Fieldset + legend for grouped fields (radios, checkboxes)
- Autocomplete attributes for common fields (WCAG 1.3.5)

### Anti-patterns

- Placeholder as label (vanishes, inaccessible, low contrast)
- Resetting form on error
- Generic error messages ("Something went wrong")
- CAPTCHA as only anti-spam (accessibility barrier)
- Masked inputs that prevent valid input
- Disabling paste on password fields (reduces security, frustrates users)
- Auto-advancing focus (disorienting for screen readers)
- Inline validation that interrupts typing

---

## Module 9: Iconography System

### Definition

An Iconography System is the complete specification of icon creation, usage, sizing, accessibility, and semantic meaning within an interface, ensuring every icon communicates consistently and accessibly.

### Purpose

Icons compress meaning into compact visual symbols. Without a system, icons introduce ambiguity, inconsistency, and accessibility failures. A systematic approach ensures icons aid comprehension rather than hinder it.

### Why It Exists

Icons are universal when meaning is obvious, cultural when meaning is learned, and meaningless when ambiguous. Icon systems exist to enforce the "obvious" and document the "learned," eliminating ambiguity.

### Icon Principles

1. **Recognizable over beautiful:** User must understand the icon in <500ms
2. **Consistent style:** Uniform stroke weight, corner radius, perspective
3. **Paired with labels:** Icons alone fail for 60%+ of users in usability testing
4. **Accessible:** Every icon has a text alternative
5. **Scalable:** Same icon works at 16px and 48px
6. **Pixel-aligned:** Crisp rendering at target sizes

### Icon Sizing Grid

| Size Name | Dimensions | Use |
|-----------|------------|-----|
| `icon-xs` | 12×12px | Inline with small text, metadata |
| `icon-sm` | 16×16px | Inline with body text, list items |
| `icon-md` | 20×20px | Button icons, form fields |
| `icon-lg` | 24×24px | Standalone icons, navigation |
| `icon-xl` | 32×32px | Feature icons, empty states |
| `icon-2xl` | 48×48px | Hero/icons, illustrations |

All icons designed at 24×24px base, scaled up/down with pixel hinting.

### Icon Accessibility

Every icon must have an accessible name.

| Icon Role | Implementation | Example |
|-----------|---------------|---------|
| Decorative | `aria-hidden="true"` | Repeated icon next to text |
| Informational | `aria-label` or visible text | Status icon, feature icon |
| Interactive | Accessible name on button/link | Icon button |
| Semantic (standalone) | `<title>` in SVG + `role="img"` | Standalone meaningful icon |

**Rule:** If removing the icon changes meaning, it's informational. If not, it's decorative.

### Icon States

Icons, like components, have states:
- Default
- Hover (subtle color change)
- Active (darker/filled)
- Disabled (reduced opacity)
- Selected (accent color, filled variant)

### SVG Icon Requirements

```xml
<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  role="img"
>
  <title id="icon-title">Descriptive Name</title>
  <path d="..." />
</svg>
```

Requirements:
- `viewBox` for scaling
- `currentColor` for theming
- No fixed dimensions (sized by CSS)
- Accessible title
- Consistent stroke styling

### Anti-patterns

- Icons without text labels for critical navigation
- Different icon sets mixed in same interface
- Icons that change meaning between contexts
- Raster icons (PNG) instead of vector (SVG)
- Emoji as functional UI icons (inconsistent rendering)
- Color-dependent icon meaning without alternative

---

## Module 10: Information Architecture

### Definition

Information Architecture (IA) is the structural design of information environments—the organization, labeling, navigation, and search systems that enable users to find, understand, and manage information effectively.

### Purpose

Transform raw content and functionality into coherent, navigable, findable structures. Without IA, interfaces become feature graveyards where functionality exists but cannot be discovered.

### Why It Exists

Users cannot use what they cannot find. IA bridges the gap between what the system offers and what the user perceives is available. Good IA makes systems feel simpler than they are.

### Mental Model

```
Content/Features → Organization Scheme → Structure (Hierarchy/Network) → Navigation → User Mental Model
```

The user's mental model must align with the system's IA. Misalignment = user confusion and abandonment.

### Organization Schemes

| Scheme | Description | Example | Best For |
|--------|-------------|---------|----------|
| **Hierarchical** | Parent-child tree | File system, categories | Known relationships |
| **Sequential** | Step-by-step order | Wizard, checkout | Process-driven tasks |
| **Matrix** | Multiple dimensions | Filterable product grid | Complex filtering |
| **Network** | Associative links | Wiki, knowledge base | Exploratory browsing |
| **Chronological** | Time-based | Feed, activity log | Time-sensitive content |
| **Alphabetical** | A-Z | Contact directory | Large, known-item sets |
| **Geographic** | Location-based | Store finder | Physical world mapping |

### Navigation Systems

| Type | Purpose | Implementation |
|------|---------|----------------|
| **Global** | Top-level sections, always visible | Header, top nav, sidebar |
| **Local** | Within-section navigation | Sub-nav, sidebar submenu |
| **Contextual** | Related content links | "See also," related articles |
| **Utility** | Account, settings, help | Header utility area |
| **Supplemental** | Sitemap, index, search | Footer, search bar |
| **Breadcrumb** | Current location in hierarchy | Above content, trail format |

### Navigation Rules

1. **7±2 Rule:** Primary navigation max 5-7 items
2. **3-Click Rule (modified):** User must know they're on right path within 3 clicks
3. **Persistent vs. Contextual:** Global nav persistent; local nav contextual
4. **Current location visible:** User always knows where they are (breadcrumb, active state)
5. **Back works:** Browser back button must return to previous state

### Content Structure

```
Page
├── Heading (H1) — One per page, matches page title
├── Introduction — Context, what this page contains
├── Sections (H2) — Major content divisions
│   ├── Subsections (H3) — Detailed breakdown
│   │   └── Sub-subsections (H4) — Granular detail
│   └── Content
└── Related content / Actions
```

Heading hierarchy must never skip levels (H1 → H3). Headings are the table of contents for screen readers.

### Information Scent

Every link, label, and navigation element must provide "information scent"—a clear signal of what the user will find if they follow it. Weak scent = user hesitation and abandonment.

**Strong scent indicators:**
- Specific, descriptive link text (never "Click here")
- Matching page title to link text
- Progressive disclosure of detail
- Clear category labels that match user mental model

### Anti-patterns

- Deep hierarchies (>4 levels) without search
- Mystery meat navigation (icons without labels)
- Inconsistent navigation placement across pages
- Overloaded global navigation (>7 items)
- Orphan pages (no navigation path to reach them)
- Competing navigation systems with overlapping scope
- Navigation that changes based on page context unpredictably

---

## Module 11: Design Handoff & Specification

### Definition

Design Handoff is the process of transferring design specifications from design to engineering. In a Design Engineering system, "handoff" is a misnomer—design specifications are co-created artifacts that flow continuously, not documents transferred at a phase boundary.

### Purpose

Eliminate the design-development gap by producing machine-readable, unambiguous, complete specifications that engineering can consume directly without interpretation or guesswork.

### Why It Exists

Traditional handoff (screenshot + annotations) produces:
- Interpretation errors (what shade of blue is this?)
- Missing states (what does error look like?)
- Ambiguous spacing ("about 16px")
- Incomplete accessibility (ARIA? Keyboard? Focus?)
- Drift between design files and implemented code

### Specification Artifacts

| Artifact | Format | Contains | Consumer |
|----------|--------|----------|----------|
| Design Tokens | JSON/YAML | All visual values, named and typed | Build pipeline |
| Component Spec | Markdown + Code | API, states, accessibility, tokens mapping | Engineers |
| Interaction Spec | Video + Text description | Motion timing, easing, triggers | Engineers |
| Layout Spec | Code (CSS/constraints) | Grid, spacing, responsive behavior | Engineers |
| Accessibility Spec | Checklist | WCAG criteria, ARIA, focus management | Engineers + QA |

### Annotation Standards

Every design must be annotated for:
- Spacing (exact values from scale)
- Typography (token name + computed values)
- Color (token name + hex for reference)
- States (all interactive states)
- Responsive behavior (per breakpoint)
- Accessibility (labels, roles, focus)

### Redlines

Redlines are precise measurement annotations. Redline requirements:

```
┌─────────────────────────────────┐
│  ← 16px padding (space-4) →    │
│  ↑                              │
│  8px gap (space-2)              │
│  ↓                              │
│  ← 16px padding (space-4) →    │
└─────────────────────────────────┘
```

Never redline without token reference. Token name is authoritative; pixel value is computed.

### Design QA Process

```
Implementation Complete
    ↓
Visual Comparison (implementation vs. specification)
    ├── Spacing match token values?
    ├── Typography match type scale?
    ├── Colors match tokens?
    └── States all present?
    ↓
Accessibility Audit (automated + manual)
    ├── Contrast ratios
    ├── Keyboard navigation
    ├── Screen reader
    └── Focus management
    ↓
Responsive Audit
    ├── All breakpoints
    ├── Fluid behavior
    └── Content preservation
    ↓
Approved / Rework
```

### Anti-patterns

- "Make it look like the design" (subjective, unmeasurable)
- Design files as source of truth after implementation
- Manual specification extraction (measure in design tool, write in code)
- No accessibility specification in handoff
- Ignoring implementation constraints in design (designing impossible states)
- Skipping design QA on "minor" changes

---

# Decision Frameworks

## When to Create a New Component vs. Extend an Existing One

```
Question 1: Does the functionality already exist?
    ├── Yes → Question 2
    └── No → Create new component

Question 2: Is the visual difference achievable via props/variants?
    ├── Yes → Extend existing component
    └── No → Question 3

Question 3: Is the behavioral difference achievable via configuration?
    ├── Yes → Extend existing component
    └── No → Question 4

Question 4: Is the accessibility model fundamentally different?
    ├── Yes → Create new component
    └── No → Question 5

Question 5: Will extending the existing component violate single responsibility?
    ├── Yes → Create new component
    └── No → Extend existing component
```

## When to Use a Design Token vs. a Hardcoded Value

```
Is this visual decision shared across ≥2 components?
    ├── Yes → Design token
    └── No → Is it a system-level default?
                ├── Yes → Design token (future-proofing)
                └── No → Is it a one-off, context-specific exception?
                        ├── Yes → Commented hardcoded value with justification
                        └── No → Design token
```

## When to Add a New Breakpoint

```
Does the current design break (overlap, overflow, illegibility)?
    ├── Yes → At what viewport width does it break?
    │         └── Add breakpoint at that width + 20px buffer
    └── No → Do not add breakpoint
```

Never add breakpoints for hypothetical devices. Add them when content breaks.

## Animation Decision Matrix

```
Is the animation communicating state change?
    ├── Yes → Include (100-400ms, ease-out)
    └── No → Is it providing feedback for user action?
                ├── Yes → Include (100-200ms, ease-out)
                └── No → Is it orienting the user spatially?
                        ├── Yes → Include (200-400ms, ease-in-out)
                        └── No → Is it a loading state?
                                ├── Yes → Include (continuous)
                                └── No → Remove (decoration)
```

---

# Enterprise Standards

## Industry Standards

| Standard | Relevance | Compliance |
|----------|-----------|------------|
| WCAG 2.2 | Web accessibility | Level AA minimum |
| ISO 9241 | Ergonomics of human-system interaction | Reference for process |
| WAI-ARIA 1.2 | Accessible rich internet applications | All custom components |
| CSS Specifications | Web styling standards | Browser-compatible implementation |
| Material Design 3 | Reference design system | Inspiration, not compliance |
| Human Interface Guidelines | Apple platform design | iOS/macOS products |
| Section 508 | US federal accessibility | Applicable to government |
| EN 301 549 | European accessibility standard | Applicable to EU public sector |

## Design System as a Product

Treat the design system as an internal product:
- **Product Manager:** Design System Lead
- **Roadmap:** Prioritized by consumer needs and strategic goals
- **SLAs:** Bug fix time, support response time
- **Versioning:** Semantic versioning (MAJOR.MINOR.PATCH)
- **Deprecation:** 2 major versions before removal
- **Migration guides:** Required for all breaking changes

## Measuring Design Quality

| Metric | How to Measure | Target |
|--------|---------------|--------|
| Visual consistency | Component reuse rate | >80% |
| Accessibility | Automated audit score | 100% pass |
| Design velocity | Time from spec to implementation | <2 days for existing components |
| Design debt | Tokens not matching implementation | <5% |
| User comprehension | Task success rate | >90% |
| Perceived performance | User satisfaction scores | >4/5 |

---

# AI Engineering

## How AI Should Reason About Design

AI systems operating in this domain must treat design as an engineering discipline with objective constraints and measurable outcomes. Subjective aesthetic judgment should be minimized in favor of constraint-satisfaction reasoning.

### Reasoning Chain

```
Input: Design requirement
    ↓
1. Identify applicable constraints (accessibility, tokens, system rules)
    ↓
2. Search existing components/tokens/patterns for match
    ↓
3. If match found: reuse (with modification if needed)
    ↓
4. If no match: generate within constraint boundaries
    ↓
5. Validate against all measurable criteria
    ↓
6. Flag subjective elements for human review
    ↓
Output: Validated design specification + human review items
```

### Context Gathering

Before making any design decision, AI must check:
- Active design tokens
- Existing component library
- Accessibility baseline
- Platform constraints
- Responsive requirements
- Performance budget
- Brand constraints

### Decision Justification

Every AI-generated design decision must cite:
- Which principle or rule it follows
- Which constraint it satisfies
- Which alternative was considered and rejected
- What human validation is needed (if any)

### Common Errors AI Must Avoid

- **Token invention:** Creating `color-accent-magenta` when `color-accent` exists
- **Scale violation:** Using `13px` font size when scale defines `12px` or `14px`
- **Contrast assumption:** Declaring contrast sufficient without calculation
- **State omission:** Designing only default state for interactive components
- **Responsive blindness:** Designing for desktop viewport only
- **Accessibility last:** Adding accessibility after visual design
- **Naming inconsistency:** Breaking token naming conventions
- **Over-animation:** Adding motion without purpose justification

---

# Quality Standards

## Design Review Checklist

Every design specification must pass this review before implementation:

### Visual Quality
- [ ] All visual values sourced from design tokens
- [ ] Spacing adheres to spacing scale
- [ ] Typography uses defined type scale
- [ ] Color roles used appropriately (action, surface, text, etc.)
- [ ] No hardcoded values without documented justification

### Accessibility
- [ ] Color contrast meets AA minimum (all states)
- [ ] Focus indicators visible and compliant
- [ ] Touch targets minimum 44x44px (24x24px absolute minimum)
- [ ] Content not reliant on color alone
- [ ] Text alternatives provided for non-text content
- [ ] Semantic structure preserved

### Responsive
- [ ] Design specified at all breakpoints
- [ ] Content readable at 320px width
- [ ] No horizontal scroll at any supported width
- [ ] Fluid behavior between breakpoints acceptable

### Component Completeness
- [ ] All states defined (idle, hover, focus, active, disabled, loading, error)
- [ ] Edge cases addressed (empty, overflow, long text, RTL)
- [ ] Keyboard interaction specified
- [ ] Screen reader behavior specified

### Motion
- [ ] All animations have purpose
- [ ] Durations within guidelines
- [ ] Reduced motion alternative defined
- [ ] GPU-composited properties only

## Engineering Completion Checklist

- [ ] Token file updated
- [ ] Component specification documented
- [ ] Accessibility test cases written
- [ ] Visual regression baselines captured
- [ ] Storybook/documentation updated
- [ ] Migration guide for breaking changes
- [ ] Design System Council approval for new components

## Design QA Validation Rules

### Automated Checks (Must Pass)

| Check | Tool | Threshold |
|-------|------|-----------|
| Color contrast (all text) | axe-core, pa11y | AA: 4.5:1 (body), 3:1 (large) |
| Color contrast (non-text) | axe-core | AA: 3:1 |
| Valid ARIA attributes | axe-core | 0 violations |
| Valid HTML structure | HTML validator | 0 errors |
| Heading hierarchy | axe-core, custom | No skipped levels |
| Landmark structure | axe-core | At least main, nav (if applicable) |
| Image alt text | axe-core | All images have alt (or aria-hidden) |
| Form labels | axe-core | All inputs have labels |
| Token value match | Custom token checker | 100% token values match |

### Manual Checks (Per Component)

- [ ] Keyboard navigation (Tab, Enter, Escape, Arrows)
- [ ] Focus visible and logical
- [ ] Screen reader announces content correctly
- [ ] Touch targets ≥ 24px (44px recommended)
- [ ] Content readable at 200% zoom
- [ ] Content readable at 320px viewport width
- [ ] No horizontal scroll at supported widths
- [ ] All states functional and visually correct
- [ ] Motion respects reduced motion preference
- [ ] Works in forced-colors mode (Windows High Contrast)
- [ ] Content not clipped or overlapped at any breakpoint

### Design Consistency Audit (Per Release)

- [ ] No components using non-tokenized values (audit CSS/Swift/Kotlin output)
- [ ] Spacing values within defined scale (no magic numbers)
- [ ] Typography uses type scale (no ad-hoc sizes)
- [ ] Color usage matches semantic roles
- [ ] Component variants used instead of one-off modifications
- [ ] No orphaned or duplicate tokens

---

# Cross References

## CORE-AI-001
This document provides the design domain knowledge for AI systems. CORE-AI-001 governs HOW AI should operate; this document provides WHAT AI must know about design. AI validation rules in this document must be enforced by the mechanisms in CORE-AI-001.

## CORE-ARCH-001
Design components defined here become architectural components in CORE-ARCH-001. The component specification template in this document feeds the component architecture specification in CORE-ARCH-001. Design tokens are architectural constants.

## CORE-CONTEXT-001
User context from CORE-CONTEXT-001 drives design decisions—device type, user preferences (reduced motion, dark mode, font size), and environmental constraints. Design must consume context, not assume it.

## CORE-DOCS-001
This document follows the documentation standards in CORE-DOCS-001. Design system documentation is a specialized form of engineering documentation governed by CORE-DOCS-001.

## CORE-GOV-001
Design system governance (token versioning, component lifecycle, deprecation policy) aligns with the governance framework in CORE-GOV-001. Design system RFCs follow the governance RFC process.

## CORE-QUALITY-001
Design quality checks (accessibility audits, visual regression, token validation) are quality gates defined by CORE-QUALITY-001. This document defines WHAT to check; CORE-QUALITY-001 defines HOW to check.

## Design System ↔ Architecture
Design components define the visual contract. Architecture (CORE-ARCH-001) defines the technical contract. Component specifications must satisfy both. A button's visual spec (this document) and its API spec (CORE-ARCH-001) are the same component viewed from different concerns.

## Design System ↔ Context
User context (CORE-CONTEXT-001) drives design variation:
- `prefers-color-scheme` → dark mode tokens
- `prefers-reduced-motion` → minimal/no animation
- `prefers-contrast` → higher contrast token values
- Device type → touch target sizing, input modality
- Viewport size → layout adaptation

Design must consume context passively. Never force context (e.g., disable zoom, force light mode).

## Design System ↔ Quality
Quality Engineering (CORE-QUALITY-001) defines the validation pipeline. This document defines what constitutes a quality design output. CORE-QUALITY-001 enforces it through automated gates.

---

# Glossary

| Term | Definition |
|------|------------|
| **Above the Fold** | Content visible without scrolling |
| **Accessible Name** | The name of a UI element exposed to assistive technology |
| **Adaptive Design** | Design delivering distinct layouts at specific breakpoints |
| **Affordance** | The perceived action possibility of an interface element / Visual property suggesting how to interact |
| **ARIA** | Accessible Rich Internet Applications—attributes for accessibility |
| **Atomic Design** | Design methodology: atoms → molecules → organisms → templates → pages |
| **Autocomplete Attribute** | HTML attribute enabling browser autofill |
| **Breadcrumb** | Navigation trail showing current location in hierarchy |
| **Breakpoint** | A viewport width at which layout changes |
| **Cognitive Load** | The mental effort required to use an interface |
| **Composable** | Components combining to form more complex patterns |
| **Container Query** | A CSS feature allowing styling based on container/parent size |
| **Content Model** | What types of content a component accepts |
| **Contrast Ratio** | The luminance difference between two colors (1:1 to 21:1) |
| **Crisp Rendering** | Pixel-aligned rendering without anti-aliasing blur |
| **Dark Pattern** | A deliberately deceptive interface design |
| **Design Artifact** | A specification output consumed by engineering |
| **Design Debt** | The accumulation of design inconsistencies and accessibility issues / deviation between specified and implemented design |
| **Design Engineering** | The systematic application of constraints to produce interfaces |
| **Design Token** | A named, versioned entity storing a visual design decision |
| **Easing / Easing Curve** | The rate of change (mathematical function) of an animation over time |
| **Error Boundary** | Component that catches and handles child errors |
| **Fitts's Law** | Time to target = f(distance, size) |
| **Fluid Typography** | Type that scales smoothly between viewport sizes |
| **Focus Indicator** | Visual indication of which element has keyboard focus |
| **Forced Colors Mode** | OS-level color override for accessibility |
| **GPU Compositing** | Animation using GPU-only properties (transform, opacity) |
| **Hardcoded Value** | A literal value not sourced from a design token |
| **Heuristic Evaluation** | Expert review against established usability principles |
| **Hick's Law** | Decision time increases with number of choices |
| **Information Architecture** | The structural design of information spaces |
| **Information Scent** | Perceived indication of what lies beyond a link |
| **Layout Thrashing** | Forced synchronous layout recalculation |
| **Media Query** | A CSS feature for conditional styling based on viewport/media |
| **Off-canvas** | Navigation panel hidden off-screen until triggered |
| **Pixel Hinting** | Adjusting vector shapes to align to pixel grid |
| **POUR** | Perceivable, Operable, Understandable, Robust (WCAG principles) |
| **Progressive Disclosure** | Revealing complexity on demand |
| **Progressive Enhancement** | Baseline functionality everywhere, enhanced where supported |
| **Redline** | Annotated measurement specification |
| **Responsive Design** | Fluid layout that adapts continuously to viewport size |
| **Semantic Color** | Color named by purpose, not appearance |
| **Semantic Element** | HTML element conveying meaning (nav, main, article) |
| **Skeleton Screen** | Placeholder UI approximating content layout |
| **Token / Token Tier** | See Design Token; Token Tier = abstraction level (global, alias, component) |
| **Viewport** | Visible area of a web page |
| **Virtualization** | Rendering only visible items in a long list |
| **Visual Hierarchy** | The arrangement of elements to communicate importance |
| **Visual Regression** | Unintended visual change detected by comparison |
| **VPAT** | Voluntary Product Accessibility Template |
| **WCAG** | Web Content Accessibility Guidelines |
| **Z-index** | CSS property controlling stacking order |

---

# Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-07-28 | System | Initial Design Engineering System specification — combined document covering Identity & Purpose, Foundations, Modules 1–11 (Design System Architecture, Component Design Engineering, Responsive & Adaptive Design, Design-to-Code Pipeline, AI-Assisted Design Engineering, Layout Engineering, Interaction Design Engineering, Form Engineering, Iconography System, Information Architecture, Design Handoff & Specification), Decision Frameworks, Enterprise Standards, AI Engineering, Quality Standards, Cross References, and Glossary. |

---

**Document Complete — Parts 1 & 2 Merged.**
