import JSZip from 'jszip';
import { normalizeServerUrl, SYNC_SERVER_URL } from '../config';
import type {
  ActiveReadingSession,
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  CategoryItem,
  ChatSession,
  CollectionCard,
  ContentKind,
  CustomStationeryKit,
  NoteItem,
  ReaderSettings,
  SharedRoom,
  SharedShelf,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';
import { dbGetBookFile, dbPutBookFile } from '../db/localDb';
import type { FileWithRelPath } from '../utils/fileFolderImport';
import { readNativeUriAsBlob } from '../utils/nativeBridge';

export interface ServerHealth {
  ok: boolean;
  service: string;
  version: string;
  booksCount: number;
  inboxCount?: number;
  roomsCount?: number;
  updatedAt: number;
  authRequired: boolean;
  aiConfigured?: boolean;
  aiModel?: string;
  publicUrl?: string;
  lanUrls?: string[];
  uploadUrls?: string[];
}

export interface AiChatResponse {
  ok: boolean;
  reply: string;
  model: string;
  matchedBookIds?: string[];
}

export interface InboxItem {
  id: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  size: number;
  mimeType: string;
  kind?: ContentKind | 'auto';
  author?: string;
  deviceName?: string;
  uploadedAt: number;
}

export interface RemoteSyncPayload {
  updatedAt: number;
  books: Record<string, BookItem>;
  bookmarks: BookmarkItem[];
  annotations?: BookAnnotation[];
  notes: NoteItem[];
  chatSessions?: ChatSession[];
  customBookmarkDesigns?: BookmarkDesign[];
  customStationery?: CustomStationeryKit | null;
  categories: CategoryItem[] | null;
  collections?: CollectionCard[] | null;
  readerSettings?: ReaderSettings | null;
  readerSettingsUpdatedAt?: number;
  theme: ThemeConfig | null;
  themeUpdatedAt?: number;
  profile: UserProfile | null;
  profileUpdatedAt?: number;
  lastActiveSession?: ActiveReadingSession | null;
  deletedBookIds?: string[];
  deletedBookmarkIds?: string[];
  deletedAnnotationIds?: string[];
  deletedNoteIds?: string[];
  deletedBookmarkDesignIds?: string[];
  deletedChatSessionIds?: string[];
  sharedRooms?: SharedRoom[];
  joinedRoomCodes?: string[];
  closedRoomCodes?: string[];
  sharedShelves?: SharedShelf[];
  joinedShelfCodes?: string[];
  closedShelfCodes?: string[];
}

/**
 * Deterministically derives a private cloud vault ID (`acct_<hex>`) from an email/namespace
 * using dual 32-bit FNV-1a/cyrb hashes so it works identically on HTTP LAN, HTTPS, localhost & APK.
 */
export function deriveEmailSpaceId(email: string, pin = ''): string {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPin = pin.trim();
  const key = `komolib_vault_v1::${cleanEmail}::${cleanPin}`;
  let h1 = 0xdeadbeef ^ key.length;
  let h2 = 0x41c6ce57 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const safePrefix = cleanEmail.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'user';
  return `acct_${safePrefix}_${hex1}${hex2}`;
}

function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Reads a JSON response and turns unexpected HTML responses (HTTP 200 + index.html or proxy page)
 * into an actionable error instead of the cryptic "Unexpected token '<'".
 */
export async function parseJsonResponse<T>(res: Response, url: string): Promise<T> {
  const raw = await res.text().catch(() => '');
  const trimmed = raw.trim();
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(trimmed) as { error?: string; message?: string };
      detail = parsed?.error || parsed?.message || '';
    } catch {
      if (trimmed && !trimmed.startsWith('<')) detail = trimmed.slice(0, 180);
    }
    throw new Error(detail || `El servidor respondió HTTP ${res.status} en ${endpointLabel(url)}`);
  }

  if (!trimmed) return {} as T;

  if (trimmed.startsWith('<') || /text\/html/i.test(contentType)) {
    throw new Error(
      `El servidor ${endpointLabel(url)} devolvió HTML en vez de JSON. ` +
        `Revisa que la URL del API de KomoLib sea correcta (sin /api al final), ` +
        `que el servicio esté activo y que /api/health responda JSON.`
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `Respuesta inválida del servidor en ${endpointLabel(url)}: ${trimmed.slice(0, 120)}`
    );
  }
}

