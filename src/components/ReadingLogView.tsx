import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Heart,
  Layers,
  MessageSquareText,
  Save,
  Star,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { BookItem, ReadingStatus } from '../types/library';
import {
  computeLibraryStats,
  formatCompactDateTime,
  formatDateTime,
  getEffectiveStatus,
  getPrimaryGenreLabel,
  STATUS_META,
  STATUS_ORDER,
} from '../utils/readingStats';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';

export const ReadingLogView: React.FC = () => {
  const { books, categories, updateBook, openBook, addNote, showToast } = useLibrary();

  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all'>('all');
  const [visibleLimit, setVisibleLimit] = useState(40);
  const [selectedBookId, setSelectedBookId] = useState<string>(books[0]?.id || '');
  const [reviewDraft, setReviewDraft] = useState<string | null>(null);
  const [seriesDraft, setSeriesDraft] = useState<string | null>(null);

  const stats = useMemo(() => computeLibraryStats(books, categories), [books, categories]);

  const filteredBooks = useMemo(() => {
    if (statusFilter === 'all') return books;
    return books.filter((b) => getEffectiveStatus(b) === statusFilter);
  }, [books, statusFilter]);

  const selectedBook: BookItem | undefined =
    books.find((b) => b.id === selectedBookId) || books[0];

  const activeReviewText =
    reviewDraft !== null ? reviewDraft : selectedBook?.review || '';
  const activeSeriesText =
    seriesDraft !== null ? seriesDraft : selectedBook?.seriesName || '';

  const selectBook = (book: BookItem) => {
    setSelectedBookId(book.id);
    setReviewDraft(null);
    setSeriesDraft(null);
  };

  const handleStatusChange = async (book: BookItem, nextStatus: ReadingStatus) => {
    const now = Date.now();
    const patch: Partial<BookItem> = {
      readingStatus: nextStatus,
      wishlist: nextStatus === 'want_to_read',
    };
    if (nextStatus === 'reading' && !book.startedAt) {
      patch.startedAt = now;
    }
    if (nextStatus === 'completed') {
      patch.finishedAt = now;
      patch.startedAt = book.startedAt || now;
      patch.progress = 100;
    }
    await updateBook(book.id, patch);
  };

  const handleRating = async (book: BookItem, rating: number) => {
    const next = book.rating === rating ? 0 : rating;
    await updateBook(book.id, { rating: next });
  };

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBook) return;
    const cleanedReview = activeReviewText.trim();
    const cleanedSeries = activeSeriesText.trim();
    await updateBook(selectedBook.id, {
      review: cleanedReview,
      seriesName: cleanedSeries || undefined,
    });
    if (cleanedReview) {
      await addNote({
        bookId: selectedBook.id,
        text: `Reseña (${selectedBook.rating || 0}★): ${cleanedReview}`,
        color: '#c5a888',
      });
    } else {
      showToast('Registro actualizado');
    }
    setReviewDraft(null);
    setSeriesDraft(null);
  };

  useEffect(() => {
    setVisibleLimit(40);
  }, [statusFilter, books.length]);

  const visibleLogBooks = useMemo(
    () => filteredBooks.slice(0, visibleLimit),
    [filteredBooks, visibleLimit]
  );

  return (
    <section className="tracker-page" aria-label="Diario de Lectura y Reseñas">
      {/* Top Bar */}
      <div className="tracker-header-card">
        <div>
          <span className="tracker-kicker">Registro y Reseñas</span>
          <h2 className="tracker-heading">Diario de Lectura</h2>
          <p className="tracker-quote">
            Califica cada título, cambia su estado de lectura, registra fechas y escribe tus reseñas personales.
          </p>
        </div>

        <div className="tracker-filter-pills">
          <button
            className={`pill-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Todos ({books.length})
          </button>
          {STATUS_ORDER.map((st) => (
            <button
              key={st}
              className={`pill-btn ${statusFilter === st ? 'active' : ''}`}
              onClick={() => setStatusFilter(st)}
            >
              <span className="status-dot" style={{ background: STATUS_META[st].color }} />
              {STATUS_META[st].short} ({stats.statusCounts[st]})
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: Reading Log Table + Selected Book Review Card */}
      <div className="reading-log-layout">
        {/* Table */}
        <div className="tracker-card log-table-card">
          <div className="tracker-card-head">
            <h3>Tabla de lecturas ({filteredBooks.length})</h3>
          </div>

          <div className="log-table-scroll">
            <table className="reading-log-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Título</th>
                  <th>Autor</th>
                  <th>Género</th>
                  <th>Estado</th>
                  <th>Calificación</th>
                  <th>Última lectura</th>
                  <th>Fin (Cap. / Libro)</th>
                  <th>Progreso</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogBooks.map((book, idx) => {
                  const st = getEffectiveStatus(book);
                  const genre = getPrimaryGenreLabel(book, categories);
                  const isSelected = selectedBook?.id === book.id;
                  return (
                    <tr
                      key={book.id}
                      className={isSelected ? 'selected-row' : ''}
                      onClick={() => selectBook(book)}
                    >
                      <td className="col-num">{idx + 1}</td>
                      <td>
                        <div className="log-book-cell">
                          <div className="log-mini-thumb">
                            <BookCoverVisual book={book} compact />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="log-book-title" title={book.title}>
                              {book.title}
                            </div>
                            {book.seriesName && (
                              <div className="log-book-sub">{book.seriesName}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="log-muted-cell">{book.author}</td>
                      <td>
                        <span className="log-genre-pill">{genre}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="log-status-select"
                          style={{
                            background: STATUS_META[st].bg,
                            color: STATUS_META[st].color,
                          }}
                          value={st}
                          onChange={(e) =>
                            handleStatusChange(book, e.target.value as ReadingStatus)
                          }
                        >
                          {STATUS_ORDER.map((opt) => (
                            <option key={opt} value={opt}>
                              {STATUS_META[opt].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="star-row" aria-label={`Calificación de ${book.title}`}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              className="star-btn"
                              onClick={() => handleRating(book, n)}
                              title={`${n} estrellas`}
                            >
                              <Star
                                size={14}
                                fill={(book.rating || 0) >= n ? '#e6b24c' : 'none'}
                                stroke={(book.rating || 0) >= n ? '#e6b24c' : 'var(--text-muted)'}
                              />
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="log-date-cell" title={formatDateTime(book.lastReadAt || book.startedAt)}>
                        {formatCompactDateTime(book.lastReadAt || book.startedAt)}
                      </td>
                      <td
                        className="log-date-cell"
                        title={
                          book.finishedAt
                            ? `Libro completado: ${formatDateTime(book.finishedAt)}`
                            : book.lastChapterFinishedAt
                            ? `Capítulo terminado${book.lastChapterFinishedTitle ? ` (${book.lastChapterFinishedTitle})` : ''}: ${formatDateTime(book.lastChapterFinishedAt)}`
                            : 'Sin finalizar aún'
                        }
                      >
                        {book.finishedAt
                          ? `✓ Libro · ${formatCompactDateTime(book.finishedAt)}`
                          : book.lastChapterFinishedAt
                          ? `Cap. · ${formatCompactDateTime(book.lastChapterFinishedAt)}`
                          : '—'}
                      </td>
                      <td className="log-date-cell">
                        <strong>{Math.round(book.progress || 0)}%</strong>
                        {book.pageCount ? ` · ${book.pageCount}p` : ''}
                      </td>
                    </tr>
                  );
                })}
                {filteredBooks.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No hay libros con este estado todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visibleLogBooks.length < filteredBooks.length && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <button
                type="button"
                className="pill-btn"
                onClick={() => setVisibleLimit((n) => n + 50)}
              >
                Mostrar más ({visibleLogBooks.length} de {filteredBooks.length})
              </button>
            </div>
          )}
        </div>

        {/* Book Review Spotlight Card (inspired by "Book Reviews" panel in reference!) */}
        {selectedBook && (
          <div className="tracker-card review-spotlight-card">
            <div className="tracker-card-head">
              <h3>
                <MessageSquareText size={15} /> Reseña del Libro
              </h3>
              <button
                type="button"
                className="pill-btn"
                style={{ height: 28, fontSize: 11 }}
                onClick={() => openBook(selectedBook)}
              >
                <BookOpen size={12} /> Abrir
              </button>
            </div>

            <div className="review-hero">
              <div className="book-hardcover-wrap review-hero-cover">
                <div
                  className="book-hardcover"
                  style={{
                    backgroundColor:
                      selectedBook.hasOriginalCover !== false
                        ? selectedBook.spineColor
                        : getAdaptiveSpineCss(`${selectedBook.id}:${selectedBook.title}`),
                  }}
                >
                  <div className="book-cover-img-box">
                    <BookCoverVisual book={selectedBook} />
                  </div>
                  <div className="book-pages-block" />
                  <div
                    className="book-ribbon"
                    style={{
                      backgroundColor:
                        selectedBook.hasOriginalCover !== false
                          ? selectedBook.ribbonColor || '#f2ba59'
                          : getAdaptiveRibbonCss(`${selectedBook.id}:${selectedBook.title}`),
                    }}
                  />
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>
                  {selectedBook.title}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--author-color)' }}>
                  por {selectedBook.author}
                </div>

                <div className="review-meta-grid">
                  <span>
                    <strong>Progreso:</strong> {Math.round(selectedBook.progress || 0)}%
                  </span>
                  <span>
                    <strong>Género:</strong> {getPrimaryGenreLabel(selectedBook, categories)} ({selectedBook.format.toUpperCase()})
                  </span>
                  <span>
                    <strong>Leído:</strong> {formatDateTime(selectedBook.lastReadAt || selectedBook.startedAt)}
                  </span>
                  <span>
                    <strong>Inicio:</strong> {formatDateTime(selectedBook.startedAt)}
                  </span>
                  {selectedBook.lastChapterFinishedAt && (
                    <span style={{ gridColumn: '1 / -1' }}>
                      <strong>Cap. terminado:</strong>{' '}
                      {selectedBook.lastChapterFinishedTitle ? `${selectedBook.lastChapterFinishedTitle} · ` : ''}
                      {formatDateTime(selectedBook.lastChapterFinishedAt)}
                    </span>
                  )}
                  <span style={{ gridColumn: selectedBook.lastChapterFinishedAt ? '1 / -1' : undefined }}>
                    <strong>Libro terminado:</strong> {formatDateTime(selectedBook.finishedAt)}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <div className="star-row">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="star-btn"
                        onClick={() => handleRating(selectedBook, n)}
                      >
                        <Star
                          size={18}
                          fill={(selectedBook.rating || 0) >= n ? '#e6b24c' : 'none'}
                          stroke={(selectedBook.rating || 0) >= n ? '#e6b24c' : 'var(--text-muted)'}
                        />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="circle-arrow-btn"
                    style={{
                      width: 28,
                      height: 28,
                      marginLeft: 'auto',
                      color: selectedBook.favorite ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}
                    onClick={() =>
                      updateBook(selectedBook.id, { favorite: !selectedBook.favorite })
                    }
                    title="Favorito"
                  >
                    <Heart size={13} fill={selectedBook.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveReview} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Serie / Saga (para el seguimiento de series)
                </label>
                <input
                  className="studio-input"
                  placeholder="Ej: Solo Leveling, El Archivo de las Tormentas..."
                  value={activeSeriesText}
                  onChange={(e) => setSeriesDraft(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Tu reseña o nota del libro
                </label>
                <textarea
                  className="studio-input"
                  rows={4}
                  placeholder="¿Qué te pareció la historia, los personajes o el dibujo? Deja tus impresiones aquí..."
                  value={activeReviewText}
                  onChange={(e) => setReviewDraft(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="coral-cta-btn"
                style={{ justifyContent: 'center', height: 36 }}
              >
                <Save size={14} /> Guardar reseña y nota
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Series Tracker */}
      <div className="tracker-card">
        <div className="tracker-card-head">
          <h3>
            <Layers size={15} /> Seguimiento de Series
          </h3>
          <span className="section-count">{stats.seriesList.length} series</span>
        </div>

        {stats.seriesList.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Asigna un nombre de <strong>Serie / Saga</strong> arriba en cualquier reseña para seguir automáticamente el progreso de tus sagas y mangas.
          </div>
        ) : (
          <div className="series-list">
            {stats.seriesList.map((s) => {
              const pct = Math.round((s.completed / Math.max(1, s.total)) * 100);
              const done = s.completed === s.total;
              return (
                <div key={s.name} className="series-row">
                  <div className="series-name">{s.name}</div>
                  <div className="series-counts">
                    {s.completed} / {s.total} leídos
                  </div>
                  <div className="goal-track series-progress-track">
                    <div className="goal-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span
                    className="series-status-pill"
                    style={{
                      background: done ? STATUS_META.completed.bg : STATUS_META.reading.bg,
                      color: done ? STATUS_META.completed.color : STATUS_META.reading.color,
                    }}
                  >
                    {done && <Check size={11} />}
                    {done ? 'Completada' : `${pct}% En curso`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
