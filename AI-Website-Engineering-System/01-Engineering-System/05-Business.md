# Business Engineering

## Purpose

This document defines the engineering approach to Business logic within AI-WEOS — how a website generates revenue, converts visitors, tracks growth, and stays legally compliant is treated as an engineering discipline with deterministic rules, not as a marketing afterthought bolted on after the site is built. Every business model choice has a direct architectural consequence, and this document exists to make those consequences explicit and repeatable across projects.

## Scope

This document covers:

- Business model classification and its architectural implications
- Monetization implementation patterns (pricing, checkout, billing)
- Conversion funnel engineering and instrumentation
- Analytics and tracking architecture (business-layer, not SEO-layer)
- Legal/compliance baseline required on any commercial website
- Growth mechanics (referral, email capture, retention loops) as engineering systems
- Handoff rules: what Business Engineering may require from Frontend/Backend, and what it must never dictate directly

This document does not cover:

- Keyword strategy, crawlability, or structured data (belongs to `04-SEO.md`)
- API design, database schema, or server architecture (belongs to `03-Backend.md`)
- Visual design, layout, or component styling (belongs to `01-Design.md`)
- Hosting, CI/CD, or infrastructure provisioning (belongs to `06-Deployment.md`)
- Industry-specific business rules (belongs to the relevant `02_Industry_Systems` file — this document defines the universal baseline only)

## Core Principles

**Revenue Model Determines Architecture, Not the Reverse**
The business model must be decided before frontend/backend patterns are chosen. A subscription site, a marketplace, and a lead-generation site require fundamentally different data models, page structures, and conversion paths. Never retrofit a business model onto an architecture built for a different one.

**Every Conversion Point Is a Measurable Event**
If a user action moves money, captures a lead, or creates an account, it must emit a trackable event with a consistent schema. Undocumented or inconsistent conversion events make growth decisions unverifiable.

**Compliance Is a Prerequisite, Not a Launch-Day Task**
Legal/compliance requirements (consent, data handling, required disclosures) must be designed into the data model and UI flow from the start. Retrofitting compliance after launch usually requires touching every layer of the stack.

**Business Engineering Requires, It Does Not Implement**
This document defines *what* the business model requires (e.g., "checkout must support saved payment methods"). It does not specify component code or database schema — those decisions belong to Frontend/Backend Engineering, which must honor the requirement.

**Growth Mechanics Must Be Deterministic Systems**
Referral programs, email capture, and retention loops are not marketing copy — they are state machines with defined triggers, states, and rewards. Treat them as such.

## Engineering Philosophy

Business Engineering sits above Frontend and Backend in the dependency hierarchy conceptually but is implemented through them — it is the layer that translates "how does this business make money and grow" into concrete, unambiguous requirements that lower layers can build against.

A website without an explicit business model classification tends to accumulate ad hoc monetization features that conflict with each other (e.g., a checkout flow bolted onto a site that was actually designed as a lead-gen funnel). This document forces the model to be named first, so every downstream engineering decision — page structure, form design, tracking, legal disclosures — has a single coherent source of truth to follow.

Treat the business model the same way an engineer treats a database schema: get it wrong early, and every feature built afterward inherits the mistake.

## Decision Framework

When making Business Engineering decisions, evaluate against this priority chain:

1. **Model Clarity** — Is the business model explicitly classified (see Standards)?
2. **Conversion Mapping** — Are all money/lead/signup events identified and mapped to the funnel?
3. **Compliance Baseline** — Are the mandatory legal/consent requirements satisfied for this model and target region?
4. **Instrumentation** — Is every conversion point emitting a trackable, schema-consistent event?
5. **Growth Systems** — Are retention/referral mechanics defined as explicit state machines, if applicable?

Each decision must pass through these gates in sequence. A site without model clarity cannot be reliably instrumented. A site without compliance cannot legally operate in most target regions.

### Decision Tree

