/**
 * stocksService.js
 * Free Indian-market quotes via the public Yahoo Finance chart API
 * (NO API key required). Cached for 15 minutes so we don't hammer it.
 *
 * Symbols use Yahoo's convention:
 *   ^NSEI  = NIFTY 50      ^BSESN = SENSEX
 *   RELIANCE.NS / TCS.NS / HDFCBANK.NS ... (.NS = NSE, .BO = BSE)
 */

const DEFAULT_SYMBOLS = [
  '^NSEI',        // NIFTY 50
  '^BSESN',       // SENSEX
  'RELIANCE.NS',
  'TCS.NS',
  'HDFCBANK.NS',
  'INFY.NS',
  'SBIN.NS',
  'ITC.NS',
  'TATAMOTORS.NS',
  'WIPRO.NS',
  'ADANIENT.NS',
  'BAJFINANCE.NS',
];

const CACHE = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 min

async function cached(key, fn) {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function cleanSymbols(input) {
  if (!input) return DEFAULT_SYMBOLS.slice();
  const list = String(input)
    .split(/[,\s]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 15);
  return list.length ? list : DEFAULT_SYMBOLS.slice();
}

/**
 * Fetch quotes for one symbol from Yahoo's chart endpoint.
 */
async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const data = await fetchJson(url);

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.meta) throw new Error(`No data for ${symbol}`);

  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = (price != null && prev != null) ? price - prev : null;
  const changePct = (change != null && prev) ? (change / prev) * 100 : null;

  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price,
    prev,
    change,
    changePct,
    marketState: meta.marketState || 'REGULAR',
  };
}

/** Fetch quotes for a list of symbols (graceful per-symbol failures). */
async function getQuotes(symbolsInput) {
  const symbols = cleanSymbols(symbolsInput);
  const cacheKey = symbols.join(',');

  return cached(cacheKey, async () => {
    const settled = await Promise.allSettled(symbols.map(fetchQuote));
    const quotes = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') quotes.push(r.value);
    }
    return quotes;
  });
}

function fmt(n, digits = 2) {
  return n == null || isNaN(n) ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Compact market line(s) ready for the LLM context. */
function formatQuotes(quotes) {
  if (!quotes || !quotes.length) return null;
  return quotes.map(q => {
    const arrow = q.change != null ? (q.change >= 0 ? '▲' : '▼') : '';
    const chg = q.change != null ? `${arrow}${fmt(Math.abs(q.change))} (${q.changePct >= 0 ? '+' : ''}${fmt(q.changePct)}%)` : '';
    return `${q.symbol} = ₹${fmt(q.price)} ${chg}`;
  }).join(' | ');
}

module.exports = { getQuotes, formatQuotes, cleanSymbols, DEFAULT_SYMBOLS };
