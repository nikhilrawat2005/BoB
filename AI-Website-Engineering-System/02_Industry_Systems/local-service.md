# Metadata

* **Document ID:** INDUSTRY-LOCAL-SERVICE-001
* **Version:** 1.1.0
* **Category:** Industry Systems — Local Service
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Restaurants/Cafes, Health & Wellness clinics, Salons/Spas, and other appointment- or order-based local service businesses
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to convert an online visitor into a physical-world action — a table booking, an appointment, or a food order — at a specific time and place.

## Primary Objective
Give the AI a single, authoritative reference for building restaurant, clinic, salon, and similar local-service sites, so that time-slot logic, menu/service listing, and booking flows follow one consistent, reliable pattern.

## Scope
* Restaurants, cafes, and food businesses offering online ordering and/or table reservations.
* Health & wellness clinics, salons, spas, and similar appointment-based service providers.
* Fitness studios, gyms, and sports/energy-training businesses offering class or session bookings — same slot-based booking pattern as the health/wellness variant.
* Any local business where "book a time" or "order for pickup/delivery" is the core conversion.

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* Full e-commerce catalog/shipping logic — see `commerce.md` (a restaurant selling packaged food nationally would follow `commerce.md` instead).
* Clinical/medical record systems (EHR/EMR) — this document covers the public-facing booking site only, not internal clinical software.

---

# Foundations

## What Makes This Category Different
Unlike almost every other category, the core resource being sold is **time-bound and finite** — a table, a chair, a practitioner's hour. Two customers cannot book the same slot; a kitchen has a maximum order throughput per time window. This makes availability/scheduling logic the central engineering concern, in the same way payment logic is central to `commerce.md`. Getting double-booking wrong is this category's equivalent of overselling stock.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Booking (appointment/reservation) or Order (food, for pickup/delivery).

**User Journey (Booking variant):**
1. Discover — Home, Services/Menu overview.
2. Select — a specific service/practitioner or menu items.
3. Choose — an available date and time slot.
4. Confirm — contact details, confirmation (email/SMS).
5. Reminder — automated pre-appointment reminder (common expectation, not optional).

