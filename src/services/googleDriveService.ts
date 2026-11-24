import JSZip from 'jszip';
import type {
  ActiveReadingSession,
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  CategoryItem,
  ChatSession,
  CollectionCard,
  CustomStationeryKit,
  GoogleDriveAuth,
  NoteItem,
  ReaderSettings,
  SharedRoom,
  SharedShelf,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';
import { dbGetBookFile, dbPutBookFile } from '../db/localDb';
import { readNativeUriAsBlob } from '../utils/nativeBridge';
import { isRasterCoverDataUrl } from '../utils/coverHelpers';
import {
  fetchApi,
  parseJsonResponse,
  resolveServerUrl,
  type RemoteSyncPayload,
} from './syncService';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const KOMOLIB_ROOT_FOLDER_NAME = 'Komolib';
const KOMOLIB_BOOKS_FOLDER_NAME = 'Libros';
const KOMOLIB_STATE_FILE_NAME = 'komolib-state.json';

// In-memory speed caches: eliminate redundant folder checks & multi-MB state downloads when Drive hasn't changed!
const verifiedFoldersCache = new Map<string, { rootFolderId: string; booksFolderId: string; verifiedAt: number }>();
let lastDriveStateCache: {
  email: string;
  fileId: string;
  modifiedTime: string;
  state: RemoteSyncPayload;
} | null = null;

export function clearGoogleDriveMemoryCache(): void {
  verifiedFoldersCache.clear();
  lastDriveStateCache = null;
}

export type DriveSyncProgressCallback = (pct: number, detail: string) => void;

function base64UrlDecodeUtf8(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function parseGoogleAuthPayloadString(rawEncoded: string): GoogleDriveAuth | null {
  try {
    const clean = rawEncoded.trim();
    if (!clean) return null;
    const json = base64UrlDecodeUtf8(clean);
    const parsed = JSON.parse(json) as Partial<GoogleDriveAuth> & { error?: string };
    if (parsed.error || !parsed.accessToken || !parsed.email) return null;
    return {
      email: parsed.email.trim().toLowerCase(),
      name: parsed.name || parsed.email.split('@')[0] || 'Lector Komolib',
      picture: parsed.picture || '',
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken || '',
      expiresAt: parsed.expiresAt || Date.now() + 55 * 60 * 1000,
    };
  } catch {
    return null;
  }
}

export function buildGoogleOAuthStartUrl(
  config: SyncConfig,
  platform: 'android' | 'desktop' | 'web',
  opts?: { loginHint?: string; forceConsent?: boolean; switchAccount?: boolean }
): string {
  const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
  const params = new URLSearchParams();
  params.set('platform', platform === 'desktop' ? 'web' : platform);
  if (platform === 'desktop' && typeof window !== 'undefined') {
    params.set('returnTo', `${window.location.origin}/oauth-bridge`);
  } else if (platform === 'web' && typeof window !== 'undefined') {
    params.set('returnTo', `${window.location.origin}${window.location.pathname}`);
  }
  if (opts?.loginHint?.trim()) {
    params.set('loginHint', opts.loginHint.trim().toLowerCase());
  }
  if (opts?.forceConsent) {
    params.set('forceConsent', '1');
  }
  if (opts?.switchAccount) {
    params.set('switchAccount', '1');
  }
  return `${base}/api/google/start?${params.toString()}`;
}

// Single-flight deduplication so concurrent Drive operations never fire duplicate /api/google/refresh calls
const inFlightGoogleRefresh = new Map<string, Promise<GoogleDriveAuth>>();

export async function refreshGoogleAccessToken(
  config: SyncConfig,
  auth: GoogleDriveAuth
): Promise<GoogleDriveAuth> {
  const cleanRefresh = (auth.refreshToken || '').trim();
  const cleanEmail = (auth.email || '').trim().toLowerCase();
  if (!cleanRefresh && !cleanEmail) {
    throw new Error('Tu sesión de Google Drive expiró. Vuelve a pulsar "Conectar con Google Drive".');
  }
  const key = cleanRefresh || `email:${cleanEmail}`;
  const existing = inFlightGoogleRefresh.get(key);
  if (existing) {
    return existing;
  }

  const task = (async (): Promise<GoogleDriveAuth> => {
    const base = resolveServerUrl(config.serverUrl || 'http://localhost:4123');
    const url = `${base}/api/google/refresh`;
    const res = await fetchApi(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: cleanRefresh,
        email: cleanEmail,
      }),
    });
    const data = await parseJsonResponse<{
      accessToken?: string;
      expiresAt?: number;
      refreshToken?: string;
      error?: string;
    }>(res, url);
    if (!data.accessToken) {
      throw new Error(data.error || 'No se pudo renovar el acceso a Google Drive.');
    }
    return {
      ...auth,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || cleanRefresh,
      expiresAt: data.expiresAt || Date.now() + 55 * 60 * 1000,
    };
  })();

  inFlightGoogleRefresh.set(key, task);
  try {
    return await task;
  } finally {
    inFlightGoogleRefresh.delete(key);
  }
}