```
What is the primary business model?
├── Transactional (one-time or recurring purchase)
│   ├── Physical goods → commerce.md pattern (checkout, inventory, shipping)
│   └── Digital goods/subscription → SaaS-style billing pattern
├── Lead Generation (no direct transaction on-site)
│   └── Conversion = form submission / contact / booking request
├── Marketplace (multi-party transactions)
│   └── Requires buyer + seller data models, commission logic
└── Content/Attention (ads, sponsorship, affiliate)
    └── Conversion = engagement metrics, click-through, ad viewability

For every model:
├── Does it collect PII or payment data? → Apply Compliance Baseline (mandatory)
├── Does it have a repeat-visit component? → Apply Growth Mechanics standards
└── Does it have a defined conversion event? → Apply Analytics Architecture standards
```

## Standards

### Business Model Classification

Every project must be explicitly classified into one (or a documented combination) of these models before any other Business Engineering decision is made:

| Model | Primary Conversion Event | Typical Data Model Needs |
|---|---|---|
| Transactional — Physical Goods | Purchase completed | Product, Inventory, Order, Shipment |
| Transactional — Digital/Subscription | Subscription started/renewed | Plan, Subscription, Invoice, Entitlement |
| Lead Generation | Form submitted / call booked | Lead, Contact, Pipeline stage |
| Marketplace | Transaction between two parties | Buyer, Seller, Listing, Commission, Payout |
| Content/Attention | Engagement / click-through / ad impression | Session, Content item, Sponsor/Ad slot |

A project may combine models (e.g., SaaS with an affiliate program), but each combined model must be documented separately with its own conversion event and data needs — do not merge them into a single ambiguous "conversion."

### Monetization Implementation Patterns

**Pricing Pages**
- Every plan/tier must map to exactly one canonical price identifier used consistently across frontend display, checkout, and backend billing records (no hardcoded prices duplicated across layers).
- Currency and localization must be resolved server-side or via a single trusted pricing service — never computed client-side from a hardcoded exchange rate.
- Free trial / freemium boundaries must be enforced server-side (entitlement checks), never trusted from client state alone.

**Checkout Flow**
- Minimum required checkout steps: cart/plan review → identity/contact capture → payment → confirmation. Do not add steps that do not serve one of these four purposes.
- Support saved payment methods for any site with recurring billing or repeat-purchase behavior.
- Abandoned checkout must be a trackable state (see Analytics Architecture) — not silently lost.

**Billing (Subscriptions)**
- Subscription status must be a single source of truth (active, past_due, canceled, trialing) stored server-side and never inferred purely from the last successful payment date.
- Failed payment handling (dunning) must have a defined retry schedule and a defined grace period before access is revoked.

### Conversion Funnel Engineering

Every funnel must be explicitly diagrammed with named stages before implementation. Minimum required stages for any commercial site:

```
Awareness (landing) → Interest (product/plan view) → Action (signup/cart) → Conversion (purchase/lead submitted) → Retention (repeat visit/renewal)
```

Rules:
- Each stage must have exactly one primary call-to-action; competing CTAs on the same page dilute funnel data.
- Drop-off between stages must be measurable (see Analytics Architecture) — a funnel that cannot report stage-to-stage drop-off is not instrumented correctly.
- Multi-step forms must persist partial progress (server-side or durable client storage) so users are not forced to restart on refresh.

### Analytics & Tracking Architecture

This is business-layer analytics — the "did the business goal happen" layer — distinct from SEO's crawler-facing concerns.

**Event Schema Standard**
Every conversion-relevant event must include, at minimum:
- `event_name` (snake_case, verb-first: e.g., `checkout_completed`, `lead_submitted`, `trial_started`)
- `timestamp` (ISO 8601, UTC)
- `user_id` or `anonymous_id` (never both null)
- `value` (monetary value if applicable, else null)
- `funnel_stage` (must match a stage named in the funnel diagram)

