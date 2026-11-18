import type { BookFormat, BookItem, ContentKind } from '../types/library';
import { extractAudioCover } from './audioCoverParser';
import { extractCbrCoverAndCount, extractCbzCoverAndCount } from './comicParser';
import {
  blobToDataUrl,
  extractCoverPaletteFromDataUrl,
  generateCozyCover,
  naturalSortStrings,
  optimizeCoverDataUrl,
} from './coverGenerator';
import { extractEpubMetaAndCover } from './epubParser';
import { extractPdfMetaAndCover } from './pdfParser';
import { extractDocxCover, extractHtmlEmbeddedCover, parseFb2 } from './textParser';
import { parseMobiBlob } from './mobiParser';

export const ACCEPTED_EXTENSIONS =
  '.epub,.pdf,.cbz,.cbr,.zip,.rar,.txt,.md,.html,.htm,.fb2,.mobi,.azw,.azw3,.prc,.docx,.mp3,.m4b,.m4a,.ogg,.wav,.jpg,.jpeg,.png,.webp,.avif';

export function detectFormat(fileName: string, mimeType = ''): BookFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.cbz') || lower.endsWith('.zip')) return 'cbz';
  if (lower.endsWith('.cbr') || lower.endsWith('.rar')) return 'cbr';
  if (lower.endsWith('.fb2')) return 'fb2';
  if (lower.endsWith('.mobi') || lower.endsWith('.prc') || lower.endsWith('.azw')) return 'mobi';
  if (lower.endsWith('.azw3')) return 'azw3';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.txt')) return 'txt';
  if (/\.(mp3|m4b|m4a|ogg|wav|flac)$/i.test(lower) || mimeType.startsWith('audio/')) return 'audio';
  if (/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(lower) || mimeType.startsWith('image/')) return 'images';
  return null;
}

