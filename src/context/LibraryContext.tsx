import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  dbClearAllUserData,
  dbDeleteAnnotation,
  dbDeleteBook,
  dbDeleteBookmark,
  dbDeleteNote,
  dbGetAllAnnotations,
  dbGetAllBookmarks,
  dbGetAllBooks,
  dbGetAllNotes,
  dbGetBookFile,
  dbGetKV,
  dbPutAnnotation,
  dbPutBook,
  dbPutBookFile,
  dbPutBookmark,
  dbPutNote,
  dbSetKV,
} from '../db/localDb';
import {
  BUILTIN_BOOKMARK_DESIGNS,
  compressBookmarkImage,
} from '../data/bookmarksCatalog';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_COLLECTIONS,
  DEFAULT_PROFILE,
  DEFAULT_READER_SETTINGS,
  DEFAULT_SYNC_CONFIG,
  DEFAULT_THEME,
} from '../data/presets';
import { INITIAL_CHAT_MESSAGES } from '../data/seedLibrary';
import { SYNC_SERVER_URL } from '../config';
import {
  extractOriginalCoverFromBlob,
  importImageBundle,
  importSingleFile,
} from '../parsers';
import { extractCoverPaletteFromDataUrl } from '../parsers/coverGenerator';
import {
  filterSupportedFiles,
  groupImagesByFolder,
  isImageFile,
} from '../utils/fileFolderImport';
import {
  checkServerHealth,
  deleteBookFromServer,
  deriveEmailSpaceId,
  downloadBookFromServer,
  fetchRemoteSyncState,
  parsePairingInput,
  sendAiChatViaServer,
  subscribeToSyncStream,
  syncFullState,
  uploadBookToServer,
  type RemoteSyncPayload,
} from '../services/syncService';
import {
  createSharedRoom,
  createSharedShelf,
  deleteSharedRoom,
  deleteSharedShelf,
  downloadSharedRoomFile,
  downloadShelfBookFile,
  getSharedRoom,
  getSharedShelf,
  joinSharedRoom,
  joinSharedShelf,
  leaveSharedRoom,
  leaveSharedShelf,
  listSharedRooms,
  postSharedRoomComment,
  removeBookFromShelf,
  shareBookToShelf,
  updateSharedRoomProgress,
} from '../services/sharedReadingService';
import type {
  ActiveReadingSession,
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  CategoryItem,
  ChatMessage,
  CollectionCard,
  ContentKind,
  CustomStationeryKit,
  CustomStickerItem,
  CustomSwatchItem,
  NavSection,
  NoteItem,
  ReaderJumpTarget,
  ReaderSettings,
  SharedRoom,
  SharedShelf,
  SharedShelfBook,
  ShareMarksSelection,
  SyncConfig,
  ThemeConfig,
  UserProfile,
} from '../types/library';

export type RightPanelTab = 'chat' | 'notes';

