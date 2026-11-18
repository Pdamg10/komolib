import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  CategoryItem,
  ChatMessage,
  CollectionCard,
  NoteItem,
  ReaderSettings,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';

interface KomoLibSchema extends DBSchema {
  books: {
    key: string;
    value: BookItem;
  };
  files: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      extraImages?: Blob[]; // For bundled image-folder manga/manhwa
    };
  };
  bookmarks: {
    key: string;
    value: BookmarkItem;
  };
  annotations: {
    key: string;
    value: BookAnnotation;
  };
  notes: {
    key: string;
    value: NoteItem;
  };
  kv: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<KomoLibSchema>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<KomoLibSchema>('komolib-db', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('bookmarks')) {
          db.createObjectStore('bookmarks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('annotations')) {
          db.createObjectStore('annotations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
      },
    });
  }
  return dbPromise;
}

export async function dbGetAllBooks(): Promise<BookItem[]> {
  const db = await getDb();
  const books = await db.getAll('books');
  return books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
}

export async function dbPutBook(book: BookItem): Promise<void> {
  const db = await getDb();
  await db.put('books', book);
}

export async function dbDeleteBook(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['books', 'files'], 'readwrite');
  await tx.objectStore('books').delete(id);
  await tx.objectStore('files').delete(id);
  await tx.done;
}

export async function dbPutBookFile(id: string, blob: Blob, extraImages?: Blob[]): Promise<void> {
  const db = await getDb();
  await db.put('files', { id, blob, extraImages });
}

export async function dbGetBookFile(
  id: string
): Promise<{ id: string; blob: Blob; extraImages?: Blob[] } | undefined> {
  const db = await getDb();
  return db.get('files', id);
}

export async function dbGetAllBookmarks(): Promise<BookmarkItem[]> {
  const db = await getDb();
  const items = await db.getAll('bookmarks');
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function dbPutBookmark(bm: BookmarkItem): Promise<void> {
  const db = await getDb();
  await db.put('bookmarks', bm);
}

export async function dbDeleteBookmark(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('bookmarks', id);
}

export async function dbGetAllAnnotations(): Promise<BookAnnotation[]> {
  const db = await getDb();
  const items = await db.getAll('annotations');
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function dbPutAnnotation(ann: BookAnnotation): Promise<void> {
  const db = await getDb();
  await db.put('annotations', ann);
}

export async function dbDeleteAnnotation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('annotations', id);
}

export async function dbEstimateLocalMetadataBytes(): Promise<number> {
  const db = await getDb();
  const [books, bookmarks, annotations, notes, customDesigns] = await Promise.all([
    db.getAll('books'),
    db.getAll('bookmarks'),
    db.getAll('annotations'),
    db.getAll('notes'),
    db.get('kv', 'customBookmarkDesigns'),
  ]);
  try {
    return new Blob([
      JSON.stringify({ books, bookmarks, annotations, notes, customDesigns }),
    ]).size;
  } catch {
    return 0;
  }
}

export async function dbGetAllNotes(): Promise<NoteItem[]> {
  const db = await getDb();
  const items = await db.getAll('notes');
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function dbPutNote(note: NoteItem): Promise<void> {
  const db = await getDb();
  await db.put('notes', note);
}

export async function dbDeleteNote(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('notes', id);
}

export async function dbGetKV<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return (await db.get('kv', key)) as T | undefined;
}

export async function dbSetKV<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('kv', value, key);
}

export type PersistedKvMap = {
  theme: ThemeConfig;
  categories: CategoryItem[];
  collections: CollectionCard[];
  profile: UserProfile;
  readerSettings: ReaderSettings;
  syncConfig: SyncConfig;
  chatMessages: ChatMessage[];
  customBookmarkDesigns: BookmarkDesign[];
  seeded: boolean;
};
