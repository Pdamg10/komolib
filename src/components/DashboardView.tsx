import React, { useMemo, useState } from 'react';
import {
  BookCheck,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Pencil,
  Star,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import {
  computeLibraryStats,
  formatCompactDateTime,
  formatDateTime,
  STATUS_META,
  STATUS_ORDER,
} from '../utils/readingStats';
import { BookCoverVisual, getAdaptiveSpineCss } from './BookCoverVisual';

export const DashboardView: React.FC = () => {
  const { books, categories, profile, updateProfile, openBook, setNavSection } = useLibrary();
  const [editingGoals, setEditingGoals] = useState(false);
  const [booksGoalInput, setBooksGoalInput] = useState(String(profile.booksGoalPerMonth || 4));
  const [pagesGoalInput, setPagesGoalInput] = useState(String(profile.pagesGoalPerMonth || 1200));

  const stats = useMemo(() => computeLibraryStats(books, categories), [books, categories]);

  const booksGoal = Math.max(1, profile.booksGoalPerMonth || 4);
  const pagesGoal = Math.max(50, profile.pagesGoalPerMonth || 1200);
  const booksGoalPct = Math.min(100, Math.round((stats.monthlyCompletedBooks / booksGoal) * 100));
  const pagesGoalPct = Math.min(100, Math.round((stats.monthlyPagesRead / pagesGoal) * 100));
  const goalTimestamp = stats.monthlyLastActivityAt || profile.goalsUpdatedAt || Date.now();

  const recentActivityBooks = useMemo(() => {
    return [...books]
      .filter((b) => b.lastReadAt || b.finishedAt || b.lastChapterFinishedAt || (b.progress || 0) > 0)
      .sort(
        (a, b) =>
          Math.max(b.finishedAt || 0, b.lastChapterFinishedAt || 0, b.lastReadAt || 0, b.updatedAt || 0) -
          Math.max(a.finishedAt || 0, a.lastChapterFinishedAt || 0, a.lastReadAt || 0, a.updatedAt || 0)
      )
      .slice(0, 6);
  }, [books]);

  // Build SVG donut chart segments
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const totalForChart = Math.max(1, stats.totalBooks);
  let cumulative = 0;
  const donutSegments = STATUS_ORDER.map((status) => {
    const count = stats.statusCounts[status];
    const ratio = count / totalForChart;
    const dashLen = ratio * circumference;
    const offset = -cumulative * circumference;
    cumulative += ratio;
    return {
      status,
      count,
      color: STATUS_META[status].color,
      dashArray: `${dashLen} ${circumference - dashLen}`,
      dashOffset: offset,
    };
  });

  const maxGenreCount = Math.max(1, ...stats.topGenres.map((g) => g.count));

  const handleSaveGoals = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({
      booksGoalPerMonth: Math.max(1, Number(booksGoalInput) || 4),
      pagesGoalPerMonth: Math.max(50, Number(pagesGoalInput) || 1200),
      goalsUpdatedAt: Date.now(),
    });
    setEditingGoals(false);
  };

  return (
    <section className="tracker-page" aria-label="Panel de lectura">
      {/* Header Banner */}
      <div className="tracker-header-card">
        <div>
          <span className="tracker-kicker">Dashboard de Lectura</span>
          <h2 className="tracker-heading">Mi Reading Tracker</h2>
          <p className="tracker-quote">
            «Una habitación sin libros es como un cuerpo sin alma.» — Cicerón
          </p>
        </div>
        <div className="tracker-header-actions">
          <button className="pill-btn" onClick={() => setNavSection('reading-log')}>
            Ver Reading Log
          </button>
          <button
            className="coral-cta-btn"
            style={{ height: 32, padding: '0 14px', fontSize: 12 }}
            onClick={() => setNavSection('home')}
          >
            Ir a estantería
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: STATUS_META.completed.bg, color: STATUS_META.completed.color }}>
            <BookCheck size={20} />
          </div>
          <div>
            <div className="kpi-label">Libros completados</div>
            <div className="kpi-value">{stats.statusCounts.completed}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'color-mix(in srgb, var(--accent-secondary) 18%, transparent)', color: 'var(--accent-secondary)' }}>
            <FileText size={20} />
          </div>
          <div>
            <div className="kpi-label">Páginas leídas (est.)</div>
            <div className="kpi-value">{stats.totalPagesRead.toLocaleString('es-ES')}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: STATUS_META.reading.bg, color: STATUS_META.reading.color }}>
            <Star size={20} fill="currentColor" />
          </div>
          <div>
            <div className="kpi-label">Calificación promedio</div>
            <div className="kpi-value">{stats.avgRating ? `${stats.avgRating} ★` : '—'}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'color-mix(in srgb, var(--accent-primary) 18%, transparent)', color: 'var(--accent-primary)' }}>
            <BookOpen size={20} />
          </div>
          <div>
            <div className="kpi-label">Leyendo ahora</div>
            <div className="kpi-value">{stats.statusCounts.reading}</div>
          </div>
        </div>
      </div>

      {/* Charts & Goals Row */}
      <div className="dashboard-grid">
        {/* Donut: Books by Status */}
        <div className="tracker-card">
          <div className="tracker-card-head">
            <h3>Libros por estado</h3>
            <span className="section-count">{stats.totalBooks} total</span>
          </div>
          <div className="donut-layout">
            <div className="donut-wrap">
              <svg viewBox="0 0 120 120" width="98" height="98">
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke="var(--border-subtle)"
                  strokeWidth="15"
                />
                {donutSegments.map(
                  (seg) =>
                    seg.count > 0 && (
                      <circle
                        key={seg.status}
                        cx="60"
                        cy="60"
                        r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="15"
                        strokeDasharray={seg.dashArray}
                        strokeDashoffset={seg.dashOffset}
                        transform="rotate(-90 60 60)"
                      />
                    )
                )}
              </svg>
              <div className="donut-center">
                <strong>{stats.totalBooks}</strong>
                <span>Libros</span>
              </div>
            </div>

            <div className="status-legend">
              {STATUS_ORDER.map((st) => (
                <div key={st} className="status-legend-row">
                  <span className="status-dot" style={{ background: STATUS_META[st].color }} />
                  <span className="status-legend-label">{STATUS_META[st].label}</span>
                  <strong>{stats.statusCounts[st]}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bar Chart: Books by Genre */}
        <div className="tracker-card">
          <div className="tracker-card-head">
            <h3>
              <TrendingUp size={15} /> Libros por género
            </h3>
          </div>
          {stats.topGenres.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
              Importa libros para ver la distribución por género.
            </div>
          ) : (
            <div className="genre-bars">
              {stats.topGenres.map((g) => {
                const heightPct = Math.max(14, Math.round((g.count / maxGenreCount) * 100));
                return (
                  <div key={g.label} className="genre-bar-col">
                    <span className="genre-bar-count">{g.count}</span>
                    <div className="genre-bar-track">
                      <div
                        className="genre-bar-fill"
                        style={{ height: `${heightPct}%`, background: g.color }}
                      />
                    </div>
                    <span className="genre-bar-label" title={g.label}>
                      {g.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Monthly Reading Goals */}
        <div className="tracker-card dashboard-goals-card">
          <div className="tracker-card-head">
            <h3>
              <Target size={15} /> Meta mensual · {stats.currentMonthLabel}
            </h3>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 26, fontSize: 11, padding: '0 10px' }}
              onClick={() => setEditingGoals(!editingGoals)}
            >
              <Pencil size={11} /> {editingGoals ? 'Cerrar' : 'Editar'}
            </button>
          </div>

          <div className="goal-timestamp-bar">
            <CalendarClock size={12} />
            <span>
              {stats.monthlyLastActivityAt ? 'Último avance:' : 'Fecha y hora:'}{' '}
              <strong>{formatDateTime(goalTimestamp)}</strong>
            </span>
          </div>

          {editingGoals ? (
            <form onSubmit={handleSaveGoals} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>
                Meta de libros al mes
                <input
                  className="studio-input"
                  type="number"
                  min={1}
                  max={100}
                  value={booksGoalInput}
                  onChange={(e) => setBooksGoalInput(e.target.value)}
                  style={{ marginTop: 4 }}
                />
              </label>
              <label style={{ fontSize: 11.5, fontWeight: 700 }}>
                Meta de páginas al mes
                <input
                  className="studio-input"
                  type="number"
                  min={50}
                  max={50000}
                  step={100}
                  value={pagesGoalInput}
                  onChange={(e) => setPagesGoalInput(e.target.value)}
                  style={{ marginTop: 4 }}
                />
              </label>
              <button type="submit" className="coral-cta-btn" style={{ height: 34, justifyContent: 'center' }}>
                Guardar metas mensuales
              </button>
            </form>
          ) : (
            <div className="dashboard-goals-list">
              <div>
                <div className="goal-row-label">
                  <span>
                    Libros este mes: <strong>{stats.monthlyCompletedBooks} / {booksGoal}</strong>
                  </span>
                  <strong style={{ color: 'var(--accent-primary)' }}>{booksGoalPct}%</strong>
                </div>
                <div className="goal-track">
                  <div className="goal-fill" style={{ width: `${booksGoalPct}%` }} />
                </div>
              </div>

              <div>
                <div className="goal-row-label">
                  <span>
                    Páginas este mes:{' '}
                    <strong>
                      {stats.monthlyPagesRead.toLocaleString('es-ES')} /{' '}
                      {pagesGoal.toLocaleString('es-ES')}
                    </strong>
                  </span>
                  <strong style={{ color: 'var(--accent-secondary)' }}>{pagesGoalPct}%</strong>
                </div>
                <div className="goal-track">
                  <div
                    className="goal-fill secondary"
                    style={{ width: `${pagesGoalPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Reading Timeline (Exact Date, Time, Chapter & Book Completion) */}
      <div className="tracker-card">
        <div className="tracker-card-head">
          <h3>
            <Clock size={15} /> Actividad y progreso reciente
          </h3>
          <span className="section-count">{recentActivityBooks.length} títulos</span>
        </div>

        {recentActivityBooks.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
            Abre cualquier libro para registrar automáticamente su progreso, fecha y hora exacta de lectura, capítulos terminados y finalización.
          </div>
        ) : (
          <div className="activity-timeline-grid">
            {recentActivityBooks.map((book) => {
              const pct = Math.round(book.progress || 0);
              return (
                <button
                  key={book.id}
                  type="button"
                  className="activity-timeline-item"
                  onClick={() => openBook(book)}
                >
                  <div className="log-mini-thumb" style={{ width: 32, height: 46 }}>
                    <BookCoverVisual book={book} compact />
                  </div>
                  <div className="activity-timeline-body">
                    <div className="activity-timeline-top">
                      <span className="activity-timeline-title" title={book.title}>
                        {book.title}
                      </span>
                      <span className="activity-timeline-pct">{pct}%</span>
                    </div>
                    <div className="goal-track" style={{ height: 6 }}>
                      <div
                        className={`goal-fill ${pct >= 98 ? 'secondary' : ''}`}
                        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                      />
                    </div>
                    <div className="activity-timeline-dates">
                      {book.lastReadAt && (
                        <span>
                          <Clock size={10} /> Leído: {formatCompactDateTime(book.lastReadAt)}
                        </span>
                      )}
                      {book.finishedAt ? (
                        <span className="done">
                          <CheckCircle2 size={10} /> Libro fin: {formatCompactDateTime(book.finishedAt)}
                        </span>
                      ) : book.lastChapterFinishedAt ? (
                        <span className="done">
                          <CheckCircle2 size={10} /> Cap. fin: {formatCompactDateTime(book.lastChapterFinishedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Top Rated Books */}
      <div className="tracker-card">
        <div className="tracker-card-head">
          <h3>
            <Star size={15} /> Mejor calificados
          </h3>
          <button
            className="pill-btn"
            style={{ height: 28, fontSize: 11 }}
            onClick={() => setNavSection('reading-log')}
          >
            Calificar libros
          </button>
        </div>

        {stats.topRated.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>
            Aún no has calificado ningún libro. Abre <strong>Reading Log</strong> o la pestaña{' '}
            <strong>Notas</strong> para asignar estrellas ★ a tus lecturas.
          </div>
        ) : (
          <div className="top-rated-strip">
            {stats.topRated.map((book) => {
              const hasOrig =
                Boolean(book.coverDataUrl) &&
                (book.hasOriginalCover === true ||
                  (book.hasOriginalCover === undefined &&
                    !book.coverDataUrl.startsWith('data:image/svg+xml')));
              return (
                <button
                  key={book.id}
                  className="top-rated-item"
                  onClick={() => openBook(book)}
                >
                  <div
                    className="top-rated-cover"
                    style={{
                      backgroundColor: hasOrig
                        ? book.spineColor
                        : getAdaptiveSpineCss(`${book.id}:${book.title}`),
                    }}
                  >
                    <div className="book-cover-img-box" style={{ borderRadius: 8 }}>
                      <BookCoverVisual book={book} compact />
                    </div>
                  </div>
                  <div className="top-rated-stars">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={12}
                        fill={(book.rating || 0) >= n ? '#e6b24c' : 'none'}
                        stroke={(book.rating || 0) >= n ? '#e6b24c' : 'var(--text-muted)'}
                      />
                    ))}
                  </div>
                  <div className="top-rated-title">{book.title}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
