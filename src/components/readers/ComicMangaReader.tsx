import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { extractCbrPages, extractCbzPages, type ComicPage } from '../../parsers/comicParser';
import type { BookItem, ReaderSettings } from '../../types/library';

interface ComicMangaReaderProps {
  book: BookItem;
  blob: Blob;
  extraImages?: Blob[];
  settings: ReaderSettings;
  onProgress: (page: number, total: number) => void;
}

export const ComicMangaReader: React.FC<ComicMangaReaderProps> = ({
  book,
  blob,
  extraImages,
  settings,
  onProgress,
}) => {
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(Math.max(0, (book.currentPage || 1) - 1));
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let extracted: ComicPage[] = [];
        if (book.format === 'images') {
          const list = extraImages?.length ? extraImages : [blob];
          extracted = list.map((b, i) => ({
            name: `page_${i + 1}`,
            url: URL.createObjectURL(b),
          }));
        } else if (book.format === 'cbr') {
          extracted = await extractCbrPages(blob);
        } else {
          extracted = await extractCbzPages(blob);
        }

        extracted.forEach((p) => urlsToRevoke.push(p.url));
        if (!active) {
          urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        setPages(extracted);
        if (extracted.length > 0) {
          const initial = Math.min(extracted.length - 1, Math.max(0, (book.currentPage || 1) - 1));
          setCurrentIdx(initial);
          onProgress(initial + 1, extracted.length);
        }
      } catch (err) {
        if (active) {
          setError(
            `No se pudieron extraer las páginas (${err instanceof Error ? err.message : 'archivo dañado'}).`
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [book.id]);

  const isStrip = settings.comicMode === 'manhwa-strip';
  const isRtl =
    settings.comicMode === 'manga-rtl' || settings.comicMode === 'manga-rtl-double';
  const isDouble =
    settings.comicMode === 'manga-rtl-double' || settings.comicMode === 'comic-ltr-double';
  const step = isDouble ? 2 : 1;

  const goNext = () => {
    if (!pages.length) return;
    setCurrentIdx((prev) => {
      const next = Math.min(pages.length - 1, prev + step);
      onProgress(next + 1, pages.length);
      return next;
    });
  };

  const goPrev = () => {
    if (!pages.length) return;
    setCurrentIdx((prev) => {
      const next = Math.max(0, prev - step);
      onProgress(next + 1, pages.length);
      return next;
    });
  };

  useEffect(() => {
    if (isStrip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (isRtl) goPrev();
        else goNext();
      } else if (e.key === 'ArrowLeft') {
        if (isRtl) goNext();
        else goPrev();
      } else if (e.key === ' ') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStrip, isRtl, isDouble, pages.length]);

  const handleStripScroll = () => {
    const el = stripRef.current;
    if (!el || !pages.length) return;
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = el.scrollTop / maxScroll;
    const estimatedPage = Math.min(pages.length, Math.max(1, Math.round(ratio * (pages.length - 1)) + 1));
    setCurrentIdx(estimatedPage - 1);
    onProgress(estimatedPage, pages.length);
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
          <Loader2 size={22} className="spin" /> Descomprimiendo páginas...
        </div>
      </div>
    );
  }

  if (error || pages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 420 }}>
          <h3>No se encontraron imágenes</h3>
          <p style={{ opacity: 0.75 }}>{error || 'Este archivo no contiene páginas de imagen válidas.'}</p>
        </div>
      </div>
    );
  }

  // Manhwa / Webtoon Seamless Vertical Strip Mode
  if (isStrip) {
    return (
      <div
        ref={stripRef}
        onScroll={handleStripScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: `${settings.comicGap}px`,
          padding: settings.comicGap > 0 ? '14px 8px 60px' : '0 0 60px',
        }}
      >
        {pages.map((p, idx) => (
          <img
            key={p.name + idx}
            src={p.url}
            alt={`Página ${idx + 1}`}
            loading="lazy"
            style={{
              display: 'block',
              width: settings.comicFit === 'width' ? `min(100%, ${settings.maxWidth + 140}px)` : 'auto',
              maxWidth: '100%',
              maxHeight: settings.comicFit === 'height' ? '92vh' : 'none',
              objectFit: 'contain',
            }}
          />
        ))}
      </div>
    );
  }

  // Paged Manga (RTL) / Comic (LTR) — Single or Double Spread
  const visiblePages = isDouble
    ? [pages[currentIdx], pages[currentIdx + 1]].filter(Boolean)
    : [pages[currentIdx]];
  const orderedSpread = isRtl && visiblePages.length === 2 ? [visiblePages[1], visiblePages[0]] : visiblePages;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '10px 48px',
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickLeft = e.clientX - rect.left < rect.width / 2;
          if (isRtl) {
            if (clickLeft) goNext();
            else goPrev();
          } else {
            if (clickLeft) goPrev();
            else goNext();
          }
        }}
      >
        {orderedSpread.map((p) => (
          <img
            key={p.url}
            src={p.url}
            alt={p.name}
            style={{
              maxWidth: isDouble ? '48%' : '100%',
              maxHeight: settings.comicFit === 'height' ? 'calc(100vh - 130px)' : 'none',
              width: settings.comicFit === 'width' && !isDouble ? `min(100%, ${settings.maxWidth + 120}px)` : 'auto',
              objectFit: 'contain',
              borderRadius: 4,
              userSelect: 'none',
            }}
          />
        ))}
      </div>

      {/* Left / Right floating arrows respecting RTL/LTR */}
      <button
        className="circle-arrow-btn"
        style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40 }}
        onClick={isRtl ? goNext : goPrev}
        title={isRtl ? 'Página siguiente (RTL)' : 'Página anterior'}
      >
        <ChevronLeft size={20} />
      </button>
      <button
        className="circle-arrow-btn"
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40 }}
        onClick={isRtl ? goPrev : goNext}
        title={isRtl ? 'Página anterior (RTL)' : 'Página siguiente'}
      >
        <ChevronRight size={20} />
      </button>

      {/* Bottom Scrubber */}
      <div className="reader-bottombar" style={{ justifyContent: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, minWidth: 68 }}>
          {currentIdx + 1} / {pages.length}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, pages.length - 1)}
          value={currentIdx}
          onChange={(e) => {
            const idx = Number(e.target.value);
            setCurrentIdx(idx);
            onProgress(idx + 1, pages.length);
          }}
          style={{ flex: 1, maxWidth: 460, direction: isRtl ? 'rtl' : 'ltr' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>
          {isRtl ? 'Manga RTL' : 'Cómic LTR'}
        </span>
      </div>
    </div>
  );
};
