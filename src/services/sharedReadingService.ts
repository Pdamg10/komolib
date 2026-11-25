import JSZip from 'jszip';
import type {
  BookAnnotation,
  BookItem,
  BookmarkItem,
  ReadingStatus,
  SharedRoom,
  SharedShelf,
  SyncConfig,
} from '../types/library';
import { dbGetBookFile } from '../db/localDb';
import { readNativeUriAsBlob } from '../utils/nativeBridge';
import {
  buildAuthHeaders,
  buildStreamUrl,
  fetchApi,
  parseJsonResponse,
  resolveServerUrl,
  uploadBookToServer,
} from './syncService';

export class SharedSpaceHttpError extends Error {
  status: number;
  deleted: boolean;

  constructor(message: string, status: number, deleted = false) {
    super(message);
    this.name = 'SharedSpaceHttpError';
    this.status = status;
    this.deleted = deleted;
  }
}

export interface ParticipantIdentity {
  id: string;
  name: string;
  avatarEmoji: string;
  avatarBg: string;
  avatarImageUrl?: string;
  progress?: number;
  currentPage?: number;
  readingStatus?: ReadingStatus;
}

export async function listSharedRooms(
  config: SyncConfig,
  participantId?: string
): Promise<SharedRoom[]> {
  const base = resolveServerUrl(config.serverUrl);
  const qs = participantId ? `?participantId=${encodeURIComponent(participantId)}` : '';
  const url = `${base}/api/rooms${qs}`;
  const res = await fetchApi(url, {
    headers: buildAuthHeaders(config, false),
  });
  const data = await parseJsonResponse<{ rooms?: SharedRoom[] }>(res, url);
  return Array.isArray(data?.rooms) ? data.rooms : [];
}

export async function createSharedRoom(
  config: SyncConfig,
  book: BookItem,
  participant: ParticipantIdentity,
  sharedMarks?: { annotations?: BookAnnotation[]; bookmarks?: BookmarkItem[] }
): Promise<SharedRoom> {
  // Ensure the binary file is uploaded to the server so the reading partner can download it
  const { nativeFileUri: _ignoreLocalUri, ...shareableBook } = book;
  let enrichedBook: Omit<BookItem, 'nativeFileUri'> & {
    sharedAnnotations?: BookAnnotation[];
    sharedBookmarks?: BookmarkItem[];
  } = {
    ...shareableBook,
    sharedAnnotations: sharedMarks?.annotations || [],
    sharedBookmarks: sharedMarks?.bookmarks || [],
  };
  if (book.hasLocalFile && !book.hasRemoteFile) {
    const uploaded = await uploadBookToServer(config, book, participant.id);
    if (uploaded.ok) {
      enrichedBook = {
        ...enrichedBook,
        hasRemoteFile: true,
        remoteFileName: uploaded.remoteFileName || book.remoteFileName,
        format: uploaded.format || book.format,
      };
    }
  }

  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ book: enrichedBook, participant }),
  });
  const data = await parseJsonResponse<{ room: SharedRoom }>(res, url);
  return data.room;
}

export async function getSharedRoom(config: SyncConfig, code: string): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`;
  const res = await fetchApi(url, {
    headers: buildAuthHeaders(config, false),
  });
  if (res.status === 410) {
    throw new SharedSpaceHttpError('Esta sala fue cerrada', 410, true);
  }
  if (res.status === 404) {
    throw new SharedSpaceHttpError('No se encontró ninguna sala con ese código', 404, false);
  }
  const data = await parseJsonResponse<{ room: SharedRoom }>(res, url);
  return data.room;
}

export async function restoreSharedRoom(
  config: SyncConfig,
  room: SharedRoom
): Promise<{ room: SharedRoom; restored: boolean }> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms/${encodeURIComponent(room.code.trim().toUpperCase())}/restore`;
  const res = await fetchApi(url, {
    method: 'PUT',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ room }),
  });
  if (res.status === 410) {
    throw new SharedSpaceHttpError('Esta sala ya fue cerrada', 410, true);
  }
  const data = await parseJsonResponse<{ room: SharedRoom; restored?: boolean }>(res, url);
  return { room: data.room, restored: Boolean(data.restored) };
}

export async function joinSharedRoom(
  config: SyncConfig,
  code: string,
  participant: ParticipantIdentity
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ participant }),
  });
  if (res.status === 410) {
    throw new SharedSpaceHttpError('Esta sala fue cerrada', 410, true);
  }
  if (res.status === 404) {
    throw new SharedSpaceHttpError('Código de sala no encontrado', 404, false);
  }
  const data = await parseJsonResponse<{ room: SharedRoom }>(res, url);
  return data.room;
}

