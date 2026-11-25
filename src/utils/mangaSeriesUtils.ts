import type { BookFormat, BookItem, ContentKind } from '../types/library';
import { hasDisplayableOriginalCover } from './coverHelpers';

export type SeriesStatus = NonNullable<BookItem['seriesStatus']>;
export type OriginTag = NonNullable<BookItem['originTag']>;

export interface ParsedChapterPack {
  seriesName: string;
  seriesKey: string;
  chapterStart?: number;
  chapterEnd?: number;
  seriesOrder: number;
  chapterLabel: string;
  fansubs: string[];
  originTag: OriginTag;
  hasChapterPattern: boolean;
}

export interface SeriesChapterEntry {
  book: BookItem;
  chapterStart?: number;
  chapterEnd?: number;
  order: number;
  label: string;
  duplicateBooks: BookItem[];
}

export interface MangaSeriesGroup {
  seriesKey: string;
  seriesName: string;
  kind: 'manga' | 'manhwa' | 'comic';
  originTag: OriginTag;
  primaryBook: BookItem;
  continueBook: BookItem;
  chapters: SeriesChapterEntry[];
  allBooks: BookItem[];
  duplicateIds: string[];
  formats: BookFormat[];
  fansubs: string[];
  genres: string[];
  seriesStatus?: SeriesStatus;
  synopsis: string;
  totalChaptersExpected?: number;
  availableChaptersCount: number;
  minChapter?: number;
  maxChapter?: number;
  rangeLabel: string;
  missingRanges: string[];
  overallProgress: number;
  lastActivityAt: number;
  favorite: boolean;
  wishlist: boolean;
}

export type ShelfDisplayItem =
  | { type: 'book'; book: BookItem }
  | { type: 'series'; series: MangaSeriesGroup };

export interface ParsedTelegramSeriesCard {
  seriesName?: string;
  kind?: 'manga' | 'manhwa' | 'comic';
  originTag?: OriginTag;
  genres?: string[];
  fansubs?: string[];
  seriesStatus?: SeriesStatus;
  totalChaptersExpected?: number;
  synopsis?: string;
}

export function isVisualSeriesKind(kind: ContentKind): kind is 'manga' | 'manhwa' | 'comic' {
  return kind === 'manga' || kind === 'manhwa' || kind === 'comic';
}