interface LibraryContextValue {
  ready: boolean;
  books: BookItem[];
  bookmarks: BookmarkItem[];
  annotations: BookAnnotation[];
  customBookmarkDesigns: BookmarkDesign[];
  allBookmarkDesigns: BookmarkDesign[];
  customStationery: CustomStationeryKit;
  addCustomSwatch: (swatch: Omit<CustomSwatchItem, 'id'>) => void;
  deleteCustomSwatch: (id: string) => void;
  addCustomSticker: (sticker: Omit<CustomStickerItem, 'id'>) => void;
  deleteCustomSticker: (id: string) => void;
  addCustomEmoji: (emoji: string) => void;
  deleteCustomEmoji: (emoji: string) => void;
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
  readerJumpTarget: ReaderJumpTarget | null;
  clearReaderJumpTarget: () => void;
  openBook: (book: BookItem) => Promise<void>;
  openBookAt: (book: BookItem, target: Omit<ReaderJumpTarget, 'id' | 'bookId'>) => Promise<void>;
  closeReader: () => void;
  audioBook: BookItem | null;
  audioUrl: string | null;
  closeAudioPlayer: () => void;
  editingBook: BookItem | null;
  setEditingBook: (book: BookItem | null) => void;
  importModalOpen: boolean;
  setImportModalOpen: (open: boolean) => void;
  studioModalOpen: boolean;
  setStudioModalOpen: (open: boolean) => void;
  profileModalOpen: boolean;
  setProfileModalOpen: (open: boolean) => void;
  // Mutations
  importFiles: (
    files: File[],
    opts?: { bundleImages?: boolean; title?: string; author?: string; kind?: ContentKind; categories?: string[] }
  ) => Promise<BookItem[]>;
  updateBook: (id: string, patch: Partial<BookItem>) => Promise<void>;
  reExtractBookCover: (id: string) => Promise<boolean>;
  deleteBook: (id: string) => Promise<void>;
  addBookmark: (bm: Omit<BookmarkItem, 'id' | 'createdAt'>) => Promise<BookmarkItem>;
  deleteBookmark: (id: string) => Promise<void>;
  addAnnotation: (ann: Omit<BookAnnotation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<BookAnnotation>;
  updateAnnotation: (id: string, patch: Partial<BookAnnotation>) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  addCustomBookmarkDesign: (name: string, file: File) => Promise<BookmarkDesign | null>;
  deleteCustomBookmarkDesign: (id: string) => void;
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
  aiOnline: boolean;
  aiModelName: string;
  // Sync & Live Continuity (Web <-> APK)
  deviceId: string;
  serverOnline: boolean;
  liveConnected: boolean;
  serverAuthRequired: boolean;
  serverLanUrl: string;
  refreshServerHealth: () => Promise<void>;
  applyPairingLink: (raw: string) => Promise<boolean>;
  remoteActiveSession: ActiveReadingSession | null;
  dismissRemoteSession: () => void;
  syncStatus: 'idle' | 'syncing' | 'ok' | 'error';
  syncMessage: string;
  triggerSync: (silent?: boolean) => Promise<void>;
  // Cloud Account by Email & Full Backup/Restore
  loginWithEmail: (email: string, pin?: string) => Promise<boolean>;
  logoutAccount: () => Promise<void>;
  exportBackupJson: () => void;
  importBackupJson: (file: File) => Promise<boolean>;
  // Shared Reading Rooms (Buddy Read)
  sharedRooms: SharedRoom[];
  selectedRoomCode: string;
  setSelectedRoomCode: (code: string) => void;
  pendingJoinCode: string;
  setPendingJoinCode: (code: string) => void;
  refreshSharedRooms: () => Promise<void>;
  createRoomForBook: (
    book: BookItem,
    marksSelection?: ShareMarksSelection
  ) => Promise<SharedRoom | null>;
  joinRoomByCode: (
    code: string,
    includeSharedMarks?: boolean
  ) => Promise<{ room: SharedRoom; book?: BookItem } | null>;
  sendRoomComment: (code: string, text: string, progressAt: number, pageAt?: number) => Promise<void>;
  leaveOrDeleteRoom: (code: string, isHost: boolean) => Promise<void>;
  updateLocalRoom: (room: SharedRoom) => void;
  removeLocalRoom: (code: string) => void;
  // Mutual Book Exchange Shelves (Independent Progress!)
  sharedShelves: SharedShelf[];
  selectedShelfCode: string;
  setSelectedShelfCode: (code: string) => void;
  pendingShelfCode: string;
  setPendingShelfCode: (code: string) => void;
  refreshSharedShelves: () => Promise<void>;
  createMutualShelf: (
    title: string,
    bookIds: string[],
    marksSelection?: ShareMarksSelection
  ) => Promise<SharedShelf | null>;
  joinShelfByCode: (code: string) => Promise<SharedShelf | null>;
  shareBooksToShelf: (
    code: string,
    bookIds: string[],
    marksSelection?: ShareMarksSelection
  ) => Promise<void>;
  removeBookFromSharedShelf: (code: string, shelfBookKey: string) => Promise<void>;
  importBookFromShelf: (
    code: string,
    entry: SharedShelfBook,
    includeSharedMarks?: boolean
  ) => Promise<BookItem | null>;
  leaveOrDeleteShelf: (code: string, isHost: boolean) => Promise<void>;
  updateLocalShelf: (shelf: SharedShelf) => void;
  removeLocalShelf: (code: string) => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

function hexToLuminance(hex: string): number {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0.5;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function getContrastColor(bgHex: string): string {
  return hexToLuminance(bgHex) > 0.45 ? '#231f1c' : '#ffffff';
}

function applyThemeCssVars(t: ThemeConfig) {
  const root = document.documentElement;
  const isDark = hexToLuminance(t.shellBg) < 0.28;

  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.dataset.themeMode = isDark ? 'dark' : 'light';

  root.style.setProperty('--outer-bg', t.outerBg);
  root.style.setProperty('--shell-bg', t.shellBg);
  root.style.setProperty('--sidebar-bg', t.sidebarBg);
  root.style.setProperty('--panel-bg', t.panelBg);
  root.style.setProperty('--card-bg', t.cardBg);
  root.style.setProperty('--banner-bg', t.bannerBg);
  root.style.setProperty('--input-bg', isDark ? t.shellBg : t.cardBg);
  root.style.setProperty('--text-primary', t.textPrimary);
  root.style.setProperty('--text-muted', t.textMuted);
  root.style.setProperty('--author-color', t.authorColor);
  root.style.setProperty('--accent-primary', t.accentPrimary);
  root.style.setProperty('--accent-secondary', t.accentSecondary);
  root.style.setProperty('--accent-contrast', getContrastColor(t.accentPrimary));
  root.style.setProperty('--accent-secondary-contrast', getContrastColor(t.accentSecondary));
  root.style.setProperty('--sidebar-pill-bg', t.sidebarPillBg);
  root.style.setProperty('--sidebar-pill-contrast', getContrastColor(t.sidebarPillBg));
  root.style.setProperty('--search-gradient', t.searchGradient);
  root.style.setProperty('--chat-user-bubble', t.chatUserBubble);
  root.style.setProperty('--chat-user-contrast', getContrastColor(t.chatUserBubble));
  root.style.setProperty('--chat-bot-bubble', t.chatBotBubble);
  root.style.setProperty('--font-ui', `'${t.fontFamily}', 'Nunito', system-ui, sans-serif`);
  root.style.setProperty('--ui-scale', String(t.uiScale));
  root.style.setProperty('--radius-shell', `${t.borderRadius}px`);
  root.style.setProperty('--radius-card', `${Math.max(12, Math.round(t.borderRadius * 0.72))}px`);
  root.style.setProperty('--glass-opacity', String(t.wallpaperOpacity ?? 0.78));
  root.style.setProperty('--glass-blur', `${t.wallpaperBlur ?? 12}px`);

  root.style.setProperty(
    '--shadow-shell',
    isDark
      ? '0 28px 70px rgba(0, 0, 0, 0.55), 0 4px 18px rgba(0, 0, 0, 0.32)'
      : '0 28px 70px rgba(72, 54, 42, 0.16), 0 4px 18px rgba(72, 54, 42, 0.08)'
  );
  root.style.setProperty(
    '--shadow-soft',
    isDark ? '0 8px 22px rgba(0, 0, 0, 0.28)' : '0 8px 24px rgba(72, 54, 42, 0.07)'
  );
  root.style.setProperty(
    '--shadow-book',
    isDark ? '0 12px 24px rgba(0, 0, 0, 0.44)' : '0 12px 22px rgba(58, 44, 34, 0.16)'
  );

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', t.sidebarBg);
  }
}

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [annotations, setAnnotations] = useState<BookAnnotation[]>([]);
  const [customBookmarkDesigns, setCustomBookmarkDesigns] = useState<BookmarkDesign[]>([]);
  const [customStationery, setCustomStationery] = useState<CustomStationeryKit>({
    swatches: [],
    stickers: [],
    emojis: [],
  });
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
  const [readerJumpTarget, setReaderJumpTarget] = useState<ReaderJumpTarget | null>(null);
  const [audioBook, setAudioBook] = useState<BookItem | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [editingBook, setEditingBook] = useState<BookItem | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [studioModalOpen, setStudioModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [serverOnline, setServerOnline] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [serverAuthRequired, setServerAuthRequired] = useState(false);
  const [serverLanUrl, setServerLanUrl] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [remoteActiveSession, setRemoteActiveSession] = useState<ActiveReadingSession | null>(null);
  const [sharedRooms, setSharedRooms] = useState<SharedRoom[]>([]);
  const [selectedRoomCode, setSelectedRoomCode] = useState('');
  const [pendingJoinCode, setPendingJoinCode] = useState('');
  const [sharedShelves, setSharedShelves] = useState<SharedShelf[]>([]);
  const [selectedShelfCode, setSelectedShelfCode] = useState('');
  const [pendingShelfCode, setPendingShelfCode] = useState('');
  const [aiOnline, setAiOnline] = useState(false);
  const [aiModelName, setAiModelName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const deletedIdsRef = useRef<string[]>([]);
  const deletedBookmarkIdsRef = useRef<string[]>([]);
  const deletedAnnotationIdsRef = useRef<string[]>([]);
  const deletedNoteIdsRef = useRef<string[]>([]);
  const deletedBookmarkDesignIdsRef = useRef<string[]>([]);
  const joinedRoomCodesRef = useRef<string[]>([]);
  const joinedShelfCodesRef = useRef<string[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const themeUpdatedAtRef = useRef<number>(0);
  const profileUpdatedAtRef = useRef<number>(0);
  const localActiveSessionRef = useRef<ActiveReadingSession | null>(null);
  const suppressAutoSyncRef = useRef<boolean>(false);
  const autoSyncTimerRef = useRef<number | null>(null);
  const roomProgressTimersRef = useRef<Record<string, number>>({});

  const persistPendingTombstones = useCallback(() => {
    dbSetKV('pendingTombstones', {
      books: Array.from(new Set(deletedIdsRef.current)).slice(-300),
      bookmarks: Array.from(new Set(deletedBookmarkIdsRef.current)).slice(-300),
      annotations: Array.from(new Set(deletedAnnotationIdsRef.current)).slice(-500),
      notes: Array.from(new Set(deletedNoteIdsRef.current)).slice(-300),
      customBookmarkDesigns: Array.from(new Set(deletedBookmarkDesignIdsRef.current)).slice(-200),
    }).catch(console.error);
  }, []);
  const stateRef = useRef({
    books,
    bookmarks,
    annotations,
    customBookmarkDesigns,
    customStationery,
    notes,
    categories,
    collections,
    readerSettings,
    theme,
    profile,
    syncConfig,
    deviceId,
    sharedRooms,
    sharedShelves,
  });
  stateRef.current = {
    books,
    bookmarks,
    annotations,
    customBookmarkDesigns,
    customStationery,
    notes,
    categories,
    collections,
    readerSettings,
    theme,
    profile,
    syncConfig,
    deviceId,
    sharedRooms,
    sharedShelves,
  };

  const allBookmarkDesigns = React.useMemo(
    () => [...BUILTIN_BOOKMARK_DESIGNS, ...customBookmarkDesigns],
    [customBookmarkDesigns]
  );

  const detectDeviceName = () => {
    if (typeof navigator === 'undefined') return 'Web';
    const ua = navigator.userAgent || '';
    if (/Capacitor|wv\)/i.test(ua) && /Android/i.test(ua)) return 'APK Android';
    if (/Android/i.test(ua)) return 'Android Web';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    return 'Web PC';
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Bootstrap from IndexedDB (100% local-first & per-user independent!)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [
        savedTheme,
        savedCats,
        savedCols,
        savedProfile,
        savedReader,
        savedSync,
        savedChat,
        seeded,
        savedDeviceId,
        savedJoinedCodes,
        savedShelfCodes,
        savedCustomDesigns,
        savedCustomStationery,
        savedPendingTombstones,
        savedThemeTs,
        savedProfileTs,
        savedExplicitLogout,
      ] = await Promise.all([
        dbGetKV<ThemeConfig>('theme'),
        dbGetKV<CategoryItem[]>('categories'),
        dbGetKV<CollectionCard[]>('collections'),
        dbGetKV<UserProfile>('profile'),
        dbGetKV<ReaderSettings>('readerSettings'),
        dbGetKV<SyncConfig>('syncConfig'),
        dbGetKV<ChatMessage[]>('chatMessages'),
        dbGetKV<boolean>('seeded'),
        dbGetKV<string>('deviceId'),
        dbGetKV<string[]>('joinedRoomCodes'),
        dbGetKV<string[]>('joinedShelfCodes'),
        dbGetKV<BookmarkDesign[]>('customBookmarkDesigns'),
        dbGetKV<CustomStationeryKit>('customStationery'),
        dbGetKV<{
          books?: string[];
          bookmarks?: string[];
          annotations?: string[];
          notes?: string[];
          customBookmarkDesigns?: string[];
        }>('pendingTombstones'),
        dbGetKV<number>('themeUpdatedAt'),
        dbGetKV<number>('profileUpdatedAt'),
        dbGetKV<boolean>('explicitLogout'),
      ]);

      if (typeof savedThemeTs === 'number') themeUpdatedAtRef.current = savedThemeTs;
      if (typeof savedProfileTs === 'number') profileUpdatedAtRef.current = savedProfileTs;

      if (savedPendingTombstones) {
        if (Array.isArray(savedPendingTombstones.books)) {
          deletedIdsRef.current = savedPendingTombstones.books;
        }
        if (Array.isArray(savedPendingTombstones.bookmarks)) {
          deletedBookmarkIdsRef.current = savedPendingTombstones.bookmarks;
        }
        if (Array.isArray(savedPendingTombstones.annotations)) {
          deletedAnnotationIdsRef.current = savedPendingTombstones.annotations;
        }
        if (Array.isArray(savedPendingTombstones.notes)) {
          deletedNoteIdsRef.current = savedPendingTombstones.notes;
        }
        if (Array.isArray(savedPendingTombstones.customBookmarkDesigns)) {
          deletedBookmarkDesignIdsRef.current = savedPendingTombstones.customBookmarkDesigns;
        }
      }

      let resolvedDeviceId = savedDeviceId;
      if (!resolvedDeviceId) {
        resolvedDeviceId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await dbSetKV('deviceId', resolvedDeviceId);
      }

      if (Array.isArray(savedJoinedCodes)) {
        joinedRoomCodesRef.current = savedJoinedCodes;
      }
      if (Array.isArray(savedShelfCodes)) {
        joinedShelfCodesRef.current = savedShelfCodes;
      }

      // First-time users ALWAYS start with an empty library (0 demo books).
      // Also purge any legacy auto-seeded demo books if present.
      const allStoredBooks = await dbGetAllBooks();
      const demoBooks = allStoredBooks.filter((b) => b.isDemo);
      for (const dbk of demoBooks) {
        await dbDeleteBook(dbk.id).catch(() => undefined);
      }
      const loadedBooks = allStoredBooks.filter((b) => !b.isDemo);
      if (!seeded) {
        await dbSetKV('seeded', true);
      }

      const [loadedBookmarks, loadedAnnotations, loadedNotes] = await Promise.all([
        dbGetAllBookmarks(),
        dbGetAllAnnotations(),
        dbGetAllNotes(),
      ]);

      if (cancelled) return;

      setDeviceId(resolvedDeviceId);

      // Every user gets their own private vault spaceId so two users NEVER see each other's library
      let initialSync: SyncConfig = {
        ...DEFAULT_SYNC_CONFIG,
        ...(savedSync || {}),
      };

      // Netlify builds receive the API URL via VITE_SYNC_SERVER_URL. If this browser
      // still has an old localhost/public address saved, migrate it to the deployed server.
      if (SYNC_SERVER_URL) {
        const savedServer = initialSync.serverUrl.trim();
        const staleServer =
          !savedServer ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(savedServer) ||
          /\.trycloudflare\.com$/i.test(savedServer);
        if (staleServer) {
          initialSync = { ...initialSync, serverUrl: SYNC_SERVER_URL };
          await dbSetKV('syncConfig', initialSync);
        }
      }

      if (!initialSync.spaceId) {
        initialSync.spaceId = `vault_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await dbSetKV('syncConfig', initialSync);
      }

      // Check URL query for ?pair=1 (personal Web <-> APK), ?join=KOMO-XXXX, or ?shelf=SHELF-XXXX
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const joinParam = params.get('join')?.trim().toUpperCase();
        const shelfParam = params.get('shelf')?.trim().toUpperCase();
        const isPairParam = params.get('pair') === '1';
        const serverParam = params.get('server')?.trim().replace(/\/+$/, '');
        const spaceParam = params.get('space')?.trim();
        const tokenParam = params.get('token')?.trim();
        const publicParam = params.get('publicUrl')?.trim().replace(/\/+$/, '');

        if (isPairParam) {
          const fallbackOrigin =
            window.location.origin.startsWith('http') &&
            !/localhost|127\.0\.0\.1/i.test(window.location.origin)
              ? window.location.origin.replace(/\/+$/, '')
              : initialSync.serverUrl;
          initialSync = {
            ...initialSync,
            serverUrl: serverParam || fallbackOrigin,
            spaceId: spaceParam || initialSync.spaceId,
            token: tokenParam !== undefined ? tokenParam : initialSync.token,
            publicUrl: publicParam !== undefined ? publicParam : initialSync.publicUrl,
            autoSync: true,
            liveSync: true,
          };
          await dbSetKV('syncConfig', initialSync);
          setNavSection('shared');
          try {
            window.history.replaceState({}, '', window.location.pathname);
          } catch {
            // ignore
          }
        } else if (joinParam || shelfParam) {
          if (joinParam) setPendingJoinCode(joinParam);
          if (shelfParam) setPendingShelfCode(shelfParam);
          setNavSection('shared');
          const guestOrigin =
            serverParam ||
            (window.location.origin.startsWith('http')
              ? window.location.origin.replace(/\/+$/, '')
              : initialSync.serverUrl);
          if (!savedSync?.serverUrl) {
            // Connect to the host server ONLY for the shared room/shelf; keep personal sync OFF!
            initialSync = {
              ...initialSync,
              serverUrl: guestOrigin,
              autoSync: false,
              liveSync: false,
            };
            await dbSetKV('syncConfig', initialSync);
          } else if (serverParam && serverParam !== initialSync.serverUrl) {
            initialSync = { ...initialSync, serverUrl: serverParam };
            await dbSetKV('syncConfig', initialSync);
          }
        }
      }

      const mergedTheme = { ...DEFAULT_THEME, ...(savedTheme || {}) };
      setTheme(mergedTheme);
      applyThemeCssVars(mergedTheme);

      if (savedCats?.length) setCategories(savedCats);
      if (savedCols?.length) setCollections(savedCols);
      if (savedProfile) setProfile({ ...DEFAULT_PROFILE, ...savedProfile });
      if (savedReader) setReaderSettings({ ...DEFAULT_READER_SETTINGS, ...savedReader });
      setSyncConfig(initialSync);
      if (savedChat?.length) setChatMessages(savedChat);
      const pendingBookDel = new Set(deletedIdsRef.current);
      const pendingBmDel = new Set(deletedBookmarkIdsRef.current);
      const pendingAnnDel = new Set(deletedAnnotationIdsRef.current);
      const pendingNoteDel = new Set(deletedNoteIdsRef.current);
      const pendingDesignDel = new Set(deletedBookmarkDesignIdsRef.current);

      if (Array.isArray(savedCustomDesigns)) {
        setCustomBookmarkDesigns(savedCustomDesigns.filter((d) => !pendingDesignDel.has(d.id)));
      }
      if (savedCustomStationery) {
        setCustomStationery({
          swatches: Array.isArray(savedCustomStationery.swatches) ? savedCustomStationery.swatches : [],
          stickers: Array.isArray(savedCustomStationery.stickers) ? savedCustomStationery.stickers : [],
          emojis: Array.isArray(savedCustomStationery.emojis) ? savedCustomStationery.emojis : [],
        });
      }

      setBooks(loadedBooks.filter((b) => !pendingBookDel.has(b.id)));
      setBookmarks(loadedBookmarks.filter((b) => !pendingBmDel.has(b.id)));
      setAnnotations(loadedAnnotations.filter((a) => !pendingAnnDel.has(a.id)));
      setNotes(loadedNotes.filter((n) => !pendingNoteDel.has(n.id)));

      // If accessed by the owner on localhost (:3000, :4123, :5173), LAN, or the deployed server from the owner's network
      // (and not explicitly logged out or joining a guest room), auto-connect to the owner's primary vault
      // so the saved custom theme, books, and marcadores display immediately on both localhost:3000 and the tunnel!
      const hasGuestParam =
        typeof window !== 'undefined' &&
        (new URLSearchParams(window.location.search).has('join') ||
          new URLSearchParams(window.location.search).has('shelf'));

      if (!savedExplicitLogout && !hasGuestParam && !savedSync?.accountEmail) {
        try {
          const defaultBase =
            typeof window !== 'undefined' &&
            window.location.origin.startsWith('http') &&
            !/:5173$/.test(window.location.origin)
              ? window.location.origin.replace(/\/+$/, '')
              : 'http://localhost:4123';
          const isLocalOrigin =
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
          const health = await checkServerHealth({
            ...initialSync,
            serverUrl: initialSync.serverUrl || defaultBase,
          }).catch(() => null);

          if ((isLocalOrigin || health?.isOwnerNetwork) && health?.ownerSpaceId) {
            initialSync = {
              ...initialSync,
              serverUrl: initialSync.serverUrl || defaultBase,
              spaceId: health.ownerSpaceId,
              autoSync: true,
              liveSync: true,
            };
            setSyncConfig(initialSync);
            await dbSetKV('syncConfig', initialSync);
            const remote = await fetchRemoteSyncState(initialSync).catch(() => null);
            if (remote && !cancelled) {
              await applyRemotePayload(remote, loadedBooks.length === 0);
            }
          }
        } catch {
          // ignore offline bootstrap check
        }
      }

      setReady(true);

      // Background pass: ensure existing books in IndexedDB extract their original cover
      // (or use adaptive cover when the file has no embedded cover image)
      const needsCheck = loadedBooks.filter((b) => !b.coverCheckedV2);
      if (needsCheck.length > 0) {
        (async () => {
          for (const book of needsCheck) {
            if (cancelled) return;
            try {
              let patch: Partial<BookItem> = { coverCheckedV2: true };
              if (book.isDemo) {
                patch.hasOriginalCover = book.format !== 'md';
              } else if (book.hasLocalFile) {
                const fileRec = await dbGetBookFile(book.id);
                const extracted = fileRec
                  ? await extractOriginalCoverFromBlob(
                      fileRec.blob,
                      book.format,
                      book.title,
                      fileRec.extraImages
                    )
                  : {};
                if (extracted.coverDataUrl) {
                  const pal = await extractCoverPaletteFromDataUrl(
                    extracted.coverDataUrl,
                    book.spineColor.startsWith('#') ? book.spineColor : '#4c6c8a',
                    book.ribbonColor || '#f2ba59'
                  );
                  patch = {
                    coverDataUrl: extracted.coverDataUrl,
                    hasOriginalCover: true,
                    coverCheckedV2: true,
                    spineColor: pal.spineColor,
                    ribbonColor: pal.ribbonColor,
                  };
                } else {
                  const hasCustomRasterCover =
                    Boolean(book.coverDataUrl) && !book.coverDataUrl.startsWith('data:image/svg+xml');
                  if (hasCustomRasterCover) {
                    const pal = await extractCoverPaletteFromDataUrl(
                      book.coverDataUrl,
                      book.spineColor.startsWith('#') ? book.spineColor : '#4c6c8a',
                      book.ribbonColor || '#f2ba59'
                    );
                    patch = {
                      hasOriginalCover: true,
                      coverCheckedV2: true,
                      spineColor: pal.spineColor,
                      ribbonColor: pal.ribbonColor,
                    };
                  } else {
                    patch = {
                      hasOriginalCover: false,
                      coverCheckedV2: true,
                    };
                  }
                }
              }

              const updatedBook: BookItem = { ...book, ...patch };
              await dbPutBook(updatedBook);
              if (!cancelled) {
                setBooks((prev) => prev.map((x) => (x.id === book.id ? { ...x, ...patch } : x)));
              }
            } catch {
              // skip faulty book without blocking other books
            }
          }
        })();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    applyThemeCssVars(theme);
  }, [theme]);

  const refreshServerHealth = useCallback(async () => {
    const cfg = stateRef.current.syncConfig;
    try {
      const h = await checkServerHealth(cfg);
      setServerOnline(true);
      setServerAuthRequired(Boolean(h.authRequired));
      setAiOnline(Boolean(h.aiConfigured));
      setAiModelName(h.aiModel || 'gemini-2.5-flash');
      setServerLanUrl(h.lanUrls?.[0] || '');
    } catch {
      setServerOnline(false);
      setAiOnline(false);
    }
  }, []);

  // Detect server health, LAN/Public URL, and Gemini AI proxy availability
  useEffect(() => {
    if (!ready) return;
    refreshServerHealth();
  }, [ready, syncConfig.serverUrl, syncConfig.token, refreshServerHealth]);

  const applyRemotePayload = useCallback(
    async (merged: RemoteSyncPayload, forceRestore = false) => {
      suppressAutoSyncRef.current = true;
      try {
        const current = stateRef.current;
        // ALWAYS union server tombstones with local pending tombstones so a stale pull/sync NEVER resurrects deleted items!
        const deletedBookSet = new Set([
          ...(merged.deletedBookIds || []),
          ...deletedIdsRef.current,
        ]);
        const deletedBookmarkSet = new Set([
          ...(merged.deletedBookmarkIds || []),
          ...deletedBookmarkIdsRef.current,
        ]);
        const deletedAnnotationSet = new Set([
          ...(merged.deletedAnnotationIds || []),
          ...deletedAnnotationIdsRef.current,
        ]);
        const deletedNoteSet = new Set([
          ...(merged.deletedNoteIds || []),
          ...deletedNoteIdsRef.current,
        ]);
        const deletedDesignSet = new Set([
          ...(merged.deletedBookmarkDesignIds || []),
          ...deletedBookmarkDesignIdsRef.current,
        ]);

        // Remove tombstoned books from IndexedDB
        for (const delId of deletedBookSet) {
          if (current.books.some((b) => b.id === delId)) {
            await dbDeleteBook(delId).catch(() => undefined);
          }
        }

        // Safely merge remote books with local books (preserving unsynced local additions & skipping demo books)
        const mergedMap = new Map<string, BookItem>();
        for (const localBook of current.books) {
          if (!localBook.isDemo && !deletedBookSet.has(localBook.id)) {
            mergedMap.set(localBook.id, localBook);
          }
        }
        const booksToAutoDownload: BookItem[] = [];
        for (const remoteBook of Object.values(merged.books || {})) {
          if (!remoteBook || remoteBook.isDemo || deletedBookSet.has(remoteBook.id)) continue;
          const local = mergedMap.get(remoteBook.id);
          const hasFileRec = local?.hasLocalFile ? true : Boolean(await dbGetBookFile(remoteBook.id));
          if (!local || forceRestore || (remoteBook.updatedAt || 0) >= (local.updatedAt || 0)) {
            const mergedItem: BookItem = {
              ...remoteBook,
              hasLocalFile: hasFileRec,
            };
            await dbPutBook(mergedItem);
            mergedMap.set(remoteBook.id, mergedItem);
            if (!hasFileRec && remoteBook.hasRemoteFile) {
              booksToAutoDownload.push(mergedItem);
            }
          } else if (remoteBook.hasRemoteFile && !local.hasRemoteFile) {
            const updatedLocal: BookItem = {
              ...local,
              hasRemoteFile: true,
              remoteFileName: remoteBook.remoteFileName || local.remoteFileName,
            };
            await dbPutBook(updatedLocal);
            mergedMap.set(remoteBook.id, updatedLocal);
            if (!hasFileRec) {
              booksToAutoDownload.push(updatedLocal);
            }
          }
        }

        const nextBooks = Array.from(mergedMap.values()).sort(
          (a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
        );
        setBooks(nextBooks);

        // Background auto-download book files from user's cloud vault so they are immediately ready to open
        if (booksToAutoDownload.length > 0) {
          (async () => {
            for (const target of booksToAutoDownload) {
              try {
                await downloadBookFromServer(stateRef.current.syncConfig, target);
                const patched: BookItem = { ...target, hasLocalFile: true };
                await dbPutBook(patched);
                setBooks((prev) =>
                  prev.map((x) => (x.id === target.id ? { ...x, hasLocalFile: true } : x))
                );
              } catch {
                // will retry when book is clicked
              }
            }
          })();
        }

        if (merged.bookmarks) {
          for (const delId of deletedBookmarkSet) {
            await dbDeleteBookmark(delId).catch(() => undefined);
          }
          const bmMap = new Map<string, BookmarkItem>();
          for (const bm of current.bookmarks) {
            if (!deletedBookmarkSet.has(bm.id)) bmMap.set(bm.id, bm);
          }
          for (const bm of merged.bookmarks) {
            if (!deletedBookmarkSet.has(bm.id)) {
              await dbPutBookmark(bm);
              bmMap.set(bm.id, bm);
            }
          }
          setBookmarks(Array.from(bmMap.values()).sort((a, b) => b.createdAt - a.createdAt));
        }

        if (merged.annotations) {
          for (const delId of deletedAnnotationSet) {
            await dbDeleteAnnotation(delId).catch(() => undefined);
          }
          const annMap = new Map<string, BookAnnotation>();
          for (const a of current.annotations) {
            if (!deletedAnnotationSet.has(a.id)) annMap.set(a.id, a);
          }
          for (const a of merged.annotations) {
            if (!deletedAnnotationSet.has(a.id)) {
              const prev = annMap.get(a.id);
              if (
                !prev ||
                forceRestore ||
                (a.updatedAt || a.createdAt) >= (prev.updatedAt || prev.createdAt)
              ) {
                await dbPutAnnotation(a);
                annMap.set(a.id, a);
              }
            }
          }
          setAnnotations(Array.from(annMap.values()).sort((a, b) => b.createdAt - a.createdAt));
        }

        if (merged.customBookmarkDesigns) {
          const designMap = new Map<string, BookmarkDesign>();
          for (const d of current.customBookmarkDesigns) {
            if (!deletedDesignSet.has(d.id)) designMap.set(d.id, d);
          }
          for (const d of merged.customBookmarkDesigns) {
            if (!deletedDesignSet.has(d.id)) designMap.set(d.id, d);
          }
          const mergedDesigns = Array.from(designMap.values());
          setCustomBookmarkDesigns(mergedDesigns);
          await dbSetKV('customBookmarkDesigns', mergedDesigns);
        }

        if (merged.customStationery) {
          const currSt = current.customStationery;
          const swMap = new Map<string, CustomSwatchItem>();
          for (const s of currSt.swatches || []) swMap.set(s.id, s);
          for (const s of merged.customStationery.swatches || []) swMap.set(s.id, s);
          const stkMap = new Map<string, CustomStickerItem>();
          for (const s of currSt.stickers || []) stkMap.set(s.id, s);
          for (const s of merged.customStationery.stickers || []) stkMap.set(s.id, s);
          const emSet = new Set([
            ...(merged.customStationery.emojis || []),
            ...(currSt.emojis || []),
          ]);
          const nextSt: CustomStationeryKit = {
            swatches: Array.from(swMap.values()),
            stickers: Array.from(stkMap.values()),
            emojis: Array.from(emSet),
          };
          setCustomStationery(nextSt);
          await dbSetKV('customStationery', nextSt);
        }

        if (merged.notes) {
          for (const delId of deletedNoteSet) {
            await dbDeleteNote(delId).catch(() => undefined);
          }
          const noteMap = new Map<string, NoteItem>();
          for (const n of current.notes) {
            if (!deletedNoteSet.has(n.id)) noteMap.set(n.id, n);
          }
          for (const n of merged.notes) {
            if (!deletedNoteSet.has(n.id)) {
              const prev = noteMap.get(n.id);
              if (
                !prev ||
                forceRestore ||
                (n.updatedAt || n.createdAt) >= (prev.updatedAt || prev.createdAt)
              ) {
                await dbPutNote(n);
                noteMap.set(n.id, n);
              }
            }
          }
          setNotes(
            Array.from(noteMap.values()).sort(
              (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
            )
          );
        }

        if (merged.categories?.length) {
          setCategories(merged.categories);
          await dbSetKV('categories', merged.categories);
        }
        if (merged.collections?.length) {
          setCollections(merged.collections);
          await dbSetKV('collections', merged.collections);
        }
        if (merged.readerSettings && (forceRestore || !themeUpdatedAtRef.current)) {
          const mergedReader = { ...DEFAULT_READER_SETTINGS, ...merged.readerSettings };
          setReaderSettings(mergedReader);
          await dbSetKV('readerSettings', mergedReader);
        }
        if (
          merged.theme &&
          (forceRestore ||
            !themeUpdatedAtRef.current ||
            (merged.themeUpdatedAt || 0) >= themeUpdatedAtRef.current)
        ) {
          themeUpdatedAtRef.current = merged.themeUpdatedAt || Date.now();
          const mergedTheme = { ...DEFAULT_THEME, ...merged.theme };
          setTheme(mergedTheme);
          await dbSetKV('theme', mergedTheme);
          await dbSetKV('themeUpdatedAt', themeUpdatedAtRef.current);
        }
        if (
          merged.profile &&
          (forceRestore ||
            !profileUpdatedAtRef.current ||
            (merged.profileUpdatedAt || 0) >= profileUpdatedAtRef.current)
        ) {
          profileUpdatedAtRef.current = merged.profileUpdatedAt || Date.now();
          const mergedProfile = { ...DEFAULT_PROFILE, ...merged.profile };
          setProfile(mergedProfile);
          await dbSetKV('profile', mergedProfile);
          await dbSetKV('profileUpdatedAt', profileUpdatedAtRef.current);
        }
        if (
          merged.lastActiveSession &&
          merged.lastActiveSession.deviceId !== current.deviceId &&
          merged.lastActiveSession.updatedAt > (localActiveSessionRef.current?.updatedAt || 0)
        ) {
          setRemoteActiveSession(merged.lastActiveSession);
        }
        return nextBooks;
      } finally {
        window.setTimeout(() => {
          suppressAutoSyncRef.current = false;
        }, 300);
      }
    },
    []
  );

  const scheduleAutoSync = useCallback(
    (urgent = false) => {
      if (suppressAutoSyncRef.current && !urgent) return;
      const cfg = stateRef.current.syncConfig;
      if (cfg.liveSync === false || !cfg.serverUrl.trim()) return;
      if (autoSyncTimerRef.current) window.clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = window.setTimeout(async () => {
        const s = stateRef.current;
        if (s.syncConfig.liveSync === false || !s.syncConfig.serverUrl.trim()) return;

        // Snapshot tombstones before network call so deletions made during flight are NEVER lost!
        const sentBooks = [...deletedIdsRef.current];
        const sentBookmarks = [...deletedBookmarkIdsRef.current];
        const sentAnnotations = [...deletedAnnotationIdsRef.current];
        const sentNotes = [...deletedNoteIdsRef.current];
        const sentDesigns = [...deletedBookmarkDesignIdsRef.current];

        try {
          const merged = await syncFullState(
            s.syncConfig,
            {
              deviceId: s.deviceId,
              books: s.books,
              bookmarks: s.bookmarks,
              annotations: s.annotations,
              notes: s.notes,
              customBookmarkDesigns: s.customBookmarkDesigns,
              customStationery: s.customStationery,
              categories: s.categories,
              collections: s.collections,
              readerSettings: s.readerSettings,
              theme: s.theme,
              themeUpdatedAt: themeUpdatedAtRef.current,
              profile: s.profile,
              profileUpdatedAt: profileUpdatedAtRef.current,
              lastActiveSession: localActiveSessionRef.current,
              deletedBookIds: sentBooks,
              deletedBookmarkIds: sentBookmarks,
              deletedAnnotationIds: sentAnnotations,
              deletedNoteIds: sentNotes,
              deletedBookmarkDesignIds: sentDesigns,
            },
            true,
            true
          );

          const sentBookSet = new Set(sentBooks);
          const sentBmSet = new Set(sentBookmarks);
          const sentAnnSet = new Set(sentAnnotations);
          const sentNoteSet = new Set(sentNotes);
          const sentDesignSet = new Set(sentDesigns);

          deletedIdsRef.current = deletedIdsRef.current.filter((x) => !sentBookSet.has(x));
          deletedBookmarkIdsRef.current = deletedBookmarkIdsRef.current.filter(
            (x) => !sentBmSet.has(x)
          );
          deletedAnnotationIdsRef.current = deletedAnnotationIdsRef.current.filter(
            (x) => !sentAnnSet.has(x)
          );
          deletedNoteIdsRef.current = deletedNoteIdsRef.current.filter(
            (x) => !sentNoteSet.has(x)
          );
          deletedBookmarkDesignIdsRef.current = deletedBookmarkDesignIdsRef.current.filter(
            (x) => !sentDesignSet.has(x)
          );
          persistPendingTombstones();

          await applyRemotePayload(merged);
          setServerOnline(true);
          setSyncStatus('ok');
          setSyncMessage(`Sync en vivo (${Object.keys(merged.books || {}).length} títulos)`);

          // If new deletions arrived while this sync was in flight, flush them right away!
          if (
            deletedIdsRef.current.length ||
            deletedBookmarkIdsRef.current.length ||
            deletedAnnotationIdsRef.current.length ||
            deletedNoteIdsRef.current.length ||
            deletedBookmarkDesignIdsRef.current.length
          ) {
            scheduleAutoSync(true);
          }
        } catch {
          // silent background sync retry next mutation
        }
      }, urgent ? 320 : 1800);
    },
    [applyRemotePayload, persistPendingTombstones]
  );

  const updateTheme = useCallback(
    (patch: Partial<ThemeConfig>) => {
      const ts = Date.now();
      themeUpdatedAtRef.current = ts;
      dbSetKV('themeUpdatedAt', ts).catch(console.error);
      setTheme((prev) => {
        const next = { ...prev, ...patch };
        if (
          !patch.searchGradient &&
          (patch.accentPrimary !== undefined || patch.accentSecondary !== undefined) &&
          (patch.presetId === 'custom' || next.presetId === 'custom')
        ) {
          next.searchGradient = `linear-gradient(100deg, ${next.accentSecondary} 0%, ${next.accentPrimary} 100%)`;
        }
        dbSetKV('theme', next).catch(console.error);
        return next;
      });
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

  const resetTheme = useCallback(() => {
    const ts = Date.now();
    themeUpdatedAtRef.current = ts;
    dbSetKV('themeUpdatedAt', ts).catch(console.error);
    setTheme(DEFAULT_THEME);
    dbSetKV('theme', DEFAULT_THEME).catch(console.error);
    showToast('Tema restaurado a Komo Cream');
    scheduleAutoSync();
  }, [scheduleAutoSync, showToast]);

  const updateReaderSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      setReaderSettings((prev) => {
        const next = { ...prev, ...patch };
        dbSetKV('readerSettings', next).catch(console.error);
        return next;
      });
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

  const updateProfile = useCallback(
    (patch: Partial<UserProfile>) => {
      const ts = Date.now();
      profileUpdatedAtRef.current = ts;
      dbSetKV('profileUpdatedAt', ts).catch(console.error);
      setProfile((prev) => {
        const next = { ...prev, ...patch };
        dbSetKV('profile', next).catch(console.error);
        return next;
      });
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

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
      scheduleAutoSync();
    },
    [scheduleAutoSync, showToast]
  );

  const deleteCategory = useCallback(
    (id: string) => {
      setCategories((prev) => {
        const next = prev.filter((c) => c.id !== id || c.id === 'all');
        dbSetKV('categories', next).catch(console.error);
        return next;
      });
      setActiveCategory((curr) => (curr === id ? 'all' : curr));
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

  const updateCollection = useCallback(
    (id: string, patch: Partial<CollectionCard>) => {
      setCollections((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
        dbSetKV('collections', next).catch(console.error);
        return next;
      });
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

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
      const { supported } = filterSupportedFiles(files);
      if (!supported.length) {
        showToast('No se encontraron archivos compatibles en la selección');
        return [];
      }

      const added: BookItem[] = [];
      const imageFiles = supported.filter((f) => isImageFile(f));
      const nonImageFiles = supported.filter((f) => !isImageFile(f));

      // Import all standard book/comic/audio files individually
      for (const f of nonImageFiles) {
        const bundle = await importSingleFile(f, {
          title: nonImageFiles.length === 1 && imageFiles.length === 0 ? opts?.title : undefined,
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

      // Import images (either grouped by folder / single bundle, or individually)
      if (imageFiles.length > 0) {
        if (opts?.bundleImages && imageFiles.length > 1) {
          const groups = groupImagesByFolder(imageFiles);
          for (const group of groups) {
            const groupTitle =
              groups.length === 1 && opts?.title
                ? opts.title
                : group.folderName || opts?.title || 'Volumen Ilustrado';
            const bundle = await importImageBundle(
              group.files,
              groupTitle,
              opts?.author || 'Biblioteca Personal',
              opts?.kind || 'manhwa',
              opts?.categories || []
            );
            await dbPutBook(bundle.book);
            await dbPutBookFile(bundle.book.id, bundle.blob, bundle.extraImages);
            added.push(bundle.book);
          }
        } else {
          for (const f of imageFiles) {
            const bundle = await importSingleFile(f, {
              title: supported.length === 1 ? opts?.title : undefined,
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
      }

      setBooks((prev) => [...added, ...prev]);
      showToast(
        added.length === 1
          ? `"${added[0].title}" añadido a tu librería`
          : `${added.length} títulos añadidos a tu librería`
      );
      scheduleAutoSync();
      return added;
    },
    [scheduleAutoSync, showToast, syncConfig]
  );

  const updateBook = useCallback(
    async (id: string, patch: Partial<BookItem>) => {
      let latestBook: BookItem | undefined;
      setBooks((prev) => {
        const next = prev.map((b) =>
          b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b
        );
        latestBook = next.find((b) => b.id === id);
        if (latestBook) {
          dbPutBook(latestBook).catch(console.error);
        }
        return next;
      });
      setActiveBook((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr));

      // Update active reading session for Web <-> APK continuity
      if (patch.progress !== undefined || patch.currentPage !== undefined || patch.lastReadAt !== undefined) {
        const target = latestBook || stateRef.current.books.find((b) => b.id === id);
        if (target) {
          localActiveSessionRef.current = {
            bookId: target.id,
            title: target.title,
            author: target.author,
            progress: patch.progress ?? target.progress ?? 0,
            currentPage: patch.currentPage ?? target.currentPage,
            deviceId: stateRef.current.deviceId,
            deviceName: detectDeviceName(),
            updatedAt: Date.now(),
          };
        }

        // Broadcast progress live to any Shared Reading Room linked to this book
        const matchingRooms = stateRef.current.sharedRooms.filter((r) => r.bookId === id);
        for (const room of matchingRooms) {
          const existingTimer = roomProgressTimersRef.current[room.code];
          if (existingTimer) window.clearTimeout(existingTimer);
          roomProgressTimersRef.current[room.code] = window.setTimeout(() => {
            const s = stateRef.current;
            const currentBook = s.books.find((b) => b.id === id);
            if (!currentBook || !s.deviceId) return;
            updateSharedRoomProgress(s.syncConfig, room.code, {
              participantId: s.deviceId,
              name: s.profile.name,
              avatarEmoji: s.profile.avatarEmoji,
              avatarBg: s.profile.avatarBg,
              progress: currentBook.progress || 0,
              currentPage: currentBook.currentPage,
              pageCount: currentBook.pageCount,
              readingStatus: currentBook.readingStatus,
            })
              .then((updatedRoom) => {
                setSharedRooms((prev) =>
                  prev.map((r) => (r.code === updatedRoom.code ? updatedRoom : r))
                );
              })
              .catch(() => undefined);
          }, 900);
        }
      }

      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

  const reExtractBookCover = useCallback(
    async (id: string): Promise<boolean> => {
      const target = books.find((b) => b.id === id);
      if (!target) return false;
      const fileRec = await dbGetBookFile(id);
      if (!fileRec) {
        showToast('No hay archivo local disponible para extraer portada');
        return false;
      }
      const extracted = await extractOriginalCoverFromBlob(
        fileRec.blob,
        target.format,
        target.title,
        fileRec.extraImages
      );
      if (extracted.coverDataUrl) {
        const pal = await extractCoverPaletteFromDataUrl(
          extracted.coverDataUrl,
          target.spineColor.startsWith('#') ? target.spineColor : '#4c6c8a',
          target.ribbonColor || '#f2ba59'
        );
        const patch: Partial<BookItem> = {
          coverDataUrl: extracted.coverDataUrl,
          hasOriginalCover: true,
          coverCheckedV2: true,
          spineColor: pal.spineColor,
          ribbonColor: pal.ribbonColor,
        };
        await updateBook(id, patch);
        setEditingBook((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr));
        showToast('Portada original extraída correctamente');
        return true;
      }
      await updateBook(id, { hasOriginalCover: false, coverCheckedV2: true });
      setEditingBook((curr) =>
        curr && curr.id === id ? { ...curr, hasOriginalCover: false, coverCheckedV2: true } : curr
      );
      showToast('Este archivo no incluye portada; se activó la portada adaptable');
      return false;
    },
    [books, showToast, updateBook]
  );

  const deleteBook = useCallback(
    async (id: string) => {
      await dbDeleteBook(id);
      if (!deletedIdsRef.current.includes(id)) deletedIdsRef.current.push(id);
      persistPendingTombstones();
      setBooks((prev) => prev.filter((b) => b.id !== id));
      if (activeBook?.id === id) setActiveBook(null);
      if (editingBook?.id === id) setEditingBook(null);
      if (syncConfig.autoSync && syncConfig.serverUrl) {
        deleteBookFromServer(syncConfig, id).catch(() => undefined);
      }
      showToast('Título eliminado');
      scheduleAutoSync(true);
    },
    [activeBook, editingBook, persistPendingTombstones, scheduleAutoSync, showToast, syncConfig]
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

  const clearReaderJumpTarget = useCallback(() => setReaderJumpTarget(null), []);

  const openBookAt = useCallback(
    async (book: BookItem, target: Omit<ReaderJumpTarget, 'id' | 'bookId'>) => {
      setReaderJumpTarget({
        ...target,
        id: `jmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        bookId: book.id,
      });
      await openBook(book);
    },
    [openBook]
  );

  const closeReader = useCallback(() => {
    setActiveBook(null);
    setReaderJumpTarget(null);
  }, []);

  const closeAudioPlayer = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBook(null);
  }, [audioUrl]);

  const addBookmark = useCallback(
    async (bm: Omit<BookmarkItem, 'id' | 'createdAt'>): Promise<BookmarkItem> => {
      const item: BookmarkItem = {
        ...bm,
        id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
      };
      await dbPutBookmark(item);
      setBookmarks((prev) => [item, ...prev]);
      showToast('Marcador guardado');
      scheduleAutoSync();
      return item;
    },
    [scheduleAutoSync, showToast]
  );

  const deleteBookmark = useCallback(
    async (id: string) => {
      await dbDeleteBookmark(id);
      if (!deletedBookmarkIdsRef.current.includes(id)) deletedBookmarkIdsRef.current.push(id);
      persistPendingTombstones();
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      showToast('Marcador eliminado');
      scheduleAutoSync(true);
    },
    [persistPendingTombstones, scheduleAutoSync, showToast]
  );

  const addAnnotation = useCallback(
    async (
      ann: Omit<BookAnnotation, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<BookAnnotation> => {
      const now = Date.now();
      const item: BookAnnotation = {
        ...ann,
        id: `ann_${now}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };
      await dbPutAnnotation(item);
      setAnnotations((prev) => [item, ...prev]);
      showToast(
        item.tool === 'postit'
          ? 'Post-it guardado en el texto'
          : item.tool === 'sticker' || item.tool === 'emoji'
          ? 'Sticker/emoji añadido al libro'
          : 'Marca guardada en tu libro'
      );
      scheduleAutoSync();
      return item;
    },
    [scheduleAutoSync, showToast]
  );

  const updateAnnotation = useCallback(
    async (id: string, patch: Partial<BookAnnotation>) => {
      setAnnotations((prev) => {
        const next = prev.map((a) =>
          a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a
        );
        const updated = next.find((a) => a.id === id);
        if (updated) dbPutAnnotation(updated).catch(console.error);
        return next;
      });
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

  const deleteAnnotation = useCallback(
    async (id: string) => {
      await dbDeleteAnnotation(id);
      if (!deletedAnnotationIdsRef.current.includes(id)) deletedAnnotationIdsRef.current.push(id);
      persistPendingTombstones();
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      showToast('Marca eliminada');
      scheduleAutoSync(true);
    },
    [persistPendingTombstones, scheduleAutoSync, showToast]
  );

  const addCustomBookmarkDesign = useCallback(
    async (name: string, file: File): Promise<BookmarkDesign | null> => {
      try {
        const imageUrl = await compressBookmarkImage(file);
        const design: BookmarkDesign = {
          id: `bm_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: name.trim() || file.name.replace(/\.[^.]+$/, '') || 'Mi Separador',
          imageUrl,
          accentColor: '#e86f68',
          builtin: false,
          createdAt: Date.now(),
        };
        setCustomBookmarkDesigns((prev) => {
          const next = [design, ...prev];
          dbSetKV('customBookmarkDesigns', next).catch(console.error);
          return next;
        });
        showToast(`Separador "${design.name}" añadido (comprimido localmente)`);
        scheduleAutoSync();
        return design;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo procesar la imagen');
        return null;
      }
    },
    [scheduleAutoSync, showToast]
  );

  const deleteCustomBookmarkDesign = useCallback(
    (id: string) => {
      if (!deletedBookmarkDesignIdsRef.current.includes(id)) {
        deletedBookmarkDesignIdsRef.current.push(id);
      }
      persistPendingTombstones();
      setCustomBookmarkDesigns((prev) => {
        const next = prev.filter((d) => d.id !== id);
        dbSetKV('customBookmarkDesigns', next).catch(console.error);
        return next;
      });
      showToast('Separador personalizado eliminado');
      scheduleAutoSync(true);
    },
    [persistPendingTombstones, scheduleAutoSync, showToast]
  );

  const persistStationery = useCallback(
    (updater: (prev: CustomStationeryKit) => CustomStationeryKit) => {
      setCustomStationery((prev) => {
        const next = updater(prev);
        dbSetKV('customStationery', next).catch(console.error);
        return next;
      });
      scheduleAutoSync();
    },
    [scheduleAutoSync]
  );

  const addCustomSwatch = useCallback(
    (swatch: Omit<CustomSwatchItem, 'id'>) => {
      const item: CustomSwatchItem = {
        ...swatch,
        id: `sw_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: swatch.name.trim() || 'Mi color',
        meaning: swatch.meaning.trim() || 'Personalizado',
      };
      persistStationery((prev) => ({ ...prev, swatches: [item, ...prev.swatches] }));
      showToast(`Añadido a tu kit: ${item.name}`);
    },
    [persistStationery, showToast]
  );

  const deleteCustomSwatch = useCallback(
    (id: string) => {
      persistStationery((prev) => ({
        ...prev,
        swatches: prev.swatches.filter((s) => s.id !== id),
      }));
      showToast('Color personalizado eliminado');
    },
    [persistStationery, showToast]
  );

  const addCustomSticker = useCallback(
    (sticker: Omit<CustomStickerItem, 'id'>) => {
      const item: CustomStickerItem = {
        ...sticker,
        id: `stk_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        emoji: sticker.emoji.trim() || '✨',
        label: sticker.label.trim() || 'Mi Sticker',
      };
      persistStationery((prev) => ({ ...prev, stickers: [item, ...prev.stickers] }));
      showToast(`Sticker "${item.emoji} ${item.label}" añadido`);
    },
    [persistStationery, showToast]
  );

  const deleteCustomSticker = useCallback(
    (id: string) => {
      persistStationery((prev) => ({
        ...prev,
        stickers: prev.stickers.filter((s) => s.id !== id),
      }));
      showToast('Sticker personalizado eliminado');
    },
    [persistStationery, showToast]
  );

  const addCustomEmoji = useCallback(
    (rawEmoji: string) => {
      const em = rawEmoji.trim().slice(0, 8);
      if (!em) return;
      persistStationery((prev) => ({
        ...prev,
        emojis: prev.emojis.includes(em) ? prev.emojis : [em, ...prev.emojis],
      }));
      showToast(`Emoji ${em} añadido a tu barra`);
    },
    [persistStationery, showToast]
  );

  const deleteCustomEmoji = useCallback(
    (emoji: string) => {
      persistStationery((prev) => ({
        ...prev,
        emojis: prev.emojis.filter((e) => e !== emoji),
      }));
    },
    [persistStationery]
  );

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
      scheduleAutoSync();
    },
    [scheduleAutoSync, showToast]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      await dbDeleteNote(id);
      if (!deletedNoteIdsRef.current.includes(id)) deletedNoteIdsRef.current.push(id);
      persistPendingTombstones();
      setNotes((prev) => prev.filter((n) => n.id !== id));
      scheduleAutoSync(true);
    },
    [persistPendingTombstones, scheduleAutoSync]
  );

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

      // 1. Optional custom external AI endpoint (OpenAI / Ollama compatible)
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
          // Fall through to Gemini server proxy
        }
      }

      // 2. Built-in Gemini AI assistant via local KomoLib server proxy (API key stays in .env)
      try {
        const aiRes = await sendAiChatViaServer(syncConfig, {
          message: text,
          history: chatMessages.slice(-8).map((m) => ({ sender: m.sender, text: m.text })),
          books: books.slice(0, 40).map((b) => ({
            id: b.id,
            title: b.title,
            author: b.author,
            kind: b.kind,
            format: b.format,
            progress: b.progress,
            readingStatus: b.readingStatus,
            rating: b.rating,
            review: b.review,
          })),
          notes: notes.slice(0, 10).map((n) => ({
            bookTitle: books.find((b) => b.id === n.bookId)?.title || 'Libro',
            text: n.text,
          })),
          annotations: annotations.slice(0, 15).map((a) => ({
            bookTitle: books.find((b) => b.id === a.bookId)?.title || 'Libro',
            chapter: a.chapter,
            quote: a.quote,
            note: a.note,
          })),
          activeBook: activeBook
            ? {
                id: activeBook.id,
                title: activeBook.title,
                author: activeBook.author,
                progress: activeBook.progress,
              }
            : null,
          profileName: profile.name,
        });
        if (aiRes.ok && aiRes.reply) {
          setAiOnline(true);
          if (aiRes.model) setAiModelName(aiRes.model);
          appendMessages([
            {
              id: `msg_${Date.now()}_a`,
              sender: 'assistant',
              text: aiRes.reply,
              bookIds: aiRes.matchedBookIds?.length ? aiRes.matchedBookIds : undefined,
              createdAt: Date.now(),
            },
          ]);
          return;
        }
      } catch {
        // Fall through to offline local assistant
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
    [activeBook, addNote, annotations, books, chatMessages, notes, profile.name, syncConfig]
  );

  const clearChat = useCallback(() => {
    setChatMessages(INITIAL_CHAT_MESSAGES);
    dbSetKV('chatMessages', INITIAL_CHAT_MESSAGES).catch(console.error);
  }, []);

  const triggerSync = useCallback(
    async (silent = false) => {
      const cfg = stateRef.current.syncConfig;
      if (!cfg.serverUrl.trim()) {
        if (!silent) {
          setSyncStatus('error');
          setSyncMessage('Configura la URL del servidor primero');
        }
        return;
      }
      if (!silent) {
        setSyncStatus('syncing');
        setSyncMessage('Sincronizando con el servidor...');
      }
      try {
        const s = stateRef.current;
        const sentBooks = [...deletedIdsRef.current];
        const sentBookmarks = [...deletedBookmarkIdsRef.current];
        const sentAnnotations = [...deletedAnnotationIdsRef.current];
        const sentNotes = [...deletedNoteIdsRef.current];
        const sentDesigns = [...deletedBookmarkDesignIdsRef.current];

        const merged = await syncFullState(cfg, {
          deviceId: s.deviceId,
          books: s.books,
          bookmarks: s.bookmarks,
          annotations: s.annotations,
          notes: s.notes,
          customBookmarkDesigns: s.customBookmarkDesigns,
          customStationery: s.customStationery,
          categories: s.categories,
          collections: s.collections,
          readerSettings: s.readerSettings,
          theme: s.theme,
          themeUpdatedAt: themeUpdatedAtRef.current,
          profile: s.profile,
          profileUpdatedAt: profileUpdatedAtRef.current,
          lastActiveSession: localActiveSessionRef.current,
          deletedBookIds: sentBooks,
          deletedBookmarkIds: sentBookmarks,
          deletedAnnotationIds: sentAnnotations,
          deletedNoteIds: sentNotes,
          deletedBookmarkDesignIds: sentDesigns,
        });

        const sentBookSet = new Set(sentBooks);
        const sentBmSet = new Set(sentBookmarks);
        const sentAnnSet = new Set(sentAnnotations);
        const sentNoteSet = new Set(sentNotes);
        const sentDesignSet = new Set(sentDesigns);

        deletedIdsRef.current = deletedIdsRef.current.filter((x) => !sentBookSet.has(x));
        deletedBookmarkIdsRef.current = deletedBookmarkIdsRef.current.filter(
          (x) => !sentBmSet.has(x)
        );
        deletedAnnotationIdsRef.current = deletedAnnotationIdsRef.current.filter(
          (x) => !sentAnnSet.has(x)
        );
        deletedNoteIdsRef.current = deletedNoteIdsRef.current.filter(
          (x) => !sentNoteSet.has(x)
        );
        deletedBookmarkDesignIdsRef.current = deletedBookmarkDesignIdsRef.current.filter(
          (x) => !sentDesignSet.has(x)
        );
        persistPendingTombstones();

        const nextBooks = await applyRemotePayload(merged);
        const now = Date.now();
        updateSyncConfig({ lastSyncedAt: now });
        setServerOnline(true);
        setSyncStatus('ok');
        setSyncMessage(`Sincronizado (${nextBooks.length} títulos)`);
        if (!silent) showToast('Biblioteca sincronizada con el servidor');
      } catch (err) {
        if (!silent) {
          setSyncStatus('error');
          setSyncMessage(err instanceof Error ? err.message : 'No se pudo conectar al servidor');
        }
      }
    },
    [applyRemotePayload, persistPendingTombstones, showToast, updateSyncConfig]
  );

  // Cloud Account by Email + Full Backup / Restore
  const loginWithEmail = useCallback(
    async (rawEmail: string, rawPin = ''): Promise<boolean> => {
      const cleanEmail = rawEmail.trim().toLowerCase();
      if (!cleanEmail || cleanEmail.length < 3) {
        showToast('Ingresa tu correo electrónico o nombre de usuario');
        return false;
      }
      await dbSetKV('explicitLogout', false);

      const spaceId = deriveEmailSpaceId(cleanEmail, rawPin);
      const s = stateRef.current;
      const resolvedServer =
        s.syncConfig.serverUrl.trim() ||
        (typeof window !== 'undefined' &&
        window.location.origin.startsWith('http') &&
        !/:5173$/.test(window.location.origin)
          ? window.location.origin.replace(/\/+$/, '')
          : 'http://localhost:4123');

      const nextCfg: SyncConfig = {
        ...s.syncConfig,
        serverUrl: resolvedServer,
        spaceId,
        accountEmail: cleanEmail,
        autoSync: true,
        liveSync: true,
      };
      stateRef.current.syncConfig = nextCfg;
      updateSyncConfig(nextCfg);

      setSyncStatus('syncing');
      setSyncMessage(`Conectando cuenta ${cleanEmail}...`);

      try {
        const remote = await fetchRemoteSyncState(nextCfg);
        const remoteBooksCount = Object.values(remote.books || {}).filter((b) => b && !b.isDemo).length;
        const remoteHasData =
          remoteBooksCount > 0 ||
          Boolean(remote.bookmarks?.length) ||
          Boolean(remote.annotations?.length) ||
          Boolean(remote.notes?.length) ||
          Boolean(remote.theme) ||
          Boolean(remote.profile);

        const localIsEmpty =
          s.books.filter((b) => !b.isDemo).length === 0 &&
          s.bookmarks.length === 0 &&
          s.annotations.length === 0 &&
          s.notes.length === 0;

        if (remoteHasData && localIsEmpty) {
          // Returning user on a clean / new device: restore 100% of their saved cloud vault!
          const restoredBooks = await applyRemotePayload(remote, true);
          const mergedProfile: UserProfile = {
            ...DEFAULT_PROFILE,
            ...(remote.profile || s.profile),
            email: cleanEmail,
          };
          setProfile(mergedProfile);
          await dbSetKV('profile', mergedProfile);
          const now = Date.now();
          updateSyncConfig({ lastSyncedAt: now });
          setServerOnline(true);
          setSyncStatus('ok');
          setSyncMessage(`Cuenta restaurada (${restoredBooks.length} títulos)`);
          showToast(
            `¡Bienvenido de vuelta! Se restauraron ${restoredBooks.length} libro(s) y tu personalización de ${cleanEmail}`
          );
          return true;
        }

        // First time using this email OR user already added books/customizations locally -> merge & save to email vault!
        const updatedProfile: UserProfile = {
          ...s.profile,
          email: cleanEmail,
          name:
            s.profile.name === DEFAULT_PROFILE.name && remote.profile?.name
              ? remote.profile.name
              : s.profile.name,
        };
        profileUpdatedAtRef.current = Date.now();
        await dbSetKV('profileUpdatedAt', profileUpdatedAtRef.current);
        setProfile(updatedProfile);
        await dbSetKV('profile', updatedProfile);

        const merged = await syncFullState(
          nextCfg,
          {
            deviceId: s.deviceId,
            books: s.books,
            bookmarks: s.bookmarks,
            annotations: s.annotations,
            notes: s.notes,
            customBookmarkDesigns: s.customBookmarkDesigns,
            customStationery: s.customStationery,
            categories: s.categories,
            collections: s.collections,
            readerSettings: s.readerSettings,
            theme: s.theme,
            themeUpdatedAt: themeUpdatedAtRef.current,
            profile: updatedProfile,
            profileUpdatedAt: profileUpdatedAtRef.current,
            lastActiveSession: localActiveSessionRef.current,
            deletedBookIds: deletedIdsRef.current,
            deletedBookmarkIds: deletedBookmarkIdsRef.current,
            deletedAnnotationIds: deletedAnnotationIdsRef.current,
            deletedNoteIds: deletedNoteIdsRef.current,
            deletedBookmarkDesignIds: deletedBookmarkDesignIdsRef.current,
          },
          true
        );

        const finalBooks = await applyRemotePayload(merged, remoteHasData && !themeUpdatedAtRef.current);
        const now = Date.now();
        updateSyncConfig({ lastSyncedAt: now });
        setServerOnline(true);
        setSyncStatus('ok');
        setSyncMessage(`Guardado en ${cleanEmail} (${finalBooks.length} títulos)`);
        showToast(
          remoteHasData
            ? `Cuenta ${cleanEmail} sincronizada (${finalBooks.length} títulos)`
            : `Cuenta ${cleanEmail} vinculada. Todo lo que hagas se guardará automáticamente.`
        );
        return true;
      } catch (err) {
        setSyncStatus('error');
        setSyncMessage(err instanceof Error ? err.message : 'Error al conectar con la nube');
        showToast('Tu correo quedó vinculado localmente; se sincronizará al conectar con el servidor');
        updateProfile({ email: cleanEmail });
        return false;
      }
    },
    [applyRemotePayload, showToast, updateProfile, updateSyncConfig]
  );

  const logoutAccount = useCallback(async () => {
    // Flush any pending changes to the user's cloud vault before clearing local device
    const s = stateRef.current;
    if (s.syncConfig.liveSync && (s.syncConfig.serverUrl.trim() || s.syncConfig.accountEmail)) {
      try {
        await syncFullState(
          s.syncConfig,
          {
            deviceId: s.deviceId,
            books: s.books,
            bookmarks: s.bookmarks,
            annotations: s.annotations,
            notes: s.notes,
            customBookmarkDesigns: s.customBookmarkDesigns,
            customStationery: s.customStationery,
            categories: s.categories,
            collections: s.collections,
            readerSettings: s.readerSettings,
            theme: s.theme,
            themeUpdatedAt: themeUpdatedAtRef.current,
            profile: s.profile,
            profileUpdatedAt: profileUpdatedAtRef.current,
            lastActiveSession: localActiveSessionRef.current,
            deletedBookIds: deletedIdsRef.current,
            deletedBookmarkIds: deletedBookmarkIdsRef.current,
            deletedAnnotationIds: deletedAnnotationIdsRef.current,
            deletedNoteIds: deletedNoteIdsRef.current,
            deletedBookmarkDesignIds: deletedBookmarkDesignIdsRef.current,
          },
          true
        );
      } catch {
        // ignore offline logout
      }
    }

    await dbClearAllUserData();

    const newDeviceId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const freshSpaceId = `vault_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const freshSync: SyncConfig = {
      ...DEFAULT_SYNC_CONFIG,
      spaceId: freshSpaceId,
      autoSync: false,
      liveSync: false,
    };

    deletedIdsRef.current = [];
    deletedBookmarkIdsRef.current = [];
    deletedAnnotationIdsRef.current = [];
    deletedNoteIdsRef.current = [];
    deletedBookmarkDesignIdsRef.current = [];
    joinedRoomCodesRef.current = [];
    joinedShelfCodesRef.current = [];
    themeUpdatedAtRef.current = 0;
    profileUpdatedAtRef.current = 0;
    localActiveSessionRef.current = null;

    await Promise.all([
      dbSetKV('deviceId', newDeviceId),
      dbSetKV('seeded', true),
      dbSetKV('syncConfig', freshSync),
      dbSetKV('explicitLogout', true),
    ]);

    setActiveBook(null);
    setEditingBook(null);
    setBooks([]);
    setBookmarks([]);
    setAnnotations([]);
    setNotes([]);
    setCustomBookmarkDesigns([]);
    setCustomStationery({ swatches: [], stickers: [], emojis: [] });
    setCategories(DEFAULT_CATEGORIES);
    setCollections(DEFAULT_COLLECTIONS);
    setReaderSettings(DEFAULT_READER_SETTINGS);
    setTheme(DEFAULT_THEME);
    applyThemeCssVars(DEFAULT_THEME);
    setProfile(DEFAULT_PROFILE);
    setChatMessages(INITIAL_CHAT_MESSAGES);
    setSharedRooms([]);
    setSharedShelves([]);
    setDeviceId(newDeviceId);
    setSyncConfig(freshSync);
    setSyncStatus('idle');
    setSyncMessage('');
    showToast('Sesión cerrada en este dispositivo. Tu copia sigue guardada en tu correo.');
  }, [showToast]);

  const exportBackupJson = useCallback(() => {
    const s = stateRef.current;
    const payload = {
      komolibBackupVersion: 2,
      exportedAt: Date.now(),
      email: s.profile.email || s.syncConfig.accountEmail || '',
      profile: s.profile,
      theme: s.theme,
      readerSettings: s.readerSettings,
      categories: s.categories,
      collections: s.collections,
      customStationery: s.customStationery,
      customBookmarkDesigns: s.customBookmarkDesigns,
      books: s.books.filter((b) => !b.isDemo),
      bookmarks: s.bookmarks,
      annotations: s.annotations,
      notes: s.notes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `komolib-backup-${s.profile.email || dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada (.json)');
  }, [showToast]);

  const importBackupJson = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') {
          throw new Error('Formato de copia no válido');
        }
        const booksRecord: Record<string, BookItem> = {};
        if (Array.isArray(data.books)) {
          for (const b of data.books) {
            if (b?.id && !b.isDemo) booksRecord[b.id] = b;
          }
        } else if (data.books && typeof data.books === 'object') {
          for (const [k, b] of Object.entries(data.books)) {
            if (b && typeof b === 'object' && !(b as BookItem).isDemo) {
              booksRecord[k] = b as BookItem;
            }
          }
        }
        await applyRemotePayload(
          {
            updatedAt: Date.now(),
            books: booksRecord,
            bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [],
            annotations: Array.isArray(data.annotations) ? data.annotations : [],
            notes: Array.isArray(data.notes) ? data.notes : [],
            customBookmarkDesigns: Array.isArray(data.customBookmarkDesigns)
              ? data.customBookmarkDesigns
              : [],
            customStationery: data.customStationery || null,
            categories: Array.isArray(data.categories) ? data.categories : null,
            collections: Array.isArray(data.collections) ? data.collections : null,
            readerSettings: data.readerSettings || null,
            theme: data.theme || null,
            themeUpdatedAt: Date.now(),
            profile: data.profile || null,
            profileUpdatedAt: Date.now(),
          },
          true
        );
        scheduleAutoSync(true);
        showToast('Copia de seguridad restaurada correctamente');
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo importar la copia de seguridad');
        return false;
      }
    },
    [applyRemotePayload, scheduleAutoSync, showToast]
  );

  // Shared Reading Rooms management
  const persistJoinedRoomCodes = useCallback((codes: string[]) => {
    const clean = Array.from(new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))).slice(0, 40);
    joinedRoomCodesRef.current = clean;
    dbSetKV('joinedRoomCodes', clean).catch(console.error);
  }, []);

  const refreshSharedRooms = useCallback(async () => {
    const cfg = stateRef.current.syncConfig;
    const myId = stateRef.current.deviceId;
    if (!cfg.serverUrl.trim()) return;

    const byCode = new Map<string, SharedRoom>();
    try {
      // Only fetch rooms this user participates in (per-user privacy!)
      const list = await listSharedRooms(cfg, myId || undefined);
      for (const r of list) byCode.set(r.code, r);
      setServerOnline(true);
    } catch {
      // May fail with 401 when KOMOLIB_TOKEN is enabled and client is a Buddy Read guest;
      // fall through to fetch individually joined room codes!
    }

    const joinedCodes = joinedRoomCodesRef.current;
    if (joinedCodes.length > 0) {
      await Promise.all(
        joinedCodes.map(async (code) => {
          if (byCode.has(code)) return;
          try {
            const room = await getSharedRoom(cfg, code);
            byCode.set(room.code, room);
            setServerOnline(true);
          } catch {
            // room may have been deleted or server offline
          }
        })
      );
    }

    const combined = Array.from(byCode.values()).sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
    setSharedRooms(combined);
  }, []);

  const applyPairingLink = useCallback(
    async (raw: string): Promise<boolean> => {
      const parsed = parsePairingInput(raw);
      if (!parsed || (!parsed.serverUrl && !parsed.joinCode && !parsed.shelfCode)) {
        showToast('Enlace o URL de servidor no válido');
        return false;
      }

      if ((parsed.joinCode || parsed.shelfCode) && !parsed.serverUrl) {
        if (parsed.joinCode) setPendingJoinCode(parsed.joinCode);
        if (parsed.shelfCode) setPendingShelfCode(parsed.shelfCode);
        setNavSection('shared');
        return true;
      }

      const patch: Partial<SyncConfig> = {};
      if (parsed.serverUrl) patch.serverUrl = parsed.serverUrl;
      if (parsed.spaceId) patch.spaceId = parsed.spaceId;
      if (parsed.token !== undefined) patch.token = parsed.token;
      if (parsed.publicUrl !== undefined) patch.publicUrl = parsed.publicUrl;

      if (parsed.joinCode || parsed.shelfCode) {
        updateSyncConfig(patch);
        if (parsed.joinCode) setPendingJoinCode(parsed.joinCode);
        if (parsed.shelfCode) setPendingShelfCode(parsed.shelfCode);
        setNavSection('shared');
        showToast(
          parsed.shelfCode
            ? `Servidor configurado para estantería ${parsed.shelfCode}`
            : `Servidor configurado para sala ${parsed.joinCode}`
        );
        return true;
      }

      // Pairing link for personal Web <-> APK live sync (uses owner's private spaceId!)
      const nextCfg: SyncConfig = {
        ...stateRef.current.syncConfig,
        ...patch,
        autoSync: true,
        liveSync: true,
      };
      stateRef.current.syncConfig = nextCfg;
      updateSyncConfig({ ...patch, autoSync: true, liveSync: true });
      await refreshServerHealth();
      await triggerSync(false);
      await refreshSharedRooms();
      return true;
    },
    [refreshServerHealth, refreshSharedRooms, showToast, triggerSync, updateSyncConfig]
  );

  // Live SSE Sync Web <-> APK + Foreground/Online Recovery + Initial silent sync on startup
  useEffect(() => {
    if (!ready || !deviceId || syncConfig.liveSync === false || !syncConfig.serverUrl.trim()) {
      setLiveConnected(false);
      return;
    }
    let active = true;
    let sseIsUp = false;

    // Initial silent pull + push merge on startup
    triggerSync(true).catch(() => undefined);

    const pullRemoteNow = async () => {
      if (!active) return;
      try {
        const remote = await fetchRemoteSyncState(stateRef.current.syncConfig);
        if (!active) return;
        await applyRemotePayload(remote);
        setServerOnline(true);
        setSyncStatus('ok');
        setSyncMessage('Sincronizado en vivo');
      } catch {
        // ignore transient network glitches
      }
    };

    // Subscribe to real-time SSE updates from other devices (e.g. Android APK <-> Web)
    const unsubscribe = subscribeToSyncStream(
      syncConfig,
      async (ev) => {
        if (!active) return;
        if (ev.sourceDeviceId && ev.sourceDeviceId === stateRef.current.deviceId) return;
        await pullRemoteNow();
        setSyncMessage('Actualizado desde otro dispositivo');
      },
      (connected) => {
        sseIsUp = connected;
        if (active) {
          setLiveConnected(connected);
          if (connected) setServerOnline(true);
        }
      }
    );

    // Mobile APK / Tab resume & network reconnect recovery
    const handleResume = () => {
      if (document.visibilityState === 'hidden') return;
      refreshServerHealth();
      triggerSync(true).catch(() => undefined);
      refreshSharedRooms();
    };

    window.addEventListener('online', handleResume);
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);

    // Fallback polling when SSE is temporarily dropped (e.g. mobile sleep / strict proxy)
    const fallbackTimer = window.setInterval(() => {
      if (!active || sseIsUp || document.visibilityState === 'hidden') return;
      pullRemoteNow();
    }, 30000);

    return () => {
      active = false;
      setLiveConnected(false);
      unsubscribe();
      window.removeEventListener('online', handleResume);
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
      window.clearInterval(fallbackTimer);
    };
  }, [
    ready,
    deviceId,
    syncConfig.serverUrl,
    syncConfig.token,
    syncConfig.liveSync,
    applyRemotePayload,
    refreshServerHealth,
    refreshSharedRooms,
    triggerSync,
  ]);

  useEffect(() => {
    if (!ready || !syncConfig.serverUrl.trim()) return;
    refreshSharedRooms();
  }, [ready, syncConfig.serverUrl, syncConfig.token, refreshSharedRooms]);

  const updateLocalRoom = useCallback((room: SharedRoom) => {
    setSharedRooms((prev) => {
      const exists = prev.some((r) => r.code === room.code);
      if (!exists) return [room, ...prev];
      return prev.map((r) => (r.code === room.code ? room : r));
    });
  }, []);

  const removeLocalRoom = useCallback(
    (code: string) => {
      const normalized = code.trim().toUpperCase();
      setSharedRooms((prev) => prev.filter((r) => r.code !== normalized));
      persistJoinedRoomCodes(joinedRoomCodesRef.current.filter((c) => c !== normalized));
      setSelectedRoomCode((curr) => (curr === normalized ? '' : curr));
    },
    [persistJoinedRoomCodes]
  );

  const collectSharedMarksForBook = useCallback(
    (bookId: string, selection?: ShareMarksSelection) => {
      if (!selection?.enabled) return undefined;
      const s = stateRef.current;
      const toolSet = new Set(selection.tools || []);
      const sharedAnnotations = s.annotations.filter(
        (a) => a.bookId === bookId && toolSet.has(a.tool)
      );
      const sharedBookmarks = selection.includeBookmarks
        ? s.bookmarks.filter((b) => b.bookId === bookId)
        : [];
      return { annotations: sharedAnnotations, bookmarks: sharedBookmarks };
    },
    []
  );

  const importSharedMarksIntoLocalBook = useCallback(
    async (
      targetBookId: string,
      sharedAnnotations?: BookAnnotation[],
      sharedBookmarks?: BookmarkItem[]
    ) => {
      const addedAnns: BookAnnotation[] = [];
      const addedBms: BookmarkItem[] = [];
      const now = Date.now();
      if (sharedAnnotations?.length) {
        for (const a of sharedAnnotations) {
          const cloned: BookAnnotation = {
            ...a,
            id: `ann_sh_${targetBookId}_${a.id}`.slice(0, 80),
            bookId: targetBookId,
            updatedAt: now,
          };
          await dbPutAnnotation(cloned);
          addedAnns.push(cloned);
        }
        setAnnotations((prev) => {
          const map = new Map(prev.map((x) => [x.id, x]));
          for (const item of addedAnns) map.set(item.id, item);
          return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
        });
      }
      if (sharedBookmarks?.length) {
        for (const bm of sharedBookmarks) {
          const cloned: BookmarkItem = {
            ...bm,
            id: `bm_sh_${targetBookId}_${bm.id}`.slice(0, 80),
            bookId: targetBookId,
          };
          await dbPutBookmark(cloned);
          addedBms.push(cloned);
        }
        setBookmarks((prev) => {
          const map = new Map(prev.map((x) => [x.id, x]));
          for (const item of addedBms) map.set(item.id, item);
          return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
        });
      }
      return addedAnns.length + addedBms.length;
    },
    []
  );

  const createRoomForBook = useCallback(
    async (book: BookItem, marksSelection?: ShareMarksSelection): Promise<SharedRoom | null> => {
      try {
        const s = stateRef.current;
        let readyBook = book;
        if (book.hasLocalFile && !book.hasRemoteFile) {
          const up: { ok: boolean; remoteFileName?: string; format?: BookItem['format'] } =
            await uploadBookToServer(s.syncConfig, book, s.deviceId).catch(() => ({
              ok: false,
            }));
          if (up.ok) {
            readyBook = {
              ...book,
              hasRemoteFile: true,
              remoteFileName: up.remoteFileName || book.remoteFileName,
              format: up.format || book.format,
            };
            await dbPutBook(readyBook);
            setBooks((prev) => prev.map((x) => (x.id === readyBook.id ? readyBook : x)));
          }
        }
        const marks = collectSharedMarksForBook(readyBook.id, marksSelection);
        const room = await createSharedRoom(
          s.syncConfig,
          readyBook,
          {
            id: s.deviceId,
            name: s.profile.name,
            avatarEmoji: s.profile.avatarEmoji,
            avatarBg: s.profile.avatarBg,
            progress: readyBook.progress || 0,
            currentPage: readyBook.currentPage || 1,
            readingStatus: readyBook.readingStatus || 'reading',
          },
          marks
        );
        updateLocalRoom(room);
        setSelectedRoomCode(room.code);
        persistJoinedRoomCodes([room.code, ...joinedRoomCodesRef.current]);
        showToast(`Sala ${room.code} creada para "${book.title}"`);
        return room;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo crear la sala compartida');
        return null;
      }
    },
    [collectSharedMarksForBook, persistJoinedRoomCodes, showToast, updateLocalRoom]
  );

  const joinRoomByCode = useCallback(
    async (
      rawCode: string,
      includeSharedMarks = true
    ): Promise<{ room: SharedRoom; book?: BookItem } | null> => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return null;
      try {
        const s = stateRef.current;
        const existingBook = s.books.find((b) => b.id === s.sharedRooms.find((r) => r.code === code)?.bookId);
        const room = await joinSharedRoom(s.syncConfig, code, {
          id: s.deviceId,
          name: s.profile.name,
          avatarEmoji: s.profile.avatarEmoji,
          avatarBg: s.profile.avatarBg,
          progress: existingBook?.progress || 0,
          currentPage: existingBook?.currentPage || 1,
          readingStatus: existingBook?.readingStatus || 'reading',
        });
        updateLocalRoom(room);
        setSelectedRoomCode(room.code);
        persistJoinedRoomCodes([room.code, ...joinedRoomCodesRef.current]);

        // Ensure the shared book exists in local IndexedDB (download file if not present)
        const alreadyHasBook = s.books.find((b) => b.id === room.bookId);
        const localFile = await dbGetBookFile(room.bookId);
        let resolvedBook: BookItem | undefined = alreadyHasBook;

        if (!alreadyHasBook || !localFile) {
          try {
            showToast(`Descargando "${room.bookMeta.title}" de la sala ${room.code}...`);
            const blob = await downloadSharedRoomFile(s.syncConfig, room.code);
            await dbPutBookFile(room.bookId, blob);
            const newItem: BookItem = {
              ...(alreadyHasBook || {}),
              id: room.bookId,
              title: room.bookMeta.title,
              author: room.bookMeta.author,
              description: room.bookMeta.description || '',
              format: room.bookMeta.format,
              kind: room.bookMeta.kind,
              categories: room.bookMeta.categories?.length ? room.bookMeta.categories : ['new'],
              tags: room.bookMeta.tags?.length ? room.bookMeta.tags : [room.bookMeta.format.toUpperCase()],
              coverDataUrl: room.bookMeta.coverDataUrl,
              hasOriginalCover: room.bookMeta.hasOriginalCover,
              coverCheckedV2: true,
              spineColor: room.bookMeta.spineColor || '#4c6c8a',
              ribbonColor: room.bookMeta.ribbonColor || '#f2ba59',
              fileName: room.bookMeta.fileName,
              fileSize: room.bookMeta.fileSize || blob.size,
              mimeType: room.bookMeta.mimeType || blob.type || 'application/octet-stream',
              pageCount: room.bookMeta.pageCount,
              progress: alreadyHasBook?.progress || 0,
              currentPage: alreadyHasBook?.currentPage,
              favorite: alreadyHasBook?.favorite || false,
              wishlist: false,
              readingStatus: alreadyHasBook?.readingStatus || 'reading',
              hasLocalFile: true,
              hasRemoteFile: true,
              remoteFileName: room.bookMeta.remoteFileName,
              addedAt: alreadyHasBook?.addedAt || Date.now(),
              updatedAt: Date.now(),
            };
            await dbPutBook(newItem);
            resolvedBook = newItem;
            setBooks((prev) => {
              const filtered = prev.filter((x) => x.id !== newItem.id);
              return [newItem, ...filtered];
            });
          } catch {
            // Even if file download fails (e.g. demo book), keep joined in room
          }
        }

        if (
          includeSharedMarks &&
          (room.bookMeta.sharedAnnotations?.length || room.bookMeta.sharedBookmarks?.length)
        ) {
          await importSharedMarksIntoLocalBook(
            room.bookId,
            room.bookMeta.sharedAnnotations,
            room.bookMeta.sharedBookmarks
          );
        }

        setPendingJoinCode('');
        showToast(`Te uniste a la sala ${room.code} ("${room.bookMeta.title}")`);
        return { room, book: resolvedBook };
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo unir a la sala');
        return null;
      }
    },
    [importSharedMarksIntoLocalBook, persistJoinedRoomCodes, showToast, updateLocalRoom]
  );

  const sendRoomComment = useCallback(
    async (code: string, text: string, progressAt: number, pageAt?: number) => {
      const s = stateRef.current;
      const room = await postSharedRoomComment(s.syncConfig, code, {
        participantId: s.deviceId,
        authorName: s.profile.name,
        avatarEmoji: s.profile.avatarEmoji,
        text,
        progressAt,
        pageAt,
      });
      updateLocalRoom(room);
    },
    [updateLocalRoom]
  );

  const leaveOrDeleteRoom = useCallback(
    async (code: string, isHost: boolean) => {
      const s = stateRef.current;
      if (isHost) {
        await deleteSharedRoom(s.syncConfig, code);
      } else {
        await leaveSharedRoom(s.syncConfig, code, s.deviceId);
      }
      removeLocalRoom(code);
      showToast(isHost ? `Sala ${code} cerrada` : `Saliste de la sala ${code}`);
    },
    [removeLocalRoom, showToast]
  );

  /* -------- Mutual Book Exchange Shelves (Independent Progress per User!) -------- */
  const persistJoinedShelfCodes = useCallback((codes: string[]) => {
    const clean = Array.from(
      new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))
    ).slice(0, 40);
    joinedShelfCodesRef.current = clean;
    dbSetKV('joinedShelfCodes', clean).catch(console.error);
  }, []);

  const updateLocalShelf = useCallback((shelf: SharedShelf) => {
    setSharedShelves((prev) => {
      const exists = prev.some((s) => s.code === shelf.code);
      if (!exists) return [shelf, ...prev];
      return prev.map((s) => (s.code === shelf.code ? shelf : s));
    });
  }, []);

  const removeLocalShelf = useCallback(
    (code: string) => {
      const normalized = code.trim().toUpperCase();
      setSharedShelves((prev) => prev.filter((s) => s.code !== normalized));
      persistJoinedShelfCodes(joinedShelfCodesRef.current.filter((c) => c !== normalized));
      setSelectedShelfCode((curr) => (curr === normalized ? '' : curr));
    },
    [persistJoinedShelfCodes]
  );

  const refreshSharedShelves = useCallback(async () => {
    const cfg = stateRef.current.syncConfig;
    const codes = joinedShelfCodesRef.current;
    if (!cfg.serverUrl.trim() || !codes.length) return;
    const fetched: SharedShelf[] = [];
    await Promise.all(
      codes.map(async (code) => {
        try {
          const shelf = await getSharedShelf(cfg, code);
          fetched.push(shelf);
          setServerOnline(true);
        } catch {
          // shelf removed or server offline
        }
      })
    );
    fetched.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    setSharedShelves(fetched);
  }, []);

  useEffect(() => {
    if (!ready || !syncConfig.serverUrl.trim()) return;
    refreshSharedShelves();
  }, [ready, syncConfig.serverUrl, syncConfig.token, refreshSharedShelves]);

  const createMutualShelf = useCallback(
    async (
      title: string,
      bookIds: string[],
      marksSelection?: ShareMarksSelection
    ): Promise<SharedShelf | null> => {
      try {
        const s = stateRef.current;
        let shelf = await createSharedShelf(s.syncConfig, title, {
          id: s.deviceId,
          name: s.profile.name,
          avatarEmoji: s.profile.avatarEmoji,
          avatarBg: s.profile.avatarBg,
        });
        for (const bid of bookIds) {
          const target = s.books.find((b) => b.id === bid);
          if (target) {
            const marks = collectSharedMarksForBook(target.id, marksSelection);
            shelf = await shareBookToShelf(
              s.syncConfig,
              shelf.code,
              target,
              {
                id: s.deviceId,
                name: s.profile.name,
              },
              marks
            );
          }
        }
        updateLocalShelf(shelf);
        setSelectedShelfCode(shelf.code);
        persistJoinedShelfCodes([shelf.code, ...joinedShelfCodesRef.current]);
        showToast(`Estantería mutua ${shelf.code} creada (${Object.keys(shelf.books).length} libros)`);
        return shelf;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo crear la estantería compartida');
        return null;
      }
    },
    [collectSharedMarksForBook, persistJoinedShelfCodes, showToast, updateLocalShelf]
  );

  const joinShelfByCode = useCallback(
    async (rawCode: string): Promise<SharedShelf | null> => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return null;
      try {
        const s = stateRef.current;
        const shelf = await joinSharedShelf(s.syncConfig, code, {
          id: s.deviceId,
          name: s.profile.name,
          avatarEmoji: s.profile.avatarEmoji,
          avatarBg: s.profile.avatarBg,
        });
        updateLocalShelf(shelf);
        setSelectedShelfCode(shelf.code);
        persistJoinedShelfCodes([shelf.code, ...joinedShelfCodesRef.current]);
        setPendingShelfCode('');
        showToast(`Te uniste a la estantería ${shelf.code} ("${shelf.title}")`);
        return shelf;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo unir a la estantería');
        return null;
      }
    },
    [persistJoinedShelfCodes, showToast, updateLocalShelf]
  );

  const shareBooksToShelf = useCallback(
    async (code: string, bookIds: string[], marksSelection?: ShareMarksSelection) => {
      const s = stateRef.current;
      let latest: SharedShelf | null = null;
      for (const bid of bookIds) {
        const target = s.books.find((b) => b.id === bid);
        if (!target) continue;
        try {
          const marks = collectSharedMarksForBook(target.id, marksSelection);
          latest = await shareBookToShelf(
            s.syncConfig,
            code,
            target,
            {
              id: s.deviceId,
              name: s.profile.name,
            },
            marks
          );
        } catch (err) {
          showToast(err instanceof Error ? err.message : `Error al compartir "${target.title}"`);
        }
      }
      if (latest) {
        updateLocalShelf(latest);
        showToast('Libros compartidos en la estantería mutua');
      }
    },
    [collectSharedMarksForBook, showToast, updateLocalShelf]
  );

  const removeBookFromSharedShelf = useCallback(
    async (code: string, shelfBookKey: string) => {
      try {
        const updated = await removeBookFromShelf(stateRef.current.syncConfig, code, shelfBookKey);
        updateLocalShelf(updated);
        showToast('Libro retirado de la estantería compartida');
      } catch {
        showToast('No se pudo retirar el libro');
      }
    },
    [showToast, updateLocalShelf]
  );

  const importBookFromShelf = useCallback(
    async (
      code: string,
      entry: SharedShelfBook,
      includeSharedMarks = true
    ): Promise<BookItem | null> => {
      const s = stateRef.current;
      // Independent local copy ID so reading it NEVER affects the other user's progress!
      const localId = `shared_${entry.bookId}`;
      const existing = s.books.find((b) => b.id === localId);
      const localFile = await dbGetBookFile(localId);
      if (existing && localFile) {
        if (
          includeSharedMarks &&
          (entry.sharedAnnotations?.length || entry.sharedBookmarks?.length)
        ) {
          await importSharedMarksIntoLocalBook(
            localId,
            entry.sharedAnnotations,
            entry.sharedBookmarks
          );
        }
        showToast(`"${existing.title}" ya está en tu biblioteca local`);
        return existing;
      }
      try {
        showToast(`Descargando "${entry.title}" a tu librería local...`);
        const blob = await downloadShelfBookFile(s.syncConfig, code, entry.bookId);
        await dbPutBookFile(localId, blob);
        const now = Date.now();
        const newBook: BookItem = {
          id: localId,
          title: entry.title,
          author: entry.author,
          description: entry.description || `Compartido por ${entry.ownerName}`,
          format: entry.format,
          kind: entry.kind,
          categories: entry.categories?.length ? entry.categories : ['new'],
          tags: Array.from(new Set([...(entry.tags || []), `De ${entry.ownerName}`])),
          coverDataUrl: entry.coverDataUrl,
          hasOriginalCover: entry.hasOriginalCover,
          coverCheckedV2: true,
          spineColor: entry.spineColor || '#4c6c8a',
          ribbonColor: entry.ribbonColor || '#f2ba59',
          fileName: entry.fileName,
          fileSize: entry.fileSize || blob.size,
          mimeType: entry.mimeType || blob.type || 'application/octet-stream',
          pageCount: entry.pageCount,
          progress: 0,
          favorite: false,
          wishlist: false,
          readingStatus: 'want_to_read',
          hasLocalFile: true,
          hasRemoteFile: false,
          addedAt: now,
          updatedAt: now,
        };
        await dbPutBook(newBook);
        setBooks((prev) => [newBook, ...prev.filter((x) => x.id !== newBook.id)]);
        let importedCount = 0;
        if (
          includeSharedMarks &&
          (entry.sharedAnnotations?.length || entry.sharedBookmarks?.length)
        ) {
          importedCount = await importSharedMarksIntoLocalBook(
            localId,
            entry.sharedAnnotations,
            entry.sharedBookmarks
          );
        }
        showToast(
          importedCount > 0
            ? `"${newBook.title}" guardado (+${importedCount} marcas compartidas, progreso independiente)`
            : `"${newBook.title}" guardado en tu biblioteca con progreso independiente`
        );
        scheduleAutoSync();
        return newBook;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo descargar el libro');
        return null;
      }
    },
    [importSharedMarksIntoLocalBook, scheduleAutoSync, showToast]
  );

  const leaveOrDeleteShelf = useCallback(
    async (code: string, isHost: boolean) => {
      const s = stateRef.current;
      if (isHost) {
        await deleteSharedShelf(s.syncConfig, code);
      } else {
        await leaveSharedShelf(s.syncConfig, code, s.deviceId);
      }
      removeLocalShelf(code);
      showToast(isHost ? `Estantería ${code} cerrada` : `Saliste de la estantería ${code}`);
    },
    [removeLocalShelf, showToast]
  );

  const dismissRemoteSession = useCallback(() => setRemoteActiveSession(null), []);

  return (
    <LibraryContext.Provider
      value={{
        ready,
        books,
        bookmarks,
        annotations,
        customBookmarkDesigns,
        allBookmarkDesigns,
        customStationery,
        addCustomSwatch,
        deleteCustomSwatch,
        addCustomSticker,
        deleteCustomSticker,
        addCustomEmoji,
        deleteCustomEmoji,
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
        readerJumpTarget,
        clearReaderJumpTarget,
        openBook,
        openBookAt,
        closeReader,
        audioBook,
        audioUrl,
        closeAudioPlayer,
        editingBook,
        setEditingBook,
        importModalOpen,
        setImportModalOpen,
        studioModalOpen,
        setStudioModalOpen,
        profileModalOpen,
        setProfileModalOpen,
        importFiles,
        updateBook,
        reExtractBookCover,
        deleteBook,
        addBookmark,
        deleteBookmark,
        addAnnotation,
        updateAnnotation,
        deleteAnnotation,
        addCustomBookmarkDesign,
        deleteCustomBookmarkDesign,
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
        aiOnline,
        aiModelName,
        deviceId,
        serverOnline,
        liveConnected,
        serverAuthRequired,
        serverLanUrl,
        refreshServerHealth,
        applyPairingLink,
        remoteActiveSession,
        dismissRemoteSession,
        syncStatus,
        syncMessage,
        triggerSync,
        loginWithEmail,
        logoutAccount,
        exportBackupJson,
        importBackupJson,
        sharedRooms,
        selectedRoomCode,
        setSelectedRoomCode,
        pendingJoinCode,
        setPendingJoinCode,
        refreshSharedRooms,
        createRoomForBook,
        joinRoomByCode,
        sendRoomComment,
        leaveOrDeleteRoom,
        updateLocalRoom,
        removeLocalRoom,
        sharedShelves,
        selectedShelfCode,
        setSelectedShelfCode,
        pendingShelfCode,
        setPendingShelfCode,
        refreshSharedShelves,
        createMutualShelf,
        joinShelfByCode,
        shareBooksToShelf,
        removeBookFromSharedShelf,
        importBookFromShelf,
        leaveOrDeleteShelf,
        updateLocalShelf,
        removeLocalShelf,
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
