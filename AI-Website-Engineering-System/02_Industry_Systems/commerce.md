# Metadata

* **Document ID:** INDUSTRY-COMMERCE-001
* **Version:** 1.1.0
* **Category:** Industry Systems — Commerce
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** E-commerce stores, single-product stores, multi-vendor marketplaces (light coverage)
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to sell physical or digital goods directly, online, with a cart-and-checkout transaction flow.

## Primary Objective
Give the AI a single, authoritative reference for building e-commerce sites, so cart, checkout, inventory, and payment decisions follow one proven, safe pattern instead of being improvised per project.

## Scope
* Single-store, single-vendor e-commerce (the default case).
* Digital product sales (downloads, licenses, digital access).
* Light multi-vendor marketplace coverage (flagged where it diverges from the single-vendor default).
* Product-focused niche variants sharing the same core cart/checkout pattern: farm-to-table/agriculture direct sales, garden/plant/nursery stores, and craft/handmade goods stores.

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* Deep multi-vendor marketplace operational complexity (vendor payouts, commission engines) — this document covers only the baseline; a true marketplace is a specialized build beyond this reference's depth.
* Physical logistics/warehouse management systems — only the data hooks needed to trigger fulfillment are covered.

---

# Foundations

## What Makes This Category Different
Unlike every other category, **state has direct financial consequences and must survive across sessions and devices.** A cart abandoned on desktop must be recoverable on mobile; an inventory count must never allow overselling; a payment must never be recorded twice for one order. This category has zero tolerance for the kind of "eventually consistent, good enough" thinking acceptable elsewhere — money and stock counts are the two things that must always be exactly right.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Completed purchase (checkout).

**User Journey:**
1. Discover — Home, category browse, or search.
2. Evaluate — Product detail page (images, price, variants, reviews).
3. Add to Cart — with real-time stock validation.
4. Checkout — address, shipping method, payment.
5. Confirmation — order summary, email receipt.
6. Post-purchase — order tracking, support, re-engagement (optional).

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **Product** | name, slug, description, base_price, images[], status (active/draft) | has many Variants; belongs to Category |
| **Variant** | sku, price_override, stock_qty, attributes (size/color) | belongs to Product |
| **Category** | name, slug, parent_category_ref | has many Products; self-referential for subcategories |
| **Cart** | session_id/user_id, items[], created_at, updated_at | has many CartItems |
| **CartItem** | variant_ref, quantity, price_at_add | belongs to Cart, references Variant |
| **Order** | order_number, customer_ref, status (pending/paid/fulfilled/cancelled), total, shipping_address, created_at | has many OrderItems; belongs to Customer |
| **OrderItem** | variant_ref, quantity, price_at_purchase | belongs to Order |
| **Customer** | name, email, addresses[], order_history_ref | has many Orders |
| **Payment** | order_ref, provider_txn_id, amount, status, webhook_event_id | belongs to Order |
| **Coupon/Discount** (optional) | code, type (%/flat), valid_from, valid_to, usage_limit | applies to Order or Product |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Product catalog with category browsing and search
- [ ] Product detail page with variant selection
- [ ] Persistent cart (survives page reload; ideally survives device switch if user is logged in)
- [ ] Checkout flow with address and shipping selection
- [ ] Payment processing via a provider (never custom-built card handling)
- [ ] Order confirmation email
- [ ] Real-time or near-real-time inventory decrement on purchase

**Phase 2 / Nice-to-have:**
- [ ] Customer accounts with order history
- [ ] Product reviews and ratings
- [ ] Coupon/discount codes
- [ ] Wishlist
- [ ] Abandoned cart recovery emails
- [ ] Multi-currency/multi-language support

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 16: Form Engineering** — checkout is the single highest-stakes form in the entire system; multi-step with clear progress indication and inline validation is the standard pattern.
- Apply **Module 10: Responsive Engineering** — mobile commerce conversion is typically the majority of traffic; the product grid and checkout must both be mobile-first, not desktop-adapted.
- Apply **Module 7: Performance Engineering** heavily on the product listing and detail pages — slow product pages measurably reduce conversion; image optimization and lazy-loading are mandatory, not optional.
- Apply **Module 8: Accessibility Engineering** strictly on checkout — a broken checkout for assistive-tech users is a direct revenue and legal risk.

## Module 5: Backend Pattern Guidance
- Apply **03-Backend.md Module 17: Payment & Billing Integration** as the core of this category — webhook-driven order state, signature verification, and idempotent webhook handling are mandatory, not optional.
- Apply **Module 2: Data Persistence & Modeling** with strict transactional boundaries around stock decrement and order creation — these must happen atomically to prevent overselling.
- Apply **Module 10: Rate Limiting & Throttling** on checkout and coupon-application endpoints specifically — both are common targets for abuse (coupon brute-forcing, checkout spam).
- Apply **Module 13: File & Object Storage** for product images, served via CDN.
- If building a multi-vendor variant, apply **Module 15: Multi-Tenancy Architecture** to scope each vendor's products/orders — this is the point where the "light marketplace" case diverges most from the single-vendor default.