export async function updateSharedRoomProgress(
  config: SyncConfig,
  code: string,
  payload: {
    participantId: string;
    name?: string;
    avatarEmoji?: string;
    avatarBg?: string;
    avatarImageUrl?: string;
    progress: number;
    currentPage?: number;
    pageCount?: number;
    readingStatus?: ReadingStatus;
  }
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/progress`;
  const res = await fetchApi(url, {
    method: 'PATCH',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ room: SharedRoom }>(res, url);
  return data.room;
}

export async function postSharedRoomComment(
  config: SyncConfig,
  code: string,
  payload: {
    participantId: string;
    authorName: string;
    avatarEmoji: string;
    avatarImageUrl?: string;
    text: string;
    progressAt: number;
    pageAt?: number;
  }
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/comments`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ room: SharedRoom }>(res, url);
  return data.room;
}

export async function downloadSharedRoomFile(config: SyncConfig, code: string): Promise<Blob> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/file`,
    {
      headers: buildAuthHeaders(config, false),
    }
  );
  if (!res.ok) {
    throw new Error(`No se pudo descargar el libro compartido (${res.status})`);
  }
  return res.blob();
}

export async function leaveSharedRoom(
  config: SyncConfig,
  code: string,
  participantId: string
): Promise<void> {
  const base = resolveServerUrl(config.serverUrl);
  await fetchApi(`${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/leave`, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ participantId }),
  }).catch(() => undefined);
}

export async function kickRoomParticipant(
  config: SyncConfig,
  code: string,
  requesterId: string,
  targetParticipantId: string
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/kick`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ requesterId, targetParticipantId }),
  });
  const data = await parseJsonResponse<{ room: SharedRoom }>(res, url);
  return data.room;
}

