import type {
  BookItem,
  BookmarkItem,
  CategoryItem,
  NoteItem,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';
import { dbGetBookFile, dbPutBookFile } from '../db/localDb';

export interface ServerHealth {
  ok: boolean;
  service: string;
  version: string;
  booksCount: number;
  updatedAt: number;
  authRequired: boolean;
}

export interface RemoteSyncPayload {
  updatedAt: number;
  books: Record<string, BookItem>;
  bookmarks: BookmarkItem[];
  notes: NoteItem[];
  categories: CategoryItem[] | null;
  theme: ThemeConfig | null;
  profile: UserProfile | null;
}

function buildHeaders(config: SyncConfig, isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (config.token.trim()) {
    headers['Authorization'] = `Bearer ${config.token.trim()}`;
  }
  return headers;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function checkServerHealth(config: SyncConfig): Promise<ServerHealth> {
  const base = normalizeUrl(config.serverUrl);
  const res = await fetch(`${base}/api/health`, {
    headers: buildHeaders(config, false),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function uploadBookToServer(config: SyncConfig, book: BookItem): Promise<boolean> {
  const stored = await dbGetBookFile(book.id);
  if (!stored) return false;
  const base = normalizeUrl(config.serverUrl);
  const form = new FormData();
  form.append('id', book.id);
  form.append('meta', JSON.stringify(book));
  form.append('file', stored.blob, book.fileName || `${book.id}.${book.format}`);

  const res = await fetch(`${base}/api/books/upload`, {
    method: 'POST',
    headers: buildHeaders(config, false),
    body: form,
  });
  return res.ok;
}

export async function downloadBookFromServer(config: SyncConfig, book: BookItem): Promise<Blob> {
  const base = normalizeUrl(config.serverUrl);
  const res = await fetch(`${base}/api/books/${encodeURIComponent(book.id)}/file`, {
    headers: buildHeaders(config, false),
  });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo (${res.status})`);
  }
  const blob = await res.blob();
  await dbPutBookFile(book.id, blob);
  return blob;
}

export async function deleteBookFromServer(config: SyncConfig, bookId: string): Promise<void> {
  if (!config.serverUrl.trim()) return;
  const base = normalizeUrl(config.serverUrl);
  await fetch(`${base}/api/books/${encodeURIComponent(bookId)}`, {
    method: 'DELETE',
    headers: buildHeaders(config, false),
  }).catch(() => undefined);
}

export async function syncFullState(
  config: SyncConfig,
  localData: {
    books: BookItem[];
    bookmarks: BookmarkItem[];
    notes: NoteItem[];
    categories: CategoryItem[];
    theme: ThemeConfig;
    profile: UserProfile;
    deletedBookIds?: string[];
  },
  uploadMissingFiles = true
): Promise<RemoteSyncPayload> {
  const base = normalizeUrl(config.serverUrl);
  const booksMap: Record<string, BookItem> = {};
  for (const b of localData.books) {
    booksMap[b.id] = b;
  }

  const res = await fetch(`${base}/api/sync/state`, {
    method: 'PUT',
    headers: buildHeaders(config, true),
    body: JSON.stringify({
      books: booksMap,
      bookmarks: localData.bookmarks,
      notes: localData.notes,
      categories: localData.categories,
      theme: localData.theme,
      profile: localData.profile,
      deletedBookIds: localData.deletedBookIds || [],
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
        await uploadBookToServer(config, book).catch(() => false);
      }
    }
  }

  return merged;
}
