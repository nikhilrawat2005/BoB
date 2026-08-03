# Metadata

* **Document ID:** INDUSTRY-CONTENT-LEARNING-001
* **Version:** 1.1.0
* **Category:** Industry Systems — Content & Learning
* **Status:** Draft
* **Dependencies:** CORE-ARCH-001, 01-Design.md, 02-Frontend.md, 03-Backend.md, 03_Resource_Libraries/color-palette-guide.md, 03_Resource_Libraries/font-pairing-guide.md
* **Scope:** Education/E-learning platforms, course-selling sites, cohort-based programs, knowledge-base/tutorial sites
* **Last Updated:** 2026-07-30

---

# Identity & Purpose

## Mission
To define the engineering and structural pattern for any website whose primary job is to deliver structured learning content and track a learner's progress through it.

## Primary Objective
Give the AI a single, authoritative reference for building education and e-learning sites, so that course structuring, progress tracking, and content-access logic follow one consistent, reliable pattern.

## Scope
* Self-paced online course platforms (single-instructor or multi-instructor).
* Cohort-based/live program sites (fixed schedule, group-based).
* Free knowledge-base or tutorial sites (no payment gate, pure content delivery).
* Blog/editorial/news sites — sharing this category's core pattern of structured, sequential content delivery (issues/articles instead of modules/lessons), without the enrollment-gated access control.

## Out of Scope
* Generic frontend/backend/design rules — see `01_Engineering_Systems/`.
* Color and font selection — see `03_Resource_Libraries/`.
* Live video-conferencing infrastructure itself (the site links out to or embeds a provider like Zoom; it does not build video conferencing).
* Full-scale institutional LMS features (grading rubrics, plagiarism detection, degree accreditation tracking) — this document covers course delivery and progress tracking at a course-creator/small-platform scale.

---

# Foundations

## What Makes This Category Different
Unlike categories where the transaction (purchase, booking, lead) is the finish line, here **the transaction is the starting line** — the real engineering challenge is what happens *after* enrollment: structured content delivery in a defined order, progress tracking that must survive across sessions and devices, and access control tied to enrollment status. A learner returning after two weeks must resume exactly where they left off; this makes progress state a first-class, persistent concern in a way most other categories don't require.

---

# Complete Knowledge Base

## Module 1: Core Business Model & User Journey
**Primary conversion action:** Enrollment (paid purchase, free signup, or cohort application).

**User Journey:**
1. Discover — course/program landing page, often via content marketing or search.
2. Evaluate — curriculum outline, instructor credibility, testimonials/outcomes.
3. Enroll — purchase or signup.
4. Learn — progress through structured content (modules/lessons).
5. Complete — certificate/completion marker, potential upsell to next course.

## Module 2: Required Data Entities

| Entity | Key Fields | Relationships |
|---|---|---|
| **Course** | title, slug, description, price (or free), instructor_ref, status (draft/published) | has many Modules; belongs to Instructor |
| **Module** | title, order_index, course_ref | belongs to Course; has many Lessons |
| **Lesson** | title, content_type (video/text/quiz), content_ref, order_index, duration | belongs to Module |
| **Instructor** | name, bio, photo, credentials | has many Courses |
| **Enrollment** | learner_ref, course_ref, enrolled_at, status (active/completed/expired) | references Learner, Course |
| **Progress** | enrollment_ref, lesson_ref, status (not_started/in_progress/completed), completed_at | belongs to Enrollment, references Lesson |
| **Learner** | name, email, enrollments_ref | has many Enrollments |
| **Certificate** (optional) | enrollment_ref, issued_at, certificate_url | belongs to Enrollment |

## Module 3: Must-Have Features (MVP Baseline)

**Non-negotiable:**
- [ ] Course/curriculum listing with clear structure (modules → lessons)
- [ ] Enrollment flow (free or paid)
- [ ] Content delivery with access gated to enrolled learners
- [ ] Progress tracking that persists and resumes correctly across sessions/devices
- [ ] Clear "what you'll learn" and instructor credibility on the course landing page

**Phase 2 / Nice-to-have:**
- [ ] Quizzes/assessments with scoring
- [ ] Certificates of completion
- [ ] Discussion/community feature per course or lesson
- [ ] Drip content (lessons unlocked on a schedule rather than all at once)
- [ ] Multi-instructor marketplace model

## Module 4: Frontend Pattern Guidance
- Apply **02-Frontend.md Module 18: Web APIs Integration** for video playback specifically — proper use of the video element/provider SDK with resume-position tracking is central to this category's UX.
- Apply **Module 4: React Engineering** (or equivalent component architecture) for the lesson-navigation sidebar/progress-tracker component — this is the category's signature reusable UI pattern, used across every course.
- Apply **Module 10: Responsive Engineering** — mobile learning (especially for text/audio lessons) is common; ensure the content player and navigation work well on small screens.
- Apply **Module 8: Accessibility Engineering** on video content specifically — captions/transcripts are both an accessibility requirement and a genuine learning aid.

