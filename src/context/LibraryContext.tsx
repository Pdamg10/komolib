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
import { normalizeServerUrl, SYNC_SERVER_URL } from '../config';
import {
  extractOriginalCoverFromBlob,
  importImageBundle,
  importSingleFile,
} from '../parsers';
import { extractCoverPaletteFromDataUrl, generateCozyCover } from '../parsers/coverGenerator';
import {
  parseExternalBackupFile,
  type ParsedExternalBackup,
} from '../parsers/externalBackupParser';
import {
  filterSupportedFiles,
  getFolderPath,
  groupImagesByFolder,
  isImageFile,
} from '../utils/fileFolderImport';
import {
  consumePendingNativeGoogleAuth,
  isKomoAndroidNative,
  isKomoDesktopNative,
  openExternalUrlNatively,
  readNativeUriAsBlob,
  saveTextFileLocally,
  shareTextFileNatively,
  type NativeScannedFolderBook,
} from '../utils/nativeBridge';
import {
  buildGoogleOAuthStartUrl,
  clearGoogleDriveMemoryCache,
  deleteBookFileFromGoogleDrive,
  downloadBookFileFromGoogleDrive,
  ensureKomolibDriveFolders,
  getGoogleDriveStateVersion,
  parseGoogleAuthPayloadString,
  pullStateFromGoogleDrive,
  syncStateWithGoogleDrive,
  uploadBookFileToGoogleDrive,
} from '../services/googleDriveService';
import {
  getCoverSignature,
  hasDisplayableOriginalCover,
  isRasterCoverDataUrl,
} from '../utils/coverHelpers';
import {
  cleanAuthorName,
  cleanSynopsisText,
  cleanTitleText,
  isGenericAuthor,
  isGenericTitle,
  resolveBookTitleAndAuthor,
} from '../utils/bookMetadata';
import { extractBookOpeningExcerpt } from '../utils/bookExcerpt';
import {
  checkServerHealth,
  deleteBookFromServer,
  deriveEmailSpaceId,
  downloadBookFromServer,
  isTransientNetworkError,
  fetchRemoteSyncState,
  identifyBookWithAiApi,
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
  kickRoomParticipant,
  kickShelfMember,
  leaveSharedRoom,
  leaveSharedShelf,
  listSharedRooms,
  postSharedRoomComment,
  removeBookFromShelf,
  restoreSharedRoom,
  restoreSharedShelf,
  shareBookToShelf,
  SharedSpaceHttpError,
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
  ChatSession,
  CollectionCard,
  ContentKind,
  CustomStationeryKit,
  CustomStickerItem,
  CustomSwatchItem,
  GoogleDriveAuth,
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

export interface SyncPopupState {
  visible: boolean;
  phase: 'syncing' | 'done' | 'error';
  progress: number;
  title: string;
  detail: string;
  summary?: string;
}

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
  chatSessions: ChatSession[];
  activeChatSessionId: string;
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
  missingFileBook: BookItem | null;
  setMissingFileBook: (book: BookItem | null) => void;
  importModalOpen: boolean;
  setImportModalOpen: (open: boolean) => void;
  studioModalOpen: boolean;
  setStudioModalOpen: (open: boolean) => void;
  profileModalOpen: boolean;
  setProfileModalOpen: (open: boolean) => void;
  // Mutations
  importFiles: (
    files: File[],
    opts?: {
      bundleImages?: boolean;
      title?: string;
      author?: string;
      kind?: ContentKind;
      categories?: string[];
      skipDuplicates?: boolean;
      onProgress?: (done: number, total: number, currentName?: string) => void;
    }
  ) => Promise<BookItem[]>;
  importNativeFolderBooks: (
    items: NativeScannedFolderBook[],
    opts?: { author?: string; kind?: ContentKind; categories?: string[]; finalizeSync?: boolean }
  ) => Promise<{ added: number; linked: number; duplicatesSkipped: number; duplicateSamples: string[] }>;
  duplicateBooksCount: number;
  removeDuplicateBooks: () => Promise<number>;
  attachLocalFileToBook: (bookId: string, file: File) => Promise<BookItem | null>;
  updateBook: (id: string, patch: Partial<BookItem>) => Promise<void>;
  reExtractBookCover: (id: string) => Promise<boolean>;
  identifyBookWithAI: (
    id: string,
    opts?: { silent?: boolean }
  ) => Promise<{ title?: string; author?: string; description?: string } | null>;
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
  startNewChatSession: () => void;
  selectChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;
  aiOnline: boolean;
  aiModelName: string;
  // Sync & Live Continuity (Web <-> APK)
  deviceId: string;
  sharedUserId: string;
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
  syncPopup: SyncPopupState;
  dismissSyncPopup: () => void;
  offlineSyncProgress: string;
  triggerSync: (silent?: boolean) => Promise<void>;
  syncAllBookFilesForOffline: () => Promise<{ uploaded: number; downloaded: number; failed: number }>;
  // Cloud Account by Email & Google Drive Personal Cloud + Backup/Restore
  googleDriveAuth: GoogleDriveAuth | null;
  connectGoogleDrive: (opts?: { switchAccount?: boolean; forceConsent?: boolean }) => void;
  disconnectGoogleDrive: () => Promise<void>;
  loginWithEmail: (email: string) => Promise<boolean>;
  logoutAccount: () => Promise<void>;
  exportBackupJson: () => void;
  shareBackupJson: () => Promise<void>;
  importBackupJson: (file: File) => Promise<boolean>;
  importExternalBackup: (
    parsed: ParsedExternalBackup,
    opts?: {
      importBooks?: boolean;
      importProgress?: boolean;
      importBookmarks?: boolean;
      importAnnotations?: boolean;
      importNotes?: boolean;
    }
  ) => Promise<{
    booksAdded: number;
    booksUpdated: number;
    bookmarksAdded: number;
    annotationsAdded: number;
    notesAdded: number;
  }>;
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
  leaveOrDeleteRoom: (
    code: string,
    deleteEntireRoom: boolean,
    liveSnapshot?: {
      progress?: number;
      currentPage?: number;
      currentCfi?: string;
      scrollRatio?: number;
      currentChapter?: string;
    }
  ) => Promise<void>;
  kickUserFromRoom: (code: string, targetParticipantId: string, targetName?: string) => Promise<void>;
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
  leaveOrDeleteShelf: (code: string, deleteEntireShelf: boolean) => Promise<void>;
  kickUserFromShelf: (code: string, targetMemberId: string, targetName?: string) => Promise<void>;
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

const SHELF_PREFS_STORAGE_KEY = 'komolib_shelf_prefs_v1';
const THEME_CACHE_STORAGE_KEY = 'komolib_theme_cache_v1';
const READER_SETTINGS_STORAGE_KEY = 'komolib_reader_settings_v1';
const GDRIVE_AUTH_STORAGE_KEY = 'komolib_gdrive_auth_v1';

function readCachedThemeForStartup(): ThemeConfig {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_THEME;
    const raw = window.localStorage.getItem(THEME_CACHE_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ThemeConfig>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_THEME;
    return { ...DEFAULT_THEME, ...parsed };
  } catch {
    return DEFAULT_THEME;
  }
}

function writeCachedTheme(t: ThemeConfig): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    // Omit huge base64 wallpapers from localStorage so quota is never exceeded;
    // colors, fonts, mode, radius & layout paint synchronously on Frame 0!
    const compact: ThemeConfig = {
      ...t,
      customWallpaperUrl:
        t.customWallpaperUrl && t.customWallpaperUrl.length <= 140_000 ? t.customWallpaperUrl : '',
    };
    window.localStorage.setItem(THEME_CACHE_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // ignore storage quota errors
  }
}

function clearCachedTheme(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(THEME_CACHE_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function readCachedReaderSettings(): { settings: ReaderSettings; updatedAt: number } | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { settings?: Partial<ReaderSettings>; updatedAt?: number };
    if (!parsed || typeof parsed !== 'object' || !parsed.settings) return null;
    return {
      settings: { ...DEFAULT_READER_SETTINGS, ...parsed.settings },
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeCachedReaderSettings(settings: ReaderSettings, updatedAt: number): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      READER_SETTINGS_STORAGE_KEY,
      JSON.stringify({ settings, updatedAt })
    );
  } catch {
    // ignore storage quota errors
  }
}

