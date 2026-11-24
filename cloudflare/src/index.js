/**
 * KomoLib Cloud API — Cloudflare Workers + D1
 *
 * Permanent free edge backend (0 ms cold start, never sleeps/suspends):
 * - Google Drive OAuth + persistent per-email refresh_token vault (D1)
 * - Shared Reading Rooms (KOMO-XXXX) & Mutual Shelves (SHELF-XXXX)
 * - Chunked binary file storage inside D1 (512 KB chunks => zero R2/credit-card required)
 * - Optional Gemini AI chat & book identification proxy
 * - Optional Email-only cloud sync fallback
 */

const CHUNK_SIZE = 512 * 1024; // 512 KB per D1 row (well under D1 2 MB row limit)
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024; // 45 MB safety cap for Workers RAM

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-KomoLib-Space',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(req),
    },
  });
}

function html(req, body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders(req),
    },
  });
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function normalizeSpaceId(raw) {
  const clean = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return clean.length >= 4 ? clean : 'default';
}

function getRequestSpaceId(req, url, body) {
  const fromHeader = req.headers.get('X-KomoLib-Space');
  const fromQuery = url.searchParams.get('space') || '';
  const fromBody = typeof body?.spaceId === 'string' ? body.spaceId : '';
  return normalizeSpaceId(fromHeader || fromQuery || fromBody || 'default');
}

function sanitizeAvatarUrl(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 180000) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed) && trimmed.length <= 2048) return trimmed;
  return '';
}

function base64UrlEncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeUtf8(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function randomCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const rand = new Uint8Array(4);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 4; i++) suffix += chars[rand[i] % chars.length];
  return `${prefix}-${suffix}`;
}

function checkBearerAuth(req, url, env) {
  const token = (env.KOMOLIB_TOKEN || '').trim();
  if (!token) return true;
  const auth = req.headers.get('Authorization') || '';
  const queryToken = url.searchParams.get('token') || '';
  return auth === `Bearer ${token}` || queryToken === token;
}

/* ---------- D1 Chunked Binary File Helpers ---------- */

async function saveBinaryFile(db, fileKey, fileName, mimeType, bytes) {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`El archivo excede el límite de ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`);
  }
  await db.prepare('DELETE FROM file_chunks WHERE file_key = ?').bind(fileKey).run();
  const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(bytes.byteLength, start + CHUNK_SIZE);
    const slice = bytes.subarray(start, end);
    await db
      .prepare('INSERT INTO file_chunks (file_key, chunk_index, data) VALUES (?, ?, ?)')
      .bind(fileKey, i, slice)
      .run();
  }
  await db
    .prepare(
      'INSERT OR REPLACE INTO files_meta (file_key, file_name, mime_type, size, chunk_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(fileKey, fileName, mimeType || 'application/octet-stream', bytes.byteLength, chunkCount, Date.now())
    .run();
}

async function deleteBinaryFile(db, fileKey) {
  if (!fileKey) return;
  await db.batch([
    db.prepare('DELETE FROM file_chunks WHERE file_key = ?').bind(fileKey),
    db.prepare('DELETE FROM files_meta WHERE file_key = ?').bind(fileKey),
  ]);
}

