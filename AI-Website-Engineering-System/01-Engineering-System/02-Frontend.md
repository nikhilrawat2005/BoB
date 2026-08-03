# Metadata

- **Document ID:** FE-ENG-001
- **Version:** 1.0.0
- **Category:** Engineering System
- **Status:** Production
- **Dependencies:** CORE-ARCH-001, CORE-QUALITY-001, CORE-AI-001, CORE-CONTEXT-001, CORE-DOCS-001, CORE-GOV-001
- **Scope:** Complete frontend engineering lifecycle from specification to deployment
- **Last Updated:** 2026-07-28

---

# Identity & Purpose

## Mission

To define the complete, authoritative engineering specification for all frontend systems within AI-WEOS, ensuring deterministic, maintainable, scalable, and performant user interfaces built on a foundation of semantic correctness, accessibility, and robust state management.

## Primary Objective

Establish an engineering-grade methodology for frontend development where every decision—from HTML element selection to rendering strategy—is intentional, testable, and aligned with system-wide architectural principles.

## Scope

This document covers the full spectrum of frontend engineering:

- Semantic HTML architecture and DOM engineering
- CSS architecture, layout systems, and design token pipelines
- JavaScript and TypeScript runtime behavior, type systems, and module strategy
- React component architecture, lifecycle, and composition patterns
- Next.js App Router, rendering strategies, and server-client boundaries
- State management classification and state residency decisions
- Performance measurement, optimization, and budgeting
- Web accessibility engineering (WCAG conformance)
- Frontend security model and threat mitigation
- Build system architecture and asset optimization
- Responsive and adaptive design systems
- Enterprise frontend governance and module federation

## Out of Scope

- Backend API implementation details (reference CORE-ARCH-001)
- Database schema design
- DevOps CI/CD pipeline implementation (configuration only)
- UI/UX design principles and visual design systems (tokens and constraints only)
- Native mobile development (React Native)
- WebAssembly internals beyond integration boundaries

## Engineering Philosophy

Frontend engineering is not visual design. It is a discipline of deterministic state machines rendering into a constrained runtime where layout, paint, and composition are subject to device heterogeneity, network variability, and human factors. Every byte delivered to the client is a liability. Every re-render is a cost. Every inaccessible component is a failure. The browser is not a forgiving platform—it silently fails at the worst possible moments.

The frontend engineer's responsibility extends from server-side rendering decisions through bundle composition to event loop scheduling. There is no "just make it work." There is only "make it correct, then make it fast, then make it resilient."

## Engineering Mindset

- **The DOM is an output, not a canvas.** It must be minimal, semantic, and predictable.
- **State drives everything.** If you don't know where state lives, you don't understand your component.
- **The network is unreliable.** Design for offline, degrade gracefully, hydrate meaningfully.
- **Performance is a feature, not an optimization.** Performance regressions are bugs.
- **Accessibility is not optional.** It is a constraint, like memory safety or type correctness.
- **The platform is the browser.** Understand the event loop, the rendering pipeline, and the parser.

## Core Principles

1. **Semantic Primacy** — Correct HTML elements before CSS before JavaScript. Progressive enhancement is the default.
2. **State Residency** — Every piece of state has exactly one authoritative location. Colocate state with its consumers, lift only when necessary.
3. **Deterministic Rendering** — Given identical props and state, a component must produce identical output. No side effects during render.
4. **Bundle Responsibility** — Every kilobyte shipped must justify its existence. Tree-shaking is not optional; it is architectural.
5. **Accessibility by Construction** — Components are inaccessible by default. Accessibility must be designed in, not bolted on.
6. **Type Safety Exhaustiveness** — TypeScript strict mode. No `any` without documented justification. Discriminated unions over optional properties.
7. **Boundary Discipline** — Server components run on the server. Client components run in the browser. The boundary is a hard contract, not a convenience.

## First Principles

- **The DOM is a tree of nodes with attributes and event listeners.** Everything else is abstraction.
- **CSS resolves to computed styles applied to nodes.** Cascade, specificity, and inheritance are the only mechanisms.
- **JavaScript is single-threaded in the browser main thread.** Long tasks block interaction. The event loop is shared.
- **React reconciliation is a diff between virtual trees.** The virtual DOM is an implementation detail; the cost is real.
- **HTTP requests are constrained by latency, bandwidth, and browser connection limits.** Every request has a waterfall cost.
- **The accessibility tree is a parallel DOM.** It must be complete regardless of visual presentation.
- **The browser parses HTML incrementally.** Blocking resources halt parsing. Streaming is not a pattern; it is how browsers work.
- **Time to Interactive is the only performance metric that correlates with user experience.** FCP and LCP are signals; TTI is truth.

---

# Foundations

## The Browser Runtime

### Definition
The browser runtime is the complete execution environment composed of the JavaScript engine, the rendering engine, the networking stack, and the Web APIs exposed to running code.

### Purpose
Understanding the runtime is not optional for frontend engineering. Every performance decision, every rendering strategy, every hydration approach depends on precise knowledge of how the browser processes, parses, renders, and executes.

### Why It Exists
The browser abstracts operating system GUI primitives, network protocols, and parsing algorithms into a sandboxed, cross-platform application environment. It is the only truly universal application runtime.

### Mental Model
```
HTML Parser → DOM Tree
CSS Parser → CSSOM Tree
DOM + CSSOM → Render Tree → Layout → Paint → Composite
JavaScript → Modifies DOM/CSSOM → Invalidates Render Tree → Reflow/Repaint
```

The critical path is synchronous: HTML parsing stops for blocking scripts. CSS blocks rendering but not parsing. JavaScript execution blocks everything. Understanding this sequence is fundamental to every loading performance decision.

### Relationship with Other Concepts
- The **Event Loop** orchestrates all execution. Macrotasks (requestAnimationFrame, setTimeout) and microtasks (Promise callbacks, MutationObserver) have different scheduling priorities.
- **Layout** (reflow) is the most expensive operation. It is triggered by reading geometric properties after mutations.
- **Paint** is the rasterization step. It is GPU-accelerated for composited layers.
- **Composite** is the final assembly of layers onto the screen. CSS `transform` and `opacity` can skip layout and paint entirely.

### Trade-offs
- **Client-side rendering**: Full interactivity at the cost of initial blank screen and JavaScript dependency.
- **Server-side rendering**: Fast FCP at the cost of Time to Interactive delay during hydration.
- **Static generation**: Instant delivery at the cost of build-time coupling and stale data.

### Common Misunderstandings
- "The virtual DOM is faster than the real DOM." False. The virtual DOM is always slower than direct DOM manipulation. Its value is in declarative programming and predictable state-to-UI mapping.
- "CSS is not a programming language." False. CSS is a declarative constraint solver. Its complexity rivals any programming paradigm.
- "Adding more CPU cores will speed up my web app." False. The browser main thread is single-threaded. Workers help but do not solve main thread congestion.

---

## State Management Architecture

### Definition
State management is the systematic governance of all mutable data within a frontend application, encompassing classification, residency, lifecycle, synchronization, and persistence.

### Purpose
Unmanaged state is the root cause of frontend bugs, performance degradation, and architectural collapse. State must be classified, constrained, and made predictable.

### State Classification

| Category | Definition | Examples | Residency | Lifespan |
|---|---|---|---|---|
| **URL State** | State encoded in the URL | Route params, search params, hash | URL bar | Navigation |
| **Server State** | Asynchronously fetched, server-owned | API responses, entities | External store (React Query, SWR) | Cache policy |
| **UI State** | Transient, component-local | Modal open, input focus, accordion expanded | `useState` | Component lifecycle |
| **Form State** | Ephemeral, uncommitted user input | Field values, validation errors, dirty flags | Form library (React Hook Form) | Form lifecycle |
| **Global UI State** | Cross-component UI coordination | Theme, locale, sidebar collapsed | Context or Zustand store | Session |
| **Derived State** | Computed from other state | Filtered list, total price, validation state | `useMemo`, selector | Render cycle |
| **Persisted State** | Survives page reloads | Auth token, user preferences | localStorage, IndexedDB, cookie | Explicit expiry |

### Mental Model: State Residency Decision Tree

```
Does this state need to survive a full page reload?
├── Yes → Is it sensitive?
│   ├── Yes → HttpOnly cookie (server-managed)
│   └── No → localStorage or IndexedDB
└── No → Is it needed by multiple unrelated components?
    ├── Yes → Is it derived from server state?
    │   ├── Yes → Colocate selector with server state cache
    │   └── No → Lift to nearest common ancestor or global store
    └── No → Does it need to survive component unmount?
        ├── Yes → Lift to parent
        └── No → Component-local useState
```

### Anti-Patterns

1. **Prop Drilling without Memoization** — Passing state through intermediate components that don't consume it causes unnecessary re-renders.
2. **Duplicated State** — Storing the same truth in multiple locations. The canonical state is the URL for navigation, the server for data, and the component for UI.
3. **Everything in Global Store** — Redux stores containing form state and modal visibility. This couples unrelated concerns and makes component reuse impossible.
4. **Derived State Stored as State** — Setting `fullName` in state when `firstName` and `lastName` exist. Use selectors or `useMemo`.
5. **Mixing Server State and UI State** — Storing API response data in React state without a caching layer leads to stale data and waterfall requests.

### Implementation Guidelines

**Server State Management (React Query/TanStack Query)**
```
- Every query has a key, a fetch function, and a cache policy
- Stale time: duration data is considered fresh (0 during development, 30s-5min in production)
- Cache time: duration inactive data remains in memory (default 5 minutes)
- Retry policy: exponential backoff with jitter for transient failures
- Optimistic updates: immediate UI response with rollback on failure
- Prefetching: on hover, on route change intention, during idle time
```

**Client State Management (Zustand for global, useState for local)**
```
- Stores are slices of related state, not one monolithic store
- Actions are functions that mutate state, not dispatch events
- Selectors derive minimal subscriptions; components only re-render when selected data changes
- Middleware: persist (localStorage adapter), devtools (Redux DevTools), immer (immutable updates)
```

---

## Rendering Strategies

### Definition
Rendering strategy determines where, when, and how HTML is generated and delivered to the browser, directly impacting performance metrics, SEO, and user experience.

### Classification Matrix

| Strategy | HTML Generated | JavaScript Required | FCP | TTI | SEO | Complexity |
|---|---|---|---|---|---|---|
| **Static Generation (SSG)** | Build time | No (until hydration) | Instant | Fast | Excellent | Low |
| **Server-Side Rendering (SSR)** | Request time | No (until hydration) | Fast | Delayed by JS | Excellent | Medium |
| **Incremental Static Regeneration (ISR)** | Build + background | No (until hydration) | Instant | Fast | Excellent | Medium |
| **Client-Side Rendering (CSR)** | Browser runtime | Yes | Slow | Slowest | Poor | Low |
| **Streaming SSR** | Request time (chunked) | No (selective) | Very Fast | Progressively | Excellent | High |
| **Partial Prerendering (PPR)** | Build + request | Selective | Instant | Optimized | Excellent | Very High |

### When to Use Each Strategy

**Static Generation**: Content that does not change between deployments. Marketing pages, documentation, blog posts where content is known at build time.

**Server-Side Rendering**: Content that changes per request or requires authentication but must be indexed. Dashboards behind login, user-specific pages, real-time data pages.

**Incremental Static Regeneration**: Large datasets with infrequent changes. E-commerce product pages, content with known update intervals.

**Client-Side Rendering**: Applications behind authentication where SEO is irrelevant. Admin panels, internal tools, WebSocket-driven real-time dashboards.

**Streaming SSR**: Pages with independent data dependencies where slow data should not block fast data. Product page with reviews (reviews can stream in later).

