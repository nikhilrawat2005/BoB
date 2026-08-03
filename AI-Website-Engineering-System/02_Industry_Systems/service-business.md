# Metadata

* **Document ID:** INDUSTRY-SERVICE-BUSINESS-001
* **Version:** 1.1.0
* **Category:** Industry Systems — Service Business
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Business/Corporate sites, Finance/Banking sites, Real Estate sites — trust-led, lead-generation-driven businesses
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to build enough credibility and trust that a visitor submits their contact information or reaches out — rather than transacting directly on the site.

## Primary Objective
Give the AI a single, authoritative reference for building corporate, financial-services, and real-estate sites, so that lead-capture flow, trust architecture, and content structure follow one consistent, credible pattern.

## Scope
* Corporate/business websites (agencies, consultancies, B2B service providers).
* Finance/banking-adjacent sites (advisors, lenders, fintech marketing sites — not the transactional banking application itself).
* Real estate sites (agencies, individual agents, property listing showcases).
* Adjacent lead-gen/trust-led niches sharing the same core pattern: interior design/home decor (portfolio-backed, like real estate), industrial/construction (B2B trust-led, like corporate), and energy/solar (consultation-led, like finance).

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* Direct e-commerce transactions — see `commerce.md`.
* Actual regulated financial transaction processing (loan disbursement, trading, account opening) — this document covers the public-facing marketing/lead-gen site only, not licensed financial infrastructure.
* Property transaction/escrow systems — this covers listing showcase and lead capture only.

---

# Foundations

## What Makes This Category Different
Unlike categories with a direct, immediate transaction (commerce) or a bookable slot (local-service), the entire purpose here is to **compress the distance between "stranger" and "qualified lead who trusts you enough to talk."** There is no cart, no calendar — the core asset is credibility, and the core mechanic is a well-placed, well-qualified contact/inquiry form. Content depth (case studies, credentials, results) does more conversion work here than any UI pattern.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Lead capture — a contact form submission, consultation request, or property inquiry.

**User Journey:**
1. Discover — Home, often via search for a specific service/need or a specific property.
2. Establish Credibility — About, team/credentials, case studies/results, or (real estate) property details.
3. Reduce Risk — testimonials, client logos, certifications, past results.
4. Convert — inquiry form, "book a consultation," or "request a viewing."
5. Nurture — follow-up (often manual/sales-led, not automated, unlike SaaS).

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **Service / Offering** | name, description, category, outcome_summary | belongs to Category |
| **Case Study / Result** | title, client_name (optional), challenge, outcome, metrics | references Service (optional) |
| **TeamMember** | name, role, credentials, photo, bio | — |
| **Testimonial** | client_name, quote, company (optional) | references Service or CaseStudy (optional) |
| **Lead / Inquiry** | name, email, phone, message, source_page, submitted_at, status (new/contacted/qualified/closed) | — |
| **Property** (real estate variant) | address, price, bedrooms, sqft, images[], status (available/pending/sold), listing_agent_ref | belongs to Agent |
| **Agent** (real estate variant) | name, photo, bio, contact_info, listings_ref | has many Properties |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Clear service/offering description with tangible outcomes, not just feature lists
- [ ] Credibility section (team, credentials, or track record)
- [ ] At least one well-placed, low-friction contact/inquiry form
- [ ] About/company story page
- [ ] (Real estate) property listing grid with filtering (price, bedrooms, location)

**Phase 2 / Nice-to-have:**
- [ ] Case studies with measurable results
- [ ] Client testimonial section with named, verifiable sources
- [ ] Calendar-based consultation booking (crosses into `local-service.md` patterns if added)
- [ ] Resource/content hub (guides, calculators) for SEO and lead nurturing
- [ ] (Real estate) saved-search / property alert signup

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 16: Form Engineering** on the lead-capture form specifically — this is the single highest-leverage element on the entire site; keep required fields minimal and place it where intent is highest (end of a service page, not buried in a generic contact page only).
- Apply **Module 1: Semantic HTML Engineering** and **Module 8: Accessibility Engineering** carefully on case-study/content pages — this category relies on long-form trust content being genuinely readable and crawlable (SEO matters more here than in most categories, since organic search is a primary discovery channel).
- Apply **Module 13: CSS Layout Engineering** for the real estate variant's listing grid/filter UI specifically — filter-heavy browsing is the core interaction pattern there.

## Module 5: Backend Pattern Guidance
- Apply **03-Backend.md Module 10: Rate Limiting & Throttling** on the lead form endpoint — contact forms are a common spam/bot target.
- Keep the core backend intentionally light — this category rarely needs a complex data model; a CMS-driven content structure plus a simple lead-capture endpoint (routing to email/CRM) is usually sufficient.
- Apply **Module 13: File & Object Storage** for the real estate variant's property images, with the same CDN-serving pattern as `commerce.md`.
- If a CRM integration is required (routing leads into e.g. HubSpot/Salesforce), treat it as an external API integration governed by the same defensive-integration principles as any third-party call in `03-Backend.md`'s Foundations section (timeouts, retries, graceful degradation if the CRM is unreachable — the lead must never be silently lost).