**Required Events by Model**
- Transactional: `product_viewed`, `added_to_cart`, `checkout_started`, `checkout_completed`, `payment_failed`
- Subscription: `trial_started`, `subscription_started`, `subscription_renewed`, `subscription_canceled`, `payment_failed`
- Lead Generation: `form_viewed`, `form_started`, `form_submitted`, `lead_qualified`
- Marketplace: `listing_viewed`, `transaction_initiated`, `transaction_completed`, `payout_issued`

**Attribution**
- First-touch and last-touch attribution sources must both be captured at the point of first contact (UTM parameters, referrer) and persisted with the user record — not reconstructed after the fact.

### Legal / Compliance Baseline

Every commercial website, regardless of business model, must implement:

- **Consent Management**: Cookie/tracking consent banner compliant with the target region's baseline requirement (e.g., GDPR-style opt-in where the audience includes EU users). Consent state must be stored and checked before any non-essential tracking script fires.
- **Required Disclosures**: Privacy Policy and Terms of Service pages, linked from checkout/signup and footer, versioned so consent can be tied to a specific policy version.
- **Payment Data Handling**: Never store raw card data. Use a PCI-compliant processor's tokenization; the site's own database must never contain full card numbers or CVV.
- **Data Subject Rights**: If handling EU/UK/CA user data, provide a documented mechanism for data access/deletion requests, even if manually fulfilled initially.
- **Refund/Cancellation Terms**: Must be stated in plain language before purchase, not only in a linked legal document.

### Growth Mechanics

Treat each growth mechanic as an explicit state machine, not a marketing feature:

**Referral Programs**
- States: `invited → signed_up → qualified → rewarded`
- Each state transition must be an event with a timestamp and must be idempotent (a user cannot be rewarded twice for the same qualifying action).

**Email/Lead Capture**
- Capture point must specify: what is offered in exchange (lead magnet, discount, newsletter), what list/segment the contact enters, and what the first automated follow-up is.

**Retention Loops**
- Any recurring engagement mechanic (loyalty points, streaks, renewal reminders) must define trigger condition, cooldown period, and the specific event that ends the loop (unsubscribe, churn, redemption).

### Business → Frontend/Backend Handoff Rules

Per the downward-only dependency rule (`CORE-ARCH-001`), Business Engineering may **require** capabilities of Frontend/Backend but must never specify their implementation. Correct handoff phrasing:

- ✅ "Checkout must support saved payment methods." (requirement)
- ❌ "Use Stripe's SetupIntent API with a `payment_methods` table keyed by `customer_id`." (implementation — belongs to Backend.md)

- ✅ "Pricing must display in the visitor's local currency." (requirement)
- ❌ "Fetch exchange rates from X API and cache in Redis for 1 hour." (implementation — belongs to Backend.md)

## Anti-Patterns

**Client-Side Price or Entitlement Enforcement**
Trusting the frontend to enforce plan limits or hide prices for gating purposes. Any check that affects money or access must be re-validated server-side.

**Undocumented Combined Business Models**
Bolting a lead-gen form onto a transactional site without defining it as a separate model with its own conversion event, resulting in funnel data that conflates two unrelated goals.

**Consent Banners That Don't Block Tracking**
Displaying a cookie consent banner for legal appearance while tracking scripts fire regardless of the user's choice. This is a compliance violation, not a cosmetic detail.

**Funnel Stages With Competing CTAs**
A pricing page with three equally-weighted CTAs ("Buy Now," "Book a Demo," "Contact Sales") with no primary path, making funnel drop-off unmeasurable and confusing the visitor.

**Reward Double-Issuance in Referral Systems**
A referral state machine without idempotency checks, allowing the same qualifying event to trigger multiple reward payouts due to retried webhooks or duplicate events.

## Quality Checklist

Before any production deployment affecting business logic, verify:

