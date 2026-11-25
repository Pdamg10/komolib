import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookMarked, CheckCircle2, Clock, Cloud, Edit3, Folder, Headphones, Star } from 'lucide-react';
import type { BookItem } from '../types/library';
import { formatCompactDateTime, formatDateTime } from '../utils/readingStats';
import { hasDisplayableOriginalCover } from '../utils/coverHelpers';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';
import { openBookOptionsMenu } from './BookOptionsSheet';

const LONG_PRESS_MS = 440;
const MOVE_CANCEL_PX = 10;

function useBookLongPress(book: BookItem, onOpen: (b: BookItem) => void) {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredAtRef = useRef<number>(0);
  const [isPressing, setIsPressing] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
    setIsPressing(false);
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearTimer();
      startPosRef.current = { x: e.clientX, y: e.clientY };
      setIsPressing(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        startPosRef.current = null;
        setIsPressing(false);
        longPressFiredAtRef.current = Date.now();
        try {
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(18);
          }
        } catch {
          // ignore vibration unsupported
        }
        openBookOptionsMenu(book);
      }, LONG_PRESS_MS);
    },
    [book, clearTimer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startPosRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimer();
      longPressFiredAtRef.current = Date.now();
      openBookOptionsMenu(book);
    },
    [book, clearTimer]
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (Date.now() - longPressFiredAtRef.current < 500) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onOpen(book);
    },
    [book, onOpen]
  );

  return {
    isPressing,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clearTimer,
      onPointerCancel: clearTimer,
      onPointerLeave: clearTimer,
      onContextMenu,
      onClick,
    },
  };
}

export interface SeriesCardMeta {
  seriesKey: string;
  title: string;
  subtitle: string;
  chapterBadge: string;
  kindBadge: string;
  progress: number;
  favorite: boolean;
  wishlist: boolean;
  packCount: number;
  lastActivityAt?: number;
}

interface BookCardProps {
  book: BookItem;
  seriesMeta?: SeriesCardMeta;
  onOpen: (book: BookItem) => void;
  onToggleFavorite: (book: BookItem) => void;
  onToggleWishlist?: (book: BookItem) => void;
  onEdit: (book: BookItem) => void;
  showBookPages3D?: boolean;
  showBookRibbons?: boolean;
}

