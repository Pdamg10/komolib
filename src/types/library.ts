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

export type NavSection =
  | 'home'
  | 'dashboard'
  | 'reading-log'
  | 'annotations'
  | 'shared'
  | 'favorites'
  | 'wishlist'
  | 'reading'
  | 'collections';

export type ReadingStatus = 'completed' | 'reading' | 'want_to_read' | 'on_hold' | 'dropped';

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
  hasOriginalCover?: boolean;
  coverCheckedV2?: boolean;
  coverCheckedV3?: boolean;
  spineColor: string;
  ribbonColor: string;
  fileName: string;
  folderPath?: string;
  fileSize: number;
  mimeType: string;
  pageCount?: number;
  durationSec?: number; // for audiobooks
  // Progress
  progress: number; // 0 to 100
  currentPage?: number;
  currentCfi?: string; // EPUB CFI
  currentChapter?: string; // Last known chapter title
  scrollRatio?: number; // vertical scroll ratio
  audioTime?: number;
  activeBookmarkDesignId?: string; // Visual bookmark clipped inside this book
  // Flags & Reading Log
  favorite: boolean;
  wishlist: boolean;
  isDemo?: boolean;
  rating?: number; // 0 to 5
  readingStatus?: ReadingStatus;
  review?: string;
  startedAt?: number;
  finishedAt?: number;
  lastChapterFinishedAt?: number;
  lastChapterFinishedTitle?: string;
  seriesName?: string;
  seriesOrder?: number;
  // Sync metadata
  hasLocalFile: boolean;
  nativeFileUri?: string; // Persistent Android SAF content:// URI for zero-duplication folder imports
  hasRemoteFile?: boolean;
  remoteFileName?: string;
  driveFileId?: string; // Google Drive file ID inside user's Komolib/Libros folder
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

export interface BookmarkDesign {
  id: string;
  name: string;
  imageUrl: string;
  accentColor: string;
  builtin?: boolean;
  createdAt?: number;
}

export interface BookmarkItem {
  id: string;
  bookId: string;
  label: string;
  chapter?: string;
  chapterHref?: string;
  page?: number;
  progress?: number;
  cfi?: string;
  scrollRatio?: number;
  excerpt?: string;
  designId?: string;
  createdAt: number;
}

export type AnnotationTool =
  | 'highlighter'
  | 'pencil'
  | 'pen'
  | 'postit'
  | 'sticker'
  | 'emoji';

