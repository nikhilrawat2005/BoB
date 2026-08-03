# SEO Engineering

## Purpose

This document defines the engineering approach to Search Engine Optimization within AI-WEOS. It establishes systematic rules, architectural decisions, and implementation patterns that enable search engines to efficiently discover, crawl, index, and rank website content. This is an engineering discipline, not a marketing activity.

## Scope

This document covers:

- Technical SEO architecture and implementation
- Crawl efficiency and indexation control
- Structured data engineering
- Performance as a ranking signal
- URL architecture and information hierarchy
- Machine-readable semantic markup
- Rendering strategies for search engine bots
- Internationalization and multi-region SEO engineering

This document does not cover:

- Keyword research or content strategy (belongs to Content Strategy Engineering)
- User behavior analytics implementation (belongs to Analytics Engineering)
- Backend API design (belongs to Backend Engineering)
- Conversion rate optimization (belongs to separate CRO document)
- Social media metadata beyond Open Graph basics

## Core Principles

**Crawl Budget Is Finite**
Every unnecessary URL consumed by a bot reduces the crawl allocation for valuable pages. Engineering must treat crawl budget as a constrained resource.

**Bots Are the Most Important API Consumers**
Search engine crawlers are automated API clients with specific constraints. The site must serve them deterministic, complete content without requiring JavaScript execution unless explicitly designed for it.

**Indexing Is a Privilege, Not a Right**
Pages must earn indexation through clear signals of value, uniqueness, and canonical identity. Do not rely on search engines to figure out what matters.

**Structured Data Is Machine Contract**
Schema markup constitutes a formal contract between the website and search engines. Breaking this contract through invalid or misleading markup damages trust signals.

**Performance Is a Direct Ranking Factor**
Core Web Vitals are engineering metrics. They are not optional optimizations. They are part of the ranking algorithm.

## Engineering Philosophy

SEO engineering is about control. The engineering team controls what search engines see, how they interpret content, and which pages enter the index. This control is exercised through deterministic outputs, not probabilistic guesswork.

Treat every page as an API response being consumed by a machine client that has specific parsing rules, limited processing capacity, and a scoring algorithm that rewards clarity and penalizes ambiguity.

The bot is not a user. The bot does not scroll, click, fill forms, or execute complex JavaScript unless explicitly engineered to do so. Design the rendering path for bots as a first-class architectural concern.

## Decision Framework

When making SEO engineering decisions, evaluate against this priority chain:

1. **Crawlability** — Can the bot reach the URL?
2. **Renderability** — Can the bot extract content from the response?
3. **Indexability** — Should the page enter the index?
4. **Rankability** — Does the page have the signals to compete?
5. **Measurability** — Can we observe and validate the outcome?

Each decision must pass through these gates in sequence. A page that fails crawlability cannot be ranked. A page that fails indexability should not exist.

### Decision Tree

```
Is the page unique and valuable?
├── No → Noindex, block from crawling after first pass
└── Yes
    ├── Is it the canonical version?
    │   ├── No → Canonical tag to primary version
    │   └── Yes → Continue
    ├── Should bots render it as HTML?
    │   ├── No → Implement SSR or prerendering
    │   └── Yes → Continue
    ├── Does it target a specific region/language?
    │   ├── Yes → Implement hreflang
    │   └── No → Continue
    └── Implement full technical SEO stack
```

## Standards

### URL Architecture

URLs must follow a strict hierarchy that mirrors information architecture:

```
/product-category/
/product-category/product-name/
/product-category/product-name/variant-id/
```

Rules:
- Use hyphens as word separators, never underscores
- All lowercase
- No file extensions (.html, .php, .aspx)
- No trailing slashes on leaf resources (enforce via 301 redirect)
- No query parameters for content differentiation (use path segments)
- Maximum URL depth of 5 segments from root
- Static, predictable, human-readable

**Redirect Mapping Standard:**

| Code | Meaning | Link Equity |
|---|---|---|
| 301 | Permanent move | Passes full link equity |
| 302 | Temporary move | Does not pass link equity |
| 308 | Permanent move preserving HTTP method | Passes |
| 307 | Temporary move preserving HTTP method | Does not pass |

Never use meta refresh for redirects. Never use JavaScript redirects as the primary mechanism.

### Canonicalization

Every indexable page must declare exactly one canonical URL. The canonical URL is the authoritative source for that content's ranking signals.

Rules for canonical selection:
- Primary product page canonicalizes to itself
- Filtered/faceted views canonicalize to the unfiltered parent
- Paginated pages canonicalize to the "view all" page or page 1
- Parameter-sorted pages canonicalize to the default sort
- Mobile-specific URLs canonicalize to the responsive version
- AMP pages canonicalize to the standard HTML version