export async function ensureFreshDriveAuth(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  onUpdated?: (next: GoogleDriveAuth) => void
): Promise<GoogleDriveAuth> {
  if (auth.accessToken && auth.expiresAt > Date.now() + 90_000) {
    return auth;
  }
  const refreshed = await refreshGoogleAccessToken(config, auth);
  onUpdated?.(refreshed);
  return refreshed;
}

async function driveFetch(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  url: string,
  init: RequestInit = {},
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<{ res: Response; auth: GoogleDriveAuth }> {
  let current = await ensureFreshDriveAuth(config, auth, onAuthUpdated);
  const makeHeaders = (token: string) => {
    const h = new Headers(init.headers || {});
    h.set('Authorization', `Bearer ${token}`);
    return h;
  };

  let res = await fetch(url, { ...init, headers: makeHeaders(current.accessToken) });
  if (res.status === 401 && (current.refreshToken || current.email)) {
    current = await refreshGoogleAccessToken(config, current);
    onAuthUpdated?.(current);
    res = await fetch(url, { ...init, headers: makeHeaders(current.accessToken) });
  }
  return { res, auth: current };
}

function escapeDriveQuery(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findDriveFileByQuery(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  q: string,
  onAuthUpdated?: (next: GoogleDriveAuth) => void,
  orderBy = 'modifiedTime desc'
): Promise<{
  file: { id: string; name: string; modifiedTime?: string; parents?: string[] } | null;
  auth: GoogleDriveAuth;
}> {
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime,parents)',
    pageSize: '5',
    orderBy,
    spaces: 'drive',
  });
  const { res, auth: nextAuth } = await driveFetch(
    config,
    auth,
    `${DRIVE_API}/files?${params.toString()}`,
    { method: 'GET', cache: 'no-store' },
    onAuthUpdated
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Error al consultar Google Drive (${res.status}): ${errText.slice(0, 140)}`);
  }
  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; modifiedTime?: string; parents?: string[] }>;
  };
  return { file: data.files?.[0] || null, auth: nextAuth };
}

async function createDriveFolder(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  name: string,
  parentId?: string,
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<{ id: string; auth: GoogleDriveAuth }> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) metadata.parents = [parentId];

  const { res, auth: nextAuth } = await driveFetch(
    config,
    auth,
    `${DRIVE_API}/files?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    },
    onAuthUpdated
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`No se pudo crear la carpeta "${name}" en Drive (${res.status}): ${errText.slice(0, 140)}`);
  }
  const created = (await res.json()) as { id: string };
  return { id: created.id, auth: nextAuth };
}

/**
 * Ensures `Komolib/` and `Komolib/Libros/` exist inside the user's personal Google Drive.
 */
