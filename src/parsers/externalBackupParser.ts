import JSZip from 'jszip';
import type {
  AnnotationTool,
  BookFormat,
  ContentKind,
  ReadingStatus,
} from '../types/library';

export interface ImportedExternalBook {
  title: string;
  author: string;
  description?: string;
  progress?: number; // 0..100
  currentPage?: number;
  pageCount?: number;
  currentChapter?: string;
  currentCfi?: string;
  readingStatus?: ReadingStatus;
  favorite?: boolean;
  wishlist?: boolean;
  rating?: number; // 0..5
  review?: string;
  kind?: ContentKind;
  format?: BookFormat;
  categories?: string[];
  tags?: string[];
  startedAt?: number;
  finishedAt?: number;
  lastReadAt?: number;
  fileName?: string;
  folderPath?: string;
  coverDataUrl?: string;
  thumbFile?: string;
  coverFile?: string;
}

export interface ImportedExternalBookmark {
  bookTitle: string;
  bookAuthor?: string;
  label: string;
  chapter?: string;
  page?: number;
  progress?: number;
  cfi?: string;
  excerpt?: string;
  createdAt?: number;
}

export interface ImportedExternalAnnotation {
  bookTitle: string;
  bookAuthor?: string;
  quote: string;
  note?: string;
  chapter?: string;
  page?: number;
  progress?: number;
  cfi?: string;
  color?: string;
  tool?: AnnotationTool;
  createdAt?: number;
}

export interface ImportedExternalNote {
  bookTitle: string;
  bookAuthor?: string;
  text: string;
  page?: number;
  createdAt?: number;
}

export interface ParsedExternalBackup {
  detectedSource: string;
  fileName: string;
  books: ImportedExternalBook[];
  bookmarks: ImportedExternalBookmark[];
  annotations: ImportedExternalAnnotation[];
  notes: ImportedExternalNote[];
  warnings: string[];
  nativeKomoLibData?: Record<string, unknown>;
}

const KNOWN_FORMATS = new Set<BookFormat>([
  'epub',
  'pdf',
  'cbz',
  'cbr',
  'images',
  'txt',
  'md',
  'html',
  'fb2',
  'mobi',
  'azw3',
  'docx',
  'audio',
]);

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/%/g, '').replace(',', '.').trim();
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const low = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí', 'y', 'favorite', 'favorito'].includes(low)) return true;
    if (['false', '0', 'no', 'n'].includes(low)) return false;
  }
  return undefined;
}

function parseTimestamp(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    // Convert unix seconds to ms if needed
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === 'string' && v.trim()) {
    const asNum = Number(v.trim());
    if (Number.isFinite(asNum) && asNum > 100000000) {
      return asNum < 1e12 ? Math.round(asNum * 1000) : Math.round(asNum);
    }
    const parsed = Date.parse(v.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampProgress(raw: number | undefined): number | undefined {
  if (raw === undefined || !Number.isFinite(raw)) return undefined;
  // Handle 0..1 fractional progress (e.g. 0.42 -> 42%)
  const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

function normalizeStatus(raw: unknown, progress?: number): ReadingStatus | undefined {
  const s = str(raw).toLowerCase();
  if (s) {
    if (/(complet|finish|have_read|read\b|le[ií]do|terminad|done)/.test(s) && !/to[-_\s]?read|want|por leer|unread/.test(s)) {
      return 'completed';
    }
    if (/(reading|currently|leyendo|in[-_\s]?progress|active|en curso)/.test(s)) {
      return 'reading';
    }
    if (/(want|to[-_\s]?read|wishlist|plan|por leer|pendiente|unread|tbr)/.test(s)) {
      return 'want_to_read';
    }
    if (/(hold|paus|espera|paused)/.test(s)) {
      return 'on_hold';
    }
    if (/(drop|dnf|abandon|abandoned)/.test(s)) {
      return 'dropped';
    }
  }
  if (progress !== undefined) {
    if (progress >= 99) return 'completed';
    if (progress > 0) return 'reading';
  }
  return undefined;
}

function normalizeFormat(raw: unknown, fileName = ''): BookFormat | undefined {
  const candidate = (str(raw) || fileName.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  if (candidate === 'zip') return 'cbz';
  if (candidate === 'rar') return 'cbr';
  if (candidate === 'azw' || candidate === 'prc') return 'mobi';
  if (candidate === 'htm') return 'html';
  if (candidate === 'mp3' || candidate === 'm4b' || candidate === 'm4a' || candidate === 'ogg' || candidate === 'wav') {
    return 'audio';
  }
  if (KNOWN_FORMATS.has(candidate as BookFormat)) return candidate as BookFormat;
  return undefined;
}

function normalizeKind(raw: unknown, title = '', format?: BookFormat): ContentKind | undefined {
  const s = `${str(raw)} ${title}`.toLowerCase();
  if (format === 'audio' || /audiobook|audiolibro/.test(s)) return 'audiobook';
  if (/manhwa|webtoon|manhua/.test(s)) return 'manhwa';
  if (/manga/.test(s)) return 'manga';
  if (/comic|c[oó]mic/.test(s)) return 'comic';
  if (format === 'cbz' || format === 'cbr') return 'manga';
  return undefined;
}

function normalizeColor(raw: unknown): string {
  const s = str(raw);
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^rgb/i.test(s)) return s;
  // Android signed/unsigned ARGB integer colors (Moon+ Reader / ReadEra / Lithium)
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const rgb = (raw >>> 0) & 0xffffff;
    return `#${rgb.toString(16).padStart(6, '0')}`;
  }
  const low = s.toLowerCase();
  if (low.includes('yellow') || low.includes('amarill')) return '#ffe066';
  if (low.includes('green') || low.includes('verd')) return '#95d5b2';
  if (low.includes('blue') || low.includes('azul')) return '#90cdf4';
  if (low.includes('pink') || low.includes('rosa') || low.includes('red') || low.includes('rojo')) return '#f7a8b8';
  if (low.includes('purple') || low.includes('morad') || low.includes('violet')) return '#c7b8f5';
  if (low.includes('orange') || low.includes('naranj')) return '#f6bd60';
  return '#ffe066';
}

function cleanBookTitleFromPath(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || raw;
  return base
    .replace(/\.(po|mrexpt|jpg|jpeg|png|webp|thumb|tn)$/i, '')
    .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|zip|rar|txt|docx|md|html?)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFolderFromPath(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  parts.pop(); // remove filename
  const ignored = new Set([
    'storage',
    'emulated',
    '0',
    '1',
    'sdcard',
    'mnt',
    'internal',
    'external',
    'android',
    'data',
    'files',
    'cache',
    '.moon+',
  ]);
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    if (!ignored.has(seg.toLowerCase()) && !seg.startsWith('.')) {
      return seg;
    }
  }
  return undefined;
}

function normalizeMatchKey(raw: string): string {
  return cleanBookTitleFromPath(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isUnknownAuthor(author?: string): boolean {
  if (!author) return true;
  const low = author.trim().toLowerCase();
  return (
    !low ||
    low === 'autor desconocido' ||
    low === 'unknown' ||
    low === 'unknown author' ||
    low === 'desconocido' ||
    low === 'anónimo' ||
    low === 'anonimo' ||
    low === 'n/a' ||
    low === 'none' ||
    low === 'null' ||
    low === 'biblioteca personal'
  );
}

/**
 * Best-effort author extraction from common ebook filenames when DB metadata lacks an author:
 * e.g. "El nombre del viento - Patrick Rothfuss.epub", "[Brandon Sanderson] Elantris.epub",
 * "Dune (Frank Herbert).epub"
 */
function inferAuthorFromName(raw: string): { cleanTitle?: string; author?: string } {
  const stem = cleanBookTitleFromPath(raw);
  if (!stem) return {};

  // Pattern 1: "[Author] Title"
  const bracketMatch = stem.match(/^\[([^\[\]]{2,55})\]\s+(.{2,})$/);
  if (bracketMatch) {
    const candAuthor = bracketMatch[1].trim();
    const candTitle = bracketMatch[2].trim();
    if (!/^\d+$|epub|pdf|scan|hq|esp|eng|vol\.?\s*\d+/i.test(candAuthor)) {
      return { cleanTitle: candTitle, author: candAuthor };
    }
  }

  // Pattern 2: "Title (Author)"
  const parenMatch = stem.match(/^(.{2,}?)\s*\(([^()]{3,55})\)\s*$/);
  if (parenMatch) {
    const candTitle = parenMatch[1].trim();
    const candAuthor = parenMatch[2].trim();
    if (
      !/^\d{4}$|epub|pdf|edition|edici[oó]n|spanish|espa[ñn]ol|english|vol\.?\s*\d+|libro\s*\d+|book\s*\d+|trilog|saga|serie|completo/i.test(
        candAuthor
      ) &&
      /[a-zA-ZÀ-ÿ]{2,}\s+[a-zA-ZÀ-ÿ]{2,}/.test(candAuthor)
    ) {
      return { cleanTitle: candTitle, author: candAuthor };
    }
  }

  // Pattern 3: "Title - Author" (spaced hyphen / em-dash)
  const dashParts = stem.split(/\s+[-–—]\s+/);
  if (dashParts.length === 2) {
    const left = dashParts[0].trim();
    const right = dashParts[1].trim();
    const looksLikePerson = (s: string) =>
      s.length >= 4 &&
      s.length <= 50 &&
      !/^\d+$|vol\.?\s*\d+|tomo\s*\d+|libro\s*\d+|cap[ií]tulo|parte\s*\d+|epub|pdf/i.test(s) &&
      /^[A-ZÀ-Ýa-zà-ÿ.,'\s-]+$/.test(s);
    if (looksLikePerson(right) && left.length >= 2) {
      return { cleanTitle: left, author: right };
    }
  }

  return {};
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      return obj[k];
    }
  }
  // Case-insensitive fallback
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') {
      lowerMap.set(k.toLowerCase().replace(/[^a-z0-9]/g, ''), v);
    }
  }
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lowerMap.has(norm)) return lowerMap.get(norm);
  }
  return undefined;
}

function createEmptyResult(fileName: string, detectedSource = 'Copia de seguridad'): ParsedExternalBackup {
  return {
    detectedSource,
    fileName,
    books: [],
    bookmarks: [],
    annotations: [],
    notes: [],
    warnings: [],
  };
}

function mergeResults(target: ParsedExternalBackup, incoming: ParsedExternalBackup) {
  target.books.push(...incoming.books);
  target.bookmarks.push(...incoming.bookmarks);
  target.annotations.push(...incoming.annotations);
  target.notes.push(...incoming.notes);
  target.warnings.push(...incoming.warnings);
  if (incoming.nativeKomoLibData && !target.nativeKomoLibData) {
    target.nativeKomoLibData = incoming.nativeKomoLibData;
  }
}

