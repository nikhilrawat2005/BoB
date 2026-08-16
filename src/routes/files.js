const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const fileService = require('../services/fileService');
const documentGenerator = require('../services/documentGenerator');

// Allowed upload extensions (matches the frontend accept list).
// FIX (#6): 'svg' intentionally removed. SVG files can embed <script> tags /
// event handlers, and uploads here go straight to Cloudinary and come back
// as a browser-openable URL — if one of those URLs is ever opened directly
// or embedded, an SVG upload is effectively a stored-XSS vector. Every other
// image format here is not script-capable, so this only removes the one
// risky type. If SVG support is needed later, sanitize server-side first
// (e.g. run it through a library like DOMPurify/svgo to strip scripts and
// event handlers before uploading) rather than re-adding it as-is.
const ALLOWED_EXTENSIONS = new Set([
  'png','jpg','jpeg','gif','webp','bmp','ico',
  'mp3','wav','ogg','m4a','aac',
  'mp4','webm','mov','mkv','m4v',
  'pdf','doc','docx','xls','xlsx','ppt','pptx','csv','tsv','txt','md','json','xml','yaml','yml','toml',
  'py','js','ts','jsx','tsx','cpp','c','java','cs','go','rs','php','swift','kt','sql','sh','bash','css','html','htm','vue','rb','r','m','pl','lua'
]);

function fileFilter(req, file, cb) {
  const ext = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type ".${ext || 'unknown'}" is not allowed.`));
  }
  cb(null, true);
}

// Keep uploads in memory (not disk) — we stream straight to Cloudinary.
// 4MB cap keeps uploads compatible with Vercel serverless body limit.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});

// POST /api/files/upload  (multipart/form-data, field name "file")
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided (field name must be "file")' });
  try {
    const record = await fileService.uploadFile(req.userId, req.file);
    res.json({ file: record });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

// Helper map for clean MIME types
const MIME_MAP = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
};

// GET /api/files/:id/view  (Streams file with inline disposition so browser renders it natively)
router.get('/:id/view', requireAuth, async (req, res) => {
  try {
    const file = await fileService.getFile(req.userId, req.params.id);
    if (!file || !file.url) return res.status(404).send('File not found');

    const ext = (path.extname(file.originalName || '').slice(1) || '').toLowerCase();
    const contentType = MIME_MAP[ext] || file.mimeType || 'application/octet-stream';

    const response = await fetch(file.url);
    if (!response.ok) return res.redirect(file.url);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName || 'file')}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[files/view] error:', err.message);
    res.status(500).send('Error viewing file: ' + err.message);
  }
});

// GET /api/files/:id/download (Streams file with attachment disposition to force download)
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const file = await fileService.getFile(req.userId, req.params.id);
    if (!file || !file.url) return res.status(404).send('File not found');

    const ext = (path.extname(file.originalName || '').slice(1) || '').toLowerCase();
    const contentType = MIME_MAP[ext] || file.mimeType || 'application/octet-stream';

    const response = await fetch(file.url);
    if (!response.ok) return res.redirect(file.url);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName || 'download')}"`);

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[files/download] error:', err.message);
    res.status(500).send('Error downloading file: ' + err.message);
  }
});

// GET /api/files
router.get('/', requireAuth, async (req, res) => {
  try {
    const files = await fileService.listFiles(req.userId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/files/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await fileService.deleteFile(req.userId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'File not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/generate  { format: 'xlsx'|'docx'|'pdf'|'pptx', filename, spec }
// Turns an LLM-authored JSON spec into a REAL binary file (via documentGenerator),
// uploads it, and returns a real downloadable URL. This is the route that fixes
// the old "text pretending to be a .docx/.xlsx" problem — nothing here writes
// file bytes by hand; ExcelJS/docx/pdfkit/pptxgenjs do that.
router.post('/generate', requireAuth, async (req, res) => {
  const { format, filename, spec } = req.body || {};

  if (!format || !documentGenerator.SUPPORTED_FORMATS.includes(format)) {
    return res.status(400).json({
      error: `"format" must be one of: ${documentGenerator.SUPPORTED_FORMATS.join(', ')}`,
    });
  }
  if (!spec || typeof spec !== 'object') {
    return res.status(400).json({ error: '"spec" (object) is required' });
  }
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: '"filename" (string) is required' });
  }

  try {
    const buffer = await documentGenerator.generate(format, spec);
    const mimeType = documentGenerator.MIME_TYPES[format];
    const saved = await fileService.saveGeneratedFile(req.userId, buffer, filename, mimeType);
    res.json({ file: saved });
  } catch (err) {
    console.error('[files/generate] error:', err.message);
    // Spec-shape problems (thrown by documentGenerator's own validation) are
    // the caller's fault (400); anything else is a server-side failure (500).
    const isSpecError = /spec requires|Unsupported format/.test(err.message);
    res.status(isSpecError ? 400 : 500).json({ error: err.message });
  }
});

module.exports = router;
