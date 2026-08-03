const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const fileService = require('../services/fileService');

// Allowed upload extensions (matches the frontend accept list).
const ALLOWED_EXTENSIONS = new Set([
  'png','jpg','jpeg','gif','webp','svg','bmp','ico',
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

module.exports = router;