export async function deleteSharedRoom(config: SyncConfig, code: string): Promise<void> {
  const base = resolveServerUrl(config.serverUrl);
  await fetchApi(`${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  }).catch(() => undefined);
}

export async function syncProfileAcrossSharedSpaces(
  config: SyncConfig,
  payload: {
    participantIds: string[];
    name?: string;
    avatarEmoji?: string;
    avatarBg?: string;
    avatarImageUrl?: string;
  }
): Promise<{ rooms: SharedRoom[]; shelves: SharedShelf[] }> {
  const base = resolveServerUrl(config.serverUrl);
  if (!base || payload.participantIds.length === 0) return { rooms: [], shelves: [] };
  const url = `${base}/api/shared/profile`;
  const res = await fetchApi(url, {
    method: 'PATCH',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ rooms?: SharedRoom[]; shelves?: SharedShelf[] }>(res, url);
  return {
    rooms: Array.isArray(data?.rooms) ? data.rooms : [],
    shelves: Array.isArray(data?.shelves) ? data.shelves : [],
  };
}

export function subscribeToRoomStream(
  config: SyncConfig,
  code: string,
  onRoomUpdate: (room: SharedRoom) => void,
  onRoomDeleted?: (deletedCode: string) => void
): () => void {
  const normalizedCode = code.trim().toUpperCase();
  const base = resolveServerUrl(config.serverUrl);
  if (!base || !normalizedCode) return () => undefined;

  // Cloudflare Workers (stateless edge) & environments without EventSource use lightweight 4s polling
  const preferPolling = /\.workers\.dev\b/i.test(base) || typeof EventSource === 'undefined';
  let active = true;
  let pollTimer: number | null = null;
  let lastUpdatedAt = 0;

  const startPolling = () => {
    if (pollTimer !== null || !active) return;
    const tick = async () => {
      if (!active || document.visibilityState === 'hidden') return;
      try {
        const room = await getSharedRoom(config, normalizedCode);
        if (!active) return;
        const ts = room.updatedAt || 0;
        if (ts !== lastUpdatedAt) {
          lastUpdatedAt = ts;
          onRoomUpdate(room);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof SharedSpaceHttpError && err.deleted) {
          onRoomDeleted?.(normalizedCode);
        }
      }
    };
    void tick();
    pollTimer = window.setInterval(() => void tick(), 4000);
  };

  if (preferPolling) {
    startPolling();
    return () => {
      active = false;
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }

  const url = buildStreamUrl(config, `/api/rooms/${encodeURIComponent(normalizedCode)}/stream`);
  if (!url) return () => undefined;

  const es = new EventSource(url);
  const handler = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as SharedRoom;
      if (parsed?.code) onRoomUpdate(parsed);
    } catch {
      // ignore
    }
  };
  const deletedHandler = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as { code?: string };
      onRoomDeleted?.(parsed?.code || normalizedCode);
    } catch {
      onRoomDeleted?.(normalizedCode);
    }
  };
  es.addEventListener('room_update', handler as EventListener);
  es.addEventListener('room_deleted', deletedHandler as EventListener);
  es.onerror = () => {
    // Gracefully fall back to polling if host does not support long-lived SSE
    es.close();
    startPolling();
  };
  return () => {
    active = false;
    if (pollTimer !== null) window.clearInterval(pollTimer);
    es.removeEventListener('room_update', handler as EventListener);
    es.removeEventListener('room_deleted', deletedHandler as EventListener);
    es.close();
  };
}

/* -------- Mutual Book Exchange Shelves (Independent Progress per User!) -------- */

export async function createSharedShelf(
  config: SyncConfig,
  title: string,
  member: { id: string; name: string; avatarEmoji: string; avatarBg: string; avatarImageUrl?: string }
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ title, member }),
  });
  const data = await parseJsonResponse<{ shelf: SharedShelf }>(res, url);
  return data.shelf;
}

export async function getSharedShelf(config: SyncConfig, code: string): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}`;
  const res = await fetchApi(url, {
    headers: buildAuthHeaders(config, false),
  });
  if (res.status === 410) {
    throw new SharedSpaceHttpError('Esta estantería fue cerrada', 410, true);
  }
  if (res.status === 404) {
    throw new SharedSpaceHttpError('No se encontró ninguna estantería con ese código', 404, false);
  }
  const data = await parseJsonResponse<{ shelf: SharedShelf }>(res, url);
  return data.shelf;
}

export async function restoreSharedShelf(
  config: SyncConfig,
  shelf: SharedShelf
): Promise<{ shelf: SharedShelf; restored: boolean }> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves/${encodeURIComponent(shelf.code.trim().toUpperCase())}/restore`;
  const res = await fetchApi(url, {
    method: 'PUT',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ shelf }),
  });
  if (res.status === 410) {
    throw new SharedSpaceHttpError('Esta estantería ya fue cerrada', 410, true);
  }
  const data = await parseJsonResponse<{ shelf: SharedShelf; restored?: boolean }>(res, url);
  return { shelf: data.shelf, restored: Boolean(data.restored) };
}

export async function joinSharedShelf(
  config: SyncConfig,
  code: string,
  member: { id: string; name: string; avatarEmoji: string; avatarBg: string; avatarImageUrl?: string }
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/join`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ member }),
  });
  if (res.status === 410) {
    throw new SharedSpaceHttpError('Esta estantería fue cerrada', 410, true);
  }
  if (res.status === 404) {
    throw new SharedSpaceHttpError('Código de estantería no encontrado', 404, false);
  }
  const data = await parseJsonResponse<{ shelf: SharedShelf }>(res, url);
  return data.shelf;
}

export async function shareBookToShelf(
  config: SyncConfig,
  code: string,
  book: BookItem,
  owner: { id: string; name: string },
  sharedMarks?: { annotations?: BookAnnotation[]; bookmarks?: BookmarkItem[] }
): Promise<SharedShelf> {
  const stored = await dbGetBookFile(book.id);
  let uploadBlob: Blob | null = stored?.blob || null;
  if (!uploadBlob && book.nativeFileUri) {
    uploadBlob = await readNativeUriAsBlob(book.nativeFileUri, book.mimeType);
  }
  const form = new FormData();
  form.append('bookId', book.id);
  form.append('ownerId', owner.id);
  form.append('ownerName', owner.name);

  const { nativeFileUri: _ignoreLocalUri, ...shareableBook } = book;
  let meta: Omit<BookItem, 'nativeFileUri'> & {
    sharedAnnotations?: BookAnnotation[];
    sharedBookmarks?: BookmarkItem[];
  } = {
    ...shareableBook,
    sharedAnnotations: sharedMarks?.annotations || [],
    sharedBookmarks: sharedMarks?.bookmarks || [],
  };
  if (uploadBlob) {
    let uploadName = book.fileName || `${book.id}.${book.format}`;
    if (book.format === 'images' && stored?.extraImages && stored.extraImages.length > 0) {
      const zip = new JSZip();
      for (let i = 0; i < stored.extraImages.length; i++) {
        const img = stored.extraImages[i];
        const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpg';
        zip.file(`page_${String(i + 1).padStart(4, '0')}.${ext}`, img);
      }
      uploadBlob = await zip.generateAsync({ type: 'blob' });
      uploadName = `${book.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || book.id}.cbz`;
      meta = {
        ...meta,
        format: 'cbz',
        fileName: uploadName,
        mimeType: 'application/vnd.comicbook+zip',
      };
    }
    form.append('file', uploadBlob, uploadName);
  }
  form.append('meta', JSON.stringify(meta));

  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/books`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
    body: form,
  });
  const data = await parseJsonResponse<{ shelf: SharedShelf }>(res, url);
  return data.shelf;
}

export async function removeBookFromShelf(
  config: SyncConfig,
  code: string,
  shelfBookKey: string
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/books/${encodeURIComponent(shelfBookKey)}`;
  const res = await fetchApi(url, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  });
  const data = await parseJsonResponse<{ shelf: SharedShelf }>(res, url);
  return data.shelf;
}

