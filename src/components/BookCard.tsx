import React from 'react';
import { CheckCircle2, Clock, Cloud, Edit3, Folder, Heart, Headphones, Star } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { BookItem } from '../types/library';
import { formatCompactDateTime, formatDateTime } from '../utils/readingStats';
import { hasDisplayableOriginalCover } from '../utils/coverHelpers';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';

interface BookCardProps {
  book: BookItem;
}

const BookCardInner: React.FC<BookCardProps> = ({ book }) => {
  const { openBook, updateBook, setEditingBook, theme } = useLibrary();

  const hasOriginal = hasDisplayableOriginalCover(book);

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

            {!book.hasLocalFile && (
              <span
                className="book-format-pill"
                style={{
                  top: 'auto',
                  bottom: 14,
                  left: 7,
                  background: book.hasRemoteFile
                    ? 'color-mix(in srgb, var(--sidebar-pill-bg) 90%, transparent)'
                    : 'rgba(60, 52, 46, 0.84)',
                  color: '#ffffff',
                }}
                title={
                  book.hasRemoteFile
                    ? 'En la nube — toca para descargar y guardar offline'
                    : 'Solo registro — toca para descargar de tu cuenta o vincular archivo local'
                }
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
        {(book.progress > 0 || book.lastReadAt || book.finishedAt || book.lastChapterFinishedAt) && (
          <div
            className="book-time-meta"
            title={[
              `Progreso: ${Math.round(book.progress || 0)}%`,
              book.lastReadAt ? `Última lectura: ${formatDateTime(book.lastReadAt)}` : '',
              book.lastChapterFinishedAt
                ? `Últ. cap. terminado${book.lastChapterFinishedTitle ? ` (${book.lastChapterFinishedTitle})` : ''}: ${formatDateTime(book.lastChapterFinishedAt)}`
                : '',
              book.finishedAt ? `Libro terminado: ${formatDateTime(book.finishedAt)}` : '',
            ]
              .filter(Boolean)
              .join('\n')}
          >
            <span className="book-time-pct">{Math.round(book.progress || 0)}%</span>
            {book.finishedAt ? (
              <span className="book-time-stamp done">
                <CheckCircle2 size={9} /> {formatCompactDateTime(book.finishedAt)}
              </span>
            ) : book.lastChapterFinishedAt ? (
              <span className="book-time-stamp done">
                <CheckCircle2 size={9} /> Cap. {formatCompactDateTime(book.lastChapterFinishedAt)}
              </span>
            ) : book.lastReadAt ? (
              <span className="book-time-stamp">
                <Clock size={9} /> {formatCompactDateTime(book.lastReadAt)}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
};

export const BookCard = React.memo(BookCardInner);

const BookListRowInner: React.FC<BookCardProps> = ({ book }) => {
  const { openBook, updateBook, setEditingBook } = useLibrary();

  const hasOriginal = hasDisplayableOriginalCover(book);

  const adaptiveSeed = `${book.id}:${book.title}`;
  const effectiveSpineColor = hasOriginal ? book.spineColor : getAdaptiveSpineCss(adaptiveSeed);
  const pct = Math.round(book.progress || 0);
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
      className="book-list-row"
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
      <div className="book-list-thumb" style={{ backgroundColor: effectiveSpineColor }}>
        <div className="book-cover-img-box" style={{ borderRadius: 6 }}>
          <BookCoverVisual book={book} compact />
        </div>
      </div>

      <div className="book-list-info">
        <div className="book-list-top">
          <div className="book-list-title" title={book.title}>
            {book.title}
          </div>
          <span className="book-list-fmt">{badgeLabel}</span>
        </div>

        <div className="book-list-sub">
          <span className="book-list-author" title={book.author}>
            {book.author}
          </span>
          {book.folderPath && (
            <span className="book-list-folder" title={`Carpeta: ${book.folderPath}`}>
              <Folder size={10} /> {book.folderPath}
            </span>
          )}
        </div>

        <div className="book-list-progress-row">
          <div className="goal-track" style={{ height: 6, flex: 1 }}>
            <div
              className={`goal-fill ${pct >= 98 ? 'secondary' : ''}`}
              style={{ width: `${Math.min(100, Math.max(pct > 0 ? 3 : 0, pct))}%` }}
            />
          </div>
          <span className="book-time-pct">{pct}%</span>
        </div>

        <div className="book-list-dates">
          {book.lastReadAt && (
            <span title={`Última lectura: ${formatDateTime(book.lastReadAt)}`}>
              <Clock size={10} /> Leído: {formatCompactDateTime(book.lastReadAt)}
            </span>
          )}
          {book.finishedAt ? (
            <span className="done" title={`Libro terminado: ${formatDateTime(book.finishedAt)}`}>
              <CheckCircle2 size={10} /> Fin: {formatCompactDateTime(book.finishedAt)}
            </span>
          ) : book.lastChapterFinishedAt ? (
            <span
              className="done"
              title={`Capítulo terminado${book.lastChapterFinishedTitle ? ` (${book.lastChapterFinishedTitle})` : ''}: ${formatDateTime(book.lastChapterFinishedAt)}`}
            >
              <CheckCircle2 size={10} /> Cap.: {formatCompactDateTime(book.lastChapterFinishedAt)}
            </span>
          ) : !book.lastReadAt ? (
            <span title={`Importado: ${formatDateTime(book.addedAt)}`}>
              Importado: {formatCompactDateTime(book.addedAt)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="book-list-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`circle-arrow-btn ${book.favorite ? 'active-fav' : ''}`}
          style={{ width: 30, height: 30 }}
          onClick={() => updateBook(book.id, { favorite: !book.favorite })}
          title={book.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        >
          <Star size={13} fill={book.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="circle-arrow-btn"
          style={{ width: 30, height: 30 }}
          onClick={() => setEditingBook(book)}
          title="Editar título, portada o detalles"
        >
          <Edit3 size={13} />
        </button>
      </div>
    </article>
  );
};

export const BookListRow = React.memo(BookListRowInner);
