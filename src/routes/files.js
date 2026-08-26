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
    const err = new Error(`File type ".${ext || 'unknown'}" is not allowed.`);
    err.code = 'UNSUPPORTED_FILE_TYPE';
    return cb(err);
  }
  cb(null, true);
}

// Keep uploads in memory (not disk) — we stream straight to Cloudinary.
// 4MB cap keeps uploads compatible with Vercel serverless body limit.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * BUGFIX: multer reports rejections (bad extension from fileFilter above, or
 * LIMIT_FILE_SIZE) by calling next(err) — which SKIPS the route handler's
 * try/catch entirely and falls through to the generic app-level handler in
 * server.js, so the client got `500 {"error":"Internal server error"}` and the
 * carefully-worded reason above was thrown away.
 *
 * Wrapping upload.single() lets us turn those into the correct 4xx with the
 * real reason, which is what the UI needs in order to tell the user anything
 * useful.
 */
function uploadSingleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File is too large. Maximum upload size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`,
      });
    }
    if (err.code === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(415).json({ error: err.message });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Upload one file at a time, using the field name "file".' });
    }
    console.error('[files/upload] multer error:', err.code || '-', err.message);
    return res.status(400).json({ error: err.message || 'Upload rejected' });
  });
}

// POST /api/files/upload  (multipart/form-data, field name "file")
router.post('/upload', requireAuth, uploadSingleFile, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided (field name must be "file")' });
  try {
    const record = await fileService.uploadFile(req.userId, req.file);
    res.json({ file: record });
  } catch (err) {
    console.error('[files/upload] error:', err.message);
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

// Helper map for clean MIME types.
//
// This must cover every entry in ALLOWED_EXTENSIONS. Anything missing here fell
// through to 'application/octet-stream', which makes the browser DOWNLOAD the
// file on /view instead of rendering it — so ~30 allowed extensions (all the
// code/config/media ones) could never actually be previewed in a tab.
//
// 'svg' is deliberately ABSENT: it is not in ALLOWED_EXTENSIONS (see the note
// there about stored XSS), and leaving a mapping behind meant that if svg were
// ever re-allowed it would immediately be served as image/svg+xml with
// `Content-Disposition: inline` — i.e. exactly the vector that comment warns
// about. No mapping = octet-stream = harmless download.
const CODE_TEXT = 'text/plain; charset=utf-8';
const MIME_MAP = {
  pdf: 'application/pdf',
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  // documents / data
  txt: CODE_TEXT,
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: CODE_TEXT,
  yml: CODE_TEXT,
  toml: CODE_TEXT,
  // audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  // video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  // office
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  // web — note html/htm/vue are served as text/plain on purpose. Serving
  // attacker-controlled HTML inline from our own origin is stored XSS; the user
  // wants to READ the file, and text/plain shows it verbatim and inert.
  html: CODE_TEXT,
  htm: CODE_TEXT,
  vue: CODE_TEXT,
  css: 'text/css; charset=utf-8',
  js: CODE_TEXT,
  ts: CODE_TEXT,
  jsx: CODE_TEXT,
  tsx: CODE_TEXT,
  // source code — all plain text so they render in a tab instead of downloading
  py: CODE_TEXT,
  cpp: CODE_TEXT,
  c: CODE_TEXT,
  java: CODE_TEXT,
  cs: CODE_TEXT,
  go: CODE_TEXT,
  rs: CODE_TEXT,
  php: CODE_TEXT,
  swift: CODE_TEXT,
  kt: CODE_TEXT,
  sql: CODE_TEXT,
  sh: CODE_TEXT,
  bash: CODE_TEXT,
  rb: CODE_TEXT,
  r: CODE_TEXT,
  m: CODE_TEXT,
  pl: CODE_TEXT,
  lua: CODE_TEXT,
};

// GET /api/files/:id/view  (Streams file with inline disposition so browser renders it natively)
router.get('/:id/view', requireAuth, async (req, res) => {
  try {
    const file = await fileService.getFile(req.userId, req.params.id);
    if (!file || !file.url) return res.status(404).send('File not found');

    const ext = (path.extname(file.originalName || '').slice(1) || '').toLowerCase();
    const contentType = MIME_MAP[ext] || file.mimeType || 'application/octet-stream';

    const response = await fetch(file.url);
    // BUGFIX: this used to be `return res.redirect(file.url)`. That threw away
    // every header we set below (so the browser got Cloudinary's own
    // octet-stream + no filename, because our public_ids have no extension) AND
    // leaked the permanent public storage URL to the user. If the origin fetch
    // failed, the honest answer is an error.
    if (!response.ok) {
      console.error(`[files/view] upstream fetch failed for ${req.params.id}: HTTP ${response.status}`);
      return res.status(502).send('Stored file is currently unreachable. Please try again.');
    }

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
    // Same reasoning as /view above: never redirect to the raw storage URL.
    if (!response.ok) {
      console.error(`[files/download] upstream fetch failed for ${req.params.id}: HTTP ${response.status}`);
      return res.status(502).send('Stored file is currently unreachable. Please try again.');
    }

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
    // fileService now refuses to delete the DB pointer when the stored asset
    // survives, so the record is still there and the user can retry. 502 =
    // upstream storage problem, not the client's fault.
    if (err.code === 'ASSET_DELETE_FAILED') {
      return res.status(502).json({ error: err.message });
    }
    console.error('[files/delete] error:', err.message);
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