**Self-referencing canonical is required**, even when the page is the canonical version.

### Structured Data

Implement JSON-LD exclusively. Do not use Microdata or RDFa for new implementations.

Required schemas by page type:

**Article/Blog Post:**
- `Article` or `BlogPosting`
- `headline`, `author` (as Person), `datePublished`, `dateModified`
- `publisher` as Organization
- `mainEntityOfPage`

**Product Page:**
- `Product` with `offers` as `Offer`
- `price`, `priceCurrency`, `availability`
- `sku`, `brand` as Organization
- `aggregateRating` if reviews exist

**Organization Homepage:**
- `Organization` on root URL only
- `name`, `url`, `logo`, `sameAs` for social profiles

**BreadcrumbList:**
- Required on every page below the homepage
- Each item must link to the actual URL of that level
- Final item in the list is the current page (no link or self-link)

**FAQ (if applicable):**
- `FAQPage` with `Question` and `Answer` entities
- Only for content genuinely formatted as question-and-answer

Validation requirement: All structured data must pass the Rich Results Test without errors. Warnings are acceptable only when documented and intentional.

### Meta Tags Engineering

**Title Tag:**
- Unique per page (enforced by build-time validation)
- Primary keyword near the beginning
- Brand name at the end, separated by pipe ( | )
- 50-60 characters (truncation-safe)
- No all-caps, no keyword stuffing

**Meta Description:**
- Unique per page
- 150-160 characters
- Compelling call to action or value proposition
- Not auto-generated from first paragraph

**Robots Meta Tag:**
- Default: `index, follow` (do not specify this, it is the default)
- Override explicitly where needed: `noindex`, `nofollow`, `noarchive`, `nosnippet`
- Combine with X-Robots-Tag HTTP header for non-HTML resources (PDFs, images)

**Open Graph:**
- `og:title` (mirrors title tag unless deliberately different for social)
- `og:description` (mirrors meta description)
- `og:image` (1200x630px, under 5MB, absolute URL)
- `og:url` (canonical URL)
- `og:type` (website, article, product)
- `og:site_name`

**Twitter Cards:**
- `twitter:card` (summary_large_image for articles, summary for others)
- `twitter:image` (same as og:image or optimized 2:1 ratio)

### XML Sitemap Engineering

Sitemaps are instructions, not guarantees. Structure them as logical groups:

```
/sitemap-index.xml
  ├── /sitemap-pages.xml       (static pages, high priority)
  ├── /sitemap-products.xml    (product pages, medium priority)
  ├── /sitemap-articles.xml    (blog/articles, medium priority)
  ├── /sitemap-categories.xml  (category/taxonomy pages)
  └── /sitemap-images.xml      (image sitemap, if significant image search traffic)
```

Rules:
- Maximum 50,000 URLs per sitemap file
- Maximum 50MB uncompressed per sitemap file
- Only include 200-status, canonical, indexable URLs
- `<lastmod>` must reflect actual content changes, not build dates
- `<changefreq>` is advisory only, use sparingly
- `<priority>` is relative within the same sitemap only (0.0 to 1.0)
- Sitemap must be referenced in robots.txt
- Sitemap must be submitted via Search Console for new properties

### Robots.txt Engineering

Robots.txt controls crawl allocation, not indexation. A `Disallow` rule does not prevent indexing if the URL is linked from elsewhere.

Structure:
```
User-agent: *
Allow: /$
Allow: /products/
Allow: /articles/
Disallow: /api/
Disallow: /search
Disallow: /*?
Disallow: /cart
Disallow: /checkout
Disallow: /account/

User-agent: Googlebot
Allow: /$

Sitemap: https://example.com/sitemap-index.xml
```

Rules:
- Block all parameter-based URLs with `/*?` unless they serve unique content
- Block infinite spaces (calendar, search results, filtered faceted navigation)
- Block internal tools, staging environments, auth-required pages
- Never block CSS or JavaScript files required for rendering
- Reference the sitemap index at the end of the file
- Test with robots.txt Tester before deployment

### Hreflang Engineering

For multi-language or multi-region sites, implement hreflang as a precise mapping:

```html
<link rel="alternate" hreflang="en-us" href="https://example.com/us/product" />
<link rel="alternate" hreflang="en-gb" href="https://example.com/gb/product" />
<link rel="alternate" hreflang="de-de" href="https://example.com/de/produkt" />
<link rel="alternate" hreflang="x-default" href="https://example.com/product" />
```