export async function ensureKomolibDriveFolders(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<GoogleDriveAuth> {
  let cur = auth;
  const cacheKey = (cur.email || '').toLowerCase();
  const cached = cacheKey ? verifiedFoldersCache.get(cacheKey) : undefined;
  if (
    cached &&
    Date.now() - cached.verifiedAt < 10 * 60 * 1000 &&
    cur.rootFolderId === cached.rootFolderId &&
    cur.booksFolderId === cached.booksFolderId
  ) {
    return cur;
  }

  // Verify or find/create root `Komolib` folder
  let rootId = cur.rootFolderId || '';
  if (rootId) {
    const check = await driveFetch(
      config,
      cur,
      `${DRIVE_API}/files/${encodeURIComponent(rootId)}?fields=id,trashed`,
      { method: 'GET' },
      onAuthUpdated
    );
    cur = check.auth;
    if (check.res.ok) {
      const meta = (await check.res.json().catch(() => ({}))) as { trashed?: boolean };
      if (meta.trashed) rootId = '';
    } else {
      rootId = '';
    }
  }
  if (!rootId) {
    // Prefer the folder that already holds the newest komolib-state.json so two devices NEVER split-brain
    const existingState = await findDriveFileByQuery(
      config,
      cur,
      `name='${escapeDriveQuery(KOMOLIB_STATE_FILE_NAME)}' and trashed=false`,
      onAuthUpdated,
      'modifiedTime desc'
    );
    cur = existingState.auth;
    if (existingState.file?.id) {
      cur = { ...cur, stateFileId: existingState.file.id };
      if (existingState.file.parents?.[0]) {
        rootId = existingState.file.parents[0];
      }
    }
  }
  if (!rootId) {
    const found = await findDriveFileByQuery(
      config,
      cur,
      `name='${escapeDriveQuery(KOMOLIB_ROOT_FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      onAuthUpdated,
      'createdTime asc'
    );
    cur = found.auth;
    if (found.file?.id) {
      rootId = found.file.id;
    } else {
      const created = await createDriveFolder(config, cur, KOMOLIB_ROOT_FOLDER_NAME, undefined, onAuthUpdated);
      cur = created.auth;
      rootId = created.id;
    }
  }

  // Verify or find/create subfolder `Komolib/Libros`
  let booksFolderId = cur.booksFolderId || '';
  if (booksFolderId) {
    const check = await driveFetch(
      config,
      cur,
      `${DRIVE_API}/files/${encodeURIComponent(booksFolderId)}?fields=id,trashed`,
      { method: 'GET' },
      onAuthUpdated
    );
    cur = check.auth;
    if (check.res.ok) {
      const meta = (await check.res.json().catch(() => ({}))) as { trashed?: boolean };
      if (meta.trashed) booksFolderId = '';
    } else {
      booksFolderId = '';
    }
  }
  if (!booksFolderId) {
    const found = await findDriveFileByQuery(
      config,
      cur,
      `name='${escapeDriveQuery(KOMOLIB_BOOKS_FOLDER_NAME)}' and '${escapeDriveQuery(rootId)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      onAuthUpdated
    );
    cur = found.auth;
    if (found.file?.id) {
      booksFolderId = found.file.id;
    } else {
      const created = await createDriveFolder(config, cur, KOMOLIB_BOOKS_FOLDER_NAME, rootId, onAuthUpdated);
      cur = created.auth;
      booksFolderId = created.id;
    }
  }

  const updated: GoogleDriveAuth = {
    ...cur,
    rootFolderId: rootId,
    booksFolderId,
  };
  if (cacheKey) {
    verifiedFoldersCache.set(cacheKey, {
      rootFolderId: rootId,
      booksFolderId,
      verifiedAt: Date.now(),
    });
  }
  if (updated.rootFolderId !== auth.rootFolderId || updated.booksFolderId !== auth.booksFolderId) {
    onAuthUpdated?.(updated);
  }
  return updated;
}

export async function getGoogleDriveStateVersion(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<{ fileId: string; modifiedTime: string; auth: GoogleDriveAuth }> {
  let cur = auth;
  // Query the latest komolib-state.json across app-created Drive files (guarantees cross-device convergence!)
  const latest = await findDriveFileByQuery(
    config,
    cur,
    `name='${escapeDriveQuery(KOMOLIB_STATE_FILE_NAME)}' and trashed=false`,
    onAuthUpdated,
    'modifiedTime desc'
  );
  cur = latest.auth;
  if (latest.file?.id) {
    const nextRoot = latest.file.parents?.[0] || cur.rootFolderId;
    if (latest.file.id !== cur.stateFileId || (nextRoot && nextRoot !== cur.rootFolderId)) {
      cur = { ...cur, stateFileId: latest.file.id, ...(nextRoot ? { rootFolderId: nextRoot } : {}) };
      onAuthUpdated?.(cur);
    }
    return {
      fileId: latest.file.id,
      modifiedTime: latest.file.modifiedTime || '',
      auth: cur,
    };
  }
  return { fileId: '', modifiedTime: '', auth: cur };
}

export async function pullStateFromGoogleDrive(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  onAuthUpdated?: (next: GoogleDriveAuth) => void,
  onProgress?: DriveSyncProgressCallback
): Promise<{ state: RemoteSyncPayload | null; modifiedTime: string; fromCache?: boolean; auth: GoogleDriveAuth }> {
  onProgress?.(12, 'Verificando carpeta Komolib en Google Drive...');
  let cur = await ensureKomolibDriveFolders(config, auth, onAuthUpdated);

  // Always check for the newest komolib-state.json so Tablet & Phone never read different copies
  onProgress?.(24, 'Comprobando versión en Google Drive...');
  const version = await getGoogleDriveStateVersion(config, cur, onAuthUpdated);
  cur = version.auth;
  const stateFileId = version.fileId || cur.stateFileId || '';

  if (!stateFileId) {
    return { state: null, modifiedTime: '', auth: cur };
  }

  // Ultra-fast path: Drive modifiedTime matches our in-memory snapshot -> skip downloading multi-MB JSON!
  if (
    lastDriveStateCache &&
    lastDriveStateCache.email === cur.email &&
    lastDriveStateCache.fileId === stateFileId &&
    version.modifiedTime &&
    lastDriveStateCache.modifiedTime === version.modifiedTime
  ) {
    onProgress?.(45, 'Versión remota al día (caché local)...');
    return {
      state: lastDriveStateCache.state,
      modifiedTime: version.modifiedTime,
      fromCache: true,
      auth: cur,
    };
  }

  onProgress?.(38, 'Descargando datos desde Google Drive...');
  const dl = await driveFetch(
    config,
    cur,
    `${DRIVE_API}/files/${encodeURIComponent(stateFileId)}?alt=media`,
    { method: 'GET', cache: 'no-store' },
    onAuthUpdated
  );
  cur = dl.auth;
  if (dl.res.status === 404) {
    cur = { ...cur, stateFileId: '' };
    verifiedFoldersCache.delete((cur.email || '').toLowerCase());
    if (lastDriveStateCache?.fileId === stateFileId) lastDriveStateCache = null;
    onAuthUpdated?.(cur);
    return { state: null, modifiedTime: '', auth: cur };
  }
  if (!dl.res.ok) {
    const errText = await dl.res.text().catch(() => '');
    throw new Error(`No se pudo leer Komolib/komolib-state.json (${dl.res.status}): ${errText.slice(0, 120)}`);
  }
  const text = await dl.res.text();
  if (!text.trim()) return { state: null, modifiedTime: version.modifiedTime, auth: cur };
  try {
    const parsed = JSON.parse(text) as RemoteSyncPayload;
    if (version.modifiedTime) {
      lastDriveStateCache = {
        email: cur.email,
        fileId: stateFileId,
        modifiedTime: version.modifiedTime,
        state: parsed,
      };
    }
    onProgress?.(55, 'Datos descargados de Google Drive...');
    return { state: parsed, modifiedTime: version.modifiedTime, auth: cur };
  } catch {
    return { state: null, modifiedTime: version.modifiedTime, auth: cur };
  }
}

function mergeSyncStatesClientSide(
  remote: RemoteSyncPayload | null,
  localData: {
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
  }
): RemoteSyncPayload {
  const current: RemoteSyncPayload = remote || {
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

  const mergeTombstones = (a: string[] = [], b: string[] = []) =>
    Array.from(new Set([...a, ...b])).slice(-500);

  const deletedBookIds = mergeTombstones(current.deletedBookIds, localData.deletedBookIds);
  const deletedBookmarkIds = mergeTombstones(current.deletedBookmarkIds, localData.deletedBookmarkIds);
  const deletedAnnotationIds = mergeTombstones(current.deletedAnnotationIds, localData.deletedAnnotationIds);
  const deletedNoteIds = mergeTombstones(current.deletedNoteIds, localData.deletedNoteIds);
  const deletedBookmarkDesignIds = mergeTombstones(
    current.deletedBookmarkDesignIds,
    localData.deletedBookmarkDesignIds
  );
  const deletedChatSessionIds = mergeTombstones(
    current.deletedChatSessionIds,
    localData.deletedChatSessionIds
  );

  const incomingDeletedBooksSet = new Set(localData.deletedBookIds || []);
  const deletedBooksSet = new Set(deletedBookIds);
  const deletedBookmarksSet = new Set(deletedBookmarkIds);
  const deletedAnnotationsSet = new Set(deletedAnnotationIds);
  const deletedNotesSet = new Set(deletedNoteIds);
  const deletedDesignsSet = new Set(deletedBookmarkDesignIds);
  const deletedChatsSet = new Set(deletedChatSessionIds);

  const mergedBooks: Record<string, BookItem> = {};
  for (const [id, b] of Object.entries(current.books || {})) {
    if (b && !b.isDemo && !incomingDeletedBooksSet.has(id)) {
      mergedBooks[id] = b;
    }
  }

  for (const rawBook of localData.books || []) {
    if (!rawBook || rawBook.isDemo) continue;
    if (incomingDeletedBooksSet.has(rawBook.id)) continue;
    if (deletedBooksSet.has(rawBook.id) && !current.books?.[rawBook.id]) continue;

    const { nativeFileUri: _ignoreLocalUri, ...book } = rawBook;
    const prev = mergedBooks[book.id];
    const prevHasRaster = isRasterCoverDataUrl(prev?.coverDataUrl);
    const incHasRaster = isRasterCoverDataUrl(book.coverDataUrl);
    const incomingNewer = !prev || (book.updatedAt || 0) >= (prev.updatedAt || 0);

    if (incomingNewer) {
      let resolvedCover =
        book.coverDataUrl === '__KEEP__'
          ? prev?.coverDataUrl || ''
          : book.coverDataUrl || prev?.coverDataUrl || '';
      let resolvedHasOriginal = book.hasOriginalCover;
      let resolvedSpine = book.spineColor || prev?.spineColor || '#4c6c8a';
      let resolvedRibbon = book.ribbonColor || prev?.ribbonColor || '#f2ba59';

      if (prevHasRaster && !incHasRaster && book.hasOriginalCover !== false && prev) {
        resolvedCover = prev.coverDataUrl;
        resolvedHasOriginal = true;
        resolvedSpine = prev.spineColor || resolvedSpine;
        resolvedRibbon = prev.ribbonColor || resolvedRibbon;
      } else if (incHasRaster && resolvedHasOriginal === undefined) {
        resolvedHasOriginal = true;
      }

      mergedBooks[book.id] = {
        ...prev,
        ...book,
        coverDataUrl: resolvedCover,
        hasOriginalCover: resolvedHasOriginal,
        spineColor: resolvedSpine,
        ribbonColor: resolvedRibbon,
        driveFileId: book.driveFileId || prev?.driveFileId,
        hasRemoteFile: Boolean(prev?.hasRemoteFile || book.hasRemoteFile || book.driveFileId || prev?.driveFileId),
        remoteFileName: prev?.remoteFileName || book.remoteFileName,
      };
    } else if (prev) {
      mergedBooks[book.id] = {
        ...prev,
        driveFileId: prev.driveFileId || book.driveFileId,
        hasRemoteFile: Boolean(prev.hasRemoteFile || book.hasRemoteFile || prev.driveFileId || book.driveFileId),
        ...(incHasRaster && !prevHasRaster
          ? {
              coverDataUrl: book.coverDataUrl,
              hasOriginalCover: true,
              spineColor: book.spineColor || prev.spineColor,
              ribbonColor: book.ribbonColor || prev.ribbonColor,
            }
          : {}),
      };
    }
  }

  for (const id of incomingDeletedBooksSet) {
    delete mergedBooks[id];
  }

  const mergeById = <T extends { id: string; updatedAt?: number; createdAt?: number }>(
    a: T[] = [],
    b: T[] | undefined,
    delSet: Set<string>
  ): T[] => {
    if (!b) return a.filter((x) => x?.id && !delSet.has(x.id));
    const map = new Map<string, T>();
    for (const item of a) {
      if (item?.id && !delSet.has(item.id)) map.set(item.id, item);
    }
    for (const item of b) {
      if (!item?.id || delSet.has(item.id)) continue;
      const prev = map.get(item.id);
      if (!prev || (item.updatedAt || item.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  };

  const incomingThemeTs = Number(localData.themeUpdatedAt || 0);
  const currentThemeTs = Number(current.themeUpdatedAt || 0);
  const useIncomingTheme = Boolean(
    localData.theme && (!current.theme || (incomingThemeTs > 0 && incomingThemeTs >= currentThemeTs))
  );
  const resolvedTheme =
    useIncomingTheme && localData.theme
      ? {
          ...localData.theme,
          customWallpaperUrl:
            localData.theme.customWallpaperUrl === '__KEEP__'
              ? current.theme?.customWallpaperUrl || ''
              : localData.theme.customWallpaperUrl,
        }
      : current.theme;

  const incomingProfileTs = Number(localData.profileUpdatedAt || 0);
  const currentProfileTs = Number(current.profileUpdatedAt || 0);
  const useIncomingProfile = Boolean(
    localData.profile && (!current.profile || (incomingProfileTs > 0 && incomingProfileTs >= currentProfileTs))
  );

  const incomingReaderTs = Number(localData.readerSettingsUpdatedAt || 0);
  const currentReaderTs = Number(current.readerSettingsUpdatedAt || 0);
  const useIncomingReaderSettings = Boolean(
    localData.readerSettings &&
      (!current.readerSettings || (incomingReaderTs > 0 && incomingReaderTs >= currentReaderTs))
  );

  const incomingSession = localData.lastActiveSession;
  const currentSession = current.lastActiveSession;
  const mergedSession =
    incomingSession && (!currentSession || (incomingSession.updatedAt || 0) >= (currentSession.updatedAt || 0))
      ? incomingSession
      : currentSession || null;

  const normCode = (c?: string) => String(c || '').trim().toUpperCase();
  const closedRoomCodes = Array.from(
    new Set([...(current.closedRoomCodes || []), ...(localData.closedRoomCodes || [])].map(normCode).filter(Boolean))
  ).slice(-100);
  const closedRoomSet = new Set(closedRoomCodes);
  const mergedRoomsMap = new Map<string, SharedRoom>();
  for (const r of current.sharedRooms || []) {
    const code = normCode(r?.code);
    if (code && !closedRoomSet.has(code)) mergedRoomsMap.set(code, r);
  }
  for (const r of localData.sharedRooms || []) {
    const code = normCode(r?.code);
    if (!code || closedRoomSet.has(code)) continue;
    const prev = mergedRoomsMap.get(code);
    if (!prev || (r.updatedAt || r.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
      mergedRoomsMap.set(code, r);
    }
  }
  const mergedSharedRooms = Array.from(mergedRoomsMap.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 40);
  const mergedJoinedRoomCodes = Array.from(
    new Set(
      [
        ...(current.joinedRoomCodes || []),
        ...(localData.joinedRoomCodes || []),
        ...mergedSharedRooms.map((r) => r.code),
      ]
        .map(normCode)
        .filter((c) => c && !closedRoomSet.has(c))
    )
  ).slice(0, 40);

  const closedShelfCodes = Array.from(
    new Set([...(current.closedShelfCodes || []), ...(localData.closedShelfCodes || [])].map(normCode).filter(Boolean))
  ).slice(-100);
  const closedShelfSet = new Set(closedShelfCodes);
  const mergedShelvesMap = new Map<string, SharedShelf>();
  for (const sh of current.sharedShelves || []) {
    const code = normCode(sh?.code);
    if (code && !closedShelfSet.has(code)) mergedShelvesMap.set(code, sh);
  }
  for (const sh of localData.sharedShelves || []) {
    const code = normCode(sh?.code);
    if (!code || closedShelfSet.has(code)) continue;
    const prev = mergedShelvesMap.get(code);
    if (!prev || (sh.updatedAt || sh.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
      mergedShelvesMap.set(code, sh);
    }
  }
  const mergedSharedShelves = Array.from(mergedShelvesMap.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 40);
  const mergedJoinedShelfCodes = Array.from(
    new Set(
      [
        ...(current.joinedShelfCodes || []),
        ...(localData.joinedShelfCodes || []),
        ...mergedSharedShelves.map((sh) => sh.code),
      ]
        .map(normCode)
        .filter((c) => c && !closedShelfSet.has(c))
    )
  ).slice(0, 40);

  return {
    updatedAt: Date.now(),
    books: mergedBooks,
    bookmarks: mergeById(current.bookmarks, localData.bookmarks, deletedBookmarksSet),
    annotations: mergeById(current.annotations || [], localData.annotations, deletedAnnotationsSet),
    notes: mergeById(current.notes, localData.notes, deletedNotesSet),
    chatSessions: mergeById(current.chatSessions || [], localData.chatSessions, deletedChatsSet)
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 60),
    customBookmarkDesigns: mergeById(
      current.customBookmarkDesigns || [],
      localData.customBookmarkDesigns,
      deletedDesignsSet
    ),
    customStationery: localData.customStationery || current.customStationery || null,
    categories: localData.categories || current.categories || null,
    collections: localData.collections || current.collections || null,
    readerSettings: useIncomingReaderSettings ? localData.readerSettings : current.readerSettings || null,
    readerSettingsUpdatedAt: useIncomingReaderSettings ? incomingReaderTs : currentReaderTs,
    theme: resolvedTheme,
    themeUpdatedAt: useIncomingTheme ? incomingThemeTs : currentThemeTs,
    profile: useIncomingProfile ? localData.profile : current.profile,
    profileUpdatedAt: useIncomingProfile ? incomingProfileTs : currentProfileTs,
    lastActiveSession: mergedSession,
    deletedBookIds,
    deletedBookmarkIds,
    deletedAnnotationIds,
    deletedNoteIds,
    deletedBookmarkDesignIds,
    deletedChatSessionIds,
    sharedRooms: mergedSharedRooms,
    joinedRoomCodes: mergedJoinedRoomCodes,
    closedRoomCodes,
    sharedShelves: mergedSharedShelves,
    joinedShelfCodes: mergedJoinedShelfCodes,
    closedShelfCodes,
  };
}

/**
 * Pulls latest `Komolib/komolib-state.json` from Google Drive, merges changes cleanly,
 * and writes it back directly to Google Drive (0% load on Render!).
 */
export async function syncStateWithGoogleDrive(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  localData: Parameters<typeof mergeSyncStatesClientSide>[1],
  onAuthUpdated?: (next: GoogleDriveAuth) => void,
  onProgress?: DriveSyncProgressCallback,
  skipUploadIfNoLocalChanges = false
): Promise<{ merged: RemoteSyncPayload; modifiedTime: string; auth: GoogleDriveAuth }> {
  const pulled = await pullStateFromGoogleDrive(config, auth, onAuthUpdated, onProgress);
  let cur = pulled.auth;

  // Fast exit: if caller has zero local mutations and Drive already has state, no need to re-upload!
  if (skipUploadIfNoLocalChanges && pulled.state) {
    onProgress?.(85, 'Aplicando datos sincronizados...');
    return { merged: pulled.state, modifiedTime: pulled.modifiedTime, auth: cur };
  }

  onProgress?.(60, 'Combinando libros, progreso y personalización...');
  const merged = mergeSyncStatesClientSide(pulled.state, localData);
  const bodyJson = JSON.stringify(merged);
  const bodyBytes = new TextEncoder().encode(bodyJson);
  const sizeMb = (bodyBytes.byteLength / (1024 * 1024)).toFixed(1);

  if (cur.stateFileId) {
    const existingStateId = cur.stateFileId;
    onProgress?.(72, `Subiendo cambios a Google Drive (${sizeMb} MB)...`);
    // Use resumable PATCH so updates work reliably even when komolib-state.json exceeds 5 MB!
    const initPatch = await driveFetch(
      config,
      cur,
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existingStateId)}?uploadType=resumable&fields=id,modifiedTime`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/json',
          'X-Upload-Content-Length': String(bodyBytes.byteLength),
        },
        body: JSON.stringify({
          name: KOMOLIB_STATE_FILE_NAME,
          mimeType: 'application/json',
        }),
      },
      onAuthUpdated
    );
    cur = initPatch.auth;
    if (initPatch.res.ok) {
      const patchUrl = initPatch.res.headers.get('location');
      if (patchUrl) {
        const putPatch = await fetch(patchUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: bodyBytes,
        });
        if (!putPatch.ok) {
          const errText = await putPatch.text().catch(() => '');
          throw new Error(`Error al subir actualización a Drive (${putPatch.status}): ${errText.slice(0, 140)}`);
        }
        const savedMeta = (await putPatch.json().catch(() => ({}))) as { id?: string; modifiedTime?: string };
        const modTime = savedMeta.modifiedTime || '';
        if (modTime) {
          lastDriveStateCache = { email: cur.email, fileId: existingStateId, modifiedTime: modTime, state: merged };
        }
        onProgress?.(88, 'Actualizando biblioteca local...');
        return { merged, modifiedTime: modTime, auth: cur };
      }
    }
    if (initPatch.res.status !== 404) {
      // Fallback for environments where Location header isn't exposed (e.g. small payloads)
      const up = await driveFetch(
        config,
        cur,
        `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existingStateId)}?uploadType=media&fields=id,modifiedTime`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: bodyBytes,
        },
        onAuthUpdated
      );
      cur = up.auth;
      if (!up.res.ok) {
        const errText = await up.res.text().catch(() => '');
        throw new Error(`No se pudo actualizar estado en Drive (${up.res.status}): ${errText.slice(0, 140)}`);
      }
      const savedMeta = (await up.res.json().catch(() => ({}))) as { id?: string; modifiedTime?: string };
      const modTime = savedMeta.modifiedTime || '';
      if (modTime) {
        lastDriveStateCache = { email: cur.email, fileId: existingStateId, modifiedTime: modTime, state: merged };
      }
      onProgress?.(88, 'Actualizando biblioteca local...');
      return { merged, modifiedTime: modTime, auth: cur };
    }
    // File was deleted externally -> recreate below
    cur = { ...cur, stateFileId: '' };
  }

  onProgress?.(72, `Creando respaldo inicial en Google Drive (${sizeMb} MB)...`);
  // Create new `Komolib/komolib-state.json` via resumable upload (handles any library size cleanly!)
  const initRes = await driveFetch(
    config,
    cur,
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,modifiedTime`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(bodyBytes.byteLength),
      },
      body: JSON.stringify({
        name: KOMOLIB_STATE_FILE_NAME,
        parents: [cur.rootFolderId],
        mimeType: 'application/json',
      }),
    },
    onAuthUpdated
  );
  cur = initRes.auth;
  if (!initRes.res.ok) {
    const errText = await initRes.res.text().catch(() => '');
    throw new Error(`No se pudo crear estado en Drive (${initRes.res.status}): ${errText.slice(0, 140)}`);
  }
  const uploadLocation = initRes.res.headers.get('location');
  if (!uploadLocation) {
    throw new Error('Google Drive no devolvió URL de subida para el respaldo.');
  }
  const putRes = await fetch(uploadLocation, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: bodyBytes,
  });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    throw new Error(`Error al subir estado a Drive (${putRes.status}): ${errText.slice(0, 140)}`);
  }
  const created = (await putRes.json()) as { id: string; modifiedTime?: string };
  cur = { ...cur, stateFileId: created.id };
  onAuthUpdated?.(cur);
  const modTime = created.modifiedTime || '';
  if (modTime) {
    lastDriveStateCache = { email: cur.email, fileId: created.id, modifiedTime: modTime, state: merged };
  }
  onProgress?.(88, 'Actualizando biblioteca local...');
  return { merged, modifiedTime: modTime, auth: cur };
}