/**
 * Typed transient network/connectivity error so background syncs can retry quietly
 * instead of showing scary developer diagnostics in the UI.
 */
export class ApiNetworkError extends Error {
  readonly isTransientNetworkError = true;
  readonly isOffline: boolean;
  readonly endpoint: string;
  readonly detail: string;

  constructor(message: string, opts: { isOffline?: boolean; endpoint: string; detail: string }) {
    super(message);
    this.name = 'ApiNetworkError';
    this.isOffline = Boolean(opts.isOffline);
    this.endpoint = opts.endpoint;
    this.detail = opts.detail;
  }
}

export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ApiNetworkError) return true;
  if (typeof err === 'object' && 'isTransientNetworkError' in err) {
    return Boolean((err as { isTransientNetworkError?: boolean }).isTransientNetworkError);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed|network request failed|sin conexión a internet|no se pudo conectar con la nube/i.test(
    msg
  );
}

const renderLastAwakeAt = new Map<string, number>();
const renderWakePromises = new Map<string, Promise<boolean>>();

/**
 * Gently wakes a sleeping Render Free instance using a simple CORS GET `/api/health`
 * (no custom headers => no CORS preflight OPTIONS blocked by Render's 502 cold-start proxy).
 * Uses single-flight deduplication per origin so concurrent calls share a single wake-up.
 */
export async function waitForRenderWakeUp(origin: string, maxWaitMs = 55_000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  const existing = renderWakePromises.get(origin);
  if (existing) return existing;

  const task = (async (): Promise<boolean> => {
    const deadline = Date.now() + maxWaitMs;
    let step = 0;
    while (Date.now() < deadline) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
      }
      try {
        const res = await fetch(`${origin}/api/health`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (res.ok) {
          renderLastAwakeAt.set(origin, Date.now());
          return true;
        }
      } catch {
        // Render edge proxy may drop/block CORS while container is spinning up
      }
      step += 1;
      const delayMs = Math.min(4000, 1500 + step * 750);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remaining)));
    }
    return false;
  })();

  renderWakePromises.set(origin, task);
  try {
    return await task;
  } finally {
    renderWakePromises.delete(origin);
  }
}

/**
 * Fetch wrapper with Render Free cold-start wake-up + clean user-facing errors.
 * Technical details (URL, origin, CORS hint) are logged to console.warn instead of
 * cluttering the UI.
 */
export async function fetchApi(url: string, init?: RequestInit): Promise<Response> {
  const endpoint = endpointLabel(url);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiNetworkError(
      'Sin conexión a internet. Tus cambios se guardan en este dispositivo y se sincronizarán al reconectar.',
      { isOffline: true, endpoint, detail: 'navigator.onLine is false' }
    );
  }

  const method = (init?.method || 'GET').toUpperCase();
  const isRender = /\.onrender\.com\b/i.test(url);
  const isIdempotentPost =
    method === 'POST' &&
    /\/api\/(?:google\/refresh|(?:rooms|shelves)\/[^/]+\/join)\b/i.test(url);
  const canRetryColdStart =
    isRender && (method === 'GET' || method === 'PUT' || method === 'PATCH' || isIdempotentPost);

  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    origin = '';
  }

  // For preflighted requests to Render (e.g. POST /api/google/refresh with JSON),
  // if Render hasn't responded in the last 10 minutes, wake it via simple GET /api/health
  // first when a quick attempt fails so CORS preflight never dies on a 502 cold-start.
  const maxAttempts = canRetryColdStart ? 3 : 1;
  let lastError: unknown;
  let wokeOnce = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500 && isRender && origin) {
        renderLastAwakeAt.set(origin, Date.now());
      }
      if (
        canRetryColdStart &&
        attempt < maxAttempts - 1 &&
        (res.status === 502 || res.status === 503 || res.status === 504)
      ) {
        if (origin && !wokeOnce) {
          wokeOnce = true;
          const awake = await waitForRenderWakeUp(origin, 55_000);
          if (awake) continue;
        }
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new ApiNetworkError(
          'Sin conexión a internet. Tus cambios se guardan en este dispositivo y se sincronizarán al reconectar.',
          { isOffline: true, endpoint, detail: 'Device went offline' }
        );
      }
      if (canRetryColdStart && attempt < maxAttempts - 1) {
        if (origin && !wokeOnce) {
          wokeOnce = true;
          // If Render was recently healthy (< 10 min), try a shorter recovery window;
          // otherwise wait up to 55s for Render Free cold start to finish cleanly.
          const lastHealthy = renderLastAwakeAt.get(origin) || 0;
          const wakeBudgetMs = Date.now() - lastHealthy < 10 * 60 * 1000 ? 18_000 : 55_000;
          const awake = await waitForRenderWakeUp(origin, wakeBudgetMs);
          if (awake) continue;
        }
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'Error de red';
  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'el navegador';

  console.warn(`[KomoLib API] Connection failed for ${endpoint} (origin: ${appOrigin}): ${detail}`);

  let userMessage = '';
  try {
    const target = new URL(url);
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && target.protocol === 'http:') {
      userMessage =
        'El servidor configurado usa HTTP desde una página HTTPS. Usa la dirección HTTPS del servidor.';
    } else if (
      typeof window !== 'undefined' &&
      /^(localhost|127\.0\.0\.1)$/i.test(target.hostname) &&
      !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ) {
      userMessage =
        'La dirección del servidor apunta a localhost. Configura la URL pública del servidor.';
    }
  } catch {
    // ignore malformed URL
  }

  if (!userMessage) {
    userMessage = isRender
      ? 'No se pudo conectar con la nube en este momento. Tus libros locales siguen disponibles; intenta de nuevo en unos segundos.'
      : 'No se pudo conectar con el servidor en este momento. Verifica tu conexión e intenta de nuevo.';
  }

  throw new ApiNetworkError(userMessage, {
    isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
    endpoint,
    detail,
  });
}

