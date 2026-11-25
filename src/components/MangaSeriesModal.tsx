import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown01,
  ArrowUp10,
  BookMarked,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  Cloud,
  Edit3,
  Play,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { BookItem, ContentKind } from '../types/library';
import {
  formatOriginBadge,
  formatSeriesStatusBadge,
  groupLibraryForDisplay,
  normalizeSeriesKey,
  parseTelegramSeriesCard,
  type MangaSeriesGroup,
  type OriginTag,
  type SeriesStatus,
} from '../utils/mangaSeriesUtils';
import { hasDisplayableOriginalCover } from '../utils/coverHelpers';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';

function originToKind(origin: OriginTag): 'manga' | 'manhwa' | 'comic' {
  if (origin === 'comic') return 'comic';
  if (origin === 'manga') return 'manga';
  return 'manhwa';
}

export const MangaSeriesModal: React.FC = () => {
  const {
    books,
    activeSeriesKey,
    setActiveSeriesKey,
    openBook,
    setEditingBook,
    updateSeriesBooks,
    deleteBook,
    identifyBookWithAI,
    showToast,
  } = useLibrary();

  const [descOrder, setDescOrder] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [telegramPaste, setTelegramPaste] = useState('');
  const [identifyingAi, setIdentifyingAi] = useState(false);
  const [cleaningDups, setCleaningDups] = useState(false);

  // Editable series metadata form state
  const [seriesNameDraft, setSeriesNameDraft] = useState('');
  const [originDraft, setOriginDraft] = useState<OriginTag>('manhwa');
  const [statusDraft, setStatusDraft] = useState<SeriesStatus | ''>('');
  const [genresDraft, setGenresDraft] = useState('');
  const [fansubsDraft, setFansubsDraft] = useState('');
  const [totalCapsDraft, setTotalCapsDraft] = useState('');
  const [synopsisDraft, setSynopsisDraft] = useState('');

  const series: MangaSeriesGroup | null = useMemo(() => {
    if (!activeSeriesKey) return null;
    const grouped = groupLibraryForDisplay(books);
    for (const item of grouped) {
      if (item.type === 'series' && item.series.seriesKey === activeSeriesKey) {
        return item.series;
      }
    }
    return null;
  }, [books, activeSeriesKey]);

  useEffect(() => {
    if (!series) return;
    setSeriesNameDraft(series.seriesName);
    setOriginDraft(series.originTag);
    setStatusDraft(series.seriesStatus || '');
    setGenresDraft(series.genres.join(', '));
    setFansubsDraft(series.fansubs.join(', '));
    setTotalCapsDraft(series.totalChaptersExpected ? String(series.totalChaptersExpected) : '');
    setSynopsisDraft(series.synopsis || '');
    setTelegramPaste('');
  }, [series?.seriesKey]);

  // Close automatically if all books in the series were deleted
  useEffect(() => {
    if (activeSeriesKey && !series) {
      setActiveSeriesKey(null);
    }
  }, [activeSeriesKey, series, setActiveSeriesKey]);

  if (!activeSeriesKey || !series) return null;

  const primary = series.primaryBook;
  const hasOriginal = hasDisplayableOriginalCover(primary);
  const adaptiveSeed = `${primary.id}:${series.seriesName}`;
  const effectiveSpine = hasOriginal ? primary.spineColor : getAdaptiveSpineCss(adaptiveSeed);
  const effectiveRibbon = hasOriginal
    ? primary.ribbonColor || '#f2ba59'
    : getAdaptiveRibbonCss(adaptiveSeed);

  const orderedChapters = descOrder ? [...series.chapters].reverse() : series.chapters;
  const continueEntry =
    series.chapters.find((c) => c.book.id === series.continueBook.id) || series.chapters[0];
  const hasStarted = series.overallProgress > 0;

  const handleOpenChapter = (book: BookItem) => {
    setActiveSeriesKey(null);
    void openBook(book);
  };

  const handleToggleSeriesFavorite = async () => {
    const nextFav = !series.favorite;
    await updateSeriesBooks(
      series.allBooks.map((b) => b.id),
      { favorite: nextFav }
    );
    showToast(nextFav ? 'Serie añadida a favoritos' : 'Serie quitada de favoritos');
  };

  const handleToggleSeriesWishlist = async () => {
    const nextWish = !series.wishlist;
    await updateSeriesBooks(
      series.allBooks.map((b) => b.id),
      { wishlist: nextWish }
    );
    showToast(nextWish ? 'Serie guardada en Por leer' : 'Serie quitada de Por leer');
  };

  const handleApplyTelegramCard = () => {
    if (!telegramPaste.trim()) {
      showToast('Pega primero el texto de la ficha de Telegram');
      return;
    }
    const parsed = parseTelegramSeriesCard(telegramPaste);
    let filled = 0;
    if (parsed.seriesName) {
      setSeriesNameDraft(parsed.seriesName);
      filled++;
    }
    if (parsed.originTag) {
      setOriginDraft(parsed.originTag);
      filled++;
    }
    if (parsed.seriesStatus) {
      setStatusDraft(parsed.seriesStatus);
      filled++;
    }
    if (parsed.genres?.length) {
      setGenresDraft(parsed.genres.join(', '));
      filled++;
    }
    if (parsed.fansubs?.length) {
      setFansubsDraft(parsed.fansubs.join(', '));
      filled++;
    }
    if (parsed.totalChaptersExpected) {
      setTotalCapsDraft(String(parsed.totalChaptersExpected));
      filled++;
    }
    if (parsed.synopsis) {
      setSynopsisDraft(parsed.synopsis);
      filled++;
    }
    if (filled === 0) {
      showToast('No se detectaron campos (usa formato Nombre:, Tipo:, Género:, Estado:, Capítulos:, Sinopsis:)');
    } else {
      showToast(`Ficha detectada (${filled} campos listos) · Pulsa Guardar ficha`);
    }
  };

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = seriesNameDraft.trim() || series.seriesName;
    const nextKind: ContentKind = originToKind(originDraft);
    const parsedGenres = genresDraft
      .split(/[,/|·]+/)
      .map((x) => x.replace(/^#/, '').trim())
      .filter(Boolean);
    const parsedFansubs = fansubsDraft
      .split(/[,/|·]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const totalNum = totalCapsDraft.trim() ? Number(totalCapsDraft.trim()) : undefined;

    const patch: Partial<BookItem> = {
      seriesName: cleanName,
      kind: nextKind,
      originTag: originDraft,
      seriesStatus: statusDraft || undefined,
      genres: parsedGenres,
      fansubs: parsedFansubs,
      totalChaptersExpected: totalNum && Number.isFinite(totalNum) && totalNum > 0 ? Math.floor(totalNum) : undefined,
      description: synopsisDraft.trim(),
    };

    await updateSeriesBooks(
      series.allBooks.map((b) => b.id),
      patch
    );

    const nextKey = normalizeSeriesKey(cleanName);
    if (nextKey && nextKey !== series.seriesKey) {
      setActiveSeriesKey(nextKey);
    }
    setEditingMeta(false);
    showToast(`Ficha actualizada en los ${series.allBooks.length} archivos de la serie`);
  };

  const handleAiFillSeries = async () => {
    if (identifyingAi) return;
    setIdentifyingAi(true);
    try {
      const res = await identifyBookWithAI(primary.id);
      if (res) {
        const patch: Partial<BookItem> = {};
        if (res.description && !series.synopsis) {
          patch.description = res.description;
          setSynopsisDraft(res.description);
        }
        if (res.author && primary.author === 'Biblioteca Personal') {
          patch.author = res.author;
        }
        if (Object.keys(patch).length > 0) {
          await updateSeriesBooks(
            series.allBooks.map((b) => b.id),
            patch
          );
        }
      }
    } finally {
      setIdentifyingAi(false);
    }
  };

  const handleCleanDuplicates = async () => {
    if (cleaningDups || series.duplicateIds.length === 0) return;
    setCleaningDups(true);
    try {
      for (const dupId of series.duplicateIds) {
        await deleteBook(dupId);
      }
      showToast(
        `Se limpiaron ${series.duplicateIds.length} archivo${series.duplicateIds.length === 1 ? '' : 's'} duplicado${series.duplicateIds.length === 1 ? '' : 's'} de esta serie`
      );
    } finally {
      setCleaningDups(false);
    }
  };

  const formatListLabel = series.formats.map((f) => f.toUpperCase()).join(', ');
  const genresFormatted =
    series.genres.length > 0 ? series.genres.map((g) => `#${g}`).join(', ') : '';
  const chaptersCountText = series.totalChaptersExpected
    ? `${series.totalChaptersExpected} totales · ${series.availableChaptersCount} disponibles (${series.rangeLabel})`
    : `${series.availableChaptersCount} disponibles (${series.rangeLabel})`;

  return (
    <div className="modal-overlay" onClick={() => setActiveSeriesKey(null)}>
      <div className="modal-card series-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="series-modal-header">
          <div style={{ minWidth: 0 }}>
            <div className="series-modal-kicker">
              <span>{formatOriginBadge(series.originTag)}</span>
              <span>·</span>
              <span>{formatSeriesStatusBadge(series.seriesStatus)}</span>
              <span>·</span>
              <span>
                {series.chapters.length} {series.chapters.length === 1 ? 'paquete' : 'paquetes'}
              </span>
            </div>
            <h3 className="series-modal-title" title={series.seriesName}>
              {series.seriesName}
            </h3>
          </div>
          <button
            type="button"
            className="circle-arrow-btn"
            onClick={() => setActiveSeriesKey(null)}
            aria-label="Cerrar ficha de serie"
          >
            <X size={16} />
          </button>
        </div>

        {/* Hero: Cover + Structured Manga/Manhwa Card */}
        <div className="series-hero-grid">
          <div className="series-cover-col">
            <div className="book-hardcover-wrap" style={{ width: 132, paddingBottom: 12 }}>
              <div className="book-hardcover" style={{ backgroundColor: effectiveSpine }}>
                <div className="book-cover-img-box">
                  <BookCoverVisual
                    book={{
                      id: primary.id,
                      title: series.seriesName,
                      author: primary.author,
                      format: primary.format,
                      kind: series.kind,
                      coverDataUrl: primary.coverDataUrl,
                      hasOriginalCover: hasOriginal,
                    }}
                  />
                </div>
                <div className="book-pages-block" />
                <div className="book-ribbon" style={{ backgroundColor: effectiveRibbon }} />
              </div>
            </div>

            <div className="series-progress-box">
              <div className="series-progress-top">
                <span>Progreso</span>
                <strong>{series.overallProgress}%</strong>
              </div>
              <div className="goal-track" style={{ height: 6 }}>
                <div
                  className={`goal-fill ${series.overallProgress >= 98 ? 'secondary' : ''}`}
                  style={{ width: `${Math.min(100, Math.max(series.overallProgress > 0 ? 4 : 0, series.overallProgress))}%` }}
                />
              </div>
            </div>

            <div className="series-quick-icons">
              <button
                type="button"
                className={`pill-btn ${series.favorite ? 'active' : ''}`}
                style={{ height: 29, fontSize: 11, flex: 1, justifyContent: 'center' }}
                onClick={() => void handleToggleSeriesFavorite()}
                title={series.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
              >
                <Star size={12} fill={series.favorite ? 'currentColor' : 'none'} /> Fav
              </button>
              <button
                type="button"
                className={`pill-btn ${series.wishlist ? 'active' : ''}`}
                style={{ height: 29, fontSize: 11, flex: 1, justifyContent: 'center' }}
                onClick={() => void handleToggleSeriesWishlist()}
                title={series.wishlist ? 'Quitar de Por leer' : 'Guardar en Por leer'}
              >
                <BookMarked size={12} fill={series.wishlist ? 'currentColor' : 'none'} /> Leer
              </button>
            </div>
          </div>

          {/* Structured Card matching Pham's Manga/Manhwa format */}
          <div className="series-ficha-card">
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Nombre:</span>
              <span className="series-ficha-value strong">{series.seriesName}</span>
            </div>
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Tipo:</span>
              <span className="series-ficha-value">{formatOriginBadge(series.originTag)}</span>
            </div>
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Género:</span>
              <span className={`series-ficha-value ${!genresFormatted ? 'muted' : ''}`}>
                {genresFormatted || 'Sin géneros (pulsa Editar ficha o pega desde Telegram)'}
              </span>
            </div>
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Formato:</span>
              <span className="series-ficha-value">{formatListLabel}</span>
            </div>
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Fansubs:</span>
              <span className={`series-ficha-value ${series.fansubs.length === 0 ? 'muted' : ''}`}>
                {series.fansubs.length > 0 ? series.fansubs.join(', ') : 'No especificado'}
              </span>
            </div>
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Estado:</span>
              <span className="series-ficha-value">{formatSeriesStatusBadge(series.seriesStatus)}</span>
            </div>
            <div className="series-ficha-row">
              <span className="series-ficha-label">🎴 Capítulos:</span>
              <span className="series-ficha-value strong">{chaptersCountText}</span>
            </div>
            {series.missingRanges.length > 0 && (
              <div className="series-missing-pill">
                <AlertTriangle size={12} />
                <span>Capítulos faltantes detectados: {series.missingRanges.join(', ')}</span>
              </div>
            )}
            <div className="series-ficha-synopsis">
              <span className="series-ficha-label">🎴 Sinopsis:</span>
              <p className={!series.synopsis ? 'muted' : ''}>
                {series.synopsis || 'Aún sin sinopsis. Puedes completarla con IA o pegar la ficha desde Telegram.'}
              </p>
            </div>
          </div>
        </div>

        {/* Primary Action Strip */}
        <div className="series-actions-bar">
          <button
            type="button"
            className="coral-cta-btn"
            style={{ height: 36, fontSize: 12.5, padding: '0 16px' }}
            onClick={() => handleOpenChapter(series.continueBook)}
          >
            {hasStarted ? <Play size={14} /> : <BookOpen size={14} />}
            {hasStarted
              ? `Continuar · ${continueEntry?.label || series.continueBook.title}`
              : `Empezar · ${continueEntry?.label || series.continueBook.title}`}
          </button>

          <button
            type="button"
            className={`pill-btn ${editingMeta ? 'active' : ''}`}
            style={{ height: 34, fontSize: 11.5 }}
            onClick={() => setEditingMeta((v) => !v)}
          >
            <Edit3 size={13} /> {editingMeta ? 'Cerrar editor' : 'Editar ficha / Pegar de Telegram'}
          </button>

          {!series.synopsis && (
            <button
              type="button"
              className="pill-btn"
              style={{ height: 34, fontSize: 11.5 }}
              disabled={identifyingAi}
              onClick={() => void handleAiFillSeries()}
            >
              <Sparkles size={13} className={identifyingAi ? 'spin' : ''} />
              {identifyingAi ? 'Analizando...' : 'Completar sinopsis con IA'}
            </button>
          )}

          {series.duplicateIds.length > 0 && (
            <button
              type="button"
              className="pill-btn"
              style={{ height: 34, fontSize: 11.5, color: '#c84b4e', borderColor: 'rgba(200,75,78,0.4)' }}
              disabled={cleaningDups}
              onClick={() => void handleCleanDuplicates()}
            >
              <Trash2 size={13} />
              {cleaningDups
                ? 'Limpiando...'
                : `Limpiar ${series.duplicateIds.length} duplicado${series.duplicateIds.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>

        {/* Collapsible Series Metadata Editor + Telegram 1-Click Parser */}
        {editingMeta && (
          <form className="series-editor-box" onSubmit={handleSaveMetadata}>
            <div className="series-telegram-paste">
              <label style={{ fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ClipboardPaste size={13} /> Pegar ficha desde Telegram / canal (auto-relleno en 1 toque)
              </label>
              <textarea
                className="studio-input"
                rows={3}
                value={telegramPaste}
                onChange={(e) => setTelegramPaste(e.target.value)}
                placeholder={'🎴𒆜𝐍𝐨𝐦𝐛𝐫𝐞: El Mejor Ingeniero Del Mundo\n🎴𒆜𝐓𝐢𝐩𝐨: #Manhwa 🇰🇷\n🎴𒆜𝐆𝐞𝐧𝐞𝐫𝐨: #Acción, #Aventura, #Comedia\n🎴𒆜𝐅𝐚𝐧𝐬𝐮𝐛𝐬: Meian Scans, Olympus Scan\n🎴𒆜𝐄𝐬𝐭𝐚𝐝𝐨: #Finalizado\n🎴𒆜𝐂𝐚𝐩𝐢𝐭𝐮𝐥𝐨𝐬: 210\n🎴𒆜𝐒𝐢𝐧𝐨𝐩𝐬𝐢𝐬: ...'}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="pill-btn active"
                  style={{ height: 29, fontSize: 11 }}
                  onClick={handleApplyTelegramCard}
                >
                  <Sparkles size={12} /> Rellenar campos automáticamente
                </button>
              </div>
            </div>

            <div className="series-editor-grid">
              <div>
                <label className="series-field-label">Nombre de la serie</label>
                <input
                  className="studio-input"
                  value={seriesNameDraft}
                  onChange={(e) => setSeriesNameDraft(e.target.value)}
                />
              </div>
              <div>
                <label className="series-field-label">Tipo</label>
                <select
                  className="studio-input"
                  value={originDraft}
                  onChange={(e) => setOriginDraft(e.target.value as OriginTag)}
                >
                  <option value="manhwa">#Manhwa 🇰🇷</option>
                  <option value="manga">#Manga 🇯🇵</option>
                  <option value="manhua">#Manhua 🇨🇳</option>
                  <option value="comic">#Cómic</option>
                </select>
              </div>
              <div>
                <label className="series-field-label">Estado</label>
                <select
                  className="studio-input"
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as SeriesStatus | '')}
                >
                  <option value="">En Biblioteca</option>
                  <option value="ongoing">#En Emisión</option>
                  <option value="completed">#Finalizado</option>
                  <option value="hiatus">#En Pausa</option>
                  <option value="cancelled">#Cancelado</option>
                </select>
              </div>
              <div>
                <label className="series-field-label">Capítulos totales</label>
                <input
                  type="number"
                  min={1}
                  className="studio-input"
                  value={totalCapsDraft}
                  onChange={(e) => setTotalCapsDraft(e.target.value)}
                  placeholder="Ej. 210"
                />
              </div>
              <div>
                <label className="series-field-label">Géneros (separados por coma)</label>
                <input
                  className="studio-input"
                  value={genresDraft}
                  onChange={(e) => setGenresDraft(e.target.value)}
                  placeholder="Acción, Aventura, Comedia"
                />
              </div>
              <div>
                <label className="series-field-label">Fansubs (separados por coma)</label>
                <input
                  className="studio-input"
                  value={fansubsDraft}
                  onChange={(e) => setFansubsDraft(e.target.value)}
                  placeholder="Meian Scans, Olympus Scan"
                />
              </div>
            </div>

            <div>
              <label className="series-field-label">Sinopsis</label>
              <textarea
                className="studio-input"
                rows={3}
                value={synopsisDraft}
                onChange={(e) => setSynopsisDraft(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="pill-btn" onClick={() => setEditingMeta(false)}>
                Cancelar
              </button>
              <button type="submit" className="coral-cta-btn" style={{ height: 34, fontSize: 12 }}>
                Guardar ficha en toda la serie
              </button>
            </div>
          </form>
        )}

        {/* Ordered Deduplicated Chapter Packs List */}
        <div className="series-chapters-section">
          <div className="series-chapters-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Capítulos disponibles</span>
              <span className="section-count">{series.chapters.length}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>
                {series.rangeLabel} · sin duplicados
              </span>
            </div>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 28, fontSize: 11 }}
              onClick={() => setDescOrder((v) => !v)}
              title="Cambiar orden de capítulos"
            >
              {descOrder ? <ArrowUp10 size={13} /> : <ArrowDown01 size={13} />}
              {descOrder ? 'Recientes primero' : 'Orden 0 → fin'}
            </button>
          </div>

          <div className="series-chapters-list">
            {orderedChapters.map((entry) => {
              const b = entry.book;
              const pct = Math.round(b.progress || 0);
              const isDone = pct >= 98 || b.readingStatus === 'completed';
              const isContinue = b.id === series.continueBook.id;

              return (
                <div
                  key={b.id}
                  className={`series-chapter-row ${isContinue ? 'is-continue' : ''} ${isDone ? 'is-done' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenChapter(b)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenChapter(b);
                    }
                  }}
                >
                  <div className="series-chapter-main">
                    <div className="series-chapter-top">
                      <span className="series-chapter-label">{entry.label}</span>
                      {isContinue && !isDone && (
                        <span className="series-chapter-tag current">Siguiente</span>
                      )}
                      {isDone && (
                        <span className="series-chapter-tag done">
                          <CheckCircle2 size={10} /> Leído
                        </span>
                      )}
                      <span className="book-list-fmt">{b.format.toUpperCase()}</span>
                      {!b.hasLocalFile && (
                        <span
                          className="series-chapter-tag cloud"
                          title="En la nube — toca para descargar"
                        >
                          <Cloud size={10} /> Nube
                        </span>
                      )}
                      {entry.duplicateBooks.length > 0 && (
                        <span className="series-chapter-tag dup">
                          +{entry.duplicateBooks.length} dup. oculto{entry.duplicateBooks.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <div className="series-chapter-sub" title={b.fileName || b.title}>
                      {b.fileName || b.title}
                      {b.pageCount ? ` · ${b.pageCount} págs.` : ''}
                    </div>
                  </div>

                  <div className="series-chapter-right">
                    <div className="series-chapter-pct-wrap">
                      <div className="goal-track" style={{ height: 5, width: 54 }}>
                        <div
                          className={`goal-fill ${isDone ? 'secondary' : ''}`}
                          style={{ width: `${Math.min(100, Math.max(pct > 0 ? 5 : 0, pct))}%` }}
                        />
                      </div>
                      <span className="book-time-pct">{pct}%</span>
                    </div>

                    <div
                      className="series-chapter-btns"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="circle-arrow-btn"
                        style={{ width: 28, height: 28 }}
                        title="Editar este paquete/capítulo"
                        onClick={() => setEditingBook(b)}
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        type="button"
                        className="circle-arrow-btn"
                        style={{ width: 28, height: 28, color: '#c84b4e' }}
                        title="Eliminar este paquete"
                        onClick={() => void deleteBook(b.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
