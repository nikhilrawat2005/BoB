# Metadata

* **Document ID:** INDUSTRY-COMMUNITY-CAUSE-001
* **Version:** 1.1.0
* **Category:** Industry Systems — Community & Cause
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Non-Profit/NGO sites, Travel/Tourism sites — story-driven, destination- or cause-driven content
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to move a visitor emotionally through storytelling — toward a donation, a trip booking, or ongoing engagement with a cause or destination.

## Primary Objective
Give the AI a single, authoritative reference for building non-profit and travel/tourism sites, so that story-led content structure, donation/booking flows, and trust-building follow one consistent, reliable pattern.

## Scope
* Non-profit and NGO sites (donation-driven, cause awareness, volunteer recruitment).
* Travel and tourism sites (destination marketing, tour/package showcase, inquiry or booking-led).
* Story/narrative-led institutional sites sharing the same content pattern: museums/history/culture sites, and marine biology/aquarium/science centers (both optionally layering ticket-booking on top of narrative content, similar to how Travel layers booking onto destination storytelling).

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* Full travel-industry booking infrastructure (flight/hotel inventory systems, GDS integration) — this document covers tour/package showcase and inquiry/booking-lead capture, not a full travel-agency reservation system.
* Grant management or donor-relationship-management (CRM) systems — covered only at the level of capturing a donation/inquiry, not full donor lifecycle software.

---

# Foundations

## What Makes This Category Different
Unlike categories driven by functional need (booking a service, buying a product), this category converts primarily through **narrative and emotional resonance** — a specific story (a beneficiary helped, a place experienced) does more conversion work than any feature list or spec sheet. The two sub-categories differ in payment type (a non-profit's donation is a one-time or recurring gift with no "product" delivered on the site; travel's booking is a paid transaction for a real trip) but share the same structural DNA: rich storytelling content leading to a single, clear action.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Donation (one-time or recurring) for non-profits; Booking/Inquiry for travel.

**User Journey (Non-Profit variant):**
1. Discover — Home, often via a specific campaign or story shared externally.
2. Connect — Impact stories, mission, transparency (where funds go).
3. Trust — Financials/transparency reporting, testimonials, partner/certification logos.
4. Give — Donation flow (one-time or recurring).
5. Stay Engaged — Newsletter/updates on impact (optional but valuable for retention).

**User Journey (Travel variant):** Discover destination/package → Explore itinerary and photos → Check reviews/trust signals → Inquire or book → Receive confirmation and pre-trip information.

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **Campaign / Cause** (non-profit) | title, description, goal_amount, raised_amount, status (active/completed), images[] | has many Donations |
| **Donation** | donor_ref, campaign_ref (optional), amount, frequency (one-time/monthly), status | references Donor, Campaign |
| **Donor** | name, email, donation_history_ref, is_recurring | has many Donations |
| **ImpactStory** | title, beneficiary_context, narrative, images[], published_at | references Campaign (optional) |
| **Package / Tour** (travel) | title, destination, duration_days, price, itinerary[], images[], availability_dates[] | has many Bookings |
| **Booking / Inquiry** (travel) | traveler_ref, package_ref, requested_dates, party_size, status (inquiry/confirmed/paid) | references Traveler, Package |
| **Traveler** (travel) | name, email, phone, booking_history_ref | has many Bookings |
| **Testimonial** | source_name, quote, context_ref (campaign or package) | references Campaign or Package |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Clear, story-led mission/destination presentation on the homepage
- [ ] (Non-profit) A functioning, low-friction donation flow with clear amount options
- [ ] (Travel) Package/tour listing with itinerary detail and clear pricing
- [ ] Trust content — impact reporting (non-profit) or reviews/testimonials (travel)
- [ ] A single, unambiguous primary call-to-action per page (donate, or inquire/book)

**Phase 2 / Nice-to-have:**
- [ ] Recurring donation management (non-profit)
- [ ] Donor/traveler account with history
- [ ] Campaign progress bar showing goal vs. raised (non-profit)
- [ ] Interactive itinerary/map view (travel)
- [ ] Email updates/newsletter signup for ongoing engagement

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 15: Animation Engineering** and strong photography/video presentation — this category, like `showcase.md`, relies heavily on visual and narrative impact; invest disproportionately in hero imagery and story-page layout quality.
- Apply **Module 16: Form Engineering** on the donation/inquiry form specifically — for donations, pre-set amount buttons alongside a custom-amount field reduce friction; for travel inquiries, a short initial form (with detailed preferences gathered later, not upfront) improves completion.
- Apply **Module 10: Responsive Engineering** — both sub-categories see significant mobile traffic, often from social-media-driven discovery (a shared campaign story or destination photo).

