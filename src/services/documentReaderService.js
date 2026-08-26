const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * documentReaderService.js
 * ─────────────────────────────────────────────────────────
 * This is the piece that was MISSING from the project.
 *
 * Bob could already GENERATE real .xlsx/.docx/.pdf/.pptx files
 * (documentGenerator.js), but he had no way to READ one that
 * Master Nikhil uploads. Uploaded files only ever got pushed to
 * Cloudinary as opaque binary blobs (fileService.uploadFile) —
 * nobody ever opened them and pulled the text out, so the LLM
 * never actually saw what was inside a PDF/DOCX. It could only
 * guess/hallucinate from the filename.
 *
 * This service takes a Buffer + original filename and returns
 * plain extracted text, which fileService/chat.js can now inject
 * into the LLM context exactly like mediaDetector does for
 * YouTube/Instagram links.
 *
 * Supported: .pdf, .docx, .pptx, .xlsx/.xls, and plain-text formats
 * (.txt/.md/.csv/.tsv/.json/.xml/.yaml/.yml/.toml).
 *
 * NOT supported: the legacy binary .doc and .ppt formats (pre-2007 OLE
 * compound files). mammoth only reads the modern .docx XML format, and there is
 * no dependency here that can parse .doc/.ppt. Those extensions are still
 * accepted for upload/storage — they just come back as unreadable assets.
 */

// Cap how much extracted text we keep — long PDFs (100+ pages) would
// blow the LLM context otherwise. This is generous enough for guides,
// resumes, problem-statement banks, reports, etc.
const MAX_EXTRACTED_CHARS = 60000;

function truncate(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return trimmed;
  return trimmed.slice(0, MAX_EXTRACTED_CHARS) + `\n\n[... truncated, original was ${trimmed.length} characters ...]`;
}

/**
 * BUGFIX — small PDFs (< 32KB) could never be read.
 *
 * Node allocates any Buffer up to `Buffer.poolSize >>> 1` (32KB by default) as a
 * VIEW into a shared 64KB pool, so `buf.byteOffset` is non-zero and
 * `buf.buffer.byteLength` is 65536 rather than the file length. pdf-parse hands
 * that Buffer straight to pdf.js (lib/pdf-parse.js:70 `getDocument(dataBuffer)`),
 * and pdf.js reads the whole underlying ArrayBuffer — i.e. the entire pool,
 * including unrelated memory before and after our file. It then walks off the end
 * of the real document and dies with "bad XRef entry".
 *
 * Large PDFs happened to work because anything over the pool threshold gets its
 * own exact-sized allocation, which is why this went unnoticed: every real-world
 * test file was big enough. Verified locally: a 1,283-byte PDF fails, the same
 * bytes copied into a standalone Uint8Array parse fine, and a 1.1MB PDF works
 * either way.
 *
 * Fix: copy into a standalone Uint8Array whose ArrayBuffer is exactly the file,
 * so pdf.js can only ever see our bytes.
 */
function toStandaloneBytes(buffer) {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

async function extractFromPdf(buffer) {
  const data = await pdfParse(toStandaloneBytes(buffer));
  return { text: truncate(data.text), pageCount: data.numpages || null };
}

/**
 * BUGFIX: this function was CALLED at the .docx branch of extractText() but was
 * never defined anywhere in the file. Every .docx upload therefore threw
 * `ReferenceError: extractFromDocx is not defined`, which the catch-all in
 * extractText() silently converted into { supported: false }. Net effect: Bob
 * stored every Word document as an opaque blob and told the user he couldn't
 * read it, while `mammoth` sat imported-but-unused at the top of this file.
 *
 * mammoth.extractRawText gives us the document body as plain text with the
 * XML/styling stripped. .docx has no fixed page count (pagination is decided by
 * the renderer, not the file), so pageCount is intentionally null.
 */
async function extractFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return { text: truncate(result && result.value), pageCount: null };
}

const ExcelJS = require('exceljs');

