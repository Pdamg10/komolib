import React, { useEffect, useRef, useState } from 'react';
import { Image, RefreshCw, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import {
  extractCoverPaletteFromDataUrl,
  optimizeCoverDataUrl,
} from '../parsers/coverGenerator';
import type { ContentKind } from '../types/library';
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
  const [extracting, setExtracting] = useState(false);
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

  const toggleCat = (id: string) => {
    setCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
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

        <div>
          <label style={{ fontSize: 11, fontWeight: 700 }}>Sinopsis / Notas</label>
          <textarea
            className="studio-input"
            rows={2}
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
