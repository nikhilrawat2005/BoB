const cheerio = require('cheerio');
const { db } = require('../config/firebase');
const memory = require('./memoryService');
const { callLLM } = require('./llmService');
const { validatePublicUrl, fetchWithTimeout } = require('./crawlerService');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function coll(userId) {
  return db.collection('users').doc(userId).collection('seoSites');
}

function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw new Error('URL is required.');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Invalid URL provided.');
  }
  return u;
}

async function fetchText(url, timeoutMs = 10000) {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/xml,application/xml,*/*' },
  }, timeoutMs);
  return res;
}



function calculateMaxDepth($root) {
  let maxDepth = 0;
  function traverse(node, currentDepth) {
    if (currentDepth > maxDepth) maxDepth = currentDepth;
    if (node && node.children && node.children.length) {
      for (const child of node.children) {
        if (child.type === 'tag') traverse(child, currentDepth + 1);
      }
    }
  }
  if ($root && $root[0]) traverse($root[0], 1);
  return maxDepth;
}

// Fetch a page and return SEO-relevant fields only (no raw HTML blob stored / sent to LLM).
function parsePage(html, origin, rawHeaders = {}) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase();
  const viewportRaw = $('meta[name="viewport"]').attr('content') || '';
  const viewport = !!viewportRaw;
  const viewportBlocksZoom = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?/i.test(viewportRaw);
  const themeColor = $('meta[name="theme-color"]').attr('content') || '';
  const lang = ($('html').attr('lang') || '').slice(0, 5);
  const hasFavicon = !!$('link[rel~="icon"]').attr('href');
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;

  // ── Heading hierarchy AST analysis ──
  const headingFlow = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const lvl = parseInt(el.tagName.replace(/^h/i, ''), 10);
    if (!isNaN(lvl)) headingFlow.push(lvl);
  });
  let headingSkipped = false;
  for (let i = 1; i < headingFlow.length; i++) {
    if (headingFlow[i] - headingFlow[i - 1] > 1) {
      headingSkipped = true;
      break;
    }
  }

  // ── DOM Complexity tree calculation ──
  const totalDomNodes = $('*').length;
  const maxDomDepth = calculateMaxDepth($.root());
  const domBloated = totalDomNodes > 1500 || maxDomDepth > 32;

  // ── Security & HTTP response headers ──
  const hsts = Boolean(rawHeaders['strict-transport-security']);
  const csp = Boolean(rawHeaders['content-security-policy']);
  const xFrame = rawHeaders['x-frame-options'] || '';
  const xContentType = rawHeaders['x-content-type-options'] || '';
  const referrerPolicy = rawHeaders['referrer-policy'] || '';

  const images = $('img').map((_, el) => $(el)).get();
  const altCovered = images.filter((im) => (im.attr('alt') || '').trim()).length;
  const lazyCount = $('img[loading="lazy"]').length;
  const ogTitle = !!$('meta[property="og:title"]').attr('content');
  const ogImage = !!$('meta[property="og:image"]').attr('content');
  const hasSchema = html.includes('application/ld+json');
  const twitterCard = !!$('meta[name="twitter:card"]').attr('content');
  const hreflangLinks = $('link[rel="alternate"][hreflang]').get().map((el) => $(el).attr('hreflang'));
  const schemaTypes = (() => {
    const types = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).html() || '';
      const m = raw.match(/"@type"\s*:\s*"([^"]+)"/);
      if (m && !types.includes(m[1])) types.push(m[1]);
    });
    return types.slice(0, 4);
  })();

  // ── Clean HTML structure signals ──
  const semanticTags = ['header', 'nav', 'main', 'article', 'section', 'aside', 'footer']
    .filter((t) => $(t).length > 0);
  const deprecatedTags = ['marquee', 'center', 'font', 'blink', 'applet', 'big', 'basefont', 'dir', 'frame', 'frameset', 'noframes', 'strike', 'tt']
    .filter((t) => $(t).length > 0);
  const inlineStyleCount = $('[style]').length;
  const duplicateIds = (() => {
    const seen = {};
    const dups = [];
    $('[id]').each((_, el) => {
      const v = $(el).attr('id');
      if (!v) return;
      if (seen[v]) dups.push(v);
      seen[v] = 1;
    });
    return [...new Set(dups)];
  })();

  // ── Speed / resource signals ──
  const scriptTags = $('script').get();
  const scriptSrcCount = scriptTags.filter((el) => $(el).attr('src')).length;
  const blockingScriptEls = scriptTags.filter((el) => {
    const e = $(el);
    if (!e.attr('src')) return false;
    return !(e.attr('async') !== undefined || e.attr('defer') !== undefined);
  });
  const blockingScripts = blockingScriptEls.length;
  const blockingScriptSrcs = blockingScriptEls.map((el) => $(el).attr('src')).filter(Boolean).slice(0, 6);
  const cssLinkCount = $('link[rel="stylesheet"]').length;

  // Mixed content
  const mixedContent = [];
  const srcRe = /(?:src|href)="(http:\/\/[^"]+)"/g;
  let match;
  while ((match = srcRe.exec(html))) mixedContent.push(match[1]);

  $('script, style, noscript, svg').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const words = bodyText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, bodyText.split(/[.!?]+/).filter(s => s.trim().length > 3).length);
  const avgWordsPerSentence = Math.round(wordCount / sentenceCount);
  const readability = avgWordsPerSentence <= 18 ? 'Good' : avgWordsPerSentence <= 25 ? 'Moderate' : 'Complex';

  const internalLinks = [];
  const externalLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(href)) return;
    try {
      const abs = new URL(href, origin).href;
      if (new URL(abs).hostname === new URL(origin).hostname) internalLinks.push(abs);
      else externalLinks.push(abs);
    } catch { /* skip malformed */ }
  });
  const uniqueInternal = [...new Set(internalLinks)].filter((u) => {
    const p = new URL(u).pathname;
    return p !== '/' && !/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|pdf|zip|mp4|webm)$/i.test(u);
  });

  return {
    title,
    metaDescription,
    canonical: canonical || '',
    noindex: robotsMeta.includes('noindex'),
    viewport,
    viewportBlocksZoom,
    themeColor,
    lang,
    hasFavicon,
    h1Count: h1s.length,
    h1Texts: h1s.slice(0, 3),
    h2Count,
    h3Count,
    headingSkipped,
    totalDomNodes,
    maxDomDepth,
    domBloated,
    hsts,
    csp,
    xFrame,
    xContentType,
    referrerPolicy,
    imageCount: images.length,
    altCovered,
    altCoverage: images.length ? Math.round((altCovered / images.length) * 100) : 100,
    lazyCount,
    ogTitle,
    ogImage,
    hasSchema,
    twitterCard,
    hreflangCount: hreflangLinks.length,
    schemaTypes,
    semanticTags,
    semanticCount: semanticTags.length,
    deprecatedTags,
    inlineStyleCount,
    duplicateIds,
    scriptSrcCount,
    blockingScripts,
    blockingScriptSrcs,
    cssLinkCount,
    mixedContent: [...new Set(mixedContent)],
    wordCount,
    sentenceCount,
    avgWordsPerSentence,
    readability,
    internalCount: uniqueInternal.length,
    externalCount: externalLinks.length,
    internalLinks: uniqueInternal.slice(0, 40),
  };
}

async function fetchRobotsAndSitemap(origin) {
  const result = { robotsExists: false, robotsContent: '', rulesPresent: false, sitemapFound: false, sitemapUrls: [], lastmodCount: 0, isSitemapIndex: false };
  let sitemapTargetUrls = [];

  try {
    const robots = await fetchText(new URL('/robots.txt', origin).href, 8000);
    result.robotsExists = robots.ok;
    if (result.robotsExists && robots.text) {
      result.robotsContent = robots.text.slice(0, 4000);
      result.rulesPresent = /user-agent/i.test(robots.text);
      const matches = [...robots.text.matchAll(/^sitemap:\s*(\S+)$/gim)];
      if (matches.length) {
        result.sitemapFound = true;
        sitemapTargetUrls = matches.map(m => m[1].trim());
      }
    }
  } catch { result.robotsExists = false; }

  if (!sitemapTargetUrls.length) {
    sitemapTargetUrls = [
      new URL('/sitemap.xml', origin).href,
      new URL('/sitemap_index.xml', origin).href,
    ];
  }

  for (const smUrl of sitemapTargetUrls) {
    try {
      const sm = await fetchText(smUrl, 9000);
      if (sm.ok && sm.text) {
        result.sitemapFound = true;
        const locs = [...sm.text.matchAll(/<loc>(.*?)<\/loc>/gi)].map((m) => m[1].trim());
        if (locs.length) {
          result.sitemapUrls = [...new Set([...result.sitemapUrls, ...locs])];
        }
        const lastmods = (sm.text.match(/<lastmod>/gi) || []).length;
        if (lastmods > result.lastmodCount) result.lastmodCount = lastmods;
        if (/<sitemap>/i.test(sm.text)) result.isSitemapIndex = true;
      }
    } catch { /* continue */ }
  }

  return result;
}

