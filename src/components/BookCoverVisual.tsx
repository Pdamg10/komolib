import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Headphones, Sparkles } from 'lucide-react';
import type { BookItem } from '../types/library';

interface BookCoverVisualProps {
  book: Pick<
    BookItem,
    'id' | 'title' | 'author' | 'format' | 'kind' | 'coverDataUrl' | 'hasOriginalCover'
  >;
  compact?: boolean;
}

export function getAdaptiveVariantIndex(seed: string): 0 | 1 | 2 {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 3) as 0 | 1 | 2;
}

export function getAdaptiveSpineCss(seed: string): string {
  const variant = getAdaptiveVariantIndex(seed);
  if (variant === 0) return 'color-mix(in srgb, var(--accent-primary) 72%, #141210)';
  if (variant === 1) return 'color-mix(in srgb, var(--accent-secondary) 72%, #141210)';
  return 'color-mix(in srgb, var(--sidebar-pill-bg) 78%, #141210)';
}

export function getAdaptiveRibbonCss(seed: string): string {
  const variant = getAdaptiveVariantIndex(seed);
  if (variant === 0) return 'var(--accent-secondary)';
  if (variant === 1) return 'var(--accent-primary)';
  return 'var(--accent-primary)';
}

/**
 * Renders either:
 * 1. The book's original cover artwork adapted cleanly to the 3D hardcover book proportions
 *    (full-bleed for standard book ratios, or full uncropped artwork over a matching blurred
 *    backdrop for square/wide/ultra-tall covers), with a subtle physical book-binding crease.
 * 2. A live theme-adaptive editorial hardcover when the file has no embedded cover image.
 */
export const BookCoverVisual: React.FC<BookCoverVisualProps> = ({ book, compact = false }) => {
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    setFitMode('cover');
  }, [book.coverDataUrl]);

  const hasOriginal =
    !imgError &&
    Boolean(book.coverDataUrl) &&
    (book.hasOriginalCover === true ||
      (book.hasOriginalCover === undefined &&
        !book.coverDataUrl.startsWith('data:image/svg+xml')));

  const variant = useMemo(
    () => getAdaptiveVariantIndex(`${book.id}:${book.title}`),
    [book.id, book.title]
  );

  if (!hasOriginal) {
    const bgStyle =
      variant === 0
        ? 'linear-gradient(155deg, var(--accent-primary) 0%, color-mix(in srgb, var(--accent-primary) 62%, var(--sidebar-pill-bg)) 100%)'
        : variant === 1
        ? 'linear-gradient(155deg, var(--accent-secondary) 0%, color-mix(in srgb, var(--accent-secondary) 60%, var(--sidebar-pill-bg)) 100%)'
        : 'linear-gradient(155deg, var(--sidebar-pill-bg) 0%, color-mix(in srgb, var(--sidebar-pill-bg) 68%, var(--accent-secondary)) 100%)';

    const textColor =
      variant === 0
        ? 'var(--accent-contrast)'
        : variant === 1
        ? 'var(--accent-secondary-contrast)'
        : 'var(--sidebar-pill-contrast)';

    return (
      <div
        className={`adaptive-book-cover ${compact ? 'compact' : ''}`}
        style={{ background: bgStyle, color: textColor }}
      >
        <div className="adaptive-cover-frame" />
        <div className="adaptive-cover-emblem">
          {book.kind === 'audiobook' ? (
            <Headphones size={compact ? 14 : 20} />
          ) : book.kind === 'manga' || book.kind === 'manhwa' || book.kind === 'comic' ? (
            <Sparkles size={compact ? 14 : 20} />
          ) : (
            <BookOpen size={compact ? 14 : 20} />
          )}
        </div>
        <div className="adaptive-cover-title">{book.title}</div>
        {!compact && <div className="adaptive-cover-author">{book.author}</div>}
        <div className="book-cover-binding-sheen" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`original-cover-stage ${fitMode === 'contain' ? 'is-contained' : ''}`}>
      {fitMode === 'contain' && (
        <img
          src={book.coverDataUrl}
          alt=""
          aria-hidden="true"
          className="book-cover-backdrop"
          loading="lazy"
        />
      )}
      <img
        src={book.coverDataUrl}
        alt={book.title}
        loading="lazy"
        className={`book-cover-img ${fitMode === 'contain' ? 'contain-fit' : 'cover-fit'}`}
        onError={() => setImgError(true)}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (!img.naturalWidth || !img.naturalHeight) return;
          const ratio = img.naturalWidth / img.naturalHeight;
          // Standard book/manga covers (~0.56 to ~0.88) fill edge-to-edge;
          // square audiobooks, landscape PDFs, or ultra-tall strips preserve the full uncropped cover
          setFitMode(ratio >= 0.56 && ratio <= 0.88 ? 'cover' : 'contain');
        }}
      />
      <div className="book-cover-binding-sheen" aria-hidden="true" />
    </div>
  );
};
