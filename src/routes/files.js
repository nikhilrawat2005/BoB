const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const fileService = require('../services/fileService');

// Keep uploads in memory (not disk) — we stream straight to Cloudinary.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB cap

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

module.exports = router;
