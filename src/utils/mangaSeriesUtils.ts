import type { BookFormat, BookItem, ContentKind } from '../types/library';
import { hasDisplayableOriginalCover } from './coverHelpers';

export type SeriesStatus = NonNullable<BookItem['seriesStatus']>;
export type OriginTag = NonNullable<BookItem['originTag']>;

export interface ParsedChapterPack {
  seriesName: string;
  seriesKey: string;
  /** Alternative normalized keys (e.g. both halves of "Equilibrio Térmico / Heat Balance") */
  altKeys?: string[];
  chapterStart?: number;
  chapterEnd?: number;
  seriesOrder: number;
  chapterLabel: string;
  fansubs: string[];
  originTag: OriginTag;
  hasChapterPattern: boolean;
  /** True when the chapter pattern came from explicit keywords/ranges (not just a bare trailing number) */
  isExplicitPattern: boolean;
  /** True when this pack is Extras / Side Stories / Epilogue so it sorts after main chapters and never deduplicates against Cap 1-12 */
  isExtra?: boolean;
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
  author?: string;
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
    .replace(/^[\s\-–—·:|•.,~#()[\]{}【】『』《》]+|[\s\-–—·:|•.,~#()[\]{}【】『』《》]+$/g, '')
    .trim();
}

function stripExt(name: string): string {
  return String(name || '')
    .split(/(?<!\s)[\\/](?!\s)/)
    .pop()!
    .replace(/\.(epub|pdf|mobi|azw3?|prc|fb2|cbz|cbr|zip|rar|txt|md|html?|docx|mp3|m4b|m4a|ogg|wav)$/i, '');
}

const GENERIC_FOLDER_RE =
  /^(descargas|downloads|documents|documentos|libros|books|ebooks?|mangas?|manhwas?|manhuas?|webtoons?|comics?|c[oó]mics?|telegram|komolib|pdf|cbz|cbr|lectura|storage|emulated|0|sdcard|primary)$/i;

function extractFolderSeriesName(folderPath: string): string {
  if (!folderPath) return '';
  const parts = folderPath
    .split(/[\\/]/)
    .map((p) => cleanSeriesNoise(p))
    .filter((p) => p.length >= 2 && !GENERIC_FOLDER_RE.test(p) && !/^\d+(\s*[-–—]\s*\d+)?$/.test(p));
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

const KNOWN_FANSUB_RE =
  /scans?|scanlations?|fansubs?|sub(?:s|titulado)?|trad(?:ucci[oó]n(?:es)?)?|translations?|teams?|equipos?|studios?|projects?|proyectos?|grupos?|lectortmo|lectormanga|olympus|meian|ikigai|plot\s*twist|tmo|miauscan|miau|dragontranslation|monarca|niadd|manhwaweb|asura|reaper|flame|luminous|shadow|knight|heaven|cosmos|dragon\s*translation|nova\s*scan|tumanga|zonatmo|vermanhwa|es\.?novel|mango\s*scan|ajce|traducciones\s+amistosas|amistosas/i;

function isKnownFansubToken(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length < 2 || t.length > 52) return false;
  if (/^\d+(\s*[-–—al]\s*\d+)?$/i.test(t)) return false;
  if (
    /^(pdf|cbz|cbr|zip|rar|epub|es|esp|español|espanol|eng|en|lat|latino|hd|lq|hq|manhwa|manga|manhua|comic|webtoon|completo|completa|finalizado|finalizada|final|fin|end|emision|emisi[oó]n|tmo|sin\s*censura|uncensored|color|full\s*color|extras?|ep[ií]logo|especial)$/i.test(
      t
    )
  ) {
    return false;
  }
  if (/^(cap|caps|cap[ií]tulo|cap[ií]tulos|ch|chap|vol|tomo|parte|ep|del)\b/i.test(t)) return false;
  return KNOWN_FANSUB_RE.test(t);
}

/**
 * Strips leading unbracketed fansub prefixes separated by a delimiter
 * (e.g. "Olympus Scan - El Mejor Ingeniero 1-10", "Traducciones Amistosas | Una Vez Más 1-10").
 */
function stripUnbracketedFansubPrefix(raw: string, onFansub?: (team: string) => void): string {
  let s = String(raw || '');
  const prefixMatch = s.match(/^\s*([A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9_.\s&'-]{2,44})\s*[-–—|·:]\s+(.+)$/);
  if (prefixMatch) {
    const head = cleanSpaces(prefixMatch[1]);
    const tail = cleanSpaces(prefixMatch[2]);
    if (tail.length >= 3 && isKnownFansubToken(head)) {
      onFansub?.(head);
      s = tail;
    }
  }
  return s;
}

/**
 * Extracts and strips unbracketed fansub / translation team suffixes (e.g. "- Olympus Scan",
 * "| Meian Scans", "Traducciones Amistosas", "Ajce Translations", "Mango Scan") ONLY when the
 * trailing segment clearly identifies a fansub/scanlation team — NEVER chopping normal Spanish
 * titles containing "por" (like "La Villana es Adorada por la Familia"!).
 */
function stripUnbracketedFansubSuffix(raw: string, onFansub?: (team: string) => void): string {
  let s = String(raw || '');

  // 1. Explicit "by / por" attribution ONLY when followed by a recognized fansub/scan team or @handle
  const byMatch = s.match(/(?:^|[\s\-–—|:])(?:by|por)\s*[:.]?\s*(@?[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9_.\s&'-]{2,44})$/i);
  if (byMatch && byMatch.index !== undefined && byMatch.index >= 3) {
    const team = cleanSpaces(byMatch[1].replace(/^@/, ''));
    if (team && (byMatch[1].startsWith('@') || isKnownFansubToken(team))) {
      onFansub?.(team);
      s = s.slice(0, byMatch.index);
    }
  }

  // 2. Dash/pipe separated trailing segment that is a recognized fansub/team
  const sepMatch = s.match(/^(.*?)[\s]*(?:[-–—|·])[\s]+([A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9_.\s&'-]{2,48})$/);
  if (sepMatch) {
    const head = cleanSpaces(sepMatch[1]);
    const tail = cleanSpaces(sepMatch[2]);
    if (head.length >= 3 && isKnownFansubToken(tail)) {
      onFansub?.(tail);
      s = head;
    }
  }

  // 3. Bare trailing fansub phrase: "Traducciones Amistosas", "Ajce Translations", "Mango Scan",
  // "Olympus Scan", "Meian Scans", "Ikigai Scans", etc.
  const bareTeamMatch = s.match(
    /\s+((?:trad(?:ucci[oó]n(?:es)?)?|scan(?:lation)?s?|fansubs?)\s+[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9.'&-]{2,28}|(?:[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9.'&-]+\s+){0,2}(?:scans?|scanlations?|fansubs?|translations?|traducci[oó]n(?:es)?|no\s*fansub|lectortmo|lectormanga|olympus(?:\s+scan)?|meian(?:\s+scans?)?|ikigai(?:\s+scans?)?|mango\s*scans?|ajce(?:\s+translations?)?|miauscan|monarca\s*manga|manhwaweb|dragontranslation|asura\s*scans?|reaper\s*scans?))\s*$/i
  );
  if (bareTeamMatch && bareTeamMatch.index !== undefined && bareTeamMatch.index >= 3) {
    const team = cleanSpaces(bareTeamMatch[1]);
    if (team) onFansub?.(team);
    s = s.slice(0, bareTeamMatch.index);
  }

  return s;
}

/**
 * Normalizes underscore-separated filenames safely before regex matching so `\b` word boundaries
 * work on Telegram downloads like `La_Villana_es_Adorada_por_la_Familia_01_10.pdf`!
 */
function normalizeUnderscoresForParsing(raw: string): string {
  let s = String(raw || '').normalize('NFKC');
  // Preserve underscore chapter ranges like "_01_10" or "_1_30" as " 01-10 " before replacing "_" with " "
  s = s.replace(
    /(^|[\s_.\-([|])(\d{1,4})_(\d{1,4})(?=$|[\s_.\-)\]|])/g,
    (full, sep, aStr, bStr) => {
      const a = Number(aStr);
      const b = Number(bStr);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 400 && !isYearNumber(a)) {
        return `${sep === '_' ? ' ' : sep}${aStr}-${bStr}`;
      }
      return full;
    }
  );
  return s.replace(/_+/g, ' ');
}

/**
 * Strips common Telegram/scanlation noise tokens so different chapter packs
 * of the same series always normalize to the exact same seriesName/seriesKey.
 */
function cleanSeriesNoise(raw: string): string {
  let s = normalizeUnderscoresForParsing(raw);
  // Strip decorative symbols/emojis and standalone plus signs
  s = s.replace(/[🎴★☆✦✧❖◆◇●○•🔥⚡💀✨👑💎🌸❄️🌊🗡️⚔️🛡️📖📚✅📌🏷️+]/g, ' ');
  // Strip @handles
  s = s.replace(/@[a-zA-Z0-9_]{3,}/g, ' ');
  // Strip season/ending/extra/volume phrases that differ across packs of the same series
  // (e.g. "Nombre Tomo 1 Cap 1-10", "Nombre Vol 2 11-20", "Nombre 200-210 FINAL + Extras")
  s = s.replace(
    /\b(fin\s+de\s+temporada|parte\s+final|cap[ií]tulo\s+final|[uú]ltima\s+parte|side\s*stor(?:y|ies)|historias?\s*(?:extras?|paralelas?)|the\s+end|temporada\s*\d+|season\s*\d+|temp\.?\s*\d+|tomo\s*#?\s*\d+|vol(?:umen)?\.?\s*#?\s*\d+|pack\s*#?\s*\d+|paquete\s*#?\s*\d+|bloque\s*#?\s*\d+|parte\s*#?\s*\d+|(?:t|s)\d{1,2}(?=$|[\s\-–—_:|)\]])|con\s+extras?|y\s+extras?|y\s+ep[ií]logos?)\b/gi,
    ' '
  );
  // Strip format / language / media tokens anywhere
  s = s.replace(
    /\b(pdf|cbz|cbr|español|espanol|sub\s*esp|latino|completo|completa|finalizado|finalizada|extras?|ep[ií]logos?|pr[oó]logos?|especiales?|specials?|actualizado|en\s*emisi[oó]n|manhwa|manhua|webtoon|manga|sin\s*censura|full\s*color|hd|hq)\b/gi,
    ' '
  );
  // Strip trailing status words (FINAL / FIN / END / NUEVO) only at the end so titles like
  // "El Fin Después del Principio" keep their core words intact!
  s = s.replace(/(?:[\s\-–—:|]+)(?:final|fin|end|nuevo|nueva)\s*$/gi, ' ');
  // Strip dangling chapter keywords left over after removing numbers
  s = s.replace(/\b(?:cap[ií]tulos?|caps?|ch(?:ap(?:ters?)?)?|episodios?|ep|tomos?|vol(?:umen)?|del|hasta|al)\s*\.?$/gi, ' ');
  s = s.replace(/^(?:cap[ií]tulos?|caps?|ch(?:ap(?:ters?)?)?|episodios?|ep|tomos?|vol(?:umen)?|del)\s*\.?\s+/gi, ' ');
  return cleanSpaces(s);
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

export function buildChapterLabel(
  start?: number,
  end?: number,
  fallbackTitle?: string,
  isExtra?: boolean
): string {
  if (isExtra) {
    if (start !== undefined && end !== undefined && end > start) {
      return `Extras ${formatChapterNum(start)}–${formatChapterNum(end)}`;
    }
    if (start !== undefined) {
      return `Extra ${formatChapterNum(start)}`;
    }
    return 'Extras';
  }
  if (start !== undefined && end !== undefined && end > start) {
    return `Caps. ${formatChapterNum(start)}–${formatChapterNum(end)}`;
  }
  if (start !== undefined) {
    return `Cap. ${formatChapterNum(start)}`;
  }
  return fallbackTitle?.trim() || 'Capítulo único';
}

function isYearNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 1950 && n <= 2099;
}

function parseSingleSource(
  sourceRaw: string,
  folderPath: string,
  kind: ContentKind,
  allowBareTrailingSingle: boolean
): ParsedChapterPack {
  const source = normalizeUnderscoresForParsing(sourceRaw);
  const combinedForMeta = `${folderPath} ${source}`;
  const isExtra =
    /\b(extras?|side\s*stor(?:y|ies)|historias?\s*(?:extras?|paralelas?)|ep[ií]logos?|especiales?|specials?)\b/i.test(
      source
    ) && !/\b(?:cap(?:[ií]tulos?|s)?|ch)\s*\.?\s*0?\d+\s*[-–—]\s*\d{2,}/i.test(source);

  const fansubs: string[] = [];
  const pushFansub = (val: string) => {
    const clean = cleanSpaces(val.replace(/^@/, ''));
    if (!clean) return;
    if (!fansubs.some((f) => f.toLowerCase() === clean.toLowerCase())) {
      fansubs.push(clean);
    }
  };

  let working = source.replace(/[【『《]/g, '[').replace(/[】』》]/g, ']');

  // Strip Android/Telegram duplicate download counters at the very end like " (1)", " (2)" ONLY when
  // there is already another chapter number or range earlier in the filename!
  if (/\d\s*[-–—~]\s*\d|\b(?:cap|ch|tomo|vol)\b/i.test(working)) {
    working = working.replace(/\s*\(\s*\d{1,2}\s*\)\s*$/i, ' ');
  }

  // 1. Inspect bracketed/parenthesized tokens: unwrap chapter numbers, capture fansubs, drop noise/alt titles
  const altTitleCandidates: string[] = [];
  working = working.replace(/\[([^\]]{1,70})\]|\(([^)]{1,70})\)/g, (full, br1, br2, offset: number) => {
    const inner = String(br1 || br2 || '').trim();
    if (
      /^(?:del\s+)?(?:cap(?:[ií]tulos?|s)?|ch(?:ap(?:ters?)?)?|c|ep|tomo|vol|extras?)?\.?\s*#?\s*\d+(?:\.\d+)?(?:\s*(?:[-–—~]|al?|hasta|to)\s*(?:cap\.?|ch\.?|c)?\s*#?\s*\d+(?:\.\d+)?)?$/i.test(
        inner
      )
    ) {
      return ` ${inner} `;
    }
    if (isKnownFansubToken(inner)) {
      pushFansub(inner);
      return ' ';
    }
    if (
      /^(pdf|cbz|cbr|es|esp|español|espanol|lat|latino|hd|hq|lq|manhwa|manga|manhua|webtoon|comic|completo|completa|finalizado|finalizada|final|fin|end|extras?|ep[ií]logo|especial|tmo|sin\s*censura|full\s*color|m[aá]s\s*18|\+?18)$/i.test(
        inner
      )
    ) {
      return ' ';
    }
    // Parenthesized/bracketed alternative title AFTER an already-present title (e.g. "Mi Razón Para Morir (My Reason to Die)")
    // Strip it from the main title so packs with/without it unify, and keep it as an altKey (NEVER as a fansub!).
    if (offset >= 4 && /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9\s.,'’!?:-]{3,60}$/.test(inner)) {
      const altK = normalizeSeriesKey(inner);
      if (altK.length >= 3) altTitleCandidates.push(altK);
      return ' ';
    }
    return full;
  });

  // Remove handles & obvious format words before chapter matching
  working = working
    .replace(/@[a-zA-Z0-9_]{3,}/g, ' ')
    .replace(
      /\b(pdf|cbz|cbr|español|espanol|sub\s*esp|latino|completo|completa|finalizado|finalizada|fin\s+de\s+temporada|parte\s+final|the\s+end|extras?|ep[ií]logos?|especiales?)\b/gi,
      ' '
    )
    .replace(/(?:[\s\-–—:|]+)(?:final|fin|end)\s*$/gi, ' ');

  let chapterStart: number | undefined;
  let chapterEnd: number | undefined;
  let hasChapterPattern = false;
  let isExplicitPattern = false;
  let stripped = working;

  // Helper: when a chapter range/number is found at match.index, keep ONLY the clean series title side
  // and extract any leading/trailing translation team credits into fansubs[]!
  const applyChapterSplit = (text: string, matchIndex: number, matchLength: number): string => {
    const beforeRaw = text.slice(0, matchIndex);
    const afterRaw = text.slice(matchIndex + matchLength);
    const beforeClean = cleanSeriesNoise(
      stripUnbracketedFansubPrefix(stripUnbracketedFansubSuffix(beforeRaw, pushFansub), pushFansub)
    );
    const afterClean = cleanSeriesNoise(
      stripUnbracketedFansubPrefix(stripUnbracketedFansubSuffix(afterRaw, pushFansub), pushFansub)
    );

    const beforeIsUsableTitle =
      beforeClean.length >= 2 &&
      !/^\d+$/.test(beforeClean) &&
      !isKnownFansubToken(beforeClean) &&
      !/^(es|esp|en|eng|lat|tmo|hd|hq|raw|manhwa|manga|manhua|comic)$/i.test(beforeClean);

    if (beforeIsUsableTitle) {
      const afterTrim = cleanSpaces(
        afterRaw.replace(
          /\b(pdf|cbz|cbr|español|espanol|sub\s*esp|latino|completo|completa|finalizado|finalizada|final|fin|end|extras?|ep[ií]logos?|especiales?|hd|hq|by|por)\b/gi,
          ' '
        )
      );
      if (afterTrim.length >= 2 && afterTrim.length <= 52 && isKnownFansubToken(afterTrim)) {
        pushFansub(afterTrim);
      }
      return beforeClean;
    }

    // Leading chapter range (e.g. "1-10 Nombre Manhwa", "[Mango Scan] 1-10 Nombre")
    if (afterClean.length >= 2) {
      const beforeTrim = cleanSpaces(beforeRaw);
      if (beforeTrim.length >= 2 && isKnownFansubToken(beforeTrim)) {
        pushFansub(beforeTrim);
      }
      return afterClean;
    }

    return beforeClean || afterClean;
  };

  // 2A. Explicit chapter range ANYWHERE (prefer last match if multiple):
  // "Cap 1-30", "Caps. 01 al 30", "Capítulos 1 a 30", "del 1 al 30", "Ch 1-10", "c01-c10", "#1-30"
  const explicitRangeRe =
    /(?:^|[\s\-–—:|(\[])(?:(?:del\s+)?(?:cap(?:[ií]tulos?|s)?|ch(?:ap(?:ters?)?)?|episodios?|ep|c)\.?\s*#?|del\s+#?|#)\s*(\d{1,4}(?:\.\d+)?)(?:\s*(?:[-–—~])\s*|\s+(?:al|a|hasta|to)\s+)(?:cap\.?|ch\.?|c)?\s*#?\s*(\d{1,4}(?:\.\d+)?)(?=$|[\s\-–—:|)\],.])/gi;
  let lastExpMatch: RegExpExecArray | null = null;
  for (const m of stripped.matchAll(explicitRangeRe)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 1000) {
      lastExpMatch = m;
    }
  }
  if (lastExpMatch && lastExpMatch.index !== undefined) {
    chapterStart = Number(lastExpMatch[1]);
    chapterEnd = Number(lastExpMatch[2]);
    hasChapterPattern = true;
    isExplicitPattern = true;
    stripped = applyChapterSplit(stripped, lastExpMatch.index, lastExpMatch[0].length);
  }

  // 2B. Bare numeric range ANYWHERE (prefer LAST valid non-year match so titles like "De 0 a 100 ... 1-10" match 1-10!):
  // "Nombre 1-30", "Nombre 1-10 Olympus Scan", "1-30 Nombre", "Nombre 01 al 30", "Nombre 1 a 30"
  if (!hasChapterPattern) {
    const bareRangeRe =
      /(?:^|[\s\-–—:|(\[])(\d{1,4}(?:\.\d+)?)(?:\s*(?:[-–—~])\s*|\s+(?:al|a|hasta|to)\s+)(\d{1,4}(?:\.\d+)?)(?=$|[\s\-–—:|)\],.])/gi;
    let lastBareMatch: RegExpExecArray | null = null;
    for (const m of stripped.matchAll(bareRangeRe)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const looksLikeYears = isYearNumber(a) && isYearNumber(b);
      if (!looksLikeYears && Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 1000) {
        lastBareMatch = m;
      }
    }
    if (lastBareMatch && lastBareMatch.index !== undefined) {
      chapterStart = Number(lastBareMatch[1]);
      chapterEnd = Number(lastBareMatch[2]);
      hasChapterPattern = true;
      isExplicitPattern = true;
      stripped = applyChapterSplit(stripped, lastBareMatch.index, lastBareMatch[0].length);
    }
  }

  // 2C. Explicit single chapter ANYWHERE (prefer last match):
  // "Cap 31", "Cap 31 Meian Scans", "Capítulo 05.5", "Ch. 104", "Episodio 12", "#023", "c015"
  if (!hasChapterPattern) {
    const singleCapRe =
      /(?:^|[\s\-–—:|(\[])(?:(?:cap(?:[ií]tulo)?|ch(?:ap(?:ter)?)?|episodio|ep)\.?\s*#?|#|c(?=\d{1,4}(?:\.\d+)?(?:$|[\s\-–—:|)\],.])))\s*(\d{1,4}(?:\.\d+)?)(?=$|[\s\-–—:|)\],.])/gi;
    let lastSingle: RegExpExecArray | null = null;
    for (const m of stripped.matchAll(singleCapRe)) {
      const a = Number(m[1]);
      if (Number.isFinite(a) && !isYearNumber(a)) {
        lastSingle = m;
      }
    }
    if (lastSingle && lastSingle.index !== undefined) {
      const a = Number(lastSingle[1]);
      chapterStart = a;
      chapterEnd = a;
      hasChapterPattern = true;
      isExplicitPattern = true;
      stripped = applyChapterSplit(stripped, lastSingle.index, lastSingle[0].length);
    }
  }

  // 2D. Volume / Tomo / Parte / Pack: "Tomo 1", "Vol. 02", "Parte 3"
  if (!hasChapterPattern) {
    const volRe =
      /(?:^|[\s\-–—:|(\[])(?:tomo|vol(?:umen)?|parte|pack|paquete|bloque)\.?\s*#?\s*(\d{1,3})(?:\s*(?:[-–—]|al?)\s*(\d{1,3}))?(?=$|[\s\-–—:|)\],.])/gi;
    let lastVol: RegExpExecArray | null = null;
    for (const m of stripped.matchAll(volRe)) {
      const a = Number(m[1]);
      if (Number.isFinite(a)) lastVol = m;
    }
    if (lastVol && lastVol.index !== undefined) {
      const a = Number(lastVol[1]);
      const b = lastVol[2] ? Number(lastVol[2]) : a;
      chapterStart = a;
      chapterEnd = Number.isFinite(b) && b >= a ? b : a;
      hasChapterPattern = true;
      isExplicitPattern = true;
      stripped = applyChapterSplit(stripped, lastVol.index, lastVol[0].length);
    }
  }

  // 2E. Purely numeric filename inside a series folder: e.g. folder="Mi Manhwa", file="01.pdf" or "1-30.pdf"
  if (!hasChapterPattern) {
    const onlyNumRe = /^\s*(\d{1,4}(?:\.\d+)?)(?:\s*(?:[-–—~]|al?)\s*(\d{1,4}(?:\.\d+)?))?\s*$/i;
    const mOnly = cleanSpaces(working).match(onlyNumRe);
    if (mOnly) {
      const a = Number(mOnly[1]);
      const b = mOnly[2] ? Number(mOnly[2]) : a;
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a && !isYearNumber(a)) {
        chapterStart = a;
        chapterEnd = b;
        hasChapterPattern = true;
        isExplicitPattern = Boolean(mOnly[2]) || Boolean(extractFolderSeriesName(folderPath));
        stripped = '';
      }
    }
  }

  // 2F. Trailing bare chapter number on visual series: e.g. "Equilibrio Térmico 01", "Solo Leveling - 042"
  if (!hasChapterPattern && allowBareTrailingSingle) {
    const withoutTeam = stripUnbracketedFansubPrefix(stripUnbracketedFansubSuffix(stripped, pushFansub), pushFansub);
    const trailingSingleRe = /([\s\-–—:|]+)(\d{1,4}(?:\.\d+)?)\s*$/;
    const mTrail = cleanSpaces(withoutTeam).match(trailingSingleRe);
    if (mTrail) {
      const a = Number(mTrail[2]);
      const prefix = cleanSeriesNoise(
        cleanSpaces(withoutTeam).slice(0, cleanSpaces(withoutTeam).length - mTrail[0].length)
      );
      if (Number.isFinite(a) && !isYearNumber(a) && prefix.length >= 3) {
        chapterStart = a;
        chapterEnd = a;
        hasChapterPattern = true;
        isExplicitPattern = false;
        stripped = prefix;
      }
    }
  }

  let seriesName = cleanSeriesNoise(
    stripUnbracketedFansubPrefix(stripUnbracketedFansubSuffix(stripped, pushFansub), pushFansub)
  );
  if (!seriesName || seriesName.length < 2 || /^\d+$/.test(seriesName)) {
    const fromFolder = extractFolderSeriesName(folderPath);
    if (fromFolder) {
      seriesName = fromFolder;
    } else {
      seriesName = cleanSeriesNoise(source) || cleanSpaces(source) || 'Serie sin título';
    }
  }

  // Dual titles separated by "/" (e.g. "Equilibrio Térmico / Heat Balance" or
  // "Me Convertí En La Rival Del Héroe / Me convertí en la rival de los protagonistas masculinos"):
  // keep the primary Spanish title as canonical seriesKey and register ALL halves in altKeys so packs
  // using either title automatically unify!
  const slashParts = seriesName
    .split(/\s+\/\s+/)
    .map((p) => cleanSpaces(p))
    .filter((p) => p.length >= 3);
  const altKeys = new Set<string>(altTitleCandidates);
  if (slashParts.length >= 2) {
    for (const part of slashParts) {
      const k = normalizeSeriesKey(part);
      if (k.length >= 3) altKeys.add(k);
    }
    const fullKey = normalizeSeriesKey(seriesName);
    if (fullKey.length >= 3) altKeys.add(fullKey);
    // Use first (Spanish) title as the primary key so "Equilibrio Térmico / Heat Balance" & "Equilibrio Térmico" share key!
    seriesName = slashParts[0];
  }

  const seriesKey = normalizeSeriesKey(seriesName);
  altKeys.delete(seriesKey);
  const originTag = detectOriginTag(combinedForMeta, kind);
  const seriesOrder = chapterStart ?? 0;
  const chapterLabel = buildChapterLabel(chapterStart, chapterEnd, cleanSpaces(source), isExtra);

  return {
    seriesName,
    seriesKey,
    altKeys: altKeys.size > 0 ? Array.from(altKeys) : undefined,
    chapterStart,
    chapterEnd,
    seriesOrder,
    chapterLabel,
    fansubs,
    originTag,
    hasChapterPattern,
    isExplicitPattern,
    isExtra,
  };
}

/**
 * Extracts clean series name, chapter range (e.g., 0-10, 1-30, 11-21, Cap 31, Tomo 1),
 * fansub credits, and origin type from a Manga/Manhwa/Comic filename, title, and folder.
 * Evaluates BOTH filename and title so embedded PDF garbage titles never break grouping.
 */
export function parseChapterPackInfo(
  rawTitle: string,
  fileName = '',
  folderPath = '',
  kind: ContentKind = 'manhwa'
): ParsedChapterPack {
  const baseFile = stripExt(fileName);
  const allowBare = isVisualSeriesKind(kind);

  const fromFile = baseFile ? parseSingleSource(baseFile, folderPath, kind, allowBare) : null;
  const fromTitle =
    rawTitle && rawTitle.trim().length > 1
      ? parseSingleSource(rawTitle, folderPath, kind, allowBare)
      : null;

  if (!fromFile && !fromTitle) {
    return parseSingleSource('', folderPath, kind, allowBare);
  }
  if (!fromFile) return fromTitle!;
  if (!fromTitle) return fromFile;

  // FILENAME-FIRST RULE:
  // Spanish Manhwa/Manga PDFs consistently keep the real Spanish name in `fileName`,
  // whereas embedded PDF `/Title` metadata (stored in `rawTitle`) is frequently English,
  // Korean, converter garbage ("merged", "CamScanner"), or a fansub name!
  // Only fall back to `rawTitle` when `fileName` has no real title letters (e.g. "01-10.pdf" or "2_531234567890.pdf").
  const fileHasRealLetters =
    /[a-zA-ZáéíóúñÁÉÍÓÚÑ]{2,}/.test(baseFile.replace(/\b(pdf|cbz|cbr|cap|caps|ch|vol|tomo|parte|final|fin)\b/gi, '')) &&
    !/^\d+_\d{6,}$/.test(baseFile.trim());

  let chosen: ParsedChapterPack;
  if (fileHasRealLetters) {
    chosen = fromFile;
    // If filename lacked a chapter number but title had an explicit one, borrow only the chapter range
    if (!fromFile.hasChapterPattern && fromTitle.hasChapterPattern) {
      chosen = {
        ...fromFile,
        chapterStart: fromTitle.chapterStart,
        chapterEnd: fromTitle.chapterEnd,
        seriesOrder: fromTitle.seriesOrder,
        chapterLabel: fromTitle.chapterLabel,
        hasChapterPattern: true,
        isExplicitPattern: fromTitle.isExplicitPattern,
        isExtra: fromFile.isExtra || fromTitle.isExtra,
      };
    }
  } else if (fromTitle.seriesKey && /[a-z]{2,}/.test(fromTitle.seriesKey)) {
    chosen = fromTitle;
    if (!fromTitle.hasChapterPattern && fromFile.hasChapterPattern) {
      chosen = {
        ...fromTitle,
        chapterStart: fromFile.chapterStart,
        chapterEnd: fromFile.chapterEnd,
        seriesOrder: fromFile.seriesOrder,
        chapterLabel: fromFile.chapterLabel,
        hasChapterPattern: true,
        isExplicitPattern: fromFile.isExplicitPattern,
        isExtra: fromFile.isExtra || fromTitle.isExtra,
      };
    }
  } else {
    chosen = fromFile;
  }

  // Merge fansubs, altKeys & origin hints from both sources
  const mergedFansubs = Array.from(
    new Map(
      [...fromFile.fansubs, ...fromTitle.fansubs].map((f) => [f.toLowerCase(), f])
    ).values()
  );
  const mergedAltKeys = Array.from(
    new Set([...(fromFile.altKeys || []), ...(fromTitle.altKeys || [])])
  ).filter((k) => k && k !== chosen.seriesKey);

  return {
    ...chosen,
    altKeys: mergedAltKeys.length > 0 ? mergedAltKeys : undefined,
    fansubs: mergedFansubs,
    originTag: detectOriginTag(`${folderPath} ${baseFile} ${rawTitle}`, kind),
  };
}

function parseTelegramGenreList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Support "#Romance #Drama #Acción" (space-separated hashtags) OR "Drama • Fantasía" OR "Acción, Comedia"
  const parts =
    /#\S+\s+#\S+/.test(trimmed) && !/[,/|·•]/.test(trimmed)
      ? trimmed.split(/\s+/)
      : trimmed.split(/[,/|·•]+/);
  return parts
    .map((g) => g.replace(/#/g, '').replace(/\*/g, '').replace(/_/g, ' ').trim())
    .filter((g) => g.length >= 2 && g.length <= 36);
}

function parseTelegramChapterTotal(raw: string): number | undefined {
  // Handle "(93/93)+(12/12)" -> 93 + 12 = 105, "(114/114)" -> 114, "05/05" -> 5, "(100)" -> 100, "210" -> 210
  const pairs = Array.from(raw.matchAll(/(\d{1,5})\s*\/\s*(\d{1,5})/g));
  if (pairs.length > 0) {
    let sum = 0;
    for (const p of pairs) {
      const a = Number(p[1]);
      const b = Number(p[2]);
      const best = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0);
      sum += best;
    }
    return sum > 0 ? sum : undefined;
  }
  const numMatch = raw.match(/(\d{1,5})/);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Parses pasted Telegram/channel manga/manhwa info cards across all popular channel templates:
 * - `🎴𒆜𝐍𝐨𝐦𝐛𝐫𝐞: ...`, `⌗│⛩⤿ 𝙉𝙤𝙢𝙗𝙧𝙚 ➳ ...`, `🈴▹Nombre: ...`, `🌀▹Manhwa: ...`
 * - Markdown `*Title*` header lines, `*Género:*`, `𝗦𝗜𝗣𝗡𝗢𝗦𝗜𝗦:`, multi-line genres, `(93/93)+(12/12)`.
 */
export function parseTelegramSeriesCard(raw: string): ParsedTelegramSeriesCard {
  const result: ParsedTelegramSeriesCard = {};
  if (!raw || !raw.trim()) return result;

  const normalized = raw.normalize('NFKD').normalize('NFC').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let collectingSynopsis = false;
  let collectingGenres = false;
  const synopsisLines: string[] = [];
  const genreAcc = new Set<string>();
  const addGenres = (list: string[]) => {
    for (const g of list) {
      if (g) genreAcc.add(g);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (collectingSynopsis && synopsisLines.length > 0) synopsisLines.push('');
      collectingGenres = false;
      continue;
    }

    // Ignore pure decorative separator lines (e.g. "*･ﾟﾟ･:.｡..｡.:ﾟ::✼✿*")
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(line)) {
      continue;
    }
    // Ignore standalone hashtag title echoes like "#Me_Convertí_En_La_Rival_Del_Héroe"
    if (/^#[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]+$/.test(line) && line.includes('_')) {
      continue;
    }

    // Strip decorative symbols/emojis/markdown asterisks before field label
    const cleanField = line.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9#]+/, '').replace(/^\*+|\*+$/g, '').trim();
    // Match "Key : Value", "Key ➳ Value", "*Key:* Value", or standalone "Sinopsis" / "Sipnosis"
    const m = cleanField.match(
      /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s()]{2,24}?)\s*\*?\s*(?:[:：➳→➜➤»›]\s*\*?\s*(.*)|$)/
    );

    let matchedKey = '';
    let matchedVal = '';
    if (m) {
      const candidateKey = m[1]
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[()*]/g, '')
        .toLowerCase()
        .trim();
      const hasSeparator = /[:：➳→➜➤»›]/.test(cleanField);
      const isKnownFieldKey =
        /^(nombre|titulo|serie|manhwa|manga|manhua|comic|tipo|formato|autor|autora|autor a|artista|genero|generos|etiquetas|fansub|fansubs|scan|scans|traduccion|estado|status|capitulo|capitulos|caps|sinopsis|sipnosis|descripcion|resumen)$/.test(
          candidateKey
        );
      if (isKnownFieldKey && (hasSeparator || /^(sinopsis|sipnosis|descripcion|resumen)$/.test(candidateKey))) {
        matchedKey = candidateKey;
        matchedVal = (m[2] || '').replace(/^\*+|\*+$/g, '').trim();
      }
    }

    if (matchedKey) {
      collectingGenres = false;

      if (matchedKey === 'sinopsis' || matchedKey === 'sipnosis' || matchedKey === 'descripcion' || matchedKey === 'resumen') {
        collectingSynopsis = true;
        // Strip decorative sparkles trailing on the "SIPNOSIS: *:･ﾟ✵" header line
        const cleanedStart = matchedVal.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9"¿¡']+/, '').trim();
        if (cleanedStart && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/.test(cleanedStart)) {
          synopsisLines.push(cleanedStart);
        }
        continue;
      }

      collectingSynopsis = false;

      if (matchedKey === 'nombre' || matchedKey === 'titulo' || matchedKey === 'serie') {
        if (valClean(matchedVal)) result.seriesName = valClean(matchedVal);
      } else if (matchedKey === 'manhwa' || matchedKey === 'manga' || matchedKey === 'manhua' || matchedKey === 'comic') {
        if (valClean(matchedVal)) result.seriesName = valClean(matchedVal);
        result.originTag = matchedKey as OriginTag;
        result.kind = matchedKey === 'comic' ? 'comic' : matchedKey === 'manga' ? 'manga' : 'manhwa';
      } else if (matchedKey === 'autor' || matchedKey === 'autora' || matchedKey === 'autor a' || matchedKey === 'artista') {
        if (matchedVal && !result.author) result.author = cleanSpaces(matchedVal);
      } else if (matchedKey === 'tipo') {
        const low = matchedVal.toLowerCase();
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
      } else if (matchedKey === 'genero' || matchedKey === 'generos' || matchedKey === 'etiquetas') {
        addGenres(parseTelegramGenreList(matchedVal));
        collectingGenres = true;
      } else if (matchedKey === 'fansub' || matchedKey === 'fansubs' || matchedKey === 'scan' || matchedKey === 'scans' || matchedKey === 'traduccion') {
        const parsedFansubs = matchedVal
          .split(/[,/|·•]+/)
          .map((f) => f.replace(/#/g, '').trim())
          .filter((f) => f.length >= 2 && f.length <= 48);
        if (parsedFansubs.length) result.fansubs = Array.from(new Set(parsedFansubs));
      } else if (matchedKey === 'estado' || matchedKey === 'status') {
        const low = matchedVal.toLowerCase();
        if (/finaliz|complet|terminad/.test(low)) result.seriesStatus = 'completed';
        else if (/pausa|hiatus/.test(low)) result.seriesStatus = 'hiatus';
        else if (/cancel|drop|abandon/.test(low)) result.seriesStatus = 'cancelled';
        else if (/emisi|curso|ongoing|activ/.test(low)) result.seriesStatus = 'ongoing';
        // Also extract chapter count embedded in Estado line like "Finalizado (98/98)"
        if (!result.totalChaptersExpected) {
          const embeddedCaps = parseTelegramChapterTotal(matchedVal);
          if (embeddedCaps) result.totalChaptersExpected = embeddedCaps;
        }
      } else if (matchedKey === 'capitulo' || matchedKey === 'capitulos' || matchedKey === 'caps') {
        const parsedTotal = parseTelegramChapterTotal(matchedVal);
        if (parsedTotal) result.totalChaptersExpected = parsedTotal;
      }
    } else if (collectingSynopsis) {
      synopsisLines.push(line);
    } else if (collectingGenres) {
      addGenres(parseTelegramGenreList(line));
    } else if (!result.seriesName && !line.startsWith('#') && line.length >= 3 && line.length <= 140) {
      // Handle standalone header title line like "*Equilibrio Térmico / Heat Balance*"
      const headerTitle = cleanSpaces(line.replace(/^\*+|\*+$/g, ''));
      if (headerTitle.length >= 3) {
        result.seriesName = headerTitle;
      }
    }
  }

  if (genreAcc.size > 0) {
    result.genres = Array.from(genreAcc);
  }
  if (synopsisLines.length > 0) {
    result.synopsis = synopsisLines.join('\n').trim();
  }

  return result;
}

function valClean(raw: string): string {
  return cleanSpaces(raw.replace(/^\*+|\*+$/g, ''));
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

function isVisualCandidateFormat(format: BookFormat): boolean {
  return format === 'pdf' || format === 'cbz' || format === 'cbr' || format === 'images';
}

const KEY_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'al', 'a', 'y', 'e', 'en', 'con', 'por', 'para',
  'the', 'of', 'and', 'in', 'to', 'for', 'a', 'an',
]);

function significantTokens(seriesKey: string): string[] {
  return seriesKey
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !KEY_STOPWORDS.has(t));
}

/**
 * Checks whether two normalized series keys clearly refer to the same Manga/Manhwa/Comic
 * (e.g. "el mejor ingeniero del mundo" vs "el mejor ingeniero del mundo final" or minor suffix/typo).
 */
export function areSeriesKeysCompatible(
  keyA: string,
  keyB: string,
  folderA = '',
  folderB = ''
): boolean {
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  // Same non-generic folder path is a strong signal for split chapter packs
  const fA = normalizeSeriesKey(extractFolderSeriesName(folderA));
  const fB = normalizeSeriesKey(extractFolderSeriesName(folderB));
  if (fA && fB && fA === fB && fA.length >= 4) return true;

  // Prefix match when shorter key is specific (>= 6 chars) and extra suffix is small (<= 4 words)
  const shorter = keyA.length <= keyB.length ? keyA : keyB;
  const longer = keyA.length <= keyB.length ? keyB : keyA;
  if (shorter.length >= 6 && longer.startsWith(`${shorter} `)) {
    const tailWords = longer.slice(shorter.length).trim().split(/\s+/).filter(Boolean);
    if (tailWords.length <= 4) return true;
  }

  // High significant-word overlap (handles missing article or extra trailing word like "200-210 nuevo")
  const tokA = significantTokens(keyA);
  const tokB = significantTokens(keyB);
  if (tokA.length >= 2 && tokB.length >= 2) {
    const setB = new Set(tokB);
    let shared = 0;
    for (const t of tokA) {
      if (setB.has(t)) shared++;
    }
    const minLen = Math.min(tokA.length, tokB.length);
    const maxLen = Math.max(tokA.length, tokB.length);
    if (shared === minLen && maxLen - minLen <= 2) return true;
    if (minLen >= 3 && shared / maxLen >= 0.8) return true;
  }

  return false;
}

/**
 * Finds an existing Manga/Manhwa/Comic series in the library that a newly imported chapter pack
 * belongs to, so ongoing series automatically absorb newly released chapters with full metadata!
 */
export function findMatchingExistingSeries(
  existingBooks: BookItem[],
  candidate: ParsedChapterPack,
  candidateFolder = ''
): MangaSeriesGroup | null {
  if (!candidate.seriesKey) return null;
  const display = groupLibraryForDisplay(existingBooks);
  let bestMatch: MangaSeriesGroup | null = null;
  let bestScore = 0;

  for (const item of display) {
    if (item.type !== 'series') continue;
    const s = item.series;
    if (s.seriesKey === candidate.seriesKey) {
      return s;
    }
    const sFolder = s.primaryBook.folderPath || s.allBooks.find((b) => b.folderPath)?.folderPath || '';
    if (areSeriesKeysCompatible(s.seriesKey, candidate.seriesKey, sFolder, candidateFolder)) {
      const score = s.chapters.length * 10 + (s.synopsis ? 5 : 0) + (s.genres.length > 0 ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = s;
      }
    }
  }
  return bestMatch;
}

const groupDisplayCache = new WeakMap<BookItem[], ShelfDisplayItem[]>();

/**
 * Groups Manga / Manhwa / Comic chapter-pack files into unified series entries
 * (sorted, deduplicated, with available chapter stats and missing-gap detection),
 * while leaving standard Books & Audiobooks 100% untouched.
 *
 * Uses a WeakMap cache + O(N) inverted token/folder index so even 500–2,000+ book libraries
 * group in <5 ms with zero UI lag or CPU spikes!
 */
export function groupLibraryForDisplay(books: BookItem[]): ShelfDisplayItem[] {
  const cached = groupDisplayCache.get(books);
  if (cached) return cached;

  const folderKeyMemo = new Map<string, string>();
  const getFolderKey = (folderPath: string): string => {
    if (!folderPath) return '';
    let fk = folderKeyMemo.get(folderPath);
    if (fk === undefined) {
      fk = normalizeSeriesKey(extractFolderSeriesName(folderPath));
      folderKeyMemo.set(folderPath, fk);
    }
    return fk;
  };

  const addToIndex = (index: Map<string, Set<string>>, key: string, folderKey: string) => {
    for (const tok of significantTokens(key)) {
      let bucket = index.get(`t:${tok}`);
      if (!bucket) {
        bucket = new Set<string>();
        index.set(`t:${tok}`, bucket);
      }
      bucket.add(key);
    }
    if (folderKey.length >= 4) {
      let bucket = index.get(`f:${folderKey}`);
      if (!bucket) {
        bucket = new Set<string>();
        index.set(`f:${folderKey}`, bucket);
      }
      bucket.add(key);
    }
  };

  const getIndexCandidates = (
    index: Map<string, Set<string>>,
    key: string,
    folderKey: string
  ): Set<string> => {
    const out = new Set<string>();
    for (const tok of significantTokens(key)) {
      const bucket = index.get(`t:${tok}`);
      if (bucket) {
        for (const cand of bucket) out.add(cand);
      }
    }
    if (folderKey.length >= 4) {
      const bucket = index.get(`f:${folderKey}`);
      if (bucket) {
        for (const cand of bucket) out.add(cand);
      }
    }
    return out;
  };

  const visualSeriesKeys = new Set<string>();
  const visualFolderByKey = new Map<string, string>();
  const visualIndex = new Map<string, Set<string>>();
  const pdfCandidateBuckets = new Map<string, Array<{ book: BookItem; parsed: ParsedChapterPack }>>();
  const parsedByBookId = new Map<string, ParsedChapterPack>();

  // Pass 1: NAME-FIRST parsing for visual items and ALL visual-format PDFs/CBZs/CBRs.
  // Always derive the Spanish series name from `b.fileName` (unless the user explicitly locked
  // `b.seriesNameLocked` via "Editar ficha" or "Unir capítulos"), so garbage embedded PDF `/Title`
  // or old synced metadata NEVER renames or splits a series!
  for (const b of books) {
    if (b.kind === 'audiobook' || b.format === 'audio') continue;

    if (isVisualSeriesKind(b.kind)) {
      const rawHint =
        /^\d+(\s*[-–—]\s*\d+)?$/.test(b.title.trim()) &&
        b.author &&
        !/^(autor desconocido|unknown|biblioteca personal)$/i.test(b.author.trim()) &&
        !isKnownFansubToken(b.author)
          ? `${b.author} ${b.title}`
          : b.title;
      const parsed = parseChapterPackInfo(rawHint, b.fileName, b.folderPath || '', b.kind);
      let effectiveSeriesName = parsed.seriesName;
      let mergedAltKeys = [...(parsed.altKeys || [])];

      if (b.seriesNameLocked && b.seriesName?.trim()) {
        // User explicitly edited or manually merged this series -> honor their chosen name
        effectiveSeriesName = cleanSpaces(b.seriesName.trim());
        if (parsed.seriesKey && parsed.seriesKey !== normalizeSeriesKey(effectiveSeriesName)) {
          mergedAltKeys.push(parsed.seriesKey);
        }
      } else if (
        b.seriesName?.trim() &&
        (!b.fileName || /^\d+(_\d+)?(\s*[-–—]\s*\d+)?\.[^.]+$/i.test(b.fileName.trim()))
      ) {
        // Only fall back to unlocked stored seriesName when fileName itself has no letters (e.g. "01-10.pdf")
        const cleanedExplicit = parseSingleSource(b.seriesName.trim(), b.folderPath || '', b.kind, false);
        if (cleanedExplicit.seriesName && cleanedExplicit.seriesName.length >= 2) {
          effectiveSeriesName = cleanedExplicit.seriesName;
          if (cleanedExplicit.altKeys?.length) {
            mergedAltKeys = Array.from(new Set([...mergedAltKeys, ...cleanedExplicit.altKeys]));
          }
        }
      }

      const key = normalizeSeriesKey(effectiveSeriesName) || normalizeSeriesKey(b.title) || b.id;
      const finalAltKeys = Array.from(new Set(mergedAltKeys)).filter((k) => k && k !== key);

      const finalParsed: ParsedChapterPack = {
        ...parsed,
        seriesName: effectiveSeriesName,
        seriesKey: key,
        altKeys: finalAltKeys.length > 0 ? finalAltKeys : undefined,
        chapterStart: b.chapterStart ?? parsed.chapterStart,
        chapterEnd: b.chapterEnd ?? parsed.chapterEnd,
        seriesOrder: b.chapterStart ?? b.seriesOrder ?? parsed.seriesOrder,
        chapterLabel: buildChapterLabel(
          b.chapterStart ?? parsed.chapterStart,
          b.chapterEnd ?? parsed.chapterEnd,
          b.title,
          parsed.isExtra
        ),
        originTag: b.originTag || parsed.originTag,
      };
      parsedByBookId.set(b.id, finalParsed);
      visualSeriesKeys.add(key);
      if (b.folderPath && !visualFolderByKey.has(key)) visualFolderByKey.set(key, b.folderPath);
      addToIndex(visualIndex, key, getFolderKey(b.folderPath || ''));
    } else if (isVisualCandidateFormat(b.format)) {
      // Group ANY 2+ PDF/CBZ/CBR/image files that share the exact same clean Spanish name
      // (even if they were imported as kind='book' or lack explicit chapter keywords!)
      const rawHint =
        /^\d+(\s*[-–—]\s*\d+)?$/.test(b.title.trim()) &&
        b.author &&
        !/^(autor desconocido|unknown|biblioteca personal)$/i.test(b.author.trim()) &&
        !isKnownFansubToken(b.author)
          ? `${b.author} ${b.title}`
          : b.title;
      const parsed = parseChapterPackInfo(rawHint, b.fileName, b.folderPath || '', 'manhwa');
      const effectiveKey =
        b.seriesNameLocked && b.seriesName?.trim()
          ? normalizeSeriesKey(b.seriesName.trim())
          : parsed.seriesKey;
      const effectiveName =
        b.seriesNameLocked && b.seriesName?.trim()
          ? cleanSpaces(b.seriesName.trim())
          : parsed.seriesName;
      if (effectiveKey && effectiveKey.length >= 2) {
        const arr = pdfCandidateBuckets.get(effectiveKey) || [];
        arr.push({
          book: b,
          parsed: {
            ...parsed,
            seriesName: effectiveName,
            seriesKey: effectiveKey,
          },
        });
        pdfCandidateBuckets.set(effectiveKey, arr);
      }
    }
  }

  // Promote candidate PDF/CBZ/CBR buckets using O(N) inverted token/folder index!
  const pdfBucketKeys = Array.from(pdfCandidateBuckets.keys());
  const pdfIndex = new Map<string, Set<string>>();
  const pdfFolderByKey = new Map<string, string>();
  for (const key of pdfBucketKeys) {
    const list = pdfCandidateBuckets.get(key)!;
    const f = list.find((x) => x.book.folderPath)?.book.folderPath || '';
    pdfFolderByKey.set(key, f);
    addToIndex(pdfIndex, key, getFolderKey(f));
  }

  for (const key of pdfBucketKeys) {
    const list = pdfCandidateBuckets.get(key)!;
    const sampleFolder = pdfFolderByKey.get(key) || '';
    const sampleFolderKey = getFolderKey(sampleFolder);
    const listAlts = new Set<string>();
    for (const x of list) {
      for (const a of x.parsed.altKeys || []) listAlts.add(a);
    }
    let matchedVisualKey: string | null = visualSeriesKeys.has(key) ? key : null;
    if (!matchedVisualKey) {
      for (const alt of listAlts) {
        if (visualSeriesKeys.has(alt)) {
          matchedVisualKey = alt;
          break;
        }
      }
    }
    if (!matchedVisualKey) {
      const candidates = getIndexCandidates(visualIndex, key, sampleFolderKey);
      for (const vk of candidates) {
        if (areSeriesKeysCompatible(vk, key, visualFolderByKey.get(vk) || '', sampleFolder)) {
          matchedVisualKey = vk;
          break;
        }
      }
    }
    // Check if another PDF candidate bucket sharing a token/folder has a compatible name
    let matchedOtherPdfKey: string | null = null;
    if (!matchedVisualKey && list.length === 1) {
      const otherCandidates = getIndexCandidates(pdfIndex, key, sampleFolderKey);
      for (const otherKey of otherCandidates) {
        if (otherKey === key) continue;
        const otherList = pdfCandidateBuckets.get(otherKey)!;
        const otherFolder = pdfFolderByKey.get(otherKey) || '';
        const otherHasCaps = otherList.some((x) => x.parsed.hasChapterPattern) || list[0].parsed.hasChapterPattern;
        if (otherHasCaps && areSeriesKeysCompatible(otherKey, key, otherFolder, sampleFolder)) {
          matchedOtherPdfKey = otherKey.length <= key.length ? otherKey : key;
          break;
        }
      }
    }
    const hasMultiPacks = list.length >= 2;
    const hasSingleExplicitRange =
      list.length === 1 &&
      (Boolean(list[0].book.seriesNameLocked) ||
        (list[0].parsed.isExplicitPattern &&
          list[0].parsed.chapterStart !== undefined &&
          list[0].parsed.chapterEnd !== undefined &&
          list[0].parsed.chapterEnd > list[0].parsed.chapterStart));

    if (matchedVisualKey || matchedOtherPdfKey || hasMultiPacks || hasSingleExplicitRange) {
      const targetKey = matchedVisualKey || matchedOtherPdfKey || key;
      visualSeriesKeys.add(targetKey);
      if (sampleFolder && !visualFolderByKey.has(targetKey)) visualFolderByKey.set(targetKey, sampleFolder);
      addToIndex(visualIndex, targetKey, sampleFolderKey);
      for (const item of list) {
        parsedByBookId.set(item.book.id, { ...item.parsed, seriesKey: targetKey });
      }
    }
  }

  // Pass 2: build raw series buckets, then unify compatible keys using O(N) inverted index
  const rawBuckets = new Map<string, Array<{ book: BookItem; parsed: ParsedChapterPack }>>();
  for (const b of books) {
    const parsed = parsedByBookId.get(b.id);
    if (!parsed) continue;
    const key = parsed.seriesKey || b.id;
    const arr = rawBuckets.get(key) || [];
    arr.push({ book: b, parsed });
    rawBuckets.set(key, arr);
  }

  // Sort bucket keys so larger / cleaner base series keys become canonical targets first
  const bucketKeys = Array.from(rawBuckets.keys()).sort((ka, kb) => {
    const lenDiff = (rawBuckets.get(kb)?.length || 0) - (rawBuckets.get(ka)?.length || 0);
    if (lenDiff !== 0) return lenDiff;
    return ka.length - kb.length;
  });

  const canonicalKeyMap = new Map<string, string>();
  const canonicalFolder = new Map<string, string>();
  const canonicalHasCaps = new Map<string, boolean>();
  const canonicalAltToMain = new Map<string, string>();
  const canonicalIndex = new Map<string, Set<string>>();

  const collectBucketAltKeys = (list: Array<{ book: BookItem; parsed: ParsedChapterPack }>): string[] => {
    const out = new Set<string>();
    for (const x of list) {
      for (const ak of x.parsed.altKeys || []) out.add(ak);
    }
    return Array.from(out);
  };

  for (const key of bucketKeys) {
    const list = rawBuckets.get(key)!;
    const folder = list.find((x) => x.book.folderPath)?.book.folderPath || '';
    const folderKey = getFolderKey(folder);
    const listAlts = collectBucketAltKeys(list);
    let target: string | null = null;

    // 1. O(1) altKey match ("Equilibrio Térmico / Heat Balance" <-> "Heat Balance")
    if (canonicalAltToMain.has(key)) {
      target = canonicalAltToMain.get(key)!;
    } else {
      for (const alt of listAlts) {
        if (canonicalKeyMap.has(alt)) {
          target = canonicalKeyMap.get(alt)!;
          break;
        }
        if (canonicalAltToMain.has(alt)) {
          target = canonicalAltToMain.get(alt)!;
          break;
        }
      }
    }

    // 2. O(1)-amortized token/folder index fuzzy match when chapter patterns exist
    const listHasCaps = list.some((x) => x.parsed.hasChapterPattern || x.parsed.chapterStart !== undefined);
    if (!target && listHasCaps) {
      const candidates = getIndexCandidates(canonicalIndex, key, folderKey);
      for (const ck of candidates) {
        if (!canonicalHasCaps.get(ck)) continue;
        if (areSeriesKeysCompatible(ck, key, canonicalFolder.get(ck) || '', folder)) {
          target = ck;
          break;
        }
      }
    }

    if (target) {
      canonicalKeyMap.set(key, target);
      for (const a of listAlts) canonicalAltToMain.set(a, target);
    } else {
      canonicalKeyMap.set(key, key);
      canonicalHasCaps.set(key, listHasCaps);
      if (folder) canonicalFolder.set(key, folder);
      addToIndex(canonicalIndex, key, folderKey);
      for (const a of listAlts) canonicalAltToMain.set(a, key);
    }
  }

  const seriesBuckets = new Map<string, Array<{ book: BookItem; parsed: ParsedChapterPack }>>();
  for (const b of books) {
    const parsed = parsedByBookId.get(b.id);
    if (!parsed) continue;
    const canonKey = canonicalKeyMap.get(parsed.seriesKey || b.id) || parsed.seriesKey || b.id;
    const mergedParsed = canonKey === parsed.seriesKey ? parsed : { ...parsed, seriesKey: canonKey };
    parsedByBookId.set(b.id, mergedParsed);
    const arr = seriesBuckets.get(canonKey) || [];
    arr.push({ book: b, parsed: mergedParsed });
    seriesBuckets.set(canonKey, arr);
  }

  // Pass 3: emit ShelfDisplayItem preserving input sort order
  const emittedSeries = new Set<string>();
  const displayItems: ShelfDisplayItem[] = [];

  for (const book of books) {
    const parsed = parsedByBookId.get(book.id);
    if (!parsed) {
      displayItems.push({ type: 'book', book });
      continue;
    }

    const key = parsed.seriesKey || book.id;
    if (emittedSeries.has(key)) continue;
    emittedSeries.add(key);

    const bucket = seriesBuckets.get(key);
    if (!bucket || bucket.length === 0) {
      displayItems.push({ type: 'book', book });
      continue;
    }

    displayItems.push({ type: 'series', series: buildSeriesGroup(key, bucket) });
  }

  groupDisplayCache.set(books, displayItems);
  return displayItems;
}

function buildSeriesGroup(
  seriesKey: string,
  items: Array<{ book: BookItem; parsed: ParsedChapterPack }>
): MangaSeriesGroup {
  const sorted = [...items].sort((a, b) => {
    const aExtra = a.parsed.isExtra ? 1 : 0;
    const bExtra = b.parsed.isExtra ? 1 : 0;
    if (aExtra !== bExtra) return aExtra - bExtra;
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

  // Deduplicate exact same chapter range (keeping Extras separate so "Extras 1-12" never collides with "Caps 1-12"!)
  const dedupMap = new Map<string, SeriesChapterEntry>();
  const duplicateIds: string[] = [];

  for (const { book, parsed } of sorted) {
    const extraPrefix = parsed.isExtra ? 'extra::' : '';
    const rangeKey =
      parsed.chapterStart !== undefined
        ? `${extraPrefix}${parsed.chapterStart}::${parsed.chapterEnd ?? parsed.chapterStart}`
        : `${extraPrefix}single::${normalizeSeriesKey(book.fileName || book.title) || book.id}`;

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

  // Prefer shortest/cleanest base name from items matching the canonical key (so "200-210 FINAL" never becomes the series title!)
  const canonicalNameItem =
    sorted.find((x) => normalizeSeriesKey(x.parsed.seriesName) === seriesKey) || sorted[0];
  const seriesName = canonicalNameItem.parsed.seriesName || sorted[0].book.title;

  // Always take the FIRST displayed chapter's cover (Page 1 of Cap. 0/1) as series cover;
  // only fall back to the earliest subsequent chapter with a real cover if Chapter 1 has none yet.
  const firstChapterBook = chapters[0].book;
  const primaryBook = hasDisplayableOriginalCover(firstChapterBook)
    ? firstChapterBook
    : chapters.find((c) => hasDisplayableOriginalCover(c.book))?.book || firstChapterBook;

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
    // Also capture translation team stored in author field (when old import split fansub into author!)
    if (
      book.author &&
      /scan|fansub|trad|team|olympus|meian|ikigai|tmo|miau|monarca|asura|reaper/i.test(book.author)
    ) {
      const cleanTeam = book.author.trim();
      if (cleanTeam && !fansubSet.has(cleanTeam.toLowerCase())) {
        fansubSet.set(cleanTeam.toLowerCase(), cleanTeam);
      }
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

    let covered = 0;
    for (const [s, e] of merged) {
      covered += e - s + 1;
    }
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
    (originTag === 'comic' ? 'comic' : originTag === 'manga' ? 'manga' : 'manhwa')) as
    | 'manga'
    | 'manhwa'
    | 'comic';

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
  if (!activeBook) return null;
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