**Partial Prerendering**: The future default. Static shell instant delivery with dynamic holes filled as data becomes available.

### Hydration Deep Dive

Hydration is the process where React attaches event listeners to server-rendered HTML, reconciling the existing DOM with the virtual DOM.

**Hydration Mismatch Causes**:
- Using browser-only APIs during server render (`window`, `document`, `localStorage`)
- Rendering dates/times without consistent timezone handling
- Random values during render
- Client-only state affecting initial render

**Mitigation**:
- `useSyncExternalStore` for external state that must be consistent
- `suppressHydrationWarning` for intentional mismatches (timestamps)
- Client-only rendering with `useEffect` + `useState` toggle
- Next.js `dynamic(() => import(...), { ssr: false })` for components that cannot render server-side

---

## Component Architecture

### Definition
Component architecture is the systematic decomposition of a user interface into composable, reusable, testable units with explicit contracts defined by props, events, and slots.

### Component Classification

**Server Components** (Next.js App Router default)
- Cannot use state, effects, event handlers, or browser APIs
- Can be `async` and directly access databases, filesystems, and backend services
- Reduce bundle size by remaining server-only
- Should be the default choice; use client components only when necessary

**Client Components** (`"use client"` directive)
- Standard React components with full interactivity
- Add to JavaScript bundle; minimize their use
- Should be leaf nodes in the component tree when possible

**Compound Components**
- Components that share implicit state through context
- Provide flexibility without prop drilling
- Example: `<Select><SelectTrigger/><SelectOptions/><SelectOption/></Select>`

**Render Props Components**
- Pass a function as a child to invert control of rendering
- Useful for cross-cutting concerns like tracking, feature flags, authorization
- Being superseded by hooks but still valid for specific patterns

**Higher-Order Components**
- Functions that take a component and return an enhanced component
- Used for cross-cutting concerns in class component era
- Modern equivalent: custom hooks + wrapper components
- Legacy in new code; maintain existing HOCs, prefer hooks for new code

### Component Contract Design

Every component has:
1. **Props Interface** — Typed, documented, with sensible defaults
2. **Ref Forwarding** — When direct DOM access is necessary
3. **Event Handlers** — Following platform naming (`onClick`, not `handleClick`)
4. **Children/Composition** — Explicit about what children are expected
5. **Error Boundary** — What happens when this component throws
6. **Loading State** — What renders during async operations
7. **Empty State** — What renders with no data
8. **Error State** — What renders on data fetching error
9. **Edge Cases** — Zero-length strings, extreme values, rapid toggles

### Component Implementation Patterns

**Container/Presenter Pattern** (adapted for hooks era)
```
Container: Data fetching, state management, business logic, side effects
Presenter: Props in, JSX out. Pure function. Easily testable.
Separation: Container imports Presenter, not vice versa.
```

**Custom Hook Extraction**
```
When: Logic is reused across components
When: A component has multiple unrelated concerns
When: Logic is testable independently of rendering
Not when: It obscures understanding of a simple component
```

---

# Complete Knowledge Base

## Module 1: Semantic HTML Engineering

### Definition
Semantic HTML is the practice of using HTML elements according to their defined meaning and purpose, creating a document structure that is machine-readable, accessible, and resilient.

### Architecture
```
<html lang="en">
  <head> <!-- Metadata, resource hints, preloads --> </head>
  <body>
    <header> <!-- Banner, navigation landmark --> </header>
    <main>   <!-- Unique page content, exactly one per page -->
      <nav aria-label="Breadcrumb"> <!-- Secondary navigation --> </nav>
      <article> <!-- Self-contained composition -->
        <h1> <!-- Primary heading, exactly one per article/section nesting -->
        <section> <!-- Thematic grouping with heading --> </section>
        <aside> <!-- Tangentially related content --> </aside>
      </article>
    </main>
    <footer> <!-- Contentinfo landmark --> </footer>
  </body>
</html>
```

### Landmark Hierarchy

Landmarks create the accessibility navigation skeleton. Screen readers provide landmark navigation as a primary interaction mode.

| Landmark | HTML Element | Cardinality | Purpose |
|---|---|---|---|
| `banner` | `<header>` (top-level) | 1 per page | Site identity, primary nav |
| `navigation` | `<nav>` | Multiple | Navigation blocks |
| `main` | `<main>` | Exactly 1 | Unique page content |
| `complementary` | `<aside>` | Multiple | Supplementary content |
| `contentinfo` | `<footer>` (top-level) | 1 per page | Copyright, legal, secondary nav |
| `search` | `<form role="search">` | Typically 1 | Site search |
| `region` | `<section>` (with aria-label) | Multiple | Significant content areas |

### Heading Structure

Headings define the document outline. Each page has exactly one `<h1>`. Heading levels never skip (h1 → h2, never h1 → h3). Screen reader users navigate by heading hierarchy as their primary mode of content discovery.

```
<h1>Page Title</h1>
  <h2>Section</h2>
    <h3>Subsection</h3>
    <h3>Subsection</h3>
  <h2>Section</h2>
    <h3>Subsection</h3>
      <h4>Detail</h4>
```

### Interactive Element Engineering

**Buttons vs Links**
```
<button>: Performs an action on the current page. JavaScript behavior.
<a href="...">: Navigates to a resource. URL changes.
Never: <a href="#" onclick="..."> or <div onclick="..." role="button">
```

**Forms**
```
<form> requires:
- Accessible name (aria-label, aria-labelledby, or visible <label>)
- Submit mechanism (button type="submit")
- Validation feedback associated with controls via aria-describedby
- Error messages linked to fields
- Focus management on submission errors
```

### Anti-Patterns
1. `<div>` used as interactive controls without ARIA, tabindex, and keyboard handlers
2. Skipping heading levels for visual styling
3. Multiple `<main>` elements or no `<main>` element
4. Placeholder text replacing `<label>` elements
5. `<br>` used for spacing instead of CSS margin/padding

### Checklist
- [ ] Document has exactly one `<main>` element
- [ ] All pages have a unique, descriptive `<title>`
- [ ] `<html>` has correct `lang` attribute
- [ ] Heading hierarchy never skips levels
- [ ] All `<img>` have meaningful `alt` (or empty for decorative)
- [ ] Form inputs have associated `<label>`
- [ ] Landmarks are used appropriately
- [ ] ARIA is used only when HTML semantics are insufficient

---

## Module 2: CSS Architecture

### Definition
CSS architecture is the systematic organization of styles to achieve predictable cascade behavior, scalable selector specificity, consistent design token application, and minimal bundle size across large applications.

### Design Token Pipeline

Design tokens are the atomic values of a design system. They flow from definition to platform-specific output.

```
Source of Truth (JSON/YAML)
  ├── CSS Custom Properties
  ├── Tailwind config
  ├── Figma/Sketch plugins
  └── Documentation

Token Tiers:
  Tier 1: Raw Values — colors, spacing units, font sizes
  Tier 2: Semantic Aliases — color-primary, spacing-md
  Tier 3: Component Tokens — button-bg, card-padding
```

**Token Definition (JSON source)**
```json
{
  "color": {
    "blue": {
      "50": "#eff6ff",
      "500": "#3b82f6",
      "900": "#1e3a5f"
    },
    "primary": {
      "$value": "{color.blue.500}",
      "light": "{color.blue.50}",
      "dark": "{color.blue.900}"
    }
  },
  "spacing": {
    "xs": "0.25rem",
    "sm": "0.5rem",
    "md": "1rem",
    "lg": "1.5rem",
    "xl": "2rem"
  }
}
```

**CSS Custom Properties Output**
```css
:root {
  --color-primary: #3b82f6;
  --color-primary-light: #eff6ff;
  --color-primary-dark: #1e3a5f;
  --spacing-xs: 0.25rem;
  --spacing-md: 1rem;
  --spacing-xl: 2rem;
}
```

### Cascade Management Strategies

**Specificity Scale (0-0-0 system)**
```
A-B-C notation:
A = ID selectors
B = Class, attribute, pseudo-class selectors
C = Type, pseudo-element selectors

Universal (*): 0-0-0
Type (div): 0-0-1
Class (.card): 0-1-0
ID (#app): 1-0-0
Inline style: 1-0-0-0
!important: Overrides all (emergency only)

Target: B-tier specificity for component styles
Never: ID selectors in component CSS
Never: !important in library code
```

**Source Order Architecture**
```css
/* 1. Reset / Normalize */
@layer reset { ... }

/* 2. Design Tokens */
@layer tokens { ... }

/* 3. Base Elements */
@layer base { ... }

/* 4. Layout Primitives */
@layer layout { ... }

/* 5. Components */
@layer components { ... }

/* 6. Utilities (overrides) */
@layer utilities { ... }
```

Layers enforce cascade ordering regardless of source order and specificity. A later layer always wins over an earlier layer.

### Layout System

**Modern Layout Primitives**
```
display: grid — Two-dimensional layouts
display: flex — One-dimensional distribution
display: block — Document flow
display: inline — Text flow

Use grid for page layout and card grids.
Use flex for component internal alignment.
Avoid float and positioning for layout.
```

**Responsive Grid System**
```css
.page-grid {
  display: grid;
  grid-template-columns:
    [full-start] 1fr
    [wide-start] minmax(0, 8rem)
    [content-start] minmax(0, 64rem)
    [content-end] minmax(0, 8rem)
    [wide-end] 1fr
    [full-end];
}

.page-grid > * {
  grid-column: content;
}

.page-grid > .full-bleed {
  grid-column: full;
}
```

### Performance Considerations

1. **Selector Complexity**: Right-to-left matching. `.list > li:last-child` is more expensive than `.list-last-item`. Browsers optimize simple class selectors best.
2. **Layout Thrashing**: Reading layout properties (offsetHeight) after writing to DOM triggers synchronous reflow. Batch reads then writes.
3. **will-change**: Opt into GPU layer creation. Overuse consumes GPU memory. Apply before animation, remove after.
4. **contain**: Tells browser an element's subtree is independent. `contain: layout style paint` for list items.
5. **content-visibility**: `content-visibility: auto` skips rendering of off-screen content. Provides massive gains for long pages.

### Anti-Patterns
1. **Deeply nested selectors** (`.page .content .card .header .title`) — Fragile and expensive
2. **@import in CSS** — Creates blocking waterfall requests
3. **Undefined design tokens** — ad-hoc values (`margin: 13px`)
4. **Magic numbers** — Positioning with arbitrary pixel values
5. **Unscoped styles** — Global styles bleeding into components

### Decision Framework: CSS Solution

| Approach | When to Use | When Not to Use |
|---|---|---|
| **CSS Modules** | Component-scoped styles, team prefers CSS syntax | Design system tokens needed globally |
| **Tailwind CSS** | Rapid prototyping, utility-first philosophy, consistent constraints | Complex animations, very custom designs |
| **Styled Components** | Dynamic styling based on props, co-located styles | Server components (requires client) |
| **Vanilla Extract** | Type-safe CSS, zero runtime, server compatible | Dynamic runtime styling needs |
| **CSS Custom Properties** | Theming, runtime dynamic values | Static design tokens (use build-time variables) |

---

## Module 3: TypeScript Engineering

### Definition
TypeScript engineering is the practice of using the TypeScript type system as a design tool, leveraging types to encode invariants, eliminate entire categories of runtime errors, and create self-documenting interfaces.

### Type System Configuration

**Strict Baseline (non-negotiable)**
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

`strict: true` enables all strict mode flags. Individual flags exist only for incremental adoption in legacy codebases. New projects always use `strict: true`.

### Type Design Patterns

**Discriminated Unions** (Preferred over optional properties)
```typescript
// Anti-pattern: Optional properties
type ApiState = {
  data?: Data;
  error?: Error;
  loading?: boolean;
}

// Pattern: Discriminated union
type ApiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Data }
  | { status: 'error'; error: Error }
```

