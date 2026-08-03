# Metadata

* **Document ID:** INDUSTRY-SHOWCASE-001
* **Version:** 1.0.0
* **Category:** Industry Systems — Creative Showcase
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Portfolios, Creative Agencies, Photography & Art sites, Freelancer showcase sites
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to display a body of creative work — visually, credibly, and memorably — and convert a viewer into an inquiry, hire, or booking.

## Primary Objective
Give the AI a single, authoritative reference for building portfolio, creative agency, and photography/art websites, so that every such project follows the same proven data model and structural pattern instead of being improvised from scratch each time.

## Scope
* Individual portfolios (designers, developers, photographers, artists, writers).
* Small creative agency/studio sites (team + work + services).
* Photography and fine-art showcase sites (galleries, print sales optional).
* Freelancer "hire me" sites where the work itself is the primary sales pitch.

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* Any site where the primary conversion is a purchase transaction of physical/digital goods at scale — see `commerce.md` (a photographer selling prints as a side feature stays here; a print-shop-as-a-business belongs in `commerce.md`).

---

# Foundations

## What Makes This Category Different
Unlike almost every other category, the **work itself is the product being sold** — not a service description, not a price list. The entire site exists to make a visual argument: "look at what I/we can do, therefore trust me/us." This means visual presentation quality, load performance for media, and narrative sequencing (how work is grouped and ordered) matter more here than in any other category. The data model is also unusually shallow — there is rarely a complex transactional backend, and the real engineering challenge is media handling, not business logic.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Contact/inquiry, hire, or booking request — not a direct purchase (unless print sales are a secondary feature).

**User Journey:**
1. Land on Home/Hero — immediate visual impression of quality and style.
2. Browse Work/Gallery — scan a curated set of projects.
3. Open a Case Study or single artwork/photo for depth.
4. Check About — credibility, process, personality.
5. Contact — inquiry form, email, or booking calendar.

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **Project** (or Artwork/Shoot) | title, slug, cover_image, gallery_images[], category/tag, client_name (optional), year, description, is_featured | belongs to Category; has many Media |
| **Media** | url, type (image/video), alt_text, order_index, dimensions | belongs to Project |
| **Category/Tag** | name, slug | has many Projects |
| **TeamMember** (agency variant only) | name, role, bio, photo, social_links[] | — |
| **Testimonial** (optional) | client_name, quote, project_ref | belongs to Project (optional) |
| **Inquiry** | name, email, message, project_ref (optional), submitted_at, status | references Project (optional) |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Project/work grid with filtering by category or tag
- [ ] Individual project/case-study detail view
- [ ] About/bio section
- [ ] Contact method (form, email link, or booking link)
- [ ] Mobile-optimized image viewing (lightbox or full-bleed responsive gallery)

**Phase 2 / Nice-to-have:**
- [ ] Client testimonials section
- [ ] Password-protected private galleries (common for photographers delivering client shoots)
- [ ] Downloadable resume/press kit (individual portfolios)
- [ ] Print/digital sales integration (photography — becomes a light `commerce.md` extension)
- [ ] Blog/journal for process or behind-the-scenes content

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 15: Animation Engineering** — scroll-reveal and hover-state transitions are expected in this category more than any other; they are part of the "quality signal," not decoration.
- Apply **Module 17: Offline and Resilience Engineering** loosely — lazy-load and progressively enhance images so the gallery stays usable on slow connections; a broken gallery is a direct credibility loss for this category.
- Apply **Module 10: Responsive Engineering** with an image-grid-first approach — masonry or CSS grid layouts are the default pattern, not a stacked list.
- Apply **Module 7: Performance Engineering** aggressively on image weight (responsive `srcset`, modern formats like WebP/AVIF, blur-up placeholders) — this category is the most image-heavy of all 8, so this is the single highest-leverage performance area.

## Module 5: Backend Pattern Guidance
- Apply **03-Backend.md Module 13: File & Object Storage** — this is the most backend-relevant module for this category; direct-to-storage upload and CDN-served images are essential given the media volume.
- Keep the core data model intentionally simple — a full relational backend is usually overkill for a solo portfolio; a headless CMS or even a structured static content approach (Markdown/JSON-driven) is often sufficient and preferred.
- If password-protected client galleries are required, apply **Module 3: Authentication & Authorization** in its lightest form (a single shared gallery password/token, not full user accounts) — do not over-engineer auth for a feature that rarely needs more than a shareable secure link.
- Payment/print-sales, if present, apply **Module 17: Payment & Billing Integration** exactly as in `commerce.md`, scoped to a small catalog.

