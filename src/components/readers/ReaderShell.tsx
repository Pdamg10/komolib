import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  List,
  Settings2,
  StickyNote,
  Sun,
  X,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { dbGetBookFile } from '../../db/localDb';
import type { ComicReadMode, ReaderSettings } from '../../types/library';
import { ComicMangaReader } from './ComicMangaReader';
import { EpubReader } from './EpubReader';
import { PdfReader } from './PdfReader';
import { READER_PALETTES } from './readerThemes';
import { TextRichReader } from './TextRichReader';

export const ReaderShell: React.FC = () => {
  const {
    activeBook,
    closeReader,
    readerSettings,
    updateReaderSettings,
    updateBook,
    addBookmark,
    addNote,
  } = useLibrary();

  const [fileData, setFileData] = useState<{ blob: Blob; extraImages?: Blob[] } | null>(null);
  const [toc, setToc] = useState<Array<{ id: string; title: string; href: string }>>([]);
  const [jumpHref, setJumpHref] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'none' | 'settings' | 'toc' | 'note'>('none');
  const [quickNote, setQuickNote] = useState('');
  const [livePos, setLivePos] = useState<{ page?: number; cfi?: string; scrollRatio?: number; pct: number }>({
    pct: 0,
  });

  useEffect(() => {
    if (!activeBook) {
      setFileData(null);
      setToc([]);
      setDrawer('none');
      return;
    }
    setLivePos({
      page: activeBook.currentPage,
      cfi: activeBook.currentCfi,
      scrollRatio: activeBook.scrollRatio,
      pct: activeBook.progress || 0,
    });
    dbGetBookFile(activeBook.id).then((rec) => {
      if (rec) setFileData({ blob: rec.blob, extraImages: rec.extraImages });
    });
  }, [activeBook?.id]);

  if (!activeBook) return null;

  const pal = READER_PALETTES[readerSettings.theme];
  const isComicLike =
    activeBook.format === 'cbz' ||
    activeBook.format === 'cbr' ||
    activeBook.format === 'images';
  const isPdf = activeBook.format === 'pdf';
  const isEpub = activeBook.format === 'epub';

  const handleSaveBookmark = async () => {
    await addBookmark({
      bookId: activeBook.id,
      label: livePos.page
        ? `Página ${livePos.page} (${livePos.pct}%)`
        : `Posición ${livePos.pct}%`,
      page: livePos.page,
      cfi: livePos.cfi,
      scrollRatio: livePos.scrollRatio,
    });
  };

  const handleSaveQuickNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNote.trim()) return;
    await addNote({
      bookId: activeBook.id,
      text: quickNote.trim(),
      page: livePos.page,
      color: '#f5b855',
    });
    setQuickNote('');
    setDrawer('none');
  };

  return (
    <div
      className="reader-overlay"
      style={{
        background: pal.bg,
        color: pal.fg,
        filter: `brightness(${readerSettings.brightness}%)`,
      }}
    >
      {/* Blue-light warmth overlay */}
      {readerSettings.warmth > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            background: `rgba(255, 175, 70, ${readerSettings.warmth / 260})`,
            zIndex: 120,
          }}
        />
      )}

      {/* Top Bar */}
      <header
        className="reader-topbar"
        style={{ background: pal.bar, borderBottom: `1px solid ${pal.border}` }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <button
            className="circle-arrow-btn"
            style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
            onClick={closeReader}
            title="Volver a la biblioteca"
          >
            <ArrowLeft size={17} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activeBook.title}
            </div>
            <div style={{ fontSize: 11, color: pal.muted, fontWeight: 600 }}>
              {activeBook.author} · {activeBook.format.toUpperCase()} · {livePos.pct}%
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {toc.length > 0 && (
            <button
              className="circle-arrow-btn"
              style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
              onClick={() => setDrawer(drawer === 'toc' ? 'none' : 'toc')}
              title="Índice de capítulos"
            >
              <List size={16} />
            </button>
          )}
          <button
            className="circle-arrow-btn"
            style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
            onClick={handleSaveBookmark}
            title="Guardar marcador aquí"
          >
            <BookmarkPlus size={16} />
          </button>
          <button
            className="circle-arrow-btn"
            style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
            onClick={() => setDrawer(drawer === 'note' ? 'none' : 'note')}
            title="Añadir nota rápida"
          >
            <StickyNote size={16} />
          </button>
          <button
            className="pill-btn"
            style={{
              background: drawer === 'settings' ? '#e86f68' : 'rgba(128,128,128,0.16)',
              color: drawer === 'settings' ? '#fff' : pal.fg,
            }}
            onClick={() => setDrawer(drawer === 'settings' ? 'none' : 'settings')}
          >
            <Settings2 size={14} /> Ajustes
          </button>
        </div>
      </header>

      {/* Main Reader Stage */}
      <main className="reader-stage">
        {!fileData ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>Cargando archivo...</div>
        ) : isComicLike ? (
          <ComicMangaReader
            book={activeBook}
            blob={fileData.blob}
            extraImages={fileData.extraImages}
            settings={readerSettings}
            onProgress={(page, total) => {
              const pct = total ? Math.round((page / total) * 100) : 0;
              setLivePos({ page, pct });
              updateBook(activeBook.id, { currentPage: page, pageCount: total, progress: pct });
            }}
          />
        ) : isPdf ? (
          <PdfReader
            book={activeBook}
            blob={fileData.blob}
            settings={readerSettings}
            onProgress={(page, total) => {
              const pct = total ? Math.round((page / total) * 100) : 0;
              setLivePos({ page, pct });
              updateBook(activeBook.id, { currentPage: page, pageCount: total, progress: pct });
            }}
          />
        ) : isEpub ? (
          <EpubReader
            book={activeBook}
            blob={fileData.blob}
            settings={readerSettings}
            onTocLoaded={setToc}
            jumpHref={jumpHref}
            onProgress={(pct, cfi) => {
              setLivePos({ cfi, pct });
              updateBook(activeBook.id, { currentCfi: cfi, progress: pct });
            }}
          />
        ) : (
          <TextRichReader
            book={activeBook}
            blob={fileData.blob}
            settings={readerSettings}
            onTocLoaded={setToc}
            jumpHref={jumpHref}
            onProgress={(pct, scrollRatio) => {
              setLivePos({ scrollRatio, pct });
              updateBook(activeBook.id, { scrollRatio, progress: pct });
            }}
          />
        )}
      </main>

      {/* Settings Drawer */}
      {drawer === 'settings' && (
        <aside
          className="reader-drawer"
          style={{ background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Personalizar Lector</strong>
            <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
              <X size={16} />
            </button>
          </div>

          {/* Reader Theme */}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Tema de lectura</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {(['cream', 'paper', 'sepia', 'dark', 'oled'] as ReaderSettings['theme'][]).map(
                (t) => (
                  <button
                    key={t}
                    onClick={() => updateReaderSettings({ theme: t })}
                    style={{
                      height: 34,
                      borderRadius: 10,
                      background: READER_PALETTES[t].bg,
                      color: READER_PALETTES[t].fg,
                      border:
                        readerSettings.theme === t
                          ? '2.5px solid #e86f68'
                          : '1px solid rgba(128,128,128,0.35)',
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'capitalize',
                    }}
                  >
                    {t}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Comic / Manga / Manhwa Specific Controls */}
          {isComicLike && (
            <>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>
                  Modo Manga / Manhwa / Cómic
                </div>
                <select
                  className="studio-input"
                  value={readerSettings.comicMode}
                  onChange={(e) =>
                    updateReaderSettings({ comicMode: e.target.value as ComicReadMode })
                  }
                >
                  <option value="manhwa-strip">Manhwa / Webtoon (Tira vertical continua)</option>
                  <option value="manga-rtl">Manga (Derecha → Izquierda, 1 pág)</option>
                  <option value="manga-rtl-double">Manga (Doble página RTL)</option>
                  <option value="comic-ltr">Cómic (Izquierda → Derecha, 1 pág)</option>
                  <option value="comic-ltr-double">Cómic (Doble página LTR)</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Ajuste de imagen</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {(['width', 'height', 'original'] as const).map((fit) => (
                    <button
                      key={fit}
                      className={`pill-btn ${readerSettings.comicFit === fit ? 'active' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => updateReaderSettings({ comicFit: fit })}
                    >
                      {fit === 'width' ? 'Ancho' : fit === 'height' ? 'Alto' : 'Original'}
                    </button>
                  ))}
                </div>
              </div>

              {readerSettings.comicMode === 'manhwa-strip' && (
                <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Separación entre paneles: {readerSettings.comicGap}px</span>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={readerSettings.comicGap}
                    onChange={(e) => updateReaderSettings({ comicGap: Number(e.target.value) })}
                  />
                </label>
              )}
            </>
          )}

          {/* Book / EPUB / Text Typography Controls */}
          {!isComicLike && !isPdf && (
            <>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Tipografía</div>
                <select
                  className="studio-input"
                  value={readerSettings.fontFamily}
                  onChange={(e) =>
                    updateReaderSettings({
                      fontFamily: e.target.value as ReaderSettings['fontFamily'],
                    })
                  }
                >
                  <option value="Lora">Lora (Editorial Serif)</option>
                  <option value="Georgia">Georgia Clásica</option>
                  <option value="Nunito">Nunito (Suave)</option>
                  <option value="Quicksand">Quicksand (Redondeada)</option>
                  <option value="Inter">Inter (Moderna)</option>
                  <option value="monospace">Monospace</option>
                </select>
              </div>

              <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Tamaño de texto: {readerSettings.fontSize}px</span>
                <input
                  type="range"
                  min={13}
                  max={30}
                  value={readerSettings.fontSize}
                  onChange={(e) => updateReaderSettings({ fontSize: Number(e.target.value) })}
                />
              </label>

              <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Interlineado: {readerSettings.lineHeight}</span>
                <input
                  type="range"
                  min={1.2}
                  max={2.4}
                  step={0.05}
                  value={readerSettings.lineHeight}
                  onChange={(e) => updateReaderSettings({ lineHeight: Number(e.target.value) })}
                />
              </label>

              <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Ancho de columna: {readerSettings.maxWidth}px</span>
                <input
                  type="range"
                  min={520}
                  max={1050}
                  step={20}
                  value={readerSettings.maxWidth}
                  onChange={(e) => updateReaderSettings({ maxWidth: Number(e.target.value) })}
                />
              </label>

              {isEpub && (
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Flujo EPUB</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      className={`pill-btn ${readerSettings.epubFlow === 'scrolled' ? 'active' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => updateReaderSettings({ epubFlow: 'scrolled' })}
                    >
                      Scroll continuo
                    </button>
                    <button
                      className={`pill-btn ${readerSettings.epubFlow === 'paginated' ? 'active' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => updateReaderSettings({ epubFlow: 'paginated' })}
                    >
                      Paginado
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Brightness & Blue Light Warmth */}
          <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Sun size={13} /> Brillo: {readerSettings.brightness}%
            </span>
            <input
              type="range"
              min={55}
              max={115}
              value={readerSettings.brightness}
              onChange={(e) => updateReaderSettings({ brightness: Number(e.target.value) })}
            />
          </label>

          <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Filtro luz cálida (noche): {readerSettings.warmth}%</span>
            <input
              type="range"
              min={0}
              max={60}
              value={readerSettings.warmth}
              onChange={(e) => updateReaderSettings({ warmth: Number(e.target.value) })}
            />
          </label>
        </aside>
      )}

      {/* TOC Drawer */}
      {drawer === 'toc' && (
        <aside
          className="reader-drawer"
          style={{ background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Índice ({toc.length})</strong>
            <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {toc.map((item, idx) => (
              <button
                key={item.id + idx}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: 'rgba(128,128,128,0.1)',
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
                onClick={() => {
                  setJumpHref(item.href);
                  setDrawer('none');
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* Quick Note Drawer */}
      {drawer === 'note' && (
        <aside
          className="reader-drawer"
          style={{ background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Nota rápida</strong>
            <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSaveQuickNote} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              className="studio-input"
              rows={5}
              placeholder="Escribe tu comentario o cita..."
              value={quickNote}
              onChange={(e) => setQuickNote(e.target.value)}
            />
            <button type="submit" className="coral-cta-btn" style={{ justifyContent: 'center' }}>
              Guardar nota
            </button>
          </form>
        </aside>
      )}
    </div>
  );
};