**User Journey (Ordering variant):** Discover menu → Build order → Choose pickup/delivery + time → Pay → Confirmation → Order status tracking.

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **Service / MenuItem** | name, description, price, duration_minutes (services) or prep_time (food), category | belongs to Category |
| **Category** | name (e.g., "Haircuts", "Starters") | has many Services/MenuItems |
| **Provider / Staff** (booking variant) | name, bio, photo, working_hours, services_offered[] | has many Bookings |
| **Availability Slot** | provider_ref, date, start_time, end_time, is_booked | belongs to Provider |
| **Booking** | customer_ref, service_ref, provider_ref, slot_ref, status (confirmed/cancelled/completed), created_at | references Customer, Service, Provider, Slot |
| **Order** (food variant) | customer_ref, items[], fulfillment_type (pickup/delivery), requested_time, status, total | references Customer |
| **Customer** | name, email, phone, booking_history_ref | has many Bookings or Orders |
| **Location** | address, hours_of_operation, phone, map_coordinates | — |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Service/menu listing, clearly organized by category
- [ ] Real-time availability display (no showing a slot that's already taken)
- [ ] Booking or ordering flow with time-slot selection
- [ ] Automated confirmation (email/SMS) on booking/order
- [ ] Business hours, location, and contact information clearly visible
- [ ] Cancellation/rescheduling path for the customer

**Phase 2 / Nice-to-have:**
- [ ] Automated reminder notifications before the appointment
- [ ] Online payment/deposit at time of booking
- [ ] Staff/provider selection (choose a specific practitioner)
- [ ] Loyalty program or repeat-customer perks
- [ ] Waitlist for fully booked slots

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 16: Form Engineering** — the booking/ordering flow is this category's highest-stakes form, requiring a calendar/time-slot picker component with clear unavailable-slot states.
- Apply **Module 10: Responsive Engineering** — a large share of bookings and food orders happen on mobile, often with urgency ("book now," "order for tonight"); the flow must be fast and thumb-friendly.
- Apply **Module 13: CSS Layout Engineering** for menu/service grid presentation — clear pricing and category grouping is a conversion factor, not a cosmetic one.

## Module 5: Backend Pattern Guidance
- Apply **03-Backend.md Module 2: Data Persistence & Modeling** with strict transactional locking around slot booking — two concurrent requests for the same slot must never both succeed; this is this category's equivalent of `commerce.md`'s stock-decrement race condition.
- Apply **Module 11: Background Jobs & Scheduling** for reminder notifications, sent relative to each booking's own time (not a fixed daily cron) — see `03-Backend.md` Module 11's "Recurring-per-entity Jobs" pattern.
- Apply **Module 17: Payment & Billing Integration** only if deposits/online payment are in scope; otherwise this category can often launch without a payment integration at all.
- Apply **Module 14: Real-time Communication** (optional) if live order status updates (e.g., "your food is being prepared") are wanted for the ordering variant.

## Module 6: Content & Copy Patterns
**Typical pages/sections:** Home, Menu/Services, Book/Order, About, Location & Hours, Contact, (Team/Staff, for clinics/salons).

**Tone:** Warm and locally trustworthy — for food, appetite-driven descriptive language; for health/wellness, calm and reassuring language. Both benefit heavily from real photography over stock imagery.

## Module 7: Resource Library Mapping
- **Food/Restaurant:** `03_Resource_Libraries/color-palette-guide.md` → Section 5, Options A onward. Font: matching Section 5.
- **Health/Wellness/Medical:** `03_Resource_Libraries/color-palette-guide.md` → Section 4, Options A onward. Font: matching Section 4.
- **Fitness/Sports/Energy:** `03_Resource_Libraries/color-palette-guide.md` → Section 19, Options A onward. Font: matching Section 19.

## Module 8: Common Pitfalls
* Showing a booking calendar that doesn't reflect real-time availability, leading to double-bookings resolved only by an awkward manual phone call.
* Menu/service pricing that's outdated or missing entirely — a leading cause of visitor drop-off in this category.
* No automated reminder — significantly increases no-show rates for appointment-based businesses.
* Treating "Contact Us to Book" as sufficient — this category converts far better with self-serve booking than with a manual back-and-forth.

## Module 9: Compliance & Trust Signals
**Compliance:** Health/wellness businesses handling any client health information must follow the general data-privacy practices in `01_Engineering_Systems` (Module 16 of `03-Backend.md`) — even a simple "reason for visit" field on a booking form is sensitive data requiring the same minimization and retention discipline.

**Trust signals:** visible real photos of the space/team, genuine reviews/ratings, clear hours and location (with map), and — for health-adjacent businesses — visible credentials/certifications.

---

# AI Engineering

## How AI Should Reason for This Category
1. **Determine booking vs. ordering vs. both** first — this changes the primary entity (Booking vs. Order) and whether time-slot-per-provider logic or menu-and-fulfillment logic is the backend's core concern.
2. **Treat slot-booking concurrency as a correctness-critical path**, on par with how `commerce.md` treats payment/inventory — a double-booked slot is a direct real-world failure, not just a data inconsistency.
3. **Default to simple, real-time slot availability over complex scheduling algorithms** — most local service businesses need "is this slot free, yes/no," not enterprise resource-scheduling optimization.

## Discovery Questions to Ask the User
1. Is the core action a booking/appointment, a food order, or both?
2. Do multiple staff/practitioners each have their own separate availability, or is it one shared calendar?
3. What are your typical service durations or how far in advance can customers book?
4. Do you want customers to pay online at booking time, or pay in person?
5. Do you need automated reminders (email/SMS) before the appointment or order pickup time?
6. Is delivery in scope for food orders, or pickup only?
7. Do you already use a booking/POS tool (e.g., Calendly, Square) that this site should integrate with, or should booking be fully custom-built?

---

# Quality Standards

## Completion Checklist
- [ ] Is slot/table availability shown in real time and locked atomically on booking to prevent double-booking?
- [ ] Does every booking/order trigger an automated confirmation?
- [ ] Is there an automated reminder before the appointment/pickup time (if in scope)?
- [ ] Is the menu/service list current, with visible pricing?
- [ ] Is business location, hours, and contact information visible without scrolling deep into the site?
- [ ] Can a customer cancel or reschedule without calling the business directly?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 10, 13, and 16 applied directly to booking/ordering UX.
* **03-Backend.md:** Modules 2, 11, 14, and 17 applied as described above.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **commerce.md:** Referenced when a food business scales into shipped/packaged product sales beyond local pickup/delivery.

---

# Glossary

* **Slot:** A discrete, bookable unit of time for a specific provider or table.
* **No-show:** A booked customer who does not arrive without cancelling — a key metric this category's reminder systems exist to reduce.
* **Fulfillment Type:** Whether a food order is for pickup or delivery, which changes the required address and timing logic.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the Local Service Industry Systems specification. |
| 1.1.0 | 2026-07-31 | Doc Architect | Extended Scope and Module 7 to cover 1 additional category (Fitness/Sports/Energy), per field-taxonomy.md v2.0.0. |
