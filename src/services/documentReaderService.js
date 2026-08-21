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
 * Supported: .pdf, .docx (.doc is NOT supported — mammoth only
 * reads the modern .docx XML format).
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

async function extractFromPdf(buffer) {
  const data = await pdfParse(buffer);
  return { text: truncate(data.text), pageCount: data.numpages || null };
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
    // Plain-text-ish formats: just decode as UTF-8, no library needed.
    if (['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) {
      return { supported: true, text: truncate(buffer.toString('utf8')), pageCount: null, error: null };
    }
    return { supported: false, text: '', pageCount: null, error: `"${ext}" text extraction not implemented yet` };
  } catch (err) {
    console.error(`[documentReaderService] extraction failed for .${ext}:`, err.message);
    return { supported: false, text: '', pageCount: null, error: err.message };
  }
}


module.exports = { extractText, MAX_EXTRACTED_CHARS };