Rules:
- Language codes only: ISO 639-1
- Region codes only: ISO 3166-1 Alpha 2
- Every page in a cluster must reference every other page (bidirectional)
- `x-default` required for the fallback page
- Self-referencing hreflang required
- Implement in HTML `<head>`, XML sitemap, or HTTP header (one method only, never mix)
- Validate with hreflang testing tools before launch

## Best Practices

**Server-Side Rendering for Bot Requests**
Detect bot user agents and serve fully rendered HTML. This eliminates JavaScript dependency for critical content. Use dynamic rendering only when full SSR is architecturally impossible.

**Log File Analysis**
Server access logs are the source of truth for bot behavior. Monitor:
- Crawl frequency per bot
- Most-crawled URLs
- URLs returning non-200 status
- Crawl budget waste (bot hits on 404s, redirects, blocked resources)
- Time between content publication and first crawl

**Infinite Scroll Handling**
Replace infinite scroll with paginated `<a href>` links when JavaScript is disabled. Use `<link rel="next">` and `<link rel="prev">` for paginated series. Each page in the series must be independently accessible via its own URL.

**Faceted Navigation Control**
Use `<link rel="canonical">` to point faceted URLs to the canonical category page. Implement `noindex` on non-canonical facet combinations. Use `nofollow` on facet links to prevent crawl budget drain. Consider URL parameter handling in Search Console.

**JavaScript SEO**
When JavaScript is required for rendering:
- Implement server-side rendering or static generation
- Ensure critical content is in the initial HTML payload
- Use `history.pushState` for client-side routing (with proper `<a href>` fallbacks)
- Avoid `#` in URLs unless implementing hash-based routing with proper fallbacks
- Lazy-loaded content must have `<noscript>` alternatives

**Image SEO**
- Descriptive filenames (not IMG_0047.jpg)
- Alt text on every `<img>` that conveys information
- Empty `alt=""` for decorative images only
- Responsive images via `srcset` and `sizes`
- Image sitemap for significant image libraries
- WebP with JPEG/PNG fallback via `<picture>` element

**Status Code Engineering**

| Code | Use case |
|---|---|
| 200 | Only for indexable, canonical content |
| 301 | Permanent redirects, pass link equity |
| 302 | Temporary redirects, do not pass link equity |
| 404 | Content genuinely not found, serve helpful page |
| 410 | Content deliberately removed (stronger signal than 404) |
| 503 | Temporary server issue, include `Retry-After` header |

## Workflow

### New Content Publication Checklist

1. Define canonical URL and validate no duplication exists
2. Implement structured data relevant to content type
3. Write unique title tag (validate length)
4. Write unique meta description (validate length)
5. Add to appropriate XML sitemap
6. Set `<lastmod>` to actual publication timestamp
7. Ensure internal linking from at least one existing page
8. Validate structured data with Rich Results Test
9. Validate hreflang if applicable
10. Test rendering with mobile-friendly test tool
11. Verify status code is 200
12. Verify no noindex or canonical pointing elsewhere

### Content Deprecation Checklist

1. Decide: Content removed entirely or moved?
2. If moved: Implement 301 redirect to closest equivalent
3. If removed with no equivalent: Return 410 Gone
4. Remove from XML sitemap
5. Remove or update all internal links pointing to the URL
6. Verify external backlinks (consider outreach for high-value links)
7. Monitor server logs for continued bot access
8. After 90 days of zero traffic: archive the redirect/410 rule

### Site Migration Workflow

1. Crawl entire existing site, map all URLs
2. Design new URL architecture
3. Create 1:1 redirect map (every old URL maps to exactly one new URL)
4. Implement redirects at server level (not application level if possible)
5. Test every redirect for correct destination and 301 status
6. Update XML sitemaps with new URLs
7. Update internal links to point to new URLs directly (no redirect chains)
8. Update canonical tags to new URLs
9. Change of address in Search Console
10. Monitor crawl stats for 90 days
11. Do not remove old redirects for minimum 1 year

## Common Mistakes

**Blocking CSS and JavaScript in robots.txt**
Search engines render pages. Blocking assets prevents proper rendering analysis and can trigger manual actions for cloaking. Never block .css or .js files required for layout or content delivery.

**Noindex on Paginated Pages**
Paginated pages in a series should be indexable unless they are thin duplicates. Use `rel="prev"` and `rel="next"` to consolidate signals. A `noindex` on page 2 of a series breaks the pagination signal chain.

**Relying on JavaScript for Canonical Tags**
Canonical tags injected via JavaScript are unreliable. Search engines may or may not execute JavaScript when determining canonicals. Canonical tags must be in the initial HTML `<head>`.