The compiler now enforces exhaustive checking. Impossible states (e.g., `loading` and `error` simultaneously) are unrepresentable.

**Branded Types** (Nominal typing in structural type system)
```typescript
type UserId = string & { readonly __brand: 'UserId' };
type OrderId = string & { readonly __brand: 'OrderId' };

function createUserId(id: string): UserId {
  return id as UserId;
}

// Compile error: UserId is not assignable to OrderId
function getOrder(id: OrderId) {}
getOrder(createUserId('123')); // Error
```

**Template Literal Types**
```typescript
type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type APIPath = `/api/${string}`;
type Endpoint = `${HTTPMethod} ${APIPath}`;
// "GET /api/users" is valid, "INVALID /api/users" is not
```

**Const Assertions**
```typescript
const ROUTES = {
  home: '/',
  dashboard: '/dashboard',
  settings: '/settings',
} as const;

type Route = typeof ROUTES[keyof typeof ROUTES];
// Route = "/" | "/dashboard" | "/settings"
```

### Generic Patterns

**Builder Pattern for Complex Objects**
```typescript
class QueryBuilder<T extends Record<string, unknown>> {
  private filters: Partial<T> = {};
  
  where<K extends keyof T>(key: K, value: T[K]): this {
    this.filters[key] = value;
    return this;
  }
  
  build(): Partial<T> {
    return { ...this.filters };
  }
}
```

**Type Guards for Runtime Validation**
```typescript
function isUser(obj: unknown): obj is User {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'name' in obj
  );
}

// Use with fetch
const data: unknown = await response.json();
if (isUser(data)) {
  // data is typed as User
}
```

### Anti-Patterns
1. **`any`** — Disables all type checking. Use `unknown` and narrow.
2. **Type assertions (`as`)** — Override compiler without evidence. Use type guards.
3. **`as const` on mutable objects** — Makes readonly, surprising mutations fail at runtime.
4. **Enum defaulting to numeric** — Use string enums or `as const` objects.
5. **Overly complex generics** — If you can't explain the type in one sentence, simplify.

---

## Module 4: React Engineering

### Definition
React engineering is the disciplined application of React's component model, reconciliation algorithm, and hooks system to build predictable, performant user interfaces with explicit data flow and minimal side effects.

### Component Lifecycle (Mental Model)

```
Mount: Component instance created → render → commit to DOM → effects run
Update: Props/state change → render → reconciliation → commit → cleanup previous effects → run new effects
Unmount: Cleanup effects → remove from DOM
```

**The Render Phase is Pure**: No side effects, no mutations, no subscriptions, no timers. Given the same props and state, the same output must be produced.

**The Commit Phase**: React applies changes to the DOM. Effects run after commit. This is where side effects belong.

### Hooks Deep Engineering

**`useState`**
```
- Lazy initializer: useState(() => expensiveComputation())
- Functional update: setState(prev => prev + 1) when new state depends on previous
- Batching: React 18 batches all state updates (even in timeouts, promises)
- Bailout: If new state === old state (Object.is), render is skipped
```

**`useEffect`**
```
- Timing: After paint (default), after layout (useLayoutEffect)
- Cleanup: Return function runs before next effect and on unmount
- Dependency array: Values from component scope used inside effect
- Empty array: Runs once on mount, cleanup on unmount
- No array: Runs after every render (almost always wrong)
```

**`useMemo` & `useCallback`**
```
- Only for referential stability or expensive computations
- Not for preventing re-renders (that's React.memo's job)
- React may discard memoized values and recalculate
- Do not memoize everything; measure first
```

**`useRef`**
```
- Mutable container that persists across renders without triggering re-renders
- DOM access: attach to JSX ref prop
- Instance variables: track previous values, timers, subscriptions
- Not for data that should trigger UI updates
```

### Composition Over Configuration

```
// Configuration pattern (anti-pattern in React)
<Modal
  title="Confirm"
  body="Are you sure?"
  footer={<button>OK</button>}
  isOpen={true}
/>

// Composition pattern
<Modal isOpen={true}>
  <Modal.Header>
    <Modal.Title>Confirm</Modal.Title>
  </Modal.Header>
  <Modal.Body>Are you sure?</Modal.Body>
  <Modal.Footer>
    <button>OK</button>
  </Modal.Footer>
</Modal>
```

Composition provides unlimited flexibility without prop explosion. Compound components share state through context.

### Server Components Integration

```
Page (Server Component)
├── fetch data directly from database
├── pass data as props to client components
├── no useState, useEffect, event handlers
│
├── InteractiveWidget (Client Component)
│   ├── receives serializable props
│   ├── manages local UI state
│   └── fires events to server actions
│
└── Suspense boundary
    └── AsyncServerComponent (Server Component)
        ├── streams in when ready
        └── shows fallback until resolved
```

### Server Actions (Next.js)

Server actions are async functions that run on the server but can be called from client components. They replace API routes for mutations in many cases.

**Design Principles**:
- Revalidate cache after mutation (`revalidatePath`, `revalidateTag`)
- Return typed results, not throw errors (use `useFormState` for validation)
- Optimistic update in client, rollback on server error
- Use `useTransition` for pending states

### Performance Optimization

**Render Optimization**
```
1. Move state down: If state only affects a subtree, colocate it there
2. Lift content up: Pass expensive children as props to avoid re-rendering them
3. React.memo: When component renders often with same props
4. useMemo/useCallback: Referential stability for memo'd children
5. Context splitting: Separate fast-changing and slow-changing context values
```

**Code Splitting**
```
Route-level: Next.js automatic by route segment
Component-level: dynamic(() => import('./HeavyComponent'), { loading: () => <Skeleton /> })
Library-level: Import only used functions (tree-shaking)
Conditional: Load feature only when needed (auth-gated features, rarely used modals)
```

---

## Module 5: Next.js App Router Engineering

### Definition
Next.js App Router is a file-system based routing framework built on React Server Components, providing integrated solutions for routing, rendering, data fetching, and server-client coordination.

### Routing Architecture

```
app/
├── layout.tsx        (Root layout, required)
├── page.tsx          (Home page, "/")
├── loading.tsx       (Suspense boundary for "/")
├── error.tsx         (Error boundary for "/")
├── not-found.tsx     (404 for "/" subtree)
│
├── dashboard/
│   ├── layout.tsx    (Dashboard layout, wraps all /dashboard/*)
│   ├── page.tsx      ("/dashboard")
│   ├── loading.tsx   (Suspense for "/dashboard")
│   ├── [id]/
│   │   └── page.tsx  ("/dashboard/:id")
│   └── settings/
│       └── page.tsx  ("/dashboard/settings")
```

**File Conventions**:
- `layout.tsx` — Persistent wrapper, state preserved across navigations
- `page.tsx` — Route content, becomes child of nearest layout
- `loading.tsx` — Shown during page/segment loading (Suspense boundary)
- `error.tsx` — Catches errors in child segments (must be client component)
- `not-found.tsx` — Shown when `notFound()` is called or route doesn't exist
- `template.tsx` — Like layout but remounts on navigation (for animations)
- `default.tsx` — Fallback for parallel routes

### Data Fetching Patterns

**Server Components (Direct Access)**
```typescript
async function Page() {
  const data = await db.query('SELECT ...'); // Direct database access
  return <ClientComponent initialData={data} />;
}
```

**Client Components (API Routes or Server Actions)**
```typescript
'use client';
import { useQuery } from '@tanstack/react-query';

function ClientComponent() {
  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(res => res.json()),
  });
}
```

**Hybrid: Server Component fetches, passes to Client Component**
```typescript
// Page (Server Component)
async function Page() {
  const initialData = await fetchData();
  return <InteractiveView initialData={initialData} />;
}

// InteractiveView (Client Component)
'use client';
function InteractiveView({ initialData }: { initialData: Data }) {
  const { data } = useQuery({
    queryKey: ['key'],
    queryFn: fetchData,
    initialData, // Hydrate cache with server data
  });
}
```

### Caching Architecture

Next.js has four caching layers:

| Cache | Location | Duration | Invalidation |
|---|---|---|---|
| **Request Memoization** | Server (per request) | Request lifetime | Automatic |
| **Data Cache** | Server (persistent) | Persistent | `revalidateTag`, `revalidatePath` |
| **Full Route Cache** | Server (persistent) | Persistent | Data cache invalidation or redeploy |
| **Router Cache** | Client (in memory) | Session or time-based | `router.refresh()`, revalidation |

**Cache Interactions**:
```
fetch() → Request Memoization (dedupes same request in one render)
  ↓
Data Cache (persists response across requests)
  ↓
Full Route Cache (caches rendered HTML of static routes)
  ↓
Router Cache (client-side cache for prefetched routes)
```

### Middleware

Middleware runs before every request. Use for:
- Authentication/authorization checks (redirect unauthenticated users)
- Geolocation-based routing
- A/B testing via cookie manipulation
- Bot protection
- Request rewriting

```typescript
export function middleware(request: NextRequest) {
  // Runs on Edge runtime, limited APIs
  // Must be fast (< 1.5ms budget)
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
```

Constraints:
- Edge runtime only (no Node.js APIs)
- Cannot directly access database (use fetch to external service)
- Must complete quickly

---

## Module 6: Frontend Security

### Definition
Frontend security is the engineering discipline of protecting client-side applications, their users, and their data from attacks that exploit the browser runtime, the DOM, network communication, and human factors.

### Threat Model

**XSS (Cross-Site Scripting)**

Attack vector: Injecting malicious scripts into pages viewed by other users.

```
Types:
- Stored: Malicious script saved to database, served to all visitors
- Reflected: Malicious script in URL/request, reflected in response
- DOM-based: Client-side code reads malicious data from DOM and executes it

Mitigation:
- React's default escaping (JSX auto-escapes {expression})
- Content Security Policy (CSP) headers
- dangerouslySetInnerHTML requires explicit sanitization (DOMPurify)
- Never concatenate user input into HTML strings
- Input validation and output encoding
```

**CSP Configuration**:
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random}';
  style-src 'self' 'unsafe-inline';
  img-src 'self' https: data:;
  font-src 'self';
  connect-src 'self' https://api.example.com;
  frame-ancestors 'none';
  form-action 'self';
```

**CSRF (Cross-Site Request Forgery)**

Attack vector: Tricking authenticated users into submitting unwanted requests.

```
Mitigation:
- SameSite cookies (SameSite=Lax or Strict)
- CSRF tokens in forms (Next.js Server Actions include CSRF protection)
- Custom request headers (browsers require CORS preflight for custom headers)
- Origin/Referer header validation
```

**Clickjacking**

Attack vector: Overlaying transparent iframes to trick users into clicking hidden elements.

```
Mitigation:
- X-Frame-Options: DENY or SAMEORIGIN
- frame-ancestors 'none' in CSP
```

### Authentication Token Storage

```
Session tokens (access tokens):
  HttpOnly, Secure, SameSite=Strict cookie
  Never: localStorage, sessionStorage, JavaScript-accessible cookie
  
Refresh tokens:
  HttpOnly, Secure, SameSite=Strict cookie
  Strict path (/api/auth/refresh only)
  Never: Accessible from frontend JavaScript

CSRF tokens:
  Can be in non-HttpOnly cookie (must be readable by JS)
  Double-submit cookie pattern
```

### Sensitive Data Handling

```
Never: API keys, secrets, or private keys in client code
Never: Personal data in URLs (use POST body or encrypted params)
Never: Sensitive data in console.log or error reports
Always: Environment variables prefixed with NEXT_PUBLIC_ are bundled with client code
Always: Audit bundle for accidentally exposed secrets
```

### Third-Party Scripts

```
Risk: Third-party scripts have full DOM access
Mitigation:
  - Load from own domain when possible
  - Subresource Integrity (SRI) hashes
  - Script isolation via sandboxed iframes
  - CSP restrictions on script sources
  - Regular audit of third-party script permissions
