import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  ClipboardList,
  ExternalLink,
  Plus,
  Star,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { ReadingStatus } from '../types/library';
import { getEffectiveStatus, STATUS_META, STATUS_ORDER } from '../utils/readingStats';

export const NotesSyncTab: React.FC = () => {
  const {
    books,
    activeBook,
    bookmarks,
    annotations,
    allBookmarkDesigns,
    deleteBookmark,
    notes,
    addNote,
    deleteNote,
    openBookAt,
    updateBook,
    setNavSection,
    showToast,
  } = useLibrary();

  const defaultBook =
    activeBook ||
    books.find((b) => getEffectiveStatus(b) === 'reading') ||
    books[0];

  const [selectedBookId, setSelectedBookId] = useState(defaultBook?.id || '');
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    if (activeBook?.id) {
      setSelectedBookId(activeBook.id);
    } else if (!books.some((b) => b.id === selectedBookId) && books[0]?.id) {
      setSelectedBookId(books[0].id);
    }
  }, [activeBook?.id, books, selectedBookId]);

  const currentBook = books.find((b) => b.id === selectedBookId) || defaultBook;
  const currentStatus = currentBook ? getEffectiveStatus(currentBook) : 'reading';

  const handleQuickStatus = async (next: ReadingStatus) => {
    if (!currentBook) return;
    const now = Date.now();
    await updateBook(currentBook.id, {
      readingStatus: next,
      wishlist: next === 'want_to_read',
      startedAt:
        next === 'reading' || next === 'completed'
          ? currentBook.startedAt || now
          : currentBook.startedAt,
      finishedAt: next === 'completed' ? now : currentBook.finishedAt,
      progress: next === 'completed' ? 100 : currentBook.progress,
    });
    showToast(`Estado actualizado a "${STATUS_META[next].label}"`);
  };

  const handleQuickRating = async (stars: number) => {
    if (!currentBook) return;
    const next = currentBook.rating === stars ? 0 : stars;
    await updateBook(currentBook.id, { rating: next });
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBook || !noteText.trim()) return;
    const clean = noteText.trim();
    await addNote({
      bookId: currentBook.id,
      text: clean,
      page: currentBook.currentPage,
      color: STATUS_META[currentStatus].color,
    });
    await updateBook(currentBook.id, { review: clean });
    setNoteText('');
  };

  return (
    <div className="right-panel-body">
      {/* Quick Reading Log & Rating Card */}
      <div className="studio-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <h4>
            <ClipboardList size={14} /> Diario rápido
          </h4>
          <button
            type="button"
            className="pill-btn"
            style={{ height: 24, fontSize: 10.5, padding: '0 9px' }}
            onClick={() => setNavSection('reading-log')}
          >
            <ExternalLink size={10} /> Vista completa
          </button>
        </div>

        {currentBook ? (
          <form onSubmit={handleCreateNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select
              className="studio-input"
              value={currentBook.id}
              onChange={(e) => setSelectedBookId(e.target.value)}
              aria-label="Seleccionar libro para registrar"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <select
                className="log-status-select"
                style={{
                  background: STATUS_META[currentStatus].bg,
                  color: STATUS_META[currentStatus].color,
                }}
                value={currentStatus}
                onChange={(e) => handleQuickStatus(e.target.value as ReadingStatus)}
                aria-label="Estado de lectura"
              >
                {STATUS_ORDER.map((st) => (
                  <option key={st} value={st}>
                    {STATUS_META[st].label}
                  </option>
                ))}
              </select>

              <div className="star-row" title="Califica este libro">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="star-btn"
                    onClick={() => handleQuickRating(n)}
                    aria-label={`${n} estrellas`}
                  >
                    <Star
                      size={16}
                      fill={(currentBook.rating || 0) >= n ? '#e6b24c' : 'none'}
                      stroke={(currentBook.rating || 0) >= n ? '#e6b24c' : 'var(--text-muted)'}
                    />
                  </button>
                ))}
              </div>
            </div>

            {currentBook.review && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  background: 'var(--banner-bg)',
                  borderRadius: 10,
                  padding: '7px 9px',
                  lineHeight: 1.4,
                }}
              >
                <strong style={{ color: 'var(--text-primary)' }}>Última reseña:</strong>{' '}
                {currentBook.review}
              </div>
            )}

            <textarea
              className="studio-input"
              rows={3}
              placeholder={`Escribe una nota o reseña de "${currentBook.title}"...`}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />

            <button
              type="submit"
              className="pill-btn"
              style={{
                justifyContent: 'center',
                background: 'var(--accent-primary)',
                color: 'var(--accent-contrast)',
                borderColor: 'transparent',
              }}
            >
              <Plus size={12} /> Guardar nota y reseña
            </button>
          </form>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Importa un libro para empezar a calificar y guardar notas.
          </div>
        )}
      </div>

      {/* Notes History */}
      <div className="studio-card">
        <h4>
          <StickyNote size={14} /> Notas y Reseñas ({notes.length})
        </h4>
        {notes.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Tus notas y reseñas del Diario de Lectura aparecerán aquí.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {notes.map((n) => {
              const b = books.find((x) => x.id === n.bookId);
              return (
                <div
                  key={n.id}
                  style={{
                    background: 'var(--banner-bg)',
                    borderLeft: `4px solid ${n.color || 'var(--accent-primary)'}`,
                    borderRadius: 10,
                    padding: '8px 10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 3,
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--author-color)' }}>
                      {b?.title || 'Nota general'}
                      {b?.rating ? ` · ${'★'.repeat(b.rating)}` : ''}
                    </span>
                    <button
                      onClick={() => deleteNote(n.id)}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>{n.text}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bookmarks & Annotations Quick Access */}
      <div className="studio-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <h4>
            <Bookmark size={14} /> Marcadores y Marcas
          </h4>
          <button
            type="button"
            className="pill-btn"
            style={{ height: 24, fontSize: 10.5, padding: '0 9px' }}
            onClick={() => setNavSection('annotations')}
          >
            <ExternalLink size={10} /> Ver todo
          </button>
        </div>
        {bookmarks.length === 0 && annotations.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Guarda separadores, resaltados, post-its, stickers o emojis mientras lees cualquier libro.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {bookmarks.slice(0, 6).map((bm) => {
              const b = books.find((x) => x.id === bm.bookId);
              const design = allBookmarkDesigns.find((d) => d.id === bm.designId);
              return (
                <div
                  key={bm.id}
                  style={{
                    background: 'var(--banner-bg)',
                    borderRadius: 12,
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  {design && (
                    <img
                      src={design.imageUrl}
                      alt={design.name}
                      style={{ width: 18, height: 42, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                    />
                  )}
                  <button
                    onClick={() =>
                      b &&
                      openBookAt(b, {
                        cfi: bm.cfi,
                        chapterHref: bm.chapterHref,
                        page: bm.page,
                        scrollRatio: bm.scrollRatio,
                      })
                    }
                    style={{ textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {b?.title || 'Título'}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{bm.label}</div>
                  </button>
                  <button
                    onClick={() => deleteBookmark(bm.id)}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
            {annotations.slice(0, 4).map((ann) => {
              const b = books.find((x) => x.id === ann.bookId);
              return (
                <button
                  key={ann.id}
                  type="button"
                  onClick={() =>
                    b &&
                    openBookAt(b, {
                      annotationId: ann.id,
                      cfi: ann.cfi,
                      chapterHref: ann.chapterHref,
                      page: ann.page,
                      scrollRatio: ann.scrollRatio,
                      quote: ann.quote,
                    })
                  }
                  style={{
                    background: 'var(--banner-bg)',
                    borderLeft: `3px solid ${ann.color}`,
                    borderRadius: 10,
                    padding: '7px 9px',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)' }}>
                    {b?.title || 'Libro'} · {ann.chapter ? `${ann.chapter} · ` : ''}
                    {ann.page ? `Pág. ${ann.page}` : `${Math.round(ann.progress)}%`}
                    {ann.sticker ? ` · ${ann.sticker}` : ''}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: 2,
                    }}
                  >
                    “{ann.quote}”
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
