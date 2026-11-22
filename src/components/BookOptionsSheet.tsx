import React, { useEffect, useState } from 'react';
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
import { BookCoverVisual } from './BookCoverVisual';

type BookMenuListener = (bookId: string | null) => void;
const listeners = new Set<BookMenuListener>();
let currentOpenBookId: string | null = null;

export function openBookOptionsMenu(book: BookItem): void {
  currentOpenBookId = book.id;
  listeners.forEach((fn) => fn(book.id));
}

export function closeBookOptionsMenu(): void {
  currentOpenBookId = null;
  listeners.forEach((fn) => fn(null));
}

export function isBookOptionsMenuOpen(): boolean {
  return currentOpenBookId !== null;
}

export const BookOptionsSheet: React.FC = () => {
  const {
    books,
    openBook,
    updateBook,
    identifyBookWithAI,
    deleteBook,
    setEditingBook,
    setMissingFileBook,
    createRoomForBook,
    setNavSection,
    showToast,
  } = useLibrary();

  const [bookId, setBookId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    const handler: BookMenuListener = (nextId) => {
      setBookId(nextId);
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
    if (!bookId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBookId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bookId]);

  const book = bookId ? books.find((b) => b.id === bookId) || null : null;
  if (!book) return null;

  const isCompleted = book.readingStatus === 'completed' || (book.progress || 0) >= 98;
  const pct = Math.round(book.progress || 0);

  const close = () => {
    setConfirmDelete(false);
    currentOpenBookId = null;
    setBookId(null);
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
        aria-label={`Opciones de ${book.title}`}
      >
        <div className="book-options-handle" aria-hidden="true" />

        <div className="book-options-header">
          <div className="book-options-cover">
            <BookCoverVisual book={book} compact />
          </div>
          <div className="book-options-meta">
            <div className="book-options-title">{book.title}</div>
            <div className="book-options-sub">
              {book.author} · {book.format.toUpperCase()} · {pct}%
            </div>
          </div>
          <button
            type="button"
            className="circle-arrow-btn"
            style={{ flexShrink: 0 }}
            onClick={close}
            aria-label="Cerrar menú del libro"
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
              openBook(book);
            }}
          >
            <BookOpen size={17} />
            <span>{pct > 0 && pct < 98 ? `Continuar leyendo (${pct}%)` : 'Abrir libro'}</span>
          </button>

          <button
            type="button"
            className="book-option-btn"
            onClick={() => {
              close();
              setEditingBook(book);
            }}
          >
            <Edit3 size={17} />
            <span>Editar título, portada y categorías</span>
          </button>

          <button
            type="button"
            className="book-option-btn"
            onClick={async () => {
              const next = !book.favorite;
              await updateBook(book.id, { favorite: next });
              showToast(next ? 'Añadido a Favoritos' : 'Quitado de Favoritos');
              close();
            }}
          >
            <Star size={17} fill={book.favorite ? 'currentColor' : 'none'} />
            <span>{book.favorite ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}</span>
          </button>

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

          <button
            type="button"
            className="book-option-btn"
            onClick={async () => {
              const next = !book.wishlist;
              await updateBook(book.id, { wishlist: next });
              showToast(next ? 'Guardado en Por leer' : 'Quitado de Por leer');
              close();
            }}
          >
            <BookMarked size={17} fill={book.wishlist ? 'currentColor' : 'none'} />
            <span>{book.wishlist ? 'Quitar de Por leer' : 'Guardar en Por leer'}</span>
          </button>

          <button
            type="button"
            className="book-option-btn"
            onClick={async () => {
              if (isCompleted) {
                await updateBook(book.id, {
                  progress: 0,
                  currentPage: 1,
                  currentCfi: undefined,
                  scrollRatio: 0,
                  readingStatus: 'want_to_read',
                  finishedAt: undefined,
                });
                showToast('Progreso reiniciado');
              } else {
                await updateBook(book.id, {
                  progress: 100,
                  readingStatus: 'completed',
                  finishedAt: Date.now(),
                });
                showToast('Marcado como terminado');
              }
              close();
            }}
          >
            {isCompleted ? <RotateCcw size={17} /> : <CheckCircle2 size={17} />}
            <span>{isCompleted ? 'Reiniciar progreso (0%)' : 'Marcar como terminado'}</span>
          </button>

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

          {!book.hasLocalFile && (
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
              await deleteBook(book.id);
            }}
          >
            <Trash2 size={17} />
            <span>
              {confirmDelete ? 'Toca otra vez para eliminar definitivamente' : 'Eliminar libro'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