```

---

## Module 7: Performance Engineering

### Definition
Frontend performance engineering is the systematic measurement, optimization, and governance of metrics that correlate with user-perceived experience, specifically Core Web Vitals and custom business metrics.

### Core Web Vitals Engineering

**LCP (Largest Contentful Paint)** — 75th percentile < 2.5s

Measures when the largest content element becomes visible. Indicator of perceived load speed.

```
Optimization:
1. Server response time < 600ms TTFB
2. Resource prioritization (preload LCP image, preconnect origins)
3. Eliminate render-blocking resources
4. Use fetchpriority="high" on LCP image
5. Avoid lazy loading above-the-fold images
6. Optimize critical CSS (inline critical, defer non-critical)
```

**INP (Interaction to Next Paint)** — 75th percentile < 200ms

Replaces FID. Measures responsiveness to all interactions throughout page lifecycle.

```
Optimization:
1. Break long tasks (>50ms) into smaller tasks
2. Yield to main thread (scheduler.yield or setTimeout)
3. Avoid layout thrashing
4. Debounce vs throttle based on interaction type
5. Use Web Workers for heavy computation
6. React: useTransition for non-urgent updates
```

**CLS (Cumulative Layout Shift)** — 75th percentile < 0.1

Measures visual stability. The sum of all layout shifts during page lifespan.

```
Optimization:
1. Size attributes on images/videos (width, height, or aspect-ratio CSS)
2. Reserve space for dynamic content (skeleton, min-height)
3. Avoid inserting content above existing content
4. Font loading strategy (font-display: optional with fallback)
5. Transform animations (not properties that trigger layout)
```

### Resource Loading Strategy

**Preload**: High-priority resources needed soon on current page.
```
<link rel="preload" href="/fonts/main.woff2" as="font" crossorigin>
<link rel="preload" href="/hero.webp" as="image" fetchpriority="high">
Use: LCP image, critical fonts, critical JS/CSS
Not: Everything (dilutes preload scanner effectiveness)
```

**Prefetch**: Low-priority resources for future navigation.
```
<link rel="prefetch" href="/next-page.js" as="script">
Next.js: <Link prefetch> handles this automatically
```

**Preconnect**: Establish connection to origins before they're needed.
```
<link rel="preconnect" href="https://api.example.com">
<link rel="dns-prefetch" href="https://analytics.example.com">
```

### Bundle Optimization

**Tree Shaking**:
- Use ES module imports (import { specific } from 'library')
- Avoid barrel exports from non-tree-shakeable libraries
- `sideEffects: false` in package.json for libraries
- Verify with bundle analyzer

**Code Splitting Strategy**:
```
Route splitting: 50-100KB per route chunk (Next.js default)
Component splitting: >20KB or rarely used components
Vendor splitting: Framework chunk separate from application code
Shared splitting: Common dependencies across routes into shared chunk
```

**Bundle Budget**:
```
Initial JS (all routes): < 200KB compressed
Initial JS (individual route): < 100KB compressed
CSS: < 50KB compressed
Total page weight: < 1MB compressed
Images: < 200KB largest, WebP/AVIF format
Fonts: < 100KB total
```

### Measurement

**Lab Data** (Lighthouse, WebPageTest, Playwright):
- Controlled environment
- Consistent for regression detection
- Set performance budgets in CI

**Field Data** (RUM, CrUX, Web Vitals JS library):
- Real user experiences
- 75th percentile is the standard
- Segment by device, network, geography

**Monitoring**:
```
- Performance budgets enforced in CI/CD
- RUM data aggregated to dashboard
- Regression alerts on p75 degradation > 10%
- Performance tested on representative devices (Moto G4, not MacBook Pro)
```

---

## Module 8: Accessibility Engineering

### Definition
Accessibility engineering is the discipline of ensuring web applications are usable by people with disabilities, conforming to WCAG 2.2 AA standards at minimum, through semantic correctness, keyboard operability, screen reader compatibility, and inclusive design patterns.

### WCAG Conformance Level

**Target: WCAG 2.2 Level AA** for all user-facing interfaces.

| Principle | Level A (Essential) | Level AA (Standard) |
|---|---|---|
| **Perceivable** | Text alternatives, adaptable content, distinguishable | Color contrast (4.5:1), text resize to 200%, images of text |
| **Operable** | Keyboard accessible, enough time, seizures, navigable | Focus visible, multiple ways to find pages |
| **Understandable** | Readable, predictable, input assistance | Language of page, consistent navigation, error suggestions |
| **Robust** | Compatible with assistive technologies | Status messages, name/role/value for UI components |

### Keyboard Accessibility

All interactive elements must be operable via keyboard alone.

**Focus Order**: Logical DOM order determines focus order. Tabindex values > 0 create anti-patterns.

```
Focus management lifecycle:
1. Page load: Focus on skip link or main content
2. Modal open: Focus trapped inside, first focusable element focused
3. Modal close: Focus returned to triggering element
4. Route change: Focus moved to new page heading
5. Form error: Focus moved to first error field or error summary
```

**Focus Indicators**:
```
:focus-visible — Only show focus ring on keyboard interaction, not mouse
:focus — Never set outline: none without replacement
Minimum: 2px outline with 3:1 contrast ratio against adjacent colors
```

### Screen Reader Engineering

**ARIA Authoring Practices**:
```
Rule 1: Use native HTML over ARIA whenever possible
Rule 2: Do not change native semantics unless absolutely necessary
Rule 3: All interactive ARIA controls must be keyboard operable
Rule 4: Do not use role="presentation" or aria-hidden on focusable elements
Rule 5: All interactive elements must have accessible names
```

**Accessible Name Computation**:
```
Priority order:
1. aria-labelledby (references other elements)
2. aria-label
3. HTML label (for form controls)
4. Inner text content
5. title attribute (last resort)
```

**Live Regions**:
```
aria-live="polite" — Announce when user is idle
aria-live="assertive" — Interrupt current announcement
aria-atomic="true" — Announce entire region, not just changes
aria-relevant="additions removals" — What changes to announce

Use cases:
- Form validation errors
- Dynamic content updates (chat messages, stock ticker)
- Loading state transitions
- Search results count updates
```

### Testing Strategy

**Automated (CI Pipeline)**:
- axe-core (jest-axe, @axe-core/react)
- Lighthouse accessibility score > 90
- eslint-plugin-jsx-a11y

**Manual (PR Checklist)**:
- Keyboard navigation through complete user flows
- Screen reader testing (VoiceOver + Safari, NVDA + Firefox)
- 200% zoom without content loss
- Color contrast verification

**Audit (Periodic)**:
- External accessibility audit (at minimum before major releases)
- User testing with people with disabilities
- VPAT/ACR documentation for enterprise sales

### Common Component Patterns

**Modal Dialog**:
```
- aria-modal="true" or aria-hidden on rest of page
- role="dialog" with aria-labelledby
- Focus trap implementation
- Escape key closes
- Click outside overlay closes
- Focus returns to trigger on close
```

**Disclosure (Accordion)**:
```
- <button aria-expanded="true|false">
- aria-controls pointing to content panel ID
- Content panel: role="region" aria-labelledby pointing to button
- Keyboard: Enter/Space to toggle
```

**Tabs**:
```
- role="tablist" on container
- role="tab" with aria-selected on each tab button
- role="tabpanel" with aria-labelledby on each panel
- Keyboard: Left/Right arrows move between tabs, Home/End for first/last
```

---

## Module 9: Build Systems

### Definition
The build system is the automated pipeline that transforms source code, assets, and dependencies into optimized, production-ready static files suitable for deployment to web servers, CDNs, and edge networks.

### Build Pipeline Stages

```
Source Code (TSX, CSS, images)
  ↓
Linting & Type Checking
  ↓
Transpilation (TypeScript → JavaScript, JSX → createElement)
  ↓
CSS Processing (Tailwind, PostCSS, Sass → CSS)
  ↓
Module Resolution & Bundling (import graph → chunks)
  ↓
Minification (terser, cssnano)
  ↓
Asset Optimization (image compression, font subsetting)
  ↓
Output to static files (.next/static, out/)
```

### Bundler Architecture

**Turbopack** (Next.js default):
- Incremental computation model
- Function-level caching
- Rust-based for parallelism
- Handles HMR, code splitting, tree shaking

**Configuration Principles**:
- Never eject from framework defaults without documented justification
- Custom webpack config is a liability (maintenance burden, upgrade blockers)
- Prefer Next.js plugins over raw config overrides

### Asset Processing

**Images**:
```
- next/image: Automatic WebP/AVIF conversion, responsive sizes, lazy loading
- Import: import logo from './logo.svg' (SVGR for components, URL for img)
- Remote: Define domains in next.config.js images.remotePatterns
- Optimization: Image CDN (Cloudinary, imgix) for dynamic transforms
```

**Fonts**:
```
- next/font: Automatic subsetting, self-hosting, no layout shift
- Font display: 'swap' for text, 'optional' for icons
- Preload: Critical font files automatically preloaded
- Fallback: System font stack defined in CSS
```

**CSS**:
```
- CSS Modules: *.module.css, locally scoped by default
- Global CSS: app/globals.css imported in root layout
- Tailwind: Purges unused classes, outputs minimal CSS
- PostCSS: Autoprefixer, nesting, custom media queries
```

### Environment Configuration

```
.env.local — Local overrides (not committed)
.env.development — Development defaults
.env.production — Production defaults
.env.test — Test environment

NEXT_PUBLIC_* — Available in browser (use sparingly)
All other vars — Server-only

Never commit secrets to any .env file.
Use secret management service for production (Vault, AWS Secrets Manager).
```

### CI/CD Integration

```
PR Pipeline:
1. TypeScript check (tsc --noEmit)
2. Linting (ESLint, Prettier)
3. Unit tests (Vitest/Jest)
4. Build (next build)
5. Bundle analysis (compare to budget)
6. Lighthouse CI (performance, accessibility budgets)

Main Branch:
1. All PR checks
2. Integration/E2E tests (Playwright)
3. Deploy to staging
4. Smoke tests on staging
5. Deploy to production (with rollback capability)
```

---

## Module 10: Responsive Engineering

### Definition
Responsive engineering is the design and implementation of interfaces that adapt to any viewport size, input modality, device capability, and user preference, providing an optimal experience across the full spectrum of web-capable devices.

### Approach: Mobile-First Responsive Design

Mobile-first means designing for the most constrained environment first, then adding enhancements for larger viewports.

```
Base styles (mobile): 
  Single column layout
  Touch-friendly targets (minimum 44x44px)
  Reduced motion consideration
  Optimized images for smaller screens
  Essential content prioritized

Breakpoint additions:
  Tablet (≥640px): Multi-column where beneficial
  Desktop (≥1024px): Expanded layout, hover interactions
  Wide (≥1280px): Max-width constraints, additional columns
```

### Container Queries

Container queries enable components to adapt based on their container's size, not the viewport.

```css
.card-container {
  container-type: inline-size;
  container-name: card;
}

@container card (min-width: 400px) {
  .card {
    display: grid;
    grid-template-columns: 200px 1fr;
  }
}

@container card (max-width: 399px) {
  .card {
    display: flex;
    flex-direction: column;
  }
}
```

Container queries are the modern replacement for media queries inside reusable components. Media queries remain appropriate for page-level layout.

### Responsive Images

```
<picture>
  <source srcset="hero-avif.avif" type="image/avif">
  <source srcset="hero-webp.webp" type="image/webp">
  <img 
    src="hero.jpg" 
    alt="Description"
    width="1200"
    height="600"
    loading="lazy"
    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
  >