export function buildAuthHeaders(config: SyncConfig, isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (config.token.trim()) {
    headers['Authorization'] = `Bearer ${config.token.trim()}`;
  }
  if (config.spaceId?.trim()) {
    headers['X-KomoLib-Space'] = config.spaceId.trim();
  }
  const base = resolveServerUrl(config.serverUrl);
  if (/ngrok/i.test(base)) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }
  return headers;
}

export function resolveServerUrl(url: string): string {
  const trimmed = normalizeServerUrl(url);
  if (!trimmed) return SYNC_SERVER_URL;
  if (
    typeof window !== 'undefined' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed) &&
    window.location.hostname &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    // If a dedicated sync server URL was compiled into the build, always prefer it over localhost.
    if (SYNC_SERVER_URL) {
      return SYNC_SERVER_URL;
    }
    // When served over HTTPS, standard port (80/443), or directly from the KomoLib server port,
    // the API lives on the same origin (avoiding broken http://localhost:4123 URLs!).
    const isStandardOrHttps =
      window.location.protocol === 'https:' ||
      window.location.port === '' ||
      window.location.port === '80' ||
      window.location.port === '443';
    if (isStandardOrHttps) {
      return window.location.origin.replace(/\/+$/, '');
    }
    try {
      const parsed = new URL(trimmed);
      if (window.location.port === parsed.port) {
        return window.location.origin.replace(/\/+$/, '');
      }
      parsed.hostname = window.location.hostname;
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export interface ParsedPairingConfig {
  serverUrl?: string;
  spaceId?: string;
  token?: string;
  publicUrl?: string;
  joinCode?: string;
  shelfCode?: string;
}

export function parsePairingInput(raw: string): ParsedPairingConfig | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const normalized = text.startsWith('komolib://')
      ? text.replace(/^komolib:\/\//i, 'https://komolib.local/')
      : text;
    const url = new URL(normalized);
    const params = url.searchParams;
    const paramServer = params.get('server')?.trim().replace(/\/+$/, '');
    const paramSpace = params.get('space')?.trim();
    const paramToken = params.get('token')?.trim();
    const paramPublic = params.get('publicUrl')?.trim().replace(/\/+$/, '');
    const joinCode = params.get('join')?.trim().toUpperCase();
    const shelfCode = params.get('shelf')?.trim().toUpperCase();
    const isPair = params.get('pair') === '1' || url.hostname === 'komolib.local';

    if (isPair || paramServer || joinCode || shelfCode) {
      const fallbackOrigin =
        url.hostname !== 'komolib.local' && /^https?:$/i.test(url.protocol)
          ? url.origin.replace(/\/+$/, '')
          : undefined;
      return {
        serverUrl: paramServer || fallbackOrigin,
        spaceId: paramSpace || undefined,
        token: paramToken ?? undefined,
        publicUrl: paramPublic ?? undefined,
        joinCode: joinCode || undefined,
        shelfCode: shelfCode || undefined,
      };
    }

    if (/^https?:$/i.test(url.protocol)) {
      return { serverUrl: url.origin.replace(/\/+$/, '') };
    }
  } catch {
    return null;
  }
  return null;
}

export function buildStreamUrl(config: SyncConfig, path: string): string {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  if (!base) return '';
  const qs = new URLSearchParams();
  if (config.token.trim()) qs.set('token', config.token.trim());
  if (config.spaceId?.trim() && path.startsWith('/api/sync/')) {
    qs.set('space', config.spaceId.trim());
  }
  const queryStr = qs.toString();
  if (!queryStr) return `${base}${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${path}${sep}${queryStr}`;
}

export async function checkServerHealth(config: SyncConfig): Promise<ServerHealth> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const url = `${base}/api/health`;
  const res = await fetchApi(url, {
    headers: buildAuthHeaders(config, false),
  });
  return parseJsonResponse<ServerHealth>(res, url);
}