export interface BookAnnotation {
  id: string;
  bookId: string;
  tool: AnnotationTool;
  color: string;
  styleVariant?: string; // e.g. pastel, neon, wavy, dashed, fine, double, box, classic, tab, kraft, translucent
  quote: string;
  note?: string;
  sticker?: string;
  chapter?: string;
  chapterHref?: string;
  page?: number;
  progress: number;
  cfi?: string;
  scrollRatio?: number;
  pageX?: number;
  pageY?: number;
  bookmarkDesignId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReaderJumpTarget {
  id: string;
  bookId: string;
  chapterHref?: string;
  cfi?: string;
  page?: number;
  scrollRatio?: number;
  quote?: string;
  annotationId?: string;
}

export interface CustomSwatchItem {
  id: string;
  tool: 'highlighter' | 'pencil' | 'pen' | 'postit';
  color: string;
  name: string;
  meaning: string;
}

export interface CustomStickerItem {
  id: string;
  emoji: string;
  label: string;
  color: string;
  group: 'emociones' | 'trama' | 'estetica';
}

export interface CustomStationeryKit {
  swatches: CustomSwatchItem[];
  stickers: CustomStickerItem[];
  emojis: string[];
}

export interface ShareMarksSelection {
  enabled: boolean;
  tools: AnnotationTool[];
  includeBookmarks: boolean;
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

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ReaderSettings {
  theme: 'cream' | 'paper' | 'sepia' | 'dark' | 'oled';
  fontFamily: 'Lora' | 'Nunito' | 'Quicksand' | 'Inter' | 'Georgia' | 'monospace';
  fontSize: number; // px
  lineHeight: number;
  maxWidth: number; // px
  textAlign: 'left' | 'justify';
  comicMode: ComicReadMode;
  comicFit: 'contain' | 'width' | 'height' | 'original';
  comicGap: number; // px between manhwa/comic panels
  pdfFlow?: 'continuous' | 'paginated';
  pdfFit?: 'width' | 'contain';
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
  fullView?: boolean;
  viewMode: 'shelf' | 'grid' | 'list';
  sortBy?: 'recent' | 'title' | 'author' | 'imported' | 'folder';
  sortDir?: 'asc' | 'desc';
  readingFilter?: 'all' | 'unread' | 'reading' | 'completed';
  lowPerformanceMode?: 'auto' | 'on' | 'off';
  customWallpaperUrl: string;
  wallpaperOpacity?: number; // 0.45 - 0.96 glass panel opacity over wallpaper
  wallpaperBlur?: number; // 0 - 24 px backdrop blur
  bannerTitle: string;
  bannerSubtitle: string;
}

export interface UserProfile {
  name: string;
  email?: string;
  avatarEmoji: string;
  avatarBg: string;
  avatarImageUrl?: string;
  booksGoalPerMonth?: number;
  pagesGoalPerMonth?: number;
  goalsUpdatedAt?: number;
  booksGoalPerYear?: number;
  pagesGoalPerYear?: number;
}

export interface GoogleDriveAuth {
  email: string;
  name: string;
  picture?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  rootFolderId?: string;
  booksFolderId?: string;
  stateFileId?: string;
}

export interface SyncConfig {
  serverUrl: string;
  publicUrl?: string;
  spaceId?: string; // Private per-user vault ID for isolated personal cloud/server sync
  accountEmail?: string; // User email linked to cloud backup vault
  token: string;
  autoSync: boolean;
  liveSync?: boolean;
  lastSyncedAt: number;
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
}

export interface ActiveReadingSession {
  bookId: string;
  title: string;
  author: string;
  progress: number;
  currentPage?: number;
  deviceId: string;
  deviceName: string;
  updatedAt: number;
}

export interface SharedParticipant {
  id: string;
  name: string;
  avatarEmoji: string;
  avatarBg: string;
  progress: number;
  currentPage?: number;
  pageCount?: number;
  readingStatus?: ReadingStatus;
  joinedAt: number;
  lastSeenAt: number;
}

export interface SharedComment {
  id: string;
  participantId: string;
  authorName: string;
  avatarEmoji: string;
  text: string;
  progressAt: number;
  pageAt?: number;
  createdAt: number;
}

export interface SharedRoom {
  code: string;
  bookId: string;
  bookMeta: {
    id: string;
    title: string;
    author: string;
    description?: string;
    format: BookFormat;
    kind: ContentKind;
    categories: string[];
    tags: string[];
    coverDataUrl: string;
    hasOriginalCover?: boolean;
    spineColor: string;
    ribbonColor: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    pageCount?: number;
    hasRemoteFile?: boolean;
    remoteFileName?: string;
    sharedAnnotations?: BookAnnotation[];
    sharedBookmarks?: BookmarkItem[];
  };
  hostId: string;
  hostName: string;
  createdAt: number;
  updatedAt: number;
  participants: Record<string, SharedParticipant>;
  kickedIds?: string[];
  comments: SharedComment[];
}

export interface SharedShelfBook {
  bookId: string;
  ownerId: string;
  ownerName: string;
  title: string;
  author: string;
  description?: string;
  format: BookFormat;
  kind: ContentKind;
  categories: string[];
  tags: string[];
  coverDataUrl: string;
  hasOriginalCover?: boolean;
  spineColor: string;
  ribbonColor: string;
  fileName: string;
  folderPath?: string;
  fileSize: number;
  mimeType: string;
  pageCount?: number;
  hasRemoteFile?: boolean;
  remoteFileName?: string;
  sharedAnnotations?: BookAnnotation[];
  sharedBookmarks?: BookmarkItem[];
  sharedAt: number;
}

export interface SharedShelf {
  code: string;
  title: string;
  hostId: string;
  hostName: string;
  createdAt: number;
  updatedAt: number;
  members: Record<
    string,
    { id: string; name: string; avatarEmoji: string; avatarBg: string; joinedAt: number }
  >;
  kickedIds?: string[];
  books: Record<string, SharedShelfBook>;
}