async function serveBinaryFile(req, db, fileKey) {
  const meta = await db
    .prepare('SELECT file_name, mime_type, size, chunk_count FROM files_meta WHERE file_key = ?')
    .bind(fileKey)
    .first();
  if (!meta) return json(req, { error: 'Archivo no encontrado' }, 404);

  const chunksRes = await db
    .prepare('SELECT chunk_index, data FROM file_chunks WHERE file_key = ? ORDER BY chunk_index ASC')
    .bind(fileKey)
    .all();
  const rows = chunksRes.results || [];
  if (!rows.length) return json(req, { error: 'Contenido del archivo ausente' }, 404);

  const parts = rows.map((r) =>
    r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data)
  );
  const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.byteLength;
  }

  return new Response(combined, {
    status: 200,
    headers: {
      'Content-Type': meta.mime_type || 'application/octet-stream',
      'Content-Length': String(combined.byteLength),
      'Content-Disposition': `inline; filename="${String(meta.file_name || 'book').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
      ...corsHeaders(req),
    },
  });
}

/* ---------- D1 Google Refresh Token Helpers ---------- */

async function getSavedRefreshToken(db, email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return '';
  const row = await db
    .prepare('SELECT refresh_token FROM google_tokens WHERE email = ?')
    .bind(clean)
    .first();
  return typeof row?.refresh_token === 'string' ? row.refresh_token.trim() : '';
}

async function saveRefreshToken(db, email, token) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanToken = String(token || '').trim();
  if (!cleanEmail || !cleanToken) return;
  await db
    .prepare('INSERT OR REPLACE INTO google_tokens (email, refresh_token, updated_at) VALUES (?, ?, ?)')
    .bind(cleanEmail, cleanToken, Date.now())
    .run();
}

function isAllowedGoogleReturnUrl(raw, env) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return true;
    const pubApp = (env.PUBLIC_APP_URL || '').trim();
    if (pubApp) {
      const pub = new URL(pubApp);
      if (u.origin === pub.origin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/* ---------- D1 Rooms / Shelves Helpers ---------- */

async function getRoom(db, code) {
  const row = await db.prepare('SELECT data FROM rooms WHERE code = ?').bind(code).first();
  return row ? JSON.parse(row.data) : null;
}

async function putRoom(db, room) {
  await db
    .prepare('INSERT OR REPLACE INTO rooms (code, data, updated_at) VALUES (?, ?, ?)')
    .bind(room.code, JSON.stringify(room), room.updatedAt || Date.now())
    .run();
}

async function isRoomDeleted(db, code) {
  const row = await db.prepare('SELECT 1 FROM deleted_rooms WHERE code = ?').bind(code).first();
  return Boolean(row);
}

async function getShelf(db, code) {
  const row = await db.prepare('SELECT data FROM shelves WHERE code = ?').bind(code).first();
  return row ? JSON.parse(row.data) : null;
}

async function putShelf(db, shelf) {
  await db
    .prepare('INSERT OR REPLACE INTO shelves (code, data, updated_at) VALUES (?, ?, ?)')
    .bind(shelf.code, JSON.stringify(shelf), shelf.updatedAt || Date.now())
    .run();
}

async function isShelfDeleted(db, code) {
  const row = await db.prepare('SELECT 1 FROM deleted_shelves WHERE code = ?').bind(code).first();
  return Boolean(row);
}

/* ---------- Sync State Merge Helper (Email fallback) ---------- */

function emptyState() {
  return {
    updatedAt: 0,
    books: {},
    bookmarks: [],
    annotations: [],
    notes: [],
    chatSessions: [],
    customBookmarkDesigns: [],
    customStationery: null,
    categories: null,
    collections: null,
    readerSettings: null,
    readerSettingsUpdatedAt: 0,
    theme: null,
    themeUpdatedAt: 0,
    profile: null,
    profileUpdatedAt: 0,
    lastActiveSession: null,
    deletedBookIds: [],
    deletedBookmarkIds: [],
    deletedAnnotationIds: [],
    deletedNoteIds: [],
    deletedBookmarkDesignIds: [],
    deletedChatSessionIds: [],
    sharedRooms: [],
    joinedRoomCodes: [],
    closedRoomCodes: [],
    sharedShelves: [],
    joinedShelfCodes: [],
    closedShelfCodes: [],
  };
}

function mergeById(existing = [], incoming = [], deletedSet = new Set()) {
  const map = new Map();
  for (const item of existing) {
    if (item?.id && !deletedSet.has(item.id)) map.set(item.id, item);
  }
  for (const item of incoming) {
    if (!item?.id || deletedSet.has(item.id)) continue;
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt || item.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

function isRasterCover(url) {
  return typeof url === 'string' && /^data:image\/(?!svg\+xml)/i.test(url.trim());
}

function mergeStates(currentRaw, incoming) {
  const current = { ...emptyState(), ...(currentRaw || {}) };
  const mergeT = (a = [], b = []) => Array.from(new Set([...a, ...b])).slice(-500);

  const deletedBookIds = mergeT(current.deletedBookIds, incoming.deletedBookIds);
  const deletedBookmarkIds = mergeT(current.deletedBookmarkIds, incoming.deletedBookmarkIds);
  const deletedAnnotationIds = mergeT(current.deletedAnnotationIds, incoming.deletedAnnotationIds);
  const deletedNoteIds = mergeT(current.deletedNoteIds, incoming.deletedNoteIds);
  const deletedBookmarkDesignIds = mergeT(current.deletedBookmarkDesignIds, incoming.deletedBookmarkDesignIds);
  const deletedChatSessionIds = mergeT(current.deletedChatSessionIds, incoming.deletedChatSessionIds);

  const incDelBooks = new Set(incoming.deletedBookIds || []);
  const delBooks = new Set(deletedBookIds);
  const delBm = new Set(deletedBookmarkIds);
  const delAnn = new Set(deletedAnnotationIds);
  const delNotes = new Set(deletedNoteIds);
  const delDesigns = new Set(deletedBookmarkDesignIds);
  const delChats = new Set(deletedChatSessionIds);

  const mergedBooks = {};
  for (const [id, b] of Object.entries(current.books || {})) {
    if (b && !b.isDemo && !incDelBooks.has(id)) mergedBooks[id] = b;
  }
  for (const [id, b] of Object.entries(incoming.books || {})) {
    if (!b || b.isDemo || incDelBooks.has(id)) continue;
    if (delBooks.has(id) && !current.books?.[id]) continue;
    const prev = mergedBooks[id];
    const incomingNewer = !prev || (b.updatedAt || 0) >= (prev.updatedAt || 0);
    if (incomingNewer) {
      let cover =
        b.coverDataUrl === '__KEEP__' ? prev?.coverDataUrl || '' : b.coverDataUrl || prev?.coverDataUrl || '';
      if (isRasterCover(prev?.coverDataUrl) && !isRasterCover(b.coverDataUrl) && b.hasOriginalCover !== false) {
        cover = prev.coverDataUrl;
      }
      mergedBooks[id] = {
        ...prev,
        ...b,
        coverDataUrl: cover,
        driveFileId: b.driveFileId || prev?.driveFileId,
        hasRemoteFile: Boolean(prev?.hasRemoteFile || b.hasRemoteFile || b.driveFileId || prev?.driveFileId),
        remoteFileName: prev?.remoteFileName || b.remoteFileName,
      };
    } else if (prev) {
      mergedBooks[id] = {
        ...prev,
        driveFileId: prev.driveFileId || b.driveFileId,
        hasRemoteFile: Boolean(prev.hasRemoteFile || b.hasRemoteFile || prev.driveFileId || b.driveFileId),
      };
    }
  }
  for (const id of incDelBooks) delete mergedBooks[id];

  const incThemeTs = Number(incoming.themeUpdatedAt || 0);
  const curThemeTs = Number(current.themeUpdatedAt || 0);
  const useIncTheme = Boolean(incoming.theme && (!current.theme || (incThemeTs > 0 && incThemeTs >= curThemeTs)));
  const resolvedTheme =
    incoming.theme?.customWallpaperUrl === '__KEEP__'
      ? { ...incoming.theme, customWallpaperUrl: current.theme?.customWallpaperUrl || '' }
      : incoming.theme;

  const incProfileTs = Number(incoming.profileUpdatedAt || 0);
  const curProfileTs = Number(current.profileUpdatedAt || 0);
  const useIncProfile = Boolean(incoming.profile && (!current.profile || (incProfileTs > 0 && incProfileTs >= curProfileTs)));

  const incReaderTs = Number(incoming.readerSettingsUpdatedAt || 0);
  const curReaderTs = Number(current.readerSettingsUpdatedAt || 0);
  const useIncReader = Boolean(
    incoming.readerSettings && (!current.readerSettings || (incReaderTs > 0 && incReaderTs >= curReaderTs))
  );

  const closedRoomCodes = Array.from(
    new Set([...(current.closedRoomCodes || []), ...(incoming.closedRoomCodes || [])].map(normalizeCode).filter(Boolean))
  ).slice(-100);
  const closedRoomSet = new Set(closedRoomCodes);
  const roomsMap = new Map();
  for (const r of [...(current.sharedRooms || []), ...(incoming.sharedRooms || [])]) {
    const c = normalizeCode(r?.code);
    if (!c || closedRoomSet.has(c)) continue;
    const prev = roomsMap.get(c);
    if (!prev || (r.updatedAt || r.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) roomsMap.set(c, r);
  }
  const sharedRooms = Array.from(roomsMap.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 40);

  const closedShelfCodes = Array.from(
    new Set([...(current.closedShelfCodes || []), ...(incoming.closedShelfCodes || [])].map(normalizeCode).filter(Boolean))
  ).slice(-100);
  const closedShelfSet = new Set(closedShelfCodes);
  const shelvesMap = new Map();
  for (const sh of [...(current.sharedShelves || []), ...(incoming.sharedShelves || [])]) {
    const c = normalizeCode(sh?.code);
    if (!c || closedShelfSet.has(c)) continue;
    const prev = shelvesMap.get(c);
    if (!prev || (sh.updatedAt || sh.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) shelvesMap.set(c, sh);
  }
  const sharedShelves = Array.from(shelvesMap.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 40);

  return {
    updatedAt: Date.now(),
    books: mergedBooks,
    bookmarks: incoming.bookmarks ? mergeById(current.bookmarks, incoming.bookmarks, delBm) : current.bookmarks,
    annotations: incoming.annotations ? mergeById(current.annotations, incoming.annotations, delAnn) : current.annotations,
    notes: incoming.notes ? mergeById(current.notes, incoming.notes, delNotes) : current.notes,
    chatSessions: Array.isArray(incoming.chatSessions)
      ? mergeById(current.chatSessions, incoming.chatSessions, delChats).slice(0, 60)
      : current.chatSessions,
    customBookmarkDesigns: incoming.customBookmarkDesigns
      ? mergeById(current.customBookmarkDesigns, incoming.customBookmarkDesigns, delDesigns)
      : current.customBookmarkDesigns,
    customStationery: incoming.customStationery || current.customStationery || null,
    categories: incoming.categories || current.categories || null,
    collections: incoming.collections || current.collections || null,
    readerSettings: useIncReader ? incoming.readerSettings : current.readerSettings || null,
    readerSettingsUpdatedAt: useIncReader ? incReaderTs : curReaderTs,
    theme: useIncTheme ? resolvedTheme : current.theme,
    themeUpdatedAt: useIncTheme ? incThemeTs : curThemeTs,
    profile: useIncProfile ? incoming.profile : current.profile,
    profileUpdatedAt: useIncProfile ? incProfileTs : curProfileTs,
    lastActiveSession:
      incoming.lastActiveSession &&
      (!current.lastActiveSession || (incoming.lastActiveSession.updatedAt || 0) >= (current.lastActiveSession.updatedAt || 0))
        ? incoming.lastActiveSession
        : current.lastActiveSession || null,
    deletedBookIds,
    deletedBookmarkIds,
    deletedAnnotationIds,
    deletedNoteIds,
    deletedBookmarkDesignIds,
    deletedChatSessionIds,
    sharedRooms,
    joinedRoomCodes: Array.from(
      new Set([...(current.joinedRoomCodes || []), ...(incoming.joinedRoomCodes || []), ...sharedRooms.map((r) => r.code)].map(normalizeCode).filter((c) => c && !closedRoomSet.has(c)))
    ).slice(0, 40),
    closedRoomCodes,
    sharedShelves,
    joinedShelfCodes: Array.from(
      new Set([...(current.joinedShelfCodes || []), ...(incoming.joinedShelfCodes || []), ...sharedShelves.map((s) => s.code)].map(normalizeCode).filter((c) => c && !closedShelfSet.has(c)))
    ).slice(0, 40),
    closedShelfCodes,
  };
}

/* ---------- Main Router ---------- */

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const db = env.DB;

    try {
      // Root status page
      if (method === 'GET' && pathname === '/') {
        return json(req, { ok: true, service: 'komolib-cloudflare-api', version: '2.0.0' });
      }

      // Health check
      if (method === 'GET' && pathname === '/api/health') {
        const roomsRow = await db.prepare('SELECT COUNT(*) AS c FROM rooms').first().catch(() => ({ c: 0 }));
        return json(req, {
          ok: true,
          service: 'komolib-cloudflare-api',
          version: '2.0.0',
          booksCount: 0,
          roomsCount: Number(roomsRow?.c || 0),
          updatedAt: Date.now(),
          authRequired: Boolean((env.KOMOLIB_TOKEN || '').trim()),
          aiConfigured: Boolean((env.GEMINI_API_KEY || '').trim()),
          aiModel: (env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
          publicUrl: url.origin,
          lanUrls: [],
          uploadUrls: [],
        });
      }

      if (method === 'GET' && pathname === '/api/network-info') {
        return json(req, {
          port: 443,
          lanIps: [],
          lanUrls: [],
          publicUrl: url.origin,
          uploadUrls: [],
          authRequired: Boolean((env.KOMOLIB_TOKEN || '').trim()),
        });
      }

      /* ===== GOOGLE DRIVE OAUTH + PERSISTENT D1 REFRESH VAULT ===== */

      if (method === 'GET' && pathname === '/api/google/status') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        return json(req, {
          ok: true,
          configured: Boolean(clientId && clientSecret),
          clientId,
        });
      }

      if (method === 'GET' && pathname === '/api/google/start') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        if (!clientId || !clientSecret) {
          return html(
            req,
            '<html><body style="font-family:sans-serif;padding:24px;max-width:480px;margin:auto;">' +
              '<h2>Google Drive aún no configurado en Cloudflare</h2>' +
              '<p>Ejecuta <code>npx wrangler secret put GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code>.</p>' +
              '</body></html>',
            503
          );
        }
        const platformRaw = url.searchParams.get('platform') || 'web';
        const platform =
          platformRaw === 'android' ? 'android' : platformRaw === 'desktop' ? 'desktop' : 'web';
        const rawReturn = url.searchParams.get('returnTo') || '';
        const returnTo = isAllowedGoogleReturnUrl(rawReturn, env)
          ? rawReturn
          : (env.PUBLIC_APP_URL || '').trim();
        const loginHint = (url.searchParams.get('loginHint') || '').trim().toLowerCase();
        const forceConsent = url.searchParams.get('forceConsent') === '1';
        const switchAccount = url.searchParams.get('switchAccount') === '1';
        const redirectUri = `${url.origin}/api/google/callback`;

        const statePayload = base64UrlEncodeUtf8(
          JSON.stringify({ platform, returnTo, ts: Date.now() })
        );

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ].join(' '),
          access_type: 'offline',
          include_granted_scopes: 'true',
          state: statePayload,
        });

        if (loginHint) params.set('login_hint', loginHint);
        const hasSavedRefresh = loginHint ? Boolean(await getSavedRefreshToken(db, loginHint)) : false;
        if (forceConsent) {
          params.set('prompt', 'consent select_account');
        } else if (switchAccount) {
          params.set('prompt', 'select_account');
        } else if (!hasSavedRefresh) {
          params.set('prompt', 'consent');
        }

        return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
      }

      if (method === 'GET' && pathname === '/api/google/callback') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        let stateObj = { platform: 'web', returnTo: (env.PUBLIC_APP_URL || '').trim() };
        try {
          const rawState = url.searchParams.get('state') || '';
          if (rawState) {
            const parsed = JSON.parse(base64UrlDecodeUtf8(rawState));
            stateObj = {
              platform:
                parsed.platform === 'android'
                  ? 'android'
                  : parsed.platform === 'desktop'
                  ? 'desktop'
                  : 'web',
              returnTo: isAllowedGoogleReturnUrl(parsed.returnTo, env)
                ? parsed.returnTo
                : (env.PUBLIC_APP_URL || '').trim(),
            };
          }
        } catch {
          // ignore invalid state
        }

        const sendBack = (payloadObj) => {
          const encoded = base64UrlEncodeUtf8(JSON.stringify(payloadObj));
          const ok = !payloadObj.error;
          if (stateObj.platform === 'android' || (stateObj.platform === 'desktop' && !stateObj.returnTo)) {
            const scheme = stateObj.platform === 'desktop' ? 'komolib://oauth' : 'com.komolib.reader://oauth';
            const deepLink = `${scheme}#gdrive_auth=${encodeURIComponent(encoded)}`;
            return html(
              req,
              `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
                `<title>Komolib · Google Drive</title>` +
                `<style>body{font-family:system-ui,sans-serif;background:#f3ede4;color:#2e2621;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}.card{background:#fffdf9;border-radius:20px;padding:28px 24px;max-width:420px;box-shadow:0 12px 34px rgba(0,0,0,.08)}.btn{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#e86f68;color:#fff;font-weight:700;text-decoration:none}</style>` +
                `</head><body><div class="card">` +
                `<h2>${ok ? 'Google Drive conectado' : 'No se pudo conectar'}</h2>` +
                `<p>${ok ? 'Volviendo a Komolib...' : String(payloadObj.error || 'Error desconocido')}</p>` +
                `<a class="btn" href="${deepLink}">Abrir Komolib</a>` +
                `</div><script>window.location.replace(${JSON.stringify(deepLink)});</script></body></html>`
            );
          }
          const targetBase = stateObj.returnTo || 'http://localhost:5173';
          return Response.redirect(`${targetBase}#gdrive_auth=${encodeURIComponent(encoded)}`, 302);
        };

        const oauthErr = url.searchParams.get('error');
        if (oauthErr) return sendBack({ error: oauthErr });
        const code = url.searchParams.get('code') || '';
        if (!code || !clientId || !clientSecret) {
          return sendBack({ error: 'Código OAuth faltante o credenciales de Google no configuradas' });
        }

        const redirectUri = `${url.origin}/api/google/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.access_token) {
          return sendBack({ error: tokenData.error_description || tokenData.error || 'Error al obtener token de Google' });
        }

        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userInfo = await userRes.json().catch(() => ({}));
        const resolvedEmail = String(userInfo.email || '').trim().toLowerCase();
        let effectiveRefreshToken = String(tokenData.refresh_token || '').trim();
        if (resolvedEmail && effectiveRefreshToken) {
          await saveRefreshToken(db, resolvedEmail, effectiveRefreshToken);
        } else if (resolvedEmail && !effectiveRefreshToken) {
          effectiveRefreshToken = await getSavedRefreshToken(db, resolvedEmail);
        }

        return sendBack({
          email: resolvedEmail,
          name: String(userInfo.name || '').trim(),
          picture: String(userInfo.picture || '').trim(),
          accessToken: tokenData.access_token,
          refreshToken: effectiveRefreshToken,
          expiresAt: Date.now() + Math.max(300, Number(tokenData.expires_in || 3600) - 120) * 1000,
        });
      }

      if (method === 'POST' && pathname === '/api/google/refresh') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        if (!clientId || !clientSecret) {
          return json(req, { error: 'Google Drive OAuth no configurado en Cloudflare' }, 503);
        }
        const body = await req.json().catch(() => ({}));
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        let refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
        if (!refreshToken && email) {
          refreshToken = await getSavedRefreshToken(db, email);
        }
        if (!refreshToken) {
          return json(
            req,
            { error: 'Tu sesión de Google Drive expiró. Vuelve a pulsar "Conectar con Google Drive".' },
            401
          );
        }

        const exchange = async (rt) => {
          const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: rt,
              grant_type: 'refresh_token',
            }),
          });
          const d = await r.json().catch(() => ({}));
          return { ok: r.ok && Boolean(d.access_token), data: d };
        };

        let result = await exchange(refreshToken);
        let usedRefresh = refreshToken;
        if (!result.ok && email) {
          const fallbackToken = await getSavedRefreshToken(db, email);
          if (fallbackToken && fallbackToken !== refreshToken) {
            result = await exchange(fallbackToken);
            usedRefresh = fallbackToken;
          }
        }
        if (!result.ok) {
          return json(
            req,
            { error: result.data.error_description || result.data.error || 'Sesión de Google Drive expirada' },
            401
          );
        }
        const finalRefresh = String(result.data.refresh_token || usedRefresh).trim();
        if (email && finalRefresh) {
          await saveRefreshToken(db, email, finalRefresh);
        }
        return json(req, {
          ok: true,
          accessToken: result.data.access_token,
          refreshToken: finalRefresh,
          expiresAt: Date.now() + Math.max(300, Number(result.data.expires_in || 3600) - 120) * 1000,
        });
      }

      /* ===== SHARED READING ROOMS (KOMO-XXXX) ===== */

      if (method === 'GET' && pathname === '/api/rooms') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const participantId = (url.searchParams.get('participantId') || '').trim();
        const resRows = await db.prepare('SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 60').all();
        let list = (resRows.results || []).map((r) => JSON.parse(r.data));
        if (participantId) {
          list = list.filter((rm) => rm?.participants && rm.participants[participantId]);
        }
        return json(req, { rooms: list });
      }

      if (method === 'POST' && pathname === '/api/rooms') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const body = await req.json().catch(() => ({}));
        const { book, participant } = body;
        if (!book?.id || !book?.title) {
          return json(req, { error: 'Faltan los datos del libro para crear la sala' }, 400);
        }
        let code = randomCode('KOMO');
        for (let i = 0; i < 6; i++) {
          const exists = await getRoom(db, code);
          if (!exists) break;
          code = randomCode('KOMO');
        }
        const now = Date.now();
        const hostSpaceId = getRequestSpaceId(req, url, body);
        const pId = String(participant?.id || `user_${now}`).slice(0, 64);
        const room = {
          code,
          hostSpaceId,
          bookId: book.id,
          bookMeta: {
            id: book.id,
            title: book.title,
            author: book.author || 'Desconocido',
            description: book.description || '',
            format: book.format || 'epub',
            kind: book.kind || 'book',
            categories: Array.isArray(book.categories) ? book.categories : [],
            tags: Array.isArray(book.tags) ? book.tags : [],
            coverDataUrl: book.coverDataUrl || '',
            hasOriginalCover: Boolean(book.hasOriginalCover),
            spineColor: book.spineColor || '#4c6c8a',
            ribbonColor: book.ribbonColor || '#f2ba59',
            fileName: book.fileName || `${book.id}.${book.format || 'epub'}`,
            fileSize: book.fileSize || 0,
            mimeType: book.mimeType || 'application/octet-stream',
            pageCount: book.pageCount,
            hasRemoteFile: Boolean(book.hasRemoteFile),
            remoteFileName: book.remoteFileName || '',
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
              avatarImageUrl: sanitizeAvatarUrl(participant?.avatarImageUrl),
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
        await putRoom(db, room);
        return json(req, { ok: true, room });
      }

      const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(restore|join|progress|comments|file|leave|kick|stream))?$/);
      if (roomMatch) {
        const code = normalizeCode(decodeURIComponent(roomMatch[1]));
        const action = roomMatch[2] || '';

        if (method === 'GET' && !action) {
          const room = await getRoom(db, code);
          if (!room) {
            if (await isRoomDeleted(db, code)) {
              return json(req, { error: 'Esta sala fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Sala no encontrada' }, 404);
          }
          return json(req, { ok: true, room });
        }

        if (method === 'PUT' && action === 'restore') {
          if (await isRoomDeleted(db, code)) {
            return json(req, { error: 'Esta sala ya fue cerrada', deleted: true }, 410);
          }
          const body = await req.json().catch(() => ({}));
          const incoming = body?.room;
          if (!incoming || !incoming.bookId || !incoming.bookMeta?.title) {
            return json(req, { error: 'Faltan los datos de la sala para restaurarla' }, 400);
          }
          const now = Date.now();
          const existing = await getRoom(db, code);
          const sanitizeP = (id, p) => ({
            id: String(p?.id || id).slice(0, 64),
            name: String(p?.name || 'Lector Komo').slice(0, 40),
            avatarEmoji: p?.avatarEmoji || '🦊',
            avatarBg: p?.avatarBg || '#f6d8ae',
            avatarImageUrl: sanitizeAvatarUrl(p?.avatarImageUrl),
            progress: Math.max(0, Math.min(100, Number(p?.progress || 0))),
            currentPage: p?.currentPage !== undefined ? Number(p.currentPage) : undefined,
            pageCount: p?.pageCount !== undefined ? Number(p.pageCount) : incoming.bookMeta?.pageCount,
            readingStatus: p?.readingStatus || (Number(p?.progress || 0) >= 98 ? 'completed' : 'reading'),
            joinedAt: Number(p?.joinedAt || now),
            lastSeenAt: Number(p?.lastSeenAt || now),
          });

          if (existing) {
            const kickedSet = new Set(Array.isArray(existing.kickedIds) ? existing.kickedIds : []);
            existing.participants = existing.participants || {};
            for (const [rawId, p] of Object.entries(incoming.participants || {})) {
              const pId = String(p?.id || rawId).slice(0, 64);
              if (!pId || kickedSet.has(pId)) continue;
              const prev = existing.participants[pId];
              if (!prev) {
                existing.participants[pId] = sanitizeP(pId, p);
              } else if ((Number(p?.lastSeenAt) || 0) > (Number(prev.lastSeenAt) || 0)) {
                existing.participants[pId] = { ...prev, ...sanitizeP(pId, p), joinedAt: prev.joinedAt || now };
              }
            }
            const cMap = new Map();
            for (const c of [...(existing.comments || []), ...(incoming.comments || [])]) {
              if (c?.id) cMap.set(c.id, c);
            }
            existing.comments = Array.from(cMap.values())
              .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
              .slice(-300);
            existing.updatedAt = Math.max(existing.updatedAt || 0, now);
            await putRoom(db, existing);
            return json(req, { ok: true, room: existing, restored: false });
          }

          const participants = {};
          for (const [rawId, p] of Object.entries(incoming.participants || {})) {
            const pId = String(p?.id || rawId).slice(0, 64);
            if (pId) participants[pId] = sanitizeP(pId, p);
          }
          const restored = {
            ...incoming,
            code,
            participants,
            comments: Array.isArray(incoming.comments) ? incoming.comments.slice(-300) : [],
            kickedIds: Array.isArray(incoming.kickedIds) ? incoming.kickedIds.slice(-50) : [],
            updatedAt: now,
          };
          await putRoom(db, restored);
          return json(req, { ok: true, room: restored, restored: true });
        }

        if (method === 'POST' && action === 'join') {
          const room = await getRoom(db, code);
          if (!room) {
            if (await isRoomDeleted(db, code)) {
              return json(req, { error: 'Esta sala fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Código de sala no encontrado' }, 404);
          }
          const body = await req.json().catch(() => ({}));
          const p = body?.participant || {};
          const now = Date.now();
          const pId = String(p.id || `guest_${now}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
          room.participants = room.participants || {};
          const prev = room.participants[pId];
          room.participants[pId] = {
            id: pId,
            name: String(p.name || prev?.name || 'Lector invitado').slice(0, 40),
            avatarEmoji: p.avatarEmoji || prev?.avatarEmoji || '🦉',
            avatarBg: p.avatarBg || prev?.avatarBg || '#e8dccb',
            avatarImageUrl:
              p.avatarImageUrl !== undefined ? sanitizeAvatarUrl(p.avatarImageUrl) : prev?.avatarImageUrl || '',
            progress: prev ? prev.progress : Number(p.progress || 0),
            currentPage: prev ? prev.currentPage : p.currentPage,
            pageCount: room.bookMeta?.pageCount,
            readingStatus: prev ? prev.readingStatus : p.readingStatus || 'reading',
            joinedAt: prev?.joinedAt || now,
            lastSeenAt: now,
          };
          if (Array.isArray(room.kickedIds)) {
            room.kickedIds = room.kickedIds.filter((id) => id !== pId);
          }
          room.updatedAt = now;
          await putRoom(db, room);
          return json(req, { ok: true, room });
        }

        if (method === 'PATCH' && action === 'progress') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const pId = String(body?.participantId || '').slice(0, 64);
          if (!pId) return json(req, { error: 'participantId requerido' }, 400);
          if (Array.isArray(room.kickedIds) && room.kickedIds.includes(pId)) {
            return json(req, { error: 'Fuiste eliminado de esta sala' }, 403);
          }
          const now = Date.now();
          const prev = room.participants?.[pId] || {
            id: pId,
            name: body.name || 'Lector',
            avatarEmoji: body.avatarEmoji || '📚',
            avatarBg: body.avatarBg || '#e8dccb',
            joinedAt: now,
          };
          const pct = Math.max(0, Math.min(100, Number(body.progress ?? prev.progress ?? 0)));
          room.participants = room.participants || {};
          room.participants[pId] = {
            ...prev,
            name: body.name ? String(body.name).slice(0, 40) : prev.name,
            avatarEmoji: body.avatarEmoji || prev.avatarEmoji,
            avatarBg: body.avatarBg || prev.avatarBg,
            avatarImageUrl:
              body.avatarImageUrl !== undefined
                ? sanitizeAvatarUrl(body.avatarImageUrl)
                : prev.avatarImageUrl || '',
            progress: pct,
            currentPage: body.currentPage !== undefined ? Number(body.currentPage) : prev.currentPage,
            pageCount: body.pageCount !== undefined ? Number(body.pageCount) : prev.pageCount,
            readingStatus: body.readingStatus || (pct >= 98 ? 'completed' : 'reading'),
            lastSeenAt: now,
          };
          room.updatedAt = now;
          await putRoom(db, room);
          return json(req, { ok: true, room });
        }

        if (method === 'POST' && action === 'comments') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const text = String(body?.text || '').trim().slice(0, 600);
          if (!text) return json(req, { error: 'Comentario vacío' }, 400);
          const authorId = String(body?.participantId || 'anon').slice(0, 64);
          if (Array.isArray(room.kickedIds) && room.kickedIds.includes(authorId)) {
            return json(req, { error: 'Fuiste eliminado de esta sala' }, 403);
          }
          const now = Date.now();
          const comment = {
            id: `rc_${now}_${Math.random().toString(36).slice(2, 6)}`,
            authorId,
            authorName: String(body?.authorName || 'Lector').slice(0, 40),
            avatarEmoji: body?.avatarEmoji || '💬',
            avatarImageUrl: sanitizeAvatarUrl(body?.avatarImageUrl),
            text,
            progressAt: Math.max(0, Math.min(100, Number(body?.progressAt || 0))),
            pageAt: body?.pageAt !== undefined ? Number(body.pageAt) : undefined,
            createdAt: now,
          };
          room.comments = [...(room.comments || []), comment].slice(-300);
          room.updatedAt = now;
          await putRoom(db, room);
          return json(req, { ok: true, room, comment });
        }

        if (method === 'GET' && action === 'file') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const fileKey = room.bookMeta?.remoteFileName || `book_${room.hostSpaceId || 'default'}__${room.bookId}`;
          return serveBinaryFile(req, db, fileKey);
        }

        if (method === 'POST' && action === 'leave') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { ok: true });
          const body = await req.json().catch(() => ({}));
          const pId = String(body?.participantId || '').slice(0, 64);
          if (pId && room.participants?.[pId]) {
            delete room.participants[pId];
            room.updatedAt = Date.now();
            await putRoom(db, room);
          }
          return json(req, { ok: true });
        }

        if (method === 'POST' && action === 'kick') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const requesterId = String(body?.requesterId || '').slice(0, 64);
          const targetId = String(body?.targetParticipantId || '').slice(0, 64);
          if (!requesterId || requesterId !== room.hostId) {
            return json(req, { error: 'Solo el anfitrión puede eliminar miembros' }, 403);
          }
          if (!targetId || targetId === room.hostId) {
            return json(req, { error: 'No puedes eliminar al anfitrión' }, 400);
          }
          if (room.participants?.[targetId]) delete room.participants[targetId];
          room.kickedIds = Array.from(new Set([...(room.kickedIds || []), targetId])).slice(-50);
          room.updatedAt = Date.now();
          await putRoom(db, room);
          return json(req, { ok: true, room });
        }

        if (method === 'DELETE' && !action) {
          if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
          await db.batch([
            db.prepare('DELETE FROM rooms WHERE code = ?').bind(code),
            db.prepare('INSERT OR REPLACE INTO deleted_rooms (code, deleted_at) VALUES (?, ?)').bind(code, Date.now()),
          ]);
          return json(req, { ok: true });
        }
      }

      /* ===== SHARED MUTUAL SHELVES (SHELF-XXXX) ===== */

      if (method === 'GET' && pathname === '/api/shelves') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const memberId = (url.searchParams.get('memberId') || '').trim();
        const resRows = await db.prepare('SELECT data FROM shelves ORDER BY updated_at DESC LIMIT 60').all();
        let list = (resRows.results || []).map((r) => JSON.parse(r.data));
        if (memberId) {
          list = list.filter((sh) => sh?.members && sh.members[memberId]);
        }
        return json(req, { shelves: list });
      }

      if (method === 'POST' && pathname === '/api/shelves') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const body = await req.json().catch(() => ({}));
        const { title, member } = body;
        let code = randomCode('SHELF');
        for (let i = 0; i < 6; i++) {
          const exists = await getShelf(db, code);
          if (!exists) break;
          code = randomCode('SHELF');
        }
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
              avatarImageUrl: sanitizeAvatarUrl(member?.avatarImageUrl),
              joinedAt: now,
            },
          },
          books: {},
        };
        await putShelf(db, shelf);
        return json(req, { ok: true, shelf });
      }

      const shelfBookFileMatch = pathname.match(/^\/api\/shelves\/([^/]+)\/books\/([^/]+)\/file$/);
      if (shelfBookFileMatch && method === 'GET') {
        const code = normalizeCode(decodeURIComponent(shelfBookFileMatch[1]));
        const bookId = decodeURIComponent(shelfBookFileMatch[2]).replace(/[^a-zA-Z0-9_-]/g, '');
        const shelf = await getShelf(db, code);
        const entry = shelf?.books?.[bookId];
        if (!entry?.remoteFileName) return json(req, { error: 'Archivo compartido no disponible' }, 404);
        return serveBinaryFile(req, db, entry.remoteFileName);
      }

      const shelfBookDelMatch = pathname.match(/^\/api\/shelves\/([^/]+)\/books\/([^/]+)$/);
      if (shelfBookDelMatch && method === 'DELETE') {
        const code = normalizeCode(decodeURIComponent(shelfBookDelMatch[1]));
        const bookId = decodeURIComponent(shelfBookDelMatch[2]).replace(/[^a-zA-Z0-9_-]/g, '');
        const shelf = await getShelf(db, code);
        if (!shelf) return json(req, { error: 'Estantería no encontrada' }, 404);
        const entry = shelf.books?.[bookId];
        if (entry?.remoteFileName) await deleteBinaryFile(db, entry.remoteFileName);
        if (shelf.books) delete shelf.books[bookId];
        shelf.updatedAt = Date.now();
        await putShelf(db, shelf);
        return json(req, { ok: true, shelf });
      }

      const shelfMatch = pathname.match(/^\/api\/shelves\/([^/]+)(?:\/(restore|join|books|leave|kick|stream))?$/);
      if (shelfMatch) {
        const code = normalizeCode(decodeURIComponent(shelfMatch[1]));
        const action = shelfMatch[2] || '';

        if (method === 'GET' && !action) {
          const shelf = await getShelf(db, code);
          if (!shelf) {
            if (await isShelfDeleted(db, code)) {
              return json(req, { error: 'Esta estantería fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Estantería compartida no encontrada' }, 404);
          }
          return json(req, { ok: true, shelf });
        }

        if (method === 'PUT' && action === 'restore') {
          if (await isShelfDeleted(db, code)) {
            return json(req, { error: 'Esta estantería ya fue cerrada', deleted: true }, 410);
          }
          const body = await req.json().catch(() => ({}));
          const incoming = body?.shelf;
          if (!incoming || !incoming.title) {
            return json(req, { error: 'Faltan los datos de la estantería para restaurarla' }, 400);
          }
          const now = Date.now();
          const existing = await getShelf(db, code);
          if (existing) {
            const kickedSet = new Set(Array.isArray(existing.kickedIds) ? existing.kickedIds : []);
            existing.members = existing.members || {};
            for (const [rawId, m] of Object.entries(incoming.members || {})) {
              const mId = String(m?.id || rawId).slice(0, 64);
              if (!mId || kickedSet.has(mId) || existing.members[mId]) continue;
              existing.members[mId] = {
                id: mId,
                name: String(m?.name || 'Lector Komo').slice(0, 40),
                avatarEmoji: m?.avatarEmoji || '🦊',
                avatarBg: m?.avatarBg || '#f6d8ae',
                avatarImageUrl: sanitizeAvatarUrl(m?.avatarImageUrl),
                joinedAt: Number(m?.joinedAt || now),
              };
            }
            existing.books = { ...(incoming.books || {}), ...(existing.books || {}) };
            existing.updatedAt = Math.max(existing.updatedAt || 0, now);
            await putShelf(db, existing);
            return json(req, { ok: true, shelf: existing, restored: false });
          }
          const restored = { ...incoming, code, updatedAt: now };
          await putShelf(db, restored);
          return json(req, { ok: true, shelf: restored, restored: true });
        }

        if (method === 'POST' && action === 'join') {
          const shelf = await getShelf(db, code);
          if (!shelf) {
            if (await isShelfDeleted(db, code)) {
              return json(req, { error: 'Esta estantería fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Código de estantería no encontrado' }, 404);
          }
          const body = await req.json().catch(() => ({}));
          const m = body?.member || {};
          const now = Date.now();
          const mId = String(m.id || `guest_${now}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
          shelf.members = shelf.members || {};
          const prev = shelf.members[mId];
          shelf.members[mId] = {
            id: mId,
            name: String(m.name || prev?.name || 'Lector invitado').slice(0, 40),
            avatarEmoji: m.avatarEmoji || prev?.avatarEmoji || '🦉',
            avatarBg: m.avatarBg || prev?.avatarBg || '#e8dccb',
            avatarImageUrl:
              m.avatarImageUrl !== undefined ? sanitizeAvatarUrl(m.avatarImageUrl) : prev?.avatarImageUrl || '',
            joinedAt: prev?.joinedAt || now,
          };
          if (Array.isArray(shelf.kickedIds)) {
            shelf.kickedIds = shelf.kickedIds.filter((id) => id !== mId);
          }
          shelf.updatedAt = now;
          await putShelf(db, shelf);
          return json(req, { ok: true, shelf });
        }

        if (method === 'POST' && action === 'books') {
          const shelf = await getShelf(db, code);
          if (!shelf) return json(req, { error: 'Estantería compartida no encontrada' }, 404);

          const form = await req.formData();
          let book = {};
          const metaStr = form.get('meta');
          if (typeof metaStr === 'string' && metaStr.trim()) {
            try { book = JSON.parse(metaStr); } catch { /* ignore */ }
          }
          const rawBookId = String(form.get('bookId') || book.id || book.bookId || `sb_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
          if (!book.title) return json(req, { error: 'Falta el título del libro a compartir' }, 400);

          const ownerId = String(form.get('ownerId') || book.ownerId || 'anon').slice(0, 64);
          if (Array.isArray(shelf.kickedIds) && shelf.kickedIds.includes(ownerId)) {
            return json(req, { error: 'Fuiste eliminado de esta estantería' }, 403);
          }
          const ownerName = String(form.get('ownerName') || book.ownerName || 'Lector').slice(0, 40);
          const key = `${ownerId}_${rawBookId}`.slice(0, 96);
          const fileEntry = form.get('file');
          let remoteFileName = book.remoteFileName || '';
          let fileSize = book.fileSize || 0;
          let mimeType = book.mimeType || 'application/octet-stream';

          if (fileEntry && typeof fileEntry === 'object' && typeof fileEntry.arrayBuffer === 'function') {
            const bytes = new Uint8Array(await fileEntry.arrayBuffer());
            remoteFileName = `shelf_${code}_${key}`;
            fileSize = bytes.byteLength;
            mimeType = fileEntry.type || mimeType;
            await saveBinaryFile(db, remoteFileName, fileEntry.name || book.fileName || `${rawBookId}.${book.format || 'epub'}`, mimeType, bytes);
          }

          const now = Date.now();
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
            fileName: book.fileName || `${rawBookId}.${book.format || 'epub'}`,
            folderPath: typeof book.folderPath === 'string' && book.folderPath.trim() ? book.folderPath.trim().slice(0, 260) : undefined,
            fileSize,
            mimeType,
            pageCount: book.pageCount,
            hasRemoteFile: Boolean(remoteFileName),
            remoteFileName,
            sharedAnnotations: Array.isArray(book.sharedAnnotations) ? book.sharedAnnotations.slice(0, 400) : [],
            sharedBookmarks: Array.isArray(book.sharedBookmarks) ? book.sharedBookmarks.slice(0, 150) : [],
            sharedAt: now,
          };
          shelf.updatedAt = now;
          await putShelf(db, shelf);
          return json(req, { ok: true, shelf, entry: shelf.books[key] });
        }

        if (method === 'POST' && action === 'leave') {
          const shelf = await getShelf(db, code);
          if (!shelf) return json(req, { ok: true });
          const body = await req.json().catch(() => ({}));
          const mId = String(body?.memberId || '').slice(0, 64);
          if (mId && shelf.members?.[mId]) {
            delete shelf.members[mId];
            shelf.updatedAt = Date.now();
            await putShelf(db, shelf);
          }
          return json(req, { ok: true });
        }

        if (method === 'POST' && action === 'kick') {
          const shelf = await getShelf(db, code);
          if (!shelf) return json(req, { error: 'Estantería no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const requesterId = String(body?.requesterId || '').slice(0, 64);
          const targetId = String(body?.targetMemberId || '').slice(0, 64);
          if (!requesterId || requesterId !== shelf.hostId) {
            return json(req, { error: 'Solo el anfitrión puede eliminar miembros' }, 403);
          }
          if (!targetId || targetId === shelf.hostId) {
            return json(req, { error: 'No puedes eliminar al anfitrión' }, 400);
          }
          if (shelf.members?.[targetId]) delete shelf.members[targetId];
          shelf.kickedIds = Array.from(new Set([...(shelf.kickedIds || []), targetId])).slice(-50);
          shelf.updatedAt = Date.now();
          await putShelf(db, shelf);
          return json(req, { ok: true, shelf });
        }

        if (method === 'DELETE' && !action) {
          if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
          const shelf = await getShelf(db, code);
          if (shelf?.books) {
            for (const entry of Object.values(shelf.books)) {
              if (entry?.remoteFileName) await deleteBinaryFile(db, entry.remoteFileName);
            }
          }
          await db.batch([
            db.prepare('DELETE FROM shelves WHERE code = ?').bind(code),
            db.prepare('INSERT OR REPLACE INTO deleted_shelves (code, deleted_at) VALUES (?, ?)').bind(code, Date.now()),
          ]);
          return json(req, { ok: true });
        }
      }

      /* ===== BOOK BINARY UPLOAD/DOWNLOAD (FOR SHARED ROOMS & SYNC) ===== */

      if (method === 'POST' && pathname === '/api/books/upload') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const form = await req.formData();
        const fileEntry = form.get('file');
        if (!fileEntry || typeof fileEntry !== 'object' || typeof fileEntry.arrayBuffer !== 'function') {
          return json(req, { error: 'Archivo requerido' }, 400);
        }
        const safeId = String(form.get('id') || `book_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
        const spaceId = getRequestSpaceId(req, url, null);
        const fileKey = `book_${spaceId}__${safeId}`;
        const bytes = new Uint8Array(await fileEntry.arrayBuffer());
        await saveBinaryFile(db, fileKey, fileEntry.name || `${safeId}.bin`, fileEntry.type || 'application/octet-stream', bytes);
        return json(req, { ok: true, id: safeId, remoteFileName: fileKey, size: bytes.byteLength });
      }

      const bookFileMatch = pathname.match(/^\/api\/books\/([^/]+)\/file$/);
      if (bookFileMatch && method === 'GET') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const safeId = decodeURIComponent(bookFileMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
        const spaceId = getRequestSpaceId(req, url, null);
        return serveBinaryFile(req, db, `book_${spaceId}__${safeId}`);
      }

      const bookDelMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
      if (bookDelMatch && method === 'DELETE') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const safeId = decodeURIComponent(bookDelMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
        const spaceId = getRequestSpaceId(req, url, null);
        await deleteBinaryFile(db, `book_${spaceId}__${safeId}`);
        return json(req, { ok: true });
      }

      /* ===== EMAIL-ONLY CLOUD SYNC STATE FALLBACK ===== */

      if (pathname === '/api/sync/state') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        if (method === 'GET') {
          const spaceId = getRequestSpaceId(req, url, null);
          const row = await db.prepare('SELECT data FROM sync_spaces WHERE space_id = ?').bind(spaceId).first();
          return json(req, row ? JSON.parse(row.data) : emptyState());
        }
        if (method === 'PUT') {
          const body = await req.json().catch(() => ({}));
          const spaceId = getRequestSpaceId(req, url, body);
          const row = await db.prepare('SELECT data FROM sync_spaces WHERE space_id = ?').bind(spaceId).first();
          const current = row ? JSON.parse(row.data) : emptyState();
          const next = mergeStates(current, body);
          await db
            .prepare('INSERT OR REPLACE INTO sync_spaces (space_id, data, updated_at) VALUES (?, ?, ?)')
            .bind(spaceId, JSON.stringify(next), next.updatedAt)
            .run();
          if (url.searchParams.get('partial') === '1') {
            return json(req, { ok: true, partial: true, updatedAt: next.updatedAt });
          }
          return json(req, next);
        }
      }

      /* ===== GEMINI AI ASSISTANT PROXY ===== */

      if (method === 'POST' && pathname === '/api/ai/chat') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const apiKey = (env.GEMINI_API_KEY || '').trim();
        const model = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        if (!apiKey) return json(req, { error: 'GEMINI_API_KEY no configurada en Cloudflare' }, 503);

        const body = await req.json().catch(() => ({}));
        const message = String(body?.message || '').trim();
        if (!message) return json(req, { error: 'Mensaje vacío' }, 400);

        const booksSummary = (Array.isArray(body.books) ? body.books : [])
          .slice(0, 60)
          .map((b) => `- "${b.title}" por ${b.author || 'Desconocido'} (${b.progress || 0}%)`)
          .join('\n');

        const systemPrompt =
          `Eres el asistente literario de KomoLib para ${body.profileName || 'el lector'}. Responde en español, conciso y cálido.\n` +
          (booksSummary ? `Biblioteca actual:\n${booksSummary}\n` : '');

        const contents = [];
        for (const h of (Array.isArray(body.history) ? body.history : []).slice(-10)) {
          if (h?.text) {
            contents.push({ role: h.sender === 'user' ? 'user' : 'model', parts: [{ text: String(h.text).slice(0, 1200) }] });
          }
        }
        contents.push({ role: 'user', parts: [{ text: message }] });

        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents,
            }),
          }
        );
        const gData = await gRes.json().catch(() => ({}));
        const reply = gData?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
        if (!gRes.ok || !reply) {
          return json(req, { error: gData?.error?.message || 'La IA no pudo responder en este momento' }, 502);
        }
        return json(req, { ok: true, reply, model });
      }

      if (method === 'POST' && pathname === '/api/ai/identify-book') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const apiKey = (env.GEMINI_API_KEY || '').trim();
        const model = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        if (!apiKey) return json(req, { error: 'GEMINI_API_KEY no configurada en Cloudflare' }, 503);

        const body = await req.json().catch(() => ({}));
        const prompt =
          'Identifica este libro y responde SOLO un JSON válido con {"title":"...","author":"...","description":"sinopsis breve en español"}.\n' +
          `Archivo: ${body.fileName || ''}\nTítulo actual: ${body.currentTitle || ''}\nAutor actual: ${body.currentAuthor || ''}\n` +
          (body.textExcerpt ? `Extracto:\n${String(body.textExcerpt).slice(0, 2000)}` : '');

        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          }
        );
        const gData = await gRes.json().catch(() => ({}));
        const rawText = gData?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || '';
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        let parsed = null;
        try { parsed = JSON.parse(cleaned); } catch { /* ignore */ }
        if (!parsed) return json(req, { error: 'Respuesta inválida del modelo de IA' }, 502);
        return json(req, {
          ok: true,
          model,
          title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
          author: typeof parsed.author === 'string' ? parsed.author.trim() : '',
          description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
        });
      }

      return json(req, { error: `Ruta no encontrada: ${method} ${pathname}` }, 404);
    } catch (err) {
      return json(req, { error: err instanceof Error ? err.message : 'Error interno en el servidor' }, 500);
    }
  },
};