function dedupeResult(result: ParsedExternalBackup): ParsedExternalBackup {
  const bookMap = new Map<string, ImportedExternalBook>();
  const fileKeyToBookKey = new Map<string, string>();

  for (const b of result.books) {
    let title = b.title.trim();
    if (!title) continue;
    let author = (b.author || '').trim();
    if (isUnknownAuthor(author)) {
      const inferred = inferAuthorFromName(b.fileName || title);
      if (inferred.author) {
        author = inferred.author;
        if (inferred.cleanTitle && title === cleanBookTitleFromPath(b.fileName || title)) {
          title = inferred.cleanTitle;
        }
      } else {
        author = 'Autor desconocido';
      }
    }

    const titleKey = normalizeMatchKey(title) || title.toLowerCase();
    const fileKey = b.fileName ? normalizeMatchKey(b.fileName) : '';

    const matchedKey =
      (fileKey && fileKeyToBookKey.get(fileKey)) ||
      (bookMap.has(titleKey) ? titleKey : '') ||
      (fileKey && bookMap.has(fileKey) ? fileKey : '');

    const prev = matchedKey ? bookMap.get(matchedKey) : undefined;
    if (!prev) {
      const entry: ImportedExternalBook = {
        ...b,
        title,
        author,
      };
      bookMap.set(titleKey, entry);
      if (fileKey) fileKeyToBookKey.set(fileKey, titleKey);
    } else {
      const prevAuthorReal = !isUnknownAuthor(prev.author);
      const nextAuthorReal = !isUnknownAuthor(author);
      const mergedAuthor = prevAuthorReal
        ? prev.author
        : nextAuthorReal
        ? author
        : prev.author || 'Autor desconocido';
      // Prefer a cleaner title (e.g. OPF real title over raw filename) when the incoming record also carries real metadata
      const mergedTitle =
        nextAuthorReal && !prevAuthorReal && title.length >= 2 && !/\.(epub|pdf)$/i.test(title)
          ? title
          : prev.title;

      const pickBestCover = (a?: string, b?: string): string | undefined => {
        const aReal = Boolean(a && !a.startsWith('data:image/svg+xml') && a !== '__KEEP__');
        const bReal = Boolean(b && !b.startsWith('data:image/svg+xml') && b !== '__KEEP__');
        if (aReal) return a;
        if (bReal) return b;
        return a || b;
      };

      const merged: ImportedExternalBook = {
        ...prev,
        ...b,
        title: mergedTitle,
        author: mergedAuthor,
        description: prev.description || b.description,
        coverDataUrl: pickBestCover(prev.coverDataUrl, b.coverDataUrl),
        thumbFile: prev.thumbFile || b.thumbFile,
        coverFile: prev.coverFile || b.coverFile,
        fileName: prev.fileName || b.fileName,
        folderPath: prev.folderPath || b.folderPath,
        format: prev.format || b.format,
        progress: Math.max(prev.progress || 0, b.progress || 0) || prev.progress || b.progress,
        currentPage: b.currentPage ?? prev.currentPage,
        pageCount: b.pageCount ?? prev.pageCount,
        rating: b.rating ?? prev.rating,
        review: b.review || prev.review,
        favorite: prev.favorite || b.favorite,
        wishlist: prev.wishlist || b.wishlist,
        startedAt: prev.startedAt || b.startedAt,
        finishedAt: prev.finishedAt || b.finishedAt,
        lastReadAt: Math.max(prev.lastReadAt || 0, b.lastReadAt || 0) || prev.lastReadAt,
        categories: Array.from(new Set([...(prev.categories || []), ...(b.categories || [])])),
        tags: Array.from(new Set([...(prev.tags || []), ...(b.tags || [])])),
      };
      bookMap.set(matchedKey, merged);
      if (fileKey) fileKeyToBookKey.set(fileKey, matchedKey);
      if (titleKey && !bookMap.has(titleKey)) {
        fileKeyToBookKey.set(titleKey, matchedKey);
      }
    }
  }

  // Ensure every book referenced by bookmarks/annotations/notes exists in books list
  const ensureBook = (title: string, author?: string) => {
    const clean = title.trim();
    if (!clean) return;
    const key = normalizeMatchKey(clean) || clean.toLowerCase();
    if (!bookMap.has(key) && !fileKeyToBookKey.has(key)) {
      const inferred = isUnknownAuthor(author) ? inferAuthorFromName(clean) : {};
      bookMap.set(key, {
        title: inferred.cleanTitle || clean,
        author: (!isUnknownAuthor(author) ? author!.trim() : inferred.author) || 'Autor desconocido',
      });
    }
  };

  const bmSeen = new Set<string>();
  const bookmarks: ImportedExternalBookmark[] = [];
  for (const bm of result.bookmarks) {
    if (!bm.bookTitle.trim()) continue;
    ensureBook(bm.bookTitle, bm.bookAuthor);
    const sig = `${bm.bookTitle.toLowerCase()}|${bm.label.toLowerCase()}|${bm.page ?? ''}|${bm.cfi ?? ''}`;
    if (bmSeen.has(sig)) continue;
    bmSeen.add(sig);
    bookmarks.push(bm);
  }

  const annSeen = new Set<string>();
  const annotations: ImportedExternalAnnotation[] = [];
  for (const ann of result.annotations) {
    if (!ann.bookTitle.trim() || (!ann.quote.trim() && !ann.note?.trim())) continue;
    ensureBook(ann.bookTitle, ann.bookAuthor);
    const sig = `${ann.bookTitle.toLowerCase()}|${ann.quote.slice(0, 80).toLowerCase()}|${ann.note?.slice(0, 60).toLowerCase() ?? ''}`;
    if (annSeen.has(sig)) continue;
    annSeen.add(sig);
    annotations.push(ann);
  }

  const noteSeen = new Set<string>();
  const notes: ImportedExternalNote[] = [];
  for (const n of result.notes) {
    if (!n.bookTitle.trim() || !n.text.trim()) continue;
    ensureBook(n.bookTitle, n.bookAuthor);
    const sig = `${n.bookTitle.toLowerCase()}|${n.text.slice(0, 100).toLowerCase()}`;
    if (noteSeen.has(sig)) continue;
    noteSeen.add(sig);
    notes.push(n);
  }

  return {
    ...result,
    books: Array.from(bookMap.values()),
    bookmarks,
    annotations,
    notes,
    warnings: Array.from(new Set(result.warnings)),
  };
}

function extractBookFromRecord(rec: Record<string, unknown>): ImportedExternalBook | null {
  const rawTitle = str(
    pick(rec, [
      'title',
      'doc_title',
      'book_title',
      'bookTitle',
      'name',
      'titulo',
      'título',
      'nombre',
      'bookName',
      'doc_file_name_title',
      'filename',
      'fileName',
      'file_name',
      'path',
    ])
  );
  if (!rawTitle) return null;
  const title = /[\\/]|\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx)$/i.test(rawTitle)
    ? cleanBookTitleFromPath(rawTitle)
    : rawTitle;
  if (!title) return null;

  const rawAuthor = pick(rec, [
    'author',
    'authors',
    'doc_authors',
    'book_author',
    'autor',
    'autores',
    'creator',
    'writer',
    'artist',
  ]);
  const author = Array.isArray(rawAuthor)
    ? rawAuthor.map((a) => str(a)).filter(Boolean).join(', ')
    : str(rawAuthor) || 'Autor desconocido';

  const currentPage = num(
    pick(rec, ['currentPage', 'current_page', 'page', 'last_page', 'pagina', 'página', 'read_pages', 'pages_read', 'lastReadPage'])
  );
  const pageCount = num(
    pick(rec, ['pageCount', 'page_count', 'pages', 'total_pages', 'totalPages', 'num_pages', 'number_of_pages', 'paginas', 'páginas'])
  );

  let progress = clampProgress(
    num(
      pick(rec, [
        'progress',
        'progreso',
        'percent',
        'percentage',
        'read_percent',
        'percent_finished',
        'reading_progress',
        'porcentaje',
        'completion',
      ])
    )
  );
  if (progress === undefined && currentPage !== undefined && pageCount && pageCount > 0) {
    progress = clampProgress((currentPage / pageCount) * 100);
  }

  // Handle Tachiyomi/Mihon chapters array inside backupManga
  if (progress === undefined && Array.isArray(rec.chapters) && rec.chapters.length > 0) {
    const chs = rec.chapters as Array<Record<string, unknown>>;
    const readCount = chs.filter((c) => Boolean(c?.read)).length;
    if (readCount > 0) {
      progress = clampProgress((readCount / chs.length) * 100);
    }
  }

  const rawStatus = pick(rec, [
    'readingStatus',
    'reading_status',
    'status',
    'estado',
    'exclusive_shelf',
    'exclusiveShelf',
    'shelf',
    'bookshelf',
    'read_status',
  ]);
  const haveRead = bool(pick(rec, ['have_read', 'haveRead', 'is_read', 'finished', 'completed']));
  const readingNow = bool(pick(rec, ['reading_now', 'readingNow', 'is_reading']));
  const toRead = bool(pick(rec, ['to_read', 'toRead', 'want_to_read', 'wishlist']));

  let readingStatus = normalizeStatus(rawStatus, progress);
  if (!readingStatus) {
    if (haveRead) readingStatus = 'completed';
    else if (readingNow) readingStatus = 'reading';
    else if (toRead) readingStatus = 'want_to_read';
  }
  if (readingStatus === 'completed' && (progress === undefined || progress === 0)) {
    progress = 100;
  }

  const favorite =
    bool(pick(rec, ['favorite', 'favourite', 'is_favorite', 'isFavorite', 'favorito', 'starred'])) ||
    undefined;
  const wishlist = toRead || readingStatus === 'want_to_read' || undefined;

  const rawRating = num(pick(rec, ['rating', 'my_rating', 'myRating', 'stars', 'calificacion', 'calificación', 'score']));
  const rating =
    rawRating !== undefined && rawRating > 0
      ? Math.min(5, rawRating > 5 ? Math.round((rawRating / 2) * 10) / 10 : Math.round(rawRating))
      : undefined;

  const fileName = str(pick(rec, ['fileName', 'file_name', 'filename', 'doc_file_name', 'path']));
  const format = normalizeFormat(pick(rec, ['format', 'doc_format', 'formato', 'ext', 'mimeType']), fileName);
  const kind = normalizeKind(pick(rec, ['kind', 'type', 'media_type', 'tipo', 'genre', 'genres']), title, format);

  const rawTags = pick(rec, ['tags', 'genres', 'categories', 'shelves', 'bookshelves', 'etiquetas', 'categorias', 'categorías']);
  const tags = Array.isArray(rawTags)
    ? rawTags.map((t) => str(t)).filter(Boolean)
    : str(rawTags)
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter(Boolean);

  return {
    title,
    author,
    description: str(pick(rec, ['description', 'synopsis', 'summary', 'descripcion', 'descripción'])) || undefined,
    progress,
    currentPage: currentPage !== undefined ? Math.round(currentPage) : undefined,
    pageCount: pageCount !== undefined ? Math.round(pageCount) : undefined,
    currentChapter: str(pick(rec, ['currentChapter', 'current_chapter', 'chapter', 'capitulo', 'capítulo'])) || undefined,
    currentCfi: str(pick(rec, ['currentCfi', 'cfi', 'epubcfi', 'position'])) || undefined,
    readingStatus,
    favorite,
    wishlist,
    rating,
    review: str(pick(rec, ['review', 'my_review', 'myReview', 'resena', 'reseña'])) || undefined,
    kind,
    format,
    tags: tags.length ? tags : undefined,
    startedAt: parseTimestamp(pick(rec, ['startedAt', 'started_at', 'date_started', 'dateStarted'])),
    finishedAt: parseTimestamp(pick(rec, ['finishedAt', 'finished_at', 'date_read', 'dateRead', 'completed_at'])),
    lastReadAt: parseTimestamp(pick(rec, ['lastReadAt', 'last_read_at', 'last_read_time', 'lastRead', 'updatedAt', 'updated_at'])),
    fileName: fileName || undefined,
  };
}