const BookCardInner: React.FC<BookCardProps> = ({
  book,
  seriesMeta,
  onOpen,
  onToggleFavorite,
  onToggleWishlist,
  onEdit,
  showBookPages3D = true,
  showBookRibbons = true,
}) => {
  const { isPressing, handlers } = useBookLongPress(book, onOpen);

  const hasOriginal = hasDisplayableOriginalCover(book);
  const displayTitle = seriesMeta ? seriesMeta.title : book.title;
  const displayAuthor = seriesMeta ? seriesMeta.subtitle : book.author;
  const displayProgress = seriesMeta ? seriesMeta.progress : book.progress;
  const displayFavorite = seriesMeta ? seriesMeta.favorite : book.favorite;
  const displayWishlist = seriesMeta ? seriesMeta.wishlist : book.wishlist;

  const adaptiveSeed = `${book.id}:${displayTitle}`;
  const effectiveSpineColor = hasOriginal ? book.spineColor : getAdaptiveSpineCss(adaptiveSeed);
  const effectiveRibbonColor = hasOriginal
    ? book.ribbonColor || '#f2ba59'
    : getAdaptiveRibbonCss(adaptiveSeed);

  const badgeLabel = seriesMeta
    ? seriesMeta.kindBadge
    : book.kind === 'manhwa'
    ? 'MANHWA'
    : book.kind === 'manga'
    ? 'MANGA'
    : book.kind === 'audiobook'
    ? 'AUDIO'
    : book.format.toUpperCase();

  return (
    <article
      className={`book-card ${isPressing ? 'pressing' : ''} ${seriesMeta ? 'is-series-card' : ''}`}
      {...handlers}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(book);
        }
      }}
    >
      <div className="book-hardcover-wrap">
        <div
          className={`book-hardcover ${showBookPages3D ? '' : 'flat-mode'}`}
          style={{ backgroundColor: effectiveSpineColor }}
        >
          <div className="book-cover-img-box">
            <BookCoverVisual
              book={seriesMeta ? { ...book, title: displayTitle } : book}
            />

            <span className="book-format-pill">
              {book.format === 'audio' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Headphones size={10} /> {badgeLabel}
                </span>
              ) : (
                badgeLabel
              )}
            </span>

            {seriesMeta && (
              <span
                className="series-chapter-pill"
                title={`${seriesMeta.chapterBadge} (${seriesMeta.packCount} ${seriesMeta.packCount === 1 ? 'paquete' : 'paquetes'})`}
              >
                {seriesMeta.chapterBadge}
              </span>
            )}

            {!seriesMeta && !book.hasLocalFile && (
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

            <div
              className="book-card-actions"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              <button
                className={`book-mini-btn ${displayFavorite ? 'fav-active' : ''}`}
                onClick={() => onToggleFavorite(book)}
                title={displayFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
              >
                <Star size={13} fill={displayFavorite ? 'currentColor' : 'none'} />
              </button>
              {onToggleWishlist && (
                <button
                  className={`book-mini-btn ${displayWishlist ? 'fav-active' : ''}`}
                  onClick={() => onToggleWishlist(book)}
                  title={displayWishlist ? 'Quitar de Por leer' : 'Guardar en Por leer'}
                >
                  <BookMarked size={13} fill={displayWishlist ? 'currentColor' : 'none'} />
                </button>
              )}
              <button
                className="book-mini-btn"
                onClick={() => onEdit(book)}
                title={seriesMeta ? 'Ver ficha y capítulos de la serie' : 'Personalizar portada, título, categorías...'}
              >
                <Edit3 size={12} />
              </button>
            </div>

            {displayProgress > 0 && (
              <div className="book-progress-track" title={`Progreso: ${Math.round(displayProgress)}%`}>
                <div
                  className="book-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(4, displayProgress))}%` }}
                />
              </div>
            )}
          </div>

          {showBookPages3D && <div className="book-pages-block" />}
          {showBookRibbons && (
            <div
              className="book-ribbon"
              style={{ backgroundColor: effectiveRibbonColor }}
            />
          )}
        </div>
      </div>

      <div className="book-meta">
        <div className="book-title" title={displayTitle}>
          {displayTitle}
        </div>
        <div className="book-author" title={displayAuthor}>
          {displayAuthor}
        </div>
        {seriesMeta ? (
          <div className="book-time-meta">
            <span className="book-time-pct">{Math.round(displayProgress || 0)}%</span>
            {seriesMeta.lastActivityAt ? (
              <span className="book-time-stamp">
                <Clock size={9} /> {formatCompactDateTime(seriesMeta.lastActivityAt)}
              </span>
            ) : null}
          </div>
        ) : (
          (book.progress > 0 || book.lastReadAt || book.finishedAt || book.lastChapterFinishedAt) && (
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
          )
        )}
      </div>
    </article>
  );
};

export const BookCard = React.memo(BookCardInner);

const BookListRowInner: React.FC<BookCardProps> = ({
  book,
  seriesMeta,
  onOpen,
  onToggleFavorite,
  onEdit,
}) => {
  const { isPressing, handlers } = useBookLongPress(book, onOpen);

  const hasOriginal = hasDisplayableOriginalCover(book);
  const displayTitle = seriesMeta ? seriesMeta.title : book.title;
  const displayAuthor = seriesMeta ? seriesMeta.subtitle : book.author;
  const displayFavorite = seriesMeta ? seriesMeta.favorite : book.favorite;

  const adaptiveSeed = `${book.id}:${displayTitle}`;
  const effectiveSpineColor = hasOriginal ? book.spineColor : getAdaptiveSpineCss(adaptiveSeed);
  const pct = Math.round((seriesMeta ? seriesMeta.progress : book.progress) || 0);
  const badgeLabel = seriesMeta
    ? seriesMeta.kindBadge
    : book.kind === 'manhwa'
    ? 'MANHWA'
    : book.kind === 'manga'
    ? 'MANGA'
    : book.kind === 'audiobook'
    ? 'AUDIO'
    : book.format.toUpperCase();

  return (
    <article
      className={`book-list-row ${isPressing ? 'pressing' : ''} ${seriesMeta ? 'is-series-row' : ''}`}
      {...handlers}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(book);
        }
      }}
    >
      <div className="book-list-thumb" style={{ backgroundColor: effectiveSpineColor }}>
        <div className="book-cover-img-box" style={{ borderRadius: 6 }}>
          <BookCoverVisual book={seriesMeta ? { ...book, title: displayTitle } : book} compact />
        </div>
      </div>

      <div className="book-list-info">
        <div className="book-list-top">
          <div className="book-list-title" title={displayTitle}>
            {displayTitle}
          </div>
          {seriesMeta && (
            <span className="book-list-fmt series-cap-chip">{seriesMeta.chapterBadge}</span>
          )}
          <span className="book-list-fmt">{badgeLabel}</span>
        </div>

        <div className="book-list-sub">
          <span className="book-list-author" title={displayAuthor}>
            {displayAuthor}
          </span>
          {!seriesMeta && book.folderPath && (
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
          {seriesMeta ? (
            <span>
              {seriesMeta.packCount} {seriesMeta.packCount === 1 ? 'paquete' : 'paquetes'}
              {seriesMeta.lastActivityAt ? ` · ${formatCompactDateTime(seriesMeta.lastActivityAt)}` : ''}
            </span>
          ) : book.lastReadAt ? (
            <span title={`Última lectura: ${formatDateTime(book.lastReadAt)}`}>
              <Clock size={10} /> Leído: {formatCompactDateTime(book.lastReadAt)}
            </span>
          ) : null}
          {!seriesMeta && (book.finishedAt ? (
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
          ) : null)}
        </div>
      </div>

      <div
        className="book-list-actions"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`circle-arrow-btn ${displayFavorite ? 'active-fav' : ''}`}
          style={{ width: 30, height: 30 }}
          onClick={() => onToggleFavorite(book)}
          title={displayFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        >
          <Star size={13} fill={displayFavorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="circle-arrow-btn"
          style={{ width: 30, height: 30 }}
          onClick={() => onEdit(book)}
          title={seriesMeta ? 'Ver ficha y capítulos' : 'Editar título, portada o detalles'}
        >
          <Edit3 size={13} />
        </button>
      </div>
    </article>
  );
};

export const BookListRow = React.memo(BookListRowInner);