export async function sendAiChatViaServer(
  config: SyncConfig,
  payload: {
    message: string;
    history: Array<{ sender: 'user' | 'assistant'; text: string }>;
    books: Array<
      Pick<
        BookItem,
        'id' | 'title' | 'author' | 'kind' | 'format' | 'progress' | 'readingStatus' | 'rating' | 'review'
      >
    >;
    notes: Array<{ bookTitle: string; text: string }>;
    annotations?: Array<{ bookTitle: string; chapter?: string; quote: string; note?: string }>;
    activeBook?: Pick<BookItem, 'id' | 'title' | 'author' | 'progress'> | null;
    profileName?: string;
  }
): Promise<AiChatResponse> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const url = `${base}/api/ai/chat`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<AiChatResponse>(res, url);
}

export interface AiIdentifyBookResponse {
  ok: boolean;
  model?: string;
  title?: string;
  author?: string;
  description?: string;
}

export async function identifyBookWithAiApi(
  config: SyncConfig,
  payload: {
    fileName?: string;
    currentTitle?: string;
    currentAuthor?: string;
    currentDescription?: string;
    coverDataUrl?: string;
    textExcerpt?: string;
  }
): Promise<AiIdentifyBookResponse> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const url = `${base}/api/ai/identify-book`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<AiIdentifyBookResponse>(res, url);
}

export async function listInboxFiles(config: SyncConfig): Promise<InboxItem[]> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/inbox`;
  const res = await fetchApi(url, {
    headers: buildAuthHeaders(config, false),
  });
  const data = await parseJsonResponse<{ items?: InboxItem[] }>(res, url);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function downloadInboxFile(
  config: SyncConfig,
  item: InboxItem
): Promise<FileWithRelPath> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(`${base}/api/inbox/${encodeURIComponent(item.id)}/file`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) {
    throw new Error(`No se pudo descargar "${item.originalName}" (${res.status})`);
  }
  const blob = await res.blob();
  const file = new File([blob], item.originalName, {
    type: item.mimeType || blob.type || 'application/octet-stream',
  }) as FileWithRelPath;
  file.__relativePath = item.relativePath || item.originalName;
  return file;
}

export async function deleteInboxFile(config: SyncConfig, id: string): Promise<void> {
  const base = resolveServerUrl(config.serverUrl);
  await fetchApi(`${base}/api/inbox/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  }).catch(() => undefined);
}