function extractMarksFromNested(
  rec: Record<string, unknown>,
  bookTitle: string,
  bookAuthor: string,
  out: ParsedExternalBackup
) {
  // Nested bookmarks
  const bmList = pick(rec, ['bookmarks', 'marcadores', 'positions', 'saved_positions']);
  if (Array.isArray(bmList)) {
    for (const item of bmList) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const page = num(pick(obj, ['page', 'page_number', 'pagina', 'página']));
      const progress = clampProgress(num(pick(obj, ['progress', 'percent', 'progreso'])));
      const chapter = str(pick(obj, ['chapter', 'chapter_title', 'capitulo', 'capítulo']));
      const label =
        str(pick(obj, ['label', 'title', 'name', 'note', 'text', 'excerpt'])) ||
        (page ? `Página ${Math.round(page)}` : progress !== undefined ? `${Math.round(progress)}%` : 'Marcador importado');
      out.bookmarks.push({
        bookTitle,
        bookAuthor,
        label,
        chapter: chapter || undefined,
        page: page !== undefined ? Math.round(page) : undefined,
        progress,
        cfi: str(pick(obj, ['cfi', 'epubcfi', 'position'])) || undefined,
        excerpt: str(pick(obj, ['excerpt', 'text', 'quote', 'note'])) || undefined,
        createdAt: parseTimestamp(pick(obj, ['createdAt', 'created_at', 'time', 'timestamp', 'date'])),
      });
    }
  }

  // Nested highlights / citations / annotations
  const annList = pick(rec, ['citations', 'highlights', 'annotations', 'quotes', 'citas', 'resaltados', 'anotaciones']);
  if (Array.isArray(annList)) {
    for (const item of annList) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const quote = str(pick(obj, ['quote', 'text', 'citation', 'highlight', 'selected_text', 'content', 'cita']));
      const note = str(pick(obj, ['note', 'comment', 'nota', 'comentario']));
      if (!quote && !note) continue;
      const page = num(pick(obj, ['page', 'page_number', 'pagina', 'página']));
      const progress = clampProgress(num(pick(obj, ['progress', 'percent', 'progreso'])));
      out.annotations.push({
        bookTitle,
        bookAuthor,
        quote: quote || note,
        note: quote && note ? note : undefined,
        chapter: str(pick(obj, ['chapter', 'chapter_title', 'capitulo'])) || undefined,
        page: page !== undefined ? Math.round(page) : undefined,
        progress,
        cfi: str(pick(obj, ['cfi', 'epubcfi', 'position'])) || undefined,
        color: normalizeColor(pick(obj, ['color', 'highlight_color', 'style'])),
        tool: note && !quote ? 'postit' : 'highlighter',
        createdAt: parseTimestamp(pick(obj, ['createdAt', 'created_at', 'time', 'timestamp', 'date'])),
      });
    }
  }

  // Nested notes
  const noteList = pick(rec, ['notes', 'notas']);
  if (Array.isArray(noteList)) {
    for (const item of noteList) {
      if (typeof item === 'string' && item.trim()) {
        out.notes.push({ bookTitle, bookAuthor, text: item.trim() });
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const text = str(pick(obj, ['text', 'note', 'content', 'body', 'nota']));
        if (!text) continue;
        out.notes.push({
          bookTitle,
          bookAuthor,
          text,
          page: num(pick(obj, ['page', 'pagina'])),
          createdAt: parseTimestamp(pick(obj, ['createdAt', 'created_at', 'date', 'timestamp'])),
        });
      }
    }
  }
}

function parseReadEraJson(data: Record<string, unknown>, fileName: string): ParsedExternalBackup {
  const out = createEmptyResult(fileName, 'ReadEra');
  const docs = (Array.isArray(data.docs) ? data.docs : []) as Array<Record<string, unknown>>;

  for (const doc of docs) {
    const nestedData = (doc.data && typeof doc.data === 'object' ? doc.data : doc) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...doc, ...nestedData };
    const book = extractBookFromRecord(merged);
    if (!book) continue;
    out.books.push(book);
    extractMarksFromNested(merged, book.title, book.author, out);
  }
  return out;
}

function parseTachiyomiJson(data: Record<string, unknown>, fileName: string): ParsedExternalBackup {
  const out = createEmptyResult(fileName, 'Tachiyomi / Mihon');
  const list = (Array.isArray(data.backupManga)
    ? data.backupManga
    : Array.isArray(data.manga)
    ? data.manga
    : []) as Array<Record<string, unknown>>;

  for (const item of list) {
    const book = extractBookFromRecord(item);
    if (!book) continue;
    book.kind = book.kind || 'manga';
    book.favorite = book.favorite ?? true;
    out.books.push(book);
    if (Array.isArray(item.chapters)) {
      const bookmarkedChs = (item.chapters as Array<Record<string, unknown>>).filter(
        (c) => Boolean(c?.bookmark)
      );
      for (const ch of bookmarkedChs) {
        out.bookmarks.push({
          bookTitle: book.title,
          bookAuthor: book.author,
          label: str(ch.name) || `Capítulo ${str(ch.chapterNumber) || '?'}`,
          chapter: str(ch.name) || undefined,
          createdAt: parseTimestamp(ch.dateUpload),
        });
      }
    }
  }
  return out;
}

function parseGenericJson(raw: unknown, fileName: string): ParsedExternalBackup {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;

    // 1. Native KomoLib JSON backup
    if (
      obj.komolibBackupVersion ||
      (obj.books && (obj.theme || obj.profile || obj.customStationery || obj.bookmarks))
    ) {
      const out = createEmptyResult(fileName, 'KomoLib (.json)');
      out.nativeKomoLibData = obj;
      const booksList = Array.isArray(obj.books)
        ? obj.books
        : obj.books && typeof obj.books === 'object'
        ? Object.values(obj.books as Record<string, unknown>)
        : [];
      for (const b of booksList) {
        if (b && typeof b === 'object') {
          const parsed = extractBookFromRecord(b as Record<string, unknown>);
          if (parsed) out.books.push(parsed);
        }
      }
      if (Array.isArray(obj.bookmarks)) {
        for (const bm of obj.bookmarks as Array<Record<string, unknown>>) {
          const matchedBook = booksList.find(
            (x) => x && typeof x === 'object' && (x as Record<string, unknown>).id === bm.bookId
          ) as Record<string, unknown> | undefined;
          out.bookmarks.push({
            bookTitle: str(matchedBook?.title) || str(bm.bookTitle) || 'Libro',
            label: str(bm.label) || 'Marcador',
            chapter: str(bm.chapter) || undefined,
            page: num(bm.page),
            progress: clampProgress(num(bm.progress)),
            cfi: str(bm.cfi) || undefined,
            excerpt: str(bm.excerpt) || undefined,
            createdAt: parseTimestamp(bm.createdAt),
          });
        }
      }
      if (Array.isArray(obj.annotations)) {
        for (const ann of obj.annotations as Array<Record<string, unknown>>) {
          const matchedBook = booksList.find(
            (x) => x && typeof x === 'object' && (x as Record<string, unknown>).id === ann.bookId
          ) as Record<string, unknown> | undefined;
          const quote = str(ann.quote);
          if (!quote) continue;
          out.annotations.push({
            bookTitle: str(matchedBook?.title) || 'Libro',
            quote,
            note: str(ann.note) || undefined,
            chapter: str(ann.chapter) || undefined,
            page: num(ann.page),
            progress: clampProgress(num(ann.progress)),
            cfi: str(ann.cfi) || undefined,
            color: normalizeColor(ann.color),
            createdAt: parseTimestamp(ann.createdAt),
          });
        }
      }
      if (Array.isArray(obj.notes)) {
        for (const n of obj.notes as Array<Record<string, unknown>>) {
          const matchedBook = booksList.find(
            (x) => x && typeof x === 'object' && (x as Record<string, unknown>).id === n.bookId
          ) as Record<string, unknown> | undefined;
          const text = str(n.text);
          if (!text) continue;
          out.notes.push({
            bookTitle: str(matchedBook?.title) || 'Nota general',
            text,
            page: num(n.page),
            createdAt: parseTimestamp(n.createdAt),
          });
        }
      }
      return out;
    }

    // 2. ReadEra JSON
    if (Array.isArray(obj.docs)) {
      return parseReadEraJson(obj, fileName);
    }

    // 3. Tachiyomi / Mihon / Aniyomi JSON
    if (Array.isArray(obj.backupManga) || Array.isArray(obj.manga)) {
      return parseTachiyomiJson(obj, fileName);
    }
  }

  // 4. Generic deep scanner for ANY JSON backup (Kotatsu, Bookmory, KOReader, Lithium, custom exports)
  const out = createEmptyResult(fileName, 'Copia JSON');
  const bookIdToTitle = new Map<string, { title: string; author: string }>();

  const scanArray = (arr: unknown[], hintKey = '') => {
    const lowHint = hintKey.toLowerCase();
    for (const item of arr) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;

      // Kotatsu history/favourites wrap the manga under `manga` key
      if (rec.manga && typeof rec.manga === 'object' && !Array.isArray(rec.manga)) {
        const inner = rec.manga as Record<string, unknown>;
        const merged: Record<string, unknown> = {
          ...inner,
          ...rec,
          title: inner.title || rec.title,
          author: inner.author || rec.author,
          kind: 'manga',
          favorite: lowHint.includes('fav') ? true : undefined,
        };
        const book = extractBookFromRecord(merged);
        if (book) {
          out.detectedSource = 'Kotatsu / Manga JSON';
          out.books.push(book);
        }
        continue;
      }

      if (/bookmark|marcador|position/.test(lowHint)) {
        const bookRef = str(pick(rec, ['bookTitle', 'book_title', 'title', 'book_name', 'doc_title']));
        const bookId = str(pick(rec, ['bookId', 'book_id', 'doc_id', 'manga_id']));
        const resolved = bookRef || bookIdToTitle.get(bookId)?.title || '';
        if (resolved) {
          const page = num(pick(rec, ['page', 'page_number', 'pagina']));
          const progress = clampProgress(num(pick(rec, ['progress', 'percent', 'progreso'])));
          out.bookmarks.push({
            bookTitle: resolved,
            bookAuthor: bookIdToTitle.get(bookId)?.author,
            label:
              str(pick(rec, ['label', 'name', 'note', 'chapter'])) ||
              (page ? `Página ${Math.round(page)}` : 'Marcador importado'),
            chapter: str(pick(rec, ['chapter', 'chapter_title'])) || undefined,
            page: page !== undefined ? Math.round(page) : undefined,
            progress,
            cfi: str(pick(rec, ['cfi', 'epubcfi'])) || undefined,
            excerpt: str(pick(rec, ['excerpt', 'text', 'quote'])) || undefined,
            createdAt: parseTimestamp(pick(rec, ['createdAt', 'created_at', 'timestamp', 'date'])),
          });
        }
        continue;
      }

      if (/highlight|annotation|citation|quote|resalt|anotacion/.test(lowHint)) {
        const bookRef = str(pick(rec, ['bookTitle', 'book_title', 'title', 'book_name', 'doc_title']));
        const bookId = str(pick(rec, ['bookId', 'book_id', 'doc_id']));
        const resolved = bookRef || bookIdToTitle.get(bookId)?.title || '';
        const quote = str(pick(rec, ['quote', 'text', 'highlight', 'citation', 'selected_text', 'content']));
        const note = str(pick(rec, ['note', 'comment', 'nota']));
        if (resolved && (quote || note)) {
          out.annotations.push({
            bookTitle: resolved,
            bookAuthor: bookIdToTitle.get(bookId)?.author,
            quote: quote || note,
            note: quote && note ? note : undefined,
            chapter: str(pick(rec, ['chapter', 'chapter_title'])) || undefined,
            page: num(pick(rec, ['page', 'page_number'])),
            progress: clampProgress(num(pick(rec, ['progress', 'percent']))),
            cfi: str(pick(rec, ['cfi', 'epubcfi'])) || undefined,
            color: normalizeColor(pick(rec, ['color', 'highlight_color'])),
            tool: note && !quote ? 'postit' : 'highlighter',
            createdAt: parseTimestamp(pick(rec, ['createdAt', 'created_at', 'timestamp', 'date'])),
          });
        }
        continue;
      }

      if (/note|nota/.test(lowHint)) {
        const bookRef = str(pick(rec, ['bookTitle', 'book_title', 'title', 'book_name']));
        const bookId = str(pick(rec, ['bookId', 'book_id']));
        const resolved = bookRef || bookIdToTitle.get(bookId)?.title || 'Notas importadas';
        const text = str(pick(rec, ['text', 'note', 'content', 'body', 'nota']));
        if (text) {
          out.notes.push({
            bookTitle: resolved,
            text,
            page: num(pick(rec, ['page', 'pagina'])),
            createdAt: parseTimestamp(pick(rec, ['createdAt', 'created_at', 'date'])),
          });
        }
        continue;
      }

      const book = extractBookFromRecord(rec);
      if (book) {
        const id = str(pick(rec, ['id', '_id', 'bookId', 'book_id', 'uuid', 'doc_id']));
        if (id) bookIdToTitle.set(id, { title: book.title, author: book.author });
        out.books.push(book);
        extractMarksFromNested(rec, book.title, book.author, out);
      }
    }
  };

  if (Array.isArray(raw)) {
    const fileHint = fileName.toLowerCase();
    scanArray(raw, fileHint);
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // First pass: books/library/history/favourites so bookIdToTitle is populated
    const entries = Object.entries(obj);
    const primary = entries.filter(([k]) => !/bookmark|highlight|annotation|citation|note/i.test(k));
    const secondary = entries.filter(([k]) => /bookmark|highlight|annotation|citation|note/i.test(k));

    for (const [k, v] of [...primary, ...secondary]) {
      if (Array.isArray(v)) {
        scanArray(v, k);
      } else if (v && typeof v === 'object') {
        const nested = Object.values(v as Record<string, unknown>);
        if (nested.length > 0 && nested.every((x) => x && typeof x === 'object')) {
          scanArray(nested, k);
        }
      }
    }

    // Single-book JSON (e.g. KOReader JSON export for one book)
    if (out.books.length === 0) {
      const single = extractBookFromRecord(obj);
      if (single) {
        out.books.push(single);
        extractMarksFromNested(obj, single.title, single.author, out);
      }
    }
  }

  return out;
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function parseCsvBackup(text: string, fileName: string): ParsedExternalBackup {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount >= commaCount && tabCount > 0 ? '\t' : semiCount > commaCount ? ';' : ',';

  const rows = parseCsvRows(text, delimiter);
  const out = createEmptyResult(fileName, 'CSV / Goodreads / Calibre');
  if (rows.length < 2) return out;

  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  const headerJoined = headers.join(' ').toLowerCase();
  if (headerJoined.includes('exclusive shelf') || headerJoined.includes('goodreads')) {
    out.detectedSource = 'Goodreads (CSV)';
  } else if (headerJoined.includes('storygraph') || headerJoined.includes('read status')) {
    out.detectedSource = 'The StoryGraph (CSV)';
  } else if (headerJoined.includes('calibre') || headerJoined.includes('formats')) {
    out.detectedSource = 'Calibre (CSV)';
  }

  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r];
    const rec: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c] && vals[c] !== undefined) {
        rec[headers[c]] = vals[c].trim();
      }
    }
    const book = extractBookFromRecord(rec);
    if (!book) continue;
    out.books.push(book);

    const quote = str(pick(rec, ['highlight', 'quote', 'cita', 'resaltado', 'excerpt']));
    const note = str(pick(rec, ['note', 'notes', 'private_notes', 'privateNotes', 'notas', 'my_notes']));
    if (quote) {
      out.annotations.push({
        bookTitle: book.title,
        bookAuthor: book.author,
        quote,
        note: note || undefined,
        page: book.currentPage,
        progress: book.progress,
        color: '#ffe066',
        tool: 'highlighter',
      });
    } else if (note) {
      out.notes.push({
        bookTitle: book.title,
        bookAuthor: book.author,
        text: note,
        page: book.currentPage,
      });
    }

    const bmText = str(pick(rec, ['bookmark', 'bookmarks', 'marcador', 'marcadores']));
    if (bmText) {
      out.bookmarks.push({
        bookTitle: book.title,
        bookAuthor: book.author,
        label: bmText,
        page: book.currentPage,
        progress: book.progress,
      });
    }
  }
  return out;
}