</picture>
```

`sizes` attribute tells the browser how wide the image will display at different breakpoints. The browser uses this to select the optimal resolution from `srcset`.

### Input Modality

```
Touch:
  - Click targets ≥ 44x44px (WCAG AAA: 44x44px, AA: 24x24px is insufficient)
  - No hover-dependent interactions
  - Gesture handling (swipe, pinch)
  
Mouse:
  - Hover states for affordance
  - Right-click context menus
  - Precise cursor control
  
Keyboard:
  - All interactions available via keyboard
  - Visible focus indicators
  - Skip links
  
Pointer coarse/pointer fine media queries:
  @media (pointer: coarse) { /* touch optimizations */ }
  @media (hover: hover) { /* hover effects */ }
```

### User Preferences

```
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
  }
}

@media (prefers-contrast: high) {
  /* Enhanced contrast for low-vision users */
}

@media (prefers-reduced-data: reduce) {
  /* Lower quality images, disable autoplay video */
}
```

---

## Module 11: Enterprise Frontend Engineering

### Definition
Enterprise frontend engineering extends standard frontend practices with organizational-scale concerns: multi-team collaboration, shared component libraries, micro-frontend architecture, governance models, and long-term maintainability across hundreds of contributors.

### Design System Engineering

A design system is the shared language between design and engineering, materialized as a versioned component library with strict API contracts.

**Component Library Architecture**:
```
packages/
├── design-tokens/     → CSS custom properties, Tailwind preset
├── ui-components/     → Presentational React components
├── feature-shell/     → App shell, routing, auth integration
├── utils/             → Shared utilities, hooks, types
└── config/            → ESLint, TypeScript, Prettier configs

Versioning: Semantic versioning with automated changelogs
Distribution: Private npm registry or monorepo workspace
Documentation: Storybook with interactive examples and props tables
Testing: Visual regression (Chromatic), unit, accessibility
```

**Component API Design Principles**:
- Props before composition before configuration
- Avoid breaking changes (use deprecation warnings first)
- Backward compatibility window: 2 major versions
- Every exported component has an accessible, documented API
- `displayName` set for debugging

### Micro-Frontend Architecture

Micro-frontends split a monolithic frontend into independently deployable sub-applications owned by different teams.

**Integration Approaches**:

| Approach | Coupling | DX | Performance | Complexity |
|---|---|---|---|---|
| **Module Federation** | Runtime JS | Medium | Medium | High |
| **iframe** | None | Low | Low | Low |
| **Web Components** | DOM | Medium | High | Medium |
| **Monorepo with separate deploys** | Build time | High | High | Low |

**Module Federation (via @module-federation/nextjs-mf)**:
```
Pros: Shared dependencies, runtime integration, independent deployment
Cons: Complex configuration, version mismatch risks, debugging difficulty
When: Multiple teams, independent release cycles, shared context
Not when: Single team, tight coupling between domains, early stage product
```

**Recommendation**: Start monolith. Split only when organizational scaling demands it. Micro-frontends solve organizational scaling problems, not technical problems.

### Feature Flags

Feature flags decouple deployment from release, enabling trunk-based development, A/B testing, and gradual rollouts.

```
Implementation tiers:
1. Build-time flags (environment variables) — Simple, requires redeploy
2. Runtime config (API at bootstrap) — Dynamic, minimal delay
3. Real-time flags (LaunchDarkly, Flagsmith) — Instant, full targeting

Pattern:
- Boolean flags for on/off features
- Multivariate flags for A/B testing
- Percentage rollout for gradual releases
- User targeting for beta programs

Code pattern:
if (featureFlags['new-checkout']) {
  return <NewCheckout />;
}
return <CurrentCheckout />;
```

### Monitoring and Observability

```
Error Monitoring (Sentry, Datadog RUM):
- Source maps uploaded during build
- Environment tagging (production, staging)
- Release version correlation
- Error grouping and deduplication
- Breadcrumb trail for reproduction

Performance Monitoring:
- Web Vitals to analytics (Google Analytics 4, custom RUM)
- Custom metrics for business-critical interactions
- Percentile aggregation (p50, p75, p95, p99)

User Behavior:
- Session replay (with privacy controls)
- Click/scroll heatmaps
- Conversion funnel analysis
```

### Internationalization (i18n)

```
Architecture:
- Translation keys, not English text
- ICU MessageFormat for plurals, gender, interpolation
- Static extraction at build time
- Dynamic loading of locale bundles
- RTL layout support (logical properties, not left/right)

Next.js App Router:
- [lang] route parameter or middleware-based locale detection
- next-intl or react-intl for React integration
- Date/time: Intl.DateTimeFormat with locale
- Numbers: Intl.NumberFormat with locale
- Collation: Intl.Collator for sorting

File structure:
messages/
├── en.json
├── de.json
├── ar.json (RTL)
└── ja.json
```

### Code Ownership and Review

```
CODEOWNERS:
/app/dashboard/* @team-dashboard
/packages/ui/* @design-system-team
*.css @design-system-team

Branch protection:
- Require PR approvals from CODEOWNERS
- Status checks must pass (CI, bundle budget, accessibility)
- Linear history (rebase merge)
- Signed commits
```

---

## Module 12: JavaScript Runtime Engineering

### Definition
JavaScript runtime engineering encompasses deep understanding of the language's execution model, memory management, concurrency patterns, and performance characteristics as they manifest in browser environments.

### Execution Model

**Single-Threaded Event Loop**
```
Call Stack: Synchronous execution, LIFO
Task Queue (Macrotasks): setTimeout, setInterval, I/O, UI rendering
Microtask Queue: Promise.then/catch/finally, queueMicrotask, MutationObserver
Animation Frame Queue: requestAnimationFrame

Execution Order Per Loop Tick:
1. Execute oldest macrotask
2. Execute all microtasks (including new microtasks added during execution)
3. Execute requestAnimationFrame callbacks
4. Render if needed
5. Repeat
```

Implication: Microtasks can starve rendering. A recursive microtask (e.g., `Promise.resolve().then(fn)` where `fn` queues another microtask) blocks the event loop entirely.

**Long Tasks**
Any task exceeding 50ms blocks input handling and risks missing frames (16.67ms at 60fps). The Total Blocking Time (TBT) metric sums time beyond 50ms for all long tasks before TTI.

### Memory Model

**Garbage Collection**:
Modern engines use generational, concurrent mark-and-sweep. Objects are allocated in "new space" (short-lived) and promoted to "old space" if they survive multiple collections.

**Common Memory Leaks**:
1. **Detached DOM nodes**: JavaScript references to removed DOM elements prevent GC
2. **Forgotten timers**: `setInterval` without `clearInterval`
3. **Closure retention**: Large objects captured in closures that outlive their usefulness
4. **Event listeners on removed elements**: Listeners hold references, preventing GC
5. **WebSocket/EventSource connections**: Never closed, accumulating handlers

**Detection**:
- Chrome DevTools Memory panel: Heap snapshot comparison
- Performance Monitor: JS heap size trend
- `performance.memory.usedJSHeapSize` for programmatic monitoring

### Concurrency Patterns

**Web Workers**
```
Dedicated Worker: One-to-one communication with creator
Shared Worker: Many-to-one, multiple browsing contexts
Service Worker: Proxy between app and network, enables offline

Communication: postMessage (structured clone, transferable objects)
Limitations: No DOM access, no window object, limited Web APIs
Use cases: Heavy computation, data processing, cryptography, image manipulation
```

**Transferable Objects**
```
ArrayBuffer, MessagePort, ImageBitmap can be transferred (zero-copy)
Transfer list: worker.postMessage(buffer, [buffer])
After transfer: buffer becomes detached in sender (length 0)
Benefit: Avoids copying large data structures
```

### Performance Optimization

**Startup Performance**
```
Parse → Compile → Execute phases
- Minimize JS shipped (code splitting)
- Defer non-critical JS (async/defer attributes)
- Use modern syntax (engines optimize for current spec)
- Avoid large inline scripts (block parser)
```

**Runtime Performance**
```
- Monomorphic property access (consistent object shapes)
- Avoid `delete` on objects (changes hidden class)
- Avoid `arguments` object (use rest parameters)
- Prefer `for...of` over `forEach` for large arrays (faster iteration)
- Object property order: Initialize in same order for same hidden class
```

**Hidden Classes (Shape Optimization)**
```javascript
// Monomorphic (fast)
function Point(x, y) {
  this.x = x;  // Shape: {x}
  this.y = y;  // Shape: {x, y}
}
const p = new Point(1, 2); // Same shape as all Point instances

// Polymorphic (slower)
const o1 = { a: 1 };
o1.b = 2;  // Shape transition
const o2 = { b: 2, a: 1 };  // Different shape (different property order)
```

### Module System

**ES Modules (ESM)**
```
- Static structure (imports analyzed at parse time)
- Live bindings (imported values reflect mutations)
- Async loading in browsers
- Tree-shakeable
- Default for modern projects

// Static import
import { named } from './module.js';

// Dynamic import (code splitting)
const module = await import('./heavy-module.js');
```

**CommonJS (CJS)**
```
- Dynamic (require() can be conditional)
- Value copies, not live bindings
- Synchronous loading
- Not tree-shakeable by default
- Still used in Node.js ecosystem
```

**Module Resolution**:
- Browsers: ESM with explicit extensions and URLs
- Bundlers: Enhanced resolution (extensionless, directory indexes)
- TypeScript: Configured via `moduleResolution` (bundler, node16, nodenext)

---

## Module 13: CSS Layout Engineering

### Definition
CSS layout engineering is the systematic application of CSS layout algorithms—Flow, Flexbox, Grid, and Positioning—to create robust, responsive layouts that adapt to content and viewport constraints without brittle, magic-number-based positioning.

### Layout Algorithms

**Normal Flow** (Block and Inline)
```
Block Formatting Context:
- Block boxes stack vertically
- Margins collapse between adjacent blocks
- Width: fills containing block
- Height: content height

Inline Formatting Context:
- Inline boxes flow horizontally, wrapping to next line
- Vertical alignment via vertical-align
- Line boxes created to contain inline content
```

**Flexbox** (Flexible Box Layout)
```
Parent properties:
- display: flex | inline-flex
- flex-direction: row | row-reverse | column | column-reverse
- justify-content: main axis alignment
- align-items: cross axis alignment (single line)
- align-content: cross axis alignment (multi-line)
- flex-wrap: nowrap | wrap | wrap-reverse
- gap: spacing between items

Child properties:
- flex: <flex-grow> <flex-shrink> <flex-basis>
- flex-grow: distribution of remaining space
- flex-shrink: how item shrinks when space is insufficient
- flex-basis: initial size before distribution
- align-self: override align-items
- order: visual order (use cautiously, affects accessibility)
```

**CSS Grid**
```
Parent properties:
- display: grid | inline-grid
- grid-template-columns / grid-template-rows: track definitions
- grid-template-areas: named layout regions
- gap: row-gap column-gap
- grid-auto-rows / grid-auto-columns: implicit track sizing
- grid-auto-flow: row | column | dense
- align-items / justify-items: cell alignment
- align-content / justify-content: grid container alignment

Child properties:
- grid-column: start / end (or span N)
- grid-row: start / end (or span N)
- grid-area: named area reference
- align-self / justify-self: per-item alignment
```

**Track Sizing Functions**:
```
- fr: Fraction of available space (distributed after fixed tracks)
- minmax(min, max): Constrain track size
- auto: Content-based sizing
- min-content: Smallest size without overflow
- max-content: Largest size without wrapping
- fit-content(max): min(max-content, max(min-content, argument))
```

### Positioning Schemes

**Static**: Default, part of normal flow.

**Relative**: Offset from normal flow position. Original space preserved.

**Absolute**: Removed from flow. Positioned relative to nearest positioned ancestor (or initial containing block). Original space collapses.

**Fixed**: Removed from flow. Positioned relative to viewport. Does not scroll.

**Sticky**: Hybrid. In flow until scroll threshold, then fixed within containing block.

### Stacking Contexts

Every positioned element with `z-index` not `auto`, elements with `opacity < 1`, `transform`, `filter`, `perspective`, `clip-path`, `mask`, `isolation: isolate`, and `will-change` values create a new stacking context.

```
Stacking order (bottom to top):
1. Root stacking context background and borders
2. Negative z-index positioned descendants
3. Non-positioned, non-floating block elements (flow)
4. Non-positioned floating elements
5. Inline, inline-block descendants (flow)
6. z-index: auto / z-index: 0 positioned descendants
7. Positive z-index positioned descendants
```

### Anti-Patterns
1. **Fixed height on content containers** — Content changes, layout breaks
2. **Negative margins for layout** — Fragile, unpredictable with content changes
3. **Absolute positioning for page layout** — Not responsive, not content-aware
4. **Nested `overflow: hidden`** — Traps focus, hides important content
5. **Overlapping absolute elements without `z-index` management**

### Enterprise Patterns

**Full-Bleed Layout with Constrained Content**:
```css
.full-bleed {
  width: 100vw;
  margin-left: 50%;
  transform: translateX(-50%);
}
```

**Equal Height Columns (Flexbox)**:
```css
.columns {
  display: flex;
  /* align-items: stretch is default, columns match height */
}
```

**Holy Grail Layout (Grid)**:
```css
.holy-grail {
  display: grid;
  grid-template: auto 1fr auto / 200px 1fr 200px;
  grid-template-areas:
    "header header header"
    "nav    main   aside"
    "footer footer footer";
  min-height: 100vh;
}
```

---

## Module 14: Testing Engineering

### Definition
Frontend testing engineering establishes the strategy, tools, and practices for verifying that user interfaces behave correctly, remain accessible, perform within budgets, and resist regressions across changes.

### Testing Trophy (Modern Hierarchy)

```
              E2E
             /    \
        Integration
       /          \
    Unit            Static