## Module 6: Content & Copy Patterns
**Typical pages/sections:** Home, Category listing, Product detail, Cart, Checkout, Order confirmation, Account/Order history, Search results.

**Tone:** Clear and urgency-aware without being manipulative — accurate stock status, clear pricing (including shipping/tax before final confirmation, never hidden until the last step), and specific product descriptions outperform generic sales language.

## Module 7: Resource Library Mapping
- **Color:** `03_Resource_Libraries/color-palette-guide.md` → Section 3 (E-commerce/Shopping) Options A onward, chosen by desired feel (urgency-driven, trendy, or premium). For niche variants: Section 21 (Agriculture/Farm-to-Table), Section 23 (Garden/Plant/Nursery Store), or Section 25 (Craft/Handmade Store), per `field-taxonomy.md`.
- **Font:** `03_Resource_Libraries/font-pairing-guide.md` → matching section for whichever of the above applies.

## Module 8: Common Pitfalls
* Decrementing stock only at checkout confirmation instead of at cart-lock time — allows overselling under concurrent load.
* Hiding shipping cost/tax until the final checkout step — a leading cause of cart abandonment.
* Treating a client-side "success" redirect as proof of payment instead of waiting for the payment webhook.
* No handling for partial failure — e.g., payment succeeds but order-creation fails, leaving a customer charged with no order record.

## Module 9: Compliance & Trust Signals
**Compliance:** PCI-DSS scope reduction is mandatory — raw card data must never touch the backend; use the payment provider's hosted fields/tokenization. Clear, accessible return/refund policy required in most jurisdictions.

**Trust signals:** visible security badges near payment fields, clear return policy link, product reviews/ratings, accurate stock status ("Only 3 left" only if genuinely accurate — false urgency is both an ethical and, in some jurisdictions, legal risk).

---

# AI Engineering

## How AI Should Reason for This Category
1. **Confirm single-vendor vs. marketplace first** — this decision changes the data model (Module 2) and backend pattern (Multi-Tenancy) fundamentally; never assume single-vendor without confirming.
2. **Treat payment and inventory logic as the highest-risk code in the entire project** — apply extra scrutiny (Module 9's AI Engineering hallucination checks from `03-Backend.md`) to any code touching `Order`, `Payment`, or stock decrement.
3. **Default to a proven payment provider's hosted checkout/elements** rather than building custom payment forms, regardless of how simple the request seems.

## Discovery Questions to Ask the User
1. Are you selling physical products, digital products, or both?
2. Roughly how many products/SKUs will the store carry at launch?
3. Is this a single business selling its own products, or will multiple sellers/vendors be involved?
4. Which regions/currencies do you need to support at launch?
5. Do you have a preferred payment provider already (e.g., Razorpay, Stripe), or should one be recommended based on your region?
6. Do customers need accounts, or is guest checkout acceptable?
7. Do you need coupon/discount functionality at launch, or is that a later addition?

---

# Quality Standards

## Completion Checklist
- [ ] Is stock decrement atomic and race-condition-safe under concurrent checkouts?
- [ ] Is order state driven exclusively by verified payment webhooks, never client-side redirects alone?
- [ ] Is all pricing (including shipping and tax) visible before the final payment step?
- [ ] Does checkout work end-to-end on mobile, including payment?
- [ ] Is raw card data confirmed to never pass through the application backend?
- [ ] Is there a clear, accessible return/refund policy linked from checkout?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 7, 8, 10, and 16 applied directly to catalog, product, and checkout UX.
* **03-Backend.md:** Module 17 (Payments) is the core dependency; Modules 2, 10, 13, and 15 applied as described above.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **local-service.md:** Referenced when a business needs both product sales and appointment/booking functionality (e.g., a spa selling retail products alongside services).

---

# Glossary

* **SKU (Stock Keeping Unit):** A unique identifier for a specific sellable variant of a product (e.g., a T-shirt in size M, color Blue).
* **Cart Lock:** Temporarily reserving stock for items in an active checkout session, to prevent overselling during the payment process.
* **Idempotent Webhook Handling:** Processing a payment provider's webhook event such that receiving the same event twice (a common provider retry behavior) never results in a duplicate order or double fulfillment.
* **Guest Checkout:** Completing a purchase without creating a full customer account.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the Commerce Industry Systems specification. |
| 1.1.0 | 2026-07-31 | Doc Architect | Extended Scope and Module 7 (Resource Library Mapping) to cover 3 additional categories added to the Resource Libraries (Agriculture/Farm-to-Table, Garden/Plant/Nursery Store, Craft/Handmade Store), per field-taxonomy.md v2.0.0. |
