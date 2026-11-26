import React, { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  CloudDownload,
  Edit3,
  RotateCcw,
  Share2,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { BookItem } from '../types/library';
import {
  formatOriginBadge,
  groupLibraryForDisplay,
  type MangaSeriesGroup,
} from '../utils/mangaSeriesUtils';
import { BookCoverVisual } from './BookCoverVisual';

type BookMenuPayload = { bookId: string; seriesKey?: string } | null;
type BookMenuListener = (payload: BookMenuPayload) => void;
const listeners = new Set<BookMenuListener>();
let currentOpenPayload: BookMenuPayload = null;

export function openBookOptionsMenu(book: BookItem, seriesKey?: string): void {
  currentOpenPayload = { bookId: book.id, seriesKey };
  listeners.forEach((fn) => fn(currentOpenPayload));
}

export function closeBookOptionsMenu(): void {
  currentOpenPayload = null;
  listeners.forEach((fn) => fn(null));
}

export function isBookOptionsMenuOpen(): boolean {
  return currentOpenPayload !== null;
}

export const BookOptionsSheet: React.FC = () => {
  const {
    books,
    openBook,
    updateBook,
    updateSeriesBooks,
    identifyBookWithAI,
    deleteBook,
    setEditingBook,
    setActiveSeriesKey,
    setMissingFileBook,
    createRoomForBook,
    setNavSection,
    showToast,
  } = useLibrary();

  const [menuPayload, setMenuPayload] = useState<BookMenuPayload>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    const handler: BookMenuListener = (next) => {
      setMenuPayload(next);
      setConfirmDelete(false);
      setSharingBusy(false);
      setAiBusy(false);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!menuPayload) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        currentOpenPayload = null;
        setMenuPayload(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuPayload]);

  const series: MangaSeriesGroup | null = useMemo(() => {
    if (!menuPayload?.seriesKey) return null;
    const grouped = groupLibraryForDisplay(books);
    for (const item of grouped) {
      if (item.type === 'series' && item.series.seriesKey === menuPayload.seriesKey) {
        return item.series;
      }
    }
    return null;
  }, [books, menuPayload?.seriesKey]);

  const book = menuPayload ? books.find((b) => b.id === menuPayload.bookId) || null : null;
  if (!book) return null;

  const isSeriesMode = Boolean(series);
  const allSeriesIds = series ? series.allBooks.map((b) => b.id) : [book.id];
  const pct = isSeriesMode ? Math.round(series!.overallProgress) : Math.round(book.progress || 0);
  const isCompleted = isSeriesMode
    ? series!.chapters.every((c) => c.book.readingStatus === 'completed' || (c.book.progress || 0) >= 98)
    : book.readingStatus === 'completed' || (book.progress || 0) >= 98;
  const isFavorite = isSeriesMode ? series!.favorite : book.favorite;
  const isWishlist = isSeriesMode ? series!.wishlist : book.wishlist;
  const displayTitle = isSeriesMode ? series!.seriesName : book.title;
  const displaySub = isSeriesMode
    ? `${formatOriginBadge(series!.originTag)} · ${series!.rangeLabel} · ${pct}%`
    : `${book.author} · ${book.format.toUpperCase()} · ${pct}%`;

  const close = () => {
    setConfirmDelete(false);
    currentOpenPayload = null;
    setMenuPayload(null);
  };

  return (
    <div
      className="modal-overlay book-options-overlay"
      onClick={close}
      role="presentation"
    >
      <div
        className="modal-card book-options-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Opciones de ${displayTitle}`}
      >
        <div className="book-options-handle" aria-hidden="true" />

        <div className="book-options-header">
          <div className="book-options-cover">
            <BookCoverVisual book={series ? series.primaryBook : book} compact />
          </div>
          <div className="book-options-meta">
            <div className="book-options-title">{displayTitle}</div>
            <div className="book-options-sub">{displaySub}</div>
          </div>
          <button
            type="button"
            className="circle-arrow-btn"
            style={{ flexShrink: 0 }}
            onClick={close}
            aria-label="Cerrar menú"
          >
            <X size={16} />
          </button>
        </div>

        <div className="book-options-list">
          <button
            type="button"
            className="book-option-btn primary"
            onClick={() => {
              close();
              if (series) {
                void openBook(series.continueBook);
              } else {
                void openBook(book);
              }
            }}
          >
            <BookOpen size={17} />
            <span>
              {series
                ? pct > 0 && pct < 98
                  ? `Continuar serie (${pct}%)`
                  : 'Empezar a leer serie'
                : pct > 0 && pct < 98
                ? `Continuar leyendo (${pct}%)`
                : 'Abrir libro'}
            </span>
          </button>

          <button
            type="button"
            className="book-option-btn"
            onClick={() => {
              close();
              if (series) {
                setActiveSeriesKey(series.seriesKey);
              } else {
                setEditingBook(book);
              }
            }}
          >
            <Edit3 size={17} />
            <span>
              {series
                ? `Ver ficha y capítulos (${series.chapters.length} ${series.chapters.length === 1 ? 'paquete' : 'paquetes'})`
                : 'Editar título, portada y categorías'}
            </span>
          </button>

          <button
            type="button"
            className="book-option-btn"
            onClick={async () => {
              const next = !isFavorite;
              if (series) {
                await updateSeriesBooks(allSeriesIds, { favorite: next });
                showToast(next ? 'Serie añadida a Favoritos' : 'Serie quitada de Favoritos');
              } else {
                await updateBook(book.id, { favorite: next });
                showToast(next ? 'Añadido a Favoritos' : 'Quitado de Favoritos');
              }
              close();
            }}
          >
            <Star size={17} fill={isFavorite ? 'currentColor' : 'none'} />
            <span>{isFavorite ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}</span>
          </button>

          {!series && (
            <button
              type="button"
              className="book-option-btn"
              disabled={aiBusy}
              onClick={async () => {
                setAiBusy(true);
                try {
                  await identifyBookWithAI(book.id);
                  close();
                } finally {
                  setAiBusy(false);
                }
              }}
            >
              <Sparkles size={17} />
              <span>{aiBusy ? 'Analizando portada y texto con IA...' : 'Completar título, autor y sinopsis con IA'}</span>
            </button>
          )}

          <button
            type="button"
            className="book-option-btn"
            onClick={async () => {
              const next = !isWishlist;
              if (series) {
                await updateSeriesBooks(allSeriesIds, { wishlist: next });
                showToast(next ? 'Serie guardada en Por leer' : 'Serie quitada de Por leer');
              } else {
                await updateBook(book.id, { wishlist: next });
                showToast(next ? 'Guardado en Por leer' : 'Quitado de Por leer');
              }
              close();
            }}
          >
            <BookMarked size={17} fill={isWishlist ? 'currentColor' : 'none'} />
            <span>{isWishlist ? 'Quitar de Por leer' : 'Guardar en Por leer'}</span>
          </button>

          <button
            type="button"
            className="book-option-btn"
            onClick={async () => {
              const now = Date.now();
              if (isCompleted) {
                const resetPatch: Partial<BookItem> = {
                  progress: 0,
                  currentPage: 1,
                  currentCfi: undefined,
                  scrollRatio: 0,
                  readingStatus: 'want_to_read',
                  finishedAt: undefined,
                };
                if (series) {
                  await updateSeriesBooks(allSeriesIds, resetPatch);
                  showToast(`Progreso reiniciado en los ${allSeriesIds.length} paquetes`);
                } else {
                  await updateBook(book.id, resetPatch);
                  showToast('Progreso reiniciado');
                }
              } else {
                const donePatch: Partial<BookItem> = {
                  progress: 100,
                  readingStatus: 'completed',
                  finishedAt: now,
                  lastReadAt: now,
                };
                if (series) {
                  await updateSeriesBooks(allSeriesIds, donePatch);
                  showToast(`Serie completa marcada como leída (${allSeriesIds.length} paquetes)`);
                } else {
                  await updateBook(book.id, donePatch);
                  showToast('Marcado como terminado');
                }
              }
              close();
            }}
          >
            {isCompleted ? <RotateCcw size={17} /> : <CheckCircle2 size={17} />}
            <span>
              {series
                ? isCompleted
                  ? `Reiniciar toda la serie (0% · ${allSeriesIds.length} partes)`
                  : `Marcar toda la serie como leída (${allSeriesIds.length} partes)`
                : isCompleted
                ? 'Reiniciar progreso (0%)'
                : 'Marcar como terminado'}
            </span>
          </button>

          {!series && (
            <button
              type="button"
              className="book-option-btn"
              disabled={sharingBusy}
              onClick={async () => {
                setSharingBusy(true);
                try {
                  const room = await createRoomForBook(book);
                  if (room) {
                    close();
                    setNavSection('shared');
                  }
                } finally {
                  setSharingBusy(false);
                }
              }}
            >
              <Share2 size={17} />
              <span>{sharingBusy ? 'Creando sala compartida...' : 'Compartir lectura en sala'}</span>
            </button>
          )}

          {!series && !book.hasLocalFile && (
            <button
              type="button"
              className="book-option-btn"
              onClick={() => {
                close();
                setMissingFileBook(book);
              }}
            >
              <CloudDownload size={17} />
              <span>Descargar o vincular archivo offline</span>
            </button>
          )}

          <button
            type="button"
            className={`book-option-btn danger ${confirmDelete ? 'confirming' : ''}`}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              close();
              if (series) {
                for (const id of allSeriesIds) {
                  await deleteBook(id);
                }
                showToast(`Serie eliminada (${allSeriesIds.length} archivos)`);
              } else {
                await deleteBook(book.id);
              }
            }}
          >
            <Trash2 size={17} />
            <span>
              {confirmDelete
                ? series
                  ? `Toca otra vez para eliminar los ${allSeriesIds.length} paquetes`
                  : 'Toca otra vez para eliminar definitivamente'
                : series
                ? `Eliminar toda la serie (${allSeriesIds.length} archivos)`
                : 'Eliminar libro'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
