import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  dbDeleteBook,
  dbDeleteBookmark,
  dbDeleteNote,
  dbGetAllBookmarks,
  dbGetAllBooks,
  dbGetAllNotes,
  dbGetBookFile,
  dbGetKV,
  dbPutBook,
  dbPutBookFile,
  dbPutBookmark,
  dbPutNote,
  dbSetKV,
} from '../db/localDb';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_COLLECTIONS,
  DEFAULT_PROFILE,
  DEFAULT_READER_SETTINGS,
  DEFAULT_SYNC_CONFIG,
  DEFAULT_THEME,
} from '../data/presets';
import { INITIAL_CHAT_MESSAGES, seedInitialLibrary } from '../data/seedLibrary';
import { importImageBundle, importSingleFile } from '../parsers';
import {
  deleteBookFromServer,
  downloadBookFromServer,
  syncFullState,
  uploadBookToServer,
} from '../services/syncService';
import type {
  BookItem,
  BookmarkItem,
  CategoryItem,
  ChatMessage,
  CollectionCard,
  ContentKind,
  NavSection,
  NoteItem,
  ReaderSettings,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';

export type RightPanelTab = 'chat' | 'studio' | 'notes';

interface LibraryContextValue {
  ready: boolean;
  books: BookItem[];
  bookmarks: BookmarkItem[];
  notes: NoteItem[];
  categories: CategoryItem[];
  collections: CollectionCard[];
  theme: ThemeConfig;
  profile: UserProfile;
  readerSettings: ReaderSettings;
  syncConfig: SyncConfig;
  chatMessages: ChatMessage[];
  // UI Navigation
  navSection: NavSection;
  setNavSection: (s: NavSection) => void;
  activeCategory: string;
  setActiveCategory: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  rightTab: RightPanelTab;
  setRightTab: (t: RightPanelTab) => void;
  mobilePanelOpen: boolean;
  setMobilePanelOpen: (open: boolean) => void;
  // Active Modals / Reader / Audio
  activeBook: BookItem | null;
  openBook: (book: BookItem) => Promise<void>;
  closeReader: () => void;
  audioBook: BookItem | null;
  audioUrl: string | null;
  closeAudioPlayer: () => void;
  editingBook: BookItem | null;
  setEditingBook: (book: BookItem | null) => void;
  importModalOpen: boolean;
  setImportModalOpen: (open: boolean) => void;
  profileModalOpen: boolean;
  setProfileModalOpen: (open: boolean) => void;
  // Mutations
  importFiles: (
    files: File[],
    opts?: { bundleImages?: boolean; title?: string; author?: string; kind?: ContentKind; categories?: string[] }
  ) => Promise<BookItem[]>;
  updateBook: (id: string, patch: Partial<BookItem>) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  addBookmark: (bm: Omit<BookmarkItem, 'id' | 'createdAt'>) => Promise<void>;
  deleteBookmark: (id: string) => Promise<void>;
  addNote: (note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  updateTheme: (patch: Partial<ThemeConfig>) => void;
  resetTheme: () => void;
  updateReaderSettings: (patch: Partial<ReaderSettings>) => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  updateSyncConfig: (patch: Partial<SyncConfig>) => void;
  addCategory: (cat: Omit<CategoryItem, 'id'>) => void;
  deleteCategory: (id: string) => void;
  updateCollection: (id: string, patch: Partial<CollectionCard>) => void;
  sendChatMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  // Sync
  syncStatus: 'idle' | 'syncing' | 'ok' | 'error';
  syncMessage: string;
  triggerSync: () => Promise<void>;
  toast: string | null;
  showToast: (msg: string) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

function applyThemeCssVars(t: ThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty('--outer-bg', t.outerBg);
  root.style.setProperty('--shell-bg', t.shellBg);
  root.style.setProperty('--sidebar-bg', t.sidebarBg);
  root.style.setProperty('--panel-bg', t.panelBg);
  root.style.setProperty('--card-bg', t.cardBg);
  root.style.setProperty('--banner-bg', t.bannerBg);
  root.style.setProperty('--text-primary', t.textPrimary);
  root.style.setProperty('--text-muted', t.textMuted);
  root.style.setProperty('--author-color', t.authorColor);
  root.style.setProperty('--accent-primary', t.accentPrimary);
  root.style.setProperty('--accent-secondary', t.accentSecondary);
  root.style.setProperty('--sidebar-pill-bg', t.sidebarPillBg);
  root.style.setProperty('--search-gradient', t.searchGradient);
  root.style.setProperty('--chat-user-bubble', t.chatUserBubble);
  root.style.setProperty('--chat-bot-bubble', t.chatBotBubble);
  root.style.setProperty('--font-ui', `'${t.fontFamily}', 'Nunito', system-ui, sans-serif`);
  root.style.setProperty('--ui-scale', String(t.uiScale));
  root.style.setProperty('--radius-shell', `${t.borderRadius}px`);
  root.style.setProperty('--radius-card', `${Math.max(12, Math.round(t.borderRadius * 0.72))}px`);
}

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>(DEFAULT_CATEGORIES);
  const [collections, setCollections] = useState<CollectionCard[]>(DEFAULT_COLLECTIONS);
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(DEFAULT_SYNC_CONFIG);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT_MESSAGES);

  const [navSection, setNavSection] = useState<NavSection>('home');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rightTab, setRightTab] = useState<RightPanelTab>('chat');
  const [mobilePanelOpen, setMobilePanelOpen] = useState<boolean>(false);

  const [activeBook, setActiveBook] = useState<BookItem | null>(null);
  const [audioBook, setAudioBook] = useState<BookItem | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [editingBook, setEditingBook] = useState<BookItem | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const deletedIdsRef = useRef<string[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Bootstrap from IndexedDB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [savedTheme, savedCats, savedCols, savedProfile, savedReader, savedSync, savedChat, seeded] =
        await Promise.all([
          dbGetKV<ThemeConfig>('theme'),
          dbGetKV<CategoryItem[]>('categories'),
          dbGetKV<CollectionCard[]>('collections'),
          dbGetKV<UserProfile>('profile'),
          dbGetKV<ReaderSettings>('readerSettings'),
          dbGetKV<SyncConfig>('syncConfig'),
          dbGetKV<ChatMessage[]>('chatMessages'),
          dbGetKV<boolean>('seeded'),
        ]);

      let loadedBooks = await dbGetAllBooks();
      if (!seeded && loadedBooks.length === 0) {
        loadedBooks = await seedInitialLibrary();
        await dbSetKV('seeded', true);
      }

      const [loadedBookmarks, loadedNotes] = await Promise.all([
        dbGetAllBookmarks(),
        dbGetAllNotes(),
      ]);

      if (cancelled) return;

      const mergedTheme = { ...DEFAULT_THEME, ...(savedTheme || {}) };
      setTheme(mergedTheme);
      applyThemeCssVars(mergedTheme);

      if (savedCats?.length) setCategories(savedCats);
      if (savedCols?.length) setCollections(savedCols);
      if (savedProfile) setProfile({ ...DEFAULT_PROFILE, ...savedProfile });
      if (savedReader) setReaderSettings({ ...DEFAULT_READER_SETTINGS, ...savedReader });
      if (savedSync) setSyncConfig({ ...DEFAULT_SYNC_CONFIG, ...savedSync });
      if (savedChat?.length) setChatMessages(savedChat);

      setBooks(loadedBooks);
      setBookmarks(loadedBookmarks);
      setNotes(loadedNotes);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    applyThemeCssVars(theme);
  }, [theme]);

  const updateTheme = useCallback((patch: Partial<ThemeConfig>) => {
    setTheme((prev) => {
      const next = { ...prev, ...patch };
      dbSetKV('theme', next).catch(console.error);
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    setTheme(DEFAULT_THEME);
    dbSetKV('theme', DEFAULT_THEME).catch(console.error);
    showToast('Tema restaurado a Komo Cream');
  }, [showToast]);

  const updateReaderSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setReaderSettings((prev) => {
      const next = { ...prev, ...patch };
      dbSetKV('readerSettings', next).catch(console.error);
      return next;
    });
  }, []);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      dbSetKV('profile', next).catch(console.error);
      return next;
    });
  }, []);

  const updateSyncConfig = useCallback((patch: Partial<SyncConfig>) => {
    setSyncConfig((prev) => {
      const next = { ...prev, ...patch };
      dbSetKV('syncConfig', next).catch(console.error);
      return next;
    });
  }, []);

  const addCategory = useCallback(
    (cat: Omit<CategoryItem, 'id'>) => {
      const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setCategories((prev) => {
        const next = [...prev, { ...cat, id }];
        dbSetKV('categories', next).catch(console.error);
        return next;
      });
      showToast(`Categoría "${cat.label}" añadida`);
    },
    [showToast]
  );

  const deleteCategory = useCallback((id: string) => {
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== id || c.id === 'all');
      dbSetKV('categories', next).catch(console.error);
      return next;
    });
    setActiveCategory((curr) => (curr === id ? 'all' : curr));
  }, []);

  const updateCollection = useCallback((id: string, patch: Partial<CollectionCard>) => {
    setCollections((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      dbSetKV('collections', next).catch(console.error);
      return next;
    });
  }, []);

  const importFiles = useCallback(
    async (
      files: File[],
      opts?: {
        bundleImages?: boolean;
        title?: string;
        author?: string;
        kind?: ContentKind;
        categories?: string[];
      }
    ): Promise<BookItem[]> => {
      if (!files.length) return [];
      const added: BookItem[] = [];

      const imageFiles = files.filter((f) => /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(f.name));
      const nonImageFiles = files.filter((f) => !/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(f.name));

      if (opts?.bundleImages && imageFiles.length > 0) {
        const bundle = await importImageBundle(
          imageFiles,
          opts.title || 'Volumen Ilustrado',
          opts.author || 'Biblioteca Personal',
          opts.kind || 'manhwa',
          opts.categories || []
        );
        await dbPutBook(bundle.book);
        await dbPutBookFile(bundle.book.id, bundle.blob, bundle.extraImages);
        added.push(bundle.book);
      } else {
        for (const f of [...nonImageFiles, ...imageFiles]) {
          const bundle = await importSingleFile(f, {
            title: files.length === 1 ? opts?.title : undefined,
            author: opts?.author,
            kind: opts?.kind,
            categories: opts?.categories,
          });
          await dbPutBook(bundle.book);
          await dbPutBookFile(bundle.book.id, bundle.blob, bundle.extraImages);
          added.push(bundle.book);

          if (syncConfig.autoSync && syncConfig.serverUrl) {
            uploadBookToServer(syncConfig, bundle.book).catch(() => undefined);
          }
        }
      }

      setBooks((prev) => [...added, ...prev]);
      showToast(
        added.length === 1
          ? `"${added[0].title}" añadido a tu librería`
          : `${added.length} títulos añadidos a tu librería`
      );
      return added;
    },
    [showToast, syncConfig]
  );

  const updateBook = useCallback(async (id: string, patch: Partial<BookItem>) => {
    setBooks((prev) => {
      const next = prev.map((b) =>
        b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b
      );
      const updated = next.find((b) => b.id === id);
      if (updated) {
        dbPutBook(updated).catch(console.error);
      }
      return next;
    });
    setActiveBook((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr));
  }, []);

  const deleteBook = useCallback(
    async (id: string) => {
      await dbDeleteBook(id);
      deletedIdsRef.current.push(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
      if (activeBook?.id === id) setActiveBook(null);
      if (editingBook?.id === id) setEditingBook(null);
      if (syncConfig.autoSync && syncConfig.serverUrl) {
        deleteBookFromServer(syncConfig, id).catch(() => undefined);
      }
      showToast('Título eliminado');
    },
    [activeBook, editingBook, showToast, syncConfig]
  );

  const openBook = useCallback(
    async (book: BookItem) => {
      // Ensure binary file is available locally (download from sync server if remote-only)
      let fileRecord = await dbGetBookFile(book.id);
      if (!fileRecord && book.hasRemoteFile && syncConfig.serverUrl) {
        try {
          showToast(`Descargando "${book.title}" del servidor...`);
          const blob = await downloadBookFromServer(syncConfig, book);
          fileRecord = { id: book.id, blob };
          await updateBook(book.id, { hasLocalFile: true });
        } catch (err) {
          showToast(`Error al descargar: ${err instanceof Error ? err.message : 'desconocido'}`);
          return;
        }
      }

      if (!fileRecord) {
        showToast('El archivo local no está disponible en este dispositivo');
        return;
      }

      await updateBook(book.id, { lastReadAt: Date.now() });

      if (book.format === 'audio') {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        const url = URL.createObjectURL(fileRecord.blob);
        setAudioBook(book);
        setAudioUrl(url);
        return;
      }

      // Smart default comic mode based on kind
      if (book.kind === 'manhwa') {
        updateReaderSettings({ comicMode: 'manhwa-strip' });
      } else if (book.kind === 'manga') {
        updateReaderSettings({ comicMode: 'manga-rtl' });
      } else if (book.kind === 'comic') {
        updateReaderSettings({ comicMode: 'comic-ltr' });
      }

      setActiveBook(book);
    },
    [audioUrl, showToast, syncConfig, updateBook, updateReaderSettings]
  );

  const closeReader = useCallback(() => setActiveBook(null), []);

  const closeAudioPlayer = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBook(null);
  }, [audioUrl]);

  const addBookmark = useCallback(
    async (bm: Omit<BookmarkItem, 'id' | 'createdAt'>) => {
      const item: BookmarkItem = {
        ...bm,
        id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
      };
      await dbPutBookmark(item);
      setBookmarks((prev) => [item, ...prev]);
      showToast('Marcador guardado');
    },
    [showToast]
  );

  const deleteBookmark = useCallback(async (id: string) => {
    await dbDeleteBookmark(id);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const addNote = useCallback(
    async (note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = Date.now();
      const item: NoteItem = {
        ...note,
        id: `note_${now}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };
      await dbPutNote(item);
      setNotes((prev) => [item, ...prev]);
      showToast('Nota guardada');
    },
    [showToast]
  );

  const deleteNote = useCallback(async (id: string) => {
    await dbDeleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const sendChatMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}_u`,
        sender: 'user',
        text,
        createdAt: Date.now(),
      };

      const appendMessages = (msgs: ChatMessage[]) => {
        setChatMessages((prev) => {
          const next = [...prev, ...msgs].slice(-80);
          dbSetKV('chatMessages', next).catch(console.error);
          return next;
        });
      };

      appendMessages([userMsg]);

      // Quick command: /nota <texto>
      if (text.toLowerCase().startsWith('/nota ')) {
        const noteText = text.slice(6).trim();
        const targetBook = activeBook || books[0];
        if (targetBook && noteText) {
          await addNote({
            bookId: targetBook.id,
            text: noteText,
            page: targetBook.currentPage,
            color: '#f5b855',
          });
          appendMessages([
            {
              id: `msg_${Date.now()}_a`,
              sender: 'assistant',
              text: `Listo ✨ Guardé tu nota en "${targetBook.title}". Puedes verla en la pestaña Notas.`,
              bookIds: [targetBook.id],
              createdAt: Date.now(),
            },
          ]);
          return;
        }
      }

      // Optional external AI endpoint (OpenAI / Ollama compatible)
      if (syncConfig.aiEndpoint.trim()) {
        try {
          const catalog = books
            .slice(0, 25)
            .map((b) => `- ${b.title} (${b.author}, ${b.kind}, ${b.format}, progreso ${b.progress}%)`)
            .join('\n');
          const res = await fetch(syncConfig.aiEndpoint.trim(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(syncConfig.aiApiKey.trim()
                ? { Authorization: `Bearer ${syncConfig.aiApiKey.trim()}` }
                : {}),
            },
            body: JSON.stringify({
              model: syncConfig.aiModel || 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: `Eres el asistente de lectura de KomoLib. Responde en español, conciso y cálido. Biblioteca del usuario:\n${catalog}`,
                },
                { role: 'user', content: text },
              ],
            }),
          });
          if (res.ok) {
            const json = await res.json();
            const reply =
              json?.choices?.[0]?.message?.content ||
              json?.message?.content ||
              'Recibido.';
            appendMessages([
              {
                id: `msg_${Date.now()}_a`,
                sender: 'assistant',
                text: String(reply),
                createdAt: Date.now(),
              },
            ]);
            return;
          }
        } catch {
          // Fall through to local assistant
        }
      }

      // Smart local offline library assistant
      const lower = text.toLowerCase();
      let matched: BookItem[] = [];
      let replyText = '';

      if (/manga|japon|rtl/i.test(lower)) {
        matched = books.filter((b) => b.kind === 'manga' || b.categories.includes('manga'));
        replyText = matched.length
          ? `Encontré ${matched.length} manga(s) en tu biblioteca. Toca cualquiera para leer en modo RTL:`
          : 'Aún no tienes mangas importados. Arrastra archivos .CBZ, .CBR o .PDF para agregarlos.';
      } else if (/manhwa|webtoon|corea|vertical/i.test(lower)) {
        matched = books.filter((b) => b.kind === 'manhwa' || b.categories.includes('manhwa'));
        replyText = matched.length
          ? `Aquí tienes tus manhwas listos para tira vertical sin bordes:`
          : 'No encontré manhwas aún. Puedes importar un .CBZ/.CBR o una carpeta de imágenes.';
      } else if (/favorit|gusta|top/i.test(lower)) {
        matched = books.filter((b) => b.favorite);
        replyText = matched.length
          ? `Estos son tus títulos favoritos (${matched.length}):`
          : 'Todavía no marcaste ningún libro como favorito. Pulsa el corazón o estrella en cualquier portada.';
      } else if (/leyendo|progreso|continuar|ultimo|último/i.test(lower)) {
        matched = books.filter((b) => b.progress > 0 && b.progress < 100).slice(0, 4);
        replyText = matched.length
          ? `Estas son tus lecturas en curso para continuar justo donde las dejaste:`
          : 'Aún no tienes lecturas a medias. ¡Abre cualquier libro para empezar!';
      } else if (/ayuda|help|comandos|formatos/i.test(lower)) {
        replyText =
          'Puedo buscar en tu librería por título, autor o formato (ej. "manga", "manhwa", "favoritos", "leyendo"). También puedes escribir "/nota Tu pensamiento" para guardar una nota rápida, o conectar un endpoint de IA en la pestaña Sync.';
      } else {
        const terms = lower.split(/\s+/).filter((w) => w.length > 2);
        matched = books.filter((b) => {
          const hay = `${b.title} ${b.author} ${b.format} ${b.kind} ${b.categories.join(' ')} ${b.tags.join(' ')}`.toLowerCase();
          return terms.some((t) => hay.includes(t));
        });
        if (matched.length) {
          replyText = `Encontré ${matched.length} coincidencia(s) en tu librería. ¿Cuál te gustaría abrir?`;
        } else {
          matched = books.slice(0, 3);
          replyText = `No encontré un título exacto para "${text}", pero te sugiero echar un vistazo a estos libros de tu estantería (o escribe "/nota ..." para guardar una nota):`;
        }
      }

      appendMessages([
        {
          id: `msg_${Date.now()}_a`,
          sender: 'assistant',
          text: replyText,
          bookIds: matched.slice(0, 4).map((b) => b.id),
          createdAt: Date.now(),
        },
      ]);
    },
    [activeBook, addNote, books, syncConfig]
  );

  const clearChat = useCallback(() => {
    setChatMessages(INITIAL_CHAT_MESSAGES);
    dbSetKV('chatMessages', INITIAL_CHAT_MESSAGES).catch(console.error);
  }, []);

  const triggerSync = useCallback(async () => {
    if (!syncConfig.serverUrl.trim()) {
      setSyncStatus('error');
      setSyncMessage('Configura la URL del servidor primero');
      return;
    }
    setSyncStatus('syncing');
    setSyncMessage('Sincronizando con el servidor...');
    try {
      const merged = await syncFullState(syncConfig, {
        books,
        bookmarks,
        notes,
        categories,
        theme,
        profile,
        deletedBookIds: deletedIdsRef.current,
      });
      deletedIdsRef.current = [];

      // Persist merged books locally
      const localMap = new Map(books.map((b) => [b.id, b]));
      const nextBooks: BookItem[] = [];
      for (const remoteBook of Object.values(merged.books || {})) {
        const local = localMap.get(remoteBook.id);
        const mergedItem: BookItem = {
          ...remoteBook,
          hasLocalFile: Boolean(local?.hasLocalFile),
        };
        await dbPutBook(mergedItem);
        nextBooks.push(mergedItem);
      }
      nextBooks.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
      setBooks(nextBooks);

      if (merged.bookmarks) {
        for (const bm of merged.bookmarks) await dbPutBookmark(bm);
        setBookmarks(merged.bookmarks);
      }
      if (merged.notes) {
        for (const n of merged.notes) await dbPutNote(n);
        setNotes(merged.notes);
      }
      if (merged.categories?.length) {
        setCategories(merged.categories);
        await dbSetKV('categories', merged.categories);
      }

      const now = Date.now();
      updateSyncConfig({ lastSyncedAt: now });
      setSyncStatus('ok');
      setSyncMessage(`Sincronizado (${nextBooks.length} títulos)`);
      showToast('Biblioteca sincronizada con el servidor');
    } catch (err) {
      setSyncStatus('error');
      setSyncMessage(err instanceof Error ? err.message : 'No se pudo conectar al servidor');
    }
  }, [books, bookmarks, categories, notes, profile, showToast, syncConfig, theme, updateSyncConfig]);

  return (
    <LibraryContext.Provider
      value={{
        ready,
        books,
        bookmarks,
        notes,
        categories,
        collections,
        theme,
        profile,
        readerSettings,
        syncConfig,
        chatMessages,
        navSection,
        setNavSection,
        activeCategory,
        setActiveCategory,
        searchQuery,
        setSearchQuery,
        rightTab,
        setRightTab,
        mobilePanelOpen,
        setMobilePanelOpen,
        activeBook,
        openBook,
        closeReader,
        audioBook,
        audioUrl,
        closeAudioPlayer,
        editingBook,
        setEditingBook,
        importModalOpen,
        setImportModalOpen,
        profileModalOpen,
        setProfileModalOpen,
        importFiles,
        updateBook,
        deleteBook,
        addBookmark,
        deleteBookmark,
        addNote,
        deleteNote,
        updateTheme,
        resetTheme,
        updateReaderSettings,
        updateProfile,
        updateSyncConfig,
        addCategory,
        deleteCategory,
        updateCollection,
        sendChatMessage,
        clearChat,
        syncStatus,
        syncMessage,
        triggerSync,
        toast,
        showToast,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}