function sanitizeDriveFileName(raw: string, fallback: string): string {
  const clean = (raw || fallback)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return clean || fallback;
}

/**
 * Uploads a single book file directly from device (IndexedDB or Android SAF nativeFileUri)
 * into the user's `Google Drive / Komolib / Libros/` folder using resumable upload.
 */
export async function uploadBookFileToGoogleDrive(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  book: BookItem,
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<{ ok: boolean; driveFileId?: string; remoteFileName?: string; format?: BookItem['format']; auth: GoogleDriveAuth }> {
  let cur = await ensureKomolibDriveFolders(config, auth, onAuthUpdated);

  // Check if already present in `Komolib/Libros` by driveFileId or appProperties.komolibBookId
  if (book.driveFileId) {
    const check = await driveFetch(
      config,
      cur,
      `${DRIVE_API}/files/${encodeURIComponent(book.driveFileId)}?fields=id,name,trashed`,
      { method: 'GET' },
      onAuthUpdated
    );
    cur = check.auth;
    if (check.res.ok) {
      const info = (await check.res.json().catch(() => ({}))) as { id?: string; name?: string; trashed?: boolean };
      if (info.id && !info.trashed) {
        return {
          ok: true,
          driveFileId: info.id,
          remoteFileName: info.name || book.fileName,
          format: book.format,
          auth: cur,
        };
      }
    }
  }

  const existingByProp = await findDriveFileByQuery(
    config,
    cur,
    `'${escapeDriveQuery(cur.booksFolderId!)}' in parents and appProperties has { key='komolibBookId' and value='${escapeDriveQuery(book.id)}' } and trashed=false`,
    onAuthUpdated
  );
  cur = existingByProp.auth;
  if (existingByProp.file?.id) {
    return {
      ok: true,
      driveFileId: existingByProp.file.id,
      remoteFileName: existingByProp.file.name,
      format: book.format,
      auth: cur,
    };
  }

  const stored = await dbGetBookFile(book.id);
  let uploadBlob: Blob | null = stored?.blob || null;
  if (!uploadBlob && book.nativeFileUri) {
    uploadBlob = await readNativeUriAsBlob(book.nativeFileUri, book.mimeType);
  }
  if (!uploadBlob) return { ok: false, auth: cur };

  let uploadName = sanitizeDriveFileName(book.fileName || `${book.title}.${book.format}`, `${book.id}.${book.format}`);
  let uploadFormat: BookItem['format'] = book.format;
  let uploadMime = book.mimeType || uploadBlob.type || 'application/octet-stream';

  if (book.format === 'images' && stored?.extraImages && stored.extraImages.length > 0) {
    const zip = new JSZip();
    for (let i = 0; i < stored.extraImages.length; i++) {
      const img = stored.extraImages[i];
      const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpg';
      zip.file(`page_${String(i + 1).padStart(4, '0')}.${ext}`, img);
    }
    uploadBlob = await zip.generateAsync({ type: 'blob' });
    uploadName = sanitizeDriveFileName(`${book.title}.cbz`, `${book.id}.cbz`);
    uploadFormat = 'cbz';
    uploadMime = 'application/vnd.comicbook+zip';
  }

  const initRes = await driveFetch(
    config,
    cur,
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': uploadMime,
        'X-Upload-Content-Length': String(uploadBlob.size),
      },
      body: JSON.stringify({
        name: uploadName,
        parents: [cur.booksFolderId],
        mimeType: uploadMime,
        appProperties: {
          komolibBookId: book.id,
        },
      }),
    },
    onAuthUpdated
  );
  cur = initRes.auth;
  if (!initRes.res.ok) {
    return { ok: false, auth: cur };
  }
  const uploadUrl = initRes.res.headers.get('location');
  if (!uploadUrl) return { ok: false, auth: cur };

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': uploadMime },
    body: uploadBlob,
  });
  if (!putRes.ok) return { ok: false, auth: cur };
  const uploaded = (await putRes.json()) as { id: string; name?: string };
  return {
    ok: true,
    driveFileId: uploaded.id,
    remoteFileName: uploaded.name || uploadName,
    format: uploadFormat,
    auth: cur,
  };
}

