import React from 'react';
import { Cloud, Edit3, Heart, Headphones, Star } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { BookItem } from '../types/library';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';

interface BookCardProps {
  book: BookItem;
}

export const BookCard: React.FC<BookCardProps> = ({ book }) => {
  const { openBook, updateBook, setEditingBook, theme } = useLibrary();

  const hasOriginal =
    Boolean(book.coverDataUrl) &&
    (book.hasOriginalCover === true ||
      (book.hasOriginalCover === undefined &&
        !book.coverDataUrl.startsWith('data:image/svg+xml')));

  const adaptiveSeed = `${book.id}:${book.title}`;
  const effectiveSpineColor = hasOriginal ? book.spineColor : getAdaptiveSpineCss(adaptiveSeed);
  const effectiveRibbonColor = hasOriginal
    ? book.ribbonColor || '#f2ba59'
    : getAdaptiveRibbonCss(adaptiveSeed);

  const badgeLabel =
    book.kind === 'manhwa'
      ? 'MANHWA'
      : book.kind === 'manga'
      ? 'MANGA'
      : book.kind === 'audiobook'
      ? 'AUDIO'
      : book.format.toUpperCase();

  return (
    <article
      className="book-card"
      onClick={() => openBook(book)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openBook(book);
        }
      }}
    >
      <div className="book-hardcover-wrap">
        <div
          className={`book-hardcover ${theme.showBookPages3D ? '' : 'flat-mode'}`}
          style={{ backgroundColor: effectiveSpineColor }}
        >
          <div className="book-cover-img-box">
            <BookCoverVisual book={book} />

            <span className="book-format-pill">
              {book.format === 'audio' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Headphones size={10} /> {badgeLabel}
                </span>
              ) : (
                badgeLabel
              )}
            </span>

            {!book.hasLocalFile && book.hasRemoteFile && (
              <span
                className="book-format-pill"
                style={{
                  top: 'auto',
                  bottom: 14,
                  left: 7,
                  background: 'color-mix(in srgb, var(--sidebar-pill-bg) 90%, transparent)',
                  color: 'var(--sidebar-pill-contrast)',
                }}
                title="En servidor — toca para descargar y leer"
              >
                <Cloud size={10} />
              </span>
            )}

            <div className="book-card-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className={`book-mini-btn ${book.favorite ? 'fav-active' : ''}`}
                onClick={() => updateBook(book.id, { favorite: !book.favorite })}
                title={book.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
              >
                <Star size={13} fill={book.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                className={`book-mini-btn ${book.wishlist ? 'fav-active' : ''}`}
                onClick={() => updateBook(book.id, { wishlist: !book.wishlist })}
                title={book.wishlist ? 'Quitar de lista de deseos' : 'Guardar para después'}
              >
                <Heart size={13} fill={book.wishlist ? 'currentColor' : 'none'} />
              </button>
              <button
                className="book-mini-btn"
                onClick={() => setEditingBook(book)}
                title="Personalizar portada, título, categorías..."
              >
                <Edit3 size={12} />
              </button>
            </div>

            {book.progress > 0 && (
              <div className="book-progress-track" title={`Progreso: ${Math.round(book.progress)}%`}>
                <div
                  className="book-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(4, book.progress))}%` }}
                />
              </div>
            )}
          </div>

          {theme.showBookPages3D && <div className="book-pages-block" />}
          {theme.showBookRibbons && (
            <div
              className="book-ribbon"
              style={{ backgroundColor: effectiveRibbonColor }}
            />
          )}
        </div>
      </div>

      <div className="book-meta">
        <div className="book-title" title={book.title}>
          {book.title}
        </div>
        <div className="book-author" title={book.author}>
          {book.author}
        </div>
      </div>
    </article>
  );
};