async function checkBrokenLinks(urls, max = 6) {
  const broken = [];
  const list = [...new Set(urls)].slice(0, max);
  const results = await Promise.allSettled(list.map(async (u) => {
    try {
      const res = await fetchWithTimeout(u, {
        method: 'HEAD',
        headers: { 'User-Agent': UA },
      }, 6000);
      let ok = res.ok;
      let status = res.status;
      if (!ok && (status === 405 || status === 403 || status === 501)) {
        const get = await fetchWithTimeout(u, { headers: { 'User-Agent': UA } }, 6000);
        ok = get.ok;
        status = get.status;
      }
      return { url: u, ok, status };
    } catch {
      return { url: u, ok: false, status: 0 };
    }
  }));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && !r.value.ok) broken.push(r.value);
    else if (r.status === 'rejected') broken.push({ url: r.reason?.url || list[i] || 'unknown', ok: false, status: 0 });
  }
  return broken;
}

// ── Deterministic scoring (no LLM cost) ───────────────

// ── Level 3: Google PageSpeed & Core Web Vitals Free REST Connector ────────
async function fetchGooglePageSpeed(targetUrl, timeoutMs = 8000) {
  try {
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=mobile&category=performance`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timer);

    if (!res || !res.ok) return null;
    const data = await res.json();
    const lh = data.lighthouseResult || {};
    const cats = lh.categories || {};
    const audits = lh.audits || {};

    const perfScore = typeof cats.performance?.score === 'number' ? Math.round(cats.performance.score * 100) : null;
    const lcp = audits['largest-contentful-paint']?.displayValue || null;
    const fcp = audits['first-contentful-paint']?.displayValue || null;
    const cls = audits['cumulative-layout-shift']?.displayValue || null;
    const tbt = audits['total-blocking-time']?.displayValue || null;
    const speedIndex = audits['speed-index']?.displayValue || null;

    return {
      perfScore,
      lcp,
      fcp,
      cls,
      tbt,
      speedIndex,
      fetched: true,
      strategy: 'mobile'
    };
  } catch (err) {
    return null;
  }
}

function scoreAudit(home, robots, broken) {
  const issues = [];

  // Technical (100) — Stage 1: clean HTML + speed proxy + mobile basics + security + DOM complexity
  let tech = 0;
  if (home.https) tech += 8; else issues.push({ severity: 'high', category: 'technical', text: 'Website HTTP pe hai — HTTPS pe shift karo (security + ranking).' });
  if (home.status === 200) tech += 8; else issues.push({ severity: 'high', category: 'technical', text: `Homepage HTTP ${home.status} return kar raha hai.` });
  if (robots.robotsExists) tech += 8; else issues.push({ severity: 'medium', category: 'technical', text: 'robots.txt nahi mila.' });
  if (robots.sitemapFound) tech += 8; else issues.push({ severity: 'medium', category: 'technical', text: 'sitemap.xml nahi mila ya robots.txt mein declare nahi.' });
  if (home.canonical) tech += 8; else issues.push({ severity: 'medium', category: 'technical', text: 'Canonical tag missing — duplicate content risk.' });
  if (!home.noindex) tech += 8; else issues.push({ severity: 'high', category: 'technical', text: 'Page noindex flag hai — search me nahi aayega.' });
  if (home.viewport && !home.viewportBlocksZoom) tech += 6;
  else if (home.viewport) tech += 3;
  else issues.push({ severity: 'medium', category: 'technical', text: 'viewport meta missing — mobile SEO hurt.' });

  // Security Headers (Deterministic 0-token)
  if (home.hsts) tech += 4;
  else if (home.https) issues.push({ severity: 'low', category: 'technical', text: 'HSTS (Strict-Transport-Security) header missing — SSL security best practice.' });
  if (home.csp || home.xFrame) tech += 4;
  else issues.push({ severity: 'low', category: 'technical', text: 'Clickjacking / Content-Security headers configure karein (X-Frame-Options / CSP).' });

  // Clean HTML & DOM Complexity
  if (home.semanticCount >= 4) tech += 8;
  else if (home.semanticCount >= 2) tech += 4;
  else tech += 0;
  if (home.semanticCount < 4) issues.push({ severity: 'medium', category: 'technical', text: `Weak semantic structure — sirf ${home.semanticCount}/7 layout tags (header/nav/main/article/section/footer).` });
  if (!home.deprecatedTags || home.deprecatedTags.length === 0) tech += 4;
  else { tech += 2; issues.push({ severity: 'low', category: 'technical', text: `Deprecated HTML tags mile: ${home.deprecatedTags.join(', ')}.` }); }
  if (home.inlineStyleCount < 10) tech += 4;
  else { tech += 2; if (home.inlineStyleCount > 20) issues.push({ severity: 'low', category: 'technical', text: `${home.inlineStyleCount} inline style attributes — CSS ko external/<style> me nikalo.` }); }
  if (home.duplicateIds && home.duplicateIds.length) {
    tech += 2; issues.push({ severity: 'low', category: 'technical', text: `Duplicate element IDs: ${home.duplicateIds.slice(0, 4).join(', ')}…` });
  } else tech += 4;

  if (home.domBloated) {
    issues.push({ severity: 'medium', category: 'technical', text: `Excessive DOM complexity — ${home.totalDomNodes || 0} nodes / depth ${home.maxDomDepth || 0} (target <1500 nodes & <32 depth).` });
  }

  // Speed proxy metrics
  if (home.ttfb < 600) tech += 6;
  else if (home.ttfb < 1500) tech += 4;
  else if (home.ttfb < 3000) tech += 2;
  else tech += 0;
  if (home.ttfb >= 1500) issues.push({ severity: 'medium', category: 'technical', text: `Slow server response — TTFB ${home.ttfb}ms (target < 600ms).` });
  if (home.htmlBytes < 200 * 1024) tech += 6;
  else if (home.htmlBytes < 500 * 1024) tech += 3;
  else tech += 0;
  if (home.htmlBytes >= 500 * 1024) issues.push({ severity: 'medium', category: 'technical', text: `Heavy HTML — ${(home.htmlBytes / 1024).toFixed(0)}KB raw page (target < 200KB).` });
  if (home.blockingScripts === 0) tech += 6;
  else if (home.blockingScripts <= 3) tech += 3;
  else if (home.blockingScripts <= 8) tech += 1;
  else tech += 0;
  if (home.blockingScripts > 3) issues.push({ severity: 'medium', category: 'technical', text: `${home.blockingScripts} render-blocking script(s) — async/defer lagao.` });

  // Hard flags
  if (home.https && home.mixedContent && home.mixedContent.length) {
    issues.push({ severity: 'high', category: 'technical', text: `${home.mixedContent.length} mixed content (http://) resource(s) — page ko downgrade kar sakta hai.` });
  }
  if (!home.hasFavicon) issues.push({ severity: 'low', category: 'technical', text: 'Favicon nahi mila.' });
  if (home.viewportBlocksZoom) issues.push({ severity: 'low', category: 'technical', text: 'Viewport zoom block hai (user-scalable=no) — accessibility + mobile UX issue.' });
  if (!home.twitterCard) issues.push({ severity: 'low', category: 'onpage', text: 'Twitter Card meta missing (social share preview).' });

  // On-page (100)
  let onpage = 0;
  if (home.title) {
    onpage += 25;
    if (home.title.length >= 15 && home.title.length <= 70) onpage += 10;
    else issues.push({ severity: 'low', category: 'onpage', text: `Title length ${home.title.length} chars — ideal 40-60.` });
  } else issues.push({ severity: 'high', category: 'onpage', text: 'Title tag missing.' });
  if (home.metaDescription) {
    onpage += 20;
    if (home.metaDescription.length >= 70 && home.metaDescription.length <= 170) onpage += 10;
    else issues.push({ severity: 'low', category: 'onpage', text: `Meta description ${home.metaDescription.length} chars — ideal 120-160.` });
  } else issues.push({ severity: 'medium', category: 'onpage', text: 'Meta description missing (CTR impact).' });
  if (home.h1Count === 1) onpage += 15;
  else issues.push({ severity: home.h1Count === 0 ? 'medium' : 'low', category: 'onpage', text: home.h1Count === 0 ? 'Koi H1 nahi.' : `${home.h1Count} H1 tags mile (sirf 1 hona chahiye).` });
  if (home.ogTitle && home.ogImage) onpage += 10; else issues.push({ severity: 'low', category: 'onpage', text: 'OG social tags incomplete (title/image).' });
  if (home.lang) onpage += 10; else issues.push({ severity: 'low', category: 'onpage', text: '<html lang> attribute missing.' });

  // Content (100) — includes Readability & Heading Hierarchy
  let content = 0;
  const wc = home.wordCount;
  if (wc >= 300) content += 35;
  else if (wc >= 150) content += 24;
  else if (wc >= 50) content += 14;
  else content += 4;
  if (wc < 150) issues.push({ severity: 'medium', category: 'content', text: `Thin content — sirf ${wc} words.` });
  if (home.h2Count > 0) content += 15; else issues.push({ severity: 'low', category: 'content', text: 'Koi H2 heading nahi — structure weak.' });

  if (home.headingSkipped) {
    issues.push({ severity: 'low', category: 'content', text: 'Heading hierarchy skipped (e.g. H1 directly jumps to H3/H4 without intermediate levels).' });
  } else if (home.h1Count > 0 && home.h2Count > 0) {
    content += 10;
  }

  if (home.readability === 'Good') content += 10;
  else if (home.readability === 'Moderate') content += 6;
  else issues.push({ severity: 'low', category: 'content', text: `Content readability complex hai (~ ${home.avgWordsPerSentence || 20} words/sentence) — sentences chote aur clear rakhein.` });

  if (home.imageCount === 0) content += 15;
  else if (home.altCoverage >= 80) content += 15;
  else content += 8;
  if (home.imageCount > 0 && home.altCoverage < 80) issues.push({ severity: 'medium', category: 'content', text: `Sirf ${home.altCoverage}% images pe alt text hai.` });
  if (home.internalCount > 0) content += 15; else issues.push({ severity: 'medium', category: 'content', text: 'Koi internal link nahi — crawl budget waste.' });
  if (home.hasSchema) content += 10; else issues.push({ severity: 'low', category: 'content', text: 'Structured data (JSON-LD schema) nahi hai.' });

  // Links (100)
  let links = 0;
  if (broken.length === 0) links += 50; else issues.push({ severity: 'medium', category: 'links', text: `${broken.length} broken internal link(s) mile: ${broken.map((b) => b.url).join(', ')}` });
  if (home.internalCount > 0) links += 25; else issues.push({ severity: 'medium', category: 'links', text: 'Internal links nahi mile.' });
  if (home.externalCount > 0) links += 25;

  const breakdown = { technical: Math.min(100, tech), onpage: Math.min(100, onpage), content: Math.min(100, content), links: Math.min(100, links) };
  const score = Math.round((breakdown.technical + breakdown.onpage + breakdown.content + breakdown.links) / 4);
  return { score, breakdown, issues };
}

// ── Single LLM pass for summary + recommendations ────
async function analyzeWithLLM(domain, url, audit) {
  const compact = {
    domain,
    url,
    score: audit.score,
    breakdown: audit.breakdown,
    issues: audit.issues.map((i) => `${i.severity}:${i.category}: ${i.text}`).slice(0, 12),
  };
  const messages = [
    {
      role: 'system',
      content: 'You are an expert SEO auditor working inside Bob the Builder workspace. Reply ONLY with valid JSON, no markdown, no code fences. Format: {"summary": "2-3 line plain-language overview of this site\'s SEO state in Hinglish where natural", "recommendations": [{"priority": "high|medium|low", "issue": "short issue name", "fix": "specific actionable fix"}]} Max 6 recommendations. Base everything strictly on the provided audit data — never invent facts.',
    },
    { role: 'user', content: JSON.stringify(compact) },
  ];
  try {
    const { text } = await callLLM({
      role: 'builder',
      persona: 'builder',
      messages,
      temperature: 0.3,
      max_tokens: 900,
    });
    const cleaned = text.replace(/```json|```/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || audit.issues[0]?.text || 'Audit done.',
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 6) : [],
    };
  } catch (e) {
    console.error('[seoService] LLM analyze failed:', e.message);
    return {
      summary: 'LLM analysis unavailable — deterministic audit results below.',
      recommendations: audit.issues.slice(0, 6).map((i) => ({ priority: i.severity, issue: i.category, fix: i.text })),
    };
  }
}

