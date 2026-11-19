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
import {
  buildAuthHeaders,
  buildStreamUrl,
  fetchApi,
  resolveServerUrl,
  uploadBookToServer,
} from './syncService';

export interface ParticipantIdentity {
  id: string;
  name: string;
  avatarEmoji: string;
  avatarBg: string;
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
  const res = await fetchApi(`${base}/api/rooms${qs}`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.rooms) ? data.rooms : [];
}

export async function createSharedRoom(
  config: SyncConfig,
  book: BookItem,
  participant: ParticipantIdentity,
  sharedMarks?: { annotations?: BookAnnotation[]; bookmarks?: BookmarkItem[] }
): Promise<SharedRoom> {
  // Ensure the binary file is uploaded to the server so the reading partner can download it
  let enrichedBook: BookItem & {
    sharedAnnotations?: BookAnnotation[];
    sharedBookmarks?: BookmarkItem[];
  } = {
    ...book,
    sharedAnnotations: sharedMarks?.annotations || [],
    sharedBookmarks: sharedMarks?.bookmarks || [],
  };
  if (book.hasLocalFile) {
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
  const res = await fetchApi(`${base}/api/rooms`, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ book: enrichedBook, participant }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Error al crear sala (${res.status})`);
  }
  const data = await res.json();
  return data.room as SharedRoom;
}

export async function getSharedRoom(config: SyncConfig, code: string): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(`${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'No se encontró ninguna sala con ese código' : `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.room as SharedRoom;
}

export async function joinSharedRoom(
  config: SyncConfig,
  code: string,
  participant: ParticipantIdentity
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`,
    {
      method: 'POST',
      headers: buildAuthHeaders(config, true),
      body: JSON.stringify({ participant }),
    }
  );
  if (!res.ok) {
    const msg = res.status === 404 ? 'Código de sala no encontrado' : `Error al unirse (${res.status})`;
    throw new Error(msg);
  }
  const data = await res.json();
  return data.room as SharedRoom;
}

export async function updateSharedRoomProgress(
  config: SyncConfig,
  code: string,
  payload: {
    participantId: string;
    name?: string;
    avatarEmoji?: string;
    avatarBg?: string;
    progress: number;
    currentPage?: number;
    pageCount?: number;
    readingStatus?: ReadingStatus;
  }
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/progress`,
    {
      method: 'PATCH',
      headers: buildAuthHeaders(config, true),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.room as SharedRoom;
}

export async function postSharedRoomComment(
  config: SyncConfig,
  code: string,
  payload: {
    participantId: string;
    authorName: string;
    avatarEmoji: string;
    text: string;
    progressAt: number;
    pageAt?: number;
  }
): Promise<SharedRoom> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/comments`,
    {
      method: 'POST',
      headers: buildAuthHeaders(config, true),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.room as SharedRoom;
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

export async function deleteSharedRoom(config: SyncConfig, code: string): Promise<void> {
  const base = resolveServerUrl(config.serverUrl);
  await fetchApi(`${base}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  }).catch(() => undefined);
}

export function subscribeToRoomStream(
  config: SyncConfig,
  code: string,
  onRoomUpdate: (room: SharedRoom) => void,
  onRoomDeleted?: (deletedCode: string) => void
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const url = buildStreamUrl(config, `/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/stream`);
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
      onRoomDeleted?.(parsed?.code || code.trim().toUpperCase());
    } catch {
      onRoomDeleted?.(code.trim().toUpperCase());
    }
  };
  es.addEventListener('room_update', handler as EventListener);
  es.addEventListener('room_deleted', deletedHandler as EventListener);
  return () => {
    es.removeEventListener('room_update', handler as EventListener);
    es.removeEventListener('room_deleted', deletedHandler as EventListener);
    es.close();
  };
}

/* -------- Mutual Book Exchange Shelves (Independent Progress per User!) -------- */

export async function createSharedShelf(
  config: SyncConfig,
  title: string,
  member: { id: string; name: string; avatarEmoji: string; avatarBg: string }
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(`${base}/api/shelves`, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ title, member }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Error al crear estantería compartida (${res.status})`);
  }
  const data = await res.json();
  return data.shelf as SharedShelf;
}

export async function getSharedShelf(config: SyncConfig, code: string): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(`${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}`, {
    headers: buildAuthHeaders(config, false),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404 ? 'No se encontró ninguna estantería con ese código' : `HTTP ${res.status}`
    );
  }
  const data = await res.json();
  return data.shelf as SharedShelf;
}

export async function joinSharedShelf(
  config: SyncConfig,
  code: string,
  member: { id: string; name: string; avatarEmoji: string; avatarBg: string }
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/join`,
    {
      method: 'POST',
      headers: buildAuthHeaders(config, true),
      body: JSON.stringify({ member }),
    }
  );
  if (!res.ok) {
    throw new Error(
      res.status === 404 ? 'Código de estantería no encontrado' : `Error al unirse (${res.status})`
    );
  }
  const data = await res.json();
  return data.shelf as SharedShelf;
}

export async function shareBookToShelf(
  config: SyncConfig,
  code: string,
  book: BookItem,
  owner: { id: string; name: string },
  sharedMarks?: { annotations?: BookAnnotation[]; bookmarks?: BookmarkItem[] }
): Promise<SharedShelf> {
  const stored = await dbGetBookFile(book.id);
  const form = new FormData();
  form.append('bookId', book.id);
  form.append('ownerId', owner.id);
  form.append('ownerName', owner.name);

  let meta: BookItem & {
    sharedAnnotations?: BookAnnotation[];
    sharedBookmarks?: BookmarkItem[];
  } = {
    ...book,
    sharedAnnotations: sharedMarks?.annotations || [],
    sharedBookmarks: sharedMarks?.bookmarks || [],
  };
  if (stored) {
    let uploadBlob: Blob = stored.blob;
    let uploadName = book.fileName || `${book.id}.${book.format}`;
    if (book.format === 'images' && stored.extraImages && stored.extraImages.length > 0) {
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
  const res = await fetchApi(
    `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/books`,
    {
      method: 'POST',
      headers: buildAuthHeaders(config, false),
      body: form,
    }
  );
  if (!res.ok) {
    throw new Error(`No se pudo compartir "${book.title}" (${res.status})`);
  }
  const data = await res.json();
  return data.shelf as SharedShelf;
}

export async function removeBookFromShelf(
  config: SyncConfig,
  code: string,
  shelfBookKey: string
): Promise<SharedShelf> {
  const base = resolveServerUrl(config.serverUrl);
  const res = await fetchApi(
    `${base}/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/books/${encodeURIComponent(shelfBookKey)}`,
    {
      method: 'DELETE',
      headers: buildAuthHeaders(config, false),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.shelf as SharedShelf;
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
  if (typeof EventSource === 'undefined') return () => undefined;
  const url = buildStreamUrl(
    config,
    `/api/shelves/${encodeURIComponent(code.trim().toUpperCase())}/stream`
  );
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
      onShelfDeleted?.(parsed?.code || code.trim().toUpperCase());
    } catch {
      onShelfDeleted?.(code.trim().toUpperCase());
    }
  };
  es.addEventListener('shelf_update', handler as EventListener);
  es.addEventListener('shelf_deleted', delHandler as EventListener);
  return () => {
    es.removeEventListener('shelf_update', handler as EventListener);
    es.removeEventListener('shelf_deleted', delHandler as EventListener);
    es.close();
  };
}