function clearCachedReaderSettings(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(READER_SETTINGS_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function readCachedGoogleDriveAuth(): GoogleDriveAuth | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(GDRIVE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleDriveAuth | null;
    if (!parsed || typeof parsed !== 'object' || !parsed.email || !parsed.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedGoogleDriveAuth(auth: GoogleDriveAuth | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!auth) {
      window.localStorage.removeItem(GDRIVE_AUTH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(GDRIVE_AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // ignore storage quota errors
  }
}

type ShelfOrgPrefs = Pick<ThemeConfig, 'viewMode' | 'sortBy' | 'sortDir' | 'readingFilter'> & {
  updatedAt?: number;
};

function readStoredShelfPrefs(): ShelfOrgPrefs | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(SHELF_PREFS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShelfOrgPrefs>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      viewMode: parsed.viewMode === 'shelf' || parsed.viewMode === 'grid' || parsed.viewMode === 'list' ? parsed.viewMode : DEFAULT_THEME.viewMode,
      sortBy:
        parsed.sortBy === 'recent' ||
        parsed.sortBy === 'title' ||
        parsed.sortBy === 'author' ||
        parsed.sortBy === 'imported' ||
        parsed.sortBy === 'folder'
          ? parsed.sortBy
          : DEFAULT_THEME.sortBy,
      sortDir: parsed.sortDir === 'asc' || parsed.sortDir === 'desc' ? parsed.sortDir : DEFAULT_THEME.sortDir,
      readingFilter:
        parsed.readingFilter === 'all' ||
        parsed.readingFilter === 'unread' ||
        parsed.readingFilter === 'reading' ||
        parsed.readingFilter === 'completed'
          ? parsed.readingFilter
          : DEFAULT_THEME.readingFilter,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeStoredShelfPrefs(t: ThemeConfig, ts = Date.now()): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload: ShelfOrgPrefs = {
      viewMode: t.viewMode || DEFAULT_THEME.viewMode,
      sortBy: t.sortBy || DEFAULT_THEME.sortBy,
      sortDir: t.sortDir || DEFAULT_THEME.sortDir,
      readingFilter: t.readingFilter || DEFAULT_THEME.readingFilter,
      updatedAt: ts,
    };
    window.localStorage.setItem(SHELF_PREFS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

function isThemeCustomized(t: ThemeConfig | null | undefined): boolean {
  if (!t) return false;
  return (
    t.presetId !== DEFAULT_THEME.presetId ||
    t.appName !== DEFAULT_THEME.appName ||
    t.outerBg !== DEFAULT_THEME.outerBg ||
    t.shellBg !== DEFAULT_THEME.shellBg ||
    t.sidebarBg !== DEFAULT_THEME.sidebarBg ||
    t.panelBg !== DEFAULT_THEME.panelBg ||
    t.cardBg !== DEFAULT_THEME.cardBg ||
    t.accentPrimary !== DEFAULT_THEME.accentPrimary ||
    t.accentSecondary !== DEFAULT_THEME.accentSecondary ||
    t.fontFamily !== DEFAULT_THEME.fontFamily ||
    Boolean(t.customWallpaperUrl) ||
    t.bannerTitle !== DEFAULT_THEME.bannerTitle ||
    t.bannerSubtitle !== DEFAULT_THEME.bannerSubtitle ||
    t.viewMode !== DEFAULT_THEME.viewMode ||
    (t.sortBy || DEFAULT_THEME.sortBy) !== DEFAULT_THEME.sortBy ||
    (t.sortDir || DEFAULT_THEME.sortDir) !== DEFAULT_THEME.sortDir ||
    (t.readingFilter || DEFAULT_THEME.readingFilter) !== DEFAULT_THEME.readingFilter ||
    t.compactSidebar !== DEFAULT_THEME.compactSidebar ||
    t.showRightPanel !== DEFAULT_THEME.showRightPanel ||
    t.showBanner !== DEFAULT_THEME.showBanner ||
    t.showCategories !== DEFAULT_THEME.showCategories
  );
}

function isProfileCustomized(p: UserProfile | null | undefined): boolean {
  if (!p) return false;
  return (
    (Boolean(p.name?.trim()) && p.name.trim() !== DEFAULT_PROFILE.name) ||
    Boolean(p.avatarImageUrl) ||
    p.avatarEmoji !== DEFAULT_PROFILE.avatarEmoji ||
    p.avatarBg !== DEFAULT_PROFILE.avatarBg ||
    (p.booksGoalPerYear !== undefined && p.booksGoalPerYear !== DEFAULT_PROFILE.booksGoalPerYear) ||
    (p.pagesGoalPerYear !== undefined && p.pagesGoalPerYear !== DEFAULT_PROFILE.pagesGoalPerYear)
  );
}

function deriveChatSessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.sender === 'user' && m.text.trim());
  if (!firstUser) return 'Nueva conversación';
  const clean = firstUser.text.replace(/\s+/g, ' ').trim();
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean;
}

function createFreshChatSession(messages: ChatMessage[] = INITIAL_CHAT_MESSAGES): ChatSession {
  const now = Date.now();
  const cloned = messages.map((m, idx) => ({
    ...m,
    createdAt: m.createdAt || now - (messages.length - idx) * 1000,
  }));
  return {
    id: `chat_${now}_${Math.random().toString(36).slice(2, 6)}`,
    title: deriveChatSessionTitle(cloned),
    messages: cloned,
    createdAt: now,
    updatedAt: now,
  };
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
  const [theme, setTheme] = useState<ThemeConfig>(() => {
    const cached = readCachedThemeForStartup();
    if (typeof document !== 'undefined') applyThemeCssVars(cached);
    return cached;
  });
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(
    () => readCachedReaderSettings()?.settings || DEFAULT_READER_SETTINGS
  );
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(DEFAULT_SYNC_CONFIG);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => [
    createFreshChatSession(INITIAL_CHAT_MESSAGES),
  ]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string>('');
  const chatMessages = React.useMemo(() => {
    const active =
      chatSessions.find((s) => s.id === activeChatSessionId) || chatSessions[0];
    return active ? active.messages : INITIAL_CHAT_MESSAGES;
  }, [chatSessions, activeChatSessionId]);

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
  const [missingFileBook, setMissingFileBook] = useState<BookItem | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [studioModalOpen, setStudioModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [offlineSyncProgress, setOfflineSyncProgress] = useState('');
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
  const [googleDriveAuth, setGoogleDriveAuth] = useState<GoogleDriveAuth | null>(() =>
    readCachedGoogleDriveAuth()
  );
  const [syncPopup, setSyncPopup] = useState<SyncPopupState>({
    visible: false,
    phase: 'syncing',
    progress: 0,
    title: 'Sincronizando...',
    detail: '',
  });
  const syncPopupCloseTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const deletedIdsRef = useRef<string[]>([]);
  const deletedBookmarkIdsRef = useRef<string[]>([]);
  const deletedAnnotationIdsRef = useRef<string[]>([]);
  const deletedNoteIdsRef = useRef<string[]>([]);
  const deletedBookmarkDesignIdsRef = useRef<string[]>([]);
  const deletedChatSessionIdsRef = useRef<string[]>([]);
  const joinedRoomCodesRef = useRef<string[]>([]);
  const joinedShelfCodesRef = useRef<string[]>([]);
  const closedRoomCodesRef = useRef<string[]>([]);
  const closedShelfCodesRef = useRef<string[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const themeUpdatedAtRef = useRef<number>(0);
  const profileUpdatedAtRef = useRef<number>(0);
  const readerSettingsUpdatedAtRef = useRef<number>(readCachedReaderSettings()?.updatedAt || 0);
  const lastSyncedWallpaperRef = useRef<string>('');
  const syncedCoverSigRef = useRef<Map<string, string>>(new Map());
  const syncedBookUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const lastRemoteUpdatedAtRef = useRef<number>(0);
  const lastDriveModifiedTimeRef = useRef<string>('');
  const syncInFlightRef = useRef<boolean>(false);
  const dirtyScopesRef = useRef<Set<'books' | 'personalization' | 'marks' | 'notes' | 'chat' | 'shared'>>(new Set());
  const lastResumeSyncAtRef = useRef<number>(0);
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
      chatSessions: Array.from(new Set(deletedChatSessionIdsRef.current)).slice(-200),
    }).catch(console.error);
  }, []);
  const sharedUserId = React.useMemo(() => {
    if (googleDriveAuth?.email) {
      return deriveEmailSpaceId(googleDriveAuth.email, 'komo_shared');
    }
    if (syncConfig.accountEmail && syncConfig.spaceId) {
      return syncConfig.spaceId;
    }
    return deviceId;
  }, [googleDriveAuth?.email, syncConfig.accountEmail, syncConfig.spaceId, deviceId]);

  const stateRef = useRef({
    books,
    bookmarks,
    annotations,
    customBookmarkDesigns,
    customStationery,
    notes,
    chatSessions,
    activeChatSessionId,
    categories,
    collections,
    readerSettings,
    theme,
    profile,
    syncConfig,
    googleDriveAuth,
    deviceId,
    sharedUserId,
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
    chatSessions,
    activeChatSessionId,
    categories,
    collections,
    readerSettings,
    theme,
    profile,
    syncConfig,
    googleDriveAuth,
    deviceId,
    sharedUserId,
    sharedRooms,
    sharedShelves,
  };

  const persistGoogleDriveAuth = useCallback((next: GoogleDriveAuth | null) => {
    stateRef.current.googleDriveAuth = next;
    setGoogleDriveAuth(next);
    writeCachedGoogleDriveAuth(next);
    dbSetKV('googleDriveAuth', next).catch(console.error);
  }, []);

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

  const dismissSyncPopup = useCallback(() => {
    if (syncPopupCloseTimerRef.current) {
      window.clearTimeout(syncPopupCloseTimerRef.current);
      syncPopupCloseTimerRef.current = null;
    }
    setSyncPopup((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const showSyncPopupProgress = useCallback(
    (progress: number, detail: string, title = 'Sincronizando biblioteca') => {
      if (syncPopupCloseTimerRef.current) {
        window.clearTimeout(syncPopupCloseTimerRef.current);
        syncPopupCloseTimerRef.current = null;
      }
      setSyncPopup({
        visible: true,
        phase: 'syncing',
        progress: Math.min(98, Math.max(0, Math.round(progress))),
        title,
        detail,
      });
    },
    []
  );

  const completeSyncPopup = useCallback((detail: string, summary?: string) => {
    if (syncPopupCloseTimerRef.current) {
      window.clearTimeout(syncPopupCloseTimerRef.current);
    }
    setSyncPopup({
      visible: true,
      phase: 'done',
      progress: 100,
      title: '¡Sincronización lista!',
      detail,
      summary,
    });
    syncPopupCloseTimerRef.current = window.setTimeout(() => {
      syncPopupCloseTimerRef.current = null;
      setSyncPopup((prev) => (prev.phase === 'done' ? { ...prev, visible: false } : prev));
    }, 1500);
  }, []);

  const failSyncPopup = useCallback((detail: string) => {
    if (syncPopupCloseTimerRef.current) {
      window.clearTimeout(syncPopupCloseTimerRef.current);
      syncPopupCloseTimerRef.current = null;
    }
    setSyncPopup({
      visible: true,
      phase: 'error',
      progress: 100,
      title: 'Error de sincronización',
      detail,
    });
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
        savedChatSessions,
        savedActiveChatId,
        seeded,
        savedDeviceId,
        savedJoinedCodes,
        savedShelfCodes,
        savedCachedRooms,
        savedCachedShelves,
        savedSelectedRoomCode,
        savedSelectedShelfCode,
        savedClosedRoomCodes,
        savedClosedShelfCodes,
        savedCustomDesigns,
        savedCustomStationery,
        savedPendingTombstones,
        savedThemeTs,
        savedProfileTs,
        savedReaderSettingsTs,
        savedGoogleDriveAuth,
      ] = await Promise.all([
        dbGetKV<ThemeConfig>('theme'),
        dbGetKV<CategoryItem[]>('categories'),
        dbGetKV<CollectionCard[]>('collections'),
        dbGetKV<UserProfile>('profile'),
        dbGetKV<ReaderSettings>('readerSettings'),
        dbGetKV<SyncConfig>('syncConfig'),
        dbGetKV<ChatMessage[]>('chatMessages'),
        dbGetKV<ChatSession[]>('chatSessions'),
        dbGetKV<string>('activeChatSessionId'),
        dbGetKV<boolean>('seeded'),
        dbGetKV<string>('deviceId'),
        dbGetKV<string[]>('joinedRoomCodes'),
        dbGetKV<string[]>('joinedShelfCodes'),
        dbGetKV<SharedRoom[]>('cachedSharedRooms'),
        dbGetKV<SharedShelf[]>('cachedSharedShelves'),
        dbGetKV<string>('selectedRoomCode'),
        dbGetKV<string>('selectedShelfCode'),
        dbGetKV<string[]>('closedRoomCodes'),
        dbGetKV<string[]>('closedShelfCodes'),
        dbGetKV<BookmarkDesign[]>('customBookmarkDesigns'),
        dbGetKV<CustomStationeryKit>('customStationery'),
        dbGetKV<{
          books?: string[];
          bookmarks?: string[];
          annotations?: string[];
          notes?: string[];
          customBookmarkDesigns?: string[];
          chatSessions?: string[];
        }>('pendingTombstones'),
        dbGetKV<number>('themeUpdatedAt'),
        dbGetKV<number>('profileUpdatedAt'),
        dbGetKV<number>('readerSettingsUpdatedAt'),
        dbGetKV<GoogleDriveAuth | null>('googleDriveAuth'),
      ]);

      const cachedDriveAuth = readCachedGoogleDriveAuth();
      const hydratedDriveAuth =
        savedGoogleDriveAuth?.accessToken
          ? {
              ...savedGoogleDriveAuth,
              refreshToken:
                savedGoogleDriveAuth.refreshToken ||
                (cachedDriveAuth?.email === savedGoogleDriveAuth.email
                  ? cachedDriveAuth.refreshToken
                  : '') ||
                '',
            }
          : cachedDriveAuth;
      if (hydratedDriveAuth && hydratedDriveAuth.accessToken) {
        stateRef.current.googleDriveAuth = hydratedDriveAuth;
        setGoogleDriveAuth(hydratedDriveAuth);
        writeCachedGoogleDriveAuth(hydratedDriveAuth);
        if (!savedGoogleDriveAuth?.accessToken) {
          dbSetKV('googleDriveAuth', hydratedDriveAuth).catch(console.error);
        }
      }

      if (typeof savedThemeTs === 'number') themeUpdatedAtRef.current = savedThemeTs;
      if (typeof savedProfileTs === 'number') profileUpdatedAtRef.current = savedProfileTs;
      const cachedReader = readCachedReaderSettings();
      const dbReaderTs = typeof savedReaderSettingsTs === 'number' ? savedReaderSettingsTs : 0;
      const bestReaderTs = Math.max(dbReaderTs, cachedReader?.updatedAt || 0);
      readerSettingsUpdatedAtRef.current = bestReaderTs;

      const storedShelfPrefs = readStoredShelfPrefs();
      const useStoredShelfPrefs =
        storedShelfPrefs &&
        (!savedTheme || (storedShelfPrefs.updatedAt || 0) >= (themeUpdatedAtRef.current || 0));
      const effectiveStartupTheme: ThemeConfig = {
        ...DEFAULT_THEME,
        ...(savedTheme || {}),
        ...(useStoredShelfPrefs
          ? {
              viewMode: storedShelfPrefs.viewMode,
              sortBy: storedShelfPrefs.sortBy,
              sortDir: storedShelfPrefs.sortDir,
              readingFilter: storedShelfPrefs.readingFilter,
            }
          : {}),
      };
      if (isThemeCustomized(effectiveStartupTheme)) {
        if (!themeUpdatedAtRef.current) {
          themeUpdatedAtRef.current = storedShelfPrefs?.updatedAt || Date.now();
          await dbSetKV('themeUpdatedAt', themeUpdatedAtRef.current);
        }
      } else {
        themeUpdatedAtRef.current = 0;
      }

      const effectiveStartupProfile = { ...DEFAULT_PROFILE, ...(savedProfile || {}) };
      if (isProfileCustomized(effectiveStartupProfile)) {
        if (!profileUpdatedAtRef.current) {
          profileUpdatedAtRef.current = Date.now();
          await dbSetKV('profileUpdatedAt', profileUpdatedAtRef.current);
        }
      } else {
        profileUpdatedAtRef.current = 0;
      }

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
        if (Array.isArray(savedPendingTombstones.chatSessions)) {
          deletedChatSessionIdsRef.current = savedPendingTombstones.chatSessions;
        }
      }

      let resolvedDeviceId = savedDeviceId;
      if (!resolvedDeviceId) {
        resolvedDeviceId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await dbSetKV('deviceId', resolvedDeviceId);
      }

      if (Array.isArray(savedClosedRoomCodes)) {
        closedRoomCodesRef.current = savedClosedRoomCodes
          .map((c) => String(c || '').trim().toUpperCase())
          .filter(Boolean);
      }
      if (Array.isArray(savedClosedShelfCodes)) {
        closedShelfCodesRef.current = savedClosedShelfCodes
          .map((c) => String(c || '').trim().toUpperCase())
          .filter(Boolean);
      }
      const closedRoomSet = new Set(closedRoomCodesRef.current);
      const closedShelfSet = new Set(closedShelfCodesRef.current);

      const hydratedRooms = Array.isArray(savedCachedRooms)
        ? savedCachedRooms
            .filter((r) => r?.code && !closedRoomSet.has(r.code.trim().toUpperCase()))
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        : [];
      const hydratedShelves = Array.isArray(savedCachedShelves)
        ? savedCachedShelves
            .filter((sh) => sh?.code && !closedShelfSet.has(sh.code.trim().toUpperCase()))
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        : [];

      const mergedRoomCodes = Array.from(
        new Set([
          ...(Array.isArray(savedJoinedCodes) ? savedJoinedCodes : []),
          ...hydratedRooms.map((r) => r.code),
        ].map((c) => String(c || '').trim().toUpperCase()).filter((c) => c && !closedRoomSet.has(c)))
      ).slice(0, 40);
      joinedRoomCodesRef.current = mergedRoomCodes;

      const mergedShelfCodes = Array.from(
        new Set([
          ...(Array.isArray(savedShelfCodes) ? savedShelfCodes : []),
          ...hydratedShelves.map((sh) => sh.code),
        ].map((c) => String(c || '').trim().toUpperCase()).filter((c) => c && !closedShelfSet.has(c)))
      ).slice(0, 40);
      joinedShelfCodesRef.current = mergedShelfCodes;

      // First-time users ALWAYS start with an empty library (0 demo books).
      // Also purge any legacy auto-seeded demo books if present.
      const allStoredBooks = await dbGetAllBooks();
      const demoBooks = allStoredBooks.filter((b) => b.isDemo);
      for (const dbk of demoBooks) {
        await dbDeleteBook(dbk.id).catch(() => undefined);
      }
      const loadedBooks = allStoredBooks
        .filter((b) => !b.isDemo)
        .map((b) => {
          if (!b.description) return b;
          const cleaned = cleanSynopsisText(b.description) || '';
          if (cleaned !== b.description) {
            const nextBook = { ...b, description: cleaned };
            dbPutBook(nextBook).catch(() => undefined);
            return nextBook;
          }
          return b;
        });
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

      // Production builds (Desktop PC / Android APK) receive the API URL via VITE_SYNC_SERVER_URL.
      // If this device still has an old localhost, LAN IP, HTTP URL on HTTPS, temporary tunnel,
      // or outdated Render subdomain saved in IndexedDB, migrate it automatically to SYNC_SERVER_URL.
      if (SYNC_SERVER_URL) {
        const savedServer = normalizeServerUrl(initialSync.serverUrl);
        const isHttpsPage =
          typeof window !== 'undefined' && window.location.protocol === 'https:';
        const appOrigin =
          typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)
            ? window.location.origin.replace(/\/+$/, '')
            : '';
        const isPrivateLan =
          /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(savedServer);
        const isMixedHttp = isHttpsPage && /^http:\/\//i.test(savedServer);
        const isOutdatedHostedApi =
          (/\.onrender\.com$/i.test(savedServer) || /\.workers\.dev$/i.test(savedServer)) &&
          savedServer !== SYNC_SERVER_URL;
        const staleServer =
          !savedServer ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(savedServer) ||
          (isHttpsPage && isPrivateLan) ||
          isMixedHttp ||
          isOutdatedHostedApi ||
          /\.trycloudflare\.com$/i.test(savedServer) ||
          (appOrigin && savedServer === appOrigin);
        if (staleServer || savedServer !== initialSync.serverUrl) {
          initialSync = {
            ...initialSync,
            serverUrl: staleServer ? SYNC_SERVER_URL : savedServer,
          };
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

      const mergedTheme = effectiveStartupTheme;
      setTheme(mergedTheme);
      applyThemeCssVars(mergedTheme);
      writeCachedTheme(mergedTheme);
      writeStoredShelfPrefs(mergedTheme, themeUpdatedAtRef.current || Date.now());

      if (savedCats?.length) setCategories(savedCats);
      if (savedCols?.length) setCollections(savedCols);
      if (savedProfile) setProfile({ ...DEFAULT_PROFILE, ...savedProfile });
      const effectiveStartupReader: ReaderSettings | null =
        cachedReader && cachedReader.updatedAt > dbReaderTs
          ? cachedReader.settings
          : savedReader
          ? { ...DEFAULT_READER_SETTINGS, ...savedReader }
          : cachedReader?.settings || null;
      if (effectiveStartupReader) {
        stateRef.current.readerSettings = effectiveStartupReader;
        setReaderSettings(effectiveStartupReader);
        writeCachedReaderSettings(effectiveStartupReader, readerSettingsUpdatedAtRef.current);
        if (cachedReader && cachedReader.updatedAt > dbReaderTs) {
          dbSetKV('readerSettings', effectiveStartupReader).catch(console.error);
          dbSetKV('readerSettingsUpdatedAt', cachedReader.updatedAt).catch(console.error);
        }
      }
      setSyncConfig(initialSync);
      const pendingChatDel = new Set(deletedChatSessionIdsRef.current);
      let initialSessions: ChatSession[] = [];
      if (Array.isArray(savedChatSessions) && savedChatSessions.length > 0) {
        initialSessions = savedChatSessions
          .filter((cs) => cs?.id && Array.isArray(cs.messages) && !pendingChatDel.has(cs.id))
          .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      } else if (Array.isArray(savedChat) && savedChat.some((m) => m.sender === 'user')) {
        const migrated = createFreshChatSession(savedChat);
        const lastMsgTs = savedChat[savedChat.length - 1]?.createdAt || Date.now();
        migrated.createdAt = savedChat[0]?.createdAt || lastMsgTs;
        migrated.updatedAt = lastMsgTs;
        initialSessions = [migrated];
        await dbSetKV('chatSessions', initialSessions);
      }
      if (initialSessions.length === 0) {
        initialSessions = [createFreshChatSession(INITIAL_CHAT_MESSAGES)];
      }
      const resolvedActiveChatId =
        savedActiveChatId && initialSessions.some((cs) => cs.id === savedActiveChatId)
          ? savedActiveChatId
          : initialSessions[0].id;
      setChatSessions(initialSessions);
      setActiveChatSessionId(resolvedActiveChatId);
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

      if (hydratedRooms.length > 0) {
        stateRef.current.sharedRooms = hydratedRooms;
        setSharedRooms(hydratedRooms);
        const preferredRoom =
          savedSelectedRoomCode && hydratedRooms.some((r) => r.code === savedSelectedRoomCode)
            ? savedSelectedRoomCode
            : hydratedRooms[0].code;
        setSelectedRoomCode(preferredRoom);
      }
      if (hydratedShelves.length > 0) {
        stateRef.current.sharedShelves = hydratedShelves;
        setSharedShelves(hydratedShelves);
        const preferredShelf =
          savedSelectedShelfCode && hydratedShelves.some((sh) => sh.code === savedSelectedShelfCode)
            ? savedSelectedShelfCode
            : hydratedShelves[0].code;
        setSelectedShelfCode(preferredShelf);
      }

      // Privacy invariant: Every new device/install MUST start 100% isolated and empty.
      // Cloud sync ONLY pulls data after the user explicitly signs in with Google Drive or email
      // or explicitly pairs via ?pair=1 — NEVER auto-connects any device to a shared/owner vault.

      setReady(true);

      // Background pass (v3): ensure existing local books in IndexedDB extract their original cover
      // (re-checks books that previously failed extraction on older Android WebView builds)
      const needsCheck = loadedBooks.filter(
        (b) =>
          !b.coverCheckedV2 ||
          (!b.coverCheckedV3 &&
            b.hasLocalFile &&
            !b.isDemo &&
            !hasDisplayableOriginalCover(b) &&
            b.hasOriginalCover !== false) ||
          (!b.coverCheckedV3 && b.hasLocalFile && !b.isDemo && !isRasterCoverDataUrl(b.coverDataUrl))
      );
      if (needsCheck.length > 0) {
        (async () => {
          let upgradedCovers = 0;
          for (const book of needsCheck) {
            if (cancelled) return;
            try {
              let patch: Partial<BookItem> = { coverCheckedV2: true, coverCheckedV3: true };
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
                if (extracted.coverDataUrl && isRasterCoverDataUrl(extracted.coverDataUrl)) {
                  const pal = await extractCoverPaletteFromDataUrl(
                    extracted.coverDataUrl,
                    book.spineColor.startsWith('#') ? book.spineColor : '#4c6c8a',
                    book.ribbonColor || '#f2ba59'
                  );
                  patch = {
                    coverDataUrl: extracted.coverDataUrl,
                    hasOriginalCover: true,
                    coverCheckedV2: true,
                    coverCheckedV3: true,
                    spineColor: pal.spineColor,
                    ribbonColor: pal.ribbonColor,
                    updatedAt: Date.now(),
                  };
                  if (
                    extracted.author &&
                    (!book.author ||
                      book.author === 'Autor desconocido' ||
                      book.author === 'Biblioteca Personal')
                  ) {
                    patch.author = extracted.author;
                  }
                  upgradedCovers++;
                } else if (isRasterCoverDataUrl(book.coverDataUrl)) {
                  const pal = await extractCoverPaletteFromDataUrl(
                    book.coverDataUrl,
                    book.spineColor.startsWith('#') ? book.spineColor : '#4c6c8a',
                    book.ribbonColor || '#f2ba59'
                  );
                  patch = {
                    hasOriginalCover: true,
                    coverCheckedV2: true,
                    coverCheckedV3: true,
                    spineColor: pal.spineColor,
                    ribbonColor: pal.ribbonColor,
                  };
                } else {
                  patch = {
                    hasOriginalCover: false,
                    coverCheckedV2: true,
                    coverCheckedV3: true,
                  };
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
          if (!cancelled && upgradedCovers > 0) {
            setSyncMessage((prev) => prev || `${upgradedCovers} portadas originales recuperadas`);
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

  // Detect server health, LAN/Public URL, and Gemini AI proxy availability.
  // Retry briefly on hosted Render backends so mobile browsers recover cleanly after a cold start.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timers: number[] = [];

    const probe = async () => {
      const cfg = stateRef.current.syncConfig;
      try {
        const h = await checkServerHealth(cfg);
        if (cancelled) return;
        setServerOnline(true);
        setServerAuthRequired(Boolean(h.authRequired));
        setAiOnline(Boolean(h.aiConfigured));
        setAiModelName(h.aiModel || 'gemini-2.5-flash');
        setServerLanUrl(h.lanUrls?.[0] || '');
        return true;
      } catch {
        if (cancelled) return false;
        setServerOnline(false);
        setAiOnline(false);
        return false;
      }
    };

    (async () => {
      const ok = await probe();
      if (cancelled || ok) return;
      const targetUrl = stateRef.current.syncConfig.serverUrl || SYNC_SERVER_URL;
      if (/\.onrender\.com\b/i.test(targetUrl)) {
        timers.push(
          window.setTimeout(async () => {
            if (cancelled) return;
            const retryOk = await probe();
            if (cancelled || retryOk) return;
            timers.push(
              window.setTimeout(() => {
                if (!cancelled) void probe();
              }, 10000)
            );
          }, 5000)
        );
      }
    })();

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [ready, syncConfig.serverUrl, syncConfig.token]);

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
        const deletedChatSessionSet = new Set([
          ...(merged.deletedChatSessionIds || []),
          ...deletedChatSessionIdsRef.current,
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
        if (merged.updatedAt && merged.updatedAt > lastRemoteUpdatedAtRef.current) {
          lastRemoteUpdatedAtRef.current = merged.updatedAt;
        }
        const booksToAutoDownload: BookItem[] = [];
        let booksStateChanged = deletedBookSet.size > 0;
        for (const remoteBook of Object.values(merged.books || {})) {
          if (!remoteBook || remoteBook.isDemo || deletedBookSet.has(remoteBook.id)) continue;
          const local = mergedMap.get(remoteBook.id);

          // Record confirmed server state for ultra-fast future delta syncs
          syncedBookUpdatedAtRef.current.set(remoteBook.id, remoteBook.updatedAt || 0);
          if (remoteBook.coverDataUrl && remoteBook.coverDataUrl !== '__KEEP__') {
            syncedCoverSigRef.current.set(remoteBook.id, getCoverSignature(remoteBook.coverDataUrl));
          } else if (remoteBook.coverDataUrl === '__KEEP__' && local?.coverDataUrl) {
            syncedCoverSigRef.current.set(remoteBook.id, getCoverSignature(local.coverDataUrl));
          }

          const remoteHasRaster = isRasterCoverDataUrl(remoteBook.coverDataUrl);
          const localHasRaster = isRasterCoverDataUrl(local?.coverDataUrl);

          // Fast path: unchanged book already persisted locally -> skip expensive IndexedDB write!
          if (
            local &&
            !forceRestore &&
            (remoteBook.updatedAt || 0) === (local.updatedAt || 0) &&
            Boolean(remoteBook.hasRemoteFile) === Boolean(local.hasRemoteFile) &&
            (remoteBook.driveFileId || '') === (local.driveFileId || '') &&
            (remoteBook.remoteFileName || '') === (local.remoteFileName || '') &&
            (!remoteHasRaster || localHasRaster)
          ) {
            continue;
          }

          const hasFileRec = local?.hasLocalFile ? true : Boolean(await dbGetBookFile(remoteBook.id));

          if (!local || forceRestore || (remoteBook.updatedAt || 0) >= (local.updatedAt || 0)) {
            let safeCover =
              remoteBook.coverDataUrl && remoteBook.coverDataUrl !== '__KEEP__'
                ? remoteBook.coverDataUrl
                : local?.coverDataUrl || '';
            let safeHasOriginal = remoteBook.hasOriginalCover;
            let safeSpine = remoteBook.spineColor || local?.spineColor || '#4c6c8a';
            let safeRibbon = remoteBook.ribbonColor || local?.ribbonColor || '#f2ba59';

            // Never let a remote placeholder/SVG/empty cover clobber a real local original cover!
            if (localHasRaster && !remoteHasRaster && remoteBook.hasOriginalCover !== false && local) {
              safeCover = local.coverDataUrl;
              safeHasOriginal = true;
              safeSpine = local.spineColor || safeSpine;
              safeRibbon = local.ribbonColor || safeRibbon;
            } else if (remoteHasRaster && safeHasOriginal === undefined) {
              safeHasOriginal = true;
            }

            if (!safeCover) {
              const fallback = generateCozyCover(
                remoteBook.title || local?.title || 'Sin título',
                remoteBook.author || local?.author || 'Autor desconocido',
                remoteBook.kind || local?.kind || 'book',
                remoteBook.format || local?.format || 'epub'
              );
              safeCover = fallback.coverDataUrl;
              safeHasOriginal = false;
            }

            const mergedItem: BookItem = {
              ...local,
              ...remoteBook,
              coverDataUrl: safeCover,
              hasOriginalCover: safeHasOriginal,
              spineColor: safeSpine,
              ribbonColor: safeRibbon,
              coverCheckedV3: local?.coverCheckedV3 || remoteBook.coverCheckedV3,
              folderPath: remoteBook.folderPath || local?.folderPath,
              nativeFileUri: local?.nativeFileUri,
              hasLocalFile: hasFileRec,
            };
            await dbPutBook(mergedItem);
            mergedMap.set(remoteBook.id, mergedItem);
            booksStateChanged = true;
            if (!hasFileRec && remoteBook.hasRemoteFile) {
              booksToAutoDownload.push(mergedItem);
            }
          } else {
            // Local is newer, but still absorb cloud file availability OR a real remote cover if local lacked one!
            const shouldAdoptRemoteCover = remoteHasRaster && !localHasRaster && local.hasOriginalCover !== false;
            const shouldAdoptRemoteFile = Boolean(
              (remoteBook.hasRemoteFile && !local.hasLocalFile) ||
                (remoteBook.driveFileId && !local.driveFileId)
            );
            if (shouldAdoptRemoteCover || shouldAdoptRemoteFile) {
              const updatedLocal: BookItem = {
                ...local,
                hasRemoteFile: local.hasRemoteFile || Boolean(remoteBook.hasRemoteFile),
                driveFileId: local.driveFileId || remoteBook.driveFileId,
                remoteFileName: remoteBook.remoteFileName || local.remoteFileName,
                ...(shouldAdoptRemoteCover
                  ? {
                      coverDataUrl: remoteBook.coverDataUrl,
                      hasOriginalCover: true,
                      spineColor: remoteBook.spineColor || local.spineColor,
                      ribbonColor: remoteBook.ribbonColor || local.ribbonColor,
                    }
                  : {}),
              };
              await dbPutBook(updatedLocal);
              mergedMap.set(remoteBook.id, updatedLocal);
              booksStateChanged = true;
              if (!hasFileRec && updatedLocal.hasRemoteFile) {
                booksToAutoDownload.push(updatedLocal);
              }
            }
          }
        }

        const nextBooks = Array.from(mergedMap.values()).sort(
          (a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
        );
        if (booksStateChanged || nextBooks.length !== current.books.length) {
          stateRef.current.books = nextBooks;
          setBooks(nextBooks);
          setActiveBook((curr) => {
            if (!curr) return curr;
            const refreshed = mergedMap.get(curr.id);
            if (!refreshed) return curr;
            if ((curr.updatedAt || 0) > (refreshed.updatedAt || 0)) return curr;
            return refreshed;
          });
        }

        // Background auto-download ONLY the 3 most recently read books so low-end phones never freeze or flicker!
        if (booksToAutoDownload.length > 0) {
          const priorityDownloads = [...booksToAutoDownload]
            .sort(
              (a, b) =>
                Math.max(b.lastReadAt || 0, b.updatedAt || 0, b.addedAt || 0) -
                Math.max(a.lastReadAt || 0, a.updatedAt || 0, a.addedAt || 0)
            )
            .slice(0, 3);
          (async () => {
            const downloadedPatches = new Map<string, string | undefined>();
            let activeDrive = stateRef.current.googleDriveAuth;
            for (const target of priorityDownloads) {
              try {
                let resolvedDriveId = target.driveFileId;
                if (activeDrive?.accessToken) {
                  const dl = await downloadBookFileFromGoogleDrive(
                    stateRef.current.syncConfig,
                    activeDrive,
                    target,
                    persistGoogleDriveAuth
                  );
                  activeDrive = dl.auth;
                  resolvedDriveId = dl.driveFileId;
                } else {
                  await downloadBookFromServer(stateRef.current.syncConfig, target);
                }
                const patched: BookItem = {
                  ...target,
                  hasLocalFile: true,
                  driveFileId: resolvedDriveId,
                };
                await dbPutBook(patched);
                downloadedPatches.set(target.id, resolvedDriveId);
              } catch {
                // will retry when book is clicked or via offline sync button
              }
            }
            if (downloadedPatches.size > 0) {
              setBooks((prev) =>
                prev.map((x) =>
                  downloadedPatches.has(x.id)
                    ? { ...x, hasLocalFile: true, driveFileId: downloadedPatches.get(x.id) || x.driveFileId }
                    : x
                )
              );
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

        if (Array.isArray(merged.chatSessions)) {
          const sessionMap = new Map<string, ChatSession>();
          for (const cs of current.chatSessions) {
            if (cs?.id && !deletedChatSessionSet.has(cs.id)) {
              sessionMap.set(cs.id, cs);
            }
          }
          for (const cs of merged.chatSessions) {
            if (!cs?.id || deletedChatSessionSet.has(cs.id) || !Array.isArray(cs.messages)) continue;
            const prev = sessionMap.get(cs.id);
            if (
              !prev ||
              forceRestore ||
              (cs.updatedAt || cs.createdAt) >= (prev.updatedAt || prev.createdAt)
            ) {
              sessionMap.set(cs.id, cs);
            }
          }
          let mergedSessions = Array.from(sessionMap.values())
            .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
            .slice(0, 60);
          if (mergedSessions.length === 0) {
            mergedSessions = [createFreshChatSession(INITIAL_CHAT_MESSAGES)];
          }
          setChatSessions(mergedSessions);
          await dbSetKV('chatSessions', mergedSessions);
          if (!mergedSessions.some((cs) => cs.id === current.activeChatSessionId)) {
            setActiveChatSessionId(mergedSessions[0].id);
            await dbSetKV('activeChatSessionId', mergedSessions[0].id);
          }
        }

        if (
          merged.categories?.length &&
          JSON.stringify(merged.categories) !== JSON.stringify(current.categories)
        ) {
          setCategories(merged.categories);
          await dbSetKV('categories', merged.categories);
        }
        if (
          merged.collections?.length &&
          JSON.stringify(merged.collections) !== JSON.stringify(current.collections)
        ) {
          setCollections(merged.collections);
          await dbSetKV('collections', merged.collections);
        }
        const remoteReaderTs = Number(merged.readerSettingsUpdatedAt || 0);
        const shouldApplyRemoteReader = Boolean(
          merged.readerSettings &&
            (forceRestore ||
              !readerSettingsUpdatedAtRef.current ||
              (remoteReaderTs > 0 && remoteReaderTs > readerSettingsUpdatedAtRef.current))
        );
        if (shouldApplyRemoteReader && merged.readerSettings) {
          const mergedReader = { ...DEFAULT_READER_SETTINGS, ...merged.readerSettings };
          const nextReaderTs = remoteReaderTs || readerSettingsUpdatedAtRef.current;
          readerSettingsUpdatedAtRef.current = nextReaderTs;
          stateRef.current.readerSettings = mergedReader;
          if (JSON.stringify(mergedReader) !== JSON.stringify(current.readerSettings)) {
            setReaderSettings(mergedReader);
          }
          writeCachedReaderSettings(mergedReader, nextReaderTs);
          await dbSetKV('readerSettings', mergedReader);
          await dbSetKV('readerSettingsUpdatedAt', nextReaderTs);
        }
        if (merged.theme && merged.theme.customWallpaperUrl !== '__KEEP__') {
          lastSyncedWallpaperRef.current = merged.theme.customWallpaperUrl || '';
        }
        if (
          merged.theme &&
          (forceRestore ||
            !themeUpdatedAtRef.current ||
            !isThemeCustomized(current.theme) ||
            (merged.themeUpdatedAt || 0) >= themeUpdatedAtRef.current)
        ) {
          const nextThemeTs = merged.themeUpdatedAt || (isThemeCustomized(merged.theme) ? themeUpdatedAtRef.current : 0);
          themeUpdatedAtRef.current = nextThemeTs;
          const resolvedWallpaper =
            merged.theme.customWallpaperUrl === '__KEEP__'
              ? current.theme.customWallpaperUrl || ''
              : merged.theme.customWallpaperUrl || '';
          const mergedTheme: ThemeConfig = {
            ...DEFAULT_THEME,
            ...merged.theme,
            // Preserve user's shelf organization if remote payload omitted any of these keys
            viewMode: merged.theme.viewMode || current.theme.viewMode || DEFAULT_THEME.viewMode,
            sortBy: merged.theme.sortBy || current.theme.sortBy || DEFAULT_THEME.sortBy,
            sortDir: merged.theme.sortDir || current.theme.sortDir || DEFAULT_THEME.sortDir,
            readingFilter: merged.theme.readingFilter || current.theme.readingFilter || DEFAULT_THEME.readingFilter,
            customWallpaperUrl: resolvedWallpaper,
          };
          // Only mutate CSS variables & React state when theme actually changed (prevents screen flicker!)
          if (JSON.stringify(mergedTheme) !== JSON.stringify(current.theme)) {
            setTheme(mergedTheme);
            applyThemeCssVars(mergedTheme);
            writeCachedTheme(mergedTheme);
            writeStoredShelfPrefs(mergedTheme, themeUpdatedAtRef.current || Date.now());
            await dbSetKV('theme', mergedTheme);
          }
          await dbSetKV('themeUpdatedAt', themeUpdatedAtRef.current);
        }
        if (
          merged.profile &&
          (forceRestore ||
            !profileUpdatedAtRef.current ||
            !isProfileCustomized(current.profile) ||
            (merged.profileUpdatedAt || 0) >= profileUpdatedAtRef.current)
        ) {
          const nextProfileTs =
            merged.profileUpdatedAt || (isProfileCustomized(merged.profile) ? profileUpdatedAtRef.current : 0);
          profileUpdatedAtRef.current = nextProfileTs;
          const mergedProfile = { ...DEFAULT_PROFILE, ...merged.profile };
          if (JSON.stringify(mergedProfile) !== JSON.stringify(current.profile)) {
            setProfile(mergedProfile);
            await dbSetKV('profile', mergedProfile);
          }
          await dbSetKV('profileUpdatedAt', profileUpdatedAtRef.current);
        }
        if (
          merged.lastActiveSession &&
          merged.lastActiveSession.deviceId !== current.deviceId &&
          merged.lastActiveSession.updatedAt > (localActiveSessionRef.current?.updatedAt || 0)
        ) {
          setRemoteActiveSession(merged.lastActiveSession);
        }

        // Sync Shared Reading Rooms & Shared Shelves across all of the user's own devices!
        const normCode = (c?: string) => String(c || '').trim().toUpperCase();
        if (
          Array.isArray(merged.sharedRooms) ||
          Array.isArray(merged.joinedRoomCodes) ||
          Array.isArray(merged.closedRoomCodes)
        ) {
          const nextClosedRooms = Array.from(
            new Set(
              [...closedRoomCodesRef.current, ...(merged.closedRoomCodes || [])]
                .map(normCode)
                .filter(Boolean)
            )
          ).slice(-100);
          closedRoomCodesRef.current = nextClosedRooms;
          await dbSetKV('closedRoomCodes', nextClosedRooms).catch(() => undefined);
          const closedRoomSet = new Set(nextClosedRooms);

          const roomMap = new Map<string, SharedRoom>();
          for (const r of current.sharedRooms) {
            const code = normCode(r?.code);
            if (code && !closedRoomSet.has(code)) roomMap.set(code, r);
          }
          for (const r of merged.sharedRooms || []) {
            const code = normCode(r?.code);
            if (!code || closedRoomSet.has(code)) continue;
            const prev = roomMap.get(code);
            if (!prev || (r.updatedAt || r.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
              roomMap.set(code, r);
            }
          }
          const nextRooms = Array.from(roomMap.values())
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
            .slice(0, 40);
          const nextJoinedCodes = Array.from(
            new Set(
              [
                ...joinedRoomCodesRef.current,
                ...(merged.joinedRoomCodes || []),
                ...nextRooms.map((r) => r.code),
              ]
                .map(normCode)
                .filter((c) => c && !closedRoomSet.has(c))
            )
          ).slice(0, 40);
          joinedRoomCodesRef.current = nextJoinedCodes;
          stateRef.current.sharedRooms = nextRooms;
          setSharedRooms(nextRooms);
          await Promise.all([
            dbSetKV('joinedRoomCodes', nextJoinedCodes).catch(() => undefined),
            dbSetKV('cachedSharedRooms', nextRooms).catch(() => undefined),
          ]);
        }

        if (
          Array.isArray(merged.sharedShelves) ||
          Array.isArray(merged.joinedShelfCodes) ||
          Array.isArray(merged.closedShelfCodes)
        ) {
          const nextClosedShelves = Array.from(
            new Set(
              [...closedShelfCodesRef.current, ...(merged.closedShelfCodes || [])]
                .map(normCode)
                .filter(Boolean)
            )
          ).slice(-100);
          closedShelfCodesRef.current = nextClosedShelves;
          await dbSetKV('closedShelfCodes', nextClosedShelves).catch(() => undefined);
          const closedShelfSet = new Set(nextClosedShelves);

          const shelfMap = new Map<string, SharedShelf>();
          for (const sh of current.sharedShelves) {
            const code = normCode(sh?.code);
            if (code && !closedShelfSet.has(code)) shelfMap.set(code, sh);
          }
          for (const sh of merged.sharedShelves || []) {
            const code = normCode(sh?.code);
            if (!code || closedShelfSet.has(code)) continue;
            const prev = shelfMap.get(code);
            if (!prev || (sh.updatedAt || sh.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
              shelfMap.set(code, sh);
            }
          }
          const nextShelves = Array.from(shelfMap.values())
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
            .slice(0, 40);
          const nextJoinedShelves = Array.from(
            new Set(
              [
                ...joinedShelfCodesRef.current,
                ...(merged.joinedShelfCodes || []),
                ...nextShelves.map((sh) => sh.code),
              ]
                .map(normCode)
                .filter((c) => c && !closedShelfSet.has(c))
            )
          ).slice(0, 40);
          joinedShelfCodesRef.current = nextJoinedShelves;
          stateRef.current.sharedShelves = nextShelves;
          setSharedShelves(nextShelves);
          await Promise.all([
            dbSetKV('joinedShelfCodes', nextJoinedShelves).catch(() => undefined),
            dbSetKV('cachedSharedShelves', nextShelves).catch(() => undefined),
          ]);
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
    (
      urgent = false,
      scope: 'books' | 'personalization' | 'marks' | 'notes' | 'chat' | 'shared' | 'all' = 'all'
    ) => {
      if (suppressAutoSyncRef.current && !urgent) return;
      if (scope === 'all') {
        dirtyScopesRef.current.add('books');
        dirtyScopesRef.current.add('personalization');
        dirtyScopesRef.current.add('marks');
        dirtyScopesRef.current.add('notes');
        dirtyScopesRef.current.add('chat');
        dirtyScopesRef.current.add('shared');
      } else {
        dirtyScopesRef.current.add(scope);
      }
      const cfg = stateRef.current.syncConfig;
      const driveAuth = stateRef.current.googleDriveAuth;
      if (!driveAuth?.accessToken && (cfg.liveSync === false || !cfg.serverUrl.trim())) return;
      if (autoSyncTimerRef.current) window.clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = window.setTimeout(async () => {
        autoSyncTimerRef.current = null;
        if (syncInFlightRef.current) {
          scheduleAutoSync(false);
          return;
        }
        const s = stateRef.current;
        const activeDrive = s.googleDriveAuth;
        if (!activeDrive?.accessToken && (s.syncConfig.liveSync === false || !s.syncConfig.serverUrl.trim())) {
          return;
        }

        syncInFlightRef.current = true;
        // Snapshot tombstones & dirty scopes before network call so mutations made during flight are NEVER lost!
        const sentBooks = [...deletedIdsRef.current];
        const sentBookmarks = [...deletedBookmarkIdsRef.current];
        const sentAnnotations = [...deletedAnnotationIdsRef.current];
        const sentNotes = [...deletedNoteIdsRef.current];
        const sentDesigns = [...deletedBookmarkDesignIdsRef.current];
        const sentChats = [...deletedChatSessionIdsRef.current];
        const scopes = new Set(dirtyScopesRef.current);

        try {
          const hasBaseline = syncedBookUpdatedAtRef.current.size > 0;
          const sendPersonalization = !hasBaseline || scopes.has('personalization');
          const sendMarks =
            !hasBaseline ||
            scopes.has('marks') ||
            sentBookmarks.length > 0 ||
            sentAnnotations.length > 0 ||
            sentDesigns.length > 0;
          const sendNotes = !hasBaseline || scopes.has('notes') || sentNotes.length > 0;
          const sendChat = !hasBaseline || scopes.has('chat') || sentChats.length > 0;
          const sendShared =
            !hasBaseline ||
            scopes.has('shared') ||
            s.sharedRooms.length > 0 ||
            s.sharedShelves.length > 0 ||
            closedRoomCodesRef.current.length > 0 ||
            closedShelfCodesRef.current.length > 0;

          const pushTheme =
            sendPersonalization && (themeUpdatedAtRef.current > 0 || isThemeCustomized(s.theme));
          const pushProfile =
            sendPersonalization && (profileUpdatedAtRef.current > 0 || isProfileCustomized(s.profile));
          const keepWallpaper = Boolean(
            s.theme.customWallpaperUrl &&
              s.theme.customWallpaperUrl === lastSyncedWallpaperRef.current
          );
          const syncableChats = sendChat
            ? s.chatSessions.filter((cs) => cs.messages.some((m) => m.sender === 'user'))
            : undefined;

          const booksToSend = hasBaseline
            ? scopes.has('books')
              ? s.books.filter((b) => {
                  if (b.isDemo) return false;
                  const syncedTs = syncedBookUpdatedAtRef.current.get(b.id);
                  if (syncedTs === undefined || (b.updatedAt || 0) > syncedTs) return true;
                  if (b.coverDataUrl) {
                    const confirmedSig = syncedCoverSigRef.current.get(b.id);
                    if (!confirmedSig || confirmedSig !== getCoverSignature(b.coverDataUrl)) return true;
                  }
                  return false;
                })
              : []
            : s.books;

          const keepCoverIds = new Set<string>();
          for (const b of booksToSend) {
            if (b.isDemo || !b.coverDataUrl) continue;
            const confirmedSig = syncedCoverSigRef.current.get(b.id);
            if (confirmedSig && confirmedSig === getCoverSignature(b.coverDataUrl)) {
              keepCoverIds.add(b.id);
            }
          }

          const syncPayloadData = {
            deviceId: s.deviceId,
            books: booksToSend,
            bookmarks: sendMarks ? s.bookmarks : undefined,
            annotations: sendMarks ? s.annotations : undefined,
            notes: sendNotes ? s.notes : undefined,
            chatSessions: syncableChats,
            customBookmarkDesigns: sendMarks ? s.customBookmarkDesigns : undefined,
            customStationery: sendMarks ? s.customStationery : undefined,
            categories: sendPersonalization ? s.categories : undefined,
            collections: sendPersonalization ? s.collections : undefined,
            readerSettings: sendPersonalization ? s.readerSettings : undefined,
            readerSettingsUpdatedAt: sendPersonalization ? readerSettingsUpdatedAtRef.current || 0 : 0,
            theme: pushTheme ? s.theme : null,
            themeUpdatedAt: pushTheme ? themeUpdatedAtRef.current || Date.now() : 0,
            profile: pushProfile ? s.profile : null,
            profileUpdatedAt: pushProfile ? profileUpdatedAtRef.current || Date.now() : 0,
            lastActiveSession: localActiveSessionRef.current,
            deletedBookIds: sentBooks,
            deletedBookmarkIds: sentBookmarks,
            deletedAnnotationIds: sentAnnotations,
            deletedNoteIds: sentNotes,
            deletedBookmarkDesignIds: sentDesigns,
            deletedChatSessionIds: sentChats,
            sharedRooms: sendShared ? s.sharedRooms : undefined,
            joinedRoomCodes: sendShared ? joinedRoomCodesRef.current : undefined,
            closedRoomCodes: sendShared ? closedRoomCodesRef.current : undefined,
            sharedShelves: sendShared ? s.sharedShelves : undefined,
            joinedShelfCodes: sendShared ? joinedShelfCodesRef.current : undefined,
            closedShelfCodes: sendShared ? closedShelfCodesRef.current : undefined,
          };

          let merged: RemoteSyncPayload;
          if (activeDrive?.accessToken) {
            const driveRes = await syncStateWithGoogleDrive(
              s.syncConfig,
              activeDrive,
              syncPayloadData,
              persistGoogleDriveAuth
            );
            merged = driveRes.merged;
            if (driveRes.modifiedTime) {
              lastDriveModifiedTimeRef.current = driveRes.modifiedTime;
            }
          } else {
            merged = await syncFullState(
              s.syncConfig,
              syncPayloadData,
              false,
              true,
              keepWallpaper,
              keepCoverIds,
              lastRemoteUpdatedAtRef.current
            );
          }

          for (const sc of scopes) dirtyScopesRef.current.delete(sc);

          const sentBookSet = new Set(sentBooks);
          const sentBmSet = new Set(sentBookmarks);
          const sentAnnSet = new Set(sentAnnotations);
          const sentNoteSet = new Set(sentNotes);
          const sentDesignSet = new Set(sentDesigns);
          const sentChatSet = new Set(sentChats);

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
          deletedChatSessionIdsRef.current = deletedChatSessionIdsRef.current.filter(
            (x) => !sentChatSet.has(x)
          );
          persistPendingTombstones();

          await applyRemotePayload(merged);
          setServerOnline(true);
          setSyncStatus('ok');
          const syncLabel =
            booksToSend.length > 0 && sendPersonalization
              ? `Libros (${booksToSend.length}) y personalización sincronizados`
              : sendPersonalization && booksToSend.length === 0 && !sentBooks.length
              ? 'Personalización sincronizada'
              : booksToSend.length > 0 || sentBooks.length > 0
              ? `Libros sincronizados (${booksToSend.length + sentBooks.length})`
              : `Sync en vivo (${Object.keys(merged.books || {}).length} títulos)`;
          setSyncMessage(syncLabel);

          // If new mutations/deletions arrived while this sync was in flight, flush them right away!
          if (
            dirtyScopesRef.current.size > 0 ||
            deletedIdsRef.current.length ||
            deletedBookmarkIdsRef.current.length ||
            deletedAnnotationIdsRef.current.length ||
            deletedNoteIdsRef.current.length ||
            deletedBookmarkDesignIdsRef.current.length ||
            deletedChatSessionIdsRef.current.length
          ) {
            scheduleAutoSync(true);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Error al sincronizar en segundo plano';
          if (isTransientNetworkError(err)) {
            console.warn('[KomoLib] Background auto-sync deferred (transient network):', msg);
          } else {
            setSyncStatus('error');
            setSyncMessage(msg);
          }
        } finally {
          syncInFlightRef.current = false;
        }
      }, urgent ? 280 : 1100);
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
        stateRef.current.theme = next;
        applyThemeCssVars(next);
        writeCachedTheme(next);
        writeStoredShelfPrefs(next, ts);
        dbSetKV('theme', next).catch(console.error);
        return next;
      });
      scheduleAutoSync(false, 'personalization');
    },
    [scheduleAutoSync]
  );

  const resetTheme = useCallback(() => {
    const ts = Date.now();
    themeUpdatedAtRef.current = ts;
    dbSetKV('themeUpdatedAt', ts).catch(console.error);
    setTheme((prev) => {
      const next: ThemeConfig = {
        ...DEFAULT_THEME,
        viewMode: prev.viewMode || DEFAULT_THEME.viewMode,
        sortBy: prev.sortBy || DEFAULT_THEME.sortBy,
        sortDir: prev.sortDir || DEFAULT_THEME.sortDir,
        readingFilter: prev.readingFilter || DEFAULT_THEME.readingFilter,
      };
      stateRef.current.theme = next;
      applyThemeCssVars(next);
      writeCachedTheme(next);
      writeStoredShelfPrefs(next, ts);
      dbSetKV('theme', next).catch(console.error);
      return next;
    });
    showToast('Tema restaurado a Komo Cream');
    scheduleAutoSync(false, 'personalization');
  }, [scheduleAutoSync, showToast]);

  const updateReaderSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      const ts = Date.now();
      readerSettingsUpdatedAtRef.current = ts;
      const next: ReaderSettings = { ...stateRef.current.readerSettings, ...patch };
      stateRef.current.readerSettings = next;
      setReaderSettings(next);
      writeCachedReaderSettings(next, ts);
      dbSetKV('readerSettings', next).catch(console.error);
      dbSetKV('readerSettingsUpdatedAt', ts).catch(console.error);
      scheduleAutoSync(false, 'personalization');
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
      scheduleAutoSync(false, 'personalization');
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
      scheduleAutoSync(false, 'personalization');
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
      scheduleAutoSync(false, 'personalization');
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
      scheduleAutoSync(false, 'personalization');
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
        skipDuplicates?: boolean;
        onProgress?: (done: number, total: number, currentName?: string) => void;
      }
    ): Promise<BookItem[]> => {
      if (!files.length) return [];
      const { supported } = filterSupportedFiles(files);
      if (!supported.length) {
        showToast('No se encontraron archivos compatibles en la selección');
        return [];
      }

      const skipDups = opts?.skipDuplicates !== false;
      const added: BookItem[] = [];
      const imageFiles = supported.filter((f) => isImageFile(f));
      const nonImageFiles = supported.filter((f) => !isImageFile(f));

      const normalizeMatch = (raw: string) =>
        raw
          .split(/[\\/]/)
          .pop()!
          .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx|zip|rar|mp3|m4b|m4a|jpe?g|png|webp|gif|avif|bmp)$/i, '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const existingWithoutFile = stateRef.current.books.filter((b) => !b.hasLocalFile && !b.isDemo);
      const existingFileNameKeys = new Set<string>();
      const existingTitleKeys = new Set<string>();
      for (const b of stateRef.current.books) {
        if (b.isDemo || !b.hasLocalFile) continue;
        const fk = normalizeMatch(b.fileName || '');
        const tk = normalizeMatch(b.title || '');
        if (fk) existingFileNameKeys.add(fk);
        if (tk) existingTitleKeys.add(tk);
      }

      const linkedExistingIds = new Set<string>();
      let linkedCount = 0;
      let failedCount = 0;
      let skippedDupCount = 0;
      const duplicateSamples: string[] = [];

      const recordDuplicate = (label: string) => {
        skippedDupCount++;
        if (duplicateSamples.length < 3 && label) {
          duplicateSamples.push(label);
        }
      };

      // Only auto-upload individual files sequentially for small batches (<= 20)
      // so importing 1,600+ books NEVER spawns 1,600 concurrent uploads or OOMs Android WebView!
      const uploadQueue: BookItem[] = [];
      const allowAutoUpload = nonImageFiles.length + (imageFiles.length > 0 ? 1 : 0) <= 20;

      const totalWork = nonImageFiles.length + (imageFiles.length > 0 ? (opts?.bundleImages ? 1 : imageFiles.length) : 0);
      let processedCount = 0;
      let pendingNewBatch: BookItem[] = [];
      const flushNewBatch = () => {
        if (!pendingNewBatch.length) return;
        const chunk = pendingNewBatch;
        pendingNewBatch = [];
        setBooks((prev) => [...chunk, ...prev]);
      };

      // Import all standard book/comic/audio files individually with anti-duplication & per-file error isolation!
      for (const f of nonImageFiles) {
        processedCount++;
        opts?.onProgress?.(processedCount, totalWork, f.name);
        try {
          const folder = getFolderPath(f);
          const fnKey = normalizeMatch(f.name);

          // Fast pre-check BEFORE heavy EPUB/PDF parsing if the filename already exists locally!
          const catalogMatchByName = existingWithoutFile.find(
            (ex) =>
              !linkedExistingIds.has(ex.id) &&
              fnKey &&
              (normalizeMatch(ex.fileName) === fnKey || normalizeMatch(ex.title) === fnKey)
          );
          if (skipDups && !catalogMatchByName && fnKey && (existingFileNameKeys.has(fnKey) || existingTitleKeys.has(fnKey))) {
            recordDuplicate(f.name.replace(/\.[^.]+$/, ''));
            if (processedCount % 25 === 0) {
              await new Promise((r) => setTimeout(r, 0));
            }
            continue;
          }

          const bundle = await importSingleFile(f, {
            title: nonImageFiles.length === 1 && imageFiles.length === 0 ? opts?.title : undefined,
            author: opts?.author,
            kind: opts?.kind,
            categories: opts?.categories,
          });
          if (folder) bundle.book.folderPath = folder;

          const titleKey = normalizeMatch(bundle.book.title);
          const existingMatch =
            catalogMatchByName ||
            existingWithoutFile.find(
              (ex) =>
                !linkedExistingIds.has(ex.id) &&
                ((fnKey && normalizeMatch(ex.fileName) === fnKey) ||
                  (titleKey && normalizeMatch(ex.title) === titleKey) ||
                  (fnKey && normalizeMatch(ex.title) === fnKey))
            );

          if (existingMatch) {
            linkedExistingIds.add(existingMatch.id);
            const mergedExisting: BookItem = {
              ...existingMatch,
              author:
                existingMatch.author &&
                existingMatch.author !== 'Autor desconocido' &&
                existingMatch.author !== 'Biblioteca Personal'
                  ? existingMatch.author
                  : bundle.book.author || existingMatch.author,
              description: existingMatch.description || bundle.book.description,
              format: bundle.book.format,
              fileName: bundle.book.fileName,
              fileSize: bundle.book.fileSize,
              mimeType: bundle.book.mimeType,
              folderPath: existingMatch.folderPath || bundle.book.folderPath,
              pageCount: bundle.book.pageCount ?? existingMatch.pageCount,
              coverDataUrl: isRasterCoverDataUrl(existingMatch.coverDataUrl)
                ? existingMatch.coverDataUrl
                : isRasterCoverDataUrl(bundle.book.coverDataUrl)
                ? bundle.book.coverDataUrl
                : existingMatch.coverDataUrl,
              hasOriginalCover:
                isRasterCoverDataUrl(existingMatch.coverDataUrl) ||
                isRasterCoverDataUrl(bundle.book.coverDataUrl),
              coverCheckedV2: true,
              coverCheckedV3: true,
              spineColor:
                !isRasterCoverDataUrl(existingMatch.coverDataUrl) &&
                isRasterCoverDataUrl(bundle.book.coverDataUrl)
                  ? bundle.book.spineColor
                  : existingMatch.spineColor,
              ribbonColor:
                !isRasterCoverDataUrl(existingMatch.coverDataUrl) &&
                isRasterCoverDataUrl(bundle.book.coverDataUrl)
                  ? bundle.book.ribbonColor
                  : existingMatch.ribbonColor,
              hasLocalFile: true,
              updatedAt: Date.now(),
            };
            await dbPutBook(mergedExisting);
            await dbPutBookFile(mergedExisting.id, bundle.blob, bundle.extraImages);
            setBooks((prev) => prev.map((b) => (b.id === mergedExisting.id ? mergedExisting : b)));
            linkedCount++;
            if (fnKey) existingFileNameKeys.add(fnKey);
            if (titleKey) existingTitleKeys.add(titleKey);
            if (allowAutoUpload) uploadQueue.push(mergedExisting);
          } else if (
            skipDups &&
            ((fnKey && existingFileNameKeys.has(fnKey)) || (titleKey && existingTitleKeys.has(titleKey)))
          ) {
            recordDuplicate(bundle.book.title || f.name);
          } else {
            await dbPutBook(bundle.book);
            await dbPutBookFile(bundle.book.id, bundle.blob, bundle.extraImages);
            added.push(bundle.book);
            pendingNewBatch.push(bundle.book);
            if (fnKey) existingFileNameKeys.add(fnKey);
            if (titleKey) existingTitleKeys.add(titleKey);
            if (allowAutoUpload) uploadQueue.push(bundle.book);
          }
        } catch (err) {
          failedCount++;
          console.warn('Error importando archivo individual:', f.name, err);
        }

        // Flush React state & yield every 10 files so WebView stays responsive and never OOMs!
        if (processedCount % 10 === 0) {
          flushNewBatch();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      flushNewBatch();

      // Import images (either grouped by folder / single bundle, or individually)
      if (imageFiles.length > 0) {
        if (opts?.bundleImages && imageFiles.length > 1) {
          const groups = groupImagesByFolder(imageFiles);
          for (const group of groups) {
            try {
              const groupTitle =
                groups.length === 1 && opts?.title
                  ? opts.title
                  : group.folderName || opts?.title || 'Volumen Ilustrado';
              const gKey = normalizeMatch(groupTitle);
              if (skipDups && gKey && existingTitleKeys.has(gKey)) {
                recordDuplicate(groupTitle);
                continue;
              }
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
              pendingNewBatch.push(bundle.book);
              if (gKey) existingTitleKeys.add(gKey);
              if (allowAutoUpload) uploadQueue.push(bundle.book);
            } catch {
              failedCount++;
            }
          }
          flushNewBatch();
        } else {
          for (const f of imageFiles) {
            processedCount++;
            opts?.onProgress?.(processedCount, totalWork, f.name);
            try {
              const fk = normalizeMatch(f.name);
              if (skipDups && fk && existingFileNameKeys.has(fk)) {
                recordDuplicate(f.name);
                continue;
              }
              const bundle = await importSingleFile(f, {
                title: supported.length === 1 ? opts?.title : undefined,
                author: opts?.author,
                kind: opts?.kind,
                categories: opts?.categories,
              });
              await dbPutBook(bundle.book);
              await dbPutBookFile(bundle.book.id, bundle.blob, bundle.extraImages);
              added.push(bundle.book);
              pendingNewBatch.push(bundle.book);
              if (fk) existingFileNameKeys.add(fk);
              if (allowAutoUpload) uploadQueue.push(bundle.book);
            } catch {
              failedCount++;
            }
            if (processedCount % 10 === 0) {
              flushNewBatch();
              await new Promise((r) => setTimeout(r, 0));
            }
          }
          flushNewBatch();
        }
      }

      // Sequential background upload for small imports (Google Drive OR Render cloud vault!)
      const cfg = stateRef.current.syncConfig;
      const activeDrive = stateRef.current.googleDriveAuth;
      if (uploadQueue.length > 0 && activeDrive?.accessToken) {
        (async () => {
          let curDrive = activeDrive;
          let uploadedAny = false;
          for (const targetBook of uploadQueue) {
            try {
              const up = await uploadBookFileToGoogleDrive(
                stateRef.current.syncConfig,
                curDrive,
                targetBook,
                persistGoogleDriveAuth
              );
              curDrive = up.auth;
              if (!up.ok) continue;
              uploadedAny = true;
              const nowTs = Date.now();
              setBooks((prev) =>
                prev.map((b) => {
                  if (b.id !== targetBook.id) return b;
                  const nextBook: BookItem = {
                    ...b,
                    hasRemoteFile: true,
                    driveFileId: up.driveFileId || b.driveFileId,
                    remoteFileName: up.remoteFileName || b.remoteFileName,
                    format: up.format || b.format,
                    updatedAt: nowTs,
                  };
                  dbPutBook(nextBook).catch(() => undefined);
                  return nextBook;
                })
              );
            } catch {
              // ignore individual upload failure
            }
          }
          if (uploadedAny) {
            scheduleAutoSync(false, 'books');
          }
        })();
      } else if (uploadQueue.length > 0 && (cfg.autoSync || cfg.liveSync) && cfg.serverUrl) {
        (async () => {
          for (const targetBook of uploadQueue) {
            try {
              const up = await uploadBookToServer(stateRef.current.syncConfig, targetBook, stateRef.current.deviceId);
              if (!up.ok) continue;
              setBooks((prev) =>
                prev.map((b) => {
                  if (b.id !== targetBook.id) return b;
                  const nextBook: BookItem = {
                    ...b,
                    hasRemoteFile: true,
                    remoteFileName: up.remoteFileName || b.remoteFileName,
                    format: up.format || b.format,
                  };
                  dbPutBook(nextBook).catch(() => undefined);
                  return nextBook;
                })
              );
            } catch {
              // ignore individual upload failure
            }
          }
        })();
      }

      const dupHint =
        skippedDupCount > 0
          ? ` · ${skippedDupCount} duplicado${skippedDupCount === 1 ? '' : 's'} omitido${skippedDupCount === 1 ? '' : 's'}`
          : '';
      const errHint = failedCount > 0 ? ` · ${failedCount} con error` : '';
      const sampleTxt = duplicateSamples.length > 0 ? ` (${duplicateSamples.join(', ')})` : '';

      if (added.length > 0 && linkedCount > 0) {
        showToast(`${added.length} añadidos, ${linkedCount} vinculados${dupHint}${errHint}`);
      } else if (linkedCount > 0) {
        showToast(
          `${linkedCount} archivo${linkedCount === 1 ? '' : 's'} vinculado${linkedCount === 1 ? '' : 's'}${dupHint}${errHint}`
        );
      } else if (added.length > 0) {
        showToast(
          added.length === 1 && !dupHint
            ? `"${added[0].title}" añadido a tu librería`
            : `${added.length} nuevo${added.length === 1 ? '' : 's'} añadido${added.length === 1 ? '' : 's'}${dupHint}${errHint}`
        );
      } else if (skippedDupCount > 0) {
        showToast(
          `Anti-duplicados: ${skippedDupCount} libro${skippedDupCount === 1 ? '' : 's'} ya estaba${skippedDupCount === 1 ? '' : 'n'} en tu biblioteca${sampleTxt}`
        );
      } else if (failedCount > 0) {
        showToast(`No se pudieron leer ${failedCount} archivos (revisa permisos o usa "Elegir carpeta")`);
      }
      scheduleAutoSync();
      return added;
    },
    [scheduleAutoSync, showToast]
  );

  const importNativeFolderBooks = useCallback(
    async (
      items: NativeScannedFolderBook[],
      opts?: { author?: string; kind?: ContentKind; categories?: string[]; finalizeSync?: boolean }
    ): Promise<{ added: number; linked: number; duplicatesSkipped: number; duplicateSamples: string[] }> => {
      if (!items.length) {
        if (opts?.finalizeSync) scheduleAutoSync();
        return { added: 0, linked: 0, duplicatesSkipped: 0, duplicateSamples: [] };
      }

      const normalizeMatch = (raw: string) =>
        raw
          .split(/[\\/]/)
          .pop()!
          .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx|zip|rar|mp3|m4b|m4a)$/i, '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const currentBooks = stateRef.current.books;
      const byUri = new Map<string, BookItem>();
      const byFileKey = new Map<string, BookItem>();
      const byTitleKey = new Map<string, BookItem>();
      for (const b of currentBooks) {
        if (b.isDemo) continue;
        if (b.nativeFileUri) byUri.set(b.nativeFileUri, b);
        const fk = normalizeMatch(b.fileName || '');
        if (fk && !byFileKey.has(fk)) byFileKey.set(fk, b);
        const tk = normalizeMatch(b.title || '');
        if (tk && !byTitleKey.has(tk)) byTitleKey.set(tk, b);
      }

      const newlyCreated: BookItem[] = [];
      const updatedMap = new Map<string, BookItem>();
      let linkedCount = 0;
      let duplicatesSkipped = 0;
      const duplicateSamples: string[] = [];
      const now = Date.now();

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const fmt = (it.format || 'epub') as BookItem['format'];
        const resolvedMeta = resolveBookTitleAndAuthor({
          fileName: it.fileName,
          folderPath: it.folderPath,
          metaTitle: it.title,
          metaAuthor: it.author,
        });
        const title = resolvedMeta.title;
        const author = opts?.author?.trim() || resolvedMeta.author;
        const kind: ContentKind =
          opts?.kind ||
          (fmt === 'audio'
            ? 'audiobook'
            : /manhwa|webtoon|manhua/i.test(`${it.folderPath || ''} ${it.fileName}`)
            ? 'manhwa'
            : fmt === 'cbz' || fmt === 'cbr' || /manga/i.test(`${it.folderPath || ''} ${it.fileName}`)
            ? 'manga'
            : 'book');

        const realCoverUrl = it.coverBase64 ? `data:image/jpeg;base64,${it.coverBase64}` : undefined;
        const fnKey = normalizeMatch(it.fileName);
        const titleKey = normalizeMatch(title);

        const existing =
          byUri.get(it.uri) ||
          (fnKey ? byFileKey.get(fnKey) : undefined) ||
          (titleKey ? byTitleKey.get(titleKey) : undefined);

        if (existing) {
          const wasMissingFile = !existing.hasLocalFile;
          const shouldUpgradeCover = Boolean(realCoverUrl) && !isRasterCoverDataUrl(existing.coverDataUrl);
          const needsUriUpdate = existing.nativeFileUri !== it.uri;

          if (wasMissingFile) {
            linkedCount++;
          } else {
            duplicatesSkipped++;
            if (duplicateSamples.length < 3) duplicateSamples.push(existing.title || title);
          }

          const shouldUpgradeMeta =
            (isGenericAuthor(existing.author) && !isGenericAuthor(author)) ||
            (existing.title !== title && /[-–—_]/.test(existing.title) && !/[-–—_]/.test(title));

          if (wasMissingFile || shouldUpgradeCover || needsUriUpdate || shouldUpgradeMeta) {
            const merged: BookItem = {
              ...existing,
              title: shouldUpgradeMeta ? title : existing.title,
              author:
                !isGenericAuthor(existing.author)
                  ? existing.author
                  : author,
              description: existing.description || it.description,
              format: fmt || existing.format,
              fileName: it.fileName || existing.fileName,
              fileSize: it.fileSize || existing.fileSize,
              mimeType: it.mimeType || existing.mimeType,
              folderPath: it.folderPath || existing.folderPath,
              pageCount: it.pageCount ?? existing.pageCount,
              coverDataUrl: shouldUpgradeCover && realCoverUrl ? realCoverUrl : existing.coverDataUrl,
              hasOriginalCover: shouldUpgradeCover ? true : existing.hasOriginalCover,
              coverCheckedV2: true,
              coverCheckedV3: true,
              hasLocalFile: true,
              nativeFileUri: it.uri,
              updatedAt: now + i,
            };
            await dbPutBook(merged);
            updatedMap.set(merged.id, merged);
            byUri.set(it.uri, merged);
          }
          continue;
        }

        const generated = generateCozyCover(title, author, kind, fmt);
        const hasOriginalCover = Boolean(realCoverUrl);
        const finalCover = realCoverUrl || generated.coverDataUrl;

        const defaultCats = new Set<string>(opts?.categories || []);
        defaultCats.add('new');
        if (kind === 'manga') defaultCats.add('manga');
        else if (kind === 'manhwa') defaultCats.add('manhwa');
        else if (kind === 'comic') defaultCats.add('comic');
        else if (kind === 'audiobook') defaultCats.add('audiobooks');
        else defaultCats.add('ebooks');

        const created: BookItem = {
          id: `book_${now}_${i}_${Math.random().toString(36).slice(2, 7)}`,
          title,
          author,
          description: it.description || '',
          format: fmt,
          kind,
          categories: Array.from(defaultCats),
          tags: [fmt.toUpperCase()],
          coverDataUrl: finalCover,
          hasOriginalCover,
          coverCheckedV2: true,
          coverCheckedV3: true,
          spineColor: generated.spineColor,
          ribbonColor: generated.ribbonColor,
          fileName: it.fileName,
          folderPath: it.folderPath,
          fileSize: it.fileSize || 0,
          mimeType: it.mimeType || 'application/octet-stream',
          pageCount: it.pageCount,
          progress: 0,
          favorite: false,
          wishlist: false,
          hasLocalFile: true,
          nativeFileUri: it.uri,
          addedAt: now + i,
          updatedAt: now + i,
        };
        await dbPutBook(created);
        newlyCreated.push(created);
        byUri.set(it.uri, created);
        if (fnKey) byFileKey.set(fnKey, created);
        if (titleKey) byTitleKey.set(titleKey, created);
      }

      if (newlyCreated.length > 0 || updatedMap.size > 0) {
        setBooks((prev) => {
          const next = updatedMap.size > 0 ? prev.map((b) => updatedMap.get(b.id) || b) : prev;
          return newlyCreated.length > 0 ? [...newlyCreated, ...next] : next;
        });
      }

      if (opts?.finalizeSync) {
        scheduleAutoSync();
      }
      return { added: newlyCreated.length, linked: linkedCount, duplicatesSkipped, duplicateSamples };
    },
    [scheduleAutoSync]
  );

  const duplicateBooksCount = React.useMemo(() => {
    const norm = (raw: string) =>
      raw
        .split(/[\\/]/)
        .pop()!
        .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx|zip|rar|mp3|m4b|m4a)$/i, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const seen = new Set<string>();
    let dups = 0;
    for (const b of books) {
      if (b.isDemo) continue;
      const key = norm(b.fileName || '') || norm(b.title || '');
      if (!key) continue;
      if (seen.has(key)) dups++;
      else seen.add(key);
    }
    return dups;
  }, [books]);

  const removeDuplicateBooks = useCallback(async (): Promise<number> => {
    const norm = (raw: string) =>
      raw
        .split(/[\\/]/)
        .pop()!
        .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx|zip|rar|mp3|m4b|m4a)$/i, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const current = stateRef.current;
    const groups = new Map<string, BookItem[]>();
    for (const b of current.books) {
      if (b.isDemo) continue;
      const key = norm(b.fileName || '') || norm(b.title || '');
      if (!key) continue;
      const arr = groups.get(key) || [];
      arr.push(b);
      groups.set(key, arr);
    }

    const scoreBook = (b: BookItem) =>
      (b.progress || 0) * 10 +
      (isRasterCoverDataUrl(b.coverDataUrl) ? 500 : 0) +
      (b.hasLocalFile ? 200 : 0) +
      (b.hasRemoteFile ? 80 : 0) +
      (b.favorite ? 40 : 0) +
      (b.lastReadAt ? 30 : 0);

    const idsToRemove = new Set<string>();
    const remapId = new Map<string, string>();
    const keptReplacements = new Map<string, BookItem>();

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => scoreBook(b) - scoreBook(a) || (a.addedAt || 0) - (b.addedAt || 0));
      const keeper = { ...sorted[0] };

      for (let i = 1; i < sorted.length; i++) {
        const dup = sorted[i];
        idsToRemove.add(dup.id);
        remapId.set(dup.id, keeper.id);

        // Merge any richer metadata from the duplicate into the keeper before deleting
        if (!isRasterCoverDataUrl(keeper.coverDataUrl) && isRasterCoverDataUrl(dup.coverDataUrl)) {
          keeper.coverDataUrl = dup.coverDataUrl;
          keeper.hasOriginalCover = true;
          keeper.spineColor = dup.spineColor;
          keeper.ribbonColor = dup.ribbonColor;
        }
        if ((dup.progress || 0) > (keeper.progress || 0)) {
          keeper.progress = dup.progress;
          keeper.currentPage = dup.currentPage ?? keeper.currentPage;
          keeper.currentCfi = dup.currentCfi || keeper.currentCfi;
          keeper.currentChapter = dup.currentChapter || keeper.currentChapter;
        }
        keeper.favorite = keeper.favorite || dup.favorite;
        keeper.wishlist = keeper.wishlist || dup.wishlist;
        keeper.hasLocalFile = keeper.hasLocalFile || dup.hasLocalFile;
        keeper.hasRemoteFile = keeper.hasRemoteFile || dup.hasRemoteFile;
        keeper.nativeFileUri = keeper.nativeFileUri || dup.nativeFileUri;
        keeper.folderPath = keeper.folderPath || dup.folderPath;
        keeper.lastReadAt = Math.max(keeper.lastReadAt || 0, dup.lastReadAt || 0) || undefined;
        keeper.finishedAt = keeper.finishedAt || dup.finishedAt;
        keeper.tags = Array.from(new Set([...(keeper.tags || []), ...(dup.tags || [])]));
        keeper.categories = Array.from(new Set([...(keeper.categories || []), ...(dup.categories || [])]));
        keeper.updatedAt = Date.now();
      }
      keptReplacements.set(keeper.id, keeper);
    }

    if (idsToRemove.size === 0) {
      showToast('No se encontraron libros duplicados en tu biblioteca');
      return 0;
    }

    // Reassign bookmarks/annotations/notes from removed duplicates to kept books
    const nextBookmarks = current.bookmarks.map((bm) => {
      const targetId = remapId.get(bm.bookId);
      if (!targetId) return bm;
      const updated = { ...bm, bookId: targetId };
      dbPutBookmark(updated).catch(() => undefined);
      return updated;
    });
    const nextAnnotations = current.annotations.map((ann) => {
      const targetId = remapId.get(ann.bookId);
      if (!targetId) return ann;
      const updated = { ...ann, bookId: targetId, updatedAt: Date.now() };
      dbPutAnnotation(updated).catch(() => undefined);
      return updated;
    });

    for (const keeper of keptReplacements.values()) {
      await dbPutBook(keeper);
    }
    for (const delId of idsToRemove) {
      await dbDeleteBook(delId).catch(() => undefined);
      if (!deletedIdsRef.current.includes(delId)) deletedIdsRef.current.push(delId);
    }
    persistPendingTombstones();

    setBooks((prev) =>
      prev
        .filter((b) => !idsToRemove.has(b.id))
        .map((b) => keptReplacements.get(b.id) || b)
    );
    setBookmarks(nextBookmarks);
    setAnnotations(nextAnnotations);
    showToast(`Limpieza completada: se eliminaron ${idsToRemove.size} libros duplicados (progresos y notas conservados)`);
    scheduleAutoSync(true);
    return idsToRemove.size;
  }, [persistPendingTombstones, scheduleAutoSync, showToast]);

  const updateBook = useCallback(
    async (id: string, patch: Partial<BookItem>) => {
      const now = Date.now();
      const applyBookPatch = (b: BookItem): BookItem => {
        const isReadingUpdate =
          patch.progress !== undefined ||
          patch.currentPage !== undefined ||
          patch.currentChapter !== undefined ||
          patch.currentCfi !== undefined ||
          patch.scrollRatio !== undefined ||
          patch.audioTime !== undefined ||
          patch.lastReadAt !== undefined;

        const enriched: Partial<BookItem> = { ...patch };

        if (isReadingUpdate) {
          if (enriched.lastReadAt === undefined) {
            enriched.lastReadAt = now;
          }
          const nextProgress = enriched.progress ?? b.progress ?? 0;
          if (!b.startedAt && !enriched.startedAt && (nextProgress > 0 || enriched.lastReadAt)) {
            enriched.startedAt = now;
          }

          // Detect chapter completion when advancing from a previous chapter to a new one
          if (
            enriched.currentChapter &&
            b.currentChapter &&
            enriched.currentChapter.trim() !== b.currentChapter.trim()
          ) {
            enriched.lastChapterFinishedAt = now;
            enriched.lastChapterFinishedTitle = b.currentChapter.trim();
          } else if (
            enriched.currentPage !== undefined &&
            (enriched.pageCount ?? b.pageCount) &&
            enriched.currentPage >= (enriched.pageCount ?? b.pageCount ?? 0) &&
            (b.currentPage ?? 0) < (enriched.pageCount ?? b.pageCount ?? 0)
          ) {
            enriched.lastChapterFinishedAt = now;
            enriched.lastChapterFinishedTitle =
              enriched.currentChapter || b.currentChapter || `Pág. ${enriched.currentPage}`;
          }

          // Detect book completion automatically when progress reaches >= 98%
          if (nextProgress >= 98) {
            if (!b.finishedAt || (b.progress || 0) < 98) {
              enriched.finishedAt = enriched.finishedAt ?? now;
            }
            if (!enriched.readingStatus && b.readingStatus !== 'completed') {
              enriched.readingStatus = 'completed';
            }
          } else if (
            nextProgress > 0 &&
            !enriched.readingStatus &&
            (!b.readingStatus || b.readingStatus === 'want_to_read')
          ) {
            enriched.readingStatus = 'reading';
          }
        }

        if (enriched.readingStatus === 'completed' && !b.finishedAt && !enriched.finishedAt) {
          enriched.finishedAt = now;
        }

        return { ...b, ...enriched, updatedAt: now };
      };

      const existing = stateRef.current.books.find((b) => b.id === id);
      const latestBook: BookItem | undefined = existing ? applyBookPatch(existing) : undefined;
      if (latestBook) {
        stateRef.current.books = stateRef.current.books.map((b) => (b.id === id ? latestBook : b));
        dbPutBook(latestBook).catch(console.error);
      }

      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          const updated = latestBook ? { ...b, ...latestBook } : applyBookPatch(b);
          if (!latestBook) dbPutBook(updated).catch(console.error);
          return updated;
        })
      );
      setActiveBook((curr) =>
        curr && curr.id === id ? (latestBook ? latestBook : { ...curr, ...patch, updatedAt: now }) : curr
      );

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
            const actorId = s.sharedUserId || s.deviceId;
            if (!currentBook || !actorId) return;
            const effectiveParticipantId =
              room.participants?.[actorId]
                ? actorId
                : room.participants?.[s.deviceId]
                ? s.deviceId
                : actorId;
            updateSharedRoomProgress(s.syncConfig, room.code, {
              participantId: effectiveParticipantId,
              name: s.profile.name,
              avatarEmoji: s.profile.avatarEmoji,
              avatarBg: s.profile.avatarBg,
              avatarImageUrl: s.profile.avatarImageUrl || '',
              progress: currentBook.progress || 0,
              currentPage: currentBook.currentPage,
              pageCount: currentBook.pageCount,
              readingStatus: currentBook.readingStatus,
            })
              .then((updatedRoom) => {
                setSharedRooms((prev) => {
                  const next = prev.map((r) => (r.code === updatedRoom.code ? updatedRoom : r));
                  stateRef.current.sharedRooms = next;
                  dbSetKV('cachedSharedRooms', next.slice(0, 40)).catch(() => undefined);
                  return next;
                });
              })
              .catch(() => undefined);
          }, 900);
        }
      }

      scheduleAutoSync(false, 'books');
    },
    [scheduleAutoSync]
  );

  const reExtractBookCover = useCallback(
    async (id: string): Promise<boolean> => {
      const target = books.find((b) => b.id === id);
      if (!target) return false;
      let fileRec = await dbGetBookFile(id);
      if (!fileRec && target.nativeFileUri) {
        const nativeBlob = await readNativeUriAsBlob(target.nativeFileUri, target.mimeType);
        if (nativeBlob) fileRec = { id, blob: nativeBlob };
      }
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
      if (extracted.coverDataUrl && isRasterCoverDataUrl(extracted.coverDataUrl)) {
        const pal = await extractCoverPaletteFromDataUrl(
          extracted.coverDataUrl,
          target.spineColor.startsWith('#') ? target.spineColor : '#4c6c8a',
          target.ribbonColor || '#f2ba59'
        );
        const patch: Partial<BookItem> = {
          coverDataUrl: extracted.coverDataUrl,
          hasOriginalCover: true,
          coverCheckedV2: true,
          coverCheckedV3: true,
          spineColor: pal.spineColor,
          ribbonColor: pal.ribbonColor,
        };
        await updateBook(id, patch);
        setEditingBook((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr));
        showToast('Portada original extraída correctamente');
        return true;
      }
      await updateBook(id, { hasOriginalCover: false, coverCheckedV2: true, coverCheckedV3: true });
      setEditingBook((curr) =>
        curr && curr.id === id
          ? { ...curr, hasOriginalCover: false, coverCheckedV2: true, coverCheckedV3: true }
          : curr
      );
      showToast('Este archivo no incluye portada; se activó la portada adaptable');
      return false;
    },
    [books, showToast, updateBook]
  );

  const identifyBookWithAI = useCallback(
    async (
      id: string,
      opts?: { silent?: boolean }
    ): Promise<{ title?: string; author?: string; description?: string } | null> => {
      const target = stateRef.current.books.find((b) => b.id === id);
      if (!target) return null;

      let textExcerpt = '';
      try {
        let fileRec = await dbGetBookFile(id);
        if (!fileRec && target.nativeFileUri) {
          const nativeBlob = await readNativeUriAsBlob(target.nativeFileUri, target.mimeType);
          if (nativeBlob) fileRec = { id, blob: nativeBlob };
        }
        if (fileRec?.blob) {
          textExcerpt = await extractBookOpeningExcerpt(fileRec.blob, target.format);
        }
      } catch {
        // continue with cover image & filename
      }

      const coverDataUrl =
        hasDisplayableOriginalCover(target) && isRasterCoverDataUrl(target.coverDataUrl)
          ? target.coverDataUrl
          : undefined;

      try {
        const res = await identifyBookWithAiApi(stateRef.current.syncConfig, {
          fileName: target.fileName,
          currentTitle: target.title,
          currentAuthor: target.author,
          currentDescription: target.description || '',
          coverDataUrl,
          textExcerpt,
        });

        const nextTitle = cleanTitleText(res.title);
        const nextAuthor = cleanAuthorName(res.author);
        const nextDesc = cleanSynopsisText(res.description);

        const patch: Partial<BookItem> = {};
        if (nextTitle && (isGenericTitle(target.title) || nextTitle !== target.title)) {
          patch.title = nextTitle;
        }
        if (nextAuthor && (isGenericAuthor(target.author) || nextAuthor !== target.author)) {
          patch.author = nextAuthor;
        }
        if (nextDesc) {
          patch.description = nextDesc;
        }

        if (Object.keys(patch).length > 0) {
          await updateBook(id, patch);
          setEditingBook((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr));
          if (!opts?.silent) {
            showToast('Título, autor y sinopsis actualizados con IA');
          }
          return {
            title: patch.title || target.title,
            author: patch.author || target.author,
            description: patch.description || target.description,
          };
        }

        if (!opts?.silent) {
          showToast('La IA no encontró datos adicionales para este libro');
        }
        return null;
      } catch (err) {
        if (!opts?.silent) {
          showToast(
            err instanceof Error
              ? err.message
              : 'No se pudo conectar con la IA para analizar el libro'
          );
        }
        return null;
      }
    },
    [showToast, updateBook]
  );

  const deleteBook = useCallback(
    async (id: string) => {
      const victim = stateRef.current.books.find((b) => b.id === id);
      await dbDeleteBook(id);
      if (!deletedIdsRef.current.includes(id)) deletedIdsRef.current.push(id);
      persistPendingTombstones();
      setBooks((prev) => prev.filter((b) => b.id !== id));
      if (activeBook?.id === id) setActiveBook(null);
      if (editingBook?.id === id) setEditingBook(null);
      if (stateRef.current.googleDriveAuth?.accessToken) {
        deleteBookFileFromGoogleDrive(
          stateRef.current.syncConfig,
          stateRef.current.googleDriveAuth,
          { id, driveFileId: victim?.driveFileId },
          persistGoogleDriveAuth
        ).catch(() => undefined);
      } else if (syncConfig.autoSync && syncConfig.serverUrl) {
        deleteBookFromServer(syncConfig, id).catch(() => undefined);
      }
      showToast('Título eliminado');
      scheduleAutoSync(true, 'books');
    },
    [activeBook, editingBook, persistPendingTombstones, scheduleAutoSync, showToast, syncConfig]
  );

  const attachLocalFileToBook = useCallback(
    async (bookId: string, file: File): Promise<BookItem | null> => {
      const target = stateRef.current.books.find((b) => b.id === bookId);
      if (!target) return null;
      const bundle = await importSingleFile(file, {
        title: target.title,
        author:
          target.author &&
          target.author !== 'Autor desconocido' &&
          target.author !== 'Biblioteca Personal'
            ? target.author
            : undefined,
        kind: target.kind,
        categories: target.categories,
      });

      const updated: BookItem = {
        ...target,
        author:
          target.author &&
          target.author !== 'Autor desconocido' &&
          target.author !== 'Biblioteca Personal'
            ? target.author
            : bundle.book.author || target.author,
        description: target.description || bundle.book.description,
        format: bundle.book.format,
        fileName: file.name || target.fileName,
        fileSize: file.size,
        mimeType: file.type || bundle.book.mimeType,
        pageCount: bundle.book.pageCount ?? target.pageCount,
        coverDataUrl: isRasterCoverDataUrl(target.coverDataUrl)
          ? target.coverDataUrl
          : isRasterCoverDataUrl(bundle.book.coverDataUrl)
          ? bundle.book.coverDataUrl
          : target.coverDataUrl,
        hasOriginalCover:
          isRasterCoverDataUrl(target.coverDataUrl) ||
          isRasterCoverDataUrl(bundle.book.coverDataUrl),
        coverCheckedV2: true,
        coverCheckedV3: true,
        spineColor:
          !isRasterCoverDataUrl(target.coverDataUrl) && isRasterCoverDataUrl(bundle.book.coverDataUrl)
            ? bundle.book.spineColor
            : target.spineColor,
        ribbonColor:
          !isRasterCoverDataUrl(target.coverDataUrl) && isRasterCoverDataUrl(bundle.book.coverDataUrl)
            ? bundle.book.ribbonColor
            : target.ribbonColor,
        hasLocalFile: true,
        updatedAt: Date.now(),
      };

      await dbPutBook(updated);
      await dbPutBookFile(updated.id, bundle.blob, bundle.extraImages);
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));

      const cfg = stateRef.current.syncConfig;
      const driveAuth = stateRef.current.googleDriveAuth;
      if (driveAuth?.accessToken) {
        uploadBookFileToGoogleDrive(cfg, driveAuth, updated, persistGoogleDriveAuth)
          .then((up) => {
            if (!up.ok) return;
            const synced: BookItem = {
              ...updated,
              hasRemoteFile: true,
              driveFileId: up.driveFileId || updated.driveFileId,
              remoteFileName: up.remoteFileName || updated.remoteFileName,
              format: up.format || updated.format,
            };
            dbPutBook(synced).catch(() => undefined);
            setBooks((prev) => prev.map((b) => (b.id === synced.id ? synced : b)));
          })
          .catch(() => undefined);
      } else if ((cfg.autoSync || cfg.liveSync) && cfg.serverUrl) {
        uploadBookToServer(cfg, updated, stateRef.current.deviceId)
          .then((up) => {
            if (!up.ok) return;
            const synced: BookItem = {
              ...updated,
              hasRemoteFile: true,
              remoteFileName: up.remoteFileName || updated.remoteFileName,
              format: up.format || updated.format,
            };
            dbPutBook(synced).catch(() => undefined);
            setBooks((prev) => prev.map((b) => (b.id === synced.id ? synced : b)));
          })
          .catch(() => undefined);
      }

      scheduleAutoSync(false, 'books');
      showToast(`"${updated.title}" guardado offline en este dispositivo`);
      return updated;
    },
    [scheduleAutoSync, showToast]
  );

  const openBook = useCallback(
    async (book: BookItem) => {
      // 1. Check local IndexedDB first (100% offline!)
      let fileRecord = await dbGetBookFile(book.id);

      // 1b. If imported via Android native folder (SAF), stream directly from persistent URI (100% offline!)
      if (!fileRecord && book.nativeFileUri) {
        const nativeBlob = await readNativeUriAsBlob(book.nativeFileUri, book.mimeType);
        if (nativeBlob) {
          fileRecord = { id: book.id, blob: nativeBlob };
        }
      }

      // 2. If not stored locally yet, try downloading from user's Google Drive first, then Render cloud vault
      const cfg = stateRef.current.syncConfig;
      const driveAuth = stateRef.current.googleDriveAuth;
      const canTryCloud =
        Boolean(driveAuth?.accessToken) ||
        (Boolean(cfg.serverUrl?.trim()) &&
          (book.hasRemoteFile || Boolean(cfg.accountEmail) || Boolean(cfg.liveSync)));

      if (!fileRecord && canTryCloud) {
        try {
          showToast(
            driveAuth?.accessToken
              ? `Descargando "${book.title}" desde tu Google Drive...`
              : `Descargando "${book.title}" para leer sin internet...`
          );
          let blob: Blob | null = null;
          let resolvedDriveId = book.driveFileId;
          if (driveAuth?.accessToken) {
            try {
              const dl = await downloadBookFileFromGoogleDrive(
                cfg,
                driveAuth,
                book,
                persistGoogleDriveAuth
              );
              blob = dl.blob;
              resolvedDriveId = dl.driveFileId;
            } catch {
              // Fallback to Render server if available
            }
          }
          if (!blob && cfg.serverUrl?.trim()) {
            blob = await downloadBookFromServer(cfg, book);
          }
          if (!blob) throw new Error('Archivo no disponible');
          fileRecord = { id: book.id, blob };
          await updateBook(book.id, {
            hasLocalFile: true,
            hasRemoteFile: true,
            driveFileId: resolvedDriveId,
          });
          // Extract cover AND repair missing/swapped title/author from the freshly downloaded file!
          const needsCover = !hasDisplayableOriginalCover(book) && book.hasOriginalCover !== false;
          const needsMeta =
            isGenericAuthor(book.author) ||
            /[-–—|]/.test(book.title) ||
            book.title.toLowerCase().endsWith(`.${book.format}`);
          if (needsCover || needsMeta) {
            extractOriginalCoverFromBlob(blob, book.format, book.title)
              .then(async (ext) => {
                const patch: Partial<BookItem> = {};
                if (needsCover && ext.coverDataUrl && isRasterCoverDataUrl(ext.coverDataUrl)) {
                  const pal = await extractCoverPaletteFromDataUrl(
                    ext.coverDataUrl,
                    book.spineColor.startsWith('#') ? book.spineColor : '#4c6c8a',
                    book.ribbonColor || '#f2ba59'
                  );
                  patch.coverDataUrl = ext.coverDataUrl;
                  patch.hasOriginalCover = true;
                  patch.coverCheckedV2 = true;
                  patch.coverCheckedV3 = true;
                  patch.spineColor = pal.spineColor;
                  patch.ribbonColor = pal.ribbonColor;
                }
                if (needsMeta) {
                  const resolved = resolveBookTitleAndAuthor({
                    fileName: book.fileName || `${book.title}.${book.format}`,
                    folderPath: book.folderPath,
                    metaTitle: ext.title || book.title,
                    metaAuthor: ext.author || (isGenericAuthor(book.author) ? undefined : book.author),
                  });
                  if (resolved.title && resolved.title !== book.title) {
                    patch.title = resolved.title;
                  }
                  if (!isGenericAuthor(resolved.author) && resolved.author !== book.author) {
                    patch.author = resolved.author;
                  }
                }
                if (Object.keys(patch).length > 0) {
                  await updateBook(book.id, patch);
                }
              })
              .catch(() => undefined);
          }
        } catch {
          // Will fall through to MissingFileModal so user can retry or link local file
        }
      }

      if (!fileRecord) {
        setMissingFileBook(book);
        return;
      }

      const openedAt = Date.now();
      await updateBook(book.id, {
        startedAt: book.startedAt || openedAt,
        lastReadAt: openedAt,
      });

      if (book.format === 'audio') {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        const url = URL.createObjectURL(fileRecord.blob);
        setAudioBook(book);
        setAudioUrl(url);
        return;
      }

      // Respect user's chosen comic/manga reading mode & always open the freshest book snapshot
      const freshestBook = stateRef.current.books.find((b) => b.id === book.id) || book;
      setActiveBook(freshestBook);
    },
    [audioUrl, showToast, updateBook, updateReaderSettings]
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

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: `msg_${now}_u`,
        sender: 'user',
        text,
        createdAt: now,
      };

      const targetSessionId =
        stateRef.current.activeChatSessionId || stateRef.current.chatSessions[0]?.id || '';
      const activeSessionSnapshot =
        stateRef.current.chatSessions.find((s) => s.id === targetSessionId) ||
        stateRef.current.chatSessions[0];
      const historyBefore = activeSessionSnapshot ? activeSessionSnapshot.messages : chatMessages;

      const appendMessages = (msgs: ChatMessage[], syncAfter = false) => {
        setChatSessions((prev) => {
          const ts = Date.now();
          let found = false;
          const updated = prev.map((session) => {
            if (session.id !== targetSessionId && !(prev.length === 1 && !targetSessionId)) {
              return session;
            }
            found = true;
            const nextMsgs = [...session.messages, ...msgs].slice(-120);
            return {
              ...session,
              title: deriveChatSessionTitle(nextMsgs),
              messages: nextMsgs,
              updatedAt: ts,
            };
          });

          let nextSessions = updated;
          if (!found) {
            const created = createFreshChatSession([...INITIAL_CHAT_MESSAGES, ...msgs]);
            nextSessions = [created, ...prev];
            setActiveChatSessionId(created.id);
            dbSetKV('activeChatSessionId', created.id).catch(console.error);
          }

          const sorted = [...nextSessions]
            .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
            .slice(0, 60);
          dbSetKV('chatSessions', sorted).catch(console.error);
          const activeNow = sorted.find((cs) => cs.id === targetSessionId) || sorted[0];
          if (activeNow) {
            dbSetKV('chatMessages', activeNow.messages).catch(console.error);
          }
          return sorted;
        });
        if (syncAfter) {
          scheduleAutoSync();
        }
      };

      appendMessages([userMsg], false);

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
          appendMessages(
            [
              {
                id: `msg_${Date.now()}_a`,
                sender: 'assistant',
                text: `Listo ✨ Guardé tu nota en "${targetBook.title}". Puedes verla en la pestaña Notas.`,
                bookIds: [targetBook.id],
                createdAt: Date.now(),
              },
            ],
            true
          );
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
            appendMessages(
              [
                {
                  id: `msg_${Date.now()}_a`,
                  sender: 'assistant',
                  text: String(reply),
                  createdAt: Date.now(),
                },
              ],
              true
            );
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
          history: historyBefore.slice(-8).map((m) => ({ sender: m.sender, text: m.text })),
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
          appendMessages(
            [
              {
                id: `msg_${Date.now()}_a`,
                sender: 'assistant',
                text: aiRes.reply,
                bookIds: aiRes.matchedBookIds?.length ? aiRes.matchedBookIds : undefined,
                createdAt: Date.now(),
              },
            ],
            true
          );
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

      appendMessages(
        [
          {
            id: `msg_${Date.now()}_a`,
            sender: 'assistant',
            text: replyText,
            bookIds: matched.slice(0, 4).map((b) => b.id),
            createdAt: Date.now(),
          },
        ],
        true
      );
    },
    [activeBook, addNote, annotations, books, chatMessages, notes, profile.name, scheduleAutoSync, syncConfig]
  );

  const startNewChatSession = useCallback(() => {
    const current = stateRef.current.chatSessions;
    const active =
      current.find((s) => s.id === stateRef.current.activeChatSessionId) || current[0];
    if (active && !active.messages.some((m) => m.sender === 'user')) {
      return;
    }
    const fresh = createFreshChatSession(INITIAL_CHAT_MESSAGES);
    const next = [fresh, ...current].slice(0, 60);
    setChatSessions(next);
    setActiveChatSessionId(fresh.id);
    dbSetKV('chatSessions', next).catch(console.error);
    dbSetKV('activeChatSessionId', fresh.id).catch(console.error);
    dbSetKV('chatMessages', fresh.messages).catch(console.error);
  }, []);

  const selectChatSession = useCallback((id: string) => {
    const found = stateRef.current.chatSessions.find((s) => s.id === id);
    if (!found) return;
    setActiveChatSessionId(found.id);
    dbSetKV('activeChatSessionId', found.id).catch(console.error);
    dbSetKV('chatMessages', found.messages).catch(console.error);
  }, []);

  const deleteChatSession = useCallback(
    (id: string) => {
      if (!deletedChatSessionIdsRef.current.includes(id)) {
        deletedChatSessionIdsRef.current.push(id);
      }
      persistPendingTombstones();
      setChatSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        const next =
          remaining.length > 0 ? remaining : [createFreshChatSession(INITIAL_CHAT_MESSAGES)];
        if (stateRef.current.activeChatSessionId === id || !next.some((s) => s.id === stateRef.current.activeChatSessionId)) {
          const nextActive = next[0];
          setActiveChatSessionId(nextActive.id);
          dbSetKV('activeChatSessionId', nextActive.id).catch(console.error);
          dbSetKV('chatMessages', nextActive.messages).catch(console.error);
        }
        dbSetKV('chatSessions', next).catch(console.error);
        return next;
      });
      scheduleAutoSync(true);
    },
    [persistPendingTombstones, scheduleAutoSync]
  );

  const clearChat = useCallback(() => {
    const activeId =
      stateRef.current.activeChatSessionId || stateRef.current.chatSessions[0]?.id;
    if (!activeId) return;
    deleteChatSession(activeId);
  }, [deleteChatSession]);

  const triggerSync = useCallback(
    async (silent = false) => {
      const cfg = stateRef.current.syncConfig;
      const activeDrive = stateRef.current.googleDriveAuth;
      if (!activeDrive?.accessToken && !cfg.serverUrl.trim()) {
        if (!silent) {
          setSyncStatus('error');
          setSyncMessage('Conecta Google Drive o configura la URL del servidor primero');
        }
        return;
      }
      // Wait briefly if a background auto-sync is in flight so two sync calls never clobber each other
      if (syncInFlightRef.current) {
        if (silent) return;
        for (let i = 0; i < 20 && syncInFlightRef.current; i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (syncInFlightRef.current) return;
      }
      syncInFlightRef.current = true;
      if (!silent) {
        setSyncStatus('syncing');
        setSyncMessage('Sincronizando con Google Drive...');
        showSyncPopupProgress(
          10,
          activeDrive?.accessToken ? 'Conectando con Google Drive...' : 'Conectando con tu nube...',
          'Sincronizando biblioteca'
        );
      }
      try {
        const s = stateRef.current;
        const sentBooks = [...deletedIdsRef.current];
        const sentBookmarks = [...deletedBookmarkIdsRef.current];
        const sentAnnotations = [...deletedAnnotationIdsRef.current];
        const sentNotes = [...deletedNoteIdsRef.current];
        const sentDesigns = [...deletedBookmarkDesignIdsRef.current];
        const sentChats = [...deletedChatSessionIdsRef.current];
        const scopes = new Set(dirtyScopesRef.current);

        const hasBaseline = syncedBookUpdatedAtRef.current.size > 0;
        const sendPersonalization = !hasBaseline || scopes.has('personalization');
        const sendMarks =
          !hasBaseline ||
          scopes.has('marks') ||
          sentBookmarks.length > 0 ||
          sentAnnotations.length > 0 ||
          sentDesigns.length > 0;
        const sendNotes = !hasBaseline || scopes.has('notes') || sentNotes.length > 0;
        const sendChat = !hasBaseline || scopes.has('chat') || sentChats.length > 0;
        const sendShared =
          !hasBaseline ||
          scopes.has('shared') ||
          s.sharedRooms.length > 0 ||
          s.sharedShelves.length > 0 ||
          closedRoomCodesRef.current.length > 0 ||
          closedShelfCodesRef.current.length > 0;

        const pushTheme =
          sendPersonalization && (themeUpdatedAtRef.current > 0 || isThemeCustomized(s.theme));
        const pushProfile =
          sendPersonalization && (profileUpdatedAtRef.current > 0 || isProfileCustomized(s.profile));
        const syncableChats = sendChat
          ? s.chatSessions.filter((cs) => cs.messages.some((m) => m.sender === 'user'))
          : undefined;

        const booksToSend = hasBaseline
          ? s.books.filter((b) => {
              if (b.isDemo) return false;
              const syncedTs = syncedBookUpdatedAtRef.current.get(b.id);
              if (syncedTs === undefined || (b.updatedAt || 0) > syncedTs) return true;
              if (b.coverDataUrl) {
                const confirmedSig = syncedCoverSigRef.current.get(b.id);
                if (!confirmedSig || confirmedSig !== getCoverSignature(b.coverDataUrl)) return true;
              }
              return false;
            })
          : s.books;

        if (!silent) {
          const progressLabel =
            booksToSend.length > 0 && sendPersonalization
              ? `Guardando ${booksToSend.length} libro(s) y personalización...`
              : sendPersonalization && booksToSend.length === 0 && !sentBooks.length
              ? 'Guardando personalización...'
              : booksToSend.length > 0 || sentBooks.length > 0
              ? `Guardando cambios de ${booksToSend.length + sentBooks.length} libro(s)...`
              : 'Sincronizando cambios...';
          setSyncMessage(progressLabel);
        }

        const keepCoverIds = new Set<string>();
        for (const b of booksToSend) {
          if (b.isDemo || !b.coverDataUrl) continue;
          const confirmedSig = syncedCoverSigRef.current.get(b.id);
          if (confirmedSig && confirmedSig === getCoverSignature(b.coverDataUrl)) {
            keepCoverIds.add(b.id);
          }
        }
        const keepWallpaper =
          Boolean(s.theme.customWallpaperUrl) &&
          s.theme.customWallpaperUrl === lastSyncedWallpaperRef.current;

        const triggerPayloadData = {
          deviceId: s.deviceId,
          books: booksToSend,
          bookmarks: sendMarks ? s.bookmarks : undefined,
          annotations: sendMarks ? s.annotations : undefined,
          notes: sendNotes ? s.notes : undefined,
          chatSessions: syncableChats,
          customBookmarkDesigns: sendMarks ? s.customBookmarkDesigns : undefined,
          customStationery: sendMarks ? s.customStationery : undefined,
          categories: sendPersonalization ? s.categories : undefined,
          collections: sendPersonalization ? s.collections : undefined,
          readerSettings: sendPersonalization ? s.readerSettings : undefined,
          readerSettingsUpdatedAt: sendPersonalization ? readerSettingsUpdatedAtRef.current || 0 : 0,
          theme: pushTheme ? s.theme : null,
          themeUpdatedAt: pushTheme ? themeUpdatedAtRef.current || Date.now() : 0,
          profile: pushProfile ? s.profile : null,
          profileUpdatedAt: pushProfile ? profileUpdatedAtRef.current || Date.now() : 0,
          lastActiveSession: localActiveSessionRef.current,
          deletedBookIds: sentBooks,
          deletedBookmarkIds: sentBookmarks,
          deletedAnnotationIds: sentAnnotations,
          deletedNoteIds: sentNotes,
          deletedBookmarkDesignIds: sentDesigns,
          deletedChatSessionIds: sentChats,
          sharedRooms: sendShared ? s.sharedRooms : undefined,
          joinedRoomCodes: sendShared ? joinedRoomCodesRef.current : undefined,
          closedRoomCodes: sendShared ? closedRoomCodesRef.current : undefined,
          sharedShelves: sendShared ? s.sharedShelves : undefined,
          joinedShelfCodes: sendShared ? joinedShelfCodesRef.current : undefined,
          closedShelfCodes: sendShared ? closedShelfCodesRef.current : undefined,
        };

        let merged: RemoteSyncPayload;
        const noLocalChanges =
          hasBaseline &&
          scopes.size === 0 &&
          booksToSend.length === 0 &&
          sentBooks.length === 0 &&
          sentBookmarks.length === 0 &&
          sentAnnotations.length === 0 &&
          sentNotes.length === 0 &&
          sentDesigns.length === 0 &&
          sentChats.length === 0 &&
          closedRoomCodesRef.current.length === 0 &&
          closedShelfCodesRef.current.length === 0;

        if (activeDrive?.accessToken) {
          const driveRes = await syncStateWithGoogleDrive(
            cfg,
            activeDrive,
            triggerPayloadData,
            persistGoogleDriveAuth,
            silent ? undefined : (pct, detail) => showSyncPopupProgress(pct, detail, 'Sincronizando con Google Drive'),
            noLocalChanges
          );
          merged = driveRes.merged;
          if (driveRes.modifiedTime) {
            lastDriveModifiedTimeRef.current = driveRes.modifiedTime;
          }
        } else {
          if (!silent) showSyncPopupProgress(45, 'Enviando y combinando datos...');
          merged = await syncFullState(
            cfg,
            triggerPayloadData,
            false,
            keepCoverIds.size > 0,
            keepWallpaper,
            keepCoverIds,
            lastRemoteUpdatedAtRef.current
          );
          if (!silent) showSyncPopupProgress(85, 'Aplicando datos sincronizados...');
        }

        for (const sc of scopes) dirtyScopesRef.current.delete(sc);

        const sentBookSet = new Set(sentBooks);
        const sentBmSet = new Set(sentBookmarks);
        const sentAnnSet = new Set(sentAnnotations);
        const sentNoteSet = new Set(sentNotes);
        const sentDesignSet = new Set(sentDesigns);
        const sentChatSet = new Set(sentChats);

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
        deletedChatSessionIdsRef.current = deletedChatSessionIdsRef.current.filter(
          (x) => !sentChatSet.has(x)
        );
        persistPendingTombstones();

        const nextBooks = await applyRemotePayload(merged);
        const now = Date.now();
        updateSyncConfig({ lastSyncedAt: now });
        setServerOnline(true);
        setSyncStatus('ok');
        const doneMsg = activeDrive?.accessToken
          ? `Google Drive sincronizado (${nextBooks.length} títulos)`
          : `Sincronizado (${nextBooks.length} títulos)`;
        setSyncMessage(doneMsg);
        if (!silent) {
          completeSyncPopup(
            'Tu biblioteca, progreso y personalización ya están al día.',
            `${nextBooks.length} títulos · ${activeDrive?.accessToken ? 'Google Drive' : 'Nube'}`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'No se pudo conectar con la nube';
        if (!silent) {
          setSyncStatus('error');
          setSyncMessage(errMsg);
          failSyncPopup(errMsg);
        }
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [
      applyRemotePayload,
      completeSyncPopup,
      failSyncPopup,
      persistPendingTombstones,
      showSyncPopupProgress,
      showToast,
      updateSyncConfig,
    ]
  );

  /**
   * Bidirectional offline file sync for Tablet <-> Phone:
   * 1) Uploads ALL local book files from this device to your private cloud vault.
   * 2) Downloads ALL missing cloud book files into THIS device's local IndexedDB
   *    so every book can be read 100% offline with zero internet!
   */
  const syncAllBookFilesForOffline = useCallback(async (): Promise<{
    uploaded: number;
    downloaded: number;
    failed: number;
  }> => {
    const cfg = stateRef.current.syncConfig;
    let activeDrive = stateRef.current.googleDriveAuth;
    const useDrive = Boolean(activeDrive?.accessToken);
    if (!useDrive && (!cfg.serverUrl.trim() || !cfg.accountEmail)) {
      showToast('Conecta primero Google Drive o tu correo en la nube para sincronizar archivos');
      return { uploaded: 0, downloaded: 0, failed: 0 };
    }

    let uploaded = 0;
    let downloaded = 0;
    let failed = 0;

    const initLabel = useDrive
      ? 'Conectando con tu carpeta Komolib/Libros en Google Drive...'
      : 'Conectando con tu bóveda en la nube...';
    setOfflineSyncProgress(initLabel);
    showSyncPopupProgress(5, initLabel, 'Sincronizando libros offline');
    try {
      await triggerSync(true);

      const currentBooks = stateRef.current.books.filter((b) => !b.isDemo);
      const localBooksToUpload: BookItem[] = [];
      const missingLocalBooks: BookItem[] = [];

      for (const b of currentBooks) {
        const rec = await dbGetBookFile(b.id);
        if (rec || b.nativeFileUri) {
          // Skip books that are already confirmed uploaded in Drive / cloud!
          const alreadyUploaded = useDrive ? Boolean(b.driveFileId && b.hasRemoteFile) : Boolean(b.hasRemoteFile);
          if (!alreadyUploaded) {
            localBooksToUpload.push(b);
          }
        } else {
          missingLocalBooks.push(b);
        }
      }

      const totalSteps = Math.max(1, localBooksToUpload.length + missingLocalBooks.length);
      let completedSteps = 0;

      // Step 1: Upload only local book files not yet in Google Drive (or Render fallback)
      for (let i = 0; i < localBooksToUpload.length; i++) {
        const b = localBooksToUpload[i];
        const stepLabel = `${useDrive ? 'Subiendo a Drive' : 'Subiendo a la nube'} (${i + 1}/${localBooksToUpload.length}): ${b.title}`;
        setOfflineSyncProgress(stepLabel);
        showSyncPopupProgress(
          10 + Math.round((completedSteps / totalSteps) * 80),
          stepLabel,
          'Sincronizando libros offline'
        );
        try {
          if (useDrive && activeDrive) {
            const up = await uploadBookFileToGoogleDrive(
              cfg,
              activeDrive,
              b,
              persistGoogleDriveAuth
            );
            activeDrive = up.auth;
            if (up.ok) {
              uploaded++;
              const patched: BookItem = {
                ...b,
                hasLocalFile: true,
                hasRemoteFile: true,
                driveFileId: up.driveFileId || b.driveFileId,
                remoteFileName: up.remoteFileName || b.remoteFileName,
                format: up.format || b.format,
                updatedAt: Date.now(),
              };
              await dbPutBook(patched);
              setBooks((prev) => prev.map((x) => (x.id === b.id ? patched : x)));
            } else {
              failed++;
            }
          } else {
            const up = await uploadBookToServer(cfg, b, stateRef.current.deviceId);
            if (up.ok) {
              uploaded++;
              const patched: BookItem = {
                ...b,
                hasLocalFile: true,
                hasRemoteFile: true,
                remoteFileName: up.remoteFileName || b.remoteFileName,
                format: up.format || b.format,
              };
              await dbPutBook(patched);
              setBooks((prev) => prev.map((x) => (x.id === b.id ? patched : x)));
            } else {
              failed++;
            }
          }
        } catch {
          failed++;
        }
        completedSteps++;
      }

      // Step 2: Download all missing books from Google Drive (or Render) to local IndexedDB
      for (let i = 0; i < missingLocalBooks.length; i++) {
        const b = missingLocalBooks[i];
        const stepLabel = `${useDrive ? 'Descargando de Drive' : 'Descargando offline'} (${i + 1}/${missingLocalBooks.length}): ${b.title}`;
        setOfflineSyncProgress(stepLabel);
        showSyncPopupProgress(
          10 + Math.round((completedSteps / totalSteps) * 80),
          stepLabel,
          'Sincronizando libros offline'
        );
        try {
          let resolvedDriveId = b.driveFileId;
          if (useDrive && activeDrive) {
            const dl = await downloadBookFileFromGoogleDrive(
              cfg,
              activeDrive,
              b,
              persistGoogleDriveAuth
            );
            activeDrive = dl.auth;
            resolvedDriveId = dl.driveFileId;
          } else {
            await downloadBookFromServer(cfg, b);
          }
          downloaded++;
          const patched: BookItem = {
            ...b,
            hasLocalFile: true,
            hasRemoteFile: true,
            driveFileId: resolvedDriveId,
          };
          await dbPutBook(patched);
          setBooks((prev) => prev.map((x) => (x.id === b.id ? patched : x)));
        } catch {
          failed++;
        }
        completedSteps++;
      }

      if (uploaded > 0 || downloaded > 0) {
        showSyncPopupProgress(94, 'Guardando registro actualizado...', 'Sincronizando libros offline');
        dirtyScopesRef.current.add('books');
        await triggerSync(true);
      }

      const parts: string[] = [];
      if (uploaded > 0) parts.push(`${uploaded} subido(s)`);
      if (downloaded > 0) parts.push(`${downloaded} guardado(s) offline`);
      if (parts.length > 0) {
        completeSyncPopup(
          'Todos los archivos sincronizados correctamente.',
          parts.join(' · ')
        );
      } else if (failed > 0) {
        completeSyncPopup(
          'Algunos libros aún no han sido subidos desde el otro dispositivo.',
          `${failed} pendiente(s)`
        );
      } else {
        completeSyncPopup(
          'Todos tus libros ya están disponibles sin internet en este dispositivo.'
        );
      }
      return { uploaded, downloaded, failed };
    } catch (err) {
      failSyncPopup(err instanceof Error ? err.message : 'Error al sincronizar archivos offline');
      return { uploaded, downloaded, failed };
    } finally {
      setOfflineSyncProgress('');
    }
  }, [completeSyncPopup, failSyncPopup, persistGoogleDriveAuth, showSyncPopupProgress, showToast, triggerSync]);

  const connectGoogleDrive = useCallback(
    (opts?: { switchAccount?: boolean; forceConsent?: boolean }) => {
      const s = stateRef.current;
      const cfg = s.syncConfig;
      const isAndroid = isKomoAndroidNative();
      const isDesktop = isKomoDesktopNative();
      let rememberedEmail =
        s.googleDriveAuth?.email || s.profile.email || cfg.accountEmail || '';
      if (!rememberedEmail && typeof window !== 'undefined') {
        try {
          rememberedEmail = window.localStorage.getItem('komolib_last_google_email') || '';
        } catch {
          // ignore
        }
      }
      const oauthPlatform = isAndroid ? 'android' : isDesktop ? 'desktop' : 'web';
      const startUrl = buildGoogleOAuthStartUrl(cfg, oauthPlatform, {
        loginHint: opts?.switchAccount ? undefined : rememberedEmail || undefined,
        switchAccount: opts?.switchAccount,
        forceConsent: opts?.forceConsent,
      });
      if (isAndroid || isDesktop) {
        const opened = openExternalUrlNatively(startUrl);
        if (!opened) {
          window.location.href = startUrl;
        }
        return;
      }
      window.location.href = startUrl;
    },
    []
  );

  const disconnectGoogleDrive = useCallback(async () => {
    clearGoogleDriveMemoryCache();
    lastDriveModifiedTimeRef.current = '';
    persistGoogleDriveAuth(null);
    syncedBookUpdatedAtRef.current.clear();
    syncedCoverSigRef.current.clear();
    lastRemoteUpdatedAtRef.current = 0;
    setSyncStatus('idle');
    setSyncMessage('Google Drive desconectado');
    showToast('Google Drive desconectado en este dispositivo');
  }, [persistGoogleDriveAuth, showToast]);

  const completeGoogleDriveAuth = useCallback(
    async (encodedPayload: string) => {
      const parsed = parseGoogleAuthPayloadString(encodedPayload);
      if (!parsed) {
        showToast('No se pudo completar el inicio de sesión con Google Drive');
        return;
      }
      setSyncStatus('syncing');
      setSyncMessage(`Conectando Google Drive (${parsed.email})...`);
      showSyncPopupProgress(15, `Conectando con ${parsed.email}...`, 'Conectando Google Drive');
      try {
        const cfg = stateRef.current.syncConfig;
        const prevAuth = stateRef.current.googleDriveAuth;
        // Preserve previous refreshToken if Google reused an existing grant without returning a new one
        const mergedParsed: GoogleDriveAuth = {
          ...parsed,
          refreshToken:
            parsed.refreshToken ||
            (prevAuth?.email === parsed.email ? prevAuth.refreshToken : '') ||
            '',
        };
        const initialized = await ensureKomolibDriveFolders(cfg, mergedParsed, persistGoogleDriveAuth);
        persistGoogleDriveAuth(initialized);
        try {
          window.localStorage.setItem('komolib_last_google_email', initialized.email);
        } catch {
          // ignore
        }

        // Auto-detect & fill email / name / avatar from Google account (zero manual typing!)
        const s = stateRef.current;
        const nextProfile: UserProfile = {
          ...s.profile,
          email: initialized.email,
          name:
            !s.profile.name || s.profile.name === DEFAULT_PROFILE.name
              ? initialized.name || s.profile.name
              : s.profile.name,
          avatarImageUrl: s.profile.avatarImageUrl || initialized.picture || undefined,
        };
        setProfile(nextProfile);
        await dbSetKV('profile', nextProfile);

        const pulled = await pullStateFromGoogleDrive(
          cfg,
          initialized,
          persistGoogleDriveAuth,
          (pct, detail) => showSyncPopupProgress(pct, detail, 'Sincronizando Google Drive')
        );
        if (pulled.modifiedTime) {
          lastDriveModifiedTimeRef.current = pulled.modifiedTime;
        }
        if (pulled.state) {
          showSyncPopupProgress(75, 'Restaurando libros, progreso y personalización...', 'Sincronizando Google Drive');
          await applyRemotePayload(pulled.state, s.books.filter((b) => !b.isDemo).length === 0);
          updateSyncConfig({ accountEmail: initialized.email });
        }
        if (s.books.filter((b) => !b.isDemo).length > 0 || !pulled.state) {
          dirtyScopesRef.current.add('books');
          dirtyScopesRef.current.add('personalization');
          await triggerSync(true);
        }
        const totalTitles = stateRef.current.books.filter((b) => !b.isDemo).length;
        completeSyncPopup(
          `Conectado a Google Drive (${initialized.email}).`,
          `${totalTitles} títulos listos en Komolib/Libros`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al inicializar la carpeta en Google Drive';
        setSyncStatus('error');
        setSyncMessage(msg);
        failSyncPopup(msg);
      }
    },
    [applyRemotePayload, persistGoogleDriveAuth, showToast, triggerSync]
  );

  // Capture Google Drive OAuth callback from BOTH Web URL hash (#gdrive_auth=...) and Android deep link
  useEffect(() => {
    if (!ready) return;
    const win = window as unknown as {
      __komoGoogleAuthResult?: (payload: { encoded?: string }) => void;
    };
    win.__komoGoogleAuthResult = (payload) => {
      if (payload?.encoded) {
        void completeGoogleDriveAuth(payload.encoded);
      }
    };

    // 1. Check Web URL fragment #gdrive_auth=...
    if (typeof window !== 'undefined' && window.location.hash.includes('gdrive_auth=')) {
      const m = window.location.hash.match(/gdrive_auth=([^&]+)/);
      if (m?.[1]) {
        const decoded = decodeURIComponent(m[1]);
        try {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        } catch {
          // ignore
        }
        void completeGoogleDriveAuth(decoded);
      }
    }

    // 2. Check pending Android deep-link payload captured during Activity launch
    const pendingNative = consumePendingNativeGoogleAuth();
    if (pendingNative) {
      void completeGoogleDriveAuth(pendingNative);
    }

    return () => {
      delete win.__komoGoogleAuthResult;
    };
  }, [ready, completeGoogleDriveAuth]);

  // Real-time Google Drive sync: immediate pull on startup/resume + lightweight 20s metadata poll + background flush!
  useEffect(() => {
    if (!ready || !googleDriveAuth?.accessToken) return;
    let active = true;
    const syncDriveNow = async (checkVersionOnly = false) => {
      const auth = stateRef.current.googleDriveAuth;
      if (!active || !auth?.accessToken || syncInFlightRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        // If this device has pending local edits, push+merge them immediately!
        if (dirtyScopesRef.current.size > 0) {
          await triggerSync(true);
          return;
        }
        if (checkVersionOnly && lastDriveModifiedTimeRef.current) {
          const ver = await getGoogleDriveStateVersion(
            stateRef.current.syncConfig,
            auth,
            persistGoogleDriveAuth
          );
          if (!active) return;
          if (!ver.fileId || (ver.modifiedTime && ver.modifiedTime === lastDriveModifiedTimeRef.current)) {
            return;
          }
        }
        // Automatic background sync stays silent (popup is reserved for explicit backups & account sign-in!)
        const prevModTime = lastDriveModifiedTimeRef.current;
        const pulled = await pullStateFromGoogleDrive(
          stateRef.current.syncConfig,
          stateRef.current.googleDriveAuth || auth,
          persistGoogleDriveAuth
        );
        if (!active) return;
        const hasNewRemoteData = Boolean(
          pulled.state &&
            (syncedBookUpdatedAtRef.current.size === 0 ||
              (!pulled.fromCache && pulled.modifiedTime !== prevModTime))
        );
        if (pulled.modifiedTime) {
          lastDriveModifiedTimeRef.current = pulled.modifiedTime;
        }
        if (pulled.state && hasNewRemoteData) {
          await applyRemotePayload(pulled.state);
        }
        setSyncStatus('ok');
        setSyncMessage(`Google Drive activo (${auth.email})`);
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : '';
        if (isTransientNetworkError(err)) {
          console.warn('[KomoLib] Background Drive sync deferred (transient network):', msg);
          return;
        }
        if (msg) {
          setSyncStatus('error');
          setSyncMessage(msg);
        }
      }
    };

    void syncDriveNow(false);

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void syncDriveNow(true);
    }, 20_000);

    const onVisibilityOrPageHide = () => {
      if (document.visibilityState === 'hidden') {
        // Flush pending changes from Tablet/Phone right away before OS suspends WebView!
        if (autoSyncTimerRef.current) {
          window.clearTimeout(autoSyncTimerRef.current);
          autoSyncTimerRef.current = null;
        }
        if (dirtyScopesRef.current.size > 0 && !syncInFlightRef.current) {
          void triggerSync(true);
        }
        return;
      }
      void syncDriveNow(false);
    };

    const onOnlineOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      void syncDriveNow(false);
    };

    window.addEventListener('online', onOnlineOrFocus);
    window.addEventListener('focus', onOnlineOrFocus);
    window.addEventListener('pagehide', onVisibilityOrPageHide);
    document.addEventListener('visibilitychange', onVisibilityOrPageHide);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      window.removeEventListener('online', onOnlineOrFocus);
      window.removeEventListener('focus', onOnlineOrFocus);
      window.removeEventListener('pagehide', onVisibilityOrPageHide);
      document.removeEventListener('visibilitychange', onVisibilityOrPageHide);
    };
  }, [ready, googleDriveAuth?.email, applyRemotePayload, persistGoogleDriveAuth, triggerSync]);

  // Cloud Account by Email + Full Backup / Restore (no PIN required)
  const loginWithEmail = useCallback(
    async (rawEmail: string): Promise<boolean> => {
      const cleanEmail = rawEmail.trim().toLowerCase();
      if (!cleanEmail || cleanEmail.length < 3) {
        showToast('Ingresa tu correo electrónico o nombre de usuario');
        return false;
      }
      await dbSetKV('explicitLogout', false);

      const spaceId = deriveEmailSpaceId(cleanEmail, '');
      const s = stateRef.current;
      const savedServer = normalizeServerUrl(s.syncConfig.serverUrl);
      const isHttpsPage =
        typeof window !== 'undefined' && window.location.protocol === 'https:';
      const appOrigin =
        typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)
          ? window.location.origin.replace(/\/+$/, '')
          : '';
      const savedIsStale =
        !savedServer ||
        savedServer === appOrigin ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(?:\/|$)/i.test(savedServer) ||
        /\.trycloudflare\.com$/i.test(savedServer) ||
        (isHttpsPage && /^http:\/\//i.test(savedServer)) ||
        (SYNC_SERVER_URL && /\.onrender\.com$/i.test(savedServer) && savedServer !== SYNC_SERVER_URL);
      const resolvedServer =
        (!savedIsStale ? savedServer : '') ||
        SYNC_SERVER_URL ||
        (appOrigin &&
        !/:5173$/.test(appOrigin) &&
        !/^https?:\/\/(localhost|127\.0\.0\.1)(?:\/|$)/i.test(appOrigin)
          ? appOrigin
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
      showSyncPopupProgress(18, `Conectando con ${cleanEmail}...`, 'Iniciando sesión en la nube');

      try {
        const remote = await fetchRemoteSyncState(nextCfg);
        showSyncPopupProgress(50, 'Cargando libros y personalización...', 'Iniciando sesión en la nube');
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
          s.notes.length === 0 &&
          !isThemeCustomized(s.theme) &&
          !isProfileCustomized(s.profile);

        if (remoteHasData && localIsEmpty) {
          showSyncPopupProgress(80, 'Restaurando tu biblioteca...', 'Iniciando sesión en la nube');
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
          completeSyncPopup(
            `¡Bienvenido de vuelta! Cuenta ${cleanEmail} restaurada.`,
            `${restoredBooks.length} títulos listos`
          );
          return true;
        }

        // First time using this email OR user already added books/customizations locally -> merge & save to email vault!
        const localThemeCustom = isThemeCustomized(s.theme);
        const localProfileCustom = isProfileCustomized(s.profile);
        const remoteProfileWins =
          Boolean(remote.profile) &&
          (!localProfileCustom || (remote.profileUpdatedAt || 0) > profileUpdatedAtRef.current);

        const updatedProfile: UserProfile = remoteProfileWins
          ? {
              ...DEFAULT_PROFILE,
              ...remote.profile,
              email: cleanEmail,
            }
          : {
              ...s.profile,
              email: cleanEmail,
            };

        if (remoteProfileWins) {
          profileUpdatedAtRef.current = remote.profileUpdatedAt || profileUpdatedAtRef.current;
        } else if (localProfileCustom) {
          profileUpdatedAtRef.current = profileUpdatedAtRef.current || Date.now();
        } else {
          profileUpdatedAtRef.current = 0;
        }
        await dbSetKV('profileUpdatedAt', profileUpdatedAtRef.current);
        setProfile(updatedProfile);
        await dbSetKV('profile', updatedProfile);

        const pushTheme = localThemeCustom || themeUpdatedAtRef.current > 0;
        const pushProfile = !remoteProfileWins && (localProfileCustom || profileUpdatedAtRef.current > 0);
        const themeTsToSend = pushTheme ? themeUpdatedAtRef.current || Date.now() : 0;
        const profileTsToSend = pushProfile ? profileUpdatedAtRef.current || Date.now() : 0;

        const loginKeepCovers = new Set<string>();
        for (const b of s.books) {
          if (b.isDemo || !b.coverDataUrl) continue;
          const remoteCover = remote.books?.[b.id]?.coverDataUrl;
          if (remoteCover && getCoverSignature(remoteCover) === getCoverSignature(b.coverDataUrl)) {
            loginKeepCovers.add(b.id);
          }
        }
        const loginKeepWallpaper =
          Boolean(s.theme.customWallpaperUrl) &&
          remote.theme?.customWallpaperUrl === s.theme.customWallpaperUrl;

        const loginBooksToSend = s.books.filter((b) => {
          if (b.isDemo) return false;
          const rb = remote.books?.[b.id];
          if (!rb) return true;
          if ((b.updatedAt || 0) > (rb.updatedAt || 0)) return true;
          if (
            b.coverDataUrl &&
            (!rb.coverDataUrl || getCoverSignature(rb.coverDataUrl) !== getCoverSignature(b.coverDataUrl))
          ) {
            return true;
          }
          return false;
        });

        const merged = await syncFullState(
          nextCfg,
          {
            deviceId: s.deviceId,
            books: loginBooksToSend,
            bookmarks: s.bookmarks,
            annotations: s.annotations,
            notes: s.notes,
            chatSessions: s.chatSessions.filter((cs) => cs.messages.some((m) => m.sender === 'user')),
            customBookmarkDesigns: s.customBookmarkDesigns,
            customStationery: s.customStationery,
            categories: s.categories,
            collections: s.collections,
            readerSettings: s.readerSettings,
            readerSettingsUpdatedAt: readerSettingsUpdatedAtRef.current || 0,
            theme: pushTheme ? s.theme : null,
            themeUpdatedAt: themeTsToSend,
            profile: pushProfile ? updatedProfile : null,
            profileUpdatedAt: profileTsToSend,
            lastActiveSession: localActiveSessionRef.current,
            deletedBookIds: deletedIdsRef.current,
            deletedBookmarkIds: deletedBookmarkIdsRef.current,
            deletedAnnotationIds: deletedAnnotationIdsRef.current,
            deletedNoteIds: deletedNoteIdsRef.current,
            deletedBookmarkDesignIds: deletedBookmarkDesignIdsRef.current,
            deletedChatSessionIds: deletedChatSessionIdsRef.current,
            sharedRooms: s.sharedRooms,
            joinedRoomCodes: joinedRoomCodesRef.current,
            closedRoomCodes: closedRoomCodesRef.current,
            sharedShelves: s.sharedShelves,
            joinedShelfCodes: joinedShelfCodesRef.current,
            closedShelfCodes: closedShelfCodesRef.current,
          },
          false,
          loginKeepCovers.size > 0,
          loginKeepWallpaper,
          loginKeepCovers,
          remote.updatedAt || 0
        );

        showSyncPopupProgress(82, 'Combinando y guardando cambios...', 'Iniciando sesión en la nube');
        const finalBooks = await applyRemotePayload(merged, remoteHasData && !localThemeCustom);
        const now = Date.now();
        updateSyncConfig({ lastSyncedAt: now });
        setServerOnline(true);
        setSyncStatus('ok');
        setSyncMessage(`Guardado en ${cleanEmail} (${finalBooks.length} títulos)`);
        completeSyncPopup(
          remoteHasData
            ? `Cuenta ${cleanEmail} sincronizada correctamente.`
            : `Cuenta ${cleanEmail} vinculada correctamente.`,
          `${finalBooks.length} títulos`
        );
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al conectar con la nube';
        setSyncStatus('error');
        setSyncMessage(message);
        failSyncPopup(message);
        return false;
      }
    },
    [applyRemotePayload, completeSyncPopup, failSyncPopup, showSyncPopupProgress, showToast, updateProfile, updateSyncConfig]
  );

  const logoutAccount = useCallback(async () => {
    // Flush any pending changes to the user's cloud vault (Drive or Email) before clearing local device
    const s = stateRef.current;
    if (s.googleDriveAuth?.accessToken) {
      try {
        await triggerSync(true);
      } catch {
        // ignore offline logout
      }
    } else if (s.syncConfig.liveSync && (s.syncConfig.serverUrl.trim() || s.syncConfig.accountEmail)) {
      try {
        const pushTheme = themeUpdatedAtRef.current > 0 || isThemeCustomized(s.theme);
        const pushProfile = profileUpdatedAtRef.current > 0 || isProfileCustomized(s.profile);
        await syncFullState(
          s.syncConfig,
          {
            deviceId: s.deviceId,
            books: s.books,
            bookmarks: s.bookmarks,
            annotations: s.annotations,
            notes: s.notes,
            chatSessions: s.chatSessions.filter((cs) => cs.messages.some((m) => m.sender === 'user')),
            customBookmarkDesigns: s.customBookmarkDesigns,
            customStationery: s.customStationery,
            categories: s.categories,
            collections: s.collections,
            readerSettings: s.readerSettings,
            readerSettingsUpdatedAt: readerSettingsUpdatedAtRef.current || 0,
            theme: pushTheme ? s.theme : null,
            themeUpdatedAt: pushTheme ? themeUpdatedAtRef.current || Date.now() : 0,
            profile: pushProfile ? s.profile : null,
            profileUpdatedAt: pushProfile ? profileUpdatedAtRef.current || Date.now() : 0,
            lastActiveSession: localActiveSessionRef.current,
            deletedBookIds: deletedIdsRef.current,
            deletedBookmarkIds: deletedBookmarkIdsRef.current,
            deletedAnnotationIds: deletedAnnotationIdsRef.current,
            deletedNoteIds: deletedNoteIdsRef.current,
            deletedBookmarkDesignIds: deletedBookmarkDesignIdsRef.current,
            deletedChatSessionIds: deletedChatSessionIdsRef.current,
            sharedRooms: s.sharedRooms,
            joinedRoomCodes: joinedRoomCodesRef.current,
            closedRoomCodes: closedRoomCodesRef.current,
            sharedShelves: s.sharedShelves,
            joinedShelfCodes: joinedShelfCodesRef.current,
            closedShelfCodes: closedShelfCodesRef.current,
          },
          true,
          false,
          false
        );
      } catch {
        // ignore offline logout
      }
    }

    await dbClearAllUserData();
    persistGoogleDriveAuth(null);
    clearCachedTheme();
    clearCachedReaderSettings();

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
    deletedChatSessionIdsRef.current = [];
    joinedRoomCodesRef.current = [];
    joinedShelfCodesRef.current = [];
    closedRoomCodesRef.current = [];
    closedShelfCodesRef.current = [];
    themeUpdatedAtRef.current = 0;
    profileUpdatedAtRef.current = 0;
    readerSettingsUpdatedAtRef.current = 0;
    lastSyncedWallpaperRef.current = '';
    syncedCoverSigRef.current.clear();
    syncedBookUpdatedAtRef.current.clear();
    lastRemoteUpdatedAtRef.current = 0;
    dirtyScopesRef.current.clear();
    localActiveSessionRef.current = null;

    await Promise.all([
      dbSetKV('deviceId', newDeviceId),
      dbSetKV('seeded', true),
      dbSetKV('syncConfig', freshSync),
      dbSetKV('explicitLogout', true),
    ]);

    const freshSession = createFreshChatSession(INITIAL_CHAT_MESSAGES);
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
    setChatSessions([freshSession]);
    setActiveChatSessionId(freshSession.id);
    setSharedRooms([]);
    setSharedShelves([]);
    setDeviceId(newDeviceId);
    setSyncConfig(freshSync);
    setSyncStatus('idle');
    setSyncMessage('');
    showToast('Sesión cerrada en este dispositivo. Tu copia sigue guardada en la nube.');
  }, [persistGoogleDriveAuth, showToast, triggerSync]);

  const buildBackupJsonBundle = useCallback(() => {
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
      chatSessions: s.chatSessions.filter((cs) => cs.messages.some((m) => m.sender === 'user')),
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeTag = (s.profile.email || dateStr).replace(/[^a-zA-Z0-9._-]/g, '_');
    return {
      fileName: `komolib-backup-${safeTag}.json`,
      content: JSON.stringify(payload, null, 2),
    };
  }, []);

  const exportBackupJson = useCallback(() => {
    const { fileName, content } = buildBackupJsonBundle();
    const res = saveTextFileLocally(fileName, content, 'application/json');
    if (res.ok) {
      showToast(
        res.location && res.location !== fileName
          ? `Copia guardada en ${res.location}`
          : `Copia de seguridad guardada (${fileName})`
      );
    } else {
      showToast(res.error || 'No se pudo guardar la copia de seguridad local');
    }
  }, [buildBackupJsonBundle, showToast]);

  const shareBackupJson = useCallback(async () => {
    const { fileName, content } = buildBackupJsonBundle();
    const ok = await shareTextFileNatively(fileName, content, 'application/json');
    if (!ok) {
      showToast('No se pudo compartir la copia de seguridad');
    }
  }, [buildBackupJsonBundle, showToast]);

  const applyNativeBackupObject = useCallback(
    async (data: Record<string, unknown>) => {
      const booksRecord: Record<string, BookItem> = {};
      if (Array.isArray(data.books)) {
        for (const b of data.books) {
          if (b && typeof b === 'object' && (b as BookItem).id && !(b as BookItem).isDemo) {
            booksRecord[(b as BookItem).id] = b as BookItem;
          }
        }
      } else if (data.books && typeof data.books === 'object') {
        for (const [k, b] of Object.entries(data.books as Record<string, unknown>)) {
          if (b && typeof b === 'object' && !(b as BookItem).isDemo) {
            booksRecord[k] = b as BookItem;
          }
        }
      }
      await applyRemotePayload(
        {
          updatedAt: Date.now(),
          books: booksRecord,
          bookmarks: Array.isArray(data.bookmarks) ? (data.bookmarks as BookmarkItem[]) : [],
          annotations: Array.isArray(data.annotations) ? (data.annotations as BookAnnotation[]) : [],
          notes: Array.isArray(data.notes) ? (data.notes as NoteItem[]) : [],
          chatSessions: Array.isArray(data.chatSessions) ? (data.chatSessions as ChatSession[]) : undefined,
          customBookmarkDesigns: Array.isArray(data.customBookmarkDesigns)
            ? (data.customBookmarkDesigns as BookmarkDesign[])
            : [],
          customStationery: (data.customStationery as CustomStationeryKit | null) || null,
          categories: Array.isArray(data.categories) ? (data.categories as CategoryItem[]) : null,
          collections: Array.isArray(data.collections) ? (data.collections as CollectionCard[]) : null,
          readerSettings: (data.readerSettings as ReaderSettings | null) || null,
          theme: (data.theme as ThemeConfig | null) || null,
          themeUpdatedAt: Date.now(),
          profile: (data.profile as UserProfile | null) || null,
          profileUpdatedAt: Date.now(),
        },
        true
      );
      scheduleAutoSync(true);
    },
    [applyRemotePayload, scheduleAutoSync]
  );

  const importExternalBackup = useCallback(
    async (
      parsed: ParsedExternalBackup,
      opts?: {
        importBooks?: boolean;
        importProgress?: boolean;
        importBookmarks?: boolean;
        importAnnotations?: boolean;
        importNotes?: boolean;
      }
    ) => {
      const importBooksOpt = opts?.importBooks !== false;
      const importProgressOpt = opts?.importProgress !== false;
      const importBookmarksOpt = opts?.importBookmarks !== false;
      const importAnnotationsOpt = opts?.importAnnotations !== false;
      const importNotesOpt = opts?.importNotes !== false;

      if (
        parsed.nativeKomoLibData &&
        importBooksOpt &&
        importProgressOpt &&
        importBookmarksOpt &&
        importAnnotationsOpt &&
        importNotesOpt
      ) {
        await applyNativeBackupObject(parsed.nativeKomoLibData);
        showToast('Copia de KomoLib restaurada completamente');
        return {
          booksAdded: parsed.books.length,
          booksUpdated: 0,
          bookmarksAdded: parsed.bookmarks.length,
          annotationsAdded: parsed.annotations.length,
          notesAdded: parsed.notes.length,
        };
      }

      const normalizeTitleKey = (t: string) =>
        t
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const s = stateRef.current;
      const now = Date.now();
      const nextBooksMap = new Map<string, BookItem>();
      const titleToBookId = new Map<string, string>();
      const fileStemToBookId = new Map<string, string>();
      const normalizeFileStem = (fn?: string) =>
        fn
          ? normalizeTitleKey(
              fn
                .split(/[\\/]/)
                .pop()!
                .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx|zip|rar)$/i, '')
            )
          : '';

      for (const b of s.books) {
        nextBooksMap.set(b.id, b);
        const key = normalizeTitleKey(b.title);
        if (key && !titleToBookId.has(key)) titleToBookId.set(key, b.id);
        const fKey = normalizeFileStem(b.fileName);
        if (fKey && !fileStemToBookId.has(fKey)) fileStemToBookId.set(fKey, b.id);
      }

      let booksAdded = 0;
      let booksUpdated = 0;

      const isPlaceholderAuthor = (a?: string) => {
        if (!a) return true;
        const low = a.trim().toLowerCase();
        return !low || low === 'biblioteca personal' || low === 'autor desconocido' || low === 'unknown';
      };

      const ensureOrMergeBook = async (
        entry: ParsedExternalBackup['books'][number],
        allowCreate: boolean
      ): Promise<string | null> => {
        const key = normalizeTitleKey(entry.title);
        const fKey = normalizeFileStem(entry.fileName);
        if (!key && !fKey) return null;
        const existingId =
          (key && titleToBookId.get(key)) ||
          (fKey && fileStemToBookId.get(fKey)) ||
          (fKey && titleToBookId.get(fKey)) ||
          undefined;

        if (existingId) {
          const prev = nextBooksMap.get(existingId);
          if (prev && (importProgressOpt || importBooksOpt)) {
            const incomingProg = entry.progress ?? prev.progress;
            const mergedProgress = importProgressOpt
              ? Math.max(prev.progress || 0, incomingProg || 0)
              : prev.progress;

            const shouldUpgradeCover =
              isRasterCoverDataUrl(entry.coverDataUrl) && !isRasterCoverDataUrl(prev.coverDataUrl);
            let nextCoverDataUrl = prev.coverDataUrl;
            let nextHasOriginalCover = prev.hasOriginalCover;
            let nextSpineColor = prev.spineColor;
            let nextRibbonColor = prev.ribbonColor;

            if (shouldUpgradeCover && entry.coverDataUrl) {
              nextCoverDataUrl = entry.coverDataUrl;
              nextHasOriginalCover = true;
              try {
                const pal = await extractCoverPaletteFromDataUrl(
                  entry.coverDataUrl,
                  prev.spineColor.startsWith('#') ? prev.spineColor : '#4c6c8a',
                  prev.ribbonColor || '#f2ba59'
                );
                nextSpineColor = pal.spineColor;
                nextRibbonColor = pal.ribbonColor;
              } catch {
                // keep existing spine/ribbon colors
              }
            }

            const updated: BookItem = {
              ...prev,
              author: !isPlaceholderAuthor(prev.author)
                ? prev.author
                : !isPlaceholderAuthor(entry.author)
                ? entry.author
                : prev.author,
              description: prev.description || entry.description,
              folderPath: prev.folderPath || entry.folderPath,
              format: entry.format || prev.format,
              coverDataUrl: nextCoverDataUrl,
              hasOriginalCover: nextHasOriginalCover,
              spineColor: nextSpineColor,
              ribbonColor: nextRibbonColor,
              progress: mergedProgress,
              currentPage: importProgressOpt ? entry.currentPage ?? prev.currentPage : prev.currentPage,
              pageCount: entry.pageCount ?? prev.pageCount,
              currentChapter: importProgressOpt
                ? entry.currentChapter || prev.currentChapter
                : prev.currentChapter,
              currentCfi: importProgressOpt ? entry.currentCfi || prev.currentCfi : prev.currentCfi,
              readingStatus: importProgressOpt
                ? entry.readingStatus || prev.readingStatus
                : prev.readingStatus,
              rating: entry.rating ?? prev.rating,
              review: entry.review || prev.review,
              favorite: prev.favorite || Boolean(entry.favorite),
              wishlist: prev.wishlist || Boolean(entry.wishlist),
              startedAt: prev.startedAt || entry.startedAt,
              finishedAt: prev.finishedAt || entry.finishedAt,
              lastReadAt: Math.max(prev.lastReadAt || 0, entry.lastReadAt || 0) || prev.lastReadAt,
              tags: Array.from(new Set([...(prev.tags || []), ...(entry.tags || [])])),
              updatedAt: now,
            };
            await dbPutBook(updated);
            nextBooksMap.set(updated.id, updated);
            booksUpdated += 1;
          }
          return existingId;
        }

        if (!allowCreate) return null;

        const kind: ContentKind = entry.kind || 'book';
        const format: BookItem['format'] = entry.format || (kind === 'audiobook' ? 'audio' : kind === 'manga' || kind === 'manhwa' || kind === 'comic' ? 'cbz' : 'epub');
        const generated = generateCozyCover(entry.title, entry.author || 'Autor desconocido', kind, format);
        let coverDataUrl = generated.coverDataUrl;
        let hasOriginalCover = false;
        let spineColor = generated.spineColor;
        let ribbonColor = generated.ribbonColor;

        if (entry.coverDataUrl && isRasterCoverDataUrl(entry.coverDataUrl)) {
          coverDataUrl = entry.coverDataUrl;
          hasOriginalCover = true;
          try {
            const pal = await extractCoverPaletteFromDataUrl(
              entry.coverDataUrl,
              generated.spineColor,
              generated.ribbonColor
            );
            spineColor = pal.spineColor;
            ribbonColor = pal.ribbonColor;
          } catch {
            // keep cozy fallback palette
          }
        }

        const cats = new Set<string>(entry.categories || []);
        if (kind === 'manga') cats.add('manga');
        else if (kind === 'manhwa') cats.add('manhwa');
        else if (kind === 'comic') cats.add('comic');
        else if (kind === 'audiobook') cats.add('audiobooks');
        else cats.add('ebooks');

        const id = `book_imp_${now}_${Math.random().toString(36).slice(2, 7)}`;
        const created: BookItem = {
          id,
          title: entry.title,
          author: entry.author || 'Autor desconocido',
          description: entry.description,
          format,
          kind,
          categories: Array.from(cats),
          tags: Array.from(new Set([parsed.detectedSource.split(' ')[0].toUpperCase(), ...(entry.tags || [])])),
          coverDataUrl,
          hasOriginalCover,
          coverCheckedV2: true,
          spineColor,
          ribbonColor,
          fileName: entry.fileName || `${entry.title}.${format}`,
          folderPath: entry.folderPath,
          fileSize: 0,
          mimeType: 'application/octet-stream',
          pageCount: entry.pageCount,
          progress: importProgressOpt ? entry.progress ?? 0 : 0,
          currentPage: importProgressOpt ? entry.currentPage : undefined,
          currentChapter: importProgressOpt ? entry.currentChapter : undefined,
          currentCfi: importProgressOpt ? entry.currentCfi : undefined,
          readingStatus: importProgressOpt ? entry.readingStatus : undefined,
          rating: entry.rating,
          review: entry.review,
          favorite: Boolean(entry.favorite),
          wishlist: Boolean(entry.wishlist),
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt,
          hasLocalFile: false,
          addedAt: now,
          lastReadAt: entry.lastReadAt,
          updatedAt: now,
        };
        await dbPutBook(created);
        nextBooksMap.set(created.id, created);
        if (key) titleToBookId.set(key, created.id);
        if (fKey) fileStemToBookId.set(fKey, created.id);
        booksAdded += 1;
        return created.id;
      };

      for (const b of parsed.books) {
        await ensureOrMergeBook(b, importBooksOpt);
      }

      if (booksAdded > 0 || booksUpdated > 0) {
        setBooks(
          Array.from(nextBooksMap.values()).sort(
            (a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
          )
        );
      }

      let bookmarksAdded = 0;
      if (importBookmarksOpt && parsed.bookmarks.length > 0) {
        const existingBms = new Set(
          s.bookmarks.map(
            (bm) => `${bm.bookId}|${bm.label.toLowerCase()}|${bm.page ?? ''}|${bm.cfi ?? ''}`
          )
        );
        const createdBms: BookmarkItem[] = [];
        for (const bm of parsed.bookmarks) {
          const bookId = await ensureOrMergeBook(
            { title: bm.bookTitle, author: bm.bookAuthor || 'Autor desconocido' },
            importBooksOpt
          );
          if (!bookId) continue;
          const sig = `${bookId}|${bm.label.toLowerCase()}|${bm.page ?? ''}|${bm.cfi ?? ''}`;
          if (existingBms.has(sig)) continue;
          existingBms.add(sig);
          const item: BookmarkItem = {
            id: `bm_imp_${now}_${Math.random().toString(36).slice(2, 7)}`,
            bookId,
            label: bm.label,
            chapter: bm.chapter,
            page: bm.page,
            progress: bm.progress,
            cfi: bm.cfi,
            excerpt: bm.excerpt,
            createdAt: bm.createdAt || now,
          };
          await dbPutBookmark(item);
          createdBms.push(item);
          bookmarksAdded += 1;
        }
        if (createdBms.length > 0) {
          setBookmarks((prev) =>
            [...createdBms, ...prev].sort((a, b) => b.createdAt - a.createdAt)
          );
        }
      }

      let annotationsAdded = 0;
      if (importAnnotationsOpt && parsed.annotations.length > 0) {
        const existingAnns = new Set(
          s.annotations.map(
            (a) => `${a.bookId}|${a.quote.slice(0, 80).toLowerCase()}|${(a.note || '').slice(0, 60).toLowerCase()}`
          )
        );
        const createdAnns: BookAnnotation[] = [];
        for (const ann of parsed.annotations) {
          const bookId = await ensureOrMergeBook(
            { title: ann.bookTitle, author: ann.bookAuthor || 'Autor desconocido' },
            importBooksOpt
          );
          if (!bookId) continue;
          const sig = `${bookId}|${ann.quote.slice(0, 80).toLowerCase()}|${(ann.note || '').slice(0, 60).toLowerCase()}`;
          if (existingAnns.has(sig)) continue;
          existingAnns.add(sig);
          const item: BookAnnotation = {
            id: `ann_imp_${now}_${Math.random().toString(36).slice(2, 7)}`,
            bookId,
            tool: ann.tool || 'highlighter',
            color: ann.color || '#ffe066',
            quote: ann.quote,
            note: ann.note,
            chapter: ann.chapter,
            page: ann.page,
            progress: ann.progress ?? 0,
            cfi: ann.cfi,
            createdAt: ann.createdAt || now,
            updatedAt: ann.createdAt || now,
          };
          await dbPutAnnotation(item);
          createdAnns.push(item);
          annotationsAdded += 1;
        }
        if (createdAnns.length > 0) {
          setAnnotations((prev) =>
            [...createdAnns, ...prev].sort((a, b) => b.createdAt - a.createdAt)
          );
        }
      }

      let notesAdded = 0;
      if (importNotesOpt && parsed.notes.length > 0) {
        const existingNotes = new Set(
          s.notes.map((n) => `${n.bookId}|${n.text.slice(0, 100).toLowerCase()}`)
        );
        const createdNotes: NoteItem[] = [];
        for (const n of parsed.notes) {
          const bookId =
            (await ensureOrMergeBook(
              { title: n.bookTitle, author: n.bookAuthor || 'Autor desconocido' },
              importBooksOpt
            )) || 'general';
          const sig = `${bookId}|${n.text.slice(0, 100).toLowerCase()}`;
          if (existingNotes.has(sig)) continue;
          existingNotes.add(sig);
          const item: NoteItem = {
            id: `note_imp_${now}_${Math.random().toString(36).slice(2, 7)}`,
            bookId,
            text: n.text,
            page: n.page,
            color: '#f5b855',
            createdAt: n.createdAt || now,
            updatedAt: n.createdAt || now,
          };
          await dbPutNote(item);
          createdNotes.push(item);
          notesAdded += 1;
        }
        if (createdNotes.length > 0) {
          setNotes((prev) =>
            [...createdNotes, ...prev].sort((a, b) => b.updatedAt - a.updatedAt)
          );
        }
      }

      // Refresh books list if marks created any new catalog entries
      if (nextBooksMap.size !== s.books.length || booksUpdated > 0) {
        setBooks(
          Array.from(nextBooksMap.values()).sort(
            (a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
          )
        );
      }

      scheduleAutoSync(true);
      const summaryParts: string[] = [];
      if (booksAdded) summaryParts.push(`${booksAdded} libro(s)`);
      if (booksUpdated) summaryParts.push(`${booksUpdated} progreso(s)`);
      if (bookmarksAdded) summaryParts.push(`${bookmarksAdded} marcador(es)`);
      if (annotationsAdded) summaryParts.push(`${annotationsAdded} cita(s)`);
      if (notesAdded) summaryParts.push(`${notesAdded} nota(s)`);
      showToast(
        summaryParts.length > 0
          ? `Importado desde ${parsed.detectedSource}: ${summaryParts.join(', ')}`
          : `No se encontraron datos nuevos para importar en "${parsed.fileName}"`
      );
      return { booksAdded, booksUpdated, bookmarksAdded, annotationsAdded, notesAdded };
    },
    [applyNativeBackupObject, scheduleAutoSync, showToast]
  );

  const importBackupJson = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const parsed = await parseExternalBackupFile(file);
        if (
          !parsed.nativeKomoLibData &&
          parsed.books.length === 0 &&
          parsed.bookmarks.length === 0 &&
          parsed.annotations.length === 0 &&
          parsed.notes.length === 0
        ) {
          throw new Error(
            parsed.warnings[0] ||
              'No se encontraron libros, progresos ni marcadores legibles en ese archivo'
          );
        }
        await importExternalBackup(parsed);
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo importar la copia de seguridad');
        return false;
      }
    },
    [importExternalBackup, showToast]
  );

  // Shared Reading Rooms management
  const persistJoinedRoomCodes = useCallback(async (codes: string[]) => {
    const clean = Array.from(new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))).slice(0, 40);
    joinedRoomCodesRef.current = clean;
    await dbSetKV('joinedRoomCodes', clean).catch(console.error);
  }, []);

  const persistClosedRoomCodes = useCallback(async (codes: string[]) => {
    const clean = Array.from(new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))).slice(-60);
    closedRoomCodesRef.current = clean;
    await dbSetKV('closedRoomCodes', clean).catch(console.error);
  }, []);

  const persistSharedRoomsCache = useCallback(async (rooms: SharedRoom[]) => {
    const clean = rooms.slice(0, 40);
    stateRef.current.sharedRooms = clean;
    await dbSetKV('cachedSharedRooms', clean).catch(console.error);
  }, []);

  const selectRoomCode = useCallback((code: string) => {
    const normalized = code.trim().toUpperCase();
    setSelectedRoomCode(normalized);
    dbSetKV('selectedRoomCode', normalized).catch(() => undefined);
  }, []);

  const preserveRoomBookProgress = useCallback(
    async (
      room?: SharedRoom,
      liveSnapshot?: {
        progress?: number;
        currentPage?: number;
        currentCfi?: string;
        scrollRatio?: number;
        currentChapter?: string;
      }
    ): Promise<number | null> => {
      if (!room?.bookId) return null;
      const s = stateRef.current;
      const localBook = s.books.find((b) => b.id === room.bookId);
      const myActorId = s.sharedUserId || s.deviceId;
      const myPart = room.participants?.[myActorId] || room.participants?.[s.deviceId];
      if (!localBook) {
        return myPart?.progress !== undefined ? Number(myPart.progress) : null;
      }

      const localPct = Number(localBook.progress || 0);
      const roomPct = Number(myPart?.progress || 0);
      const hasValidLive =
        liveSnapshot?.progress !== undefined &&
        (liveSnapshot.progress > 0 || (localPct === 0 && roomPct === 0));
      const bestProgress = Math.max(
        0,
        Math.min(
          100,
          hasValidLive ? Number(liveSnapshot!.progress) : Math.max(localPct, roomPct)
        )
      );

      const bestPage =
        liveSnapshot?.currentPage !== undefined && liveSnapshot.currentPage > 0
          ? liveSnapshot.currentPage
          : roomPct > localPct && myPart?.currentPage
          ? myPart.currentPage
          : localBook.currentPage ?? myPart?.currentPage;
      const bestPageCount = localBook.pageCount || myPart?.pageCount || room.bookMeta?.pageCount;
      const bestCfi = liveSnapshot?.currentCfi || localBook.currentCfi;
      const bestScrollRatio =
        liveSnapshot?.scrollRatio !== undefined ? liveSnapshot.scrollRatio : localBook.scrollRatio;
      const bestChapter = liveSnapshot?.currentChapter || localBook.currentChapter;

      let bestStatus = localBook.readingStatus || myPart?.readingStatus;
      if (bestProgress >= 98) {
        bestStatus = 'completed';
      } else if (bestProgress > 0 && (!bestStatus || bestStatus === 'want_to_read')) {
        bestStatus = 'reading';
      }

      const now = Date.now();
      const savedBook: BookItem = {
        ...localBook,
        progress: bestProgress,
        currentPage: bestPage,
        pageCount: bestPageCount,
        currentCfi: bestCfi,
        scrollRatio: bestScrollRatio,
        currentChapter: bestChapter,
        readingStatus: bestStatus,
        startedAt: localBook.startedAt || (bestProgress > 0 ? now : undefined),
        finishedAt: bestStatus === 'completed' ? localBook.finishedAt || now : localBook.finishedAt,
        lastReadAt: bestProgress > 0 ? Math.max(localBook.lastReadAt || 0, now) : localBook.lastReadAt,
        updatedAt: now,
      };

      const nextBooks = s.books.map((b) => (b.id === savedBook.id ? savedBook : b));
      stateRef.current.books = nextBooks;
      setBooks(nextBooks);
      setActiveBook((curr) => (curr && curr.id === savedBook.id ? savedBook : curr));
      if (bestProgress > 0 || bestPage) {
        localActiveSessionRef.current = {
          bookId: savedBook.id,
          title: savedBook.title,
          author: savedBook.author,
          progress: bestProgress,
          currentPage: bestPage,
          deviceId: s.deviceId,
          deviceName: detectDeviceName(),
          updatedAt: now,
        };
      }
      await dbPutBook(savedBook).catch(console.error);
      scheduleAutoSync(true, 'books');
      return bestProgress;
    },
    [scheduleAutoSync]
  );

  const refreshSharedRooms = useCallback(async () => {
    const cfg = stateRef.current.syncConfig;
    const myDevId = stateRef.current.deviceId;
    const myId = stateRef.current.sharedUserId || myDevId;
    const myIds = Array.from(new Set([myId, myDevId].filter(Boolean)));
    if (!cfg.serverUrl.trim()) return;

    const prevRooms = stateRef.current.sharedRooms;
    const prevByCode = new Map<string, SharedRoom>();
    for (const r of prevRooms) {
      if (r?.code) prevByCode.set(r.code.trim().toUpperCase(), r);
    }
    const closedSet = new Set(closedRoomCodesRef.current);
    const byCode = new Map<string, SharedRoom>();
    let serverReachable = false;

    try {
      // Fetch rooms this user participates in across any of their linked devices (per-user privacy!)
      const list = await listSharedRooms(cfg, myIds.length > 0 ? myIds.join(',') : undefined);
      serverReachable = true;
      for (const r of list) {
        const c = r.code.trim().toUpperCase();
        if (!closedSet.has(c)) byCode.set(c, r);
      }
      setServerOnline(true);
    } catch {
      // May fail with 401 when KOMOLIB_TOKEN is enabled and client is a Buddy Read guest,
      // or temporarily during Render cold start / offline — fall through to per-code checks!
    }

    const joinedCodes = Array.from(
      new Set([
        ...joinedRoomCodesRef.current,
        ...Array.from(prevByCode.keys()),
      ])
    ).filter((c) => c && !closedSet.has(c));

    const kickedCodes = new Set<string>();
    const explicitlyDeletedCodes = new Set<string>();

    if (joinedCodes.length > 0) {
      await Promise.all(
        joinedCodes.map(async (code) => {
          if (byCode.has(code)) return;
          const cached = prevByCode.get(code);
          try {
            const room = await getSharedRoom(cfg, code);
            serverReachable = true;
            const kickedMe = myIds.some((id) => room.kickedIds?.includes(id));
            const stillInRoom = myIds.some((id) => Boolean(room.participants?.[id]));
            if (kickedMe && !stillInRoom) {
              kickedCodes.add(room.code);
              if (cached) void preserveRoomBookProgress(cached);
              return;
            }
            byCode.set(room.code, room);
            setServerOnline(true);
          } catch (err) {
            if (err instanceof SharedSpaceHttpError) {
              serverReachable = true;
              setServerOnline(true);
              if (err.deleted || err.status === 410) {
                // Explicitly closed by host/user -> preserve progress & remove cleanly
                explicitlyDeletedCodes.add(code);
                if (cached) void preserveRoomBookProgress(cached);
                return;
              }
              if (err.status === 404 && cached) {
                // Server restarted on ephemeral disk (e.g. Render Free) -> auto-restore with EXACT SAME code!
                const localBook = stateRef.current.books.find((b) => b.id === cached.bookId);
                const effectiveId =
                  cached.participants?.[myId]
                    ? myId
                    : cached.participants?.[myDevId]
                    ? myDevId
                    : myId;
                const myExistingPart = cached.participants?.[effectiveId];
                const roomToRestore: SharedRoom = {
                  ...cached,
                  participants: {
                    ...(cached.participants || {}),
                    ...(effectiveId
                      ? {
                          [effectiveId]: {
                            id: effectiveId,
                            name: stateRef.current.profile.name || myExistingPart?.name || 'Lector Komo',
                            avatarEmoji: stateRef.current.profile.avatarEmoji || myExistingPart?.avatarEmoji || '🦊',
                            avatarBg: stateRef.current.profile.avatarBg || myExistingPart?.avatarBg || '#f6d8ae',
                            avatarImageUrl:
                              stateRef.current.profile.avatarImageUrl ||
                              myExistingPart?.avatarImageUrl ||
                              '',
                            progress: Math.max(
                              Number(localBook?.progress || 0),
                              Number(myExistingPart?.progress || 0)
                            ),
                            currentPage: localBook?.currentPage ?? myExistingPart?.currentPage ?? 1,
                            pageCount:
                              localBook?.pageCount ?? myExistingPart?.pageCount ?? cached.bookMeta?.pageCount,
                            readingStatus:
                              localBook?.readingStatus || myExistingPart?.readingStatus || 'reading',
                            joinedAt: myExistingPart?.joinedAt || cached.createdAt || Date.now(),
                            lastSeenAt: Date.now(),
                          },
                        }
                      : {}),
                  },
                };
                try {
                  const res = await restoreSharedRoom(cfg, roomToRestore);
                  byCode.set(res.room.code, res.room);
                  // If host has the local book file, re-upload in background so guests can download after server restart
                  if (res.restored && myIds.includes(cached.hostId) && localBook?.hasLocalFile) {
                    uploadBookToServer(cfg, localBook, myDevId).catch(() => undefined);
                  }
                } catch (restoreErr) {
                  if (restoreErr instanceof SharedSpaceHttpError && (restoreErr.deleted || restoreErr.status === 410)) {
                    explicitlyDeletedCodes.add(code);
                    void preserveRoomBookProgress(cached);
                  } else {
                    // Keep cached room locally — NEVER drop it on transient errors!
                    byCode.set(code, cached);
                  }
                }
                return;
              }
            }
            // Offline / cold start / transient error -> keep cached room locally!
            if (cached) {
              byCode.set(code, cached);
            }
          }
        })
      );
    }

    if (!serverReachable && prevRooms.length > 0 && byCode.size === 0) {
      // Server completely unreachable right now: never wipe cached rooms!
      return;
    }

    const removedSet = new Set([...kickedCodes, ...explicitlyDeletedCodes]);
    if (removedSet.size > 0) {
      await persistJoinedRoomCodes(joinedCodes.filter((c) => !removedSet.has(c)));
      if (explicitlyDeletedCodes.size > 0) {
        await persistClosedRoomCodes([...closedRoomCodesRef.current, ...explicitlyDeletedCodes]);
      }
    } else if (byCode.size > 0) {
      const mergedCodes = Array.from(new Set([...joinedCodes, ...Array.from(byCode.keys())]));
      if (mergedCodes.length !== joinedRoomCodesRef.current.length) {
        await persistJoinedRoomCodes(mergedCodes);
      }
    }

    const combined = Array.from(byCode.values()).sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
    setSharedRooms(combined);
    await persistSharedRoomsCache(combined);
  }, [persistClosedRoomCodes, persistJoinedRoomCodes, persistSharedRoomsCache, preserveRoomBookProgress]);

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
  // Automatically paused when Google Drive Personal Cloud is connected so Render Free stays idle!
  useEffect(() => {
    if (
      !ready ||
      !deviceId ||
      googleDriveAuth?.accessToken ||
      syncConfig.liveSync === false ||
      !syncConfig.serverUrl.trim()
    ) {
      setLiveConnected(false);
      return;
    }
    let active = true;
    let sseIsUp = false;

    const pullRemoteNow = async () => {
      if (!active) return;
      try {
        const remote = await fetchRemoteSyncState(
          stateRef.current.syncConfig,
          lastRemoteUpdatedAtRef.current
        );
        if (!active) return;
        await applyRemotePayload(remote);
        setServerOnline(true);
        setSyncStatus('ok');
        setSyncMessage('Sincronizado en vivo');
      } catch {
        // ignore transient network glitches
      }
    };

    // Initial silent pull first (seeds syncedBookUpdatedAtRef so delta sync only sends actual changes!)
    pullRemoteNow()
      .then(() => {
        if (active) return triggerSync(true);
      })
      .catch(() => undefined);

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
      },
      async (reqEv) => {
        if (!active) return;
        const s = stateRef.current;
        if (reqEv.requesterDeviceId && reqEv.requesterDeviceId === s.deviceId) return;
        const norm = (v?: string) =>
          (v || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '');
        const target =
          s.books.find((b) => b.id === reqEv.bookId) ||
          (reqEv.fileName ? s.books.find((b) => norm(b.fileName) === norm(reqEv.fileName)) : undefined) ||
          (reqEv.title ? s.books.find((b) => norm(b.title) === norm(reqEv.title)) : undefined);
        if (!target) return;
        const localRec = await dbGetBookFile(target.id);
        if (!localRec && !target.nativeFileUri) return;
        try {
          const up = await uploadBookToServer(s.syncConfig, target, s.deviceId);
          if (up.ok) {
            const patched: BookItem = {
              ...target,
              hasRemoteFile: true,
              remoteFileName: up.remoteFileName || target.remoteFileName,
              format: up.format || target.format,
            };
            await dbPutBook(patched);
            setBooks((prev) => prev.map((x) => (x.id === target.id ? patched : x)));
          }
        } catch {
          // ignore transient upload failure
        }
      }
    );

    // Mobile APK / Tab resume & network reconnect recovery (throttled so file pickers don't race uploads)
    const handleResume = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastResumeSyncAtRef.current < 8000) return;
      lastResumeSyncAtRef.current = now;
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
    googleDriveAuth?.accessToken,
    syncConfig.serverUrl,
    syncConfig.token,
    syncConfig.liveSync,
    applyRemotePayload,
    refreshServerHealth,
    refreshSharedRooms,
    triggerSync,
  ]);

  useEffect(() => {
    if (!ready || !deviceId || !syncConfig.serverUrl.trim()) return;
    refreshSharedRooms();
  }, [ready, deviceId, syncConfig.serverUrl, syncConfig.token, serverOnline, refreshSharedRooms]);

  const updateLocalRoom = useCallback((room: SharedRoom) => {
    setSharedRooms((prev) => {
      const exists = prev.some((r) => r.code === room.code);
      const next = exists
        ? prev.map((r) => (r.code === room.code ? room : r))
        : [room, ...prev];
      stateRef.current.sharedRooms = next;
      dbSetKV('cachedSharedRooms', next.slice(0, 40)).catch(console.error);
      return next;
    });
  }, []);

  const removeLocalRoom = useCallback(
    (code: string) => {
      const normalized = code.trim().toUpperCase();
      const pendingTimer = roomProgressTimersRef.current[normalized];
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        delete roomProgressTimersRef.current[normalized];
      }
      const existingRoom = stateRef.current.sharedRooms.find(
        (r) => r.code.trim().toUpperCase() === normalized
      );
      if (existingRoom) {
        void preserveRoomBookProgress(existingRoom);
      }
      setSharedRooms((prev) => {
        const next = prev.filter((r) => r.code.trim().toUpperCase() !== normalized);
        stateRef.current.sharedRooms = next;
        dbSetKV('cachedSharedRooms', next.slice(0, 40)).catch(console.error);
        return next;
      });
      void persistJoinedRoomCodes(joinedRoomCodesRef.current.filter((c) => c !== normalized));
      setSelectedRoomCode((curr) => {
        const next = curr === normalized ? '' : curr;
        if (next !== curr) dbSetKV('selectedRoomCode', next).catch(() => undefined);
        return next;
      });
    },
    [persistJoinedRoomCodes, preserveRoomBookProgress]
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
        const actorId = s.sharedUserId || s.deviceId;
        const room = await createSharedRoom(
          s.syncConfig,
          readyBook,
          {
            id: actorId,
            name: s.profile.name,
            avatarEmoji: s.profile.avatarEmoji,
            avatarBg: s.profile.avatarBg,
            avatarImageUrl: s.profile.avatarImageUrl || '',
            progress: readyBook.progress || 0,
            currentPage: readyBook.currentPage || 1,
            readingStatus: readyBook.readingStatus || 'reading',
          },
          marks
        );
        const nextRooms = [room, ...stateRef.current.sharedRooms.filter((r) => r.code !== room.code)];
        stateRef.current.sharedRooms = nextRooms;
        setSharedRooms(nextRooms);
        selectRoomCode(room.code);
        await Promise.all([
          persistClosedRoomCodes(closedRoomCodesRef.current.filter((c) => c !== room.code)),
          persistJoinedRoomCodes([room.code, ...joinedRoomCodesRef.current]),
          persistSharedRoomsCache(nextRooms),
        ]);
        scheduleAutoSync(true, 'shared');
        showToast(`Sala ${room.code} creada para "${book.title}"`);
        return room;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo crear la sala compartida');
        return null;
      }
    },
    [
      collectSharedMarksForBook,
      persistClosedRoomCodes,
      persistJoinedRoomCodes,
      persistSharedRoomsCache,
      scheduleAutoSync,
      selectRoomCode,
      showToast,
    ]
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
        const actorId = s.sharedUserId || s.deviceId;
        const knownRoom = s.sharedRooms.find((r) => r.code === code);
        const existingBook = knownRoom
          ? s.books.find((b) => b.id === knownRoom.bookId)
          : undefined;
        let room = await joinSharedRoom(s.syncConfig, code, {
          id: actorId,
          name: s.profile.name,
          avatarEmoji: s.profile.avatarEmoji,
          avatarBg: s.profile.avatarBg,
          avatarImageUrl: s.profile.avatarImageUrl || '',
          progress: existingBook?.progress,
          currentPage: existingBook?.currentPage,
          readingStatus: existingBook?.readingStatus,
        });

        // Ensure the shared book exists in local IndexedDB (download file if not present)
        const alreadyHasBook = s.books.find((b) => b.id === room.bookId);
        const serverMyPart = room.participants?.[actorId] || room.participants?.[s.deviceId];

        // If user already had saved progress on this book locally (e.g. rejoined after leaving),
        // push their saved progress up to the room immediately so it's never reset to 0%!
        if (
          alreadyHasBook &&
          ((alreadyHasBook.progress || 0) > (serverMyPart?.progress || 0) ||
            ((alreadyHasBook.currentPage || 0) > 1 && !(serverMyPart?.currentPage && serverMyPart.currentPage > 1)))
        ) {
          try {
            room = await updateSharedRoomProgress(s.syncConfig, room.code, {
              participantId: actorId,
              name: s.profile.name,
              avatarEmoji: s.profile.avatarEmoji,
              avatarBg: s.profile.avatarBg,
              avatarImageUrl: s.profile.avatarImageUrl || '',
              progress: alreadyHasBook.progress || 0,
              currentPage: alreadyHasBook.currentPage,
              pageCount: alreadyHasBook.pageCount,
              readingStatus: alreadyHasBook.readingStatus,
            });
          } catch {
            // keep joined room even if immediate progress sync fails
          }
        }

        const nextRooms = [room, ...stateRef.current.sharedRooms.filter((r) => r.code !== room.code)];
        stateRef.current.sharedRooms = nextRooms;
        setSharedRooms(nextRooms);
        selectRoomCode(room.code);
        await Promise.all([
          persistClosedRoomCodes(closedRoomCodesRef.current.filter((c) => c !== room.code)),
          persistJoinedRoomCodes([room.code, ...joinedRoomCodesRef.current]),
          persistSharedRoomsCache(nextRooms),
        ]);
        scheduleAutoSync(true, 'shared');

        const localFile = await dbGetBookFile(room.bookId);
        let resolvedBook: BookItem | undefined = alreadyHasBook;
        const bestInitialProgress = Math.max(
          Number(alreadyHasBook?.progress || 0),
          Number((room.participants?.[actorId] || room.participants?.[s.deviceId])?.progress || 0)
        );
        const bestInitialPage =
          alreadyHasBook?.currentPage ??
          (room.participants?.[actorId] || room.participants?.[s.deviceId])?.currentPage;

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
              pageCount: alreadyHasBook?.pageCount || room.bookMeta.pageCount,
              progress: bestInitialProgress,
              currentPage: bestInitialPage,
              favorite: alreadyHasBook?.favorite || false,
              wishlist: false,
              readingStatus:
                alreadyHasBook?.readingStatus ||
                (bestInitialProgress >= 98 ? 'completed' : 'reading'),
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
            scheduleAutoSync(false, 'books');
          } catch {
            // Even if file download fails (e.g. demo book), keep joined in room
          }
        } else if (bestInitialProgress > (alreadyHasBook.progress || 0)) {
          const syncedLocal: BookItem = {
            ...alreadyHasBook,
            progress: bestInitialProgress,
            currentPage: bestInitialPage,
            updatedAt: Date.now(),
          };
          await dbPutBook(syncedLocal);
          resolvedBook = syncedLocal;
          setBooks((prev) => prev.map((x) => (x.id === syncedLocal.id ? syncedLocal : x)));
          scheduleAutoSync(false, 'books');
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
    [
      importSharedMarksIntoLocalBook,
      persistClosedRoomCodes,
      persistJoinedRoomCodes,
      persistSharedRoomsCache,
      scheduleAutoSync,
      selectRoomCode,
      showToast,
    ]
  );

  const sendRoomComment = useCallback(
    async (code: string, text: string, progressAt: number, pageAt?: number) => {
      const s = stateRef.current;
      const room = await postSharedRoomComment(s.syncConfig, code, {
        participantId: s.sharedUserId || s.deviceId,
        authorName: s.profile.name,
        avatarEmoji: s.profile.avatarEmoji,
        avatarImageUrl: s.profile.avatarImageUrl || '',
        text,
        progressAt,
        pageAt,
      });
      updateLocalRoom(room);
    },
    [updateLocalRoom]
  );

  const leaveOrDeleteRoom = useCallback(
    async (
      code: string,
      deleteEntireRoom: boolean,
      liveSnapshot?: {
        progress?: number;
        currentPage?: number;
        currentCfi?: string;
        scrollRatio?: number;
        currentChapter?: string;
      }
    ) => {
      const normalized = code.trim().toUpperCase();
      const s = stateRef.current;

      // Cancel any debounced room progress update so it cannot fire after leaving/closing
      const pendingTimer = roomProgressTimersRef.current[normalized];
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        delete roomProgressTimersRef.current[normalized];
      }

      // ALWAYS preserve and persist the user's reading progress BEFORE leaving or deleting the room!
      const targetRoom = s.sharedRooms.find((r) => r.code.trim().toUpperCase() === normalized);
      const savedProgress = targetRoom
        ? await preserveRoomBookProgress(targetRoom, liveSnapshot)
        : null;

      await persistClosedRoomCodes([...closedRoomCodesRef.current, normalized]);

      const actorId =
        targetRoom?.participants?.[s.sharedUserId]
          ? s.sharedUserId
          : targetRoom?.participants?.[s.deviceId]
          ? s.deviceId
          : s.sharedUserId || s.deviceId;
      if (deleteEntireRoom) {
        await deleteSharedRoom(s.syncConfig, normalized);
      } else {
        await leaveSharedRoom(s.syncConfig, normalized, actorId);
      }

      const nextRooms = stateRef.current.sharedRooms.filter(
        (r) => r.code.trim().toUpperCase() !== normalized
      );
      stateRef.current.sharedRooms = nextRooms;
      setSharedRooms(nextRooms);
      setSelectedRoomCode((curr) => {
        const next = curr === normalized ? '' : curr;
        if (next !== curr) dbSetKV('selectedRoomCode', next).catch(() => undefined);
        return next;
      });
      await Promise.all([
        persistJoinedRoomCodes(joinedRoomCodesRef.current.filter((c) => c !== normalized)),
        persistSharedRoomsCache(nextRooms),
      ]);
      scheduleAutoSync(true, 'shared');

      const pctText =
        savedProgress !== null && savedProgress > 0
          ? ` · Tu progreso (${Math.round(savedProgress)}%) se guardó en tu biblioteca`
          : ' · Tu progreso local se conservó';
      showToast(
        deleteEntireRoom
          ? `Sala ${normalized} cerrada para todos${pctText}`
          : `Saliste de la sala ${normalized}${pctText}`
      );
    },
    [
      persistClosedRoomCodes,
      persistJoinedRoomCodes,
      persistSharedRoomsCache,
      preserveRoomBookProgress,
      scheduleAutoSync,
      showToast,
    ]
  );

  const kickUserFromRoom = useCallback(
    async (code: string, targetParticipantId: string, targetName?: string) => {
      const s = stateRef.current;
      const targetRoom = s.sharedRooms.find((r) => r.code === code);
      const requesterId =
        targetRoom?.hostId === s.deviceId ? s.deviceId : s.sharedUserId || s.deviceId;
      try {
        const updated = await kickRoomParticipant(s.syncConfig, code, requesterId, targetParticipantId);
        updateLocalRoom(updated);
        showToast(`${targetName || 'Usuario'} fue eliminado de la sala ${code}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo eliminar al usuario de la sala');
      }
    },
    [showToast, updateLocalRoom]
  );

  /* -------- Mutual Book Exchange Shelves (Independent Progress per User!) -------- */
  const persistJoinedShelfCodes = useCallback(async (codes: string[]) => {
    const clean = Array.from(
      new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))
    ).slice(0, 40);
    joinedShelfCodesRef.current = clean;
    await dbSetKV('joinedShelfCodes', clean).catch(console.error);
  }, []);

  const persistClosedShelfCodes = useCallback(async (codes: string[]) => {
    const clean = Array.from(
      new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))
    ).slice(-60);
    closedShelfCodesRef.current = clean;
    await dbSetKV('closedShelfCodes', clean).catch(console.error);
  }, []);

  const persistSharedShelvesCache = useCallback(async (shelves: SharedShelf[]) => {
    const clean = shelves.slice(0, 40);
    stateRef.current.sharedShelves = clean;
    await dbSetKV('cachedSharedShelves', clean).catch(console.error);
  }, []);

  const selectShelfCode = useCallback((code: string) => {
    const normalized = code.trim().toUpperCase();
    setSelectedShelfCode(normalized);
    dbSetKV('selectedShelfCode', normalized).catch(() => undefined);
  }, []);

  const updateLocalShelf = useCallback((shelf: SharedShelf) => {
    setSharedShelves((prev) => {
      const exists = prev.some((s) => s.code === shelf.code);
      const next = exists
        ? prev.map((s) => (s.code === shelf.code ? shelf : s))
        : [shelf, ...prev];
      stateRef.current.sharedShelves = next;
      dbSetKV('cachedSharedShelves', next.slice(0, 40)).catch(console.error);
      return next;
    });
  }, []);

  const removeLocalShelf = useCallback(
    (code: string) => {
      const normalized = code.trim().toUpperCase();
      setSharedShelves((prev) => {
        const next = prev.filter((s) => s.code.trim().toUpperCase() !== normalized);
        stateRef.current.sharedShelves = next;
        dbSetKV('cachedSharedShelves', next.slice(0, 40)).catch(console.error);
        return next;
      });
      void persistJoinedShelfCodes(joinedShelfCodesRef.current.filter((c) => c !== normalized));
      setSelectedShelfCode((curr) => {
        const next = curr === normalized ? '' : curr;
        if (next !== curr) dbSetKV('selectedShelfCode', next).catch(() => undefined);
        return next;
      });
    },
    [persistJoinedShelfCodes]
  );

  const refreshSharedShelves = useCallback(async () => {
    const cfg = stateRef.current.syncConfig;
    const myDevId = stateRef.current.deviceId;
    const myId = stateRef.current.sharedUserId || myDevId;
    const myIds = Array.from(new Set([myId, myDevId].filter(Boolean)));
    const prevShelves = stateRef.current.sharedShelves;
    const prevByCode = new Map<string, SharedShelf>();
    for (const sh of prevShelves) {
      if (sh?.code) prevByCode.set(sh.code.trim().toUpperCase(), sh);
    }
    const closedSet = new Set(closedShelfCodesRef.current);
    const codes = Array.from(
      new Set([...joinedShelfCodesRef.current, ...Array.from(prevByCode.keys())])
    ).filter((c) => c && !closedSet.has(c));

    if (!cfg.serverUrl.trim() || !codes.length) return;
    const fetched: SharedShelf[] = [];
    const kickedCodes = new Set<string>();
    const explicitlyDeletedCodes = new Set<string>();
    let serverReachable = false;

    await Promise.all(
      codes.map(async (code) => {
        const cached = prevByCode.get(code);
        try {
          const shelf = await getSharedShelf(cfg, code);
          serverReachable = true;
          const kickedMe = myIds.some((id) => shelf.kickedIds?.includes(id));
          const stillMember = myIds.some((id) => Boolean(shelf.members?.[id]));
          if (kickedMe && !stillMember) {
            kickedCodes.add(shelf.code);
            return;
          }
          fetched.push(shelf);
          setServerOnline(true);
        } catch (err) {
          if (err instanceof SharedSpaceHttpError) {
            serverReachable = true;
            setServerOnline(true);
            if (err.deleted || err.status === 410) {
              explicitlyDeletedCodes.add(code);
              return;
            }
            if (err.status === 404 && cached) {
              try {
                const res = await restoreSharedShelf(cfg, cached);
                fetched.push(res.shelf);
              } catch (restoreErr) {
                if (restoreErr instanceof SharedSpaceHttpError && (restoreErr.deleted || restoreErr.status === 410)) {
                  explicitlyDeletedCodes.add(code);
                } else {
                  fetched.push(cached);
                }
              }
              return;
            }
          }
          if (cached) {
            fetched.push(cached);
          }
        }
      })
    );

    if (!serverReachable && prevShelves.length > 0 && fetched.length === 0) {
      return;
    }

    const removedSet = new Set([...kickedCodes, ...explicitlyDeletedCodes]);
    if (removedSet.size > 0) {
      await persistJoinedShelfCodes(codes.filter((c) => !removedSet.has(c)));
      if (explicitlyDeletedCodes.size > 0) {
        await persistClosedShelfCodes([...closedShelfCodesRef.current, ...explicitlyDeletedCodes]);
      }
    }
    fetched.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    setSharedShelves(fetched);
    await persistSharedShelvesCache(fetched);
  }, [persistClosedShelfCodes, persistJoinedShelfCodes, persistSharedShelvesCache]);

  useEffect(() => {
    if (!ready || !deviceId || !syncConfig.serverUrl.trim()) return;
    refreshSharedShelves();
  }, [ready, deviceId, syncConfig.serverUrl, syncConfig.token, serverOnline, refreshSharedShelves]);

  // Keep shared rooms & shelves fresh on app resume/reconnect even when Google Drive is active or liveSync is off
  useEffect(() => {
    if (!ready || !deviceId || !syncConfig.serverUrl.trim()) return;
    let lastCheckedAt = 0;
    const onSharedResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (joinedRoomCodesRef.current.length === 0 && joinedShelfCodesRef.current.length === 0) {
        return;
      }
      const now = Date.now();
      if (now - lastCheckedAt < 10000) return;
      lastCheckedAt = now;
      void refreshSharedRooms();
      void refreshSharedShelves();
    };
    window.addEventListener('online', onSharedResume);
    window.addEventListener('focus', onSharedResume);
    document.addEventListener('visibilitychange', onSharedResume);
    return () => {
      window.removeEventListener('online', onSharedResume);
      window.removeEventListener('focus', onSharedResume);
      document.removeEventListener('visibilitychange', onSharedResume);
    };
  }, [ready, deviceId, syncConfig.serverUrl, refreshSharedRooms, refreshSharedShelves]);

  const createMutualShelf = useCallback(
    async (
      title: string,
      bookIds: string[],
      marksSelection?: ShareMarksSelection
    ): Promise<SharedShelf | null> => {
      try {
        const s = stateRef.current;
        const actorId = s.sharedUserId || s.deviceId;
        let shelf = await createSharedShelf(s.syncConfig, title, {
          id: actorId,
          name: s.profile.name,
          avatarEmoji: s.profile.avatarEmoji,
          avatarBg: s.profile.avatarBg,
          avatarImageUrl: s.profile.avatarImageUrl || '',
        });
        let failedCount = 0;
        for (const bid of bookIds) {
          const target = s.books.find((b) => b.id === bid);
          if (!target) continue;
          try {
            const marks = collectSharedMarksForBook(target.id, marksSelection);
            shelf = await shareBookToShelf(
              s.syncConfig,
              shelf.code,
              target,
              {
                id: actorId,
                name: s.profile.name,
              },
              marks
            );
          } catch {
            failedCount += 1;
          }
        }
        const nextShelves = [
          shelf,
          ...stateRef.current.sharedShelves.filter((x) => x.code !== shelf.code),
        ];
        stateRef.current.sharedShelves = nextShelves;
        setSharedShelves(nextShelves);
        selectShelfCode(shelf.code);
        await Promise.all([
          persistClosedShelfCodes(closedShelfCodesRef.current.filter((c) => c !== shelf.code)),
          persistJoinedShelfCodes([shelf.code, ...joinedShelfCodesRef.current]),
          persistSharedShelvesCache(nextShelves),
        ]);
        scheduleAutoSync(true, 'shared');
        const sharedCount = Object.keys(shelf.books).length;
        showToast(
          failedCount > 0
            ? `Estantería ${shelf.code} creada (${sharedCount} libros compartidos, ${failedCount} omitido(s))`
            : `Estantería mutua ${shelf.code} creada (${sharedCount} libros)`
        );
        return shelf;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo crear la estantería compartida');
        return null;
      }
    },
    [
      collectSharedMarksForBook,
      persistClosedShelfCodes,
      persistJoinedShelfCodes,
      persistSharedShelvesCache,
      scheduleAutoSync,
      selectShelfCode,
      showToast,
    ]
  );

  const joinShelfByCode = useCallback(
    async (rawCode: string): Promise<SharedShelf | null> => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return null;
      try {
        const s = stateRef.current;
        const actorId = s.sharedUserId || s.deviceId;
        const shelf = await joinSharedShelf(s.syncConfig, code, {
          id: actorId,
          name: s.profile.name,
          avatarEmoji: s.profile.avatarEmoji,
          avatarBg: s.profile.avatarBg,
          avatarImageUrl: s.profile.avatarImageUrl || '',
        });
        const nextShelves = [
          shelf,
          ...stateRef.current.sharedShelves.filter((x) => x.code !== shelf.code),
        ];
        stateRef.current.sharedShelves = nextShelves;
        setSharedShelves(nextShelves);
        selectShelfCode(shelf.code);
        await Promise.all([
          persistClosedShelfCodes(closedShelfCodesRef.current.filter((c) => c !== shelf.code)),
          persistJoinedShelfCodes([shelf.code, ...joinedShelfCodesRef.current]),
          persistSharedShelvesCache(nextShelves),
        ]);
        scheduleAutoSync(true, 'shared');
        setPendingShelfCode('');
        showToast(`Te uniste a la estantería ${shelf.code} ("${shelf.title}")`);
        return shelf;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo unir a la estantería');
        return null;
      }
    },
    [
      persistClosedShelfCodes,
      persistJoinedShelfCodes,
      persistSharedShelvesCache,
      scheduleAutoSync,
      selectShelfCode,
      showToast,
    ]
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
              id: s.sharedUserId || s.deviceId,
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
        scheduleAutoSync(true, 'shared');
        showToast('Libros compartidos en la estantería mutua');
      }
    },
    [collectSharedMarksForBook, scheduleAutoSync, showToast, updateLocalShelf]
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
    async (code: string, deleteEntireShelf: boolean) => {
      const normalized = code.trim().toUpperCase();
      const s = stateRef.current;
      const targetShelf = s.sharedShelves.find((sh) => sh.code.trim().toUpperCase() === normalized);
      const actorId =
        targetShelf?.members?.[s.sharedUserId]
          ? s.sharedUserId
          : targetShelf?.members?.[s.deviceId]
          ? s.deviceId
          : s.sharedUserId || s.deviceId;
      await persistClosedShelfCodes([...closedShelfCodesRef.current, normalized]);
      if (deleteEntireShelf) {
        await deleteSharedShelf(s.syncConfig, normalized);
      } else {
        await leaveSharedShelf(s.syncConfig, normalized, actorId);
      }
      const nextShelves = stateRef.current.sharedShelves.filter(
        (sh) => sh.code.trim().toUpperCase() !== normalized
      );
      stateRef.current.sharedShelves = nextShelves;
      setSharedShelves(nextShelves);
      setSelectedShelfCode((curr) => {
        const next = curr === normalized ? '' : curr;
        if (next !== curr) dbSetKV('selectedShelfCode', next).catch(() => undefined);
        return next;
      });
      await Promise.all([
        persistJoinedShelfCodes(joinedShelfCodesRef.current.filter((c) => c !== normalized)),
        persistSharedShelvesCache(nextShelves),
      ]);
      scheduleAutoSync(true, 'shared');
      showToast(
        deleteEntireShelf
          ? `Estantería ${normalized} cerrada para todos`
          : `Saliste de la estantería ${normalized}`
      );
    },
    [persistClosedShelfCodes, persistJoinedShelfCodes, persistSharedShelvesCache, scheduleAutoSync, showToast]
  );

  const kickUserFromShelf = useCallback(
    async (code: string, targetMemberId: string, targetName?: string) => {
      const s = stateRef.current;
      const targetShelf = s.sharedShelves.find((sh) => sh.code === code);
      const requesterId =
        targetShelf?.hostId === s.deviceId ? s.deviceId : s.sharedUserId || s.deviceId;
      try {
        const updated = await kickShelfMember(s.syncConfig, code, requesterId, targetMemberId);
        updateLocalShelf(updated);
        showToast(`${targetName || 'Usuario'} fue eliminado de la estantería ${code}`);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'No se pudo eliminar al usuario de la estantería'
        );
      }
    },
    [showToast, updateLocalShelf]
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
        chatSessions,
        activeChatSessionId,
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
        missingFileBook,
        setMissingFileBook,
        importModalOpen,
        setImportModalOpen,
        studioModalOpen,
        setStudioModalOpen,
        profileModalOpen,
        setProfileModalOpen,
        importFiles,
        importNativeFolderBooks,
        duplicateBooksCount,
        removeDuplicateBooks,
        attachLocalFileToBook,
        updateBook,
        reExtractBookCover,
        identifyBookWithAI,
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
        startNewChatSession,
        selectChatSession,
        deleteChatSession,
        aiOnline,
        aiModelName,
        deviceId,
        sharedUserId,
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
        syncPopup,
        dismissSyncPopup,
        offlineSyncProgress,
        triggerSync,
        syncAllBookFilesForOffline,
        googleDriveAuth,
        connectGoogleDrive,
        disconnectGoogleDrive,
        loginWithEmail,
        logoutAccount,
        exportBackupJson,
        shareBackupJson,
        importBackupJson,
        importExternalBackup,
        sharedRooms,
        selectedRoomCode,
        setSelectedRoomCode: selectRoomCode,
        pendingJoinCode,
        setPendingJoinCode,
        refreshSharedRooms,
        createRoomForBook,
        joinRoomByCode,
        sendRoomComment,
        leaveOrDeleteRoom,
        kickUserFromRoom,
        updateLocalRoom,
        removeLocalRoom,
        sharedShelves,
        selectedShelfCode,
        setSelectedShelfCode: selectShelfCode,
        pendingShelfCode,
        setPendingShelfCode,
        refreshSharedShelves,
        createMutualShelf,
        joinShelfByCode,
        shareBooksToShelf,
        removeBookFromSharedShelf,
        importBookFromShelf,
        leaveOrDeleteShelf,
        kickUserFromShelf,
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