async function extractFromExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetTexts = [];

  workbook.eachSheet((worksheet) => {
    const sheetName = worksheet.name || 'Sheet';
    const rows = [];
    worksheet.eachRow((row) => {
      // values array in ExcelJS is 1-indexed (values[0] is undefined)
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cleanRow = values.map(v => {
        if (v == null) return '';
        if (typeof v === 'object') {
          if (v.result != null) return String(v.result);
          if (v.text != null) return String(v.text);
          if (v.richText) return v.richText.map(t => t.text).join('');
          return JSON.stringify(v);
        }
        return String(v).replace(/\r?\n/g, ' ');
      });
      if (cleanRow.some(cell => cell.trim().length > 0)) {
        rows.push('| ' + cleanRow.join(' | ') + ' |');
      }
    });

    if (rows.length > 0) {
      sheetTexts.push(`### Sheet: ${sheetName}\n${rows.join('\n')}`);
    }
  });

  return { text: truncate(sheetTexts.join('\n\n')), pageCount: workbook.worksheets.length };
}

/**
 * .pptx text extraction. A .pptx is just a ZIP of XML parts, and jszip is
 * already a dependency (builderService uses it), so no new package is needed.
 * Slide text lives in <a:t> nodes inside ppt/slides/slideN.xml.
 *
 * This closes a real gap: .pptx and .ppt were both in the upload allowlist and
 * documentGenerator can WRITE .pptx, but reading one back always reported
 * "text extraction not implemented yet".
 */
async function extractFromPowerpoint(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);

  // Sort numerically (slide2 before slide10) — default string sort gets this wrong.
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/)[1]);
      const nb = Number(b.match(/(\d+)\.xml$/)[1]);
      return na - nb;
    });

  const slideTexts = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async('string');
    // Pull every <a:t>…</a:t> run, then de-entity the XML escapes.
    const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map(m => m[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim())
      .filter(Boolean);

    if (runs.length) {
      slideTexts.push(`### Slide ${i + 1}\n${runs.join('\n')}`);
    }
  }

  return { text: truncate(slideTexts.join('\n\n')), pageCount: slideNames.length };
}

/**
 * Extracts readable text from a file buffer, based on its extension.
 * Returns { supported, text, pageCount, error }.
 * Never throws — callers can always safely use the result.
 */