## Module 5: Backend Pattern Guidance
- Apply **03-Backend.md Module 2: Data Persistence & Modeling** for the Progress entity with careful attention to idempotent writes — a learner rapidly clicking "next lesson" or reloading mid-video must never corrupt or duplicate progress records.
- Apply **Module 3: Authentication & Authorization** to gate content access strictly by enrollment status — a common and serious mistake in this category is content being accessible via a direct URL without checking enrollment.
- Apply **Module 13: File & Object Storage** for video/content hosting, ideally via a provider built for video streaming (not raw object storage alone) given bandwidth and adaptive-quality needs.
- Apply **Module 17: Payment & Billing Integration** exactly as in `commerce.md` for one-time course purchases, or as in `saas-product.md`'s Subscription pattern if the platform sells access via a recurring membership.

## Module 6: Content & Copy Patterns
**Typical pages/sections:** Home, Course Catalog, Individual Course Landing (curriculum + instructor + testimonials), Enrollment/Checkout, Learning Dashboard (in-app), Lesson View, Instructor Profile.

**Tone:** Outcome-focused — what the learner will be able to do after completing the course, not just a list of topics covered. Curriculum transparency (a visible, detailed module/lesson outline before purchase) builds more trust than vague course descriptions.

## Module 7: Resource Library Mapping
- **Color:** `03_Resource_Libraries/color-palette-guide.md` → Section 7 (Education/E-learning) Options A onward, chosen by audience (Option B "Kids Learning" if the target learners are children). For editorial/blog sites: Section 16 (Blog/Editorial/News).
- **Font:** `03_Resource_Libraries/font-pairing-guide.md` → matching section for whichever applies.

## Module 8: Common Pitfalls
* Content accessible via direct link without verifying active enrollment — a common access-control gap in this category specifically.
* Progress that resets or fails to sync across devices — a frequent source of learner frustration and churn.
* Course landing pages that oversell outcomes without a visible, honest curriculum breakdown.
* No clear "resume where I left off" entry point — forcing a returning learner to hunt through the course structure again.

## Module 9: Compliance & Trust Signals
**Compliance:** If the platform serves minors (children's education), additional data-privacy care applies (see `03-Backend.md` Module 16) — minimal data collection and parental-consent considerations where relevant. Standard learner data-privacy practice otherwise applies.

**Trust signals:** visible instructor credentials, learner testimonials/outcome stories, a transparent curriculum outline before purchase, and — where applicable — completion/certification statistics.

---

# AI Engineering

## How AI Should Reason for This Category
1. **Design the Course → Module → Lesson → Progress hierarchy before any UI** — this nested structure is the backbone of the entire category and is expensive to restructure later.
2. **Treat enrollment-gated access control as a correctness-critical path**, on par with how `saas-product.md` treats subscription state — an access-control bug here directly leaks paid content.
3. **Default to idempotent, resumable progress tracking** — assume the learner will reload, switch devices, or lose connection mid-lesson, and design writes accordingly.

## Discovery Questions to Ask the User
1. Is this self-paced content, a live cohort-based program, or both?
2. Roughly how many courses, and how many modules/lessons per course, at launch?
3. Is content primarily video, text, or a mix?
4. Do learners need progress tracking and resume functionality, or is this a simpler content-access site?
5. Will there be one instructor or multiple (marketplace-style)?
6. Do you need quizzes, certificates, or completion tracking at launch, or is that a later addition?
7. Is pricing per-course, a subscription/membership for all content, or free?

---

# Quality Standards

## Completion Checklist
- [ ] Is content access strictly gated by verified enrollment status, checked on every request?
- [ ] Does progress persist correctly and resume accurately across sessions and devices?
- [ ] Is the curriculum (module/lesson structure) visible before purchase?
- [ ] Does video content include captions or a transcript?
- [ ] Is the "resume learning" path clear and immediate for a returning learner?
- [ ] Is instructor credibility (bio, credentials) visible on the course landing page?

---

# Cross References

* **CORE-ARCH-001:** This document instantiates the Industry Systems category (Section 0.7) within the locked document hierarchy.
* **02-Frontend.md:** Modules 4, 8, 10, and 18 applied directly to content-player and progress-tracking UX.
* **03-Backend.md:** Modules 2, 3, 13, and 17 applied as described above.
* **03_Resource_Libraries/color-palette-guide.md** and **font-pairing-guide.md:** Sourced for all visual styling decisions — never redefined here.
* **saas-product.md:** Referenced when course access is sold via a recurring membership/subscription rather than a one-time purchase.
* **commerce.md:** Referenced for the one-time-purchase payment pattern.

---

# Glossary

* **Drip Content:** Lessons released to a learner on a schedule (e.g., one module per week) rather than all at once upon enrollment.
* **Cohort:** A group of learners progressing through a program together on a fixed schedule, as distinct from self-paced enrollment.
* **Resume Position:** The exact point (lesson, and often timestamp within a video) a learner last reached, used to restore their place on return.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-30 | Doc Architect | Initial creation of the Content & Learning Industry Systems specification. |
| 1.1.0 | 2026-07-31 | Doc Architect | Extended Scope and Module 7 to cover 1 additional category (Blog/Editorial/News), per field-taxonomy.md v2.0.0. |