export async function fetchFileFromDirectUrl(rawUrl: string): Promise<File> {
  const url = rawUrl.trim();
  const parsed = new URL(url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`El servidor remoto respondió HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') || '';
  const match = disp.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i);
  const fromPath = decodeURIComponent(parsed.pathname.split('/').pop() || '');
  const fileName =
    (match?.[1] ? decodeURIComponent(match[1].replace(/"/g, '')) : fromPath) ||
    'archivo-remoto.epub';
  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
  });
}

function extForImageMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('avif')) return 'avif';
  return 'jpg';
}

export async function uploadBookToServer(
  config: SyncConfig,
  book: BookItem,
  deviceId = ''
): Promise<{ ok: boolean; remoteFileName?: string; format?: BookItem['format'] }> {
  const stored = await dbGetBookFile(book.id);
  let uploadBlob: Blob | null = stored?.blob || null;
  if (!uploadBlob && book.nativeFileUri) {
    uploadBlob = await readNativeUriAsBlob(book.nativeFileUri, book.mimeType);
  }
  if (!uploadBlob) return { ok: false };

  let uploadName = book.fileName || `${book.id}.${book.format}`;
  let uploadMeta: BookItem = book;

  // Pack multi-image folders into a standard CBZ archive so APK & shared rooms receive every page
  if (book.format === 'images' && stored?.extraImages && stored.extraImages.length > 0) {
    const zip = new JSZip();
    for (let i = 0; i < stored.extraImages.length; i++) {
      const img = stored.extraImages[i];
      const ext = extForImageMime(img.type || 'image/jpeg');
      const pad = String(i + 1).padStart(4, '0');
      zip.file(`page_${pad}.${ext}`, img);
    }
    uploadBlob = await zip.generateAsync({ type: 'blob' });
    uploadName = `${book.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || book.id}.cbz`;
    uploadMeta = {
      ...book,
      format: 'cbz',
      fileName: uploadName,
      mimeType: 'application/vnd.comicbook+zip',
    };
  }

  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const url = `${base}/api/books/upload`;
  const { nativeFileUri: _ignoreLocalUri, ...syncableUploadMeta } = uploadMeta;
  const form = new FormData();
  form.append('id', book.id);
  if (deviceId) form.append('deviceId', deviceId);
  form.append('meta', JSON.stringify(syncableUploadMeta));
  form.append('file', uploadBlob, uploadName);

  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
    body: form,
  });
  try {
    const data = await parseJsonResponse<{ remoteFileName?: string }>(res, url);
    return {
      ok: true,
      remoteFileName: data?.remoteFileName,
      format: uploadMeta.format,
    };
  } catch {
    return { ok: false };
  }
}

export async function downloadBookFromServer(config: SyncConfig, book: BookItem): Promise<Blob> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const res = await fetchApi(`${base}/api/books/${encodeURIComponent(book.id)}/file`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo (${res.status})`);
  }
  const blob = await res.blob();
  await dbPutBookFile(book.id, blob);
  return blob;
}

export async function requestBookUploadFromPeer(
  config: SyncConfig,
  book: BookItem,
  requesterDeviceId: string
): Promise<{ ok: boolean; peersNotified: number; totalClients: number }> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const url = `${base}/api/books/${encodeURIComponent(book.id)}/request-upload`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({
      requesterDeviceId,
      fileName: book.fileName,
      title: book.title,
    }),
  });
  return parseJsonResponse<{ ok: boolean; peersNotified: number; totalClients: number }>(res, url);
}

