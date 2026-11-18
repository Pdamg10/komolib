import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env files (repo root and server/) without external dependencies
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 4123);
const AUTH_TOKEN = process.env.KOMOLIB_TOKEN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
let runtimePublicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');

// Managed Cloudflare Quick Tunnel state (optional, for instant Internet sharing)
let tunnelProc = null;
let activeTunnelUrl = '';
let tunnelStarting = false;
let tunnelError = '';

function findCloudflaredBinary() {
  const candidates = [
    process.env.CLOUDFLARED_PATH || '',
    '/tmp/cloudflared',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
    path.join(os.homedir(), '.local', 'bin', 'cloudflared'),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      }
    } catch {
      // keep searching
    }
  }

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(cmd, ['cloudflared'], { encoding: 'utf8', timeout: 2000 });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) return first;
    }
  } catch {
    // ignore
  }
  return '';
}

function stopQuickTunnel() {
  if (tunnelProc) {
    try {
      tunnelProc.kill('SIGTERM');
    } catch {
      // ignore
    }
    tunnelProc = null;
  }
  activeTunnelUrl = '';
  tunnelStarting = false;
}

function startQuickTunnel() {
  return new Promise((resolve, reject) => {
    if (activeTunnelUrl && tunnelProc && !tunnelProc.killed) {
      resolve(activeTunnelUrl);
      return;
    }
    const bin = findCloudflaredBinary();
    if (!bin) {
      reject(
        new Error(
          'cloudflared no está instalado. Instálalo o ejecuta tu propio túnel (Cloudflare, ngrok, Tailscale, VPS) y pega la URL pública.'
        )
      );
      return;
    }

    stopQuickTunnel();
    tunnelStarting = true;
    tunnelError = '';

    const child = spawn(
      bin,
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    tunnelProc = child;

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        tunnelStarting = false;
        tunnelError = 'Tiempo de espera agotado al crear el túnel Cloudflare';
        stopQuickTunnel();
        reject(new Error(tunnelError));
      }
    }, 22000);

    const handleChunk = (buf) => {
      const text = buf.toString('utf8');
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        activeTunnelUrl = match[0].replace(/\/+$/, '');
        tunnelStarting = false;
        tunnelError = '';
        console.log(`🌐 Túnel Internet KomoLib activo: ${activeTunnelUrl}`);
        resolve(activeTunnelUrl);
      }
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        tunnelStarting = false;
        tunnelError = err.message;
        tunnelProc = null;
        reject(err);
      }
    });
    child.on('exit', () => {
      if (tunnelProc === child) {
        tunnelProc = null;
        activeTunnelUrl = '';
        tunnelStarting = false;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        tunnelError = 'El proceso de cloudflared se cerró inesperadamente';
        reject(new Error(tunnelError));
      }
    });
  });
}

process.on('exit', stopQuickTunnel);
process.on('SIGINT', () => {
  stopQuickTunnel();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopQuickTunnel();
  process.exit(0);
});

function getEffectivePublicUrl(req) {
  if (activeTunnelUrl) return activeTunnelUrl;
  if (runtimePublicUrl) return runtimePublicUrl;
  if (req) {
    const fwdHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const fwdProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    if (fwdHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(fwdHost)) {
      return `${fwdProto}://${fwdHost}`.replace(/\/+$/, '');
    }
  }
  return '';
}

function isLocalOrLanRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

const STORAGE_DIR = process.env.KOMOLIB_STORAGE_DIR
  ? path.resolve(process.env.KOMOLIB_STORAGE_DIR)
  : path.join(__dirname, 'storage');
const SPACES_DIR = path.join(STORAGE_DIR, 'spaces');
const FILES_DIR = path.join(STORAGE_DIR, 'files');
const INBOX_DIR = path.join(STORAGE_DIR, 'inbox');
const STATE_FILE = path.join(STORAGE_DIR, 'state.json');
const INBOX_FILE = path.join(STORAGE_DIR, 'inbox.json');
const ROOMS_FILE = path.join(STORAGE_DIR, 'rooms.json');
const SHELVES_FILE = path.join(STORAGE_DIR, 'shelves.json');

fs.mkdirSync(SPACES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(INBOX_DIR, { recursive: true });

function normalizeSpaceId(raw) {
  const clean = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return clean.length >= 4 ? clean : 'default';
}

function getRequestSpaceId(req) {
  const fromHeader = req?.headers?.['x-komolib-space'];
  const fromQuery = typeof req?.query?.space === 'string' ? req.query.space : '';
  const fromBody = typeof req?.body?.spaceId === 'string' ? req.body.spaceId : '';
  return normalizeSpaceId(fromHeader || fromQuery || fromBody || 'default');
}

function getSpaceStateFile(spaceId = 'default') {
  const id = normalizeSpaceId(spaceId);
  if (id === 'default') return STATE_FILE;
  const dir = path.join(SPACES_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'state.json');
}

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  ips.sort((a, b) => {
    const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
    return score(a) - score(b);
  });
  return ips;
}

function emptyState() {
  return {
    updatedAt: 0,
    books: {},
    bookmarks: [],
    annotations: [],
    notes: [],
    customBookmarkDesigns: [],
    categories: null,
    theme: null,
    profile: null,
    deletedBookIds: [],
    deletedBookmarkIds: [],
    deletedAnnotationIds: [],
    deletedNoteIds: [],
    deletedBookmarkDesignIds: [],
  };
}