## Module 5: Backend Pattern Guidance
- **Non-profit:** Apply **03-Backend.md Module 17: Payment & Billing Integration** for donations, with explicit support for recurring donations (subscription-like billing, following the same webhook-driven pattern as `saas-product.md`'s Subscription model) alongside one-time gifts.
- **Travel:** Apply **Module 17** for direct bookings-with-payment, or keep it to a simple **Module 10: Rate Limiting**-protected inquiry endpoint if the business model is inquiry-led (agent follows up manually) rather than self-service booking.
- Apply **Module 13: File & Object Storage** heavily for both — impact-story and destination photography are core content, not decoration.
- Apply **Module 11: Background Jobs & Scheduling** for donor thank-you/receipt emails and recurring-donation processing (non-profit), or pre-trip information sequences (travel).

## Module 6: Content & Copy Patterns
**Typical pages/sections (non-profit):** Home, Our Mission, Impact/Stories, Get Involved (Donate/Volunteer), Transparency/Financials, Contact.
**Typical pages/sections (travel):** Home, Destinations/Packages, Individual Package Detail (itinerary), About/Why Us, Reviews, Contact/Book.

**Tone:** Specific and human — a single named story (a specific person helped, a specific traveler's experience) consistently outperforms abstract mission statements. Avoid generic stock imagery in favor of real, specific photography wherever possible.

## Module 7: Resource Library Mapping
- **Non-Profit/NGO:** `03_Resource_Libraries/color-palette-guide.md` → Section 12, Options A onward.
- **Travel/Tourism:** → Section 13, Options A onward.
- **Museum/History/Culture:** → Section 20, Options A onward.
- **Marine Biology/Aquarium/Science:** → Section 24, Options A onward.
- **Font:** `03_Resource_Libraries/font-pairing-guide.md` → matching section for whichever sub-category applies.

## Module 8: Common Pitfalls
* (Non-profit) No visible transparency on where donations go — a major trust barrier for this category specifically.
* Burying the donation/booking call-to-action beneath long narrative content instead of keeping it persistently accessible.
* (Travel) Outdated availability or pricing left live, leading to a frustrating bait-and-switch at inquiry/booking time.
* Generic, non-specific storytelling ("we help communities") instead of concrete, named impact or experience stories.

## Module 9: Compliance & Trust Signals
**Compliance:** Non-profits in most jurisdictions should display registration/tax-exempt status information, and any payment flow handling donations follows the same PCI-DSS scope-reduction rules as `commerce.md` (never handle raw card data directly).

**Trust signals:** (non-profit) visible financial transparency/annual reports, registration numbers, third-party charity ratings if available; (travel) genuine traveler reviews with photos, clear cancellation/refund policy, and visible licensing/association memberships where relevant.

---

# AI Engineering

## How AI Should Reason for This Category
1. **Identify non-profit vs. travel first** — this determines the core entity (Campaign/Donation vs. Package/Booking) and payment pattern (recurring gift vs. trip payment).
2. **Prioritize narrative content structure as much as functional flow** — unlike most categories, the story architecture (how impact/destination stories are told and sequenced) is itself an engineering-adjacent decision, not just a copywriting one, since it shapes the content data model (Module 2).
3. **For non-profits, treat recurring donations with the same billing rigor as `saas-product.md`'s subscriptions** — a failed recurring charge needs the same dunning/retry consideration as a SaaS subscription, not ad-hoc handling.

## Discovery Questions to Ask the User
1. Is this a non-profit/cause site or a travel/tourism site?
2. (Non-profit) Do you need one-time donations, recurring donations, or both?
3. (Non-profit) Do you have specific impact stories/beneficiary content ready, or does this need to be developed?
4. (Travel) Is the goal direct self-service booking with payment, or inquiry-led with manual follow-up?
5. (Travel) How many destinations/packages will the site feature at launch, and how often do they change?
6. Do you have existing photography/video content, or does this need sourcing?
7. Is donor/traveler account history and repeat engagement a priority, or is this primarily a first-visit conversion site?

---

# Quality Standards

## Completion Checklist
- [ ] Is the primary call-to-action (donate/book/inquire) persistently visible, not buried in long-form content?
- [ ] (Non-profit) Is there visible transparency on fund usage or impact reporting?
- [ ] (Non-profit) Are recurring donations handled with the same webhook-driven billing rigor as a subscription product?
- [ ] (Travel) Is package availability/pricing kept current and accurate?
- [ ] Does the storytelling content use specific, named examples rather than generic claims?
- [ ] Is photography/video genuine and high-quality rather than generic stock imagery?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 10, 15, and 16 applied directly to storytelling and donation/booking UX.
* **03-Backend.md:** Modules 11, 13, and 17 applied as described above.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **saas-product.md:** Referenced for the recurring-donation billing pattern (non-profit variant).
* **commerce.md:** Referenced for the direct-payment booking pattern (travel variant).

---

# Glossary

* **Campaign:** A specific, often time-bound fundraising initiative within a non-profit's broader mission.
* **Recurring Donation:** A donor's ongoing, automatically repeating gift (e.g., monthly), functionally similar to a subscription.
* **Itinerary:** The day-by-day breakdown of a travel package's activities and destinations.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the Community & Cause Industry Systems specification. |
| 1.1.0 | 2026-07-31 | Doc Architect | Extended Scope and Module 7 to cover 2 additional categories (Museum/History/Culture, Marine Biology/Aquarium/Science), per field-taxonomy.md v2.0.0. |
