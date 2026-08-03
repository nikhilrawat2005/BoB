# Metadata

* **Document ID:** RESOURCE-PLATFORM-STACK-001
* **Version:** 3.1.0
* **Category:** Resource Library — Platform & Tool Stack
* **Status:** Complete
* **Dependencies:** None (referenced across all Industry Systems and Engineering Systems files where a specific tool/platform choice is relevant)
* **Scope:** A neutral, per-function menu of platform/tool options — free and paid — for every recurring technical need across projects, to be selected based on each project's specific requirements
* **Last Updated:** 2026-07-31

---

# Website Model & Platforms Guide

*Multiple platform options for every functional need — both free/non-paid and paid — so the right tool can be chosen based on each project's budget, scale, and requirements. Selection should be driven entirely by that project's context (budget, scale, existing client tools).*

---

## 1. Database + Authentication

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Firebase** | Yes (Spark plan) | Yes (Blaze, pay-as-you-go) | Real-time DB + Auth + Hosting in one. Spark plan quota exhausts fast under real traffic. |
| **Supabase** | Yes (generous) | Yes (Pro tier) | Postgres-based (relational, more structured than Firebase's NoSQL); open-source; good choice when relational data modeling matters. |
| **PocketBase** | Yes (self-hosted, free) | Hosting cost only | Single-file backend (SQLite-based); lightweight, good for small/simple projects; self-hosting required. |
| **Appwrite** | Yes (self-hosted or cloud free tier) | Yes (Cloud Pro) | Open-source Firebase alternative; more control over hosting. |
| **AWS Amplify / Cognito** | Limited free tier | Yes (usage-based) | Enterprise-grade; more setup complexity, best when the project already lives in AWS. |

## 2. Deployment / Hosting

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Vercel** | Yes (Hobby) | Yes (Pro) | Excellent DX, tight Next.js integration. |
| **Railway** | Limited free credit | Yes (usage-based) | Backend + database hosting; simple deploys. |
| **Render** | Yes (free web services, sleep on idle) | Yes | Backend, cron jobs. |
| **Netlify** | Yes | Yes (Pro) | Similar niche to Vercel; strong for static/JAMstack sites. |
| **Fly.io** | Limited free allowance | Yes (usage-based) | Good for apps needing to run close to users globally (edge deployment). |
| **DigitalOcean App Platform** | No free tier (trial credit only) | Yes | Straightforward pricing, good when predictable fixed cost matters over usage-based billing. |

## 3. Code Discussion / Coding Help

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Claude** | Yes (limited) | Yes (Pro/Max) | Deep coding discussion, debugging, explanation. |
| **ChatGPT** | Yes (limited) | Yes (Plus/Pro) | Coding help, general discussion. |
| **Gemini** | Yes (limited) | Yes (Advanced) | Strong at large-context tasks. |
| **DeepSeek** | Yes (generous free tier) | Yes (API, cheap) | Good low-cost option when budget is a constraint. |

## 4. Code Editor (AI-assisted)

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Cursor** | Yes (limited) | Yes (Pro) | AI-powered editor. |
| **Antigravity** | Varies | Varies | Google's agentic coding IDE. |
| **GitHub Copilot** (in VS Code) | Free for students/limited use | Yes | Widely integrated, good default if already using VS Code. |
| **Windsurf** | Yes (limited) | Yes | Another agentic coding editor, comparable to Cursor. |

## 5. Image Generation

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Gemini** | Yes (limited) | Yes | General-purpose image generation. |
| **ChatGPT** | Yes (limited) | Yes (Plus) | General-purpose image generation. |
| **Ideogram** | Yes (limited) | Yes | Strong at text-in-image generation. |
| **Stable Diffusion (self-hosted / Automatic1111)** | Free (compute cost only) | — | Full control, no per-image cost, requires setup/GPU. |

## 6. Media Storage / Optimization

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Cloudinary** | Yes (generous free tier) | Yes | Upload, resize, CDN delivery in one. |
| **AWS S3 + CloudFront** | Free tier (12 months) | Yes (usage-based) | More manual setup, but scales predictably and cheaply at high volume. |
| **ImageKit** | Yes | Yes | Similar niche to Cloudinary, often cheaper at scale. |
| **Uploadthing** | Yes (limited) | Yes | Simple, developer-friendly, good for Next.js projects specifically. |

## 7. Email Service

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **EmailJS** | Yes (limited sends/month) | Yes | Contact forms without a backend. |
| **Resend** | Yes (generous free tier) | Yes | Developer-friendly, good when a backend already exists to trigger sends. |
| **SendGrid** | Yes (limited) | Yes | Established, good deliverability at scale. |
| **Nodemailer (self-hosted via SMTP)** | Free (SMTP provider cost only) | — | Full control, requires your own SMTP credentials (e.g., Gmail, a domain's mail provider). |

## 8. Payment Gateway

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Razorpay** | No free tier (transaction fees apply) | Pay-per-transaction | Strong for India (cards, UPI, netbanking). |
| **Stripe** | No free tier (transaction fees apply) | Pay-per-transaction | Best default for international/global projects; not fully available in India for all account types. |
| **PayPal** | No free tier (transaction fees apply) | Pay-per-transaction | Widely trusted internationally, simpler integration for basic needs. |
| **Cashfree** | No free tier (transaction fees apply) | Pay-per-transaction | India-focused alternative to Razorpay. |

## 9. Animation

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Motion.dev (Framer Motion)** | Free (open-source library) | — | Common default for React/Next.js animation. |
| **GSAP** | Free (core), some plugins paid (Club GreenSock) | Yes (for premium plugins) | More powerful for complex scroll-driven sequences (e.g., ScrollTrigger). |
| **Lenis** | Free (open-source) | — | Smooth-scroll library, commonly paired with GSAP. |
| **Lottie** | Free (open-source player) | Design tool (After Effects) is paid | For designer-created vector animations exported from After Effects. |

## 10. Free/Direct LLM API *(for adding AI features into an app)*

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Gemini API** | Yes (usable free tier) | Yes | Cheap way to integrate AI features. |
| **Grok API** | Limited | Yes | Alternative provider. |
| **OpenRouter** | Yes (free models available) | Yes (pay-per-token for premium models) | One key, access to many models — useful for multi-LLM routing setups. |
| **Anthropic API (Claude)** | No free tier (pay-per-token) | Yes | Higher cost but strong reasoning quality; use when quality matters more than cost. |
| **Groq (fast inference)** | Yes (generous free tier) | Yes | Extremely fast inference speed, good for latency-sensitive features. |

## 11. Offline/Local AI

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **Ollama** | Free (open-source, local compute only) | — | Run LLMs locally without internet or API cost. |
| **LM Studio** | Free | — | GUI-based alternative to Ollama, easier for non-CLI use. |

## 12. General AI Chat *(broad use, no fixed task)*

| Platform | Free Tier | Paid | Notes |
| :--- | :--- | :--- | :--- |
| **DeepSeek** | Yes (generous) | Yes (cheap API) | General purpose, including coding. |
| **Grok** | Limited | Yes | General purpose + real-time info access. |
| **Perplexity** | Yes (limited) | Yes (Pro) | Strong when the task leans toward research/search-grounded answers. |

---

## How to Use This Document

For any project, go category by category and select the platform that fits that project's **budget stage** and **scale**:

* **Zero/near-zero budget, early-stage or personal project** → lean on the free tiers marked above (Firebase Spark, Vercel Hobby, EmailJS free, Cloudinary free tier, Gemini API free tier, Ollama for any AI feature that can run locally).
* **Client project with a real budget** → select based on the specific requirement (region, existing client tools, scale expectations) rather than defaulting to one fixed choice.
* **Project needing to scale significantly** → reassess free-tier-dependent choices (e.g., Firebase Spark → Blaze, Render free web service → paid to avoid idle-sleep) before launch, not after hitting limits in production.

**Applying this in Industry Systems files:** when an Industry Systems document (`02_Industry_Systems/*.md`) references payment integration, media storage, deployment, or similar functional needs, use this table to select the specific tool for that project's context — the Industry Systems files describe the *pattern* (e.g., "webhook-driven payment state"), and this document supplies the *menu of concrete tools* that can implement it.

---

# Revision History

| Version | Date | Author | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-07-31 | Doc Architect | Initial conversion from source .docx — single fixed personal stack. |
| 2.0.0 | 2026-07-31 | Doc Architect | Expanded every category into a free/paid multi-option menu. |
| 3.0.0 | 2026-07-31 | Doc Architect | Removed personal preference markers — document is now a fully neutral reference menu, with selection driven entirely by project context rather than a default pick. |
| 3.1.0 | 2026-07-31 | Doc Architect | Translated remaining Hinglish text to English for full consistency with the rest of the document set. |