function readState(spaceId = 'default') {
  const targetFile = getSpaceStateFile(spaceId);
  if (!fs.existsSync(targetFile)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    return {
      ...emptyState(),
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return emptyState();
  }
}

function writeState(state, spaceId = 'default') {
  const targetFile = getSpaceStateFile(spaceId);
  const tmp = `${targetFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, targetFile);
}

function readInbox() {
  if (!fs.existsSync(INBOX_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeInbox(items) {
  const tmp = `${INBOX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(tmp, INBOX_FILE);
}

function readRooms() {
  if (!fs.existsSync(ROOMS_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRooms(rooms) {
  const tmp = `${ROOMS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rooms, null, 2), 'utf8');
  fs.renameSync(tmp, ROOMS_FILE);
}

function readShelves() {
  if (!fs.existsSync(SHELVES_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SHELVES_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeShelves(shelves) {
  const tmp = `${SHELVES_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(shelves, null, 2), 'utf8');
  fs.renameSync(tmp, SHELVES_FILE);
}

function normalizeRoomCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 16);
}

function generateCode(existing, prefix = 'KOMO') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 20; tries++) {
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const code = `${prefix}-${suffix}`;
    if (!existing[code]) return code;
  }
  return `${prefix}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function generateRoomCode(existing) {
  return generateCode(existing, 'KOMO');
}

// SSE Live Broadcast Hubs (strictly isolated per spaceId / room / shelf!)
const syncSseClients = new Map(); // spaceId -> Set<res>
const roomSseClients = new Map(); // code -> Set<res>
const shelfSseClients = new Map(); // code -> Set<res>

function setupSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  try {
    res.write('retry: 3000\n\n');
  } catch {
    // ignore
  }
}

function sendSseEvent(res, event, payload) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // ignore broken pipe
  }
}

function broadcastSyncUpdate(sourceDeviceId, updatedAt, spaceId = 'default') {
  const clients = syncSseClients.get(normalizeSpaceId(spaceId));
  if (!clients) return;
  for (const res of clients) {
    sendSseEvent(res, 'sync_update', { sourceDeviceId: sourceDeviceId || '', updatedAt });
  }
}

function broadcastRoomUpdate(code, room) {
  const clients = roomSseClients.get(code);
  if (!clients) return;
  for (const res of clients) {
    sendSseEvent(res, 'room_update', room);
  }
}

function broadcastRoomDeleted(code) {
  const clients = roomSseClients.get(code);
  if (!clients) return;
  for (const res of clients) {
    sendSseEvent(res, 'room_deleted', { code });
  }
}

function broadcastShelfUpdate(code, shelf) {
  const clients = shelfSseClients.get(code);
  if (!clients) return;
  for (const res of clients) {
    sendSseEvent(res, 'shelf_update', shelf);
  }
}

function broadcastShelfDeleted(code) {
  const clients = shelfSseClients.get(code);
  if (!clients) return;
  for (const res of clients) {
    sendSseEvent(res, 'shelf_deleted', { code });
  }
}

setInterval(() => {
  for (const clients of syncSseClients.values()) {
    for (const res of clients) {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }
  }
  for (const clients of roomSseClients.values()) {
    for (const res of clients) {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }
  }
  for (const clients of shelfSseClients.values()) {
    for (const res of clients) {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }
  }
}, 20000);

const app = express();
app.set('trust proxy', true);
app.use(
  cors({
    origin: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-KomoLib-Space',
      'ngrok-skip-browser-warning',
    ],
  })
);
app.use(express.json({ limit: '50mb' }));

// Optional bearer token middleware (also accepts ?token= for SSE & direct device uploads).
// Guest access to a specific Shared Reading Room or Shared Shelf by its exact code is allowed
// so friends can share/read books mutually without needing the host's private token or seeing private vaults.
app.use('/api', (req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.path === '/health' || req.path === '/network-info') return next();

  const isGuestRoomEndpoint =
    (req.method === 'GET' && /^\/rooms\/[A-Za-z0-9-]+$/.test(req.path)) ||
    /^\/rooms\/[A-Za-z0-9-]+\/(join|leave|progress|comments|file|stream)$/.test(req.path);
  if (isGuestRoomEndpoint) return next();

  const isGuestShelfEndpoint =
    (req.method === 'GET' && /^\/shelves\/[A-Za-z0-9-]+$/.test(req.path)) ||
    /^\/shelves\/[A-Za-z0-9-]+\/(join|leave|books|stream)(\/[^/]+(\/file)?)?$/.test(req.path);
  if (isGuestShelfEndpoint) return next();

  const auth = req.headers.authorization || '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  if (auth === `Bearer ${AUTH_TOKEN}` || queryToken === AUTH_TOKEN) return next();
  return res.status(401).json({ error: 'Token inválido o faltante' });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (req, file, cb) => {
      const space = getRequestSpaceId(req);
      const safeId = (req.body.id || `book_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
      const ext = path.extname(file.originalname || '').slice(0, 12);
      const prefix = space !== 'default' ? `${space}__` : '';
      cb(null, `${prefix}${safeId}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const inboxUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, INBOX_DIR),
    filename: (_req, file, cb) => {
      const uid = `inb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
      cb(null, `${uid}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 150 },
});

app.get('/api/health', (req, res) => {
  const state = readState();
  const inbox = readInbox();
  const rooms = readRooms();
  const lanIps = getLanIps();
  const lanUrls = lanIps.map((ip) => `http://${ip}:${PORT}`);
  const publicUrl = getEffectivePublicUrl(req);
  const uploadUrls = [
    ...(publicUrl ? [`${publicUrl}/upload`] : []),
    ...lanUrls.map((u) => `${u}/upload`),
  ];
  res.json({
    ok: true,
    service: 'KomoLib Sync Server',
    version: '1.4.0',
    booksCount: Object.keys(state.books || {}).length,
    inboxCount: inbox.length,
    roomsCount: Object.keys(rooms).length,
    updatedAt: state.updatedAt || 0,
    authRequired: Boolean(AUTH_TOKEN),
    aiConfigured: Boolean(GEMINI_API_KEY),
    aiModel: GEMINI_MODEL,
    publicUrl,
    tunnelUrl: activeTunnelUrl,
    tunnelRunning: Boolean(tunnelProc && !tunnelProc.killed && activeTunnelUrl),
    tunnelStarting,
    tunnelAvailable: Boolean(findCloudflaredBinary()),
    tunnelError,
    lanUrls,
    uploadUrls,
  });
});

/* -------- Gemini AI Reading Assistant Proxy -------- */

app.post('/api/ai/chat', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY no configurada en .env' });
  }

  const { message, history = [], books = [], notes = [], activeBook = null } = req.body || {};
  const userMessage = typeof message === 'string' ? message.trim() : '';
  if (!userMessage) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  const catalogSummary = Array.isArray(books) && books.length
    ? books
        .slice(0, 40)
        .map((b) => {
          const ratingTxt = b.rating ? `, calificación ${b.rating}/5` : '';
          const statusTxt = b.readingStatus ? `, estado ${b.readingStatus}` : '';
          const reviewTxt = b.review ? `, reseña: "${String(b.review).slice(0, 80)}"` : '';
          return `- "${b.title}" de ${b.author} (${b.kind}, ${b.format}, progreso ${b.progress || 0}%${statusTxt}${ratingTxt}${reviewTxt})`;
        })
        .join('\n')
    : 'La biblioteca está vacía todavía.';

  const notesSummary = Array.isArray(notes) && notes.length
    ? notes
        .slice(0, 10)
        .map((n) => `- ${n.bookTitle || 'Libro'}: ${String(n.text || '').slice(0, 120)}`)
        .join('\n')
    : 'Sin notas recientes.';

  const activeInfo = activeBook
    ? `\nLibro abierto actualmente: "${activeBook.title}" de ${activeBook.author} (${activeBook.progress || 0}%).`
    : '';

  const systemPrompt = `Eres el asistente literario inteligente de KomoLib. Responde siempre en español de forma cálida, útil y concisa.
Puedes recomendar lecturas, resumir ideas, sugerir libros de la estantería del usuario, ayudar con metas de lectura, reseñas o responder preguntas sobre libros, mangas y manhwas.
No inventes títulos que no existan si te preguntan específicamente qué hay en su biblioteca.${activeInfo}

Biblioteca actual del usuario:
${catalogSummary}

Notas recientes del usuario:
${notesSummary}`;

  const contents = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-10)) {
      if (!h || typeof h.text !== 'string' || !h.text.trim()) continue;
      contents.push({
        role: h.sender === 'user' ? 'user' : 'model',
        parts: [{ text: h.text.trim().slice(0, 1500) }],
      });
    }
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1200,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return res.status(response.status).json({
        error: `Error de Gemini (${response.status})`,
        detail: errText.slice(0, 300),
      });
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const reply =
      parts
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim() || 'Listo, pero no recibí texto del modelo.';

    // Detect books from the user's library mentioned in the reply or query
    const lowerCombined = `${userMessage} ${reply}`.toLowerCase();
    const matchedBookIds = Array.isArray(books)
      ? books
          .filter((b) => b?.id && b?.title && lowerCombined.includes(String(b.title).toLowerCase()))
          .slice(0, 4)
          .map((b) => b.id)
      : [];

    return res.json({
      ok: true,
      reply,
      model: GEMINI_MODEL,
      matchedBookIds,
    });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'No se pudo contactar a la API de IA',
    });
  }
});

