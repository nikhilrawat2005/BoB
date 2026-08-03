# Metadata

* **Document ID:** INDUSTRY-SAAS-PRODUCT-001
* **Version:** 1.0.0
* **Category:** Industry Systems — SaaS Product
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Tech/SaaS products, startup marketing + app sites, subscription-based software products
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to convert a visitor into a signed-up, paying (or trialing) user of a software product — spanning both the public marketing site and the boundary into the actual application.

## Primary Objective
Give the AI a single, authoritative reference for building SaaS/startup sites, so that the marketing-to-app handoff, pricing/plan logic, and subscription lifecycle follow one consistent, reliable pattern.

## Scope
* Public marketing site for a SaaS product (landing page, pricing, features, docs entry point).
* Signup/onboarding flow and the marketing-to-app boundary.
* Subscription and plan/billing data model (the app's internal feature logic itself is out of scope — this covers the account/billing layer only).

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* The internal feature logic/UI of the actual product-behind-the-login — that is product-specific and cannot be standardized here; this document covers only the account, plan, and billing layer common to virtually all SaaS products.
* One-time purchase software (perpetual license, no subscription) — see `commerce.md` for that case instead.

---

# Foundations

## What Makes This Category Different
Unlike every other category, this is the only one with **two distinct "sites" glued together** — a public marketing site optimized for conversion and SEO, and a gated application optimized for retention and daily use, with a hard authentication boundary between them. The business model is also uniquely recurring: a single signup isn't the end goal, ongoing subscription health (trial conversion, churn, upgrade/downgrade) is. This makes plan/subscription state management, not just signup, the central data concern.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Signup (free trial or freemium tier), followed by trial-to-paid conversion.

**User Journey:**
1. Discover — Home/landing page, often via SEO or ads.
2. Evaluate — Features page, pricing page, comparison/alternatives content.
3. Signup — trial or free-tier account creation, minimal friction.
4. Onboarding — first-run experience inside the app, guided to a first "aha moment."
5. Convert — trial-to-paid or freemium-to-upgrade at a plan-limit or trial-end trigger.
6. Retain — ongoing usage, with upgrade/downgrade/cancel self-service.

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **User** | name, email, password_hash/oauth_ref, created_at, role | belongs to Account; has many Sessions |
| **Account / Organization** | name, plan_ref, billing_status, created_at | has many Users; has one Subscription |
| **Plan** | name (e.g., Free/Pro/Enterprise), price, billing_interval, feature_limits{} | referenced by Subscription |
| **Subscription** | account_ref, plan_ref, status (trialing/active/past_due/cancelled), trial_ends_at, current_period_end | belongs to Account, references Plan |
| **Invoice** | account_ref, amount, status, provider_invoice_id, issued_at | belongs to Account |
| **Feature Usage / Quota** | account_ref, metric_name, current_value, limit_value, period | belongs to Account, enforces Plan limits |
| **Invite** | email, account_ref, role, token, expires_at | belongs to Account |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Marketing site: home, features, pricing, and a clear signup CTA
- [ ] Self-service signup (email/password or OAuth) with minimal required fields
- [ ] Clear plan/pricing structure with obvious upgrade path
- [ ] Trial or freemium access without requiring a credit card upfront (unless a deliberate business decision otherwise)
- [ ] In-app or email onboarding sequence guiding to first value
- [ ] Self-service billing management (view invoice, update payment method, cancel/downgrade)

**Phase 2 / Nice-to-have:**
- [ ] Team/multi-user accounts with role-based invites
- [ ] Usage-based billing (metered, on top of flat plans)
- [ ] In-app upgrade prompts triggered by feature-limit hits
- [ ] Public changelog/roadmap page
- [ ] Referral or affiliate program

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 5: Next.js App Router Engineering** (or equivalent framework routing) with a clear architectural split between the public marketing routes (SEO-optimized, statically generated where possible) and the authenticated app routes (client-heavy, behind auth).
- Apply **Module 9: Build Systems** consideration for the marketing site specifically — it should be the fastest-loading part of the whole product, since it's the first and most SEO-exposed impression.
- Apply **Module 16: Form Engineering** on the signup form — every extra field measurably reduces signup conversion; default to the absolute minimum required fields.
- Apply **Module 11: Enterprise Frontend Engineering** patterns once team/org-based accounts are in scope (Module 3's Phase 2), since multi-user UI state (roles, permissions) adds real complexity.

## Module 5: Backend Pattern Guidance
- Apply **03-Backend.md Module 17: Payment & Billing Integration** as the core of the account layer — subscription state must be driven by the payment provider's webhooks (e.g., Stripe Billing), never inferred client-side.
- Apply **Module 15: Multi-Tenancy Architecture** — nearly every SaaS product needs at least the "Pool" model (shared schema, `account_id`/`tenant_id` scoping) from day one, even for a single-user-per-account MVP, since retrofitting multi-tenancy later is expensive.
- Apply **Module 3: Authentication & Authorization** with account-scoped roles (owner/admin/member) baked in from the start, not bolted on later.
- Apply **Module 11: Background Jobs & Scheduling** for trial-expiry checks, dunning (failed-payment retry) sequences, and usage-quota resets each billing period.

## Module 6: Content & Copy Patterns
**Typical pages/sections:** Home/Hero, Features (often broken into use-case pages), Pricing, Comparison/Alternatives, Docs/Help entry point, Blog (for SEO), Signup, Login, (Changelog, optional).

**Tone:** Benefit-led and specific — lead with the outcome/problem solved, not the feature list. Pricing pages benefit from clarity over cleverness: exact feature-per-tier comparison tables outperform vague plan names.

## Module 7: Resource Library Mapping
- **Color:** `03_Resource_Libraries/color-palette-guide.md` → Section 2 (Tech/SaaS/Startup) Options A–C.
- **Font:** `03_Resource_Libraries/font-pairing-guide.md` → matching Section 2 entries.

## Module 8: Common Pitfalls
* Requiring a credit card for a free trial without a clear reason — a major, well-documented conversion killer unless the business model specifically depends on it.
* Letting the marketing site and app share one monolithic frontend bundle — bloats the public site's load time with app-only code it doesn't need.
* Inferring subscription status from a client-side payment success event instead of the provider's webhook — leads to accounts stuck in an incorrect billing state.
* No self-service cancellation — forcing users to email/call to cancel is a trust-damaging dark pattern and, in some jurisdictions, a compliance risk.

## Module 9: Compliance & Trust Signals
**Compliance:** Standard data-privacy practice (see `03-Backend.md` Module 16) applies to all user/account data. If handling EU customers, self-service cancellation and clear billing terms are a legal expectation, not just good UX.

**Trust signals:** transparent pricing (no "contact us" pricing unless genuinely enterprise-tier), visible security/compliance badges (SOC2, GDPR) if applicable, customer logos/testimonials, and a working, discoverable support channel.

---

# AI Engineering

## How AI Should Reason for This Category
1. **Separate marketing-site concerns from app concerns explicitly** — these have different performance, SEO, and architecture priorities, and conflating them is the most common structural mistake in this category.
2. **Design the Account/Subscription/Plan data model before any UI**, even for an MVP with only one plan — retrofitting multi-tenancy and billing state onto a single-user-assumption schema is expensive; assume growth from the first schema decision.
3. **Treat subscription state exactly like `commerce.md` treats payment state** — webhook-driven, never client-inferred, with the same idempotency discipline.

## Discovery Questions to Ask the User
1. Is this primarily the marketing/landing site, the full app, or both?
2. Will pricing be flat per-plan, usage-based, or a mix?
3. Do you need team/multi-user accounts at launch, or is single-user-per-account acceptable initially?
4. Free trial, freemium tier, or neither — and should a credit card be required upfront?
5. Do you already have the core app built, or does this project include building the app itself (not just the marketing site)?
6. Which payment/billing provider do you plan to use (e.g., Stripe Billing)?
7. Do you need SSO/OAuth login options, or is email/password sufficient at launch?

---

# Quality Standards

## Completion Checklist
- [ ] Is subscription/billing status driven exclusively by verified payment-provider webhooks?
- [ ] Can a user self-serve cancel, upgrade, or downgrade without contacting support?
- [ ] Is the marketing site's performance/SEO independent of the authenticated app's bundle size?
- [ ] Does the data model support multiple users per account, even if the MVP UI doesn't expose it yet?
- [ ] Is the signup form reduced to the minimum viable fields?
- [ ] Is pricing displayed clearly with an exact feature comparison, not vague tier descriptions?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 5, 9, 11, and 16 applied directly to the marketing/app split and signup/billing UX.
* **03-Backend.md:** Modules 3, 11, 15, and 17 applied as described above.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **commerce.md:** Referenced for the payment/webhook pattern, which this document extends into recurring subscription state.

---

# Glossary

* **Dunning:** The automated process of retrying and communicating around a failed subscription payment before ultimately downgrading or cancelling the account.
* **Freemium:** A pricing model offering a permanently free, limited tier alongside paid upgrades, as distinct from a time-limited free trial.
* **Aha Moment:** The point in onboarding where a new user first experiences the product's core value, strongly correlated with trial-to-paid conversion.
* **Seat:** A billable user slot within a team/organization account.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the SaaS Product Industry Systems specification. |