```

Priority and investment should be inversely proportional to the pyramid position. Static analysis catches the most bugs per unit of effort. E2E tests catch critical user flows but are expensive.

### Static Analysis

**TypeScript**: Catches type errors, null reference errors, incorrect prop usage. Runs at compile time. Near-zero execution cost.

**ESLint**: Enforces code patterns, catches common bugs (`react-hooks/exhaustive-deps`), accessibility violations (`jsx-a11y`).

**Prettier**: Eliminates formatting debates. Not negotiable; must be automated.

### Unit Testing

Test individual functions, hooks, and utilities in isolation. Mock external dependencies.

```typescript
// Testing a pure function
describe('calculateDiscount', () => {
  it('applies percentage discount', () => {
    expect(calculateDiscount(100, 20)).toBe(80);
  });
  
  it('returns original price when discount is 0', () => {
    expect(calculateDiscount(100, 0)).toBe(100);
  });
  
  it('throws when discount exceeds 100', () => {
    expect(() => calculateDiscount(100, 101)).toThrow();
  });
});
```

**Custom Hook Testing**:
```typescript
import { renderHook, act } from '@testing-library/react';

test('useCounter increments', () => {
  const { result } = renderHook(() => useCounter(0));
  
  act(() => {
    result.current.increment();
  });
  
  expect(result.current.count).toBe(1);
});
```

### Component Testing

Test components in isolation with controlled props and mocked context.

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('button triggers click handler', async () => {
  const handleClick = vi.fn();
  render(<Button onClick={handleClick}>Click me</Button>);
  
  await userEvent.click(screen.getByRole('button', { name: 'Click me' }));
  
  expect(handleClick).toHaveBeenCalledOnce();
});
```

**Testing Strategy by Component Type**:
- **Presentational components**: Snapshot tests + prop variation tests
- **Interactive components**: User event simulation + state verification
- **Data-fetching components**: Mock API responses, test loading/error/success states
- **Form components**: Submit, validation, error display

### Integration Testing

Test component compositions and data flow between components.

```typescript
test('search filters and displays results', async () => {
  render(<SearchPage />);
  
  await userEvent.type(screen.getByRole('searchbox'), 'react');
  
  expect(await screen.findByText('React Documentation')).toBeVisible();
  expect(screen.queryByText('Vue Guide')).not.toBeInTheDocument();
});
```

### E2E Testing (Playwright)

Test complete user flows in real browser environments.

```typescript
test('user completes checkout flow', async ({ page }) => {
  await page.goto('/products');
  await page.click('[data-testid="add-to-cart"]');
  await page.click('[data-testid="cart-icon"]');
  await page.click('[data-testid="checkout"]');
  await page.fill('[name="email"]', 'test@example.com');
  await page.click('[data-testid="submit-order"]');
  
  await expect(page.locator('[data-testid="confirmation"]')).toBeVisible();
});
```

**Selection Strategy**:
- `getByRole` (preferred, mirrors accessibility)
- `getByLabel` (form inputs)
- `getByTestId` (last resort, when no semantic selector exists)
- Never: CSS class selectors, XPath, DOM structure traversal

### Visual Regression Testing

Catch unintended visual changes. Compare screenshots of components against baselines.

```
Tools: Chromatic, Percy, Playwright screenshot comparison
Granularity: Per-component story, per-page layout
Threshold: 0% pixel difference (any change is intentional or a bug)
```

### Test Data Management

```
- Factory functions over fixtures (generate data with sensible defaults)
- Faker.js for realistic but deterministic test data
- Mock Service Worker (MSW) for API mocking at network level
- Test databases with known state, reset between tests
- Never: Tests depending on external APIs or shared mutable state
```

### Coverage and Quality

**Coverage Targets**:
- Lines: 80% (overall), 90% (critical paths)
- Branches: 80%
- Functions: 90%

**Coverage is Not Quality**:
Coverage measures which code is executed, not which behavior is verified. Focus on behavioral coverage: loading states, error states, empty states, edge cases, permission states, and interaction sequences.

---

## Module 15: Animation Engineering

### Definition
Animation engineering is the disciplined use of motion in user interfaces to provide feedback, guide attention, and create spatial mental models, implemented in ways that respect user preferences, device capabilities, and performance budgets.

### Animation Principles for Engineering

1. **Purpose**: Every animation has intent (feedback, orientation, delight). No animation without purpose.
2. **Duration**: 100-300ms for micro-interactions, 300-500ms for transitions, under 100ms for direct manipulation.
3. **Easing**: `ease-out` for entering elements, `ease-in` for exiting elements, `cubic-bezier()` for custom curves.
4. **Performance**: Only animate `transform` and `opacity`. Never `width`, `height`, `top`, `left`, `margin`, `padding`.

### CSS Animations

**Transitions**: Simple state changes.
```css
.button {
  transform: scale(1);
  transition: transform 150ms ease-out;
}

.button:hover {
  transform: scale(1.05);
}

.button:active {
  transform: scale(0.98);
  transition-duration: 50ms;
}
```

**Keyframe Animations**: Complex, multi-step animations.
```css
@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.modal {
  animation: slide-in 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .modal {
    animation: none;
    opacity: 1;
  }
}
```

**Animation Performance Properties**:
```
transform: translate(), scale(), rotate() — GPU accelerated, compositor-only
opacity — GPU accelerated, compositor-only
filter: blur(), brightness() — GPU accelerated but expensive

Never animate:
width, height — Triggers layout
top, left, right, bottom — Triggers layout
margin, padding — Triggers layout
border-width — Triggers layout
color, background-color — Triggers paint (less expensive than layout)
```

### JavaScript Animations

Use when CSS cannot express the animation (physics-based, scroll-linked, complex sequencing).

**Web Animations API**:
```typescript
element.animate(
  [
    { transform: 'translateY(100%)', opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 },
  ],
  {
    duration: 300,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    fill: 'both',
  }
);
```

**Framer Motion** (React):
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -20 }}
  transition={{ duration: 0.2 }}
>
  {content}
</motion.div>
```

**Scroll-Linked Animations**:
```typescript
// Scroll-driven animations (modern browsers)
element.animate(
  { transform: ['scale(0.8)', 'scale(1)'] },
  { 
    timeline: new ViewTimeline({ subject: element }),
    rangeStart: 'entry 0%',
    rangeEnd: 'entry 100%',
  }
);
```

### Enterprise Animation Patterns

**Shared Element Transitions**:
```typescript
// View Transitions API (Next.js support evolving)
document.startViewTransition(() => {
  // DOM update that triggers transition
  updateDOM();
});
```

**Layout Animations**:
```tsx
<AnimatePresence>
  {items.map(item => (
    <motion.li
      key={item.id}
      layout // Automatically animates position changes
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {item.content}
    </motion.li>
  ))}
</AnimatePresence>
```

### Accessibility in Animation

```
1. prefers-reduced-motion: reduce → Disable all non-essential motion
2. Animation duration under 5 seconds (WCAG 2.2.2: Pause, Stop, Hide)
3. No flashing content (WCAG 2.3.1: Three Flashes or Below Threshold)
4. Parallax effects within motion-reduction boundaries
5. Carousel auto-play must have pause control
```

---

## Module 16: Form Engineering

### Definition
Form engineering is the systematic design and implementation of data entry interfaces that handle validation, submission, error recovery, and accessibility with reliability and user empathy.

### Form Architecture

**Uncontrolled vs Controlled**:
```
Uncontrolled: DOM maintains state. useRef for reading values.
  Pros: Performant for large forms. No re-renders per keystroke.
  Cons: Harder to implement dynamic validation, conditional fields.

Controlled: React state maintains values. value + onChange pattern.
  Pros: Full control over value, validation, formatting.
  Cons: Re-renders on every keystroke.

Recommendation: React Hook Form (uncontrolled by default, controlled when needed).
```

### Validation Strategy

**Validation Layers**:
```
1. HTML validation attributes (first line of defense, accessible)
   - required, type="email", minlength, maxlength, pattern
   
2. Client-side validation (instant feedback)
   - On blur: Validate individual field
   - On change: Clear error when user fixes
   - On submit: Validate all fields
   
3. Server-side validation (authoritative)
   - Return structured errors (field -> message mapping)
   - Use useFormState for server validation in Next.js
```

**Schema-Based Validation (Zod)**:
```typescript
const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain number'),
  age: z.number().min(18, 'Must be at least 18'),
});

type FormData = z.infer<typeof schema>;

// React Hook Form integration
const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(schema),
});
```

### Error Handling Patterns

**Field-Level Errors**:
```
- Error message associated with input via aria-describedby
- Input aria-invalid="true" when errored
- Error icon with appropriate alt text
- Error color not the only indicator (also use icon, text)
```

**Form-Level Errors**:
```
- Error summary at top of form (for screen readers)
- Focus moved to error summary or first error field
- Error count announced: "Form has 2 errors"
```

### Complex Form Patterns

**Multi-Step Forms (Wizard)**:
```
- Each step is validated independently
- Progress indicator (steps 1/4)
- Data persisted across steps (React state or sessionStorage)
- Back button restores previous step data
- Final submission aggregates all step data
```

**Dynamic Fields (Add/Remove)**:
```typescript
const { fields, append, remove } = useFieldArray({
  control,
  name: 'items',
});