**Auto-Generating Title Tags from H1**
The title tag and H1 serve different purposes. The title tag is a ranking signal visible in SERPs. The H1 is an on-page heading. They should be related but need not be identical. Blind duplication wastes the opportunity for differentiation.

**Using 302s for Permanent Moves**
A 302 redirect signals temporariness. Link equity does not transfer. If the move is permanent, use 301. After 6+ months of a 302, search engines may treat it as a 301, but do not rely on this behavior.

**Publishing Development/Staging to Index**
Staging sites must be noindexed at the server level and password-protected. A single indexed staging URL can create duplicate content issues that persist for months.

**Forgetting Protocol Consistency**
If the site is HTTPS, all canonical tags, hreflang tags, sitemap URLs, and internal links must use HTTPS. Mixed protocol signals create canonical confusion.

**Hreflang Implemented in Only One Direction**
Page A references Page B, but Page B does not reference Page A. Search engines may ignore the entire cluster. Hreflang must always be bidirectional.

## Quality Checklist

Before any production deployment affecting SEO, verify:

- [ ] All pages return appropriate status codes (200, 301, 404, 410)
- [ ] Zero soft 404s (pages returning 200 but containing "not found" content)
- [ ] All canonical tags self-reference correctly
- [ ] Structured data validates without errors
- [ ] Title tags are unique across the site
- [ ] Meta descriptions are unique across the site
- [ ] robots.txt is accessible and correctly configured
- [ ] XML sitemaps are accessible and contain only indexable URLs
- [ ] Hreflang clusters are complete and bidirectional
- [ ] Noindex directives are intentional and documented
- [ ] Redirect chains do not exist (no redirect to another redirect)
- [ ] Redirect loops do not exist (A → B → A)
- [ ] Mobile usability passes without errors
- [ ] Core Web Vitals pass thresholds (LCP < 2.5s, FID < 100ms, CLS < 0.1)
- [ ] HTTPS is enforced site-wide with HSTS
- [ ] Crawl budget allocation matches content priorities
- [ ] Staging environments are blocked from indexing
- [ ] Internal search result pages are noindexed
- [ ] Faceted/filtered navigation uses canonical tags correctly
- [ ] Orphan pages are identified and linked or removed

## AI Decision Rules

When an AI agent is generating or modifying pages within AI-WEOS, the following rules must be applied automatically:

**Rule 1: Title Tag Generation**
- IF page type is Article THEN title format = `{Headline} | {Site Name}`
- IF page type is Product THEN title format = `{Product Name} - {Category} | {Site Name}`
- IF page type is Category THEN title format = `{Category Name} - Browse Online | {Site Name}`
- Enforce length: 50-60 characters. Truncate intelligently at word boundaries if needed.

**Rule 2: Canonical URL Assignment**
- IF page is the primary version THEN canonical = self URL (no parameters, no trailing slash)
- IF page is a filtered/faceted view THEN canonical = parent unfiltered URL
- IF page is paginated THEN canonical = view-all page URL OR page 1 URL if view-all does not exist

**Rule 3: Indexability Decision**
- IF page content is < 300 words AND is not a product page THEN apply noindex
- IF page is a duplicate of another page (semantic similarity > 90%) THEN apply canonical to primary
- IF page is in a staging environment THEN apply noindex via robots meta AND X-Robots-Tag
- IF page requires authentication THEN apply noindex
- IF page is a thank-you/confirmation page THEN apply noindex

**Rule 4: Structured Data Selection**
- IF page type is Product THEN include Product schema with Offer
- IF page type is Article THEN include Article schema
- IF page is homepage THEN include Organization schema (once only)
- IF page depth is > 0 THEN include BreadcrumbList schema

**Rule 5: Image Alt Text**
- IF image conveys information THEN generate descriptive alt text (5-15 words)
- IF image is decorative THEN set `alt=""`
- IF image contains text THEN alt text must include that text verbatim
- IF image is a product THEN alt text = `{Product Name} - {Key Distinguishing Feature}`

**Rule 6: Internal Linking**
- WHEN creating a new page THEN link to it from at least one existing indexable page
- WHEN linking internally THEN use descriptive anchor text (not "click here" or "read more")
- WHEN linking to a product from an article THEN use natural anchor text containing the product name

**Rule 7: Redirect Handling**
- WHEN a page is permanently moved THEN implement 301 redirect from old URL to new URL
- WHEN a page is temporarily unavailable THEN implement 302 redirect
- WHEN content is deleted with no replacement THEN return 410 Gone (not 404)
- WHEN a redirect is implemented THEN update all internal links to point to the destination directly

