import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  HardDrive,
  Highlighter,
  ImagePlus,
  Palette,
  PenTool,
  Plus,
  Search,
  Smile,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { STICKER_GROUPS, TOOL_META, type ReadingStickerItem } from '../data/bookmarksCatalog';
import { dbEstimateLocalMetadataBytes } from '../db/localDb';
import type { AnnotationTool, BookAnnotation, BookmarkItem } from '../types/library';
import { BookCoverVisual } from './BookCoverVisual';

const TOOL_LIST: AnnotationTool[] = [
  'highlighter',
  'pencil',
  'pen',
  'postit',
  'sticker',
  'emoji',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AnnotationsView: React.FC = () => {
  const {
    books,
    bookmarks,
    annotations,
    allBookmarkDesigns,
    addCustomBookmarkDesign,
    deleteCustomBookmarkDesign,
    customStationery,
    addCustomSwatch,
    deleteCustomSwatch,
    addCustomSticker,
    deleteCustomSticker,
    addCustomEmoji,
    deleteCustomEmoji,
    deleteAnnotation,
    deleteBookmark,
    openBookAt,
  } = useLibrary();

  const [selectedBookId, setSelectedBookId] = useState<string>('all');
  const [toolFilter, setToolFilter] = useState<AnnotationTool | 'all'>('all');
  const [query, setQuery] = useState('');
  const [customBmName, setCustomBmName] = useState('');
  const [showSeparadoresExpanded, setShowSeparadoresExpanded] = useState(false);
  const [showKitBuilder, setShowKitBuilder] = useState(false);
  const [kitTab, setKitTab] = useState<AnnotationTool>('highlighter');
  const [kitColor, setKitColor] = useState('#ff8fa3');
  const [kitName, setKitName] = useState('');
  const [kitMeaning, setKitMeaning] = useState('');
  const [kitEmoji, setKitEmoji] = useState('🌟');
  const [kitStickerGroup, setKitStickerGroup] = useState<ReadingStickerItem['group']>('emociones');
  const [metaBytes, setMetaBytes] = useState<number>(0);

  // Compact & Desglosable (expandable) state for books & individual items
  const [expandedBookGroups, setExpandedBookGroups] = useState<Record<string, boolean>>({});
  const [expandedAnnIds, setExpandedAnnIds] = useState<Record<string, boolean>>({});
  const [expandedBmGroups, setExpandedBmGroups] = useState<Record<string, boolean>>({});
  const [expandedBmIds, setExpandedBmIds] = useState<Record<string, boolean>>({});
  const [expandAllAnns, setExpandAllAnns] = useState(false);
  const [expandAllBms, setExpandAllBms] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dbEstimateLocalMetadataBytes()
      .then(setMetaBytes)
      .catch(() => undefined);
  }, [books.length, bookmarks.length, annotations.length, allBookmarkDesigns.length]);

  const booksMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const filteredAnnotations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return annotations.filter((a) => {
      if (selectedBookId !== 'all' && a.bookId !== selectedBookId) return false;
      if (toolFilter !== 'all' && a.tool !== toolFilter) return false;
      if (q) {
        const b = booksMap.get(a.bookId);
        const hay = `${a.quote} ${a.note || ''} ${a.chapter || ''} ${a.sticker || ''} ${b?.title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [annotations, selectedBookId, toolFilter, query, booksMap]);

  const groupedAnnotations = useMemo(() => {
    const map = new Map<string, BookAnnotation[]>();
    for (const ann of filteredAnnotations) {
      const list = map.get(ann.bookId) || [];
      list.push(ann);
      map.set(ann.bookId, list);
    }
    return Array.from(map.entries()).map(([bookId, items]) => ({
      bookId,
      book: booksMap.get(bookId),
      items,
      colors: Array.from(new Set(items.map((i) => i.color))).slice(0, 6),
    }));
  }, [filteredAnnotations, booksMap]);

  const filteredBookmarks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookmarks.filter((bm) => {
      if (selectedBookId !== 'all' && bm.bookId !== selectedBookId) return false;
      if (q) {
        const b = booksMap.get(bm.bookId);
        const hay = `${bm.label} ${bm.chapter || ''} ${bm.excerpt || ''} ${b?.title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bookmarks, selectedBookId, query, booksMap]);

  const groupedBookmarks = useMemo(() => {
    const map = new Map<string, BookmarkItem[]>();
    for (const bm of filteredBookmarks) {
      const list = map.get(bm.bookId) || [];
      list.push(bm);
      map.set(bm.bookId, list);
    }
    return Array.from(map.entries()).map(([bookId, items]) => ({
      bookId,
      book: booksMap.get(bookId),
      items,
    }));
  }, [filteredBookmarks, booksMap]);

  const renderToolIcon = (tool: AnnotationTool, size = 13) => {
    switch (tool) {
      case 'highlighter':
        return <Highlighter size={size} />;
      case 'pencil':
        return <Edit3 size={size} />;
      case 'pen':
        return <PenTool size={size} />;
      case 'postit':
        return <StickyNote size={size} />;
      case 'sticker':
        return <Sparkles size={size} />;
      case 'emoji':
        return <Smile size={size} />;
    }
  };

  const handleUploadBookmark = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await addCustomBookmarkDesign(customBmName, file);
    setCustomBmName('');
    e.target.value = '';
  };

  return (
    <section className="tracker-page" aria-label="Marcadores, Separadores y Anotaciones">
      {/* Compact Header */}
      <div className="tracker-header-card">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="tracker-kicker">Cuaderno de Lectura Local</span>
          <h2 className="tracker-heading">Marcadores, Separadores y Anotaciones</h2>
          <p className="tracker-quote">
            Vista compacta organizada por libro. Pulsa cualquier libro o marca para desglosar sus detalles, notas y ubicación exacta.
          </p>
        </div>

        <div className="tracker-header-actions">
          <span className="pill-btn" style={{ background: 'var(--card-bg)' }}>
            <HardDrive size={13} /> Almacenamiento local: {formatBytes(metaBytes)}
          </span>
        </div>
      </div>

      {/* Collapsible Separadores Gallery Card */}
      <div className="tracker-card">
        <div className="tracker-card-head">
          <button
            type="button"
            className="compact-section-toggle"
            onClick={() => setShowSeparadoresExpanded((v) => !v)}
          >
            {showSeparadoresExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Bookmark size={15} />
            <span>Colección de Separadores de Libro</span>
          </button>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 30, fontSize: 11 }}
              onClick={() => setShowSeparadoresExpanded((v) => !v)}
            >
              {showSeparadoresExpanded ? 'Compactar' : 'Desglosar'}
            </button>
            {showSeparadoresExpanded && (
              <input
                className="studio-input"
                style={{ width: 165, height: 30, padding: '4px 10px' }}
                placeholder="Nombre del separador..."
                value={customBmName}
                onChange={(e) => setCustomBmName(e.target.value)}
              />
            )}
            <button
              type="button"
              className="coral-cta-btn"
              style={{ height: 30, padding: '0 12px', fontSize: 11.5 }}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={13} /> Agregar separador
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleUploadBookmark}
            />
          </div>
        </div>

        {showSeparadoresExpanded ? (
          <div className="bookmark-gallery-strip">
            {allBookmarkDesigns.map((design) => (
              <div key={design.id} className="bookmark-gallery-item">
                <div className="bookmark-design-thumb" style={{ height: 174 }}>
                  <img src={design.imageUrl} alt={design.name} loading="lazy" />
                  {!design.builtin && (
                    <button
                      type="button"
                      className="bookmark-design-del"
                      onClick={() => deleteCustomBookmarkDesign(design.id)}
                      title="Eliminar separador personalizado"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                <span className="bookmark-design-name">{design.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="compact-separadores-strip">
            {allBookmarkDesigns.map((design) => (
              <button
                key={design.id}
                type="button"
                className="compact-sep-chip"
                onClick={() => setShowSeparadoresExpanded(true)}
                title={`${design.name} — Pulsa para desglosar`}
              >
                <img src={design.imageUrl} alt={design.name} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Custom Stationery Kit Builder (Collapsible) */}
      <div className="tracker-card">
        <div className="tracker-card-head">
          <button
            type="button"
            className="compact-section-toggle"
            onClick={() => setShowKitBuilder((v) => !v)}
          >
            {showKitBuilder ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Palette size={15} />
            <span>Mi Kit de Papelería Personalizado</span>
          </button>
          <button
            type="button"
            className={`pill-btn ${showKitBuilder ? 'active' : ''}`}
            style={{ height: 30, fontSize: 11.5 }}
            onClick={() => setShowKitBuilder(!showKitBuilder)}
          >
            <Plus size={13} /> {showKitBuilder ? 'Ocultar editor' : 'Agregar al kit'}
          </button>
        </div>

        {showKitBuilder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {TOOL_LIST.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`pill-btn ${kitTab === t ? 'active' : ''}`}
                  style={{ height: 28, fontSize: 11 }}
                  onClick={() => setKitTab(t)}
                >
                  {renderToolIcon(t, 12)} {TOOL_META[t].label}
                </button>
              ))}
            </div>

            {kitTab === 'sticker' ? (
              <div className="custom-stationery-inline">
                <input
                  className="studio-input"
                  style={{ width: 58, textAlign: 'center' }}
                  placeholder="🌟"
                  value={kitEmoji}
                  onChange={(e) => setKitEmoji(e.target.value)}
                />
                <input
                  className="studio-input"
                  style={{ flex: 1, minWidth: 130 }}
                  placeholder="Nombre del sticker (ej. Escena épica)"
                  value={kitName}
                  onChange={(e) => setKitName(e.target.value)}
                />
                <select
                  className="studio-input"
                  style={{ width: 150 }}
                  value={kitStickerGroup}
                  onChange={(e) => setKitStickerGroup(e.target.value as ReadingStickerItem['group'])}
                >
                  {STICKER_GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  value={kitColor}
                  onChange={(e) => setKitColor(e.target.value)}
                  style={{ width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }}
                />
                <button
                  type="button"
                  className="coral-cta-btn"
                  style={{ height: 34, padding: '0 14px', fontSize: 11.5 }}
                  onClick={() => {
                    if (!kitName.trim()) return;
                    addCustomSticker({
                      emoji: kitEmoji || '✨',
                      label: kitName.trim(),
                      color: kitColor,
                      group: kitStickerGroup,
                    });
                    setKitName('');
                  }}
                >
                  <Plus size={13} /> Agregar
                </button>
              </div>
            ) : kitTab === 'emoji' ? (
              <div className="custom-stationery-inline">
                <input
                  className="studio-input"
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder="Escribe o pega tu emoji favorito (ej. 🦊, 🥀, 🧿)"
                  value={kitEmoji}
                  onChange={(e) => setKitEmoji(e.target.value)}
                />
                <button
                  type="button"
                  className="coral-cta-btn"
                  style={{ height: 34, padding: '0 14px', fontSize: 11.5 }}
                  onClick={() => {
                    if (!kitEmoji.trim()) return;
                    addCustomEmoji(kitEmoji.trim());
                  }}
                >
                  <Plus size={13} /> Agregar emoji
                </button>
              </div>
            ) : (
              <div className="custom-stationery-inline">
                <input
                  type="color"
                  value={kitColor}
                  onChange={(e) => setKitColor(e.target.value)}
                  style={{ width: 34, height: 34, border: 'none', background: 'transparent', cursor: 'pointer' }}
                />
                <input
                  className="studio-input"
                  style={{ flex: 1, minWidth: 130 }}
                  placeholder={`Nombre del ${TOOL_META[kitTab].short.toLowerCase()} (ej. Pastel Coral)`}
                  value={kitName}
                  onChange={(e) => setKitName(e.target.value)}
                />
                <input
                  className="studio-input"
                  style={{ flex: 1, minWidth: 130 }}
                  placeholder="Significado en tus libros (ej. Frases que me hacen llorar)"
                  value={kitMeaning}
                  onChange={(e) => setKitMeaning(e.target.value)}
                />
                <button
                  type="button"
                  className="coral-cta-btn"
                  style={{ height: 34, padding: '0 14px', fontSize: 11.5 }}
                  onClick={() => {
                    addCustomSwatch({
                      tool: kitTab as 'highlighter' | 'pencil' | 'pen' | 'postit',
                      color: kitColor,
                      name: kitName.trim() || `${TOOL_META[kitTab].short} personalizado`,
                      meaning: kitMeaning.trim() || 'Personalizado',
                    });
                    setKitName('');
                    setKitMeaning('');
                  }}
                >
                  <Plus size={13} /> Agregar
                </button>
              </div>
            )}

            {/* List user's custom added items for current tab */}
            {kitTab === 'sticker' ? (
              customStationery.stickers.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {customStationery.stickers.map((st) => (
                    <span
                      key={st.id}
                      className="pill-btn"
                      style={{ background: st.color, color: '#fff', borderColor: 'transparent', height: 27, fontSize: 11 }}
                    >
                      {st.emoji} {st.label}
                      <button
                        type="button"
                        onClick={() => deleteCustomSticker(st.id)}
                        style={{ color: '#fff', marginLeft: 4, display: 'inline-grid', placeItems: 'center' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )
            ) : kitTab === 'emoji' ? (
              customStationery.emojis.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {customStationery.emojis.map((em) => (
                    <span key={em} className="pill-btn" style={{ height: 28, fontSize: 14 }}>
                      {em}
                      <button
                        type="button"
                        onClick={() => deleteCustomEmoji(em)}
                        style={{ color: 'var(--text-muted)', marginLeft: 4 }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )
            ) : (
              customStationery.swatches.filter((s) => s.tool === kitTab).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {customStationery.swatches
                    .filter((s) => s.tool === kitTab)
                    .map((sw) => (
                      <span key={sw.id} className="pill-btn" style={{ height: 28, fontSize: 11 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: kitTab === 'postit' ? 3 : '50%',
                            background: sw.color,
                            border: '1px solid rgba(0,0,0,0.2)',
                          }}
                        />
                        {sw.name} ({sw.meaning})
                        <button
                          type="button"
                          onClick={() => deleteCustomSwatch(sw.id)}
                          style={{ color: 'var(--text-muted)', marginLeft: 3 }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Compact Filters Bar */}
      <div className="tracker-card">
        <div className="annotations-filter-row">
          <select
            className="studio-input"
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
          >
            <option value="all">Todos los libros</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>

          <div style={{ position: 'relative', minWidth: 0 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              className="studio-input"
              style={{ paddingLeft: 32 }}
              placeholder="Buscar citas, post-its, capítulos o stickers..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`pill-btn ${toolFilter === 'all' ? 'active' : ''}`}
            style={{ height: 28, fontSize: 11 }}
            onClick={() => setToolFilter('all')}
          >
            Todas
          </button>
          {TOOL_LIST.map((tool) => (
            <button
              key={tool}
              type="button"
              className={`pill-btn ${toolFilter === tool ? 'active' : ''}`}
              style={{ height: 28, fontSize: 11 }}
              onClick={() => setToolFilter(tool)}
            >
              {renderToolIcon(tool, 12)} {TOOL_META[tool].short}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: Compact & Desglosable Annotations + Bookmarks */}
      <div className="annotations-page-grid">
        {/* Annotations Column (Grouped by Book, Compact by Default) */}
        <div className="tracker-card">
          <div className="tracker-card-head">
            <h3>
              <Highlighter size={15} /> Frases, Post-its y Stickers
            </h3>
            {groupedAnnotations.length > 0 && (
              <button
                type="button"
                className="pill-btn"
                style={{ height: 26, fontSize: 11 }}
                onClick={() => {
                  const next = !expandAllAnns;
                  setExpandAllAnns(next);
                  setExpandedBookGroups({});
                  setExpandedAnnIds({});
                }}
              >
                {expandAllAnns ? 'Vista compacta' : 'Desglosar todo'}
              </button>
            )}
          </div>

          {groupedAnnotations.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '10px 0' }}>
              Aún no hay anotaciones que coincidan con este filtro. Abre cualquier libro, selecciona una frase o palabra y márcala con resaltador, lápiz, bolígrafo, post-it, sticker o emoji.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groupedAnnotations.map(({ bookId, book, items, colors }) => {
                const groupOpen =
                  expandAllAnns ||
                  selectedBookId !== 'all' ||
                  Boolean(expandedBookGroups[bookId]);
                return (
                  <div key={bookId} className="compact-book-group">
                    <button
                      type="button"
                      className="compact-book-head"
                      onClick={() =>
                        setExpandedBookGroups((prev) => ({
                          ...prev,
                          [bookId]: !groupOpen,
                        }))
                      }
                    >
                      {groupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {book && (
                        <div className="log-mini-thumb" style={{ width: 22, height: 32 }}>
                          <BookCoverVisual book={book} compact />
                        </div>
                      )}
                      <span className="compact-book-title">{book?.title || 'Libro'}</span>
                      <span className="compact-color-dots" aria-hidden="true">
                        {colors.map((c, i) => (
                          <span key={`${c}-${i}`} style={{ background: c }} />
                        ))}
                      </span>
                      <span className="compact-expand-hint">
                        {groupOpen ? 'Ocultar' : 'Desglosar'}
                      </span>
                    </button>

                    {groupOpen && (
                      <div className="compact-book-items">
                        {items.map((ann) => {
                          const itemOpen = expandAllAnns || Boolean(expandedAnnIds[ann.id]);
                          return (
                            <div
                              key={ann.id}
                              className={`compact-mark-row ${itemOpen ? 'expanded' : ''}`}
                              style={{
                                borderLeft: `3.5px solid ${ann.color}`,
                                background:
                                  itemOpen && ann.tool === 'postit'
                                    ? `color-mix(in srgb, ${ann.color} 20%, var(--banner-bg))`
                                    : 'var(--banner-bg)',
                              }}
                            >
                              <div className="compact-mark-head">
                                <button
                                  type="button"
                                  className="compact-mark-toggle"
                                  onClick={() =>
                                    setExpandedAnnIds((prev) => ({
                                      ...prev,
                                      [ann.id]: !itemOpen,
                                    }))
                                  }
                                  title={itemOpen ? 'Compactar' : 'Desglosar marca'}
                                >
                                  {itemOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  <span className="compact-mark-icon" style={{ color: ann.color }}>
                                    {renderToolIcon(ann.tool, 12)}
                                  </span>
                                  <span className="compact-mark-snippet">
                                    {ann.sticker ? `${ann.sticker} · ` : ''}
                                    {ann.quote}
                                  </span>
                                </button>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>
                                    {ann.page ? `Pág. ${ann.page}` : `${Math.round(ann.progress)}%`}
                                  </span>
                                  {book && (
                                    <button
                                      type="button"
                                      className="pill-btn"
                                      style={{ height: 24, fontSize: 10.5, padding: '0 8px', background: 'var(--card-bg)' }}
                                      onClick={() =>
                                        openBookAt(book, {
                                          annotationId: ann.id,
                                          cfi: ann.cfi,
                                          chapterHref: ann.chapterHref,
                                          page: ann.page,
                                          scrollRatio: ann.scrollRatio,
                                          quote: ann.quote,
                                        })
                                      }
                                    >
                                      <BookOpen size={11} /> Ir
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="circle-arrow-btn"
                                    style={{ width: 24, height: 24 }}
                                    onClick={() => deleteAnnotation(ann.id)}
                                    title="Eliminar marca"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>

                              {itemOpen && (
                                <div className="compact-mark-body">
                                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>
                                    {TOOL_META[ann.tool].label}
                                    {ann.sticker ? ` · ${ann.sticker}` : ''}
                                    {ann.chapter ? ` · ${ann.chapter}` : ''}
                                    {ann.page ? ` · Pág. ${ann.page}` : ''} · {Math.round(ann.progress)}%
                                  </div>

                                  <div
                                    className={`ann-quote-preview tool-${ann.tool}${ann.styleVariant ? ` komo-variant-${ann.styleVariant}` : ''}`}
                                    style={{ '--mark-color': ann.color } as React.CSSProperties}
                                  >
                                    “{ann.quote}”
                                  </div>

                                  {ann.note && (
                                    <div style={{ fontSize: 12, lineHeight: 1.45 }}>{ann.note}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bookmarks Column (Grouped by Book, Compact & Desglosable) */}
        <div className="tracker-card">
          <div className="tracker-card-head">
            <h3>
              <Bookmark size={15} /> Marcadores de Página
            </h3>
            {groupedBookmarks.length > 0 && (
              <button
                type="button"
                className="pill-btn"
                style={{ height: 26, fontSize: 11 }}
                onClick={() => {
                  const next = !expandAllBms;
                  setExpandAllBms(next);
                  setExpandedBmGroups({});
                  setExpandedBmIds({});
                }}
              >
                {expandAllBms ? 'Vista compacta' : 'Desglosar todo'}
              </button>
            )}
          </div>

          {groupedBookmarks.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '10px 0' }}>
              Cuando coloques un separador de libro mientras lees, aparecerá aquí organizado de forma compacta.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groupedBookmarks.map(({ bookId, book, items }) => {
                const groupOpen =
                  expandAllBms ||
                  selectedBookId !== 'all' ||
                  Boolean(expandedBmGroups[bookId]);
                return (
                  <div key={bookId} className="compact-book-group">
                    <button
                      type="button"
                      className="compact-book-head"
                      onClick={() =>
                        setExpandedBmGroups((prev) => ({
                          ...prev,
                          [bookId]: !groupOpen,
                        }))
                      }
                    >
                      {groupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {book && (
                        <div className="log-mini-thumb" style={{ width: 22, height: 32 }}>
                          <BookCoverVisual book={book} compact />
                        </div>
                      )}
                      <span className="compact-book-title">{book?.title || 'Libro'}</span>
                      <span className="compact-expand-hint">
                        {groupOpen ? 'Ocultar' : 'Desglosar'}
                      </span>
                    </button>

                    {groupOpen && (
                      <div className="compact-book-items">
                        {items.map((bm) => {
                          const design =
                            allBookmarkDesigns.find((d) => d.id === bm.designId) ||
                            allBookmarkDesigns.find((d) => d.id === book?.activeBookmarkDesignId) ||
                            allBookmarkDesigns[0];
                          const itemOpen = expandAllBms || Boolean(expandedBmIds[bm.id]);
                          return (
                            <div
                              key={bm.id}
                              className={`compact-mark-row ${itemOpen ? 'expanded' : ''}`}
                              style={{ background: 'var(--banner-bg)' }}
                            >
                              <div className="compact-mark-head">
                                <button
                                  type="button"
                                  className="compact-mark-toggle"
                                  onClick={() =>
                                    setExpandedBmIds((prev) => ({
                                      ...prev,
                                      [bm.id]: !itemOpen,
                                    }))
                                  }
                                >
                                  {itemOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  {design && (
                                    <img
                                      src={design.imageUrl}
                                      alt={design.name}
                                      style={{
                                        width: 14,
                                        height: 28,
                                        objectFit: 'cover',
                                        borderRadius: 3,
                                        flexShrink: 0,
                                      }}
                                    />
                                  )}
                                  <span className="compact-mark-snippet" style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                                    {bm.label}
                                  </span>
                                </button>

                                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                  {book && (
                                    <button
                                      type="button"
                                      className="pill-btn"
                                      style={{ height: 24, fontSize: 10.5, padding: '0 8px', background: 'var(--card-bg)' }}
                                      onClick={() =>
                                        openBookAt(book, {
                                          cfi: bm.cfi,
                                          chapterHref: bm.chapterHref,
                                          page: bm.page,
                                          scrollRatio: bm.scrollRatio,
                                        })
                                      }
                                    >
                                      Ir
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="circle-arrow-btn"
                                    style={{ width: 24, height: 24 }}
                                    onClick={() => deleteBookmark(bm.id)}
                                    title="Eliminar marcador"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>

                              {itemOpen && (
                                <div
                                  className="compact-mark-body"
                                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                                >
                                  {design && (
                                    <img
                                      src={design.imageUrl}
                                      alt={design.name}
                                      style={{
                                        width: 34,
                                        height: 80,
                                        objectFit: 'cover',
                                        borderRadius: 6,
                                        flexShrink: 0,
                                        boxShadow: '0 3px 8px rgba(0,0,0,0.2)',
                                      }}
                                    />
                                  )}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800 }}>
                                      {bm.label}
                                    </div>
                                    {bm.excerpt && (
                                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                                        “{bm.excerpt}”
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