function parseKindleClippings(text: string, fileName: string): ParsedExternalBackup {
  const out = createEmptyResult(fileName, 'Kindle (My Clippings)');
  const blocks = text
    .replace(/^\uFEFF/, '')
    .split(/={5,}\s*\r?\n?/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim());
    if (lines.length < 2) continue;

    const header = lines[0].replace(/^\uFEFF/, '');
    const meta = lines[1] || '';
    const body = lines.slice(2).filter(Boolean).join('\n').trim();

    let title = header;
    let author = 'Autor desconocido';
    const parenMatch = header.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch) {
      title = parenMatch[1].trim();
      author = parenMatch[2].trim();
    }
    if (!title) continue;

    const pageMatch = meta.match(/(?:page|p[aá]gina|p\.)\s*(\d+)/i);
    const locMatch = meta.match(/(?:location|posici[oó]n|loc\.?)\s*(\d+(?:-\d+)?)/i);
    const page = pageMatch ? Number(pageMatch[1]) : undefined;
    const locLabel = locMatch ? `Pos. ${locMatch[1]}` : undefined;

    const isBookmark = /bookmark|marcador/i.test(meta);
    const isNote = /\bnote\b|\bnota\b/i.test(meta);

    if (isBookmark) {
      out.bookmarks.push({
        bookTitle: title,
        bookAuthor: author,
        label: page ? `Página ${page}` : locLabel || 'Marcador Kindle',
        page,
        excerpt: body || undefined,
      });
    } else if (isNote && body) {
      out.notes.push({
        bookTitle: title,
        bookAuthor: author,
        text: body,
        page,
      });
    } else if (body) {
      out.annotations.push({
        bookTitle: title,
        bookAuthor: author,
        quote: body,
        chapter: locLabel,
        page,
        color: '#ffe066',
        tool: 'highlighter',
      });
    } else {
      out.books.push({ title, author });
    }
  }
  return out;
}

function parseXmlBackup(text: string, fileName: string): ParsedExternalBackup {
  const out = createEmptyResult(fileName, 'Copia XML / OPML');
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const nodes = Array.from(
      doc.querySelectorAll('book, entry, item, doc, document, outline, record, manga')
    );

    for (const el of nodes) {
      const rec: Record<string, unknown> = {};
      for (const attr of Array.from(el.attributes)) {
        rec[attr.name] = attr.value;
      }
      for (const child of Array.from(el.children)) {
        if (child.children.length === 0 && child.textContent?.trim()) {
          rec[child.tagName] = child.textContent.trim();
        }
      }
      const book = extractBookFromRecord(rec);
      if (book) {
        out.books.push(book);
        const bmEls = Array.from(el.querySelectorAll('bookmark, marcador'));
        for (const bm of bmEls) {
          const page = num(bm.getAttribute('page') || bm.querySelector('page')?.textContent);
          const progress = clampProgress(
            num(bm.getAttribute('progress') || bm.getAttribute('percent') || bm.querySelector('progress')?.textContent)
          );
          const label =
            bm.getAttribute('label') ||
            bm.getAttribute('title') ||
            bm.textContent?.trim() ||
            (page ? `Página ${page}` : 'Marcador');
          out.bookmarks.push({ bookTitle: book.title, bookAuthor: book.author, label, page, progress });
        }
        const hlEls = Array.from(el.querySelectorAll('highlight, annotation, citation, quote'));
        for (const hl of hlEls) {
          const quote = hl.getAttribute('quote') || hl.getAttribute('text') || hl.textContent?.trim() || '';
          const note = hl.getAttribute('note') || hl.querySelector('note')?.textContent?.trim() || undefined;
          if (!quote && !note) continue;
          out.annotations.push({
            bookTitle: book.title,
            bookAuthor: book.author,
            quote: quote || note || '',
            note: quote && note ? note : undefined,
            color: normalizeColor(hl.getAttribute('color')),
            tool: 'highlighter',
          });
        }
      }
    }
  } catch {
    out.warnings.push('No se pudo interpretar la estructura XML completa.');
  }
  return out;
}

function parseMoonReaderPositionOrExport(text: string, innerName: string): ParsedExternalBackup {
  const out = createEmptyResult(innerName, 'Moon+ Reader');
  // Moon+ Reader .po files: e.g. "chapter*offset@percent:..." or key=value
  if (/\.po$/i.test(innerName)) {
    const strippedPo = innerName.replace(/\.po$/i, '');
    const fileBase = (strippedPo.split(/[\\/]/).pop() || strippedPo).trim();
    const title = cleanBookTitleFromPath(strippedPo);
    const pctMatch = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    const numParts = text.trim().split(/[*@:#\s]+/);
    let progress = pctMatch ? clampProgress(Number(pctMatch[1])) : undefined;
    if (progress === undefined && numParts.length >= 2) {
      const maybePct = Number(numParts.find((p) => /^\d{1,2}\.\d+$/.test(p)));
      if (Number.isFinite(maybePct)) progress = clampProgress(maybePct);
    }
    if (title) {
      out.books.push({
        title,
        author: 'Autor desconocido',
        progress,
        format: normalizeFormat('', fileBase),
        fileName: fileBase || undefined,
        readingStatus: normalizeStatus('', progress),
      });
    }
    return out;
  }

  // Moon+ Reader .mrexpt text highlight/bookmark export (delimited by "##")
  if (text.includes('##')) {
    const chunks = text.split(/\n?##\n?/).map((c) => c.trim()).filter(Boolean);
    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/).map((l) => l.trim());
      if (lines.length < 4) continue;
      // Moon+ .mrexpt fields: [id, bookTitle, filePath, lowerTitle, chapterIdx, pos, len, timestamp, color, ?, note, originalText]
      const bookTitle = cleanBookTitleFromPath(lines[1] || lines[2] || '');
      const quote = lines[11] || lines[10] || '';
      const note = lines[11] && lines[10] ? lines[10] : undefined;
      const colorVal = num(lines[8]);
      const ts = parseTimestamp(lines[7]);
      if (bookTitle && (quote || note)) {
        out.annotations.push({
          bookTitle,
          quote: quote || note || '',
          note,
          color: normalizeColor(colorVal),
          tool: 'highlighter',
          createdAt: ts,
        });
      }
    }
  }
  return out;
}

function parseKoreaderLua(text: string, fileName: string): ParsedExternalBackup {
  const out = createEmptyResult(fileName, 'KOReader (.lua)');
  const titleMatch = text.match(/\["title"\]\s*=\s*"([^"]+)"/);
  const authorMatch = text.match(/\["authors"\]\s*=\s*"([^"]+)"/);
  const pctMatch = text.match(/\["percent_finished"\]\s*=\s*([0-9.]+)/);
  const title = titleMatch?.[1] || cleanBookTitleFromPath(fileName.replace(/^metadata\.|\.lua$/gi, ''));
  if (!title) return out;

  const progress = pctMatch ? clampProgress(Number(pctMatch[1])) : undefined;
  out.books.push({
    title,
    author: authorMatch?.[1] || 'Autor desconocido',
    progress,
    readingStatus: normalizeStatus('', progress),
  });

  // Extract ["text"] = "..." highlights/bookmarks inside Lua tables
  const textRe = /\["text"\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = textRe.exec(text)) !== null) {
    const quote = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    if (quote.length >= 4) {
      out.annotations.push({
        bookTitle: title,
        bookAuthor: authorMatch?.[1],
        quote,
        color: '#ffe066',
        tool: 'highlighter',
      });
    }
  }
  return out;
}

