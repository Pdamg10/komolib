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
  formatOriginBadge,
  groupLibraryForDisplay,
  type MangaSeriesGroup,
} from '../utils/mangaSeriesUtils';
import {
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

interface UnifiedLogEntry {
  id: string;
  isSeries: boolean;
  series?: MangaSeriesGroup;
  book: BookItem; // primaryBook for series, or the standalone BookItem
  allBookIds: string[];
  title: string;
  subtitle?: string;
  author: string;
  genreLabel: string;
  status: ReadingStatus;
  rating: number;
  review: string;
  seriesName: string;
  progress: number;
  pageCount?: number;
  chaptersSummary?: string;
  lastReadAt?: number;
  startedAt?: number;
  finishedAt?: number;
  lastChapterFinishedAt?: number;
  lastChapterFinishedTitle?: string;
  favorite: boolean;
  formatLabel: string;
}

function getSeriesEffectiveStatus(series: MangaSeriesGroup): ReadingStatus {
  const chapters = series.chapters.map((c) => c.book);
  if (
    chapters.length > 0 &&
    chapters.every((b) => getEffectiveStatus(b) === 'completed' || (b.progress || 0) >= 98)
  ) {
    return 'completed';
  }
  const explicitStatuses = chapters.map((b) => b.readingStatus).filter(Boolean) as ReadingStatus[];
  if (explicitStatuses.length > 0) {
    if (explicitStatuses.includes('reading')) return 'reading';
    if (explicitStatuses.every((s) => s === 'dropped')) return 'dropped';
    if (explicitStatuses.every((s) => s === 'on_hold')) return 'on_hold';
  }
  if (series.overallProgress > 0) return 'reading';
  return 'want_to_read';
}

export const ReadingLogView: React.FC = () => {
  const {
    books,
    categories,
    updateBook,
    updateSeriesBooks,
    openBook,
    setActiveSeriesKey,
    addNote,
    showToast,
  } = useLibrary();

  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all'>('all');
  const [visibleLimit, setVisibleLimit] = useState(40);
  const [selectedEntryId, setSelectedEntryId] = useState<string>('');
  const [reviewDraft, setReviewDraft] = useState<string | null>(null);
  const [seriesDraft, setSeriesDraft] = useState<string | null>(null);

  // Unify Manga/Manhwa/Comic chapter packs into ONE single entry per series (even 100+ chapters!),
  // while leaving standard Books and Audiobooks untouched.
  const unifiedEntries = useMemo<UnifiedLogEntry[]>(() => {
    const grouped = groupLibraryForDisplay(books);
    return grouped.map((item) => {
      if (item.type === 'book') {
        const b = item.book;
        return {
          id: b.id,
          isSeries: false,
          book: b,
          allBookIds: [b.id],
          title: b.title,
          subtitle: b.seriesName || undefined,
          author: b.author,
          genreLabel: getPrimaryGenreLabel(b, categories),
          status: getEffectiveStatus(b),
          rating: b.rating || 0,
          review: b.review || '',
          seriesName: b.seriesName || '',
          progress: Math.round(b.progress || 0),
          pageCount: b.pageCount,
          lastReadAt: b.lastReadAt,
          startedAt: b.startedAt,
          finishedAt: b.finishedAt,
          lastChapterFinishedAt: b.lastChapterFinishedAt,
          lastChapterFinishedTitle: b.lastChapterFinishedTitle,
          favorite: b.favorite,
          formatLabel: b.format.toUpperCase(),
        };
      }

      const s = item.series;
      const all = s.allBooks;
      const st = getSeriesEffectiveStatus(s);
      const maxRating = Math.max(0, ...all.map((b) => b.rating || 0));
      const bestReview =
        all.find((b) => b.review && b.review.trim())?.review?.trim() || '';
      const lastReadAt = Math.max(0, ...all.map((b) => b.lastReadAt || 0)) || undefined;
      const startedList = all.map((b) => b.startedAt || 0).filter((t) => t > 0);
      const startedAt = startedList.length > 0 ? Math.min(...startedList) : undefined;
      const finishedAt =
        st === 'completed'
          ? Math.max(0, ...all.map((b) => b.finishedAt || b.lastReadAt || 0)) || undefined
          : undefined;
      const lastCapDoneBook = [...all]
        .filter((b) => b.lastChapterFinishedAt || b.finishedAt)
        .sort(
          (a, b) =>
            (b.lastChapterFinishedAt || b.finishedAt || 0) -
            (a.lastChapterFinishedAt || a.finishedAt || 0)
        )[0];

      const totalPages = all.reduce((acc, b) => acc + (b.pageCount || 0), 0);
      const genreLabel =
        s.genres[0] ||
        (s.originTag === 'manhua'
          ? 'Manhua'
          : s.originTag === 'manhwa'
          ? 'Manhwa'
          : s.originTag === 'comic'
          ? 'Cómic'
          : 'Manga');

      return {
        id: `series_${s.seriesKey}`,
        isSeries: true,
        series: s,
        book: s.primaryBook,
        allBookIds: all.map((b) => b.id),
        title: s.seriesName,
        subtitle: `${formatOriginBadge(s.originTag)} · ${s.rangeLabel} (${s.availableChaptersCount} caps)`,
        author:
          s.fansubs.length > 0
            ? s.fansubs.join(', ')
            : s.primaryBook.author,
        genreLabel,
        status: st,
        rating: maxRating,
        review: bestReview,
        seriesName: s.seriesName,
        progress: Math.round(s.overallProgress),
        pageCount: totalPages > 0 ? totalPages : undefined,
        chaptersSummary: `${s.availableChaptersCount} caps · ${s.chapters.length} ${s.chapters.length === 1 ? 'paquete' : 'paquetes'}`,
        lastReadAt,
        startedAt,
        finishedAt,
        lastChapterFinishedAt: lastCapDoneBook?.lastChapterFinishedAt || lastCapDoneBook?.finishedAt,
        lastChapterFinishedTitle: lastCapDoneBook?.lastChapterFinishedTitle || lastCapDoneBook?.title,
        favorite: s.favorite,
        formatLabel: s.formats.map((f) => f.toUpperCase()).join('/'),
      };
    });
  }, [books, categories]);

  const statusCounts = useMemo(() => {
    const counts: Record<ReadingStatus, number> = {
      completed: 0,
      reading: 0,
      want_to_read: 0,
      on_hold: 0,
      dropped: 0,
    };
    for (const entry of unifiedEntries) {
      counts[entry.status]++;
    }
    return counts;
  }, [unifiedEntries]);

  // Unified series tracker (combines manga/manhwa series + book sagas)
  const seriesTrackerList = useMemo(() => {
    const list: Array<{
      key: string;
      name: string;
      total: number;
      completed: number;
      pct: number;
      label: string;
      onOpen?: () => void;
    }> = [];

    const bookSagas = new Map<string, { name: string; total: number; completed: number }>();

    for (const entry of unifiedEntries) {
      if (entry.isSeries && entry.series) {
        const s = entry.series;
        const donePacks = s.chapters.filter(
          (c) => getEffectiveStatus(c.book) === 'completed' || (c.book.progress || 0) >= 98
        ).length;
        list.push({
          key: entry.id,
          name: s.seriesName,
          total: s.chapters.length,
          completed: donePacks,
          pct: Math.round(s.overallProgress),
          label: `${donePacks} / ${s.chapters.length} paquetes (${s.rangeLabel})`,
          onOpen: () => setActiveSeriesKey(s.seriesKey),
        });
      } else if (entry.book.seriesName?.trim()) {
        const raw = entry.book.seriesName.trim();
        const k = raw.toLowerCase();
        const curr = bookSagas.get(k) || { name: raw, total: 0, completed: 0 };
        curr.total++;
        if (entry.status === 'completed') curr.completed++;
        bookSagas.set(k, curr);
      }
    }

    for (const [k, saga] of bookSagas.entries()) {
      const pct = Math.round((saga.completed / Math.max(1, saga.total)) * 100);
      list.push({
        key: `saga_${k}`,
        name: saga.name,
        total: saga.total,
        completed: saga.completed,
        pct,
        label: `${saga.completed} / ${saga.total} libros`,
      });
    }

    return list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));
  }, [unifiedEntries, setActiveSeriesKey]);

  const filteredEntries = useMemo(() => {
    if (statusFilter === 'all') return unifiedEntries;
    return unifiedEntries.filter((e) => e.status === statusFilter);
  }, [unifiedEntries, statusFilter]);

  const selectedEntry: UnifiedLogEntry | undefined =
    unifiedEntries.find((e) => e.id === selectedEntryId) || unifiedEntries[0];

  const activeReviewText =
    reviewDraft !== null ? reviewDraft : selectedEntry?.review || '';
  const activeSeriesText =
    seriesDraft !== null ? seriesDraft : selectedEntry?.seriesName || '';

  const selectEntry = (entry: UnifiedLogEntry) => {
    setSelectedEntryId(entry.id);
    setReviewDraft(null);
    setSeriesDraft(null);
  };

  const handleStatusChange = async (entry: UnifiedLogEntry, nextStatus: ReadingStatus) => {
    const now = Date.now();
    const patch: Partial<BookItem> = {
      readingStatus: nextStatus,
      wishlist: nextStatus === 'want_to_read',
    };
    if (nextStatus === 'reading' && !entry.startedAt) {
      patch.startedAt = now;
    }
    if (nextStatus === 'completed') {
      patch.finishedAt = now;
      patch.startedAt = entry.startedAt || now;
      patch.progress = 100;
    } else if (nextStatus === 'want_to_read') {
      patch.progress = 0;
      patch.finishedAt = undefined;
    }
    if (entry.isSeries) {
      await updateSeriesBooks(entry.allBookIds, patch);
    } else {
      await updateBook(entry.book.id, patch);
    }
  };

  const handleRating = async (entry: UnifiedLogEntry, rating: number) => {
    const next = entry.rating === rating ? 0 : rating;
    if (entry.isSeries) {
      await updateSeriesBooks(entry.allBookIds, { rating: next });
    } else {
      await updateBook(entry.book.id, { rating: next });
    }
  };

  const handleToggleFav = async (entry: UnifiedLogEntry) => {
    const next = !entry.favorite;
    if (entry.isSeries) {
      await updateSeriesBooks(entry.allBookIds, { favorite: next });
    } else {
      await updateBook(entry.book.id, { favorite: next });
    }
  };

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntry) return;
    const cleanedReview = activeReviewText.trim();
    const cleanedSeries = activeSeriesText.trim();
    const patch: Partial<BookItem> = {
      review: cleanedReview,
      seriesName: cleanedSeries || undefined,
    };
    if (selectedEntry.isSeries) {
      await updateSeriesBooks(selectedEntry.allBookIds, patch);
    } else {
      await updateBook(selectedEntry.book.id, patch);
    }
    if (cleanedReview) {
      await addNote({
        bookId: selectedEntry.book.id,
        text: `Reseña de ${selectedEntry.title} (${selectedEntry.rating || 0}★): ${cleanedReview}`,
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
  }, [statusFilter, unifiedEntries.length]);

  const visibleLogEntries = useMemo(
    () => filteredEntries.slice(0, visibleLimit),
    [filteredEntries, visibleLimit]
  );

  return (
    <section className="tracker-page" aria-label="Diario de Lectura y Reseñas">
      {/* Top Bar */}
      <div className="tracker-header-card">
        <div>
          <span className="tracker-kicker">Registro y Reseñas</span>
          <h2 className="tracker-heading">Diario de Lectura</h2>
          <p className="tracker-quote">
            Califica cada título o serie completa, cambia su estado de lectura, registra fechas y escribe tus reseñas personales.
          </p>
        </div>

        <div className="tracker-filter-pills">
          <button
            className={`pill-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Todos ({unifiedEntries.length})
          </button>
          {STATUS_ORDER.map((st) => (
            <button
              key={st}
              className={`pill-btn ${statusFilter === st ? 'active' : ''}`}
              onClick={() => setStatusFilter(st)}
            >
              <span className="status-dot" style={{ background: STATUS_META[st].color }} />
              {STATUS_META[st].short} ({statusCounts[st]})
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: Unified Reading Log Table + Review Spotlight */}
      <div className="reading-log-layout">
        <div className="tracker-card log-table-card">
          <div className="tracker-card-head">
            <h3>Tabla de lecturas ({filteredEntries.length})</h3>
          </div>

          <div className="log-table-scroll">
            <table className="reading-log-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Título</th>
                  <th>Autor / Fansub</th>
                  <th>Género</th>
                  <th>Estado</th>
                  <th>Calificación</th>
                  <th>Última lectura</th>
                  <th>Fin (Cap. / Obra)</th>
                  <th>Progreso</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogEntries.map((entry, idx) => {
                  const st = entry.status;
                  const isSelected = selectedEntry?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      className={isSelected ? 'selected-row' : ''}
                      onClick={() => selectEntry(entry)}
                    >
                      <td className="col-num">{idx + 1}</td>
                      <td>
                        <div className="log-book-cell">
                          <div className="log-mini-thumb">
                            <BookCoverVisual
                              book={entry.isSeries ? { ...entry.book, title: entry.title } : entry.book}
                              compact
                            />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="log-book-title" title={entry.title}>
                              {entry.title}
                            </div>
                            {entry.subtitle && (
                              <div className="log-book-sub">{entry.subtitle}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="log-muted-cell">{entry.author}</td>
                      <td>
                        <span className="log-genre-pill">{entry.genreLabel}</span>
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
                            void handleStatusChange(entry, e.target.value as ReadingStatus)
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
                        <div className="star-row" aria-label={`Calificación de ${entry.title}`}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              className="star-btn"
                              onClick={() => void handleRating(entry, n)}
                              title={`${n} estrellas`}
                            >
                              <Star
                                size={14}
                                fill={entry.rating >= n ? '#e6b24c' : 'none'}
                                stroke={entry.rating >= n ? '#e6b24c' : 'var(--text-muted)'}
                              />
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="log-date-cell" title={formatDateTime(entry.lastReadAt || entry.startedAt)}>
                        {formatCompactDateTime(entry.lastReadAt || entry.startedAt)}
                      </td>
                      <td
                        className="log-date-cell"
                        title={
                          entry.finishedAt
                            ? `Completado: ${formatDateTime(entry.finishedAt)}`
                            : entry.lastChapterFinishedAt
                            ? `Capítulo terminado${entry.lastChapterFinishedTitle ? ` (${entry.lastChapterFinishedTitle})` : ''}: ${formatDateTime(entry.lastChapterFinishedAt)}`
                            : 'Sin finalizar aún'
                        }
                      >
                        {entry.finishedAt
                          ? `✓ ${entry.isSeries ? 'Serie' : 'Libro'} · ${formatCompactDateTime(entry.finishedAt)}`
                          : entry.lastChapterFinishedAt
                          ? `Cap. · ${formatCompactDateTime(entry.lastChapterFinishedAt)}`
                          : '—'}
                      </td>
                      <td className="log-date-cell">
                        <strong>{entry.progress}%</strong>
                        {entry.isSeries && entry.series
                          ? ` · ${entry.series.availableChaptersCount}c`
                          : entry.pageCount
                          ? ` · ${entry.pageCount}p`
                          : ''}
                      </td>
                    </tr>
                  );
                })}
                {filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No hay títulos con este estado todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visibleLogEntries.length < filteredEntries.length && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <button
                type="button"
                className="pill-btn"
                onClick={() => setVisibleLimit((n) => n + 50)}
              >
                Mostrar más ({visibleLogEntries.length} de {filteredEntries.length})
              </button>
            </div>
          )}
        </div>

        {/* Review Spotlight Card */}
        {selectedEntry && (
          <div className="tracker-card review-spotlight-card">
            <div className="tracker-card-head">
              <h3>
                <MessageSquareText size={15} />{' '}
                {selectedEntry.isSeries ? 'Reseña de la Serie' : 'Reseña del Libro'}
              </h3>
              <button
                type="button"
                className="pill-btn"
                style={{ height: 28, fontSize: 11 }}
                onClick={() => {
                  if (selectedEntry.isSeries && selectedEntry.series) {
                    setActiveSeriesKey(selectedEntry.series.seriesKey);
                  } else {
                    void openBook(selectedEntry.book);
                  }
                }}
              >
                <BookOpen size={12} /> {selectedEntry.isSeries ? 'Ver capítulos' : 'Abrir'}
              </button>
            </div>

            <div className="review-hero">
              <div className="book-hardcover-wrap review-hero-cover">
                <div
                  className="book-hardcover"
                  style={{
                    backgroundColor:
                      selectedEntry.book.hasOriginalCover !== false
                        ? selectedEntry.book.spineColor
                        : getAdaptiveSpineCss(`${selectedEntry.book.id}:${selectedEntry.title}`),
                  }}
                >
                  <div className="book-cover-img-box">
                    <BookCoverVisual
                      book={
                        selectedEntry.isSeries
                          ? { ...selectedEntry.book, title: selectedEntry.title }
                          : selectedEntry.book
                      }
                    />
                  </div>
                  <div className="book-pages-block" />
                  <div
                    className="book-ribbon"
                    style={{
                      backgroundColor:
                        selectedEntry.book.hasOriginalCover !== false
                          ? selectedEntry.book.ribbonColor || '#f2ba59'
                          : getAdaptiveRibbonCss(`${selectedEntry.book.id}:${selectedEntry.title}`),
                    }}
                  />
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>
                  {selectedEntry.title}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--author-color)' }}>
                  {selectedEntry.isSeries && selectedEntry.subtitle
                    ? selectedEntry.subtitle
                    : `por ${selectedEntry.author}`}
                </div>

                <div className="review-meta-grid">
                  <span>
                    <strong>Progreso:</strong> {selectedEntry.progress}%
                  </span>
                  <span>
                    <strong>Género:</strong> {selectedEntry.genreLabel} ({selectedEntry.formatLabel})
                  </span>
                  {selectedEntry.chaptersSummary && (
                    <span style={{ gridColumn: '1 / -1' }}>
                      <strong>Capítulos:</strong> {selectedEntry.chaptersSummary}
                    </span>
                  )}
                  <span>
                    <strong>Leído:</strong> {formatDateTime(selectedEntry.lastReadAt || selectedEntry.startedAt)}
                  </span>
                  <span>
                    <strong>Inicio:</strong> {formatDateTime(selectedEntry.startedAt)}
                  </span>
                  {selectedEntry.lastChapterFinishedAt && (
                    <span style={{ gridColumn: '1 / -1' }}>
                      <strong>Cap. terminado:</strong>{' '}
                      {selectedEntry.lastChapterFinishedTitle ? `${selectedEntry.lastChapterFinishedTitle} · ` : ''}
                      {formatDateTime(selectedEntry.lastChapterFinishedAt)}
                    </span>
                  )}
                  <span style={{ gridColumn: selectedEntry.lastChapterFinishedAt ? '1 / -1' : undefined }}>
                    <strong>{selectedEntry.isSeries ? 'Serie terminada:' : 'Libro terminado:'}</strong>{' '}
                    {formatDateTime(selectedEntry.finishedAt)}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <div className="star-row">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="star-btn"
                        onClick={() => void handleRating(selectedEntry, n)}
                      >
                        <Star
                          size={18}
                          fill={selectedEntry.rating >= n ? '#e6b24c' : 'none'}
                          stroke={selectedEntry.rating >= n ? '#e6b24c' : 'var(--text-muted)'}
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
                      color: selectedEntry.favorite ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}
                    onClick={() => void handleToggleFav(selectedEntry)}
                    title="Favorito"
                  >
                    <Heart size={13} fill={selectedEntry.favorite ? 'currentColor' : 'none'} />
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
                  {selectedEntry.isSeries ? 'Tu reseña de la serie' : 'Tu reseña o nota del libro'}
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

      {/* Unified Series Tracker */}
      <div className="tracker-card">
        <div className="tracker-card-head">
          <h3>
            <Layers size={15} /> Seguimiento de Series
          </h3>
          <span className="section-count">{seriesTrackerList.length} series</span>
        </div>

        {seriesTrackerList.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Tus mangas, manhwas, cómics y sagas de libros aparecerán aquí agrupados automáticamente.
          </div>
        ) : (
          <div className="series-list">
            {seriesTrackerList.map((s) => {
              const done = s.completed === s.total && s.total > 0;
              return (
                <div
                  key={s.key}
                  className="series-row"
                  style={s.onOpen ? { cursor: 'pointer' } : undefined}
                  onClick={s.onOpen}
                >
                  <div className="series-name">{s.name}</div>
                  <div className="series-counts">{s.label}</div>
                  <div className="goal-track series-progress-track">
                    <div className="goal-fill" style={{ width: `${s.pct}%` }} />
                  </div>
                  <span
                    className="series-status-pill"
                    style={{
                      background: done ? STATUS_META.completed.bg : STATUS_META.reading.bg,
                      color: done ? STATUS_META.completed.color : STATUS_META.reading.color,
                    }}
                  >
                    {done && <Check size={11} />}
                    {done ? 'Completada' : `${s.pct}% En curso`}
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
