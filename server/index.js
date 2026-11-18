import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4123);
const AUTH_TOKEN = process.env.KOMOLIB_TOKEN || '';

const STORAGE_DIR = path.join(__dirname, 'storage');
const FILES_DIR = path.join(STORAGE_DIR, 'files');
const STATE_FILE = path.join(STORAGE_DIR, 'state.json');

fs.mkdirSync(FILES_DIR, { recursive: true });

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      updatedAt: 0,
      books: {},
      bookmarks: [],
      notes: [],
      categories: null,
      theme: null,
      profile: null,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      updatedAt: 0,
      books: {},
      bookmarks: [],
      notes: [],
      categories: null,
      theme: null,
      profile: null,
    };
  }
}

function writeState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Optional bearer token middleware
app.use('/api', (req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.path === '/health') return next();
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${AUTH_TOKEN}`) return next();
  return res.status(401).json({ error: 'Token inválido o faltante' });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (req, file, cb) => {
      const safeId = (req.body.id || `book_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
      const ext = path.extname(file.originalname || '').slice(0, 12);
      cb(null, `${safeId}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max per volume
});

app.get('/api/health', (_req, res) => {
  const state = readState();
  res.json({
    ok: true,
    service: 'KomoLib Sync Server',
    version: '1.0.0',
    booksCount: Object.keys(state.books || {}).length,
    updatedAt: state.updatedAt || 0,
    authRequired: Boolean(AUTH_TOKEN),
  });
});

app.get('/api/sync/state', (_req, res) => {
  const state = readState();
  res.json(state);
});

app.put('/api/sync/state', (req, res) => {
  const incoming = req.body || {};
  const current = readState();

  // Merge books by updatedAt so newer edits/progress always win
  const mergedBooks = { ...(current.books || {}) };
  if (incoming.books && typeof incoming.books === 'object') {
    for (const [id, book] of Object.entries(incoming.books)) {
      const prev = mergedBooks[id];
      if (!prev || (book.updatedAt || 0) >= (prev.updatedAt || 0)) {
        mergedBooks[id] = {
          ...prev,
          ...book,
          hasRemoteFile: prev?.hasRemoteFile || book.hasRemoteFile || false,
          remoteFileName: prev?.remoteFileName || book.remoteFileName,
        };
      }
    }
  }

  // Handle deleted IDs explicitly
  if (Array.isArray(incoming.deletedBookIds)) {
    for (const id of incoming.deletedBookIds) {
      const entry = mergedBooks[id];
      if (entry?.remoteFileName) {
        const target = path.join(FILES_DIR, path.basename(entry.remoteFileName));
        if (fs.existsSync(target)) {
          try { fs.unlinkSync(target); } catch { /* ignore */ }
        }
      }
      delete mergedBooks[id];
    }
  }

  // Merge bookmarks & notes by id
  const mergeById = (a = [], b = []) => {
    const map = new Map();
    for (const item of a) map.set(item.id, item);
    for (const item of b) {
      const prev = map.get(item.id);
      if (!prev || (item.updatedAt || item.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  };

  const nextState = {
    updatedAt: Date.now(),
    books: mergedBooks,
    bookmarks: incoming.bookmarks ? mergeById(current.bookmarks, incoming.bookmarks) : current.bookmarks,
    notes: incoming.notes ? mergeById(current.notes, incoming.notes) : current.notes,
    categories: incoming.categories || current.categories,
    theme: incoming.theme || current.theme,
    profile: incoming.profile || current.profile,
  };

  writeState(nextState);
  res.json(nextState);
});

app.post('/api/books/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Archivo faltante' });
  }
  const id = (req.body.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) {
    return res.status(400).json({ error: 'ID de libro faltante' });
  }

  const state = readState();
  let meta = {};
  if (req.body.meta) {
    try { meta = JSON.parse(req.body.meta); } catch { /* ignore */ }
  }

  state.books[id] = {
    ...(state.books[id] || {}),
    ...meta,
    id,
    hasRemoteFile: true,
    remoteFileName: req.file.filename,
    fileSize: req.file.size,
    updatedAt: Date.now(),
  };
  state.updatedAt = Date.now();
  writeState(state);

  res.json({
    ok: true,
    id,
    remoteFileName: req.file.filename,
    fileSize: req.file.size,
  });
});

app.get('/api/books/:id/file', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const state = readState();
  const entry = state.books?.[id];
  if (!entry || !entry.remoteFileName) {
    return res.status(404).json({ error: 'Archivo no encontrado en el servidor' });
  }
  const filePath = path.join(FILES_DIR, path.basename(entry.remoteFileName));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo ausente en disco' });
  }
  res.sendFile(filePath);
});

app.delete('/api/books/:id', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const state = readState();
  const entry = state.books?.[id];
  if (entry?.remoteFileName) {
    const filePath = path.join(FILES_DIR, path.basename(entry.remoteFileName));
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
  if (state.books) {
    delete state.books[id];
  }
  state.updatedAt = Date.now();
  writeState(state);
  res.json({ ok: true });
});

// Serve built web app if dist/ exists
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📚 KomoLib Sync Server escuchando en http://0.0.0.0:${PORT}`);
});