/**
 * Downloads a book file directly from the user's `Google Drive / Komolib / Libros/`
 * into local IndexedDB so it can be read 100% offline.
 */
export async function downloadBookFileFromGoogleDrive(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  book: BookItem,
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<{ blob: Blob; driveFileId: string; auth: GoogleDriveAuth }> {
  let cur = await ensureKomolibDriveFolders(config, auth, onAuthUpdated);
  let fileId = book.driveFileId || '';

  if (!fileId) {
    const byProp = await findDriveFileByQuery(
      config,
      cur,
      `'${escapeDriveQuery(cur.booksFolderId!)}' in parents and appProperties has { key='komolibBookId' and value='${escapeDriveQuery(book.id)}' } and trashed=false`,
      onAuthUpdated
    );
    cur = byProp.auth;
    if (byProp.file?.id) fileId = byProp.file.id;
  }

  if (!fileId && book.fileName) {
    const safeName = sanitizeDriveFileName(book.fileName, '');
    if (safeName) {
      const byName = await findDriveFileByQuery(
        config,
        cur,
        `'${escapeDriveQuery(cur.booksFolderId!)}' in parents and name='${escapeDriveQuery(safeName)}' and trashed=false`,
        onAuthUpdated
      );
      cur = byName.auth;
      if (byName.file?.id) fileId = byName.file.id;
    }
  }

  if (!fileId) {
    throw new Error('Archivo no encontrado en tu carpeta Komolib/Libros de Google Drive (404)');
  }

  const dl = await driveFetch(
    config,
    cur,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' },
    onAuthUpdated
  );
  cur = dl.auth;
  if (!dl.res.ok) {
    throw new Error(`No se pudo descargar desde Google Drive (${dl.res.status})`);
  }
  const blob = await dl.res.blob();
  await dbPutBookFile(book.id, blob);
  return { blob, driveFileId: fileId, auth: cur };
}

export async function deleteBookFileFromGoogleDrive(
  config: SyncConfig,
  auth: GoogleDriveAuth,
  book: Pick<BookItem, 'id' | 'driveFileId'>,
  onAuthUpdated?: (next: GoogleDriveAuth) => void
): Promise<void> {
  try {
    let cur = auth;
    let fileId = book.driveFileId || '';
    if (!fileId && cur.booksFolderId) {
      const found = await findDriveFileByQuery(
        config,
        cur,
        `'${escapeDriveQuery(cur.booksFolderId)}' in parents and appProperties has { key='komolibBookId' and value='${escapeDriveQuery(book.id)}' } and trashed=false`,
        onAuthUpdated
      );
      cur = found.auth;
      fileId = found.file?.id || '';
    }
    if (!fileId) return;
    await driveFetch(
      config,
      cur,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
      onAuthUpdated
    );
  } catch {
    // ignore cleanup failure
  }
}