// ── Main audit pipeline ──────────────────────────────
async function runAudit(originUrl, { skipLlm = false, keywords = [] } = {}) {
  const u = normalizeUrl(originUrl);
  const origin = u.origin;
  const domain = u.hostname.replace(/^www\./, '');
  const https = origin.startsWith('https://');

  const homepage = await fetchText(u.href, 12000).catch((e) => {
    throw new Error(`Could not fetch site: ${e.message}`);
  });
  const home = {
    https,
    status: homepage.status,
    ttfb: homepage.ttfb ?? 0,
    loadMs: homepage.loadMs ?? 0,
    htmlBytes: homepage.htmlBytes ?? Buffer.byteLength(homepage.text),
    ...parsePage(homepage.text, origin, homepage.headers || {}),
  };

  const [robots, broken, pageSpeedRes] = await Promise.all([
    fetchRobotsAndSitemap(origin),
    checkBrokenLinks(home.internalLinks, 6),
    fetchGooglePageSpeed(u.href, 8000),
  ]);

  const pageSpeed = pageSpeedRes || {
    perfScore: home.ttfb < 600 ? 90 : home.ttfb < 1500 ? 75 : 55,
    lcp: `~${((home.loadMs || home.ttfb * 2 || 1200) / 1000).toFixed(1)} s`,
    fcp: `~${((home.ttfb || 300) / 1000).toFixed(1)} s`,
    cls: '0.01',
    tbt: home.blockingScripts > 0 ? `${home.blockingScripts * 150} ms` : '0 ms',
    speedIndex: `~${((home.loadMs || 1000) / 1000).toFixed(1)} s`,
    fetched: false,
    strategy: 'mobile (proxy)'
  };

  const audit = scoreAudit(home, robots, broken);

  // ── Level 2: 20-page BFS Site Architecture Crawler ─────────────────────
  const MAX_PAGES = 50;
  const CONCURRENCY = 6;

  // BFS queue — start with homepage's internal links then expand
  const crawlQueue = [...new Set(home.internalLinks)].slice(0, 40);
  const crawlVisited = new Set([u.href, origin + '/', origin]);
  const pages = [];

  // Concurrency-limited BFS fetch loop
  async function crawlBatch(urls) {
    const results = await Promise.allSettled(urls.map(async (link) => {
      if (crawlVisited.has(link)) return null;
      crawlVisited.add(link);
      try {
        const p = await fetchText(link, 9000);
        if (p.status !== 200) return { url: link, status: p.status, title: '', h1Count: 0, wordCount: 0, internalLinks: [] };
        const parsed = parsePage(p.text, origin);
        return { url: link, status: p.status, ...parsed };
      } catch {
        return { url: link, status: 0, title: '', h1Count: 0, wordCount: 0, internalLinks: [] };
      }
    }));
    return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  }

  // BFS in batches — hard deadline so a slow site never blows the serverless
  // request budget (50 pages can otherwise approach ~80s worst-case).
  const crawlDeadlineMs = 25000;
  const crawlStart = Date.now();
  let cursor = 0;
  while (pages.length < MAX_PAGES && cursor < crawlQueue.length && Date.now() - crawlStart < crawlDeadlineMs) {
    const batch = crawlQueue.slice(cursor, cursor + CONCURRENCY);
    cursor += CONCURRENCY;
    const batchResults = await crawlBatch(batch);
    for (const pg of batchResults) {
      if (!pg || pages.length >= MAX_PAGES) break;
      pages.push(pg);
      // Enqueue newly discovered links from this page
      if (Array.isArray(pg.internalLinks)) {
        for (const link of pg.internalLinks) {
          if (!crawlVisited.has(link) && !crawlQueue.includes(link)) {
            crawlQueue.push(link);
          }
        }
      }
    }
  }

  // ── Per-page linkage map (for orphan detection) ──
  // Build a map of which pages receive links from other pages
  const receivesLinkFrom = {}; // url -> count of internal pages pointing to it
  const allCrawledUrls = [u.href, ...pages.map(p => p.url)];
  for (const pg of pages) {
    for (const linked of (pg.internalLinks || [])) {
      if (allCrawledUrls.includes(linked)) {
        receivesLinkFrom[linked] = (receivesLinkFrom[linked] || 0) + 1;
      }
    }
  }
  // Homepage always receives links (it's the root)
  receivesLinkFrom[u.href] = (receivesLinkFrom[u.href] || 999);

  // Tag each page with orphan status + incoming link count
  const pagesWithMeta = pages.map(pg => ({
    ...pg,
    incomingLinks: receivesLinkFrom[pg.url] || 0,
    isOrphan: !receivesLinkFrom[pg.url],
  }));

  // ── Issue detection across all crawled pages ──
  const thinPages = pagesWithMeta.filter((p) => p.status === 200 && p.wordCount > 0 && p.wordCount < 120);
  if (thinPages.length) audit.issues.push({ severity: 'low', category: 'content', text: `${thinPages.length} page(s) mein thin content (<120 words): ${thinPages.slice(0, 3).map((p) => new URL(p.url).pathname).join(', ')}` });

  const orphanPages = pagesWithMeta.filter(p => p.status === 200 && p.isOrphan);
  if (orphanPages.length) audit.issues.push({ severity: 'medium', category: 'links', text: `${orphanPages.length} orphan page(s) mile — koi internal link point nahi karta: ${orphanPages.slice(0, 3).map(p => new URL(p.url).pathname).join(', ')}` });

  const missingH1Pages = pagesWithMeta.filter(p => p.status === 200 && !p.h1Count);
  if (missingH1Pages.length > 1) audit.issues.push({ severity: 'medium', category: 'onpage', text: `${missingH1Pages.length} internal page(s) par H1 tag nahi hai: ${missingH1Pages.slice(0, 3).map(p => new URL(p.url).pathname).join(', ')}` });

  const noMetaDescPages = pagesWithMeta.filter(p => p.status === 200 && !p.metaDescription);
  if (noMetaDescPages.length > 1) audit.issues.push({ severity: 'low', category: 'onpage', text: `${noMetaDescPages.length} internal page(s) par meta description nahi: ${noMetaDescPages.slice(0, 3).map(p => new URL(p.url).pathname).join(', ')}` });

  // Duplicate titles
  const seenTitles = new Set();
  const dupTitles = [];
  for (const p of pagesWithMeta) {
    if (!p.title) continue;
    const t = p.title.toLowerCase().trim();
    if (seenTitles.has(t)) dupTitles.push(p.title.trim());
    seenTitles.add(t);
  }
  if (dupTitles.length) {
    audit.issues.push({ severity: 'medium', category: 'onpage', text: `Duplicate page titles: ${[...new Set(dupTitles)].slice(0, 3).map((t) => `"${t}"`).join(' | ')} — har page ka title unique hona chahiye.` });
  }

  // Duplicate H1s
  const seenH1s = new Set();
  const dupH1s = [];
  for (const p of pagesWithMeta) {
    const h = Array.isArray(p.h1Texts) ? p.h1Texts[0] : null;
    if (!h) continue;
    const hl = h.toLowerCase().trim();
    if (seenH1s.has(hl)) dupH1s.push(h.trim());
    seenH1s.add(hl);
  }
  if (dupH1s.length) {
    audit.issues.push({ severity: 'low', category: 'onpage', text: `Duplicate H1 tags across pages: ${[...new Set(dupH1s)].slice(0, 3).map(h => `"${h}"`).join(' | ')}` });
  }

  const llm = skipLlm ? null : await analyzeWithLLM(domain, u.href, audit);

  // Keyword presence check — target keywords appearing in title/meta/body text.
  const haystack = `${home.title || ''} ${home.metaDescription || ''} ${homepage.text || ''}`.toLowerCase();
  const keywordChecks = (Array.isArray(keywords) ? keywords : []).filter((k) => k && k.trim()).map((k) => {
    const kw = String(k).trim();
    const found = haystack.includes(kw.toLowerCase());
    if (found) {
      audit.issues = audit.issues.filter((i) => !(i.category === 'keyword' && i.keyword === kw));
    } else {
      audit.issues.push({ severity: 'medium', category: 'keyword', keyword: kw, text: `Target keyword "${kw}" not found on homepage (title/meta/body).` });
    }
    return { keyword: kw, found };
  });

  const signals = {
    ttfbMs: home.ttfb || 0,
    loadMs: home.loadMs || 0,
    htmlBytes: home.htmlBytes || 0,
    title: home.title || '',
    metaDescription: home.metaDescription || '',
    canonical: home.canonical || '',
    ogTitle: home.ogTitle || '',
    ogImage: home.ogImage || '',
    noindex: !!home.noindex,
    viewport: home.viewport || '',
    lang: home.lang || '',
    hasFavicon: !!home.hasFavicon,
    h1Count: home.h1Count || 0,
    h1Texts: home.h1Texts || [],
    h2Count: home.h2Count || 0,
    h3Count: home.h3Count || 0,
    headingSkipped: !!home.headingSkipped,
    inlineStyleCount: home.inlineStyleCount || 0,
    duplicateIds: home.duplicateIds || [],
    scriptSrcCount: home.scriptSrcCount || 0,
    blockingScripts: home.blockingScripts || 0,
    cssLinkCount: home.cssLinkCount || 0,
    imgCount: home.imageCount || 0,
    lazyImages: home.lazyCount || 0,
    altCoverage: home.altCoverage || 100,
    semanticCount: home.semanticCount || 0,
    semanticTags: home.semanticTags || [],
    hreflangCount: home.hreflangCount || 0,
    hasSchema: !!(home.hasSchema || (home.schemaTypes && home.schemaTypes.length > 0)),
    schemaTypes: home.schemaTypes || [],
    twitterCard: home.twitterCard || '',
    totalDomNodes: home.totalDomNodes || 0,
    maxDomDepth: home.maxDomDepth || 0,
    domBloated: !!home.domBloated,
    hsts: home.hsts || '',
    csp: home.csp || '',
    xFrame: home.xFrame || '',
    xContentType: home.xContentType || '',
    referrerPolicy: home.referrerPolicy || '',
    readability: home.readability || 'Good',
    avgWordsPerSentence: home.avgWordsPerSentence || 0,
    wordCount: home.wordCount || 0,
    sitemapUrls: (robots.sitemapUrls || []).length,
    sitemapLastmod: robots.lastmodCount || 0,
    robotsExists: !!robots.robotsExists,
    sitemapFound: !!robots.sitemapFound,
    perfScore: pageSpeed.perfScore,
    lcp: pageSpeed.lcp,
    fcp: pageSpeed.fcp,
    cls: pageSpeed.cls,
    tbt: pageSpeed.tbt,
    pageSpeedFetched: pageSpeed.fetched,
  };

  return {
    domain,
    url: u.href,
    home,
    robotsMetrics: { robotsExists: !!robots.robotsExists, rulesPresent: !!robots.rulesPresent, sitemapFound: !!robots.sitemapFound, sitemapUrlCount: (robots.sitemapUrls || []).length, sitemapLastmod: robots.lastmodCount || 0, isSitemapIndex: !!robots.isSitemapIndex },
    pagesFound: pagesWithMeta ? pagesWithMeta.length : pages.length,
    audit: {
      score: audit.score,
      breakdown: audit.breakdown,
      issues: audit.issues.slice(0, 20),
      summary: llm ? llm.summary : 'Deterministic audit (LLM analysis skipped for comparison).',
      recommendations: llm ? llm.recommendations : (audit.issues.slice(0, 5).map((i) => ({ priority: i.severity, issue: i.category, fix: i.text }))),
      auditedAt: Date.now(),
      pageSpeed,
      signals,
      keywordChecks,
    },
    broken,
    crawledUrls: home.internalLinks || [],
    crawledPages: (typeof pagesWithMeta !== 'undefined' ? pagesWithMeta : pages)
      .filter((p) => p && p.url)
      .map((p) => ({
        url: p.url,
        path: (() => { try { return new URL(p.url).pathname; } catch { return p.url; } })(),
        title: p.title || '',
        h1: Array.isArray(p.h1Texts) && p.h1Texts.length ? p.h1Texts[0] : (p.h1Count ? '(found)' : ''),
        metaDesc: p.metaDescription || '',
        wordCount: p.wordCount || 0,
        status: p.status,
        incomingLinks: p.incomingLinks || 0,
        isOrphan: !!p.isOrphan,
        hasCanonical: !!p.canonical,
        blockingScripts: p.blockingScripts || 0,
        semanticCount: p.semanticCount || 0,
      })).slice(0, 50),
  };
}

