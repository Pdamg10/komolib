import type { BookFormat, BookItem, ContentKind } from '../types/library';
import { extractCbrCoverAndCount, extractCbzCoverAndCount } from './comicParser';
import {
  blobToDataUrl,
  extractDominantColorFromDataUrl,
  generateCozyCover,
  naturalSortStrings,
} from './coverGenerator';
import { extractEpubMetaAndCover } from './epubParser';
import { extractPdfMetaAndCover } from './pdfParser';
import { parseFb2 } from './textParser';
import { parseMobiBlob } from './mobiParser';

export const ACCEPTED_EXTENSIONS =
  '.epub,.pdf,.cbz,.cbr,.zip,.rar,.txt,.md,.html,.htm,.fb2,.mobi,.azw,.azw3,.prc,.docx,.mp3,.m4b,.ogg,.wav,.jpg,.jpeg,.png,.webp,.avif';

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

  if (format === 'epub') {
    const meta = await extractEpubMetaAndCover(file);
    if (!overrides?.title && meta.title) title = meta.title;
    if (!overrides?.author && meta.author) author = meta.author;
    if (meta.description) description = meta.description;
    if (meta.coverDataUrl) coverDataUrl = meta.coverDataUrl;
  } else if (format === 'pdf') {
    const meta = await extractPdfMetaAndCover(file);
    if (!overrides?.title && meta.title) title = meta.title;
    if (!overrides?.author && meta.author) author = meta.author;
    if (meta.coverDataUrl) coverDataUrl = meta.coverDataUrl;
    pageCount = meta.pageCount;
  } else if (format === 'cbz') {
    const meta = await extractCbzCoverAndCount(file);
    if (meta.coverDataUrl) coverDataUrl = meta.coverDataUrl;
    pageCount = meta.pageCount;
  } else if (format === 'cbr') {
    const meta = await extractCbrCoverAndCount(file);
    if (meta.coverDataUrl) coverDataUrl = meta.coverDataUrl;
    pageCount = meta.pageCount;
  } else if (format === 'fb2') {
    const meta = await parseFb2(file);
    if (!overrides?.title && meta.title) title = meta.title;
    if (!overrides?.author && meta.author) author = meta.author;
    if (meta.description) description = meta.description;
    if (meta.coverDataUrl) coverDataUrl = meta.coverDataUrl;
  } else if (format === 'mobi' || format === 'azw3') {
    const meta = await parseMobiBlob(file, title);
    if (!overrides?.title && meta.title) title = meta.title;
  } else if (format === 'images') {
    coverDataUrl = await blobToDataUrl(file);
    pageCount = 1;
  }

  const generated = generateCozyCover(title, author, kind, format);
  const finalCover = coverDataUrl || generated.coverDataUrl;
  const spineColor = coverDataUrl
    ? await extractDominantColorFromDataUrl(coverDataUrl, generated.spineColor)
    : generated.spineColor;

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
    spineColor,
    ribbonColor: generated.ribbonColor,
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
  const firstCover = await blobToDataUrl(sorted[0]);
  const generated = generateCozyCover(title, author, kind, 'IMAGES');
  const spineColor = await extractDominantColorFromDataUrl(firstCover, generated.spineColor);

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
    spineColor,
    ribbonColor: generated.ribbonColor,
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
