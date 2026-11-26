import React, { useEffect, useRef, useState } from 'react';
import { Image, RefreshCw, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import {
  extractCoverPaletteFromDataUrl,
  optimizeCoverDataUrl,
} from '../parsers/coverGenerator';
import type { ContentKind } from '../types/library';
import {
  isVisualSeriesKind,
  type OriginTag,
  type SeriesStatus,
} from '../utils/mangaSeriesUtils';
import { formatDateTime } from '../utils/readingStats';
import { hasDisplayableOriginalCover } from '../utils/coverHelpers';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';

export const BookDetailModal: React.FC = () => {
  const {
    editingBook,
    setEditingBook,
    updateBook,
    reExtractBookCover,
    identifyBookWithAI,
    deleteBook,
    createRoomForBook,
    setNavSection,
    categories,
  } = useLibrary();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ContentKind>('book');
  const [spineColor, setSpineColor] = useState('#4c6c8a');
  const [ribbonColor, setRibbonColor] = useState('#f2ba59');
  const [coverDataUrl, setCoverDataUrl] = useState('');
  const [hasOriginalCover, setHasOriginalCover] = useState(true);
  const [cats, setCats] = useState<string[]>([]);
  const [seriesName, setSeriesName] = useState('');
  const [chapterStart, setChapterStart] = useState('');
  const [chapterEnd, setChapterEnd] = useState('');
  const [originTag, setOriginTag] = useState<OriginTag>('manhwa');
  const [seriesStatus, setSeriesStatus] = useState<SeriesStatus | ''>('');
  const [fansubsText, setFansubsText] = useState('');
  const [genresText, setGenresText] = useState('');
  const [totalCaps, setTotalCaps] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [identifyingAi, setIdentifyingAi] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingBook) return;
    setTitle(editingBook.title);
    setAuthor(editingBook.author);
    setDescription(editingBook.description || '');
    setKind(editingBook.kind);
    setSpineColor(editingBook.spineColor);
    setRibbonColor(editingBook.ribbonColor);
    setCoverDataUrl(editingBook.coverDataUrl);
    setHasOriginalCover(hasDisplayableOriginalCover(editingBook));
    setCats(editingBook.categories || []);
    setSeriesName(editingBook.seriesName || '');
    setChapterStart(editingBook.chapterStart !== undefined ? String(editingBook.chapterStart) : '');
    setChapterEnd(editingBook.chapterEnd !== undefined ? String(editingBook.chapterEnd) : '');
    setOriginTag(editingBook.originTag || (editingBook.kind === 'manga' ? 'manga' : editingBook.kind === 'comic' ? 'comic' : 'manhwa'));
    setSeriesStatus(editingBook.seriesStatus || '');
    setFansubsText((editingBook.fansubs || []).join(', '));
    setGenresText((editingBook.genres || []).join(', '));
    setTotalCaps(editingBook.totalChaptersExpected ? String(editingBook.totalChaptersExpected) : '');
  }, [editingBook]);

  if (!editingBook) return null;

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = String(reader.result || '');
      if (!raw) return;
      const optimized = await optimizeCoverDataUrl(raw);
      const pal = await extractCoverPaletteFromDataUrl(
        optimized,
        spineColor.startsWith('#') ? spineColor : '#4c6c8a',
        ribbonColor || '#f2ba59'
      );
      setCoverDataUrl(optimized);
      setHasOriginalCover(true);
      setSpineColor(pal.spineColor);
      setRibbonColor(pal.ribbonColor);
    };
    reader.readAsDataURL(file);
  };

  const handleReExtract = async () => {
    if (extracting) return;
    setExtracting(true);
    try {
      await reExtractBookCover(editingBook.id);
    } finally {
      setExtracting(false);
    }
  };

  const handleIdentifyWithAI = async () => {
    if (identifyingAi) return;
    setIdentifyingAi(true);
    try {
      const res = await identifyBookWithAI(editingBook.id);
      if (res) {
        if (res.title) setTitle(res.title);
        if (res.author) setAuthor(res.author);
        if (res.description) setDescription(res.description);
      }
    } finally {
      setIdentifyingAi(false);
    }
  };

  const toggleCat = (id: string) => {
    setCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const isVisual = isVisualSeriesKind(kind);
    const parsedStart = chapterStart.trim() !== '' ? Number(chapterStart.trim()) : undefined;
    const parsedEnd = chapterEnd.trim() !== '' ? Number(chapterEnd.trim()) : undefined;
    const parsedTotal = totalCaps.trim() !== '' ? Number(totalCaps.trim()) : undefined;
    await updateBook(editingBook.id, {
      title: title.trim() || editingBook.title,
      author: author.trim() || editingBook.author,
      description,
      kind,
      spineColor,
      ribbonColor,
      coverDataUrl,
      hasOriginalCover,
      coverCheckedV2: true,
      coverCheckedV3: true,
      categories: cats,
      ...(isVisual
        ? {
            seriesName: seriesName.trim() || undefined,
            chapterStart: parsedStart !== undefined && Number.isFinite(parsedStart) ? parsedStart : undefined,
            chapterEnd: parsedEnd !== undefined && Number.isFinite(parsedEnd) ? parsedEnd : undefined,
            seriesOrder: parsedStart !== undefined && Number.isFinite(parsedStart) ? parsedStart : editingBook.seriesOrder,
            originTag,
            seriesStatus: seriesStatus || undefined,
            fansubs: fansubsText
              .split(/[,/|·]+/)
              .map((x) => x.trim())
              .filter(Boolean),
            genres: genresText
              .split(/[,/|·]+/)
              .map((x) => x.replace(/^#/, '').trim())
              .filter(Boolean),
            totalChaptersExpected:
              parsedTotal !== undefined && Number.isFinite(parsedTotal) && parsedTotal > 0
                ? Math.floor(parsedTotal)
                : undefined,
          }
        : {}),
    });
    setEditingBook(null);
  };

  const adaptiveSeed = `${editingBook.id}:${title || editingBook.title}`;
  const previewSpine = hasOriginalCover ? spineColor : getAdaptiveSpineCss(adaptiveSeed);
  const previewRibbon = hasOriginalCover ? ribbonColor : getAdaptiveRibbonCss(adaptiveSeed);

  return (
    <div className="modal-overlay" onClick={() => setEditingBook(null)}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Personalizar Título</h3>
          <button type="button" className="circle-arrow-btn" onClick={() => setEditingBook(null)}>
            <X size={16} />
          </button>
        </div>

        <div className="book-detail-top">
          <div style={{ width: 118, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="book-hardcover-wrap" style={{ width: 118, paddingBottom: 12 }}>
              <div className="book-hardcover" style={{ backgroundColor: previewSpine }}>
                <div className="book-cover-img-box">
                  <BookCoverVisual
                    book={{
                      id: editingBook.id,
                      title: title || editingBook.title,
                      author: author || editingBook.author,
                      format: editingBook.format,
                      kind,
                      coverDataUrl,
                      hasOriginalCover,
                    }}
                  />
                </div>
                <div className="book-pages-block" />
                <div className="book-ribbon" style={{ backgroundColor: previewRibbon }} />
              </div>
            </div>

            <button
              type="button"
              className="pill-btn"
              style={{ justifyContent: 'center', fontSize: 11, height: 29 }}
              onClick={() => coverRef.current?.click()}
            >
              <Image size={12} /> Subir portada
            </button>
            <button
              type="button"
              className="pill-btn"
              style={{ justifyContent: 'center', fontSize: 10.5, height: 28 }}
              onClick={handleReExtract}
              disabled={extracting}
              title="Extraer la portada original desde el archivo del libro"
            >
              <RefreshCw size={11} className={extracting ? 'spin' : ''} /> Original
            </button>
            <button
              type="button"
              className={`pill-btn ${!hasOriginalCover ? 'active' : ''}`}
              style={{ justifyContent: 'center', fontSize: 10.5, height: 28 }}
              onClick={() => setHasOriginalCover(false)}
              title="Usar portada adaptable al tema actual"
            >
              <Sparkles size={11} /> Adaptable
            </button>
            <input ref={coverRef} type="file" accept="image/*" hidden onChange={handleCoverUpload} />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700 }}>Título</label>
              <input className="studio-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700 }}>Autor</label>
              <input className="studio-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <button
              type="button"
              className="pill-btn"
              disabled={identifyingAi}
              onClick={() => void handleIdentifyWithAI()}
              style={{
                height: 31,
                fontSize: 11.5,
                justifyContent: 'center',
                background: 'color-mix(in srgb, var(--accent-secondary) 16%, var(--banner-bg))',
                borderColor: 'color-mix(in srgb, var(--accent-secondary) 42%, var(--border-subtle))',
                color: 'var(--text-primary)',
              }}
              title="Usa IA para leer la portada y las primeras páginas del libro y completar título, autor y sinopsis"
            >
              <Sparkles size={13} className={identifyingAi ? 'spin' : ''} />
              {identifyingAi ? 'Analizando portada y texto con IA...' : 'Detectar título, autor y sinopsis con IA'}
            </button>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700 }}>Modo / Tipo</label>
              <select
                className="studio-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as ContentKind)}
              >
                <option value="book">Libro / eBook</option>
                <option value="manga">Manga (RTL)</option>
                <option value="manhwa">Manhwa / Webtoon (Vertical)</option>
                <option value="comic">Cómic (LTR)</option>
                <option value="audiobook">Audiolibro</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <label className="color-row" style={{ gap: 8 }}>
                <span>Color lomo</span>
                <input
                  type="color"
                  value={spineColor.startsWith('#') ? spineColor : '#4c6c8a'}
                  onChange={(e) => setSpineColor(e.target.value)}
                />
              </label>
              <label className="color-row" style={{ gap: 8 }}>
                <span>Cinta</span>
                <input
                  type="color"
                  value={ribbonColor.startsWith('#') ? ribbonColor : '#f2ba59'}
                  onChange={(e) => setRibbonColor(e.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Reading progress & exact timestamps */}
        <div
          style={{
            background: 'var(--banner-bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontWeight: 800 }}>
            <span>Progreso de lectura</span>
            <span style={{ color: 'var(--accent-primary)' }}>{Math.round(editingBook.progress || 0)}%</span>
          </div>
          <div className="goal-track" style={{ height: 7 }}>
            <div
              className={`goal-fill ${(editingBook.progress || 0) >= 98 ? 'secondary' : ''}`}
              style={{ width: `${Math.min(100, Math.max(0, Math.round(editingBook.progress || 0)))}%` }}
            />
          </div>
          <div className="review-meta-grid" style={{ marginTop: 2 }}>
            <span>
              <strong>Última lectura:</strong> {formatDateTime(editingBook.lastReadAt)}
            </span>
            <span>
              <strong>Inicio:</strong> {formatDateTime(editingBook.startedAt)}
            </span>
            <span>
              <strong>Cap. terminado:</strong>{' '}
              {editingBook.lastChapterFinishedAt
                ? `${editingBook.lastChapterFinishedTitle ? `${editingBook.lastChapterFinishedTitle} · ` : ''}${formatDateTime(editingBook.lastChapterFinishedAt)}`
                : '—'}
            </span>
            <span>
              <strong>Libro terminado:</strong> {formatDateTime(editingBook.finishedAt)}
            </span>
          </div>
        </div>

        {isVisualSeriesKind(kind) && (
          <div className="series-editor-box">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--accent-primary)' }}>
              🎴 Datos de Serie y Capítulos (solo Manga / Manhwa / Cómic)
            </div>
            <div className="series-editor-grid">
              <div>
                <label className="series-field-label">Nombre de serie</label>
                <input
                  className="studio-input"
                  value={seriesName}
                  onChange={(e) => setSeriesName(e.target.value)}
                  placeholder="Ej. El Mejor Ingeniero Del Mundo"
                />
              </div>
              <div>
                <label className="series-field-label">Tipo</label>
                <select
                  className="studio-input"
                  value={originTag}
                  onChange={(e) => setOriginTag(e.target.value as OriginTag)}
                >
                  <option value="manhwa">#Manhwa 🇰🇷</option>
                  <option value="manga">#Manga 🇯🇵</option>
                  <option value="manhua">#Manhua 🇨🇳</option>
                  <option value="comic">#Cómic</option>
                </select>
              </div>
              <div>
                <label className="series-field-label">Cap. inicio (este archivo)</label>
                <input
                  type="number"
                  step="any"
                  className="studio-input"
                  value={chapterStart}
                  onChange={(e) => setChapterStart(e.target.value)}
                  placeholder="Ej. 0"
                />
              </div>
              <div>
                <label className="series-field-label">Cap. fin (este archivo)</label>
                <input
                  type="number"
                  step="any"
                  className="studio-input"
                  value={chapterEnd}
                  onChange={(e) => setChapterEnd(e.target.value)}
                  placeholder="Ej. 10"
                />
              </div>
              <div>
                <label className="series-field-label">Estado de serie</label>
                <select
                  className="studio-input"
                  value={seriesStatus}
                  onChange={(e) => setSeriesStatus(e.target.value as SeriesStatus | '')}
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
                  value={totalCaps}
                  onChange={(e) => setTotalCaps(e.target.value)}
                  placeholder="Ej. 210"
                />
              </div>
              <div>
                <label className="series-field-label">Géneros (coma)</label>
                <input
                  className="studio-input"
                  value={genresText}
                  onChange={(e) => setGenresText(e.target.value)}
                  placeholder="Acción, Aventura, Comedia"
                />
              </div>
              <div>
                <label className="series-field-label">Fansubs (coma)</label>
                <input
                  className="studio-input"
                  value={fansubsText}
                  onChange={(e) => setFansubsText(e.target.value)}
                  placeholder="Meian Scans, Olympus Scan"
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
            Sinopsis / Notas
          </label>
          <textarea
            className="studio-input"
            rows={6}
            style={{ minHeight: 124, lineHeight: 1.55, resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            Categorías
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories
              .filter((c) => c.id !== 'all')
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`pill-btn ${cats.includes(c.id) ? 'active' : ''}`}
                  style={{ height: 28, fontSize: 11 }}
                  onClick={() => toggleCat(c.id)}
                >
                  {c.label}
                </button>
              ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="pill-btn"
              style={{ color: '#c84b4e' }}
              onClick={() => deleteBook(editingBook.id)}
            >
              <Trash2 size={14} /> Eliminar
            </button>
            <button
              type="button"
              className="pill-btn"
              onClick={async () => {
                const room = await createRoomForBook(editingBook);
                if (room) {
                  setEditingBook(null);
                  setNavSection('shared');
                }
              }}
            >
              <Share2 size={13} /> Compartir lectura
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="pill-btn" onClick={() => setEditingBook(null)}>
              Cancelar
            </button>
            <button type="submit" className="coral-cta-btn">
              Guardar cambios
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