function parsePlainTextBackup(text: string, fileName: string): ParsedExternalBackup {
  const out = createEmptyResult(fileName, 'Archivo de texto');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//') || line.length < 2) continue;
    // Match optional trailing progress like "(45%)" or "- 45%" or "[45%]"
    const pctMatch = line.match(/(?:\(|\[|\s-\s|\s)(\d{1,3}(?:\.\d+)?)\s*%(?:\)|\])?/);
    const progress = pctMatch ? clampProgress(Number(pctMatch[1])) : undefined;
    const withoutPct = pctMatch ? line.replace(pctMatch[0], '').trim() : line;

    // Match "Title - Author" or "Title by Author" or "Title | Author"
    const sepMatch = withoutPct.match(/^(.+?)\s*(?:\s-\s|\s\|\s|\s+by\s+|\s+por\s+)\s*(.+)$/i);
    const title = (sepMatch ? sepMatch[1] : withoutPct).replace(/^[-•*\d.)\s]+/, '').trim();
    const author = sepMatch ? sepMatch[2].trim() : 'Autor desconocido';
    if (title.length >= 2 && title.length <= 180) {
      out.books.push({
        title,
        author,
        progress,
        readingStatus: normalizeStatus('', progress),
      });
    }
  }
  return out;
}

async function parseTextPayload(text: string, fileName: string): Promise<ParsedExternalBackup> {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return createEmptyResult(fileName, 'Archivo vacío');

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parseGenericJson(parsed, fileName);
    } catch {
      // fall through
    }
  }

  if (/\.po$/i.test(fileName) || /\.mrexpt$/i.test(fileName) || (trimmed.includes('##') && /\n##\n/.test(trimmed))) {
    const mr = parseMoonReaderPositionOrExport(trimmed, fileName);
    if (mr.books.length || mr.annotations.length || mr.bookmarks.length) return mr;
  }

  if (/\.lua$/i.test(fileName) || /\["percent_finished"\]|\["bookmarks"\]/.test(trimmed)) {
    return parseKoreaderLua(trimmed, fileName);
  }

  if (trimmed.includes('==========')) {
    return parseKindleClippings(trimmed, fileName);
  }

  if (trimmed.startsWith('<')) {
    return parseXmlBackup(trimmed, fileName);
  }

  // Detect CSV / TSV (at least 2 lines and consistent delimiters)
  const firstLines = trimmed.split(/\r?\n/).slice(0, 3);
  if (
    firstLines.length >= 2 &&
    (/\.(csv|tsv)$/i.test(fileName) ||
      ((firstLines[0].includes(',') || firstLines[0].includes(';') || firstLines[0].includes('\t')) &&
        /title|t[ií]tulo|author|autor|book|libro|progress|progreso|shelf|page/i.test(firstLines[0])))
  ) {
    return parseCsvBackup(trimmed, fileName);
  }

  return parsePlainTextBackup(trimmed, fileName);
}

async function tryGunzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

function isZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isSqliteMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const header = new TextDecoder().decode(bytes.slice(0, 15));
  return header.startsWith('SQLite format 3');
}

type SqlJsDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  close: () => void;
};

type SqlJsStatic = {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
};

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const mod = (await import('sql.js')) as unknown as {
        default?: (cfg?: {
          locateFile?: (file: string) => string;
          wasmBinary?: ArrayBuffer;
        }) => Promise<SqlJsStatic>;
      };
      const initFn =
        typeof mod.default === 'function'
          ? mod.default
          : (mod as unknown as (cfg?: {
              locateFile?: (file: string) => string;
              wasmBinary?: ArrayBuffer;
            }) => Promise<SqlJsStatic>);

      // Fetch raw wasmBinary so Android WebView never fails on instantiateStreaming MIME-type checks
      let wasmBinary: ArrayBuffer | undefined;
      if (typeof fetch !== 'undefined') {
        try {
          const res = await fetch('./sql-wasm-browser.wasm');
          if (res.ok) wasmBinary = await res.arrayBuffer();
        } catch {
          // fall back to locateFile
        }
      }

      return initFn({
        wasmBinary,
        locateFile: () => './sql-wasm-browser.wasm',
      });
    })();
  }
  return sqlJsPromise;
}

function queryTableRows(db: SqlJsDatabase, tableName: string): Array<Record<string, unknown>> {
  try {
    const safeName = tableName.replace(/"/g, '""');
    const res = db.exec(`SELECT * FROM "${safeName}"`);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i];
      }
      return obj;
    });
  } catch {
    return [];
  }
}