## Module 6: Content & Copy Patterns
**Typical pages/sections:** Home, Services/Offerings, About/Team, Case Studies/Results, Testimonials, Contact, (Listings, for real estate).

**Tone:** Authoritative and specific — named results and credentials outperform generic trust language ("industry-leading," "best-in-class"). Real estate content benefits from high-quality photography and precise, factual property detail over promotional copy.

## Module 7: Resource Library Mapping
- **Business/Corporate:** `03_Resource_Libraries/color-palette-guide.md` → Section 1, Options A onward.
- **Finance/Banking:** → Section 8, Options A onward.
- **Real Estate:** → Section 9, Options A onward.
- **Interior Design/Home Decor:** → Section 17, Options A onward.
- **Industrial/Construction:** → Section 18, Options A onward.
- **Energy/Solar:** → Section 22, Options A onward.
- **Font:** `03_Resource_Libraries/font-pairing-guide.md` → matching section for whichever sub-category applies.

## Module 8: Common Pitfalls
* A single generic "Contact Us" page as the only conversion point, instead of contextual inquiry forms placed at points of high intent (end of a service description, on each property listing).
* Vague, unverifiable trust claims instead of specific, named case studies or credentials.
* (Real estate) outdated listings left live after a property is sold/rented — a fast credibility loss.
* Treating this as a purely visual/brand exercise and under-investing in the actual lead-routing mechanism (form submissions that go nowhere or aren't monitored).

## Module 9: Compliance & Trust Signals
**Compliance:** Finance-adjacent sites must be careful not to imply regulated financial services (advice, lending decisions) are happening on the site itself unless properly licensed — content should be reviewed for this boundary. Standard data-privacy practice applies to any stored lead data (see `03-Backend.md` Module 16).

**Trust signals:** verifiable credentials/certifications, named client testimonials, transparent team bios (real photos, real names), and — for real estate — accurate, current listing data with a visible last-updated indicator.

---

# AI Engineering

## How AI Should Reason for This Category
1. **Identify the sub-category first** (general business/corporate, finance-adjacent, or real estate) — this determines whether `Property`/`Agent` entities are needed and which compliance considerations apply.
2. **Prioritize lead-capture placement and content depth over visual complexity** — this category converts on trust and clarity, not on interactive flourishes; resist over-engineering the frontend at the expense of content quality.
3. **Treat every lead form submission as something that must never silently fail** — confirm there's a reliable path (email notification, CRM webhook, or database record with monitoring) before considering the feature complete.

## Discovery Questions to Ask the User
1. Which of the three lean best describes your business: general corporate/consulting, finance-adjacent, or real estate?
2. What's the one action you most want a visitor to take — fill a form, call, book a consultation?
3. Do you have existing case studies, results, or testimonials ready to feature, or do these need to be gathered first?
4. (Real estate) Roughly how many active listings will the site manage, and how often do they change?
5. Do leads need to route into an existing CRM/email system, or is a simple notification sufficient for now?
6. Is content marketing (blog, guides) part of the plan for organic traffic, or is this a lean brochure-style site?

---

# Quality Standards

## Completion Checklist
- [ ] Is there a contextual, low-friction lead form near every major point of visitor intent (not just one generic contact page)?
- [ ] Are trust claims backed by specific, named credentials or results rather than generic language?
- [ ] Is the lead-capture pathway confirmed reliable (tested end-to-end, monitored for failures)?
- [ ] (Real estate) Are listings kept current, with sold/unavailable properties clearly marked or removed?
- [ ] Does the site's content structure support SEO discovery for the target service/location keywords?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 1, 8, 13, and 16 applied directly to trust-content and lead-form UX.
* **03-Backend.md:** Modules 10 and 13 applied as described above; external CRM integration follows general third-party integration principles.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **local-service.md:** Referenced if consultation booking moves from a simple inquiry form to full calendar-based scheduling.

---

# Glossary

* **Lead:** A visitor who has submitted contact information expressing interest, prior to becoming a customer/client.
* **Qualified Lead:** A lead confirmed (usually manually, by sales) to be a genuine, viable prospect.
* **Listing:** A single property entry in the real estate variant, with its own status lifecycle (available/pending/sold).

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the Service Business Industry Systems specification. |
| 1.1.0 | 2026-07-31 | Doc Architect | Extended Scope and Module 7 to cover 3 additional categories (Interior Design/Home Decor, Industrial/Construction, Energy/Solar), per field-taxonomy.md v2.0.0. |
