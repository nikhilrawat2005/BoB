const ExcelJS = require('exceljs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, ShadingType, AlignmentType, LevelFormat,
} = require('docx');
const PDFDocument = require('pdfkit');
const PptxGenJS = require('pptxgenjs');

/**
 * documentGenerator.js
 * ─────────────────────────────────────────────────────────
 * Turns a small, LLM-authored JSON "spec" into a REAL binary
 * file (Buffer) using proper libraries — never text-as-bytes.
 *
 * Every function here is pure: no Firestore, no Cloudinary,
 * no req/res. Just spec-in, Buffer-out. This keeps it testable
 * in isolation and reusable from any route.
 *
 * Spec shapes (what the LLM is asked to produce — see chat.js):
 *
 *  xlsx: { format:'xlsx', filename, sheets:[{ name, headers:[...], rows:[[...]] }] }
 *  docx: { format:'docx', filename, blocks:[
 *           {type:'heading', text, level?}, {type:'paragraph', text},
 *           {type:'bullets', items:[...]}, {type:'table', headers:[...], rows:[[...]]}
 *         ] }
 *  pdf:  { format:'pdf', filename, title, sections:[{ heading, body }] }
 *  pptx: { format:'pptx', filename, slides:[{ title, bullets:[...] }] }
 */

// ───────────────────────── XLSX ─────────────────────────
async function generateXlsx(spec) {
  if (!spec || !Array.isArray(spec.sheets) || !spec.sheets.length) {
    throw new Error('xlsx spec requires a non-empty "sheets" array');
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bob';
  wb.created = new Date();

  for (const s of spec.sheets) {
    const sheetName = String(s.name || 'Sheet1').slice(0, 31); // Excel sheet-name limit
    const ws = wb.addWorksheet(sheetName);

    const headers = Array.isArray(s.headers) ? s.headers : [];
    const rows = Array.isArray(s.rows) ? s.rows : [];

    if (headers.length) {
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      });
    }

    rows.forEach((r) => ws.addRow(r));

    // Reasonable auto column width based on content length
    ws.columns.forEach((col, i) => {
      let maxLen = String(headers[i] || '').length;
      rows.forEach((r) => {
        const val = r[i] == null ? '' : String(r[i]);
        if (val.length > maxLen) maxLen = val.length;
      });
      col.width = Math.min(Math.max(maxLen + 2, 10), 60);
    });

    if (headers.length && rows.length) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
  }

  return wb.xlsx.writeBuffer();
}

// ───────────────────────── DOCX ─────────────────────────
function buildDocxTable(block) {
  const headers = Array.isArray(block.headers) ? block.headers : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const colCount = headers.length || (rows[0] ? rows[0].length : 1);
  const colWidth = Math.floor(9000 / colCount);
  const widths = new Array(colCount).fill(colWidth);

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          width: { size: colWidth, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: '1F3864' },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: String(h), bold: true, color: 'FFFFFF' })] })],
        })
    ),
  });

  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.map(
          (c) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: String(c) })] })],
            })
        ),
      })
  );

  return new Table({
    width: { size: colWidth * colCount, type: WidthType.DXA },
    columnWidths: widths,
    rows: headers.length ? [headerRow, ...bodyRows] : bodyRows,
  });
}

async function generateDocx(spec) {
  if (!spec || !Array.isArray(spec.blocks) || !spec.blocks.length) {
    throw new Error('docx spec requires a non-empty "blocks" array');
  }

  const children = [];

  if (spec.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: String(spec.title), bold: true })],
      })
    );
  }

  for (const block of spec.blocks) {
    switch (block.type) {
      case 'heading': {
        const level = block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1;
        children.push(new Paragraph({ heading: level, children: [new TextRun({ text: String(block.text || ''), bold: true })] }));
        break;
      }
      case 'paragraph': {
        children.push(new Paragraph({ children: [new TextRun(String(block.text || ''))] }));
        break;
      }
      case 'bullets': {
        const items = Array.isArray(block.items) ? block.items : [];
        items.forEach((item) => {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun(String(item))],
            })
          );
        });
        break;
      }
      case 'table': {
        children.push(buildDocxTable(block));
        children.push(new Paragraph({ children: [] })); // spacing after table
        break;
      }
      default: {
        // Unknown block types are skipped rather than corrupting the document
        console.warn(`[documentGenerator] Unknown docx block type: ${block.type}`);
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }],
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

// ───────────────────────── PDF ─────────────────────────
async function generatePdf(spec) {
  if (!spec || !Array.isArray(spec.sections)) {
    throw new Error('pdf spec requires a "sections" array');
  }

  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ margin: 50 });
      const chunks = [];
      pdf.on('data', (c) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      if (spec.title) {
        pdf.fontSize(20).text(String(spec.title), { underline: true });
        pdf.moveDown();
      }

      spec.sections.forEach((sec) => {
        if (sec.heading) {
          pdf.fontSize(14).text(String(sec.heading), { continued: false });
          pdf.moveDown(0.3);
        }
        if (sec.body) {
          pdf.fontSize(11).text(String(sec.body));
          pdf.moveDown();
        }
      });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ───────────────────────── PPTX ─────────────────────────
async function generatePptx(spec) {
  if (!spec || !Array.isArray(spec.slides) || !spec.slides.length) {
    throw new Error('pptx spec requires a non-empty "slides" array');
  }

  const pptx = new PptxGenJS();

  spec.slides.forEach((s) => {
    const slide = pptx.addSlide();
    if (s.title) {
      slide.addText(String(s.title), { x: 0.5, y: 0.3, w: 9, fontSize: 24, bold: true, color: '1F3864' });
    }
    if (Array.isArray(s.bullets) && s.bullets.length) {
      slide.addText(
        s.bullets.map((b) => ({ text: String(b), options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 16, color: '333333' }
      );
    }
  });

  return pptx.write('nodebuffer');
}

const SUPPORTED_FORMATS = ['xlsx', 'docx', 'pdf', 'pptx'];

const MIME_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

async function generate(format, spec) {
  switch (format) {
    case 'xlsx':
      return generateXlsx(spec);
    case 'docx':
      return generateDocx(spec);
    case 'pdf':
      return generatePdf(spec);
    case 'pptx':
      return generatePptx(spec);
    default:
      throw new Error(`Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
  }
}

module.exports = {
  generateXlsx,
  generateDocx,
  generatePdf,
  generatePptx,
  generate,
  SUPPORTED_FORMATS,
  MIME_TYPES,
};