function parseMoonProgressString(raw: string): { progress?: number; chapter?: string } {
  const text = raw.trim();
  if (!text) return {};
  const pctMatch = text.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
  let progress = pctMatch ? clampProgress(Number(pctMatch[1].replace(',', '.'))) : undefined;
  let chapter: string | undefined;

  // Moon+ Reader .po formats:
  // "chapter*split@offset#len:45.2%" or "chapter#split#offset#..."
  const colonParts = text.split(':');
  if (progress === undefined && colonParts.length >= 2) {
    const tail = colonParts[colonParts.length - 1].replace('%', '').trim();
    const n = Number(tail.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      progress = clampProgress(n);
    }
  }
  const chMatch = text.match(/^(\d+)[*#@]/);
  if (chMatch && Number(chMatch[1]) > 0) {
    chapter = `Capítulo ${chMatch[1]}`;
  }
  return { progress, chapter };
}

async function parseSqliteDatabase(
  bytes: Uint8Array,
  sourceName: string
): Promise<ParsedExternalBackup> {
  const out = createEmptyResult(sourceName, 'Base de datos SQLite');
  let db: SqlJsDatabase | null = null;

  try {
    const SQL = await loadSqlJs();
    db = new SQL.Database(bytes);
    const tablesRes = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tableNames = tablesRes.length
      ? tablesRes[0].values.map((v) => String(v[0] || '')).filter(Boolean)
      : [];
    const tableSet = new Set(tableNames.map((t) => t.toLowerCase()));

    // Detect Moon+ Reader mrbooks.db schema
    const isMoonReaderDb =
      /mrbooks/i.test(sourceName) ||
      (tableSet.has('books') && (tableSet.has('notes') || tableSet.has('statistics') || tableSet.has('novels')));

    if (isMoonReaderDb) {
      out.detectedSource = 'Moon+ Reader';
      const pathToBook = new Map<string, { title: string; author: string }>();

      const booksTableName = tableNames.find((t) => t.toLowerCase() === 'books');
      if (booksTableName) {
        const rows = queryTableRows(db, booksTableName);
        for (const r of rows) {
          const filename = str(pick(r, ['filename', 'file_path', 'path', 'lowerFilename']));
          const rawBookTitle = str(pick(r, ['book', 'title', 'book_name', 'name']));
          let title = rawBookTitle || cleanBookTitleFromPath(filename);
          if (!title) continue;

          let author = str(pick(r, ['author', 'authors', 'writer', 'creator']));
          if (isUnknownAuthor(author)) {
            const inferred = inferAuthorFromName(filename || rawBookTitle);
            if (inferred.author) {
              author = inferred.author;
              if (!rawBookTitle && inferred.cleanTitle) title = inferred.cleanTitle;
            } else {
              author = 'Autor desconocido';
            }
          }
          const description = str(pick(r, ['description', 'desc'])) || undefined;
          const favorite = bool(pick(r, ['favorite', 'favourite', 'starred'])) || undefined;
          const groupName = str(pick(r, ['groupName', 'category', 'shelf']));
          let thumbFile = str(pick(r, ['thumbFile', 'thumb_file', 'thumbnail', 'thumb', 'thumbPath'])) || undefined;
          let coverFile = str(pick(r, ['coverFile', 'cover_file', 'cover', 'coverPath'])) || undefined;
          if (!thumbFile || !coverFile) {
            for (const [col, val] of Object.entries(r)) {
              const sVal = str(val);
              if (!sVal || sVal.length < 4) continue;
              if (/\.(jpe?g|png|webp|bmp|tn)$/i.test(sVal) || (/cache|thumb|cover/i.test(col) && /[\\/]/.test(sVal))) {
                if (!thumbFile) thumbFile = sVal;
                else if (!coverFile && sVal !== thumbFile) coverFile = sVal;
              }
            }
          }
          const tags = groupName
            ? groupName
                .split(/[,;|]/)
                .map((x) => x.trim())
                .filter(Boolean)
            : undefined;
          const rawPos = str(pick(r, ['lastPosition', 'position', 'progress', 'bak1']));
          const parsedPos = parseMoonProgressString(rawPos);
          const directPct = clampProgress(num(pick(r, ['percent', 'reading_progress', 'progress'])));
          const progress = directPct ?? parsedPos.progress;
          const format = normalizeFormat('', filename);
          const kind = normalizeKind(groupName, title, format);

          out.books.push({
            title,
            author,
            description,
            progress,
            currentChapter: parsedPos.chapter,
            readingStatus: normalizeStatus('', progress),
            favorite,
            format,
            kind,
            tags,
            lastReadAt: parseTimestamp(pick(r, ['lastReadTime', 'last_read_time', 'addTime', 'time'])),
            fileName: filename ? filename.split(/[\\/]/).pop() : undefined,
            folderPath: groupName || extractFolderFromPath(filename),
            thumbFile,
            coverFile,
          });

          if (filename) {
            const lowerPath = filename.toLowerCase();
            const base = (filename.split(/[\\/]/).pop() || filename).toLowerCase();
            pathToBook.set(lowerPath, { title, author });
            pathToBook.set(base, { title, author });
            pathToBook.set(cleanBookTitleFromPath(filename).toLowerCase(), { title, author });
          }
          const lowerFn = str(r.lowerFilename).toLowerCase();
          if (lowerFn) {
            pathToBook.set(lowerFn, { title, author });
            pathToBook.set((lowerFn.split(/[\\/]/).pop() || lowerFn).toLowerCase(), { title, author });
          }
          pathToBook.set(title.toLowerCase(), { title, author });
        }
      }

      // Moon+ Reader `statistics` table (updates reading status / last read time)
      const statsTableName = tableNames.find((t) => t.toLowerCase() === 'statistics');
      if (statsTableName) {
        const rows = queryTableRows(db, statsTableName);
        for (const r of rows) {
          const filename = str(pick(r, ['filename', 'lowerFilename', 'book']));
          if (!filename) continue;
          const base = (filename.split(/[\\/]/).pop() || filename).toLowerCase();
          const matched =
            pathToBook.get(filename.toLowerCase()) ||
            pathToBook.get(base) ||
            pathToBook.get(cleanBookTitleFromPath(filename).toLowerCase());
          const title = matched?.title || cleanBookTitleFromPath(filename);
          const usedTime = num(pick(r, ['usedTime', 'used_time', 'readTime']));
          const readWords = num(pick(r, ['readWords', 'read_words']));
          if (title && ((usedTime && usedTime > 0) || (readWords && readWords > 0))) {
            out.books.push({
              title,
              author: matched?.author || 'Autor desconocido',
              readingStatus: 'reading',
              format: normalizeFormat('', filename),
              fileName: filename ? filename.split(/[\\/]/).pop() : undefined,
              lastReadAt: parseTimestamp(pick(r, ['dates', 'lastTime', 'time'])),
            });
          }
        }
      }

      // Moon+ Reader `notes` table (highlights, annotations, and bookmarks!)
      const notesTableName = tableNames.find((t) => t.toLowerCase() === 'notes');
      if (notesTableName) {
        const rows = queryTableRows(db, notesTableName);
        for (const r of rows) {
          const filename = str(pick(r, ['filename', 'lowerFilename']));
          const rawBook = str(pick(r, ['book', 'title']));
          const base = filename ? (filename.split(/[\\/]/).pop() || filename).toLowerCase() : '';
          const matched =
            (filename && pathToBook.get(filename.toLowerCase())) ||
            (base && pathToBook.get(base)) ||
            (rawBook && pathToBook.get(rawBook.toLowerCase())) ||
            undefined;
          const bookTitle = matched?.title || rawBook || cleanBookTitleFromPath(filename);
          if (!bookTitle) continue;
          const bookAuthor = matched?.author || 'Autor desconocido';

          const original = str(pick(r, ['original', 'highlight', 'text', 'quote']));
          const note = str(pick(r, ['note', 'comment']));
          const bookmarkText = str(pick(r, ['bookmark', 'label']));
          const lastChapter = num(pick(r, ['lastChapter', 'chapter']));
          const chapterLabel =
            lastChapter !== undefined && lastChapter > 0 ? `Capítulo ${Math.round(lastChapter)}` : undefined;
          const ts = parseTimestamp(pick(r, ['time', 'timestamp', 'created_at']));
          const underline = bool(r.underline);
          const color = normalizeColor(pick(r, ['highlightColor', 'color']));

          if (original || note) {
            out.annotations.push({
              bookTitle,
              bookAuthor,
              quote: original || note,
              note: original && note ? note : undefined,
              chapter: chapterLabel,
              color,
              tool: underline ? 'pen' : original ? 'highlighter' : 'postit',
              createdAt: ts,
            });
          } else {
            out.bookmarks.push({
              bookTitle,
              bookAuthor,
              label: bookmarkText || chapterLabel || 'Marcador Moon+ Reader',
              chapter: chapterLabel,
              excerpt: bookmarkText || undefined,
              createdAt: ts,
            });
          }
        }
      }

      // Moon+ Reader `recent` / `novels` / extra position tables if present
      for (const extraName of tableNames) {
        const low = extraName.toLowerCase();
        if (low === 'books' || low === 'notes' || low === 'statistics' || low === 'android_metadata') {
          continue;
        }
        const rows = queryTableRows(db, extraName);
        for (const r of rows) {
          const book = extractBookFromRecord(r);
          if (book) out.books.push(book);
        }
      }

      return out;
    }

    // Generic SQLite parser (Calibre metadata.db, KOReader statistics.sqlite3, Lithium, PocketBook, FBReader, etc.)
    const bookIdMap = new Map<string, { title: string; author: string }>();
    const primaryTables = tableNames.filter((t) => !/bookmark|note|highlight|annotation|citation/i.test(t));
    const markTables = tableNames.filter((t) => /bookmark|note|highlight|annotation|citation/i.test(t));

    for (const tbl of primaryTables) {
      if (tbl.toLowerCase() === 'android_metadata') continue;
      const rows = queryTableRows(db, tbl);
      for (const r of rows) {
        const book = extractBookFromRecord(r);
        if (!book) continue;
        const id = str(pick(r, ['id', '_id', 'book_id', 'bookId', 'doc_id', 'md5']));
        if (id) bookIdMap.set(id, { title: book.title, author: book.author });
        out.books.push(book);
      }
    }

    for (const tbl of markTables) {
      const low = tbl.toLowerCase();
      const rows = queryTableRows(db, tbl);
      for (const r of rows) {
        const idRef = str(pick(r, ['book_id', 'bookId', 'doc_id', 'id_book']));
        const matched = idRef ? bookIdMap.get(idRef) : undefined;
        const bookTitle =
          matched?.title ||
          str(pick(r, ['book', 'book_title', 'bookTitle', 'title'])) ||
          cleanBookTitleFromPath(str(pick(r, ['filename', 'path'])));
        if (!bookTitle) continue;
        const bookAuthor = matched?.author || 'Autor desconocido';

        const quote = str(pick(r, ['original', 'quote', 'text', 'highlight', 'selected_text', 'content']));
        const note = str(pick(r, ['note', 'comment', 'nota']));
        const page = num(pick(r, ['page', 'page_number', 'pagina']));
        const progress = clampProgress(num(pick(r, ['progress', 'percent'])));
        const ts = parseTimestamp(pick(r, ['time', 'created_at', 'createdAt', 'timestamp', 'date']));

        if (/bookmark/.test(low) && !quote) {
          out.bookmarks.push({
            bookTitle,
            bookAuthor,
            label: str(pick(r, ['label', 'name', 'bookmark', 'chapter'])) || (page ? `Página ${Math.round(page)}` : 'Marcador'),
            page: page !== undefined ? Math.round(page) : undefined,
            progress,
            excerpt: note || undefined,
            createdAt: ts,
          });
        } else if (quote || note) {
          out.annotations.push({
            bookTitle,
            bookAuthor,
            quote: quote || note,
            note: quote && note ? note : undefined,
            page: page !== undefined ? Math.round(page) : undefined,
            progress,
            color: normalizeColor(pick(r, ['highlightColor', 'color'])),
            tool: quote ? 'highlighter' : 'postit',
            createdAt: ts,
          });
        }
      }
    }

    return out;
  } catch (err) {
    const fallback = extractReadableStringsFromBinary(bytes, sourceName);
    fallback.warnings.push(
      `No se pudo abrir SQLite completo (${err instanceof Error ? err.message : 'error interno'}).`
    );
    return fallback;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close error
    }
  }
}

function parseMoonNamesList(text: string, zeroBased = false): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let seq = zeroBased ? 0 : 1;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Support both positional lines (line 1 -> 1.tag or 0.tag) and explicit "1.tag=..." / "1=..." lines
    const eqMatch = line.match(/^(\d+(?:\.tag)?)\s*[=:]\s*(.+)$/);
    if (eqMatch) {
      const key = eqMatch[1].endsWith('.tag') ? eqMatch[1] : `${eqMatch[1]}.tag`;
      map.set(key.toLowerCase(), eqMatch[2].trim());
    } else {
      map.set(`${seq}.tag`, line);
      seq += 1;
    }
  }
  return map;
}

function parseMoonSharedPrefsXml(text: string, innerName: string): ParsedExternalBackup {
  const out = createEmptyResult(innerName, 'Moon+ Reader');
  // Moon+ Reader sometimes stores last-read positions inside shared_prefs XML as <string name="...">.po values
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const strings = Array.from(doc.querySelectorAll('string'));
    for (const el of strings) {
      const name = el.getAttribute('name') || '';
      const val = el.textContent?.trim() || '';
      if (!val) continue;
      if (/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx)/i.test(name) && /\d+(?:\.\d+)?%/.test(val)) {
        const title = cleanBookTitleFromPath(name);
        const pos = parseMoonProgressString(val);
        if (title && pos.progress !== undefined) {
          out.books.push({
            title,
            author: 'Autor desconocido',
            progress: pos.progress,
            currentChapter: pos.chapter,
            readingStatus: normalizeStatus('', pos.progress),
            format: normalizeFormat('', name),
            fileName: name.split(/[\\/]/).pop() || undefined,
          });
        }
      }
    }
  } catch {
    // ignore preference xml errors
  }
  return out;
}

