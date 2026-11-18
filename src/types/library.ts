export type BookFormat =
  | 'epub'
  | 'pdf'
  | 'cbz'
  | 'cbr'
  | 'images'
  | 'txt'
  | 'md'
  | 'html'
  | 'fb2'
  | 'mobi'
  | 'azw3'
  | 'docx'
  | 'audio';

export type ContentKind = 'book' | 'manga' | 'manhwa' | 'comic' | 'audiobook';

export type ComicReadMode =
  | 'manhwa-strip' // Seamless vertical scroll
  | 'manga-rtl' // Right-to-left single page
  | 'manga-rtl-double' // Right-to-left 2-page spread
  | 'comic-ltr' // Left-to-right single page
  | 'comic-ltr-double'; // Left-to-right 2-page spread

export type NavSection = 'home' | 'favorites' | 'wishlist' | 'reading' | 'collections';

export interface BookItem {
  id: string;
  title: string;
  author: string;
  description?: string;
  format: BookFormat;
  kind: ContentKind;
  categories: string[];
  tags: string[];
  coverDataUrl: string;
  spineColor: string;
  ribbonColor: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  pageCount?: number;
  durationSec?: number; // for audiobooks
  // Progress
  progress: number; // 0 to 100
  currentPage?: number;
  currentCfi?: string; // EPUB CFI
  scrollRatio?: number; // vertical scroll ratio
  audioTime?: number;
  // Flags
  favorite: boolean;
  wishlist: boolean;
  isDemo?: boolean;
  rating?: number;
  // Sync metadata
  hasLocalFile: boolean;
  hasRemoteFile?: boolean;
  remoteFileName?: string;
  addedAt: number;
  lastReadAt?: number;
  updatedAt: number;
}

export interface CategoryItem {
  id: string;
  label: string;
  icon: string; // key into custom SVG icon set
  color: string;
  accent: string;
  filterKind?: ContentKind;
  builtin?: boolean;
}

export interface CollectionCard {
  id: string;
  title: string;
  subtitle: string;
  icon: 'blocks' | 'classic' | 'ufo' | 'manga' | 'heart' | 'sparkle';
  filterCategory?: string;
  filterKind?: ContentKind;
}

export interface BookmarkItem {
  id: string;
  bookId: string;
  label: string;
  page?: number;
  cfi?: string;
  scrollRatio?: number;
  excerpt?: string;
  createdAt: number;
}

export interface NoteItem {
  id: string;
  bookId: string;
  text: string;
  page?: number;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  bookIds?: string[];
  createdAt: number;
}

export interface ReaderSettings {
  theme: 'cream' | 'paper' | 'sepia' | 'dark' | 'oled';
  fontFamily: 'Lora' | 'Nunito' | 'Quicksand' | 'Inter' | 'Georgia' | 'monospace';
  fontSize: number; // px
  lineHeight: number;
  maxWidth: number; // px
  textAlign: 'left' | 'justify';
  comicMode: ComicReadMode;
  comicFit: 'width' | 'height' | 'original';
  comicGap: number; // px between manhwa/comic panels
  brightness: number; // 50 - 120
  warmth: number; // 0 - 60 (blue light filter)
  epubFlow: 'scrolled' | 'paginated';
}

export interface ThemeConfig {
  presetId: string;
  appName: string;
  // Palette
  outerBg: string;
  shellBg: string;
  sidebarBg: string;
  panelBg: string;
  cardBg: string;
  bannerBg: string;
  textPrimary: string;
  textMuted: string;
  authorColor: string;
  accentPrimary: string;
  accentSecondary: string;
  sidebarPillBg: string;
  sidebarPillLabel: string;
  searchGradient: string;
  chatUserBubble: string;
  chatBotBubble: string;
  // Typography & Shape
  fontFamily: 'Quicksand' | 'Nunito' | 'Fredoka' | 'Inter' | 'Lora';
  uiScale: number; // 0.9 - 1.15
  borderRadius: number; // 10 - 34
  // Visual Toggles
  showRightPanel: boolean;
  showBanner: boolean;
  showCategories: boolean;
  showBookPages3D: boolean;
  showBookRibbons: boolean;
  showDoodlePattern: boolean;
  compactSidebar: boolean;
  viewMode: 'shelf' | 'grid';
  customWallpaperUrl: string;
  bannerTitle: string;
  bannerSubtitle: string;
}

export interface UserProfile {
  name: string;
  avatarEmoji: string;
  avatarBg: string;
  avatarImageUrl?: string;
}

export interface SyncConfig {
  serverUrl: string;
  token: string;
  autoSync: boolean;
  lastSyncedAt: number;
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
}