{fields.map((field, index) => (
  <div key={field.id}>
    <input {...register(`items.${index}.name`)} />
    <button onClick={() => remove(index)}>Remove</button>
  </div>
))}
<button onClick={() => append({ name: '' })}>Add Item</button>
```

**Conditional Fields**:
```
- Show/hide based on other field values
- Preserve hidden field values or clear them (documented behavior)
- Animate show/hide with CSS (not conditional rendering for smooth transitions)
```

### Accessibility Requirements

```
- Every input has a visible <label> (not just placeholder)
- Required fields indicated by text and aria-required (not just color/asterisk)
- Error messages linked to inputs with aria-describedby
- Group related fields with <fieldset> and <legend>
- Autocomplete attributes for common fields (name, email, address)
- Submit button is always keyboard accessible
```

### Security Considerations

```
- Client-side validation is for UX, not security
- All validation must be repeated server-side
- CSRF protection on all mutation endpoints
- Rate limiting on form submissions
- Input sanitization on server (XSS prevention)
- File upload: type validation, size limits, malware scanning
```

---

## Module 17: Offline and Resilience Engineering

### Definition
Offline and resilience engineering ensures frontend applications remain functional, informative, and data-safe under adverse network conditions, including complete disconnection, high latency, and intermittent connectivity.

### Service Workers

Service workers intercept network requests, enabling caching strategies and offline functionality.

**Lifecycle**:
```
1. Register: navigator.serviceWorker.register('/sw.js')
2. Install: Cache critical assets (App Shell)
3. Activate: Claim clients, clean old caches
4. Fetch: Intercept requests, serve from cache or network
5. Update: New service worker detected, waits until all clients close
```

**Caching Strategies**:

| Strategy | Pattern | Use Case | Offline? |
|---|---|---|---|
| **Cache First** | Cache → Network fallback | Static assets, app shell | Yes |
| **Network First** | Network → Cache fallback | API data that must be fresh | Degraded |
| **Stale While Revalidate** | Cache → Network (background update) | Frequently updated, non-critical | Yes (stale) |
| **Network Only** | Always fetch | Real-time data, financial | No |
| **Cache Only** | Always from cache | Immutable assets | Yes |

**Implementation (Workbox)**:
```javascript
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

// Static assets: Cache first
registerRoute(
  ({ request }) => request.destination === 'style' || request.destination === 'script',
  new CacheFirst({ cacheName: 'static-resources' })
);

// API: Network first, fallback to cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-responses', networkTimeoutSeconds: 3 })
);

// Images: Stale while revalidate
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'images' })
);
```

### Offline UI Patterns

**Connectivity Detection**:
```typescript
function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  return online;
}
```

**Optimistic UI**:
```
1. Immediately update UI to reflect user action
2. Queue mutation for when connectivity returns
3. On success: UI remains updated
4. On failure: Roll back UI, show error
5. On offline: Queue mutation, sync when online
```

**Data Persistence**:
```
- IndexedDB for structured data (via idb or Dexie.js)
- Cache API for HTTP responses
- localStorage for small configuration/preferences (5MB limit)
- Background Sync API for deferred mutations
```

### Graceful Degradation

```
Network condition: Excellent (4G/5G)
  → Full experience, high-res images, autoplay video

Network condition: Slow (3G)
  → Compressed images, no autoplay, skeleton screens

Network condition: Offline
  → Cached content, queued actions, clear offline indicator
  → Forms: Save drafts locally, submit when online
  → Search: Local search of cached data
  → Payments: Disable (cannot process offline)
```

### Resilience Patterns

**Retry with Backoff**:
```typescript
async function fetchWithRetry(url: string, retries = 3, backoff = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, backoff * 2 ** i));
    }
  }
}
```

**Circuit Breaker**:
```
- Track failure count over time window
- When failures exceed threshold, stop attempting
- After cooldown period, try one request (half-open state)
- If succeeds, close circuit. If fails, reset cooldown.
```

**Request Deduplication**:
```typescript
const inflight = new Map<string, Promise<unknown>>();

async function dedupedFetch(url: string) {
  if (inflight.has(url)) return inflight.get(url);
  
  const promise = fetch(url).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  
  return promise;
}
```

---

## Module 18: Web APIs Integration

### Definition
Web APIs integration engineering covers the systematic use of browser-provided APIs for capabilities beyond DOM manipulation, including storage, multimedia, device access, and platform integration.

### Storage APIs

| API | Persistence | Capacity | Sync | Access | Use Case |
|---|---|---|---|---|---|
| **localStorage** | Permanent | 5-10MB | No | Synchronous | Preferences, small config |
| **sessionStorage** | Tab session | 5-10MB | No | Synchronous | Per-tab ephemeral data |
| **IndexedDB** | Permanent | Large (quota-based) | No | Async | Structured data, offline |
| **Cache API** | Permanent | Quota-based | Service Worker | Async | HTTP response caching |
| **Cookies** | Expiry-based | 4KB | Server | Synchronous | Auth tokens, session IDs |

**IndexedDB Usage**:
```typescript
import { openDB } from 'idb';

const db = await openDB('app-db', 1, {
  upgrade(db) {
    db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('cache', { keyPath: 'url' });
  },
});

// Store
await db.put('drafts', { title: 'Untitled', content: '...' });

// Retrieve
const draft = await db.get('drafts', 1);

// Query
const allDrafts = await db.getAll('drafts');
```

### Web APIs by Category

**Multimedia**:
- **Web Audio API**: Audio processing, synthesis, visualization
- **MediaStream (getUserMedia)**: Camera, microphone access
- **MediaRecorder**: Record audio/video streams
- **Screen Capture API**: Screen sharing
- **Picture-in-Picture API**: Floating video window

**Graphics**:
- **Canvas API**: 2D drawing, image manipulation, pixel access
- **WebGL/WebGL2**: 3D graphics, GPU compute
- **WebGPU**: Next-gen GPU API (successor to WebGL)
- **OffscreenCanvas**: Canvas in Web Workers

**Device**:
- **Geolocation API**: User location
- **Device Orientation API**: Device tilt/rotation
- **Vibration API**: Haptic feedback
- **Battery Status API**: Battery level (deprecated for privacy)
- **Clipboard API**: Read/write clipboard

**Communication**:
- **WebSocket**: Full-duplex communication
- **Server-Sent Events**: Server-to-client streaming
- **WebRTC**: Peer-to-peer audio/video/data
- **Broadcast Channel API**: Cross-tab communication
- **Channel Messaging API**: iframe/worker communication

**Performance & Observation**:
- **Performance API**: Navigation timing, resource timing, custom marks
- **Intersection Observer**: Element visibility detection
- **Mutation Observer**: DOM change detection
- **Resize Observer**: Element size changes
- **Reporting Observer**: Deprecation, intervention, crash reports

**Platform Integration**:
- **Web Share API**: Native share dialog
- **Web Push API**: Push notifications
- **Payment Request API**: Streamlined checkout
- **Credential Management API**: Password/credential autofill
- **File System Access API**: Read/write local files

### API Feature Detection

Always detect before using:
```typescript
if ('share' in navigator) {
  // Web Share API available
}

if ('serviceWorker' in navigator) {
  // Service Workers supported
}

// CSS feature detection
if (CSS.supports('display', 'grid')) {
  // CSS Grid supported
}

// Media query detection
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  // Dark mode preferred
}
```

### Observer Pattern APIs

```typescript
// Intersection Observer (lazy loading, scroll animations)
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        loadImage(entry.target);
        observer.unobserve(entry.target);
      }
    });
  },
  { rootMargin: '200px' } // Start loading 200px before visible
);

// Resize Observer (responsive components)
const resizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const { width } = entry.contentRect;
    // Update component based on container width
  }
});

// Mutation Observer (DOM changes)
const mutationObserver = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    // React to DOM changes
  });
});
```

---

# Decision Frameworks

## When Should This Be Used?

**React over Vanilla JS**: When UI has state that changes over time and UI must reflect state. Not for static content pages.

**Next.js over Vite/CRA**: When SEO, performance, or server-side rendering is required. When full-stack capabilities within same codebase are beneficial.

**Server Components over Client Components**: Always default to Server. Switch to Client only when interactivity (state, effects, event handlers) is required.

**CSS Modules over Tailwind**: When team CSS expertise is high and component isolation is the primary concern. Tailwind when consistency and speed are primary.

**TypeScript strict over loose**: Always. No exceptions for new projects.

**React Query over useEffect + fetch**: Always for server state. useEffect + fetch is an anti-pattern for data fetching in production.

## When Should It NOT Be Used?

**React**: Static content sites better served by Astro or static site generators.

**Next.js**: Simple SPAs without SEO needs. Backend already exists with APIs.

**TypeScript**: Rapid prototyping for throwaway code. One-off scripts.

**CSS-in-JS**: Server Components environment (runtime overhead). Prefer zero-runtime solutions.

**Micro-frontends**: Single team, simple domain, early product stage.

## Alternatives and Trade-offs

| Decision | Alternative | Trade-off |
|---|---|---|
| React | Vue, Svelte, Solid | Different reactivity models, ecosystem size, hiring pool |
| Next.js | Remix, Astro, SvelteKit | Different server paradigms, caching strategies, community |
| Redux | Zustand, Jotai, MobX | Boilerplate vs simplicity, devtools, middleware ecosystem |
| Tailwind | CSS Modules, Styled Components | Utility-first vs component-scoped, learning curve |
| Playwright | Cypress, Selenium | Speed, parallelization, browser support, flakiness |
| Turbopack | Webpack, Vite | Maturity, plugin ecosystem, configuration complexity |

## State Management Decision Matrix

| Scenario | Solution | Rationale |
|---|---|---|
| Data fetched from API, cached, shared | TanStack Query | Purpose-built for server state |
| UI state across unrelated components | Zustand | Minimal boilerplate, selector-based |
| Form state with validation | React Hook Form + Zod | Performance (uncontrolled), type safety |
| URL as state | Next.js useSearchParams | Shareable, bookmarkable, SEO-friendly |
| Real-time data stream | WebSocket + Zustand | Push events to store, components subscribe |
| Complex client state (many interdependencies) | Zustand with Immer middleware | Immutable updates with mutable syntax |
| State machine workflows | XState | Visualize states, prevent impossible transitions |

## Rendering Strategy Decision Tree

```
Does content change per user?
├── No → Does content change between deployments?
│   ├── No → Static Generation (SSG)
│   └── Yes, infrequently → ISR with revalidation
└── Yes → Does content need SEO?
    ├── No → Client-Side Rendering or PPR
    └── Yes → Does page have independent data dependencies?
        ├── Yes → Streaming SSR with Suspense
        └── No → Server-Side Rendering (SSR)
```

## Image Strategy Decision

```
Image type?
├── Content image (part of page content)
│   └── next/image with loading="lazy", proper sizes
├── Hero/LCP image
│   └── Preload, fetchpriority="high", no lazy loading
├── Decorative image
│   └── CSS background-image, alt=""
├── Icon
│   └── SVG inline (small) or SVG sprite (many)
└── User-generated content
    └── next/image with unoptimized if from external CDN
