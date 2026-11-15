import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { UPLOAD_DIR } from '../config.js';
import { get, run } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { fileExt, nowIso, randomToken } from '../lib/util.js';

const router = Router();

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = fileExt(file.originalname);
    cb(null, `${Date.now()}-${randomToken(10)}${ext || '.bin'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Upload a JPG, PNG, WEBP image or PDF file.'));
    }
    cb(null, true);
  },
});

router.post('/uploads', requireAuth, (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum size is 6MB.'
        : error.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });

    let purpose = 'card';
    if (req.body?.purpose === 'proof') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      purpose = 'proof';
    }

    const result = run(
      'INSERT INTO uploads (user_id, original_name, stored_name, mime, size, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.user.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, purpose, nowIso(),
    );
    res.status(201).json({
      file: {
        id: result.id,
        name: req.file.originalname,
        mime: req.file.mimetype,
        size: req.file.size,
        url: `/api/files/${result.id}`,
      },
    });
  });
});

router.get('/files/:id', requireAuth, (req, res) => {
  const file = get('SELECT * FROM uploads WHERE id = ?', Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'File not found.' });
  if (file.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not have access to this file.' });
  }
  const fullPath = path.join(UPLOAD_DIR, path.basename(file.stored_name));
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'File is no longer available.' });

  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name || 'file')}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  createReadStream(fullPath).pipe(res);
});

export default router;
