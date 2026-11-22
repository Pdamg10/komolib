import type { BookItem } from '../types/library';

/**
 * Returns true ONLY if the cover URL is a real raster image (JPEG, PNG, WebP, GIF, AVIF, BMP)
 * or an http(s)/blob URL — never empty, never the sync placeholder '__KEEP__', and never a
 * generated placeholder SVG (`data:image/svg+xml`).
 */
export function isRasterCoverDataUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '__KEEP__') return false;
  if (trimmed.startsWith('data:image/svg+xml')) return false;
  return (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('blob:')
  );
}

/**
 * Single source of truth across all UI components (BookCoverVisual, BookCard, BookDetailModal,
 * DashboardView, ReadingLogView) for whether a book should display its original raster cover.
 */
export function hasDisplayableOriginalCover(
  book?: Pick<BookItem, 'coverDataUrl' | 'hasOriginalCover'> | null
): boolean {
  if (!book) return false;
  if (book.hasOriginalCover === false) return false;
  return isRasterCoverDataUrl(book.coverDataUrl);
}

/**
 * Lightweight deterministic signature for a coverDataUrl so sync knows whether the exact
 * cover bytes have already been confirmed on the server.
 */
export function getCoverSignature(url?: string | null): string {
  if (!url || typeof url !== 'string' || url === '__KEEP__') return '';
  return `${url.length}:${url.slice(0, 48)}:${url.slice(-32)}`;
}