```

---

# Enterprise Standards

## Industry Standards

- **ECMAScript**: Latest stable specification (ES2024+)
- **TypeScript**: Strict mode, latest stable version
- **W3C**: WCAG 2.2 Level AA
- **HTTP**: HTTP/2 minimum, HTTP/3 where supported
- **Security**: OWASP Top 10 awareness, CSP Level 3
- **Performance**: Web Vitals (LCP, INP, CLS) as defined by Google

## Modern Practices

- Trunk-based development with feature flags
- Continuous deployment with progressive rollout
- Observability-driven development
- Design system as product
- Accessibility shift-left (in design, not post-implementation)
- Component-driven development with Storybook
- Visual regression testing in CI

## Architecture Principles

1. **Composability over Inheritance**: Prefer composition in components, hooks, and utilities.
2. **Colocation**: Keep related code close. Styles with components. Tests with implementations.
3. **Declarative over Imperative**: Describe what the UI should be, not how to build it.
4. **Optimize for Deletion**: Code that's easy to remove is more valuable than code that's easy to extend.
5. **Progressive Enhancement**: Core functionality works without JavaScript. JavaScript enhances the experience.

---

# AI Engineering

## How AI Should Reason Inside This Domain

AI systems operating in frontend engineering must:

1. **Respect the Server-Client Boundary**: Never suggest using browser APIs (window, document, localStorage) in Server Components. Never suggest database access in Client Components.

2. **Prioritize Accessibility**: Every generated component must include proper semantics, ARIA attributes when necessary, and keyboard interaction. Accessibility is never "added later."

3. **Default to Type Safety**: All generated code uses strict TypeScript. No `any` without explicit justification. Discriminated unions over optional properties.

4. **Understand the React Rendering Model**: Never place side effects in render. Never mutate state directly. Understand when memoization is necessary versus premature optimization.

5. **Consider Performance Implications**: Every component generated should be evaluated for: bundle size contribution, render frequency, layout shift potential, and hydration impact.

## Context Required

For accurate frontend reasoning, AI requires:
- Whether the target is Server or Client Component
- The Next.js version and enabled features (App Router, Turbopack)
- The state management solution in use
- The styling approach (Tailwind, CSS Modules, etc.)
- Existing component API contracts (when modifying)
- Performance budgets and accessibility requirements

## Validation

Generated code should be validated against:
- TypeScript strict mode compilation
- ESLint rules (especially react-hooks, jsx-a11y)
- Accessibility automated checks
- Bundle size estimates
- Compliance with existing component patterns

## Common Hallucinations

1. **Importing server-only modules in client components**: `fs`, `path`, database clients in client components.
2. **Using `useEffect` for data fetching**: Suggesting `useEffect` + `fetch` instead of React Query or Server Components.
3. **Mixing event handlers in Server Components**: Adding `onClick` to elements in Server Components.
4. **Ignoring the event loop**: Synchronous long-running operations without considering main thread blocking.
5. **Inventing non-existent Next.js APIs**: Fabricating configuration options or component props.
6. **Confusing React 18 and 19 behaviors**: Particularly around automatic batching, useTransition, and Suspense behavior.

## Reasoning Strategy

When generating or evaluating frontend code:

1. **Identify the rendering context** (Server vs Client)
2. **Classify all state** (URL, Server, UI, Form, Derived, Persisted)
3. **Apply the appropriate data fetching pattern**
4. **Ensure semantic HTML foundation**
5. **Add styling that respects the design system**
6. **Add accessibility attributes**
7. **Consider performance implications** (bundle size, render cost, hydration)
8. **Add error, loading, and empty states**
9. **Validate type safety**
10. **Check for security vulnerabilities**

---

# Quality Standards

## Validation Rules

1. TypeScript compilation passes with `strict: true` and `noUncheckedIndexedAccess: true`
2. ESLint passes with zero warnings for react-hooks/exhaustive-deps
3. No `any` types without `// @ts-expect-error documented justification` comment
4. All interactive elements have accessible names
5. Color contrast meets WCAG AA (4.5:1 for text, 3:1 for large text)
6. Bundle size within budget (initial route < 100KB compressed JS)
7. Lighthouse performance score ≥ 90
8. Lighthouse accessibility score ≥ 95
9. No console errors in production build
10. Hydration produces zero mismatches

## Review Checklist

### Semantic HTML
- [ ] `<main>` element present, exactly one per page
- [ ] Heading hierarchy sequential, never skips levels
- [ ] `<html lang>` correctly set
- [ ] No `<div>` used as interactive control without ARIA
- [ ] Forms use `<label>` elements, not placeholder-only

### React Engineering
- [ ] Components are functions, not classes
- [ ] No side effects in render
- [ ] Effects have correct dependency arrays
- [ ] State classified correctly (Server, UI, Form, etc.)
- [ ] Server Components don't use client hooks
- [ ] No `useEffect` for data fetching

### Performance
- [ ] No render-blocking third-party scripts
- [ ] Images have explicit width/height or aspect-ratio
- [ ] Font loading doesn't cause layout shift
- [ ] Code splitting implemented for heavy components
- [ ] No unnecessary re-renders (verified with React DevTools Profiler)

### Security
- [ ] No sensitive data exposed to client
- [ ] `dangerouslySetInnerHTML` sanitized with DOMPurify
- [ ] CSP headers configured
- [ ] No secrets in NEXT_PUBLIC_ variables
- [ ] Authentication tokens in HttpOnly cookies

### Accessibility
- [ ] Keyboard navigation complete (Tab, Enter, Escape, arrows)
- [ ] Focus visible on all interactive elements
- [ ] Modals trap focus, return focus on close
- [ ] Live regions for dynamic content
- [ ] Screen reader testing passed

## Engineering Checklist

- [ ] Design tokens used consistently (no magic numbers)
- [ ] Error boundaries at appropriate granularity
- [ ] Loading states for all async operations
- [ ] Empty states for all collections
- [ ] Error states with recovery actions
- [ ] Feature flags for incomplete features
- [ ] Monitoring in place (errors, performance, usage)
- [ ] Documentation for component API
- [ ] Visual regression tests for critical components
- [ ] E2E tests for critical user flows

## Completion Checklist

- [ ] All automated checks pass (TypeScript, ESLint, tests, build)
- [ ] Bundle analysis reviewed, no regressions
- [ ] Accessibility audit passed (automated + manual)
- [ ] Performance budgets met
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge latest 2 versions)
- [ ] Mobile testing (iOS Safari, Chrome Android)
- [ ] Code review approved by domain owner
- [ ] Changelog updated
- [ ] Feature flag configured (if applicable)
- [ ] Rollback plan documented

---

# Cross References

## CORE-AI-001
This document defines how AI systems approach frontend code generation. When an AI agent is tasked with frontend implementation, it consults this document for type safety requirements, React patterns, accessibility requirements, and performance constraints. AI must not propose solutions that violate the Server-Client boundary or generate inaccessible components.

## CORE-ARCH-001
Frontend architecture is a subsystem of the overall system architecture. Rendering strategy decisions (SSR, SSG, ISR) must align with the infrastructure topology defined in CORE-ARCH-001. API contracts consumed by the frontend are defined in the architecture specification. The frontend must respect backend service boundaries and error propagation patterns.

## CORE-CONTEXT-001
Frontend runtime context (browser type, device capabilities, network conditions, viewport size) is a specialized context domain. Components should adapt to context gracefully. Feature flags and user preferences are context that influences rendering decisions. Context providers are the React implementation of contextual dependency injection.

## CORE-DOCS-001
This document follows the engineering specification format defined in CORE-DOCS-001. It references other documents by ID rather than duplicating their content. Updates to this document follow the versioning and change management processes defined in the documentation system.

## CORE-GOV-001
Frontend governance includes: library approval process, component API stability guarantees, performance budget enforcement, accessibility conformance requirements, and code ownership definitions. The governance framework defines who approves new dependencies, how breaking changes to component libraries are managed, and the escalation path for technical debt remediation.

## CORE-QUALITY-001
Frontend quality metrics (Core Web Vitals, accessibility scores, bundle size) are specific instances of the quality framework. The quality pipeline includes automated checks at PR, build, and deployment stages. Quality gates must pass before production deployment. Quality regression thresholds are defined and enforced.

## Other Engineering Documents
- **State Management Specification**: Detailed patterns for each state category
- **Testing Specification**: Unit, integration, and E2E testing strategies
- **Design System Specification**: Component API contracts and visual regression
- **API Integration Specification**: API client generation, error handling, caching

---

# Glossary

| Term | Definition |
|---|---|
| **A11y** | Accessibility (11 letters between a and y) |
| **App Shell** | Minimal HTML/CSS/JS for instant loading, content populated dynamically |
| **ARIA** | Accessible Rich Internet Applications; semantics for custom widgets |
| **Backpressure** | Mechanism to handle data faster than it can be processed |
| **Baseline** | Browser features widely supported across major browsers |
| **BFC** | Block Formatting Context; CSS layout isolation mechanism |
| **Brotli** | Compression algorithm, typically 20% better than gzip for text |
| **Bundle** | The compiled, optimized JavaScript/CSS output sent to browsers |
| **Cascade** | CSS algorithm determining which styles apply when multiple rules match |
| **CDN** | Content Delivery Network; edge servers caching and serving static assets |
| **CLS** | Cumulative Layout Shift; measure of visual stability |
| **Client Component** | React component rendered in browser, can use state and effects |
| **Composition** | Combining components by passing them as children or props |
| **Compositor** | Browser thread handling layer composition, GPU-accelerated |
| **Container Query** | CSS feature allowing styles based on container size, not viewport |
| **Core Web Vitals** | Google's standardized performance metrics: LCP, INP, CLS |
| **Critical CSS** | CSS required for above-the-fold content, inlined for speed |
| **CSP** | Content Security Policy; browser security mechanism controlling resource loading |
| **CSR** | Client-Side Rendering; HTML generated in browser via JavaScript |
| **Design Tokens** | Platform-agnostic design values (colors, spacing, typography) |
| **ESM** | ECMAScript Modules; standard JavaScript module system |
| **Event Delegation** | Handling events on parent element instead of individual children |
| **FCP** | First Contentful Paint |
| **HMR** | Hot Module Replacement |
| **Hoisting** | JavaScript behavior of moving declarations to top of scope |
| **Hydration** | React attaching event listeners to server-rendered HTML |
| **I18n** | Internationalization (18 letters between i and n) |
| **Idempotency** | Operation producing same result regardless of how many times executed |
| **Immutable** | Data that cannot be changed after creation |
| **INP** | Interaction to Next Paint; measure of responsiveness |
| **Intrinsic Size** | Natural size of element based on its content |
| **ISR** | Incremental Static Regeneration; updating static pages without full rebuild |
| **Jank** | Visible stutter or lag in user interface |
| **L10n** | Localization (10 letters between l and n) |
| **LCP** | Largest Contentful Paint; measure of perceived load speed |
| **Micro-FE** | Micro-Frontend |
| **MPA** | Multi-Page Application |
| **Origin Trial** | Chrome feature available for experimentation before full launch |
| **Paint Holding** | Browser delaying paint until sufficient content is ready |
| **Polyfill** | JavaScript that implements modern APIs in older browsers |
| **PPR** | Partial Prerendering; static shell with dynamic content holes |
| **Reconciliation** | React's algorithm comparing virtual DOM trees |
| **Reflow** | Recalculation of element positions and geometries |
| **Repaint** | Redrawing elements without geometry changes |
| **RUM** | Real User Monitoring; performance data from actual users |
| **Server Action** | Async function running on server, callable from client |
| **Server Component** | React component rendered on server, zero bundle size |
| **SRI** | Subresource Integrity; cryptographic hash for resource verification |
| **SSG** | Static Site Generation |
| **SSR** | Server-Side Rendering |
| **Streaming** | Sending HTML in chunks as data becomes available |
| **Synthetic Event** | React's cross-browser wrapper around native events |
| **Tree Shaking** | Removing unused code from bundles |
| **TTFB** | Time to First Byte; server response time |
| **TTI** | Time to Interactive; when page becomes fully responsive |
| **Waterfall** | Sequence of network requests and their dependencies |
| **Yield** | Voluntarily returning control to the event loop |

---

# Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-07-28 | Engineering Documentation Architect | Initial release. Complete frontend engineering system specification including core modules 1-18. |

---

*End of Document FE-ENG-001*

*This document provides the complete engineering specification for the Frontend Engineering domain within the AI-WEOS. All engineering decisions, code reviews, and system designs must reference and align with the principles, patterns, and standards defined herein.*
