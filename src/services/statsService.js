'use strict';

// ---------------------------------------------------------------------------
// Pure-JS statistics engine — zero external APIs, zero dependencies.
// Used to auto-analyze data that Master Nikhil pastes into chat so Bob
// narrates EXACT computed numbers instead of LLM guesswork.
// ---------------------------------------------------------------------------

// Parse CSV text into columns + rows. Handles quoted fields and commas inside quotes.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);

  if (rows.length < 2) return { columns: [], rows: [] };
  const columns = rows[0].map(c => c.trim());
  const dataRows = rows.slice(1).map(r => {
    const out = [];
    for (let c = 0; c < columns.length; c++) out.push((r[c] !== undefined ? r[c] : '').trim());
    return out;
  });
  return { columns, rows: dataRows };
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function round(x) {
  if (x === null || x === undefined || isNaN(x)) return x;
  return Math.round(x * 1000) / 1000;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function numericStats(values) {
  const nums = values.map(toNumber).filter(n => n !== null);
  const total = values.length;
  const missing = total - nums.length;
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = percentile(sorted, 50);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;

  const freq = new Map();
  nums.forEach(n => freq.set(n, (freq.get(n) || 0) + 1));
  let mode = null, modeCount = 1;
  freq.forEach((c, v) => { if (c > modeCount) { mode = v; modeCount = c; } });

  const variance = nums.length > 1
    ? nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const outliers = nums.filter(n => n < lower || n > upper);

  return {
    type: 'number',
    count: nums.length, missing, unique: new Set(nums).size,
    sum: round(sum), mean: round(mean), min: round(min), max: round(max),
    median: round(median), mode: mode === null ? null : round(mode),
    q1: round(q1), q3: round(q3), iqr: round(iqr), stdDev: round(stdDev),
    outlierCount: outliers.length,
    outliers: outliers.slice(0, 8),
  };
}

function stringStats(values) {
  const counts = values.filter(v => String(v).trim() !== '');
  const freq = new Map();
  counts.forEach(v => freq.set(v, (freq.get(v) || 0) + 1));
  let mode = null, modeCount = 0;
  freq.forEach((c, v) => { if (c > modeCount) { mode = v; modeCount = c; } });
  return { type: 'string', count: counts.length, missing: values.length - counts.length, unique: freq.size, mode };
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xm = xs.reduce((a, b) => a + b, 0) / n;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - xm, y = ys[i] - ym;
    num += x * y; dx += x * x; dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

function linearRegression(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xm = xs.reduce((a, b) => a + b, 0) / n;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xm) * (ys[i] - ym);
    dx += (xs[i] - xm) ** 2;
  }
  if (dx === 0) return null;
  const slope = num / dx;
  const intercept = ym - slope * xm;
  const r = pearson(xs, ys);
  return { slope: round(slope), intercept: round(intercept), r2: r === null ? null : round(r * r) };
}

function histogram(values, bins = 8) {
  const nums = values.map(toNumber).filter(n => n !== null);
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return { bins: [String(round(min))], counts: [nums.length] };
  const step = (max - min) / bins;
  const edges = [];
  for (let i = 0; i <= bins; i++) edges.push(min + i * step);
  const counts = new Array(bins).fill(0);
  nums.forEach(n => {
    let b = Math.floor((n - min) / step);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  });
  const labels = edges.slice(0, -1).map((e, i) => `${round(e)}-${round(edges[i + 1])}`);
  return { bins: labels, counts };
}

// High-level analysis of a CSV string.
function analyzeCSV(text, opts = {}) {
  const { columns, rows } = parseCSV(text);
  if (!columns.length) return { error: 'Could not parse data — need a header row + at least 1 data row.' };

  const maxRows = opts.maxRows || 500;
  const maxCols = opts.maxCols || 20;
  const truncated = rows.length > maxRows;
  const dataRows = rows.slice(0, maxRows);
  const cols = columns.slice(0, maxCols);

  const columnsSummary = {};
  cols.forEach((col, ci) => {
    const values = dataRows.map(r => (r[ci] !== undefined ? r[ci] : ''));
    const nums = values.map(toNumber);
    const isNumeric = nums.every(n => n !== null) && nums.length > 0;
    columnsSummary[col] = isNumeric ? numericStats(values) : stringStats(values);
  });

  const numericCols = cols.filter(c => columnsSummary[c] && columnsSummary[c].type === 'number');
  const correlations = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = numericCols[i], b = numericCols[j];
      const xs = dataRows.map(r => toNumber(r[cols.indexOf(a)]));
      const ys = dataRows.map(r => toNumber(r[cols.indexOf(b)]));
      const r = pearson(xs, ys);
      if (r !== null) correlations.push({ x: a, y: b, r: round(r) });
    }
  }
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  const trends = [];
  const histograms = [];
  numericCols.slice(0, 3).forEach(col => {
    const nums = dataRows.map(r => toNumber(r[cols.indexOf(col)]));
    const idx = nums.map((_, i) => i);
    const reg = linearRegression(idx, nums);
    if (reg) trends.push({ column: col, slope: reg.slope, intercept: reg.intercept, r2: reg.r2 });
    const h = histogram(nums, 8);
    if (h) histograms.push({ column: col, bins: h.bins, counts: h.counts });
  });

  return {
    columns: cols,
    rowCount: dataRows.length,
    totalRows: rows.length,
    truncated,
    columnsSummary,
    correlations: correlations.slice(0, 6),
    trends: trends.slice(0, 4),
    histograms: histograms.slice(0, 3),
  };
}

// Compact single-string summary, safe to inject into an LLM system prompt.
function summarizeForLLM(stats) {
  if (!stats || stats.error) return stats ? stats.error : '';
  const lines = [];
  lines.push(`Rows: ${stats.rowCount}${stats.truncated ? ` (truncated from ${stats.totalRows})` : ''}`);
  Object.entries(stats.columnsSummary || {}).forEach(([name, s]) => {
    if (!s) return;
    if (s.type === 'number') {
      lines.push(`• ${name}: n=${s.count}${s.missing ? ` missing=${s.missing}` : ''} | mean=${s.mean} median=${s.median} min=${s.min} max=${s.max} sum=${s.sum} stdDev=${s.stdDev}`);
      if (s.outlierCount > 0) lines.push(`  outliers(${s.outlierCount}): ${s.outliers.join(', ')}`);
    } else {
      lines.push(`• ${name}: text — unique=${s.unique}${s.mode ? ` most-common="${s.mode}"` : ''}${s.missing ? ` missing=${s.missing}` : ''}`);
    }
  });
  (stats.correlations || []).forEach(c => lines.push(`↔ correlation ${c.x} ~ ${c.y}: r=${c.r}`));
  (stats.trends || []).forEach(t => {
    const strength = t.r2 >= 0.6 ? 'strong' : t.r2 >= 0.25 ? 'moderate' : 'weak';
    lines.push(`↗ trend ${t.column}: slope=${t.slope}/row, r²=${t.r2} (${strength})`);
  });
  return lines.join('\n');
}

module.exports = { parseCSV, analyzeCSV, summarizeForLLM, numericStats, pearson, linearRegression, histogram };