app.get('/api/network-info', (req, res) => {
  const lanIps = getLanIps();
  const lanUrls = lanIps.map((ip) => `http://${ip}:${PORT}`);
  const publicUrl = getEffectivePublicUrl(req);
  res.json({
    port: PORT,
    lanIps,
    lanUrls,
    publicUrl,
    tunnelUrl: activeTunnelUrl,
    tunnelRunning: Boolean(tunnelProc && !tunnelProc.killed && activeTunnelUrl),
    tunnelStarting,
    tunnelAvailable: Boolean(findCloudflaredBinary()),
    uploadUrls: [
      ...(publicUrl ? [`${publicUrl}/upload`] : []),
      ...lanUrls.map((u) => `${u}/upload`),
    ],
    authRequired: Boolean(AUTH_TOKEN),
  });
});

app.put('/api/network/public-url', (req, res) => {
  if (!isLocalOrLanRequest(req) && !AUTH_TOKEN) {
    return res.status(403).json({ error: 'Solo editable desde la red local o con token' });
  }
  const raw = typeof req.body?.publicUrl === 'string' ? req.body.publicUrl.trim().replace(/\/+$/, '') : '';
  if (raw && !/^https?:\/\/.+/i.test(raw)) {
    return res.status(400).json({ error: 'La URL pública debe empezar con http:// o https://' });
  }
  runtimePublicUrl = raw;
  res.json({ ok: true, publicUrl: getEffectivePublicUrl(req) });
});

app.post('/api/network/tunnel/start', async (req, res) => {
  if (!isLocalOrLanRequest(req)) {
    return res.status(403).json({ error: 'El túnel solo puede iniciarse desde tu red local' });
  }
  try {
    const url = await startQuickTunnel();
    res.json({
      ok: true,
      tunnelUrl: url,
      publicUrl: getEffectivePublicUrl(req),
      tunnelRunning: true,
    });
  } catch (err) {
    res.status(503).json({
      error: err instanceof Error ? err.message : 'No se pudo iniciar el túnel de Internet',
    });
  }
});

app.post('/api/network/tunnel/stop', (req, res) => {
  if (!isLocalOrLanRequest(req)) {
    return res.status(403).json({ error: 'El túnel solo puede detenerse desde tu red local' });
  }
  stopQuickTunnel();
  res.json({
    ok: true,
    tunnelUrl: '',
    publicUrl: getEffectivePublicUrl(req),
    tunnelRunning: false,
  });
});

app.get('/api/sync/state', (req, res) => {
  const spaceId = getRequestSpaceId(req);
  const state = readState(spaceId);
  res.json(state);
});

app.get('/api/sync/stream', (req, res) => {
  const spaceId = getRequestSpaceId(req);
  setupSse(res);
  if (!syncSseClients.has(spaceId)) syncSseClients.set(spaceId, new Set());
  syncSseClients.get(spaceId).add(res);
  sendSseEvent(res, 'connected', { updatedAt: readState(spaceId).updatedAt || 0, spaceId });
  req.on('close', () => {
    const set = syncSseClients.get(spaceId);
    if (set) {
      set.delete(res);
      if (set.size === 0) syncSseClients.delete(spaceId);
    }
  });
});