- [ ] Business model is explicitly classified and documented
- [ ] Every conversion event is mapped to a named funnel stage
- [ ] Event schema is consistent across all tracked events (see Analytics Architecture)
- [ ] Pricing is resolved server-side, not hardcoded client-side
- [ ] Entitlement/plan-limit checks are enforced server-side
- [ ] No raw payment card data is stored in the application database
- [ ] Consent banner blocks non-essential tracking until consent is given
- [ ] Privacy Policy and Terms of Service are linked and versioned
- [ ] Subscription status has a single server-side source of truth
- [ ] Failed payment (dunning) retry schedule and grace period are defined
- [ ] Referral/reward state transitions are idempotent
- [ ] Abandoned checkout/funnel drop-off is tracked, not silently lost
- [ ] Multi-step forms persist partial progress
- [ ] First-touch and last-touch attribution are both captured

## AI Decision Rules

When an AI agent is generating or modifying business-logic-related pages or flows within AI-WEOS, the following rules must be applied automatically:

**Rule 1: Business Model Classification**
- IF the project brief does not explicitly state a business model THEN halt and request classification before generating checkout, pricing, or lead-capture code
- IF multiple models are present THEN document each separately with its own conversion event

**Rule 2: Conversion Event Generation**
- WHEN generating a checkout, signup, or lead form THEN emit the corresponding required event from the "Required Events by Model" table
- IF an event schema field is missing (e.g., `funnel_stage`) THEN do not ship the event — fix the schema first

**Rule 3: Price/Entitlement Placement**
- IF a price or plan-limit check affects what a user can purchase or access THEN implement the check server-side
- IF only a client-side check exists THEN flag as incomplete and require a server-side equivalent

**Rule 4: Compliance Gating**
- IF the site collects any PII or uses non-essential tracking THEN implement consent gating before any such script executes
- IF payment data is involved THEN require processor tokenization; reject any design that stores raw card data

**Rule 5: Funnel CTA Discipline**
- IF a page belongs to a defined funnel stage THEN it must have exactly one primary CTA
- IF a page has multiple competing CTAs THEN flag for resolution before considering the page complete

**Rule 6: Referral/Reward Idempotency**
- WHEN implementing a referral or reward mechanic THEN require an idempotency key or unique constraint on the qualifying action before issuing a reward

**Rule 7: Handoff Boundary**
- IF a Business Engineering requirement is being translated into code THEN state the requirement in Business.md language (capability) and implement the mechanism in Frontend.md/Backend.md — never conflate the two in this document

## Examples

### Correct Event Schema (Checkout Completed)

```json
{
  "event_name": "checkout_completed",
  "timestamp": "2026-07-30T10:15:00Z",
  "user_id": "usr_8823",
  "value": 149.00,
  "currency": "USD",
  "funnel_stage": "conversion",
  "order_id": "ord_44210",
  "attribution": {
    "first_touch_source": "google_cpc",
    "last_touch_source": "email_newsletter"
  }
}
```

### Correct Requirement-Level Handoff (Business.md → Backend.md)

```
Business requirement: "Subscribers who fail payment must retain access for a 
7-day grace period, then be downgraded to a read-only state, and receive 
3 reminder emails during that window."

This document stops here. Backend.md owns the retry job implementation, 
database columns, and email trigger logic that satisfies this requirement.
```

### Correct Referral State Machine

```
State: invited
  → on signup with referral code → State: signed_up
    → on qualifying_action (e.g., first purchase) → State: qualified
      → idempotency check: has reward already been issued for this referral_id?
        → No → issue reward → State: rewarded
        → Yes → no-op, log duplicate attempt
```

## Summary

Business Engineering is the discipline of translating "how this website makes money and grows" into explicit, testable requirements before any Frontend or Backend code is written. It classifies the business model, maps every conversion point to a measurable event, enforces a legal/compliance baseline, and defines growth mechanics as deterministic systems rather than marketing copy.

This document requires capabilities of lower layers — it never implements them. When a business requirement needs a technical mechanism, that mechanism belongs in Frontend.md or Backend.md, keeping the downward-only dependency rule intact.

Getting the business model wrong or leaving it implicit is the most expensive mistake a project can make, because every subsequent engineering decision — data model, page structure, tracking, compliance — inherits from it.