function extractReadableStringsFromBinary(bytes: Uint8Array, fileName: string): ParsedExternalBackup {
  // Best-effort UTF-8 / ASCII title scanner for binary SQLite / protobuf backups (.db, .tachibk, .mrpro)
  const out = createEmptyResult(
    fileName,
    isSqliteMagic(bytes) ? 'Base de datos SQLite' : 'Copia binaria (lectura asistida)'
  );
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bookExtRe = /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s._,'’\-()]{2,90}\.(?:epub|pdf|mobi|azw3?|fb2|cbz|cbr|docx))/gi;
  let m;
  while ((m = bookExtRe.exec(text)) !== null) {
    const rawFile = m[1].trim();
    const title = cleanBookTitleFromPath(rawFile);
    if (title.length >= 2) {
      out.books.push({
        title,
        author: 'Autor desconocido',
        format: normalizeFormat('', rawFile),
        fileName: rawFile,
      });
    }
  }
  if (out.books.length === 0) {
    out.warnings.push(
      'Este archivo es una copia binaria/cifrada de otra app. Si la otra app permite exportar en JSON, CSV, TXT, ReadEra (.bak), Kindle (My Clippings.txt) o ZIP con metadatos, podrás importar libros, progresos y marcadores completos.'
    );
  } else {
    out.warnings.push(
      'Archivo binario detectado: se recuperaron los títulos legibles encontrados dentro de la copia.'
    );
  }
  return out;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const copy = new Uint8Array(new ArrayBuffer(compressed.byteLength));
    copy.set(compressed);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

interface SlicedZipEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

async function readSlicedZipEntry(
  file: File,
  entry: SlicedZipEntry,
  maxBytes = 35 * 1024 * 1024
): Promise<Uint8Array | null> {
  if (entry.compSize < 0 || entry.compSize > maxBytes || entry.uncompSize > maxBytes) return null;
  if (entry.method !== 0 && entry.method !== 8) return null;

  const lhAb = await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer();
  if (lhAb.byteLength < 30) return null;
  const lh = new DataView(lhAb);
  if (lh.getUint32(0, true) !== 0x04034b50) return null;
  const localNameLen = lh.getUint16(26, true);
  const localExtraLen = lh.getUint16(28, true);
  const dataOffset = entry.localOffset + 30 + localNameLen + localExtraLen;

  const compAb = await file.slice(dataOffset, dataOffset + entry.compSize).arrayBuffer();
  const compBytes = new Uint8Array(compAb);
  if (entry.method === 0) return compBytes;
  return inflateRawBytes(compBytes);
}

async function parseLargeZipViaSlice(file: File): Promise<ParsedExternalBackup> {
  const out = createEmptyResult(file.name, 'Copia comprimida (ZIP)');
  const fileSize = file.size;
  const tailLen = Math.min(fileSize, 65557);
  const tailPos = fileSize - tailLen;
  const tailAb = await file.slice(tailPos, fileSize).arrayBuffer();
  const tailBytes = new Uint8Array(tailAb);
  const tailView = new DataView(tailAb);

  let eocdIdx = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (
      tailBytes[i] === 0x50 &&
      tailBytes[i + 1] === 0x4b &&
      tailBytes[i + 2] === 0x05 &&
      tailBytes[i + 3] === 0x06
    ) {
      eocdIdx = i;
      break;
    }
  }
  if (eocdIdx < 0) {
    out.warnings.push('No se encontró el índice del archivo ZIP.');
    return out;
  }

  let cdSize = tailView.getUint32(eocdIdx + 12, true);
  let cdOffset = tailView.getUint32(eocdIdx + 16, true);
  const eocdAbsPos = tailPos + eocdIdx;

  // ZIP64 support for archives > 4 GB
  if ((cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocdAbsPos >= 20) {
    const locAb = await file.slice(eocdAbsPos - 20, eocdAbsPos).arrayBuffer();
    const locView = new DataView(locAb);
    if (locAb.byteLength === 20 && locView.getUint32(0, true) === 0x07064b50) {
      const z64Off = Number(locView.getBigUint64(8, true));
      const z64Ab = await file.slice(z64Off, z64Off + 56).arrayBuffer();
      const z64View = new DataView(z64Ab);
      if (z64Ab.byteLength === 56 && z64View.getUint32(0, true) === 0x06064b50) {
        cdSize = Number(z64View.getBigUint64(40, true));
        cdOffset = Number(z64View.getBigUint64(48, true));
      }
    }
  }

  if (cdSize <= 0 || cdSize > 64 * 1024 * 1024 || cdOffset < 0 || cdOffset + cdSize > fileSize) {
    out.warnings.push('No se pudo leer el índice de la copia comprimida.');
    return out;
  }

  const cdAb = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cdBytes = new Uint8Array(cdAb);
  const cdView = new DataView(cdAb);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const entries: SlicedZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cdBytes.length) {
    if (cdView.getUint32(p, true) !== 0x02014b50) break;
    const method = cdView.getUint16(p + 10, true);
    let compSize = cdView.getUint32(p + 20, true);
    let uncompSize = cdView.getUint32(p + 24, true);
    const nameLen = cdView.getUint16(p + 28, true);
    const extraLen = cdView.getUint16(p + 30, true);
    const commentLen = cdView.getUint16(p + 32, true);
    let localOffset = cdView.getUint32(p + 42, true);

    if (p + 46 + nameLen > cdBytes.length) break;
    const name = decoder.decode(cdBytes.subarray(p + 46, p + 46 + nameLen));

    if ((uncompSize === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) && extraLen >= 4) {
      let ep = p + 46 + nameLen;
      const extraEnd = Math.min(cdBytes.length, ep + extraLen);
      while (ep + 4 <= extraEnd) {
        const headerId = cdView.getUint16(ep, true);
        const dataSize = cdView.getUint16(ep + 2, true);
        ep += 4;
        if (headerId === 0x0001 && ep + dataSize <= extraEnd) {
          let fp = ep;
          if (uncompSize === 0xffffffff && fp + 8 <= ep + dataSize) {
            uncompSize = Number(cdView.getBigUint64(fp, true));
            fp += 8;
          }
          if (compSize === 0xffffffff && fp + 8 <= ep + dataSize) {
            compSize = Number(cdView.getBigUint64(fp, true));
            fp += 8;
          }
          if (localOffset === 0xffffffff && fp + 8 <= ep + dataSize) {
            localOffset = Number(cdView.getBigUint64(fp, true));
          }
          break;
        }
        ep += dataSize;
      }
    }

    if (!name.endsWith('/')) {
      entries.push({ name, method, compSize, uncompSize, localOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  const sourcesDetected = new Set<string>();
  const tagNameMap = new Map<string, string>();
  const namesListEntry = entries.find((e) => /(^|\/)_names\.list$/i.test(e.name));
  if (namesListEntry) {
    sourcesDetected.add('Moon+ Reader');
    const rawList = await readSlicedZipEntry(file, namesListEntry);
    if (rawList) {
      const listText = decoder.decode(rawList);
      const hasZeroTag = entries.some((e) => /(^|\/)0\.tag$/i.test(e.name));
      const parsedMap = parseMoonNamesList(listText, hasZeroTag);
      for (const [tag, realPath] of parsedMap.entries()) {
        tagNameMap.set(tag.toLowerCase(), realPath);
      }
    }
  }

  for (const entry of entries) {
    if (entry === namesListEntry) continue;
    const baseName = (entry.name.split('/').pop() || entry.name).toLowerCase();
    const mappedRealName = tagNameMap.get(baseName) || entry.name;
    const lower = mappedRealName.toLowerCase();

    if (
      entry.uncompSize === 0 ||
      entry.uncompSize > 35 * 1024 * 1024 ||
      /\.(png|jpe?g|webp|gif|bmp|ttf|otf|woff2?|mp3|mp4|epub|pdf|cbz|cbr|mobi|azw3?|fb2|docx|db-shm|db-wal|journal)$/i.test(lower) ||
      lower.endsWith('-shm') ||
      lower.endsWith('-wal')
    ) {
      continue;
    }

    if (
      namesListEntry &&
      tagNameMap.has(baseName) &&
      !/\.(db|sqlite3?|po|mrexpt|json|csv|tsv|txt|xml|opml|lua)$/i.test(lower) &&
      !lower.includes('mrbooks')
    ) {
      continue;
    }

    const innerBytes = await readSlicedZipEntry(file, entry);
    if (!innerBytes || innerBytes.length === 0) continue;

    if (isSqliteMagic(innerBytes)) {
      const sqlRes = await parseSqliteDatabase(innerBytes, mappedRealName);
      if (sqlRes.detectedSource) sourcesDetected.add(sqlRes.detectedSource);
      mergeResults(out, sqlRes);
      continue;
    }

    if (/shared_prefs\/.*\.xml$/i.test(lower) || /preferences\.xml$/i.test(lower)) {
      const xmlText = decoder.decode(innerBytes);
      const prefRes = parseMoonSharedPrefsXml(xmlText, mappedRealName);
      if (prefRes.books.length) {
        sourcesDetected.add('Moon+ Reader');
        mergeResults(out, prefRes);
      }
      continue;
    }

    const innerText = decoder.decode(innerBytes);
    const sample = innerText.slice(0, 256);
    let ctrlCount = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code === 0 || (code < 9 && code > 0) || (code > 13 && code < 32)) ctrlCount++;
    }
    if (sample.length > 16 && ctrlCount / sample.length > 0.2) continue;

    if (
      namesListEntry &&
      !/\.(po|mrexpt|json|csv|tsv|txt|xml|opml|lua)$/i.test(lower) &&
      !innerText.trim().startsWith('{') &&
      !innerText.trim().startsWith('[') &&
      !innerText.includes('##')
    ) {
      continue;
    }

    const sub = await parseTextPayload(innerText, mappedRealName);
    if (sub.books.length || sub.bookmarks.length || sub.annotations.length || sub.notes.length) {
      if (sub.detectedSource && sub.detectedSource !== 'Copia JSON' && sub.detectedSource !== 'Archivo de texto') {
        sourcesDetected.add(sub.detectedSource);
      } else if (lower.includes('library.json')) {
        sourcesDetected.add('ReadEra');
      } else if (/history|favourites|bookmarks/.test(lower) && !lower.includes('.')) {
        sourcesDetected.add('Kotatsu');
      }
      mergeResults(out, sub);
    }
  }

  if (sourcesDetected.size > 0) {
    out.detectedSource = Array.from(sourcesDetected).join(' + ');
  }
  return dedupeResult(out);
}

/**
 * Universally parses ANY backup file from KomoLib or external reading apps
 * (ReadEra, Moon+ Reader, Kindle, Goodreads, Calibre, StoryGraph, Tachiyomi/Mihon,
 * Kotatsu, KOReader, generic JSON/CSV/XML/ZIP/TXT).
 * Supports multi-gigabyte (+2 GB) ZIP/.mrpro archives via slice-based Central Directory reading.
 */
export async function parseExternalBackupFile(file: File): Promise<ParsedExternalBackup> {
  // Inspect only the first 16 bytes first so > 2 GB files never hit WebView/V8 ArrayBuffer limits!
  let headBytes: Uint8Array;
  try {
    headBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch (err) {
    throw new Error(
      `No se pudo acceder al archivo (${err instanceof Error ? err.message : 'permiso denegado por el sistema'}). Intenta volver a seleccionarlo desde el botón "Elegir archivo de copia".`
    );
  }

  if (isZipMagic(headBytes) && file.size > 40 * 1024 * 1024) {
    return parseLargeZipViaSlice(file);
  }

  if (file.size > 120 * 1024 * 1024) {
    throw new Error(
      'Este archivo pesa más de 120 MB y no es una copia ZIP estándar. Si es un respaldo de Moon+ Reader (.mrpro) o ReadEra (.bak), ábrelo directamente desde el APK para extraer solo los datos de lectura.'
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    throw new Error(
      `El sistema no pudo leer el archivo completo (${err instanceof Error ? err.message : 'error de permisos o memoria'}).`
    );
  }
  const bytes = new Uint8Array(buffer);

  // 1. ZIP-based backups (.zip, .bak, .mrpro, .mrstd, .bk, etc.)
  if (isZipMagic(bytes)) {
    const out = createEmptyResult(file.name, 'Copia comprimida (ZIP)');
    try {
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      const sourcesDetected = new Set<string>();

      // Read native Android manifest FIRST so we inherit Java's self-calibrated tagMap!
      type NativeManifest = {
        books?: Array<{
          realPath?: string;
          entryName?: string;
          fileName?: string;
          format?: string;
          title?: string;
          author?: string;
          description?: string;
          pageCount?: number;
          coverEntry?: string;
        }>;
        thumbs?: Array<{
          realPath?: string;
          entryName?: string;
          coverEntry?: string;
        }>;
        tagMap?: Record<string, string>;
      };
      let nativeManifest: NativeManifest | null = null;
      const nativeMetaEntry = zip.file('__komo_extracted_meta__.json');
      if (nativeMetaEntry) {
        try {
          nativeManifest = JSON.parse(await nativeMetaEntry.async('text')) as NativeManifest;
        } catch {
          nativeManifest = null;
        }
      }

      // Detect Moon+ Reader `_names.list` manifest mapping `1.tag`, `2.tag`, ... -> real filenames
      // Prefer Java's self-calibrated `nativeManifest.tagMap` when present so skipped `0.tag` never shifts indices!
      const tagNameMap = new Map<string, string>();
      const namesListEntry = entries.find((e) => /(^|\/)_names\.list$/i.test(e.name));
      if (nativeManifest?.tagMap && Object.keys(nativeManifest.tagMap).length > 0) {
        sourcesDetected.add('Moon+ Reader');
        for (const [tag, realPath] of Object.entries(nativeManifest.tagMap)) {
          tagNameMap.set(tag.toLowerCase(), realPath);
        }
      } else if (namesListEntry) {
        sourcesDetected.add('Moon+ Reader');
        const listText = await namesListEntry.async('text');
        const hasZeroTag = entries.some((e) => /(^|\/)0\.tag$/i.test(e.name));
        const parsedMap = parseMoonNamesList(listText, hasZeroTag);
        for (const [tag, realPath] of parsedMap.entries()) {
          tagNameMap.set(tag.toLowerCase(), realPath);
        }
      }

      for (const entry of entries) {
        if (entry === namesListEntry) continue;
        const baseName = (entry.name.split('/').pop() || entry.name).toLowerCase();
        const mappedRealName = tagNameMap.get(baseName) || entry.name;
        const lower = mappedRealName.toLowerCase();

        // Skip internal extracted cover images & manifest during generic loop (handled explicitly below)
        if (
          entry.name === '__komo_extracted_meta__.json' ||
          entry.name.startsWith('__komo_covers__/')
        ) {
          continue;
        }

        if (
          /\.(png|jpe?g|webp|gif|bmp|ttf|otf|woff2?|mp3|mp4|epub|pdf|cbz|cbr|db-shm|db-wal|journal)$/i.test(lower) ||
          lower.endsWith('-shm') ||
          lower.endsWith('-wal')
        ) {
          continue;
        }
        const innerBytes = await entry.async('uint8array');
        if (innerBytes.length === 0 || innerBytes.length > 35 * 1024 * 1024) continue;

        if (isSqliteMagic(innerBytes)) {
          const sqlRes = await parseSqliteDatabase(innerBytes, mappedRealName);
          if (sqlRes.detectedSource) sourcesDetected.add(sqlRes.detectedSource);
          mergeResults(out, sqlRes);
          continue;
        }

        // Skip Android shared_prefs XMLs except extracting any embedded Moon+ reading positions
        if (/shared_prefs\/.*\.xml$/i.test(lower) || /preferences\.xml$/i.test(lower)) {
          const xmlText = new TextDecoder('utf-8', { fatal: false }).decode(innerBytes);
          const prefRes = parseMoonSharedPrefsXml(xmlText, mappedRealName);
          if (prefRes.books.length) {
            sourcesDetected.add('Moon+ Reader');
            mergeResults(out, prefRes);
          }
          continue;
        }

        // Skip raw binary non-text tags inside .mrpro that aren't SQLite/text
        const innerText = new TextDecoder('utf-8', { fatal: false }).decode(innerBytes);
        const sample = innerText.slice(0, 256);
        let ctrlCount = 0;
        for (let i = 0; i < sample.length; i++) {
          const code = sample.charCodeAt(i);
          if (code === 0 || (code < 9 && code > 0) || (code > 13 && code < 32)) ctrlCount++;
        }
        if (sample.length > 16 && ctrlCount / sample.length > 0.2) {
          continue;
        }

        // For Moon+ Reader backups, avoid parsing random internal config/css/cache files as book lists
        if (
          namesListEntry &&
          !/\.(po|mrexpt|json|csv|tsv|txt|xml|opml|lua)$/i.test(lower) &&
          !innerText.trim().startsWith('{') &&
          !innerText.trim().startsWith('[') &&
          !innerText.includes('##')
        ) {
          continue;
        }

        const sub = await parseTextPayload(innerText, mappedRealName);
        if (sub.books.length || sub.bookmarks.length || sub.annotations.length || sub.notes.length) {
          if (sub.detectedSource && sub.detectedSource !== 'Copia JSON' && sub.detectedSource !== 'Archivo de texto') {
            sourcesDetected.add(sub.detectedSource);
          } else if (lower.includes('library.json')) {
            sourcesDetected.add('ReadEra');
          } else if (/history|favourites|bookmarks/.test(lower) && !lower.includes('.')) {
            sourcesDetected.add('Kotatsu');
          }
          mergeResults(out, sub);
        }
      }

      // Enrich books with real EPUB/PDF authors, titles, page counts & original covers extracted natively (or cached thumbnails inside ZIP)
      const coverEntryToDataUrl = async (entryPath: string): Promise<string | undefined> => {
        const f = zip.file(entryPath);
        if (!f) return undefined;
        try {
          const b = await f.async('uint8array');
          if (!b || b.length < 64) return undefined;
          const mime = /\.png$/i.test(entryPath)
            ? 'image/png'
            : /\.webp$/i.test(entryPath)
            ? 'image/webp'
            : 'image/jpeg';
          return `data:${mime};base64,${uint8ToBase64(b)}`;
        } catch {
          return undefined;
        }
      };

      const thumbPathToCoverEntry = new Map<string, string>();
      const thumbStemToCoverEntry = new Map<string, string>();
      const registerThumbPath = (realPath: string, coverEntry: string) => {
        if (!realPath || !coverEntry) return;
        const lowFull = realPath.replace(/\\/g, '/').toLowerCase();
        const base = (lowFull.split('/').pop() || lowFull).toLowerCase();
        thumbPathToCoverEntry.set(lowFull, coverEntry);
        thumbPathToCoverEntry.set(base, coverEntry);
        const normStem = normalizeMatchKey(base);
        if (normStem && normStem.length >= 2) {
          thumbStemToCoverEntry.set(normStem, coverEntry);
        }
      };

      // Also index any direct cover images inside non-native ZIPs (e.g. Desktop Moon+ Reader backups, including .tn thumbnails)
      for (const entry of entries) {
        if (entry.name.startsWith('__komo_covers__/')) continue;
        const baseName = (entry.name.split('/').pop() || entry.name).toLowerCase();
        const mappedReal = tagNameMap.get(baseName) || entry.name;
        if (/\.(jpe?g|png|webp|tn)$/i.test(mappedReal)) {
          registerThumbPath(mappedReal, entry.name);
        }
      }

      if (nativeManifest) {
        const resolveNativePath = (realPath?: string, entryName?: string, fallbackName?: string): string => {
          // If Java already mapped realPath to a real filename (not an unmapped N.tag), trust it directly!
          if (realPath && !/(^|\/)\d+\.tag$/i.test(realPath.trim())) {
            return realPath.trim();
          }
          const entryBase = (entryName || realPath || '').split('/').pop()?.toLowerCase() || '';
          return (entryBase && tagNameMap.get(entryBase)) || realPath || fallbackName || '';
        };

        for (const th of nativeManifest.thumbs || []) {
          if (!th.coverEntry) continue;
          const mapped = resolveNativePath(th.realPath, th.entryName);
          if (mapped) registerThumbPath(mapped, th.coverEntry);
        }

        for (const eb of nativeManifest.books || []) {
          const mappedPath = resolveNativePath(eb.realPath, eb.entryName, eb.fileName);
          const fileBase = (mappedPath.split(/[\\/]/).pop() || eb.fileName || '').trim();
          const coverDataUrl = eb.coverEntry ? await coverEntryToDataUrl(eb.coverEntry) : undefined;
          const inferred = isUnknownAuthor(eb.author) ? inferAuthorFromName(fileBase) : {};
          const finalTitle =
            (eb.title && eb.title.trim()) ||
            inferred.cleanTitle ||
            cleanBookTitleFromPath(fileBase);
          if (!finalTitle) continue;
          const finalAuthor =
            (!isUnknownAuthor(eb.author) ? eb.author!.trim() : inferred.author) || 'Autor desconocido';
          const format = normalizeFormat(eb.format, fileBase);
          out.books.push({
            title: finalTitle,
            author: finalAuthor,
            description: eb.description || undefined,
            pageCount: eb.pageCount || undefined,
            format,
            kind: normalizeKind('', finalTitle, format),
            fileName: fileBase || undefined,
            folderPath: extractFolderFromPath(mappedPath),
            coverDataUrl,
          });
        }
      }

      // Attach cached thumbnails to books (by thumbFile, coverFile, filename stem, or normalized title)
      if (thumbPathToCoverEntry.size > 0 || thumbStemToCoverEntry.size > 0) {
        const dataUrlCache = new Map<string, string | undefined>();
        const resolveCover = async (entryPath?: string) => {
          if (!entryPath) return undefined;
          if (!dataUrlCache.has(entryPath)) {
            dataUrlCache.set(entryPath, await coverEntryToDataUrl(entryPath));
          }
          return dataUrlCache.get(entryPath);
        };

        for (const b of out.books) {
          if (b.coverDataUrl) continue;
          const candidates = [b.coverFile, b.thumbFile].filter(Boolean) as string[];
          let matchedEntry: string | undefined;
          for (const cand of candidates) {
            const low = cand.replace(/\\/g, '/').toLowerCase();
            const base = low.split('/').pop() || low;
            matchedEntry =
              thumbPathToCoverEntry.get(low) ||
              thumbPathToCoverEntry.get(base) ||
              thumbStemToCoverEntry.get(normalizeMatchKey(base));
            if (matchedEntry) break;
          }
          if (!matchedEntry && b.fileName) {
            const fnLow = b.fileName.toLowerCase();
            matchedEntry =
              thumbPathToCoverEntry.get(`${fnLow}.tn`) ||
              thumbPathToCoverEntry.get(`${fnLow}.jpg`) ||
              thumbPathToCoverEntry.get(`${fnLow}.png`) ||
              thumbStemToCoverEntry.get(normalizeMatchKey(b.fileName));
          }
          if (!matchedEntry && b.title) {
            matchedEntry = thumbStemToCoverEntry.get(normalizeMatchKey(b.title));
          }
          if (matchedEntry) {
            b.coverDataUrl = await resolveCover(matchedEntry);
          }
        }
      }

      if (sourcesDetected.size > 0) {
        out.detectedSource = Array.from(sourcesDetected).join(' + ');
      }
      return dedupeResult(out);
    } catch {
      out.warnings.push('No se pudo descomprimir el archivo ZIP.');
      return out;
    }
  }

  // 2. Gzip-compressed backups (.gz, .tachibk, .json.gz)
  if (isGzipMagic(bytes)) {
    const inflated = await tryGunzip(bytes);
    if (inflated) {
      if (isZipMagic(inflated)) {
        const fakeFile = new File([inflated.buffer], file.name.replace(/\.gz$/i, '.zip'));
        return parseExternalBackupFile(fakeFile);
      }
      if (isSqliteMagic(inflated)) {
        return dedupeResult(await parseSqliteDatabase(inflated, file.name));
      }
      const asText = new TextDecoder('utf-8', { fatal: false }).decode(inflated);
      const trimmed = asText.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<') || trimmed.includes('==========')) {
        return dedupeResult(await parseTextPayload(asText, file.name));
      }
      return dedupeResult(extractReadableStringsFromBinary(inflated, file.name));
    }
  }

  // 3. Raw SQLite database (.db, .sqlite, .sqlite3, mrbooks.db, metadata.db, statistics.sqlite3)
  if (isSqliteMagic(bytes)) {
    return dedupeResult(await parseSqliteDatabase(bytes, file.name));
  }

  // 4. Text-based formats (JSON, CSV, TSV, Kindle My Clippings, XML, OPML, Lua, Moon+ .po/.mrexpt, TXT)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Check if file is mostly binary non-printable bytes
  const sample = text.slice(0, 512);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 9 && code > 0) || (code > 13 && code < 32)) nonPrintable++;
  }
  if (sample.length > 32 && nonPrintable / sample.length > 0.25) {
    return dedupeResult(extractReadableStringsFromBinary(bytes, file.name));
  }

  return dedupeResult(await parseTextPayload(text, file.name));
}