## Module 6: Content & Copy Patterns
**Typical pages/sections:** Home/Hero, Work/Portfolio Grid, Individual Case Study, About, (Team, for agencies), Testimonials (optional), Contact.

**Tone:** Confident but understated — let the work carry the argument. Avoid heavy sales copy; captions and short process notes outperform long persuasive paragraphs in this category. Case studies that show *process* (before/after, sketches, iterations) build more trust than polished-only galleries.

## Module 7: Resource Library Mapping
- **Color:** `03_Resource_Libraries/color-palette-guide.md` → Section 14 (Photography/Art) Options A–C, or Section 10 (Creative/Portfolio/Agency) Options A–C, depending on whether the site leans moody/dramatic or clean/gallery-style.
- **Font:** `03_Resource_Libraries/font-pairing-guide.md` → the matching Section 10 or Section 14 entries, keeping typography restrained — this category needs the visuals, not the type, to be the star.

## Module 8: Common Pitfalls
* Overloading the homepage with every project instead of a curated, small featured set — dilutes the "best work" impression.
* Un-optimized, full-resolution images served directly — the single most common performance failure in this category.
* No clear contact path — a beautiful gallery with a buried or missing contact method loses the entire point of the site.
* Inconsistent image aspect ratios breaking grid layouts — needs a defined content/image standard, not ad-hoc uploads.

## Module 9: Compliance & Trust Signals
N/A for legal compliance — see `01_Engineering_Systems` general data-privacy notes for the contact form only (standard consent/data-handling applies to any form that stores an email/name).

**Trust signals specific to this category:** visible client names/logos (with permission), testimonials tied to specific projects, process transparency (behind-the-scenes content), and — where relevant — press mentions or awards.

---

# AI Engineering

## How AI Should Reason for This Category
1. **Identify the real "product":** confirm whether the site is (a) an individual's personal portfolio, (b) a multi-person agency, or (c) a photographer/artist with potential print sales — this changes whether `TeamMember` and light `commerce.md` patterns are needed.
2. **Default to simplicity:** unless the user explicitly needs client accounts, private galleries, or sales, resist adding backend complexity — a static/CMS-driven site is usually the correct answer here, not a full database-backed app.
3. **Prioritize media pipeline decisions early:** where images are stored, how they're optimized, and how the gallery is structured should be decided before any visual design work begins, since they constrain layout options.

## Discovery Questions to Ask the User
1. Is this for you individually, or for a team/agency?
2. Roughly how many projects/pieces of work will be shown, and does that number grow quickly (weekly) or slowly (a few per year)?
3. Do you need to sell anything directly (prints, downloads), or is the goal purely inquiries/hiring?
4. Do you ever need to share private, password-protected galleries with individual clients?
5. Do you have existing photography/video assets ready, or do they need to be gathered/optimized first?
6. Is there a specific mood — clean and gallery-like, or moody and dramatic — you're drawn to?
7. Do you want client testimonials or case-study depth (process, before/after), or a pure visual gallery?

---

# Quality Standards

## Completion Checklist
- [ ] Is there a clear, curated featured-work selection on the homepage (not everything at once)?
- [ ] Are all gallery images served in responsive, optimized formats (not raw uploads)?
- [ ] Does every project have a working detail/case-study view?
- [ ] Is the contact path visible from every major page, not buried?
- [ ] If private galleries are in scope, is access control implemented at the lightest sufficient level?
- [ ] Does the visual design match one of the mapped Resource Library options for this category?
- [ ] Is the site usable and fast on a throttled mobile connection (given the image weight risk)?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 7, 10, 15, and 17 are applied directly to this category's media-heavy, animation-forward presentation needs.
* **03-Backend.md:** Module 13 (File & Object Storage) is the primary backend concern; Module 3 (Auth) applies only in its lightest form for private galleries; Module 17 (Payments) applies only if print/digital sales are in scope.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **commerce.md:** Referenced when a photographer/artist adds print or digital sales beyond a simple showcase.

---

# Glossary

* **Case Study:** A detailed, single-project page going beyond a thumbnail — typically includes process, challenge, and outcome narrative.
* **Lightbox:** A UI pattern that opens an image in a focused overlay view without navigating away from the gallery grid.
* **Masonry Layout:** A grid layout where items of varying heights are packed efficiently without fixed row heights, common for photography grids.
* **Blur-up Placeholder:** A low-resolution, blurred preview of an image shown while the full-resolution version loads, to avoid layout shift and perceived slowness.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the Showcase Industry Systems specification. |