export function normalizeSeriesKey(raw: string): string {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`´"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanSpaces(s: string): string {
  return s
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—·:|•.,]+|[\s\-–—·:|•.,]+$/g, '')
    .trim();
}

function stripExt(name: string): string {
  return String(name || '')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(epub|pdf|mobi|azw3?|prc|fb2|cbz|cbr|zip|rar|txt|md|html?|docx|mp3|m4b|m4a|ogg|wav)$/i, '');
}

function isLikelyFansubToken(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length < 2 || t.length > 48) return false;
  if (/^\d+(\s*[-–—al]\s*\d+)?$/i.test(t)) return false;
  if (/^(pdf|cbz|cbr|zip|rar|epub|es|esp|eng|en|lat|hd|lq|hq|manhwa|manga|manhua|comic|webtoon|completo|finalizado|emision|emisi[oó]n)$/i.test(t)) {
    return false;
  }
  if (/^(cap|caps|cap[ií]tulo|cap[ií]tulos|ch|chap|vol|tomo|parte|ep)\b/i.test(t)) return false;
  return /scan|fansub|sub|trad|team|studio|project|grupo|lectortmo|olympus|meian|ikigai|plot|leer|tmo|miauscan|miau|dragontranslation|monarca|niadd|manhwaweb|manhwa|manga/i.test(
    t
  ) || /^[A-Z][A-Za-z0-9\s.&'-]{2,36}$/.test(t);
}

export function detectOriginTag(text: string, kind: ContentKind): OriginTag {
  const low = text.normalize('NFKD').toLowerCase();
  if (/\bmanhua\b|🇨🇳/i.test(low)) return 'manhua';
  if (/\bmanhwa\b|\bwebtoon\b|🇰🇷/i.test(low) || kind === 'manhwa') return 'manhwa';
  if (/\bcomic\b|\bc[oó]mic\b|🇺🇸/i.test(low) || kind === 'comic') return 'comic';
  return 'manga';
}

export function formatOriginBadge(tag: OriginTag): string {
  switch (tag) {
    case 'manhwa':
      return '#Manhwa 🇰🇷';
    case 'manhua':
      return '#Manhua 🇨🇳';
    case 'comic':
      return '#Cómic';
    case 'manga':
    default:
      return '#Manga 🇯🇵';
  }
}

export function formatSeriesStatusBadge(status?: SeriesStatus): string {
  switch (status) {
    case 'completed':
      return '#Finalizado';
    case 'ongoing':
      return '#En Emisión';
    case 'hiatus':
      return '#En Pausa';
    case 'cancelled':
      return '#Cancelado';
    default:
      return '#En Biblioteca';
  }
}

function formatChapterNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '');
}

export function buildChapterLabel(start?: number, end?: number, fallbackTitle?: string): string {
  if (start !== undefined && end !== undefined && end > start) {
    return `Caps. ${formatChapterNum(start)}–${formatChapterNum(end)}`;
  }
  if (start !== undefined) {
    return `Cap. ${formatChapterNum(start)}`;
  }
  return fallbackTitle?.trim() || 'Capítulo único';
}

/**
 * Extracts clean series name, chapter range (e.g., 0-10, 11-21, Cap 5, Tomo 1),
 * fansub credits, and origin type from a Manga/Manhwa/Comic title/filename/folder.
 */
export function parseChapterPackInfo(
  rawTitle: string,
  fileName = '',
  folderPath = '',
  kind: ContentKind = 'manhwa'
): ParsedChapterPack {
  const baseFile = stripExt(fileName);
  const source = (rawTitle && rawTitle.trim().length > 1 ? rawTitle : baseFile).normalize('NFKC');
  const combinedForMeta = `${folderPath} ${baseFile} ${source}`;

  const fansubs: string[] = [];
  const pushFansub = (val: string) => {
    const clean = cleanSpaces(val.replace(/^@/, ''));
    if (!clean) return;
    if (!fansubs.some((f) => f.toLowerCase() === clean.toLowerCase())) {
      fansubs.push(clean);
    }
  };

  let working = source;

  // 1. Extract bracketed/parenthesized fansub tags & strip format/quality noise
  working = working.replace(/\[([^\]]{2,55})\]|\(([^)]{2,55})\)/g, (full, br1, br2) => {
    const inner = String(br1 || br2 || '').trim();
    // Keep if it contains chapter numbers so step 2 can parse it!
    if (/^(?:cap(?:s|itulos?|ítulos?)?|ch(?:ap)?|c|ep|tomo|vol)?\.?\s*\d+(?:\.\d+)?(?:\s*(?:[-–—~_]|al?|hasta|to)\s*\d+(?:\.\d+)?)?$/i.test(inner)) {
      return ` ${inner} `;
    }
    if (isLikelyFansubToken(inner)) {
      pushFansub(inner);
      return ' ';
    }
    if (/^(pdf|cbz|cbr|es|esp|español|espanol|latino|hd|hq|lq|manhwa|manga|manhua|webtoon|comic|completo|finalizado|tmo)$/i.test(inner)) {
      return ' ';
    }
    return full;
  });

  // Remove Telegram channel handles or trailing format words
  working = working
    .replace(/@[a-zA-Z0-9_]{3,}/g, ' ')
    .replace(/\b(pdf|cbz|cbr|español|espanol|sub\s*esp)\b/gi, ' ');

  let chapterStart: number | undefined;
  let chapterEnd: number | undefined;
  let hasChapterPattern = false;
  let stripped = working;

  // 2A. Explicit chapter range: "Cap 0-10", "Caps. 11 al 21", "Capítulos 01 a 10", "Ch. 1-10", "c01-c10"
  const explicitRangeRe =
    /(?:^|[\s\-–—_:|(\[])(?:cap(?:[ií]tulos?|s)?|ch(?:ap(?:ters?)?)?|episodios?|ep|c)\.?\s*#?\s*(\d{1,4}(?:\.\d+)?)\s*(?:[-–—~_]|al?|hasta|to)\s*(?:cap\.?|ch\.?|c)?\s*#?\s*(\d{1,4}(?:\.\d+)?)(?=$|[\s\-–—_:|)\],.])/i;
  const mExpRange = stripped.match(explicitRangeRe);
  if (mExpRange) {
    const a = Number(mExpRange[1]);
    const b = Number(mExpRange[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 500) {
      chapterStart = a;
      chapterEnd = b;
      hasChapterPattern = true;
      stripped = stripped.replace(mExpRange[0], ' ');
    }
  }

  // 2B. Trailing bare numeric range: "El Mejor Ingeniero 0-10", "Solo Leveling 11 - 21", "Nombre 001_010"
  if (!hasChapterPattern) {
    const trailingRangeRe =
      /(?:^|[\s\-–—_:|(\[])(\d{1,4}(?:\.\d+)?)\s*(?:[-–—~]|al)\s*(\d{1,4}(?:\.\d+)?)\s*[\])]*$/i;
    const mBareRange = stripped.trim().match(trailingRangeRe);
    if (mBareRange) {
      const a = Number(mBareRange[1]);
      const b = Number(mBareRange[2]);
      // Guard against years like 2020-2025
      const looksLikeYears = a >= 1950 && a <= 2099 && b >= 1950 && b <= 2099;
      if (!looksLikeYears && Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 500) {
        chapterStart = a;
        chapterEnd = b;
        hasChapterPattern = true;
        stripped = stripped.trim().slice(0, stripped.trim().length - mBareRange[0].length);
      }
    }
  }

  // 2C. Explicit single chapter: "Cap 12", "Capítulo 05.5", "Ch. 104", "#023"
  if (!hasChapterPattern) {
    const singleCapRe =
      /(?:^|[\s\-–—_:|(\[])(?:cap(?:[ií]tulo)?|ch(?:ap(?:ter)?)?|episodio|ep)\.?\s*#?\s*(\d{1,4}(?:\.\d+)?)(?=$|[\s\-–—_:|)\],.])/i;
    const mSingle = stripped.match(singleCapRe);
    if (mSingle) {
      const a = Number(mSingle[1]);
      if (Number.isFinite(a)) {
        chapterStart = a;
        chapterEnd = a;
        hasChapterPattern = true;
        stripped = stripped.replace(mSingle[0], ' ');
      }
    }
  }

  // 2D. Volume / Tomo / Parte fallback: "Tomo 1", "Vol. 02", "Parte 3"
  if (!hasChapterPattern) {
    const volRe =
      /(?:^|[\s\-–—_:|(\[])(?:tomo|vol(?:umen)?|parte|pack|paquete|bloque)\.?\s*#?\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?=$|[\s\-–—_:|)\],.])/i;
    const mVol = stripped.match(volRe);
    if (mVol) {
      const a = Number(mVol[1]);
      const b = mVol[2] ? Number(mVol[2]) : a;
      if (Number.isFinite(a)) {
        chapterStart = a;
        chapterEnd = Number.isFinite(b) && b >= a ? b : a;
        hasChapterPattern = true;
        stripped = stripped.replace(mVol[0], ' ');
      }
    }
  }

  // 2E. Leading numeric range when file lives inside a series folder: e.g. folder="El Mejor Ingeniero" file="0-10.pdf"
  if (!hasChapterPattern && folderPath.trim()) {
    const onlyRangeRe = /^\s*(\d{1,4}(?:\.\d+)?)(?:\s*(?:[-–—~_]|al?)\s*(\d{1,4}(?:\.\d+)?))?\s*$/i;
    const mOnly = cleanSpaces(working).match(onlyRangeRe);
    if (mOnly) {
      const a = Number(mOnly[1]);
      const b = mOnly[2] ? Number(mOnly[2]) : a;
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
        chapterStart = a;
        chapterEnd = b;
        hasChapterPattern = true;
        stripped = '';
      }
    }
  }

  let seriesName = cleanSpaces(stripped);
  // If filename was just "0-10" or "Cap 11-20", derive the series name from the deepest meaningful folder!
  if (!seriesName || seriesName.length < 2 || /^\d+$/.test(seriesName)) {
    const folderParts = folderPath
      .split(/[\\/]/)
      .map((p) => cleanSpaces(p))
      .filter(
        (p) =>
          p.length >= 2 &&
          !/^(descargas|downloads|documents|documentos|libros|books|mangas?|manhwas?|comics?|c[oó]mics?|telegram|komolib)$/i.test(
            p
          )
      );
    if (folderParts.length > 0) {
      seriesName = folderParts[folderParts.length - 1];
    } else {
      seriesName = cleanSpaces(source) || baseFile || 'Serie sin título';
    }
  }

  const seriesKey = normalizeSeriesKey(seriesName);
  const originTag = detectOriginTag(combinedForMeta, kind);
  const seriesOrder = chapterStart ?? 0;
  const chapterLabel = buildChapterLabel(chapterStart, chapterEnd, cleanSpaces(source));

  return {
    seriesName,
    seriesKey,
    chapterStart,
    chapterEnd,
    seriesOrder,
    chapterLabel,
    fansubs,
    originTag,
    hasChapterPattern,
  };
}

/**
 * Parses a pasted Telegram/channel manga/manhwa info block like:
 * 🎴𒆜𝐍𝐨𝐦𝐛𝐫𝐞: El Mejor Ingeniero Del Mundo
 * 🎴𒆜𝐓𝐢𝐩𝐨: #Manhwa 🇰🇷
 * 🎴𒆜𝐆𝐞𝐧𝐞𝐫𝐨: #Acción , #Aventura , #Comedia
 * 🎴𒆜𝐅𝐚𝐧𝐬𝐮𝐛𝐬: Meian Scans, Olympus Scan
 * 🎴𒆜𝐄𝐬𝐭𝐚𝐝𝐨: #Finalizado
 * 🎴𒆜𝐂𝐚𝐩𝐢𝐭𝐮𝐥𝐨𝐬: 210
 * 🎴𒆜𝐒𝐢𝐧𝐨𝐩𝐬𝐢𝐬: ...
 */
export function parseTelegramSeriesCard(raw: string): ParsedTelegramSeriesCard {
  const result: ParsedTelegramSeriesCard = {};
  if (!raw || !raw.trim()) return result;

  // NFKD converts fancy mathematical Unicode bold letters (𝐍𝐨𝐦𝐛𝐫𝐞 -> Nombre);
  // NFC re-composes Spanish accents cleanly (o + combining acute -> ó).
  const normalized = raw.normalize('NFKD').normalize('NFC').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let collectingSynopsis = false;
  const synopsisLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (collectingSynopsis && synopsisLines.length > 0) synopsisLines.push('');
      continue;
    }

    // Strip decorative symbols/emojis before field label
    const cleanField = line.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9#]+/, '');
    const m = cleanField.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{2,22})\s*[:：]\s*(.*)$/);

    if (m) {
      const key = m[1]
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      const val = m[2].trim();

      if (key === 'sinopsis' || key === 'descripcion' || key === 'resumen') {
        collectingSynopsis = true;
        if (val) synopsisLines.push(val);
        continue;
      }

      collectingSynopsis = false;

      if (key === 'nombre' || key === 'titulo' || key === 'serie') {
        if (val) result.seriesName = cleanSpaces(val);
      } else if (key === 'tipo') {
        const low = val.toLowerCase();
        if (low.includes('manhua')) {
          result.kind = 'manhwa';
          result.originTag = 'manhua';
        } else if (low.includes('manhwa') || low.includes('webtoon')) {
          result.kind = 'manhwa';
          result.originTag = 'manhwa';
        } else if (low.includes('comic')) {
          result.kind = 'comic';
          result.originTag = 'comic';
        } else if (low.includes('manga')) {
          result.kind = 'manga';
          result.originTag = 'manga';
        }
      } else if (key === 'genero' || key === 'generos' || key === 'etiquetas') {
        const parsedGenres = val
          .split(/[,/|·]+/)
          .map((g) => g.replace(/#/g, '').trim())
          .filter((g) => g.length >= 2 && g.length <= 36);
        if (parsedGenres.length) result.genres = Array.from(new Set(parsedGenres));
      } else if (key === 'fansub' || key === 'fansubs' || key === 'scan' || key === 'scans' || key === 'traduccion') {
        const parsedFansubs = val
          .split(/[,/|·]+/)
          .map((f) => f.replace(/#/g, '').trim())
          .filter((f) => f.length >= 2 && f.length <= 48);
        if (parsedFansubs.length) result.fansubs = Array.from(new Set(parsedFansubs));
      } else if (key === 'estado' || key === 'status') {
        const low = val.toLowerCase();
        if (/finaliz|complet|terminad/.test(low)) result.seriesStatus = 'completed';
        else if (/pausa|hiatus/.test(low)) result.seriesStatus = 'hiatus';
        else if (/cancel|drop|abandon/.test(low)) result.seriesStatus = 'cancelled';
        else if (/emisi|curso|ongoing|activ/.test(low)) result.seriesStatus = 'ongoing';
      } else if (key === 'capitulo' || key === 'capitulos' || key === 'caps') {
        const numMatch = val.match(/(\d{1,5})/);
        if (numMatch) {
          const n = Number(numMatch[1]);
          if (Number.isFinite(n) && n > 0) result.totalChaptersExpected = n;
        }
      }
    } else if (collectingSynopsis) {
      synopsisLines.push(line);
    }
  }

  if (synopsisLines.length > 0) {
    result.synopsis = synopsisLines.join('\n').trim();
  }

  return result;
}

function scoreBookQuality(b: BookItem): number {
  let score = 0;
  if (b.hasLocalFile) score += 1000;
  if (b.hasRemoteFile || b.driveFileId) score += 200;
  if (hasDisplayableOriginalCover(b)) score += 120;
  score += Math.min(100, b.progress || 0);
  if (b.description && b.description.length > 30) score += 40;
  return score;
}

/**
 * Groups Manga / Manhwa / Comic chapter-pack files into unified series entries
 * (sorted, deduplicated, with available chapter stats and missing-gap detection),
 * while leaving standard Books & Audiobooks 100% untouched.
 */
export function groupLibraryForDisplay(books: BookItem[]): ShelfDisplayItem[] {
  const seriesBuckets = new Map<string, { parsedList: Array<{ book: BookItem; parsed: ParsedChapterPack }> }>();
  const bookOrderIndex = new Map<string, number>();

  books.forEach((b, idx) => {
    bookOrderIndex.set(b.id, idx);
    if (!isVisualSeriesKind(b.kind)) return;

    const parsed = parseChapterPackInfo(b.seriesName || b.title, b.fileName, b.folderPath || '', b.kind);
    const effectiveSeriesName = b.seriesName?.trim() || parsed.seriesName;
    const key = normalizeSeriesKey(effectiveSeriesName) || normalizeSeriesKey(b.title) || b.id;

    // Respect explicit chapterStart/chapterEnd if saved on BookItem
    const finalParsed: ParsedChapterPack = {
      ...parsed,
      seriesName: effectiveSeriesName,
      seriesKey: key,
      chapterStart: b.chapterStart ?? parsed.chapterStart,
      chapterEnd: b.chapterEnd ?? parsed.chapterEnd,
      seriesOrder: b.chapterStart ?? b.seriesOrder ?? parsed.seriesOrder,
      chapterLabel: buildChapterLabel(
        b.chapterStart ?? parsed.chapterStart,
        b.chapterEnd ?? parsed.chapterEnd,
        b.title
      ),
      originTag: b.originTag || parsed.originTag,
    };

    const bucket = seriesBuckets.get(key) || { parsedList: [] };
    bucket.parsedList.push({ book: b, parsed: finalParsed });
    seriesBuckets.set(key, bucket);
  });

  const emittedSeries = new Set<string>();
  const displayItems: ShelfDisplayItem[] = [];

  for (const book of books) {
    if (!isVisualSeriesKind(book.kind)) {
      displayItems.push({ type: 'book', book });
      continue;
    }

    const parsedSelf = parseChapterPackInfo(
      book.seriesName || book.title,
      book.fileName,
      book.folderPath || '',
      book.kind
    );
    const key =
      normalizeSeriesKey(book.seriesName?.trim() || parsedSelf.seriesName) ||
      normalizeSeriesKey(book.title) ||
      book.id;

    if (emittedSeries.has(key)) continue;
    emittedSeries.add(key);

    const bucket = seriesBuckets.get(key);
    if (!bucket || bucket.parsedList.length === 0) {
      displayItems.push({ type: 'book', book });
      continue;
    }

    const seriesGroup = buildSeriesGroup(key, bucket.parsedList);
    displayItems.push({ type: 'series', series: seriesGroup });
  }

  return displayItems;
}

function buildSeriesGroup(
  seriesKey: string,
  items: Array<{ book: BookItem; parsed: ParsedChapterPack }>
): MangaSeriesGroup {
  // Sort raw items by chapterStart -> chapterEnd -> order -> natural filename
  const sorted = [...items].sort((a, b) => {
    const aHas = a.parsed.chapterStart !== undefined ? 0 : 1;
    const bHas = b.parsed.chapterStart !== undefined ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    const as = a.parsed.chapterStart ?? a.parsed.seriesOrder ?? 0;
    const bs = b.parsed.chapterStart ?? b.parsed.seriesOrder ?? 0;
    if (as !== bs) return as - bs;
    const ae = a.parsed.chapterEnd ?? as;
    const be = b.parsed.chapterEnd ?? bs;
    if (ae !== be) return ae - be;
    return (a.book.fileName || a.book.title).localeCompare(b.book.fileName || b.book.title, 'es', {
      numeric: true,
      sensitivity: 'base',
    });
  });

  // Deduplicate exact same chapter range (e.g. duplicate "0-10" downloads)
  const dedupMap = new Map<string, SeriesChapterEntry>();
  const duplicateIds: string[] = [];

  for (const { book, parsed } of sorted) {
    const rangeKey =
      parsed.chapterStart !== undefined
        ? `${parsed.chapterStart}::${parsed.chapterEnd ?? parsed.chapterStart}`
        : `single::${normalizeSeriesKey(book.fileName || book.title) || book.id}`;

    const existing = dedupMap.get(rangeKey);
    if (!existing) {
      dedupMap.set(rangeKey, {
        book,
        chapterStart: parsed.chapterStart,
        chapterEnd: parsed.chapterEnd,
        order: parsed.seriesOrder,
        label: parsed.chapterLabel,
        duplicateBooks: [],
      });
    } else {
      // Keep higher-quality copy as canonical, record the other as duplicate
      if (scoreBookQuality(book) > scoreBookQuality(existing.book)) {
        existing.duplicateBooks.push(existing.book);
        duplicateIds.push(existing.book.id);
        existing.book = book;
      } else {
        existing.duplicateBooks.push(book);
        duplicateIds.push(book.id);
      }
    }
  }

  const chapters = Array.from(dedupMap.values());
  const allBooks = sorted.map((x) => x.book);

  // Pick display series name (prefer explicit seriesName or clean parsed name)
  const explicitName = allBooks.find((b) => b.seriesName?.trim())?.seriesName?.trim();
  const seriesName = explicitName || sorted[0].parsed.seriesName || sorted[0].book.title;

  // Pick best cover book (prefer first chapter with real original cover, else any with cover, else first chapter)
  const primaryBook =
    chapters.find((c) => hasDisplayableOriginalCover(c.book))?.book ||
    chapters[0].book;

  // Pick continueBook (most recently read incomplete chapter, else first unread chapter after last completed, else first)
  const inProgress = [...chapters]
    .filter((c) => (c.book.progress || 0) > 0 && (c.book.progress || 0) < 98)
    .sort((a, b) => (b.book.lastReadAt || 0) - (a.book.lastReadAt || 0));

  let continueBook = inProgress[0]?.book;
  if (!continueBook) {
    let lastCompletedIdx = -1;
    chapters.forEach((c, idx) => {
      if ((c.book.progress || 0) >= 98 || c.book.readingStatus === 'completed') {
        lastCompletedIdx = idx;
      }
    });
    if (lastCompletedIdx >= 0 && lastCompletedIdx + 1 < chapters.length) {
      continueBook = chapters[lastCompletedIdx + 1].book;
    } else if (lastCompletedIdx === chapters.length - 1) {
      continueBook = chapters[lastCompletedIdx].book;
    } else {
      continueBook = chapters[0].book;
    }
  }

  // Compute formats, fansubs, genres, synopsis, status, expected chapters
  const formats = Array.from(new Set(chapters.map((c) => c.book.format)));
  const fansubSet = new Map<string, string>();
  const genreSet = new Map<string, string>();
  let synopsis = '';
  let seriesStatus: SeriesStatus | undefined;
  let totalChaptersExpected: number | undefined;
  let originTag: OriginTag = sorted[0].parsed.originTag;

  for (const { book, parsed } of sorted) {
    if (book.originTag) originTag = book.originTag;
    if (book.seriesStatus && !seriesStatus) seriesStatus = book.seriesStatus;
    if (book.totalChaptersExpected && (!totalChaptersExpected || book.totalChaptersExpected > totalChaptersExpected)) {
      totalChaptersExpected = book.totalChaptersExpected;
    }
    if (book.description && book.description.trim().length > synopsis.length) {
      synopsis = book.description.trim();
    }
    for (const f of [...(book.fansubs || []), ...parsed.fansubs]) {
      const clean = f.trim();
      if (clean && !fansubSet.has(clean.toLowerCase())) fansubSet.set(clean.toLowerCase(), clean);
    }
    for (const g of book.genres || []) {
      const clean = g.replace(/^#/, '').trim();
      if (clean && !genreSet.has(clean.toLowerCase())) genreSet.set(clean.toLowerCase(), clean);
    }
    for (const t of book.tags || []) {
      const clean = t.replace(/^#/, '').trim();
      if (
        clean &&
        !/^(moon\+|readera|kindle|calibre|goodreads|komolib|copia|pdf|cbz|cbr|manga|manhwa|comic)$/i.test(clean) &&
        !genreSet.has(clean.toLowerCase())
      ) {
        genreSet.set(clean.toLowerCase(), clean);
      }
    }
  }

  // Calculate chapter coverage (min, max, unique count, and missing gaps)
  const numericIntervals: Array<[number, number]> = [];
  for (const ch of chapters) {
    if (ch.chapterStart !== undefined) {
      const s = Math.floor(ch.chapterStart);
      const e = Math.floor(ch.chapterEnd ?? ch.chapterStart);
      numericIntervals.push([s, Math.max(s, e)]);
    }
  }

  let minChapter: number | undefined;
  let maxChapter: number | undefined;
  let availableChaptersCount = chapters.length;
  const missingRanges: string[] = [];

  if (numericIntervals.length > 0) {
    numericIntervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: Array<[number, number]> = [];
    for (const [s, e] of numericIntervals) {
      const last = merged[merged.length - 1];
      if (!last || s > last[1] + 1) {
        merged.push([s, e]);
      } else {
        last[1] = Math.max(last[1], e);
      }
    }
    minChapter = merged[0][0];
    maxChapter = merged[merged.length - 1][1];

    // Count chapters covered (if starts at 0 and goes to 10, usually 10 chapters + prologue; count maxChapter if contiguous from 0/1)
    let covered = 0;
    for (const [s, e] of merged) {
      covered += e - s + 1;
    }
    // If prologue 0 is included alongside 1..N, show maxChapter cleanly when fully contiguous (e.g. 0-210 -> 210 caps)
    availableChaptersCount =
      merged.length === 1 && minChapter === 0 && maxChapter > 0 ? maxChapter : covered;

    for (let i = 1; i < merged.length; i++) {
      const gapStart = merged[i - 1][1] + 1;
      const gapEnd = merged[i][0] - 1;
      if (gapStart <= gapEnd) {
        missingRanges.push(gapStart === gapEnd ? `${gapStart}` : `${gapStart}–${gapEnd}`);
      }
    }
  }

  const rangeLabel =
    minChapter !== undefined && maxChapter !== undefined
      ? minChapter === maxChapter
        ? `Cap. ${minChapter}`
        : `Caps. ${minChapter}–${maxChapter}`
      : `${chapters.length} ${chapters.length === 1 ? 'archivo' : 'partes'}`;

  // Overall progress weighted by chapter span (so a 10-chapter pack counts for 10x a 1-chapter file!)
  let weightedDone = 0;
  let totalWeight = 0;
  for (const ch of chapters) {
    const span =
      ch.chapterStart !== undefined && ch.chapterEnd !== undefined
        ? Math.max(1, ch.chapterEnd - ch.chapterStart + 1)
        : 1;
    const pct = ch.book.readingStatus === 'completed' ? 100 : Math.min(100, Math.max(0, ch.book.progress || 0));
    weightedDone += (pct / 100) * span;
    totalWeight += span;
  }
  const overallProgress = totalWeight > 0 ? Math.round((weightedDone / totalWeight) * 100) : 0;

  const lastActivityAt = Math.max(
    ...allBooks.map((b) => Math.max(b.lastReadAt || 0, b.finishedAt || 0, b.updatedAt || 0, b.addedAt || 0))
  );

  const kind = (allBooks.find((b) => b.kind === 'manhwa')?.kind ||
    allBooks.find((b) => b.kind === 'manga')?.kind ||
    allBooks.find((b) => b.kind === 'comic')?.kind ||
    'manhwa') as 'manga' | 'manhwa' | 'comic';

  return {
    seriesKey,
    seriesName,
    kind,
    originTag,
    primaryBook,
    continueBook,
    chapters,
    allBooks,
    duplicateIds,
    formats,
    fansubs: Array.from(fansubSet.values()),
    genres: Array.from(genreSet.values()),
    seriesStatus,
    synopsis,
    totalChaptersExpected,
    availableChaptersCount,
    minChapter,
    maxChapter,
    rangeLabel,
    missingRanges,
    overallProgress,
    lastActivityAt,
    favorite: allBooks.some((b) => b.favorite),
    wishlist: allBooks.some((b) => b.wishlist),
  };
}

/**
 * Finds the previous and next chapter packs for the currently open Manga/Manhwa/Comic in ReaderShell.
 */
export function getSeriesNavigationForBook(
  books: BookItem[],
  activeBook: BookItem | null
): {
  series: MangaSeriesGroup;
  currentIndex: number;
  prevEntry: SeriesChapterEntry | null;
  nextEntry: SeriesChapterEntry | null;
} | null {
  if (!activeBook || !isVisualSeriesKind(activeBook.kind)) return null;
  const items = groupLibraryForDisplay(books);
  for (const item of items) {
    if (item.type !== 'series') continue;
    const idx = item.series.chapters.findIndex(
      (ch) => ch.book.id === activeBook.id || ch.duplicateBooks.some((d) => d.id === activeBook.id)
    );
    if (idx !== -1 && item.series.chapters.length > 1) {
      return {
        series: item.series,
        currentIndex: idx,
        prevEntry: idx > 0 ? item.series.chapters[idx - 1] : null,
        nextEntry: idx + 1 < item.series.chapters.length ? item.series.chapters[idx + 1] : null,
      };
    }
  }
  return null;
}