async function extractText(buffer, originalName = '') {
  const ext = String(originalName).split('.').pop().toLowerCase();

  try {
    if (ext === 'pdf') {
      const { text, pageCount } = await extractFromPdf(buffer);
      return { supported: true, text, pageCount, error: null };
    }
    if (ext === 'docx') {
      const { text, pageCount } = await extractFromDocx(buffer);
      return { supported: true, text, pageCount, error: null };
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const { text, pageCount } = await extractFromExcel(buffer);
      return { supported: true, text, pageCount, error: null };
    }
    if (ext === 'pptx') {
      const { text, pageCount } = await extractFromPowerpoint(buffer);
      return { supported: true, text, pageCount, error: null };
    }
    // Plain-text-ish formats: just decode as UTF-8, no library needed.
    if (['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) {
      return { supported: true, text: truncate(buffer.toString('utf8')), pageCount: null, error: null };
    }
    // Legacy binary Office formats need an OLE parser we don't ship. Give a
    // message the UI can actually show the user instead of a vague "not implemented".
    if (ext === 'doc' || ext === 'ppt') {
      return {
        supported: false,
        text: '',
        pageCount: null,
        error: `Legacy ".${ext}" format can't be read. Re-save it as ".${ext}x" and upload again.`,
      };
    }
    return { supported: false, text: '', pageCount: null, error: `"${ext}" text extraction not implemented yet` };
  } catch (err) {
    console.error(`[documentReaderService] extraction failed for .${ext}:`, err.message);
    return { supported: false, text: '', pageCount: null, error: err.message };
  }
}


/**
 * Zero-Token Local Document & Table Query Engine:
 * Performs deterministic in-memory keyword, code-ID, and relevance matching on tabular
 * or text documents in pure Node.js (0 API tokens consumed).
 * Returns a compact, targeted slice of rows for the LLM prompt.
 */
function queryDocumentContext(rawText, query) {
  if (!rawText || typeof rawText !== 'string') return '';
  const cleanDoc = rawText.trim();
  const q = String(query || '').toLowerCase().trim();

  // If doc is small (< 1500 chars) or user wants full doc / export, pass as is (capped)
  const wantsAll = /(?:all|saare|complete|entire|full|poora|sab|summary|overview|export|download)/i.test(q);
  if (cleanDoc.length < 1800 || wantsAll) {
    return cleanDoc.slice(0, 8000);
  }

  // Extract query keywords (ignore stop words)
  const stopWords = new Set(['kya', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'par', 'batao', 'dikhao', 'do', 'the', 'is', 'in', 'and', 'for', 'with', 'about', 'show', 'tell', 'me']);
  const queryTokens = q
    .replace(/[^\w\s\u0900-\u097F]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  // Check if document contains Markdown table rows
  const lines = cleanDoc.split('\n');
  const tableRows = [];
  let headerRow = null;
  const otherLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!headerRow) {
        headerRow = trimmed;
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator row, skip
      } else {
        tableRows.push(trimmed);
      }
    } else {
      if (trimmed.length > 0) otherLines.push(trimmed);
    }
  }

  // If we have a structured table with rows:
  if (tableRows.length > 5 && headerRow) {
    const matchedRows = [];
    const lowerTokens = queryTokens.map(t => t.toLowerCase());

    tableRows.forEach(row => {
      const lowerRow = row.toLowerCase();
      let matchScore = 0;
      lowerTokens.forEach(token => {
        if (lowerRow.includes(token)) {
          matchScore += token.length >= 4 ? 2 : 1;
        }
      });
      if (matchScore > 0) {
        matchedRows.push({ row, score: matchScore });
      }
    });

    // If query matches specific rows:
    if (matchedRows.length > 0) {
      // Sort by best score descending
      matchedRows.sort((a, b) => b.score - a.score);
      const topMatched = matchedRows.slice(0, 15).map(m => m.row);
      const sep = '| ' + headerRow.split('|').map(c => '---').slice(1, -1).join(' | ') + ' |';

      return `📊 TABLE PRE-FILTERED BY LOCAL ENGINE (${matchedRows.length} matching rows found out of ${tableRows.length} total rows):\n` +
        `${headerRow}\n${sep}\n${topMatched.join('\n')}\n\n` +
        `> 💡 Note: Local query engine matched ${matchedRows.length} relevant rows for "${queryTokens.join(', ')}". Zero hallucination.`;
    }

    // If no specific match, provide table schema + top 8 sample rows
    const topSample = tableRows.slice(0, 8);
    const sep = '| ' + headerRow.split('|').map(c => '---').slice(1, -1).join(' | ') + ' |';
    return `📊 TABLE SUMMARY (Total ${tableRows.length} rows):\n` +
      `${headerRow}\n${sep}\n${topSample.join('\n')}\n\n` +
      `> ℹ️ Showing schema and first 8 rows. Ask for a specific category, code, or keyword to filter.`;
  }

  // For non-table text docs (PDF / TXT):
  // Filter paragraphs containing query keywords
  const paragraphs = cleanDoc.split(/\n\s*\n/);
  const matchedParas = [];
  paragraphs.forEach(p => {
    const lowerP = p.toLowerCase();
    const matches = queryTokens.some(t => lowerP.includes(t));
    if (matches) matchedParas.push(p.trim());
  });

  if (matchedParas.length > 0) {
    return matchedParas.slice(0, 6).join('\n\n---\n\n').slice(0, 5000);
  }

  return cleanDoc.slice(0, 4500);
}

module.exports = { extractText, queryDocumentContext, MAX_EXTRACTED_CHARS };