export async function downloadShelfBookFile(
  config: SyncConfig,
  code: string,
  shelfBookKey: string
): Promise<Blob> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/books/${encodeURIComponent(shelfBookKey)}/file`,
    {
      headers: buildAuthHeaders(config, false),
    }
  );
  if (!res.ok) {
    throw new Error(`No se pudo descargar el libro compartido (${res.status})`);
  }
  return res.blob();
}

export async function leaveSharedShelf(
  config: SyncConfig,
  code: string,
  memberId: string
): Promise<void> {
  const base = resolveServerUrl(config.serverUrl);
  await fetchApi(`${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/leave`, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ memberId }),
  }).catch(() => undefined);
}

export async function kickShelfMember(
  config: SyncConfig,
  code: string,
  requesterId: string,
  targetMemberId: string
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const url = `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/kick`;
  const res = await fetchApi(url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ requesterId, targetMemberId }),
  });
  const data = await parseJsonResponse<{ shelf: SharedShelf }>(res, url);
  return data.shelf;
}

export async function deleteSharedShelf(config: SyncConfig, code: string): Promise<void> {
  const base = resolveServerUrl(config.serverUrl);
  await fetchApi(`${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  }).catch(() => undefined);
}

export function subscribeToShelfStream(
  config: SyncConfig,
  code: string,
  onShelfUpdate: (shelf: SharedShelf) => void,
  onShelfDeleted?: (deletedCode: string) => void
): () => void {
  const normalizedCode = code.trim().toUpperCase();
  const base = resolveServerUrl(config.serverUrl);
  if (!base || !normalizedCode) return () => undefined;

  const preferPolling = /\.workers\.dev\b/i.test(base) || typeof EventSource === 'undefined';
  let active = true;
  let pollTimer: number | null = null;
  let lastUpdatedAt = 0;

  const startPolling = () => {
    if (pollTimer !== null || !active) return;
    const tick = async () => {
      if (!active || document.visibilityState === 'hidden') return;
      try {
        const shelf = await getSharedShelf(config, normalizedCode);
        if (!active) return;
        const ts = shelf.updatedAt || 0;
        if (ts !== lastUpdatedAt) {
          lastUpdatedAt = ts;
          onShelfUpdate(shelf);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof SharedSpaceHttpError && err.deleted) {
          onShelfDeleted?.(normalizedCode);
        }
      }
    };
    void tick();
    pollTimer = window.setInterval(() => void tick(), 4500);
  };

  if (preferPolling) {
    startPolling();
    return () => {
      active = false;
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }

  const url = buildStreamUrl(config, `/api/shelves/${encodeURIComponent(normalizedCode)}/stream`);
  if (!url) return () => undefined;

  const es = new EventSource(url);
  const handler = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as SharedShelf;
      if (parsed?.code) onShelfUpdate(parsed);
    } catch {
      // ignore
    }
  };
  const delHandler = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as { code?: string };
      onShelfDeleted?.(parsed?.code || normalizedCode);
    } catch {
      onShelfDeleted?.(normalizedCode);
    }
  };
  es.addEventListener('shelf_update', handler as EventListener);
  es.addEventListener('shelf_deleted', delHandler as EventListener);
  es.onerror = () => {
    es.close();
    startPolling();
  };
  return () => {
    active = false;
    if (pollTimer !== null) window.clearInterval(pollTimer);
    es.removeEventListener('shelf_update', handler as EventListener);
    es.removeEventListener('shelf_deleted', delHandler as EventListener);
    es.close();
  };
}