export async function deleteBookFromServer(config: SyncConfig, bookId: string): Promise<void> {
  if (!config.serverUrl.trim() && !config.accountEmail) return;
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  await fetchApi(`${base}/api/books/${encodeURIComponent(bookId)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  }).catch(() => undefined);
}

export async function fetchRemoteSyncState(
  config: SyncConfig,
  sinceUpdatedAt = 0
): Promise<RemoteSyncPayload> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const qs = sinceUpdatedAt > 0 ? `?since=${encodeURIComponent(String(sinceUpdatedAt))}` : '';
  const url = `${base}/api/sync/state${qs}`;
  const res = await fetchApi(url, {
    headers: buildAuthHeaders(config, false),
  });
  return parseJsonResponse<RemoteSyncPayload>(res, url);
}

export async function syncFullState(
  config: SyncConfig,
  localData: {
    deviceId?: string;
    books: BookItem[];
    bookmarks?: BookmarkItem[];
    annotations?: BookAnnotation[];
    notes?: NoteItem[];
    chatSessions?: ChatSession[];
    customBookmarkDesigns?: BookmarkDesign[];
    customStationery?: CustomStationeryKit;
    categories?: CategoryItem[];
    collections?: CollectionCard[];
    readerSettings?: ReaderSettings;
    readerSettingsUpdatedAt?: number;
    theme: ThemeConfig | null;
    themeUpdatedAt?: number;
    profile: UserProfile | null;
    profileUpdatedAt?: number;
    lastActiveSession?: ActiveReadingSession | null;
    deletedBookIds?: string[];
    deletedBookmarkIds?: string[];
    deletedAnnotationIds?: string[];
    deletedNoteIds?: string[];
    deletedBookmarkDesignIds?: string[];
    deletedChatSessionIds?: string[];
    sharedRooms?: SharedRoom[];
    joinedRoomCodes?: string[];
    closedRoomCodes?: string[];
    sharedShelves?: SharedShelf[];
    joinedShelfCodes?: string[];
    closedShelfCodes?: string[];
  },
  uploadMissingFiles = true,
  lightweight = false,
  keepWallpaper = lightweight,
  keepCoverIds?: Set<string>,
  sinceUpdatedAt = 0
): Promise<RemoteSyncPayload> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const booksMap: Record<string, BookItem> = {};
  for (const b of localData.books) {
    if (!b.isDemo) {
      // Never leak device-local Android SAF nativeFileUri to other devices
      const { nativeFileUri: _ignoreLocalUri, ...syncableBook } = b;
      const canOmitCover =
        lightweight &&
        Boolean(syncableBook.coverDataUrl) &&
        syncableBook.coverDataUrl !== '__KEEP__' &&
        (keepCoverIds ? keepCoverIds.has(syncableBook.id) : false);
      booksMap[syncableBook.id] = canOmitCover
        ? { ...syncableBook, coverDataUrl: '__KEEP__' }
        : syncableBook;
    }
  }

  const themePayload =
    localData.theme && keepWallpaper && localData.theme.customWallpaperUrl
      ? { ...localData.theme, customWallpaperUrl: '__KEEP__' }
      : localData.theme;

  const url = `${base}/api/sync/state`;

  // Split large book libraries into safe <= 1.8 MB chunks so Cloudflare / Render Free never drops
  // a huge single PUT payload with "Failed to fetch" (OOM / proxy body limit / mobile timeout).
  const MAX_CHUNK_CHARS = 1_800_000;
  const MAX_CHUNK_BOOKS = 1000;
  const bookEntries = Object.entries(booksMap);
  const bookChunks: Array<Record<string, BookItem>> = [];

  if (bookEntries.length === 0) {
    bookChunks.push({});
  } else {
    let currentChunk: Record<string, BookItem> = {};
    let currentChars = 0;
    let currentCount = 0;
    for (const [id, item] of bookEntries) {
      const approxChars = JSON.stringify(item).length + id.length + 12;
      if (
        currentCount > 0 &&
        (currentChars + approxChars > MAX_CHUNK_CHARS || currentCount >= MAX_CHUNK_BOOKS)
      ) {
        bookChunks.push(currentChunk);
        currentChunk = {};
        currentChars = 0;
        currentCount = 0;
      }
      currentChunk[id] = item;
      currentChars += approxChars;
      currentCount += 1;
    }
    if (currentCount > 0 || bookChunks.length === 0) {
      bookChunks.push(currentChunk);
    }
  }

  // Upload intermediate chunks first with ?partial=1
  for (let i = 0; i < bookChunks.length - 1; i++) {
    const partialUrl = `${url}?partial=1`;
    const partialRes = await fetchApi(partialUrl, {
      method: 'PUT',
      headers: buildAuthHeaders(config, true),
      body: JSON.stringify({
        deviceId: localData.deviceId,
        spaceId: config.spaceId || undefined,
        books: bookChunks[i],
      }),
    });
    if (!partialRes.ok) {
      const errText = await partialRes.text().catch(() => '');
      throw new Error(errText || `Error de sincronización en lote ${i + 1} (${partialRes.status})`);
    }
  }

  const finalBooksChunk = bookChunks[bookChunks.length - 1] || {};
  const res = await fetchApi(url, {
    method: 'PUT',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({
      deviceId: localData.deviceId,
      spaceId: config.spaceId || undefined,
      sinceUpdatedAt: sinceUpdatedAt > 0 ? sinceUpdatedAt : undefined,
      books: finalBooksChunk,
      bookmarks: localData.bookmarks,
      annotations: localData.annotations,
      notes: localData.notes,
      chatSessions: localData.chatSessions,
      customBookmarkDesigns: localData.customBookmarkDesigns,
      customStationery: localData.customStationery ?? null,
      categories: localData.categories,
      collections: localData.collections ?? null,
      readerSettings: localData.readerSettings ?? null,
      readerSettingsUpdatedAt: localData.readerSettingsUpdatedAt || 0,
      theme: themePayload,
      themeUpdatedAt: localData.themeUpdatedAt || 0,
      profile: localData.profile,
      profileUpdatedAt: localData.profileUpdatedAt || 0,
      lastActiveSession: localData.lastActiveSession || null,
      deletedBookIds: localData.deletedBookIds || [],
      deletedBookmarkIds: localData.deletedBookmarkIds || [],
      deletedAnnotationIds: localData.deletedAnnotationIds || [],
      deletedNoteIds: localData.deletedNoteIds || [],
      deletedBookmarkDesignIds: localData.deletedBookmarkDesignIds || [],
      deletedChatSessionIds: localData.deletedChatSessionIds || [],
      sharedRooms: localData.sharedRooms,
      joinedRoomCodes: localData.joinedRoomCodes,
      closedRoomCodes: localData.closedRoomCodes,
      sharedShelves: localData.sharedShelves,
      joinedShelfCodes: localData.joinedShelfCodes,
      closedShelfCodes: localData.closedShelfCodes,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Error de sincronización (${res.status})`);
  }

  const merged = await parseJsonResponse<RemoteSyncPayload>(res, url);

  if (uploadMissingFiles) {
    // Upload up to 5 missing small/recent files during quick state sync so large 1,000+ libraries
    // never stall "Guardar ahora" (bulk offline sync & live SSE relay handle the rest).
    const candidates = localData.books
      .filter((book) => {
        const remoteEntry = merged.books[book.id];
        return (
          book.hasLocalFile &&
          !book.isDemo &&
          !remoteEntry?.hasRemoteFile &&
          (!book.fileSize || book.fileSize <= 25 * 1024 * 1024)
        );
      })
      .sort((a, b) => (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0))
      .slice(0, 5);

    for (const book of candidates) {
      const up: { ok: boolean; remoteFileName?: string; format?: BookItem['format'] } =
        await uploadBookToServer(config, book, localData.deviceId).catch(() => ({
          ok: false,
        }));
      if (up.ok && merged.books[book.id]) {
        merged.books[book.id] = {
          ...merged.books[book.id],
          hasRemoteFile: true,
          remoteFileName: up.remoteFileName || merged.books[book.id].remoteFileName,
          format: up.format || merged.books[book.id].format,
        };
      }
    }
  }

  return merged;
}