// ── Storage ──────────────────────────────────────────
async function listSites(userId) {
  const snap = await coll(userId).orderBy('updatedAt', 'desc').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      url: data.url,
      domain: data.domain,
      chatSessionId: data.chatSessionId || null,
      lastScore: data.audit?.score ?? null,
      auditedAt: data.audit?.auditedAt ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

async function getSite(userId, id) {
  const doc = await coll(userId).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

function withHistory(prev = [], audit) {
  const prevList = Array.isArray(prev) ? prev : [];
  const lastEntry = prevList[prevList.length - 1];
  const delta = lastEntry && typeof lastEntry.score === 'number' ? (audit.score - lastEntry.score) : 0;
  const entry = { score: audit.score, delta, at: Date.now() };
  const next = [...prevList, entry].slice(-10);
  return next;
}

async function createSite(userId, urlInput) {
  const res = await runAudit(urlInput);
  const achievedAudit = { ...res.audit, keywordChecks: res.audit.keywordChecks };
  const ref = coll(userId).doc();
  const now = Date.now();
  const site = {
    id: ref.id,
    domain: res.domain,
    url: res.url,
    title: res.home.title || res.domain,
    lastScore: res.audit.score,
    keywords: [],
    chatSessionId: null,
    audit: {
      score: res.audit.score,
      breakdown: res.audit.breakdown,
      issues: res.audit.issues,
      summary: res.audit.summary,
      recommendations: res.audit.recommendations,
      pagesFound: res.pagesFound,
      homeUrl: res.url,
      techNotes: res.robotsMetrics,
      broken: res.broken,
      crawledUrls: res.crawledUrls,
      crawledPages: res.crawledPages,
      signals: res.audit.signals,
      pageSpeed: res.audit.pageSpeed,
      keywordChecks: achievedAudit.keywordChecks,
      auditedAt: res.audit.auditedAt,
    },
    history: withHistory([], res.audit),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(site);
  return site;
}

async function reAudit(userId, id) {
  const site = await getSite(userId, id);
  if (!site) throw new Error('Site not found');
  const res = await runAudit(site.url, { keywords: site.keywords || [] });
  const updated = {
    title: res.home.title || res.domain,
    lastScore: res.audit.score,
    audit: {
      score: res.audit.score,
      breakdown: res.audit.breakdown,
      issues: res.audit.issues,
      summary: res.audit.summary,
      recommendations: res.audit.recommendations,
      pagesFound: res.pagesFound,
      homeUrl: res.url,
      techNotes: res.robotsMetrics,
      broken: res.broken,
      crawledUrls: res.crawledUrls,
      crawledPages: res.crawledPages,
      signals: res.audit.signals,
      pageSpeed: res.audit.pageSpeed,
      keywordChecks: res.audit.keywordChecks,
      auditedAt: res.audit.auditedAt,
    },
    history: withHistory(site.history, res.audit),
    updatedAt: Date.now(),
  };
  await coll(userId).doc(id).set(updated, { merge: true });
  return { id, ...(await getSite(userId, id)) };
}

// ── Keyword tracking ──────────────────────────────
async function getKeywords(userId, id) {
  const site = await getSite(userId, id);
  if (!site) throw new Error('Site not found');
  return site.keywords || [];
}

async function addKeyword(userId, id, keyword) {
  const site = await getSite(userId, id);
  if (!site) throw new Error('Site not found');
  const kw = String(keyword || '').trim();
  if (!kw) throw new Error('Keyword khali hai.');
  if (kw.length > 80) throw new Error('Keyword max 80 chars.');
  const next = (site.keywords || []).filter((k) => k.toLowerCase() !== kw.toLowerCase());
  if (next.length === (site.keywords || []).length) {
    if (next.length >= 10) throw new Error('Max 10 keywords per site.');
  }
  next.push(kw);
  await coll(userId).doc(id).set({ keywords: next, updatedAt: Date.now() }, { merge: true });
  return next;
}

async function removeKeyword(userId, id, keyword) {
  const site = await getSite(userId, id);
  if (!site) throw new Error('Site not found');
  const kw = String(keyword || '');
  const next = (site.keywords || []).filter((k) => k.toLowerCase() !== kw.toLowerCase());
  await coll(userId).doc(id).set({ keywords: next, updatedAt: Date.now() }, { merge: true });
  return next;
}

async function deleteSite(userId, id) {
  await coll(userId).doc(id).delete();
  await db.collection('seoPumpQueue').doc(id).delete().catch(() => {});
  return true;
}

// ── Scheduled re-audit settings + background pump ──────
const PUMP_COLL = () => db.collection('seoPumpQueue');

async function updateSiteSettings(userId, id, { reAuditEnabled, reAuditIntervalHours }) {
  const site = await getSite(userId, id);
  if (!site) throw new Error('Site not found');
  const enabled = Boolean(reAuditEnabled);
  const intervalHours = Math.max(1, Number(reAuditIntervalHours) || 24);
  const now = Date.now();
  const patch = {
    reAuditEnabled: enabled,
    reAuditIntervalHours: enabled ? intervalHours : 0,
    updatedAt: now,
  };
  await coll(userId).doc(id).set(patch, { merge: true });

  const qRef = PUMP_COLL().doc(id);
  if (enabled) {
    const lastAuditAt = (site.audit && site.audit.auditedAt) || now - intervalHours * 3600 * 1000;
    await qRef.set(
      { userId, siteId: id, enabled: true, nextDueAt: lastAuditAt + intervalHours * 3600 * 1000, inProgress: false },
      { merge: true }
    );
  } else {
    await qRef.set({ enabled: false, inProgress: false }, { merge: true });
  }
  return getSite(userId, id);
}

// Background pump (POST /api/seo/pump, GitHub Actions every 5 min).
// Re-audits at most `limit` sites whose nextDueAt has passed. One-failure
// doesn't block the rest; inProgress + 10-min stall guard prevents double work.
async function processDueReAudits(limit = 1) {
  let due;
  try {
    due = await PUMP_COLL().where('enabled', '==', true).where('nextDueAt', '<=', Date.now()).orderBy('nextDueAt', 'asc').limit(limit).get();
  } catch (e) {
    throw new Error(`seoPumpQueue query failed (index missing?): ${e.message}`);
  }
  const results = [];
  for (const doc of due.docs) {
    const data = doc.data() || {};
    const { userId, siteId } = data;
    if (!userId || !siteId) { results.push({ siteId: doc.id, error: 'invalid queue entry' }); continue; }
    if (data.inProgress && Date.now() - (data.lastStartedAt || 0) < 10 * 60 * 1000) {
      results.push({ siteId, skipped: 'in progress' });
      continue;
    }
    try {
      await PUMP_COLL().doc(doc.id).set({ inProgress: true, lastStartedAt: Date.now() }, { merge: true });
      const site = await getSite(userId, siteId);
      if (!site) {
        await PUMP_COLL().doc(doc.id).delete().catch(() => {});
        results.push({ siteId, removed: true });
        continue;
      }
      const updated = await reAudit(userId, siteId);
      const intervalHours = Math.max(1, Number(site.reAuditIntervalHours) || 24);
      const nextDueAt = Date.now() + intervalHours * 3600 * 1000;
      await PUMP_COLL().doc(doc.id).set({ inProgress: false, lastRunAt: Date.now(), nextDueAt }, { merge: true });
      results.push({ siteId, domain: (updated && updated.domain) || site.domain, score: updated && updated.lastScore, nextDueAt });
    } catch (e) {
      await PUMP_COLL().doc(doc.id).set({ inProgress: false }, { merge: true }).catch(() => {});
      results.push({ siteId, error: e.message });
    }
  }
  return results;
}

// ── Isolated chat (type 'seo', Mirrors hackathon pattern) ──
async function ensureChatSession(userId, site) {
  if (site.chatSessionId) return site.chatSessionId;
  try {
    const sessions = await memory.listSessions(userId);
    const expectedTitle = `🔍 ${site.domain}`;
    const match = sessions.find((s) => s.title === expectedTitle);
    if (match) {
      await coll(userId).doc(site.id).set({ chatSessionId: match.id }, { merge: true });
      return match.id;
    }
  } catch (e) { /* best-effort */ }
  const s = await memory.createSession(userId, `🔍 ${site.domain}`, 'seo');
  await coll(userId).doc(site.id).set({ chatSessionId: s.id }, { merge: true });
  return s.id;
}

function buildSeoContext(site) {
  const a = site.audit || {};
  const sig = a.signals || {};
  const ps = a.pageSpeed || {};
  const pages = a.crawledPages || [];
  const orphanCount = pages.filter(p => p.isOrphan).length;

  const lines = [
    `SITE: ${site.domain} (${site.url})`,
    `OVERALL HEALTH SCORE: ${a.score ?? '—'}/100`,
    `SCORE BREAKDOWN: Technical: ${a.breakdown?.technical ?? '—'} | OnPage: ${a.breakdown?.onpage ?? '—'} | Content: ${a.breakdown?.content ?? '—'} | Links: ${a.breakdown?.links ?? '—'}`,
    `PAGES AUDITED: ${pages.length} crawled internal pages (${orphanCount} orphan pages flagged)`,
    `CORE WEB VITALS: LCP: ${sig.lcp || ps.lcp || '—'} | FCP: ${sig.fcp || ps.fcp || '—'} | CLS: ${sig.cls || ps.cls || '—'} | TTFB: ${sig.ttfbMs || 0}ms`,
    `SECURITY & DOM: HSTS: ${sig.hsts ? 'Active' : 'Missing'} | CSP/X-Frame: ${sig.csp || sig.xFrame ? 'Configured' : 'Missing'} | DOM Nodes: ${sig.totalDomNodes || '—'} (Depth: ${sig.maxDomDepth || '—'})`,
    `CONTENT & READABILITY: Readability: ${sig.readability || '—'} (${sig.avgWordsPerSentence || 0} wds/sentence) | Heading Order: ${sig.headingSkipped ? 'Skipped hierarchy' : 'Sequential'}`,
    a.summary ? `AUDIT SUMMARY: ${a.summary}` : '',
    `TOP VULNERABILITIES & ISSUES (${(a.issues || []).length} total):`,
    ...((a.issues || []).slice(0, 10).map((i) => `- [${i.severity.toUpperCase()}] (${i.category}): ${i.text}`)),
  ].filter(Boolean);

  return lines.join('\n');
}

// ── Level 4: Ultra-Token-Efficient AI Action Plan Generator ──
async function generateAiActionPlan(userId, siteId, { force = false } = {}) {
  const site = await getSite(userId, siteId);
  if (!site) throw new Error('Site not found');

  const a = site.audit || {};

  // Cache: already-generated plan is served without burning another LLM call.
  if (!force && a.aiActionPlan && a.aiActionPlan.text) {
    return { plan: a.aiActionPlan, sessionId: site.chatSessionId || null };
  }

  const sig = a.signals || {};
  const pages = a.crawledPages || [];
  const orphanCount = pages.filter(p => p.isOrphan).length;

  // Hyper-compressed lean payload (~150 tokens)
  const leanPayload = {
    domain: site.domain,
    score: a.score,
    breakdown: a.breakdown,
    topIssues: (a.issues || []).slice(0, 10).map(i => `${i.severity}: ${i.text}`),
    crawledCount: pages.length,
    orphans: orphanCount,
    vitals: { lcp: sig.lcp, fcp: sig.fcp, cls: sig.cls, ttfb: sig.ttfbMs, blocking: sig.blockingScripts },
    security: { hsts: sig.hsts, csp: Boolean(sig.csp || sig.xFrame) },
    content: { readability: sig.readability, headingSkipped: sig.headingSkipped }
  };

  const messages = [
    {
      role: 'system',
      content: `You are Bob the Builder's Enterprise SEO Master AI.
Generate a structured, high-impact action plan in natural, engaging Hinglish + English formatting.
Format your response with rich Markdown:
1. 🎯 **Executive Verdict**: Summary of site's current standing & highest-leverage opportunities.
2. 📈 **Score Potential**: State current score (${a.score}/100) vs realistic target score (e.g. 95+/100).
3. ⚡ **Top 3-4 Quick Wins**: Bullet points with specific actionable fixes and expected score boost (e.g. [HIGH IMPACT] +4 pts).
4. 🏗️ **Core Architecture Roadmap**: Clear guidance covering Web Vitals, Security Headers (HSTS/CSP), Internal Link structure & DOM optimization.
5. 💡 **Next Step Advice**: Specific next step for the developer.

Be crisp, technical, highly actionable, and avoid fluff. Do not wrap in JSON, return clean markdown.`
    },
    { role: 'user', content: JSON.stringify(leanPayload) }
  ];

  try {
    const { text } = await callLLM({
      role: 'builder',
      persona: 'builder',
      messages,
      temperature: 0.3,
      max_tokens: 1200,
    });

    const sid = await ensureChatSession(userId, site);
    await memory.addMessage(userId, sid, 'assistant', text);

    const updatedAudit = { ...site.audit, aiActionPlan: { generatedAt: Date.now(), text } };
    await coll(userId).doc(siteId).set({ audit: updatedAudit, updatedAt: Date.now() }, { merge: true });

    return { plan: updatedAudit.aiActionPlan, sessionId: sid };
  } catch (err) {
    console.error('[seoService] generateAiActionPlan failed:', err.message);
    const fallbackText = `### 🎯 SEO Action Plan for ${site.domain}

**Current Score**: ${a.score}/100 ➔ **Target Potential**: 95/100

#### ⚡ Quick Wins:
${(a.issues || []).slice(0, 3).map(i => `- **[${i.severity.toUpperCase()}]** ${i.text} *(Impact: +3 pts)*`).join('\n')}

#### 🏗️ Architecture Focus:
- Configure **HSTS & Security Headers** to enforce secure crawling.
- Resolve **render-blocking JavaScript** to improve Core Web Vitals (LCP < 2.5s).
- Fix **orphan pages** by linking them from homepage & category menus.`;

    const sid = await ensureChatSession(userId, site);
    await memory.addMessage(userId, sid, 'assistant', fallbackText);
    return { plan: { generatedAt: Date.now(), text: fallbackText }, sessionId: sid };
  }
}

async function chatList(userId, siteId) {
  const site = await getSite(userId, siteId);
  if (!site) throw new Error('Site not found');
  let sid = site.chatSessionId;
  if (!sid) {
    try {
      const sessions = await memory.listSessions(userId);
      const expectedTitle = `🔍 ${site.domain}`;
      const match = sessions.find((s) => s.title === expectedTitle);
      if (match) {
        sid = match.id;
        await coll(userId).doc(siteId).set({ chatSessionId: sid }, { merge: true });
      }
    } catch (e) { /* best-effort */ }
  }
  if (!sid) return [];
  return memory.getRecentMessages(userId, sid, 50);
}

async function chatSend(userId, siteId, message) {
  const site = await getSite(userId, siteId);
  if (!site) throw new Error('Site not found');
  const sid = await ensureChatSession(userId, site);
  await memory.addMessage(userId, sid, 'user', message);

  const recent = await memory.getRecentMessages(userId, sid, 20);
  const context = buildSeoContext(site);

  const systemPrompt = `You are Bob, Master Nikhil's personal development AI, inside the SEO DIAGNOSTICS workspace for "${site.domain}".
This chat is STRICTLY about this website's comprehensive SEO health, problem finding, strengths, and vulnerability inspection across the entire website. Never bring up vault, stalking, hackathons, or other chats.

CURRENT AUDIT DATA:
${context}

Your primary role:
- Deeply inspect and explain each problem/vulnerability found (root cause, crawler impact, ranking consequences).
- Highlight positive strengths and pulse points of the website.
- Evaluate whole-website architecture (Clean HTML, indexability, speed, sitemaps, schema, mobile responsiveness).
- Be analytical, sharp, and practical. Use Hinglish when natural. Never claim data you don't have.`;

  const { text, model } = await callLLM({
    role: 'builder',
    persona: 'builder',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recent.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  await memory.addMessage(userId, sid, 'assistant', text);
  return { reply: text, model, sessionId: sid };
}

// ── Fix-Plan generator (deterministic, NO LLM cost) ──
// Audit ke issues par based ready-to-deploy files: robots.txt, sitemap.xml,
// canonical/meta/OG/JSON-LD snippets — copy ya download karke upload kar do.
function escXml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateFixPlan(site) {
  const a = site.audit || {};
  let origin;
  try { origin = new URL(site.url).origin; } catch { origin = `https://${site.domain || 'example.com'}`; }
  const host = site.domain || (() => { try { return new URL(origin).hostname; } catch { return 'example.com'; } })();
  const title = (site.title || host).replace(/[|_-].*$/, '').trim() || host;

  const urls = (Array.isArray(a.crawledUrls) ? a.crawledUrls : []).filter((u) => u && u !== site.url);
  const sitemapLocations = [site.url, ...urls].filter((u, i, arr) => arr.indexOf(u) === i).slice(0, 200);

  const robotsTxt = [
    'User-agent: *',
    'Allow: /$',
    'Disallow: /api/',
    'Disallow: /search',
    'Disallow: /*?',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapLocations.map((u) => `  <url>\n    <loc>${escXml(u)}</loc>\n  </url>`).join('\n')}\n</urlset>\n`;

  const canonical = `<link rel="canonical" href="${escXml(site.url)}" />`;

  const ogBlock = [
    `<meta property="og:title" content="${escXml(title)}" />`,
    `<meta property="og:description" content="Short compelling description — 120-155 chars." />`,
    `<meta property="og:image" content="https://${host}/og-image.png" />`,
    `<meta property="og:url" content="${escXml(site.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escXml(host)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n');

  const jsonld = `{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "${escXml(title)}",
  "url": "${escXml(site.url)}"
}`;

  const blockingCount = (a.signals && typeof a.signals.blockingScripts === 'number') ? a.signals.blockingScripts : 0;
  const guidelines = [
    'Meta description: har page par unique, 120-155 chars, CTA ke saath.',
    `Render-blocking scripts: ${blockingCount} mile — src= script par async ya defer attribute lagao (head se pehle render hota rahe).`,
    'Structured data ko smile: search.google.com/test/rich-results se validate, error 0 hona chahiye.',
    'robots.txt + sitemap.xml upload ke baad Google Search Console me property verify karke sitemap submit karo.',
    'Duplicate page titles wale pages ke title alag-alag banao (primary keyword aage).',
  ];

  return {
    domain: host,
    origin,
    generatedAt: Date.now(),
    score: a.score,
    artifacts: {
      robotsTxt,
      sitemap,
      canonical,
      ogBlock,
      jsonld,
    },
    guidelines,
  };
}

// ── Competitor comparison (deterministic, no LLM) ─────
// ── Full SEO report (HTML) — combines audit + fix plan + topic coverage ──
function generateSeoReport(site) {
  const a = site.audit || {};
  const sig = a.signals || {};
  const issues = Array.isArray(a.issues) ? a.issues : [];
  const recs = Array.isArray(a.recommendations) ? a.recommendations : [];
  const checks = { p: { c: '#16a34a', l: 'Pass' }, w: { c: '#d97706', l: 'Warn' }, f: { c: '#dc2626', l: 'Fail' }, m: { c: '#64748b', l: 'Manual' } };

  const bd = (k) => (a.breakdown && a.breakdown[k]) || 0;
  const metaDesc = (sig.metaDescription != null) ? sig.metaDescription : null;
  const kwChecks = Array.isArray(a.keywordChecks) ? a.keywordChecks : [];
  const crawledUrls = Array.isArray(a.crawledUrls) ? a.crawledUrls : [];
  const broken = Array.isArray(a.broken) ? a.broken.filter((b) => !b.ok) : [];

  const coverage = [];
  const homeUrl = String(site.url || '');
  const pathname = (() => { try { return new URL(homeUrl).pathname; } catch { return ''; } })();
  const urlClear = !homeUrl.includes('?') && !homeUrl.includes('#') && !/[A-Z]/.test(pathname.replace(/\/$/, ''));
  coverage.push({ t: 'URL Architecture', s: urlClear ? 'p' : 'w', n: urlClear ? 'Clean, query-less URL structure' : 'URL mein query/#/uppercase segments hain — clean URLs preferred' });

  coverage.push({ t: 'Redirects & Status Codes', s: broken.length ? 'f' : 'p', n: broken.length ? `${broken.length} broken link(s): ${broken.slice(0, 3).map((b) => b.url).join(', ')}` : 'No broken links detected' });

  const hasCanonical = !!sig.canonical;
  coverage.push({ t: 'Canonicalization', s: hasCanonical ? 'p' : 'w', n: hasCanonical ? 'Self-referencing canonical present' : 'Canonical tag nahi mila — duplicate-content protection missing' });

  const schemaTypes = Array.isArray(sig.schemaTypes) ? sig.schemaTypes : [];
  coverage.push({ t: 'Structured Data (JSON-LD)', s: schemaTypes.length ? 'p' : 'w', n: schemaTypes.length ? `Found: ${schemaTypes.join(', ')}` : 'No JSON-LD schema detected' });

  const md = typeof metaDesc === 'string' ? metaDesc.trim() : '';
  coverage.push({ t: 'Meta Description', s: md.length >= 120 && md.length <= 200 ? 'p' : md.length ? 'w' : 'f', n: md.length >= 120 && md.length <= 200 ? `${md.length} chars (optimal 120-200)` : md.length ? `${md.length} chars — target 120-200` : 'Missing meta description' });

  const ogOk = !!sig.ogTitle || !!sig.ogImage;
  const twOk = !!sig.twitterCard;
  coverage.push({ t: 'Open Graph + Twitter Cards', s: ogOk && twOk ? 'p' : ogOk || twOk ? 'w' : 'f', n: ogOk && twOk ? 'OG + Twitter card both present' : ogOk ? 'OG present, Twitter card missing' : 'Social tags missing' });

  const sitemapCount = typeof sig.sitemapUrls === 'number' ? sig.sitemapUrls : 0;
  coverage.push({ t: 'XML Sitemap', s: sig.sitemapFound && sitemapCount > 0 ? 'p' : 'f', n: sig.sitemapFound ? `${sitemapCount} URL(s) in sitemap` : 'No sitemap found — add /sitemap.xml' });

  coverage.push({ t: 'robots.txt', s: sig.robotsExists ? 'p' : 'f', n: sig.robotsExists ? 'Found' : 'Missing — add robots.txt' });

  const hreflang = typeof sig.hreflangCount === 'number' ? sig.hreflangCount : 0;
  coverage.push({ t: 'hreflang / International SEO', s: hreflang ? 'p' : 'm', n: hreflang ? `${hreflang} language tag(s)` : 'Multilingual nahi hai to optional (manual check needed)' });

  const blocking = typeof sig.blockingScripts === 'number' ? sig.blockingScripts : 0;
  coverage.push({ t: 'Crawl Budget & Renderability', s: blocking === 0 ? 'p' : blocking <= 2 ? 'w' : 'f', n: blocking === 0 ? 'No render-blocking scripts' : `${blocking} render-blocking script(s) — async/defer lagao` });

  const ttfb = typeof sig.ttfbMs === 'number' ? sig.ttfbMs : 0;
  const loadMs = typeof sig.loadMs === 'number' ? sig.loadMs : 0;
  const perf = ttfb < 600 && loadMs < 2500 ? 'p' : (ttfb < 1500 && loadMs < 5000) ? 'w' : 'f';
  coverage.push({ t: 'Core Web Vitals / Performance', s: perf, n: `TTFB ${ttfb}ms · load ${loadMs}ms` });

  const noindexFlag = !!sig.noindex;
  coverage.push({ t: 'Indexability', s: noindexFlag ? 'w' : 'p', n: noindexFlag ? 'noindex meta present on homepage — check if intentional' : 'Pages default-indexable' });

  const internal = crawledUrls.length;
  coverage.push({ t: 'Internal Linking', s: internal >= 3 ? 'p' : 'w', n: `${internal} internal link(s) found on homepage` });

  coverage.push({ t: 'Log-file Analysis', s: 'm', n: 'Public crawl se detect nahi hota — Search Console / server logs se manual' });

  const covRows = coverage.map((c) => {
    const ch = checks[c.s];
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${escXml(c.t)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#444;">${escXml(c.n)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#fff;font-weight:700;background:${ch.c};border-radius:4px;font-size:11px;">${ch.l}</td></tr>`;
  }).join('');

  const signalRows = [
    ['TTFB', typeof sig.ttfbMs === 'number' ? sig.ttfbMs + 'ms' : '—'],
    ['Page size', typeof sig.htmlBytes === 'number' ? Math.round(sig.htmlBytes / 1024) + ' KB' : '—'],
    ['Scripts', typeof sig.scriptSrcCount === 'number' ? sig.scriptSrcCount + ' (' + (typeof sig.blockingScripts === 'number' ? sig.blockingScripts : 0) + ' blocking)' : '—'],
    ['CSS files', typeof sig.cssLinkCount === 'number' ? sig.cssLinkCount : '—'],
    ['Images', typeof sig.imgCount === 'number' ? sig.imgCount + ' (' + (typeof sig.lazyImages === 'number' ? sig.lazyImages : 0) + ' lazy)' : '—'],
    ['Semantic tags', typeof sig.semanticCount === 'number' ? sig.semanticCount + '/7' : '—'],
    ['Sitemap URLs', typeof sig.sitemapUrls === 'number' ? sig.sitemapUrls : '—'],
    ['robots.txt', sig.robotsExists ? 'Found' : 'Missing'],
    ['hreflang', typeof sig.hreflangCount === 'number' ? sig.hreflangCount : '—'],
    ['Schema', Array.isArray(sig.schemaTypes) && sig.schemaTypes.length ? sig.schemaTypes.join(', ') : 'None'],
  ].map(([k, v]) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;color:#666;">${escXml(k)}</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-weight:600;text-align:right;">${escXml(v)}</td></tr>`).join('');

  const kwRows = (site.keywords || []).map((kw) => {
    const ck = kwChecks.find((x) => x.keyword.toLowerCase() === String(kw).toLowerCase());
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;">${escXml(kw)}</td><td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-weight:700;color:${ck ? (ck.found ? '#16a34a' : '#dc2626') : '#64748b'};">${ck ? (ck.found ? '✓ Found' : '✗ Missing') : 'Pending'}</td></tr>`;
  }).join('') || '<tr><td style="padding:4px 8px;color:#64748b;">No keywords tracked</td></tr>';

  const issueRows = issues.slice(0, 30).map((i) => `<div style="padding:6px 0;border-bottom:1px dashed #e5e7eb;font-size:13px;"><span style="display:inline-block;min-width:74px;font-weight:700;text-transform:uppercase;font-size:11px;color:${i.severity === 'high' ? '#dc2626' : i.severity === 'medium' ? '#d97706' : '#64748b'};">${escXml(i.severity)}</span> ${escXml(i.text)}</div>`).join('') || '<div style="color:#64748b;font-size:13px;">No issues — clean!</div>';

  const recRows = recs.map((r) => `<div style="padding:6px 0;border-bottom:1px dashed #e5e7eb;font-size:13px;"><strong style="color:${r.priority === 'high' ? '#dc2626' : r.priority === 'medium' ? '#d97706' : '#111827'};">${escXml(String(r.priority).toUpperCase())}</strong> ${escXml(r.issue)}<div style="color:#444;margin-top:2px;">→ ${escXml(r.fix)}</div></div>`).join('') || '<div style="color:#64748b;font-size:13px;">No recommendations.</div>';

  const plan = generateFixPlan(site);
  const art = plan.artifacts || {};
  const artBlocks = [
    ['🤖 robots.txt', art.robotsTxt || ''],
    ['🗺 sitemap.xml', art.sitemap || ''],
    ['🔗 Canonical tag', art.canonical || ''],
    ['📱 OG + Twitter tags', art.ogBlock || ''],
    ['🧩 JSON-LD schema', art.jsonld || ''],
  ].map(([t, code]) => `<div style="border:1px solid #e5e7eb;border-radius:8px;margin:10px 0;overflow:hidden;"><div style="background:#f8fafc;padding:8px 12px;font-weight:700;font-size:13px;">${t}</div><pre style="background:#0f172a;color:#e2e8f0;padding:12px;margin:0;overflow:auto;font-size:11px;white-space:pre-wrap;word-break:break-word;">${escXml(code)}</pre></div>`).join('');

  const bb = ['technical', 'onpage', 'content', 'links'].map((k) => `<tr><td style="padding:4px 8px;color:#666;text-transform:capitalize;">${k}</td><td style="padding:4px 8px;"><div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;"><div style="width:${Math.max(0, Math.min(100, bd(k)))}%;height:100%;background:${bd(k) >= 70 ? '#16a34a' : bd(k) >= 50 ? '#d97706' : '#dc2626'};border-radius:4px;"></div></div></td><td style="padding:4px 8px;font-weight:700;text-align:right;">${bd(k)}/100</td></tr>`).join('');

  const historyLine = (Array.isArray(site.history) && site.history.length ? site.history.map((h) => h.score).join(' → ') : '—');

  const sc = typeof a.score === 'number' ? a.score : null;
  const scolor = sc == null ? '#64748b' : sc >= 70 ? '#16a34a' : sc >= 50 ? '#d97706' : '#dc2626';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>SEO Report — ${escXml(site.domain || site.url)}</title></head><body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,sans-serif;color:#111827;">
<div style="max-width:860px;margin:0 auto;padding:24px;">
  <div style="background:#0f172a;color:#fff;border-radius:12px;padding:20px 24px;">
    <div style="font-size:22px;font-weight:800;">🔍 SEO Audit Report</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px;">${escXml(site.domain || site.url)} · ${new Date(a.auditedAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
    <div style="margin-top:14px;font-size:40px;font-weight:800;color:${scolor};">${sc != null ? sc + ' <span style="font-size:15px;color:#94a3b8;">/100</span>' : '—'}</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:6px;">Score history: ${escXml(historyLine)}</div>
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">📊 Breakdown</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${bb}</table>
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">🌐 Technical Signals</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${signalRows}</table>
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">🎯 Keyword Tracking</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${kwRows}</table>
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">❌ Issues</div>
    ${issueRows}
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">🔧 Recommendations</div>
    ${recRows}
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">🧾 SEO Engineering Coverage (14 topics)</div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">${covRows}</table>
  </div>

  <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:16px;">
    <div style="font-weight:800;font-size:15px;margin-bottom:8px;">🛠 Ready-to-Deploy Fix Files</div>
    ${artBlocks}
  </div>

  <div style="text-align:center;color:#94a3b8;font-size:11px;margin-top:20px;">Generated by Bob — SEO Working Workspace</div>
</div>
</body></html>`;
}

module.exports = {
  runAudit,
  generateAiActionPlan,
  listSites,
  getSite,
  createSite,
  reAudit,
  deleteSite,
  updateSiteSettings,
  processDueReAudits,
  generateFixPlan,
  generateSeoReport,
  getKeywords,
  addKeyword,
  removeKeyword,
  chatList,
  chatSend,
};