function cleanFileTitle(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function guessContentKind(fileName: string, format: BookFormat): ContentKind {
  const lower = fileName.toLowerCase();
  if (format === 'audio') return 'audiobook';
  if (/manhwa|webtoon|solo\s*level|tower\s*of\s*god|omniscient|manhua/i.test(lower)) {
    return 'manhwa';
  }
  if (/manga|vol\.?\s*\d|tomo|ch\.?\s*\d|cap\.?\s*\d|shonen|seinen|shojo/i.test(lower)) {
    return 'manga';
  }
  if (format === 'cbz' || format === 'cbr' || format === 'images') {
    return 'manga';
  }
  return 'book';
}

export interface ImportedBookBundle {
  book: BookItem;
  blob: Blob;
  extraImages?: Blob[];
}

export async function extractOriginalCoverFromBlob(
  blob: Blob,
  format: BookFormat,
  fallbackTitle = 'Sin título',
  extraImages?: Blob[]
): Promise<{
  coverDataUrl?: string;
  title?: string;
  author?: string;
  description?: string;
  pageCount?: number;
}> {
  if (format === 'epub') {
    return extractEpubMetaAndCover(blob);
  }
  if (format === 'pdf') {
    return extractPdfMetaAndCover(blob);
  }
  if (format === 'cbz') {
    return extractCbzCoverAndCount(blob);
  }
  if (format === 'cbr') {
    return extractCbrCoverAndCount(blob);
  }
  if (format === 'fb2') {
    const meta = await parseFb2(blob);
    return {
      title: meta.title,
      author: meta.author,
      description: meta.description,
      coverDataUrl: meta.coverDataUrl,
    };
  }
  if (format === 'mobi' || format === 'azw3') {
    const meta = await parseMobiBlob(blob, fallbackTitle);
    return {
      title: meta.title,
      author: meta.author !== 'Biblioteca MOBI' && meta.author !== 'Desconocido' ? meta.author : undefined,
      coverDataUrl: meta.coverDataUrl,
    };
  }
  if (format === 'docx') {
    const coverDataUrl = await extractDocxCover(blob);
    return { coverDataUrl };
  }
  if (format === 'html') {
    const coverDataUrl = await extractHtmlEmbeddedCover(blob);
    return { coverDataUrl };
  }
  if (format === 'audio') {
    const coverDataUrl = await extractAudioCover(blob);
    return { coverDataUrl };
  }
  if (format === 'images') {
    const first = extraImages?.length ? extraImages[0] : blob;
    const raw = await blobToDataUrl(first);
    const coverDataUrl = await optimizeCoverDataUrl(raw);
    return { coverDataUrl, pageCount: extraImages?.length || 1 };
  }
  return {};
}

export async function importSingleFile(
  file: File,
  overrides?: {
    title?: string;
    author?: string;
    kind?: ContentKind;
    categories?: string[];
  }
): Promise<ImportedBookBundle> {
  const format = detectFormat(file.name, file.type) || 'txt';
  const kind = overrides?.kind || guessContentKind(file.name, format);

  let title = overrides?.title?.trim() || cleanFileTitle(file.name) || 'Sin título';
  let author = overrides?.author?.trim() || 'Biblioteca Personal';
  let description = '';
  let coverDataUrl: string | undefined;
  let pageCount: number | undefined;

  const extracted = await extractOriginalCoverFromBlob(file, format, title);
  if (!overrides?.title && extracted.title) title = extracted.title;
  if (!overrides?.author && extracted.author) author = extracted.author;
  if (extracted.description) description = extracted.description;
  if (extracted.coverDataUrl) coverDataUrl = extracted.coverDataUrl;
  if (extracted.pageCount !== undefined) pageCount = extracted.pageCount;

  const generated = generateCozyCover(title, author, kind, format);
  const hasOriginalCover = Boolean(coverDataUrl);
  const finalCover = coverDataUrl || generated.coverDataUrl;
  const palette = coverDataUrl
    ? await extractCoverPaletteFromDataUrl(coverDataUrl, generated.spineColor, generated.ribbonColor)
    : { spineColor: generated.spineColor, ribbonColor: generated.ribbonColor };

  const defaultCats = new Set<string>(overrides?.categories || []);
  defaultCats.add('new');
  if (kind === 'manga') defaultCats.add('manga');
  else if (kind === 'manhwa') defaultCats.add('manhwa');
  else if (kind === 'comic') defaultCats.add('comic');
  else if (kind === 'audiobook') defaultCats.add('audiobooks');
  else defaultCats.add('ebooks');

  const now = Date.now();
  const id = `book_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const book: BookItem = {
    id,
    title,
    author,
    description,
    format,
    kind,
    categories: Array.from(defaultCats),
    tags: [format.toUpperCase()],
    coverDataUrl: finalCover,
    hasOriginalCover,
    coverCheckedV2: true,
    spineColor: palette.spineColor,
    ribbonColor: palette.ribbonColor,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    pageCount,
    progress: 0,
    favorite: false,
    wishlist: false,
    hasLocalFile: true,
    addedAt: now,
    updatedAt: now,
  };

  return { book, blob: file };
}

export async function importImageBundle(
  files: File[],
  title: string,
  author: string,
  kind: ContentKind = 'manhwa',
  categories: string[] = []
): Promise<ImportedBookBundle> {
  const sorted = [...files].sort((a, b) => naturalSortStrings(a.name, b.name));
  const rawCover = await blobToDataUrl(sorted[0]);
  const firstCover = await optimizeCoverDataUrl(rawCover);
  const generated = generateCozyCover(title, author, kind, 'IMAGES');
  const palette = await extractCoverPaletteFromDataUrl(
    firstCover,
    generated.spineColor,
    generated.ribbonColor
  );

  const cats = new Set<string>(categories);
  cats.add('new');
  cats.add(kind === 'comic' ? 'comic' : kind === 'manga' ? 'manga' : 'manhwa');

  const now = Date.now();
  const id = `book_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const totalSize = sorted.reduce((acc, f) => acc + f.size, 0);

  const book: BookItem = {
    id,
    title: title.trim() || 'Volumen de Imágenes',
    author: author.trim() || 'Colección Propia',
    description: `Volumen creado con ${sorted.length} páginas de imagen.`,
    format: 'images',
    kind,
    categories: Array.from(cats),
    tags: ['IMÁGENES', `${sorted.length} PÁGS`],
    coverDataUrl: firstCover,
    hasOriginalCover: true,
    coverCheckedV2: true,
    spineColor: palette.spineColor,
    ribbonColor: palette.ribbonColor,
    fileName: `${title || 'volumen'}.images`,
    fileSize: totalSize,
    mimeType: 'application/x-komolib-images',
    pageCount: sorted.length,
    progress: 0,
    favorite: false,
    wishlist: false,
    hasLocalFile: true,
    addedAt: now,
    updatedAt: now,
  };

  return {
    book,
    blob: sorted[0],
    extraImages: sorted,
  };
}
