import JSZip from 'jszip';
import type {
  ActiveReadingSession,
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  CategoryItem,
  CollectionCard,
  ContentKind,
  CustomStationeryKit,
  NoteItem,
  ReaderSettings,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';
import { dbGetBookFile, dbPutBookFile } from '../db/localDb';
import type { FileWithRelPath } from '../utils/fileFolderImport';

export interface ServerHealth {
  ok: boolean;
  service: string;
  version: string;
  booksCount: number;
  inboxCount?: number;
  roomsCount?: number;
  updatedAt: number;
  authRequired: boolean;
  isOwnerNetwork?: boolean;
  ownerSpaceId?: string;
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
  customBookmarkDesigns?: BookmarkDesign[];
  customStationery?: CustomStationeryKit | null;
  categories: CategoryItem[] | null;
  collections?: CollectionCard[] | null;
  readerSettings?: ReaderSettings | null;
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
}

/**
 * Deterministically derives a private cloud vault ID (`acct_<hex>`) from an email + optional PIN
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
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (
    typeof window !== 'undefined' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed) &&
    window.location.hostname &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
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
  const res = await fetch(`${base}/api/health`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
  const res = await fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listInboxFiles(config: SyncConfig): Promise<InboxItem[]> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetch(`${base}/api/inbox`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

export async function downloadInboxFile(
  config: SyncConfig,
  item: InboxItem
): Promise<FileWithRelPath> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetch(`${base}/api/inbox/${encodeURIComponent(item.id)}/file`, {
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
  await fetch(`${base}/api/inbox/${encodeURIComponent(id)}`, {
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
  if (!stored) return { ok: false };

  let uploadBlob: Blob = stored.blob;
  let uploadName = book.fileName || `${book.id}.${book.format}`;
  let uploadMeta: BookItem = book;

  // Pack multi-image folders into a standard CBZ archive so APK & shared rooms receive every page
  if (book.format === 'images' && stored.extraImages && stored.extraImages.length > 0) {
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
  const form = new FormData();
  form.append('id', book.id);
  if (deviceId) form.append('deviceId', deviceId);
  form.append('meta', JSON.stringify(uploadMeta));
  form.append('file', uploadBlob, uploadName);

  const res = await fetch(`${base}/api/books/upload`, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
    body: form,
  });
  if (!res.ok) return { ok: false };
  const data = await res.json().catch(() => ({}));
  return {
    ok: true,
    remoteFileName: data?.remoteFileName,
    format: uploadMeta.format,
  };
}

export async function downloadBookFromServer(config: SyncConfig, book: BookItem): Promise<Blob> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const res = await fetch(`${base}/api/books/${encodeURIComponent(book.id)}/file`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo (${res.status})`);
  }
  const blob = await res.blob();
  await dbPutBookFile(book.id, blob);
  return blob;
}

export async function deleteBookFromServer(config: SyncConfig, bookId: string): Promise<void> {
  if (!config.serverUrl.trim() && !config.accountEmail) return;
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  await fetch(`${base}/api/books/${encodeURIComponent(bookId)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  }).catch(() => undefined);
}

export async function fetchRemoteSyncState(config: SyncConfig): Promise<RemoteSyncPayload> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const res = await fetch(`${base}/api/sync/state`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function syncFullState(
  config: SyncConfig,
  localData: {
    deviceId?: string;
    books: BookItem[];
    bookmarks: BookmarkItem[];
    annotations?: BookAnnotation[];
    notes: NoteItem[];
    customBookmarkDesigns?: BookmarkDesign[];
    customStationery?: CustomStationeryKit;
    categories: CategoryItem[];
    collections?: CollectionCard[];
    readerSettings?: ReaderSettings;
    theme: ThemeConfig;
    themeUpdatedAt?: number;
    profile: UserProfile;
    profileUpdatedAt?: number;
    lastActiveSession?: ActiveReadingSession | null;
    deletedBookIds?: string[];
    deletedBookmarkIds?: string[];
    deletedAnnotationIds?: string[];
    deletedNoteIds?: string[];
    deletedBookmarkDesignIds?: string[];
  },
  uploadMissingFiles = true,
  lightweight = false
): Promise<RemoteSyncPayload> {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const booksMap: Record<string, BookItem> = {};
  for (const b of localData.books) {
    if (!b.isDemo) {
      booksMap[b.id] =
        lightweight && b.hasRemoteFile && b.coverDataUrl
          ? { ...b, coverDataUrl: '__KEEP__' }
          : b;
    }
  }

  const themePayload =
    lightweight && localData.theme?.customWallpaperUrl
      ? { ...localData.theme, customWallpaperUrl: '__KEEP__' }
      : localData.theme;

  const res = await fetch(`${base}/api/sync/state`, {
    method: 'PUT',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({
      deviceId: localData.deviceId,
      spaceId: config.spaceId || undefined,
      books: booksMap,
      bookmarks: localData.bookmarks,
      annotations: localData.annotations || [],
      notes: localData.notes,
      customBookmarkDesigns: localData.customBookmarkDesigns || [],
      customStationery: localData.customStationery || null,
      categories: localData.categories,
      collections: localData.collections || null,
      readerSettings: localData.readerSettings || null,
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
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Error de sincronización (${res.status})`);
  }

  const merged: RemoteSyncPayload = await res.json();

  if (uploadMissingFiles) {
    for (const book of localData.books) {
      const remoteEntry = merged.books[book.id];
      if (book.hasLocalFile && !book.isDemo && !remoteEntry?.hasRemoteFile) {
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
  }

  return merged;
}

export function subscribeToSyncStream(
  config: SyncConfig,
  onSyncUpdate: (event: { sourceDeviceId: string; updatedAt: number }) => void,
  onStatusChange?: (connected: boolean) => void
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
  es.addEventListener('open', handleOpen);
  es.addEventListener('connected', handleConnected);
  es.addEventListener('error', handleError);
  es.addEventListener('sync_update', handler as EventListener);
  return () => {
    es.removeEventListener('open', handleOpen);
    es.removeEventListener('connected', handleConnected);
    es.removeEventListener('error', handleError);
    es.removeEventListener('sync_update', handler as EventListener);
    es.close();
    onStatusChange?.(false);
  };
}
