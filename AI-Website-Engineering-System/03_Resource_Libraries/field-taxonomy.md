# Metadata

* **Document ID:** RESOURCE-FIELD-TAXONOMY-001
* **Version:** 2.0.0
* **Category:** Resource Library — Field Taxonomy
* **Status:** Complete
* **Dependencies:** 02_Industry_Systems/*.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Canonical master mapping between the 14 visual/marketing industry categories and the 8 engineering-level Industry Systems files, plus their corresponding Color and Font resource sections
* **Last Updated:** 2026-07-31

---

# Purpose

This is the single lookup table the AI (and, eventually, the discovery chatbot) uses to go from "what kind of business/site is this?" to "which files govern it?" It exists because the 14 visual/marketing categories (used for color and font selection) do **not** map one-to-one to the 8 engineering-level Industry Systems files (used for data model and backend/frontend pattern selection) — several visual categories share one engineering pattern.

**How to use this table:** given a user's stated field, find their category below, then apply the corresponding Industry Systems file for engineering/data-model decisions, and the corresponding Color/Font sections for visual decisions.

---

# Master Mapping Table

| # | Visual/Marketing Category | Industry Systems File | Color Guide Section | Font Guide Section |
| :-- | :--- | :--- | :--- | :--- |
| 1 | Business / Corporate | `service-business.md` | Section 1 | Section 1 |
| 2 | Tech / SaaS / Startup | `saas-product.md` | Section 2 | Section 2 |
| 3 | E-commerce / Shopping | `commerce.md` | Section 3 | Section 3 |
| 4 | Health / Wellness / Medical | `local-service.md` | Section 4 | Section 4 |
| 5 | Food / Restaurant | `local-service.md` | Section 5 | Section 5 |
| 6 | Fashion / Beauty | `lifestyle-brand.md` | Section 6 | Section 6 |
| 7 | Education / E-learning | `content-learning.md` | Section 7 | Section 7 |
| 8 | Finance / Banking | `service-business.md` | Section 8 | Section 8 |
| 9 | Real Estate | `service-business.md` | Section 9 | Section 9 |
| 10 | Creative / Portfolio / Agency | `showcase.md` | Section 10 | Section 10 |
| 11 | Kids / Gaming / Fun Brands | `lifestyle-brand.md` | Section 11 | Section 11 |
| 12 | Non-Profit / NGO | `community-cause.md` | Section 12 | Section 12 |
| 13 | Travel / Tourism | `community-cause.md` | Section 13 | Section 13 |
| 14 | Photography / Art | `showcase.md` | Section 14 | Section 14 |
| 15 | Luxury / Premium Brand | `lifestyle-brand.md` | Section 15 | Section 15 |
| 16 | Blog / Editorial / News | `content-learning.md` | Section 16 | Section 16 |
| 17 | Interior Design / Home Decor | `service-business.md` | Section 17 | Section 17 |
| 18 | Industrial / Construction | `service-business.md` | Section 18 | Section 18 |
| 19 | Fitness / Sports / Energy | `local-service.md` | Section 19 | Section 19 |
| 20 | Museum / History / Culture | `community-cause.md` | Section 20 | Section 20 |
| 21 | Agriculture / Farm-to-Table | `commerce.md` | Section 21 | Section 21 |
| 22 | Energy / Solar | `service-business.md` | Section 22 | Section 22 |
| 23 | Garden / Plant / Nursery Store | `commerce.md` | Section 23 | Section 23 |
| 24 | Marine Biology / Aquarium / Science | `community-cause.md` | Section 24 | Section 24 |
| 25 | Craft / Handmade Store | `commerce.md` | Section 25 | Section 25 |

---

# Reasoning for Categories 15–25 (Added in v2)

These 11 categories were added to the Resource Libraries (color/font) after the initial 14-category taxonomy was locked. Each was mapped to an existing Industry Systems file by matching its underlying engineering/business pattern, not its visual theme — consistent with how the original 8 files were grouped:

* **Luxury/Premium Brand → `lifestyle-brand.md`** — brand-personality-driven conversion, same as Fashion/Beauty.
* **Blog/Editorial/News → `content-learning.md`** — structured, sequential content delivery, same underlying pattern as courses (articles/issues instead of lessons).
* **Interior Design/Home Decor → `service-business.md`** — portfolio-backed lead generation, same pattern as Real Estate.
* **Industrial/Construction → `service-business.md`** — B2B trust-led lead generation, same pattern as Business/Corporate.
* **Fitness/Sports/Energy → `local-service.md`** — class/session/slot booking, same pattern as Health/Wellness.
* **Museum/History/Culture → `community-cause.md`** — narrative/story-led engagement, same pattern as Non-Profit.
* **Agriculture/Farm-to-Table → `commerce.md`** — direct product sales.
* **Energy/Solar → `service-business.md`** — consultation-led lead generation, same pattern as Finance.
* **Garden/Plant/Nursery Store → `commerce.md`** — direct product sales.
* **Marine Biology/Aquarium/Science → `community-cause.md`** — story/educational engagement, optional ticket-booking layered in the same way Travel layers booking onto narrative content.
* **Craft/Handmade Store → `commerce.md`** — direct product sales.



---

# Industry Systems File → Visual Categories (Reverse Lookup)

Useful when starting from the engineering file and needing to know which visual/color/font options apply.

| Industry Systems File | Visual Categories It Serves |
| :--- | :--- |
| `commerce.md` | E-commerce/Shopping, Agriculture/Farm-to-Table, Garden/Plant/Nursery Store, Craft/Handmade Store |
| `service-business.md` | Business/Corporate, Finance/Banking, Real Estate, Interior Design/Home Decor, Industrial/Construction, Energy/Solar |
| `saas-product.md` | Tech/SaaS/Startup |
| `local-service.md` | Food/Restaurant, Health/Wellness/Medical, Fitness/Sports/Energy |
| `showcase.md` | Creative/Portfolio/Agency, Photography/Art |
| `content-learning.md` | Education/E-learning, Blog/Editorial/News |
| `community-cause.md` | Non-Profit/NGO, Travel/Tourism, Museum/History/Culture, Marine Biology/Aquarium/Science |
| `lifestyle-brand.md` | Fashion/Beauty, Kids/Gaming/Fun, Luxury/Premium Brand |

---

# How the Discovery Flow Should Use This Document (Stage 2 note)

When a future discovery chatbot asks a user what kind of project they're building, their answer should be matched to a row in the Master Mapping Table above. That single lookup then determines:

1. Which `02_Industry_Systems/*.md` file supplies the data model, MVP feature checklist, and backend/frontend pattern guidance.
2. Which Color Palette section supplies the visual options to offer the user.
3. Which Font Pairing section supplies the matching typography options.

If a user's business genuinely spans two categories (e.g., a spa that also sells retail wellness products), the relevant Industry Systems files already cross-reference each other for exactly this case (see each file's Cross References section) — the mapping here is a starting point, not an exclusive, mutually-restrictive assignment.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-31 | Doc Architect | Initial creation — canonical mapping across all 14 visual categories, 8 Industry Systems files, and matching Color/Font Guide sections. |
| 2.0.0 | 2026-07-31 | Doc Architect | Expanded mapping to cover 11 additional categories (15–25) added to the Resource Libraries, each mapped to an existing Industry Systems file by engineering pattern rather than visual theme. No new Industry Systems files were created. |