app.put('/api/sync/state', (req, res) => {
  const spaceId = getRequestSpaceId(req);
  const incoming = req.body || {};
  const current = readState(spaceId);

  const mergeTombstones = (existing = [], added = []) => {
    const set = new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(added) ? added : [])]);
    return Array.from(set).slice(-500);
  };

  const deletedBookIds = mergeTombstones(current.deletedBookIds, incoming.deletedBookIds);
  const deletedBookmarkIds = mergeTombstones(current.deletedBookmarkIds, incoming.deletedBookmarkIds);
  const deletedAnnotationIds = mergeTombstones(
    current.deletedAnnotationIds,
    incoming.deletedAnnotationIds
  );
  const deletedNoteIds = mergeTombstones(current.deletedNoteIds, incoming.deletedNoteIds);
  const deletedBookmarkDesignIds = mergeTombstones(
    current.deletedBookmarkDesignIds,
    incoming.deletedBookmarkDesignIds
  );
  const incomingDeletedBooksSet = new Set(Array.isArray(incoming.deletedBookIds) ? incoming.deletedBookIds : []);
  const deletedBooksSet = new Set(deletedBookIds);
  const deletedBookmarksSet = new Set(deletedBookmarkIds);
  const deletedAnnotationsSet = new Set(deletedAnnotationIds);
  const deletedNotesSet = new Set(deletedNoteIds);
  const deletedBookmarkDesignsSet = new Set(deletedBookmarkDesignIds);

  const mergedBooks = { ...(current.books || {}) };
  if (incoming.books && typeof incoming.books === 'object') {
    for (const [id, book] of Object.entries(incoming.books)) {
      if (incomingDeletedBooksSet.has(id)) continue;
      if (deletedBooksSet.has(id) && !current.books?.[id]) {
        continue;
      }
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

  for (const id of incomingDeletedBooksSet) {
    const entry = mergedBooks[id];
    if (entry?.remoteFileName) {
      const target = path.join(FILES_DIR, path.basename(entry.remoteFileName));
      if (fs.existsSync(target)) {
        try { fs.unlinkSync(target); } catch { /* ignore */ }
      }
    }
    delete mergedBooks[id];
  }

  const mergeById = (a = [], b = [], deletedSet = new Set()) => {
    const map = new Map();
    for (const item of a) {
      if (item?.id && !deletedSet.has(item.id)) map.set(item.id, item);
    }
    for (const item of b) {
      if (!item?.id || deletedSet.has(item.id)) continue;
      const prev = map.get(item.id);
      if (!prev || (item.updatedAt || item.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  };

  // Merge active reading session by newest timestamp so Web <-> APK can resume seamlessly
  const incomingSession = incoming.lastActiveSession;
  const currentSession = current.lastActiveSession;
  const mergedSession =
    incomingSession && (!currentSession || (incomingSession.updatedAt || 0) >= (currentSession.updatedAt || 0))
      ? incomingSession
      : currentSession || null;

  const incomingThemeTs = Number(incoming.themeUpdatedAt || 0);
  const currentThemeTs = Number(current.themeUpdatedAt || 0);
  const useIncomingTheme = incoming.theme && (!current.theme || incomingThemeTs >= currentThemeTs);

  const incomingProfileTs = Number(incoming.profileUpdatedAt || 0);
  const currentProfileTs = Number(current.profileUpdatedAt || 0);
  const useIncomingProfile = incoming.profile && (!current.profile || incomingProfileTs >= currentProfileTs);

  const now = Date.now();
  const nextState = {
    updatedAt: now,
    books: mergedBooks,
    bookmarks: incoming.bookmarks
      ? mergeById(current.bookmarks, incoming.bookmarks, deletedBookmarksSet)
      : (current.bookmarks || []).filter((x) => !deletedBookmarksSet.has(x.id)),
    annotations: incoming.annotations
      ? mergeById(current.annotations, incoming.annotations, deletedAnnotationsSet)
      : (current.annotations || []).filter((x) => !deletedAnnotationsSet.has(x.id)),
    notes: incoming.notes
      ? mergeById(current.notes, incoming.notes, deletedNotesSet)
      : (current.notes || []).filter((x) => !deletedNotesSet.has(x.id)),
    customBookmarkDesigns: incoming.customBookmarkDesigns
      ? mergeById(
          current.customBookmarkDesigns,
          incoming.customBookmarkDesigns,
          deletedBookmarkDesignsSet
        )
      : (current.customBookmarkDesigns || []).filter((x) => !deletedBookmarkDesignsSet.has(x.id)),
    categories: incoming.categories || current.categories,
    theme: useIncomingTheme ? incoming.theme : current.theme,
    themeUpdatedAt: useIncomingTheme ? incomingThemeTs || now : currentThemeTs,
    profile: useIncomingProfile ? incoming.profile : current.profile,
    profileUpdatedAt: useIncomingProfile ? incomingProfileTs || now : currentProfileTs,
    lastActiveSession: mergedSession,
    deletedBookIds,
    deletedBookmarkIds,
    deletedAnnotationIds,
    deletedNoteIds,
    deletedBookmarkDesignIds,
  };

  writeState(nextState, spaceId);
  broadcastSyncUpdate(incoming.deviceId, nextState.updatedAt, spaceId);
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

  const spaceId = getRequestSpaceId(req);
  const state = readState(spaceId);
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
  writeState(state, spaceId);
  broadcastSyncUpdate(req.body.deviceId || '', state.updatedAt, spaceId);

  res.json({
    ok: true,
    id,
    remoteFileName: req.file.filename,
    fileSize: req.file.size,
  });
});

/* -------- Shared Reading Rooms (Buddy Read + Mutual Progress) -------- */

app.get('/api/rooms', (req, res) => {
  const rooms = readRooms();
  const participantId = typeof req.query.participantId === 'string' ? req.query.participantId : '';
  let list = Object.values(rooms);
  if (participantId) {
    list = list.filter((r) => r?.participants && r.participants[participantId]);
  }
  list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  res.json({ rooms: list });
});

app.post('/api/rooms', (req, res) => {
  const { book, participant } = req.body || {};
  if (!book?.id || !book?.title) {
    return res.status(400).json({ error: 'Faltan los datos del libro para crear la sala' });
  }
  const rooms = readRooms();
  const state = readState(getRequestSpaceId(req));
  const storedBook = state.books?.[book.id];
  const code = generateRoomCode(rooms);
  const now = Date.now();

  const pId = String(participant?.id || `user_${now}`).slice(0, 64);
  const room = {
    code,
    bookId: book.id,
    bookMeta: {
      id: book.id,
      title: book.title,
      author: book.author || 'Desconocido',
      description: book.description || '',
      format: storedBook?.format || book.format || 'epub',
      kind: book.kind || 'book',
      categories: Array.isArray(book.categories) ? book.categories : [],
      tags: Array.isArray(book.tags) ? book.tags : [],
      coverDataUrl: book.coverDataUrl || '',
      hasOriginalCover: Boolean(book.hasOriginalCover),
      spineColor: book.spineColor || '#4c6c8a',
      ribbonColor: book.ribbonColor || '#f2ba59',
      fileName: storedBook?.fileName || book.fileName || `${book.id}.${book.format || 'epub'}`,
      fileSize: storedBook?.fileSize || book.fileSize || 0,
      mimeType: storedBook?.mimeType || book.mimeType || 'application/octet-stream',
      pageCount: book.pageCount,
      hasRemoteFile: Boolean(storedBook?.hasRemoteFile || book.hasRemoteFile),
      remoteFileName: storedBook?.remoteFileName || book.remoteFileName || '',
      sharedAnnotations: Array.isArray(book.sharedAnnotations) ? book.sharedAnnotations.slice(0, 400) : [],
      sharedBookmarks: Array.isArray(book.sharedBookmarks) ? book.sharedBookmarks.slice(0, 150) : [],
    },
    hostId: pId,
    hostName: participant?.name || 'Lector Komo',
    createdAt: now,
    updatedAt: now,
    participants: {
      [pId]: {
        id: pId,
        name: participant?.name || 'Lector Komo',
        avatarEmoji: participant?.avatarEmoji || '🦊',
        avatarBg: participant?.avatarBg || '#f6d8ae',
        progress: Number(participant?.progress ?? book.progress ?? 0),
        currentPage: participant?.currentPage ?? book.currentPage ?? 1,
        pageCount: book.pageCount,
        readingStatus: participant?.readingStatus || book.readingStatus || 'reading',
        joinedAt: now,
        lastSeenAt: now,
      },
    },
    comments: [],
  };

  rooms[code] = room;
  writeRooms(rooms);
  res.json({ ok: true, room });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }
  res.json({ ok: true, room });
});

app.post('/api/rooms/:code/join', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Código de sala no encontrado' });
  }

  const p = req.body?.participant || {};
  const now = Date.now();
  const pId = String(p.id || `guest_${now}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
  const existing = room.participants?.[pId];

  room.participants = room.participants || {};
  room.participants[pId] = {
    id: pId,
    name: String(p.name || existing?.name || 'Invitado').slice(0, 40),
    avatarEmoji: p.avatarEmoji || existing?.avatarEmoji || '🦉',
    avatarBg: p.avatarBg || existing?.avatarBg || '#e8dccb',
    progress: Number(p.progress ?? existing?.progress ?? 0),
    currentPage: p.currentPage ?? existing?.currentPage ?? 1,
    pageCount: room.bookMeta?.pageCount,
    readingStatus: p.readingStatus || existing?.readingStatus || 'reading',
    joinedAt: existing?.joinedAt || now,
    lastSeenAt: now,
  };
  room.updatedAt = now;

  rooms[code] = room;
  writeRooms(rooms);
  broadcastRoomUpdate(code, room);
  res.json({ ok: true, room });
});

app.patch('/api/rooms/:code/progress', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }

  const {
    participantId,
    name,
    avatarEmoji,
    avatarBg,
    progress,
    currentPage,
    pageCount,
    readingStatus,
  } = req.body || {};

  const pId = String(participantId || '').slice(0, 64);
  if (!pId) {
    return res.status(400).json({ error: 'participantId requerido' });
  }

  const now = Date.now();
  room.participants = room.participants || {};
  const prev = room.participants[pId] || {
    id: pId,
    name: name || 'Lector',
    avatarEmoji: avatarEmoji || '🦊',
    avatarBg: avatarBg || '#f6d8ae',
    joinedAt: now,
  };

  room.participants[pId] = {
    ...prev,
    name: name ? String(name).slice(0, 40) : prev.name,
    avatarEmoji: avatarEmoji || prev.avatarEmoji,
    avatarBg: avatarBg || prev.avatarBg,
    progress: progress !== undefined ? Math.max(0, Math.min(100, Number(progress) || 0)) : prev.progress || 0,
    currentPage: currentPage !== undefined ? Number(currentPage) : prev.currentPage,
    pageCount: pageCount !== undefined ? Number(pageCount) : prev.pageCount || room.bookMeta?.pageCount,
    readingStatus: readingStatus || (Number(progress) >= 98 ? 'completed' : 'reading'),
    lastSeenAt: now,
  };
  room.updatedAt = now;

  rooms[code] = room;
  writeRooms(rooms);
  broadcastRoomUpdate(code, room);
  res.json({ ok: true, room });
});

app.post('/api/rooms/:code/comments', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }

  const { participantId, authorName, avatarEmoji, text, progressAt, pageAt } = req.body || {};
  const cleanText = typeof text === 'string' ? text.trim().slice(0, 600) : '';
  if (!cleanText) {
    return res.status(400).json({ error: 'Comentario vacío' });
  }

  const now = Date.now();
  const comment = {
    id: `rc_${now}_${Math.random().toString(36).slice(2, 6)}`,
    participantId: String(participantId || 'anon'),
    authorName: String(authorName || 'Lector').slice(0, 40),
    avatarEmoji: avatarEmoji || '🦊',
    text: cleanText,
    progressAt: Math.max(0, Math.min(100, Number(progressAt) || 0)),
    pageAt: pageAt !== undefined ? Number(pageAt) : undefined,
    createdAt: now,
  };

  room.comments = Array.isArray(room.comments) ? room.comments : [];
  room.comments.push(comment);
  if (room.comments.length > 200) room.comments = room.comments.slice(-200);
  room.updatedAt = now;

  rooms[code] = room;
  writeRooms(rooms);
  broadcastRoomUpdate(code, room);
  res.json({ ok: true, comment, room });
});

app.get('/api/rooms/:code/file', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }
  const state = readState();
  const stateBook = state.books?.[room.bookId];
  const remoteFileName = room.bookMeta?.remoteFileName || stateBook?.remoteFileName;
  if (!remoteFileName) {
    return res.status(404).json({ error: 'Archivo del libro aún no disponible en el servidor' });
  }
  const filePath = path.join(FILES_DIR, path.basename(remoteFileName));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo ausente en disco' });
  }
  res.sendFile(filePath);
});

app.get('/api/rooms/:code/stream', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }

  setupSse(res);
  if (!roomSseClients.has(code)) roomSseClients.set(code, new Set());
  roomSseClients.get(code).add(res);
  sendSseEvent(res, 'room_update', room);

  req.on('close', () => {
    const set = roomSseClients.get(code);
    if (set) {
      set.delete(res);
      if (set.size === 0) roomSseClients.delete(code);
    }
  });
});

app.post('/api/rooms/:code/leave', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }
  const pId = String(req.body?.participantId || '').slice(0, 64);
  if (pId && room.participants && room.participants[pId]) {
    delete room.participants[pId];
    room.updatedAt = Date.now();
    rooms[code] = room;
    writeRooms(rooms);
    broadcastRoomUpdate(code, room);
  }
  res.json({ ok: true, room });
});

app.delete('/api/rooms/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const rooms = readRooms();
  if (rooms[code]) {
    delete rooms[code];
    writeRooms(rooms);
    broadcastRoomDeleted(code);
  }
  res.json({ ok: true });
});

/* -------- Mutual Book Exchange Shelves (Independent Progress!) -------- */

const shelfUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (req, file, cb) => {
      const code = normalizeRoomCode(req.params.code || 'SHELF');
      const safeId = (req.body.bookId || `sbook_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
      const ext = path.extname(file.originalname || '').slice(0, 12);
      cb(null, `shelf_${code}_${safeId}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

app.get('/api/shelves', (req, res) => {
  const shelves = readShelves();
  const memberId = typeof req.query.memberId === 'string' ? req.query.memberId : '';
  let list = Object.values(shelves);
  if (memberId) {
    list = list.filter((s) => s?.members && s.members[memberId]);
  }
  list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  res.json({ shelves: list });
});

app.post('/api/shelves', (req, res) => {
  const { title, member } = req.body || {};
  const shelves = readShelves();
  const code = generateCode(shelves, 'SHELF');
  const now = Date.now();
  const mId = String(member?.id || `user_${now}`).slice(0, 64);

  const shelf = {
    code,
    title: String(title || `Estantería de ${member?.name || 'Lector'}`).slice(0, 80),
    hostId: mId,
    hostName: String(member?.name || 'Lector Komo').slice(0, 40),
    createdAt: now,
    updatedAt: now,
    members: {
      [mId]: {
        id: mId,
        name: String(member?.name || 'Lector Komo').slice(0, 40),
        avatarEmoji: member?.avatarEmoji || '🦊',
        avatarBg: member?.avatarBg || '#f6d8ae',
        joinedAt: now,
      },
    },
    books: {},
  };

  shelves[code] = shelf;
  writeShelves(shelves);
  res.json({ ok: true, shelf });
});

app.get('/api/shelves/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const shelves = readShelves();
  const shelf = shelves[code];
  if (!shelf) {
    return res.status(404).json({ error: 'Estantería compartida no encontrada' });
  }
  res.json({ ok: true, shelf });
});

app.post('/api/shelves/:code/join', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const shelves = readShelves();
  const shelf = shelves[code];
  if (!shelf) {
    return res.status(404).json({ error: 'Código de estantería no encontrado' });
  }
  const m = req.body?.member || {};
  const now = Date.now();
  const mId = String(m.id || `guest_${now}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
  shelf.members = shelf.members || {};
  shelf.members[mId] = {
    id: mId,
    name: String(m.name || shelf.members[mId]?.name || 'Lector invitado').slice(0, 40),
    avatarEmoji: m.avatarEmoji || shelf.members[mId]?.avatarEmoji || '🦉',
    avatarBg: m.avatarBg || shelf.members[mId]?.avatarBg || '#e8dccb',
    joinedAt: shelf.members[mId]?.joinedAt || now,
  };
  shelf.updatedAt = now;
  shelves[code] = shelf;
  writeShelves(shelves);
  broadcastShelfUpdate(code, shelf);
  res.json({ ok: true, shelf });
});

app.post('/api/shelves/:code/books', shelfUpload.single('file'), (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const shelves = readShelves();
  const shelf = shelves[code];
  if (!shelf) {
    return res.status(404).json({ error: 'Estantería compartida no encontrada' });
  }

  let book = {};
  if (req.body.meta) {
    try { book = JSON.parse(req.body.meta); } catch { /* ignore */ }
  } else if (req.body.book) {
    book = req.body.book;
  }

  const bookId = String(req.body.bookId || book.id || book.bookId || `sb_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!book.title) {
    return res.status(400).json({ error: 'Falta el título del libro a compartir' });
  }

  const now = Date.now();
  const ownerId = String(req.body.ownerId || book.ownerId || 'anon').slice(0, 64);
  const ownerName = String(req.body.ownerName || book.ownerName || 'Lector').slice(0, 40);
  const key = `${ownerId}_${bookId}`.slice(0, 96);

  shelf.books = shelf.books || {};
  shelf.books[key] = {
    bookId: key,
    ownerId,
    ownerName,
    title: String(book.title).slice(0, 140),
    author: String(book.author || 'Desconocido').slice(0, 80),
    description: String(book.description || '').slice(0, 600),
    format: book.format || 'epub',
    kind: book.kind || 'book',
    categories: Array.isArray(book.categories) ? book.categories : [],
    tags: Array.isArray(book.tags) ? book.tags : [],
    coverDataUrl: typeof book.coverDataUrl === 'string' ? book.coverDataUrl : '',
    hasOriginalCover: Boolean(book.hasOriginalCover),
    spineColor: book.spineColor || '#4c6c8a',
    ribbonColor: book.ribbonColor || '#f2ba59',
    fileName: book.fileName || `${bookId}.${book.format || 'epub'}`,
    fileSize: req.file?.size || book.fileSize || 0,
    mimeType: book.mimeType || req.file?.mimetype || 'application/octet-stream',
    pageCount: book.pageCount,
    hasRemoteFile: Boolean(req.file?.filename || book.remoteFileName),
    remoteFileName: req.file?.filename || book.remoteFileName || '',
    sharedAnnotations: Array.isArray(book.sharedAnnotations) ? book.sharedAnnotations.slice(0, 400) : [],
    sharedBookmarks: Array.isArray(book.sharedBookmarks) ? book.sharedBookmarks.slice(0, 150) : [],
    sharedAt: now,
  };
  shelf.updatedAt = now;
  shelves[code] = shelf;
  writeShelves(shelves);
  broadcastShelfUpdate(code, shelf);
  res.json({ ok: true, shelf, entry: shelf.books[key] });
});

app.get('/api/shelves/:code/books/:bookId/file', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const bookId = String(req.params.bookId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const shelves = readShelves();
  const shelf = shelves[code];
  const entry = shelf?.books?.[bookId];
  if (!entry || !entry.remoteFileName) {
    return res.status(404).json({ error: 'Archivo compartido no disponible' });
  }
  const filePath = path.join(FILES_DIR, path.basename(entry.remoteFileName));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo ausente en disco' });
  }
  res.sendFile(filePath);
});

app.delete('/api/shelves/:code/books/:bookId', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const bookId = String(req.params.bookId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const shelves = readShelves();
  const shelf = shelves[code];
  if (!shelf) return res.status(404).json({ error: 'Estantería no encontrada' });
  const entry = shelf.books?.[bookId];
  if (entry?.remoteFileName && entry.remoteFileName.startsWith('shelf_')) {
    const filePath = path.join(FILES_DIR, path.basename(entry.remoteFileName));
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
  if (shelf.books) delete shelf.books[bookId];
  shelf.updatedAt = Date.now();
  shelves[code] = shelf;
  writeShelves(shelves);
  broadcastShelfUpdate(code, shelf);
  res.json({ ok: true, shelf });
});

app.post('/api/shelves/:code/leave', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const shelves = readShelves();
  const shelf = shelves[code];
  if (!shelf) return res.status(404).json({ error: 'Estantería no encontrada' });
  const mId = String(req.body?.memberId || '').slice(0, 64);
  if (mId && shelf.members?.[mId]) {
    delete shelf.members[mId];
    shelf.updatedAt = Date.now();
    shelves[code] = shelf;
    writeShelves(shelves);
    broadcastShelfUpdate(code, shelf);
  }
  res.json({ ok: true, shelf });
});

app.delete('/api/shelves/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const shelves = readShelves();
  const shelf = shelves[code];
  if (shelf) {
    for (const entry of Object.values(shelf.books || {})) {
      if (entry?.remoteFileName && entry.remoteFileName.startsWith('shelf_')) {
        const fp = path.join(FILES_DIR, path.basename(entry.remoteFileName));
        if (fs.existsSync(fp)) {
          try { fs.unlinkSync(fp); } catch { /* ignore */ }
        }
      }
    }
    delete shelves[code];
    writeShelves(shelves);
    broadcastShelfDeleted(code);
  }
  res.json({ ok: true });
});

app.get('/api/shelves/:code/stream', (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  const shelves = readShelves();
  const shelf = shelves[code];
  if (!shelf) return res.status(404).json({ error: 'Estantería no encontrada' });
  setupSse(res);
  if (!shelfSseClients.has(code)) shelfSseClients.set(code, new Set());
  shelfSseClients.get(code).add(res);
  sendSseEvent(res, 'shelf_update', shelf);
  req.on('close', () => {
    const set = shelfSseClients.get(code);
    if (set) {
      set.delete(res);
      if (set.size === 0) shelfSseClients.delete(code);
    }
  });
});

app.get('/api/books/:id/file', (req, res) => {
  const spaceId = getRequestSpaceId(req);
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const state = readState(spaceId);
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
  const spaceId = getRequestSpaceId(req);
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const state = readState(spaceId);
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
  state.deletedBookIds = Array.from(new Set([...(state.deletedBookIds || []), id])).slice(-500);
  state.updatedAt = Date.now();
  writeState(state, spaceId);
  broadcastSyncUpdate('', state.updatedAt, spaceId);
  res.json({ ok: true });
});

/* -------- Device-to-Device Transfer Inbox -------- */

app.get('/api/inbox', (_req, res) => {
  const items = readInbox().filter((item) => {
    const target = path.join(INBOX_DIR, path.basename(item.storedName || ''));
    return fs.existsSync(target);
  });
  res.json({ items });
});

app.post('/api/inbox/upload', inboxUpload.array('files', 150), (req, res) => {
  const uploaded = Array.isArray(req.files) ? req.files : [];
  if (!uploaded.length) {
    return res.status(400).json({ error: 'No se recibieron archivos' });
  }

  let relativePaths = [];
  if (req.body.relativePaths) {
    try {
      const parsed = JSON.parse(req.body.relativePaths);
      if (Array.isArray(parsed)) relativePaths = parsed;
    } catch { /* ignore */ }
  }

  const kind = typeof req.body.kind === 'string' ? req.body.kind : 'auto';
  const author = typeof req.body.author === 'string' ? req.body.author.trim() : '';
  const deviceName = typeof req.body.deviceName === 'string' ? req.body.deviceName.trim() : 'Otro dispositivo';

  const inbox = readInbox();
  const created = uploaded.map((file, idx) => {
    const decodedName = Buffer.from(file.originalname || file.filename, 'latin1').toString('utf8');
    const cleanName = decodedName.includes('') ? file.originalname : decodedName;
    const id = path.parse(file.filename).name;
    const item = {
      id,
      originalName: cleanName,
      storedName: file.filename,
      relativePath: typeof relativePaths[idx] === 'string' ? relativePaths[idx] : cleanName,
      size: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      kind,
      author,
      deviceName: deviceName || 'Otro dispositivo',
      uploadedAt: Date.now(),
    };
    inbox.unshift(item);
    return item;
  });

  writeInbox(inbox);
  res.json({ ok: true, count: created.length, items: created });
});

app.get('/api/inbox/:id/file', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const inbox = readInbox();
  const item = inbox.find((x) => x.id === id);
  if (!item || !item.storedName) {
    return res.status(404).json({ error: 'Archivo no encontrado en la bandeja' });
  }
  const filePath = path.join(INBOX_DIR, path.basename(item.storedName));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo ausente en disco' });
  }
  res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
  res.sendFile(filePath);
});

app.delete('/api/inbox/:id', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const inbox = readInbox();
  const item = inbox.find((x) => x.id === id);
  if (item?.storedName) {
    const filePath = path.join(INBOX_DIR, path.basename(item.storedName));
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
  const next = inbox.filter((x) => x.id !== id);
  writeInbox(next);
  res.json({ ok: true });
});

/* -------- Mobile-Friendly Upload Page for Other Devices -------- */

function renderDeviceUploadPage() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KomoLib — Enviar desde otro dispositivo</title>
  <style>
    :root {
      --bg: #f3ede4;
      --card: #fdfbf8;
      --soft: #efe7dc;
      --text: #3b3532;
      --muted: #7f756c;
      --accent: #e86f68;
      --accent2: #8d7ec7;
      --border: rgba(59,53,50,0.12);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141720;
        --card: #1d212d;
        --soft: #262b3b;
        --text: #f1ede8;
        --muted: #9ea5b8;
        --accent: #e87a74;
        --accent2: #8e80dc;
        --border: rgba(255,255,255,0.12);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      padding: 20px 14px 40px;
    }
    .wrap {
      width: 100%;
      max-width: 520px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 22px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.16);
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-self: flex-start;
    }
    h1 { margin: 0; font-size: 20px; }
    p.sub { margin: 4px 0 0; font-size: 13px; color: var(--muted); line-height: 1.45; }
    .drop {
      border: 2.5px dashed var(--accent2);
      border-radius: 18px;
      padding: 20px 14px;
      background: var(--soft);
      text-align: center;
    }
    .btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    button, .btn {
      border: none;
      border-radius: 999px;
      padding: 11px 14px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-soft { background: var(--card); color: var(--text); border: 1px solid var(--border); }
    .btn-primary { background: var(--accent); color: #fff; width: 100%; padding: 13px; font-size: 14px; }
    .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 700; }
    input, select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1.5px solid var(--border);
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
    }
    .list {
      background: var(--soft);
      border-radius: 14px;
      padding: 10px 12px;
      max-height: 150px;
      overflow-y: auto;
      font-size: 12px;
      color: var(--muted);
    }
    .bar-wrap { height: 8px; border-radius: 999px; background: var(--soft); overflow: hidden; display: none; }
    .bar { height: 100%; width: 0%; background: var(--accent); transition: width 0.15s ease; }
    .status { font-size: 13px; font-weight: 700; min-height: 20px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <h1>📚 Enviar a KomoLib</h1>
      <p class="sub">Sube libros, mangas, manhwas, PDFs, carpetas o audiolibros desde este dispositivo hacia tu librería KomoLib en red local.</p>
    </div>

    <div class="drop" id="drop">
      <div style="font-weight:800;font-size:14px;">Selecciona archivos o una carpeta</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">EPUB · PDF · CBZ · CBR · MOBI · FB2 · DOCX · TXT · Imágenes · Audio</div>
      <div class="btn-row">
        <button type="button" class="btn-soft" id="pickFiles">📄 Elegir archivos</button>
        <button type="button" class="btn-soft" id="pickFolder">📁 Elegir carpeta</button>
      </div>
      <input id="fileInput" type="file" multiple hidden />
      <input id="folderInput" type="file" webkitdirectory directory multiple hidden />
    </div>

    <div id="fileList" class="list" style="display:none;"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label class="field">
        Tipo de lectura
        <select id="kind">
          <option value="auto">Auto-detectar</option>
          <option value="book">Libro / eBook</option>
          <option value="manga">Manga (RTL)</option>
          <option value="manhwa">Manhwa / Webtoon</option>
          <option value="comic">Cómic (LTR)</option>
          <option value="audiobook">Audiolibro</option>
        </select>
      </label>
      <label class="field">
        Autor (opcional)
        <input id="author" placeholder="Opcional" />
      </label>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label class="field">
        Nombre del dispositivo
        <input id="deviceName" placeholder="Ej: Mi celular" />
      </label>
      <label class="field" id="tokenWrap" style="${AUTH_TOKEN ? '' : 'display:none;'}">
        Token de acceso
        <input id="token" type="password" placeholder="KOMOLIB_TOKEN" />
      </label>
    </div>

    <div class="bar-wrap" id="barWrap"><div class="bar" id="bar"></div></div>
    <button type="button" class="btn-primary" id="sendBtn" disabled>Enviar a KomoLib</button>
    <div class="status" id="status"></div>
  </div>

  <script>
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    const fileList = document.getElementById('fileList');
    const sendBtn = document.getElementById('sendBtn');
    const statusEl = document.getElementById('status');
    const barWrap = document.getElementById('barWrap');
    const bar = document.getElementById('bar');
    const tokenEl = document.getElementById('token');
    const deviceEl = document.getElementById('deviceName');

    const params = new URLSearchParams(location.search);
    if (params.get('token') && tokenEl) tokenEl.value = params.get('token');
    if (deviceEl) {
      const ua = navigator.userAgent;
      deviceEl.value = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : 'Otro PC';
    }

    let selected = [];
    function renderSelected(list) {
      selected = Array.from(list || []).filter(f => f.size > 0);
      if (!selected.length) {
        fileList.style.display = 'none';
        sendBtn.disabled = true;
        return;
      }
      fileList.style.display = 'block';
      fileList.innerHTML = '<strong>' + selected.length + ' archivo(s) listos:</strong><br>' +
        selected.slice(0, 40).map(f => '• ' + (f.webkitRelativePath || f.name) + ' (' + (f.size / 1024 / 1024).toFixed(2) + ' MB)').join('<br>') +
        (selected.length > 40 ? '<br>... y ' + (selected.length - 40) + ' más' : '');
      sendBtn.disabled = false;
      statusEl.textContent = '';
    }

    document.getElementById('pickFiles').onclick = () => fileInput.click();
    document.getElementById('pickFolder').onclick = () => folderInput.click();
    fileInput.onchange = (e) => renderSelected(e.target.files);
    folderInput.onchange = (e) => renderSelected(e.target.files);

    const drop = document.getElementById('drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; };
    drop.ondragleave = () => { drop.style.borderColor = 'var(--accent2)'; };
    drop.ondrop = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent2)'; renderSelected(e.dataTransfer.files); };

    sendBtn.onclick = () => {
      if (!selected.length) return;
      const form = new FormData();
      const relPaths = [];
      for (const f of selected) {
        form.append('files', f, f.name);
        relPaths.push(f.webkitRelativePath || f.name);
      }
      form.append('relativePaths', JSON.stringify(relPaths));
      form.append('kind', document.getElementById('kind').value);
      form.append('author', document.getElementById('author').value);
      form.append('deviceName', deviceEl.value || 'Otro dispositivo');

      sendBtn.disabled = true;
      barWrap.style.display = 'block';
      bar.style.width = '5%';
      statusEl.textContent = 'Subiendo archivos...';

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/inbox/upload');
      if (tokenEl && tokenEl.value.trim()) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + tokenEl.value.trim());
      }
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          bar.style.width = pct + '%';
          statusEl.textContent = 'Subiendo... ' + pct + '%';
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          bar.style.width = '100%';
          statusEl.textContent = '✅ ¡Listo! ' + selected.length + ' archivo(s) enviados a KomoLib. Ya aparecen en "Importar → Otro dispositivo".';
          selected = [];
          fileList.style.display = 'none';
          fileInput.value = '';
          folderInput.value = '';
        } else {
          statusEl.textContent = '❌ Error al subir (' + xhr.status + '): ' + xhr.responseText;
          sendBtn.disabled = false;
        }
      };
      xhr.onerror = () => {
        statusEl.textContent = '❌ No se pudo conectar con el servidor KomoLib.';
        sendBtn.disabled = false;
      };
      xhr.send(form);
    };
  </script>
</body>
</html>`;
}

app.get(['/upload', '/send'], (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDeviceUploadPage());
});

// Return JSON 404 for unknown API routes instead of SPA HTML
app.all('/api/{*splat}', (_req, res) => {
  res.status(404).json({ error: 'Endpoint de API no encontrado' });
});

// Serve built web app if dist/ exists
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const AUTO_TUNNEL =
  process.argv.includes('--tunnel') ||
  /^(1|true|yes)$/i.test(String(process.env.AUTO_TUNNEL || ''));

app.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanIps();
  console.log(`📚 KomoLib Sync Server escuchando en http://0.0.0.0:${PORT}`);
  if (lanIps.length) {
    console.log(`🏠 Wi-Fi local (Web + APK): http://${lanIps[0]}:${PORT}`);
    console.log(`📲 Envío desde otros dispositivos: http://${lanIps[0]}:${PORT}/upload`);
  }
  if (runtimePublicUrl) {
    console.log(`🌐 URL pública configurada: ${runtimePublicUrl}`);
  }
  console.log(
    GEMINI_API_KEY
      ? `✨ Asistente IA Gemini activo (${GEMINI_MODEL})`
      : 'ℹ️  Asistente IA sin GEMINI_API_KEY en .env'
  );
  if (AUTO_TUNNEL) {
    console.log('🌐 Iniciando túnel de Internet automático (Cloudflare Quick Tunnel)...');
    startQuickTunnel().catch((err) => {
      console.warn(`⚠️  No se pudo iniciar el túnel automático: ${err.message}`);
    });
  }
});