export interface FileUploadRequestEvent {
  bookId: string;
  fileName?: string;
  title?: string;
  requesterDeviceId?: string;
  requestedAt?: number;
}

export function subscribeToSyncStream(
  config: SyncConfig,
  onSyncUpdate: (event: { sourceDeviceId: string; updatedAt: number }) => void,
  onStatusChange?: (connected: boolean) => void,
  onFileUploadRequest?: (event: FileUploadRequestEvent) => void
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const url = buildStreamUrl(config, '/api/sync/stream');
  if (!url) return () => undefined;

  const es = new EventSource(url);
  const handleConnected = () => onStatusChange?.(true);
  const handleOpen = () => onStatusChange?.(true);
  const handleError = () => onStatusChange?.(false);
  const handler = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data);
      onSyncUpdate(parsed);
    } catch {
      // ignore malformed
    }
  };
  const uploadReqHandler = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as FileUploadRequestEvent;
      if (parsed?.bookId) onFileUploadRequest?.(parsed);
    } catch {
      // ignore malformed
    }
  };
  es.addEventListener('open', handleOpen);
  es.addEventListener('connected', handleConnected);
  es.addEventListener('error', handleError);
  es.addEventListener('sync_update', handler as EventListener);
  es.addEventListener('file_upload_requested', uploadReqHandler as EventListener);
  return () => {
    es.removeEventListener('open', handleOpen);
    es.removeEventListener('connected', handleConnected);
    es.removeEventListener('error', handleError);
    es.removeEventListener('sync_update', handler as EventListener);
    es.removeEventListener('file_upload_requested', uploadReqHandler as EventListener);
    es.close();
    onStatusChange?.(false);
  };
}