**Rule 8: Sitemap Inclusion**
- INCLUDE page in sitemap IF status = 200 AND indexable = true AND canonical = self
- EXCLUDE page from sitemap IF noindex present OR status != 200 OR canonical != self
- SET lastmod = actual content modification timestamp (not build timestamp)
- SET priority = 1.0 for homepage, 0.8 for category pages, 0.6 for products, 0.4 for articles

**Rule 9: URL Slug Generation**
- GIVEN a title or product name
- THEN generate slug = lowercase, hyphenated, stop words removed, max 5 words
- THEN validate uniqueness against existing slugs
- THEN if duplicate append distinguishing suffix (e.g., product slug with SKU)

**Rule 10: Hreflang Cluster Management**
- WHEN adding a new language/region variant
- THEN add hreflang tag to the new page referencing all existing variants
- THEN update all existing variant pages to include the new variant
- THEN validate bidirectional completeness before publishing

## Examples

### Correct Product Page Head

```html
<head>
  <title>Ergonomic Mesh Office Chair - Home Office | ExampleStore</title>
  <meta name="description" content="Adjustable ergonomic mesh office chair with lumbar support. Breathable design for all-day comfort. Free shipping on orders over $200.">
  <link rel="canonical" href="https://www.examplestore.com/office-chairs/ergonomic-mesh-chair">
  <meta name="robots" content="index, follow">

  <!-- Open Graph -->
  <meta property="og:title" content="Ergonomic Mesh Office Chair | ExampleStore">
  <meta property="og:description" content="Adjustable ergonomic mesh office chair with lumbar support.">
  <meta property="og:image" content="https://www.examplestore.com/images/og/ergonomic-chair.jpg">
  <meta property="og:url" content="https://www.examplestore.com/office-chairs/ergonomic-mesh-chair">
  <meta property="og:type" content="product">

  <!-- Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Ergonomic Mesh Office Chair",
    "sku": "EMC-4500",
    "brand": { "@type": "Brand", "name": "ExampleStore" },
    "offers": {
      "@type": "Offer",
      "price": "349.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock",
      "url": "https://www.examplestore.com/office-chairs/ergonomic-mesh-chair"
    }
  }
  </script>

  <!-- Hreflang -->
  <link rel="alternate" hreflang="en-us" href="https://www.examplestore.com/office-chairs/ergonomic-mesh-chair">
  <link rel="alternate" hreflang="en-gb" href="https://www.examplestore.co.uk/office-chairs/ergonomic-mesh-chair">
  <link rel="alternate" hreflang="x-default" href="https://www.examplestore.com/office-chairs/ergonomic-mesh-chair">
</head>
```

### Correct Pagination Implementation

```html
<!-- Page 2 of a paginated category -->
<head>
  <title>Office Chairs - Page 2 | ExampleStore</title>
  <link rel="canonical" href="https://www.examplestore.com/office-chairs?page=2">
  <link rel="prev" href="https://www.examplestore.com/office-chairs">
  <link rel="next" href="https://www.examplestore.com/office-chairs?page=3">
</head>
```

### Correct Robots.txt for E-Commerce

```
User-agent: *
Disallow: /cart
Disallow: /checkout
Disallow: /account
Disallow: /search
Disallow: /wishlist
Disallow: /*?
Disallow: /*sort=
Disallow: /*filter=
Allow: /$

Sitemap: https://www.examplestore.com/sitemap-index.xml
```

### Correct Redirect Chain Resolution

```
Before (bad):
/products/old-chair → 301 → /furniture/old-chair → 301 → /furniture/chairs/ergonomic-chair

After (correct):
/products/old-chair → 301 → /furniture/chairs/ergonomic-chair
/furniture/old-chair → 301 → /furniture/chairs/ergonomic-chair
```

## Summary

SEO engineering is the systematic application of technical controls that govern how search engines interact with a website. It operates at the intersection of web architecture, data structuring, and machine communication protocols.

The core engineering responsibility is ensuring that every page's intent is communicated unambiguously to automated crawlers through canonical signals, structured data, status codes, and rendering behavior. Ambiguity is the enemy of ranking.

Implementation must be validated continuously, not sporadically. Structured data breaks silently. Canonicals drift during content updates. Redirect chains accumulate over time. Treat SEO infrastructure as a production system that requires monitoring, alerting, and regression testing equivalent to any other critical system.

The AI decision rules in this document encode the deterministic logic for maintaining SEO integrity at scale. When followed consistently, they eliminate the most common classes of technical SEO failures.
