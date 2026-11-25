import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Rows3,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { extractCbrPages, extractCbzPages, type ComicPage } from '../../parsers/comicParser';
import type {
  BookAnnotation,
  BookItem,
  ComicReadMode,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import type { ReaderSelectionPayload } from './TextRichReader';

interface ComicMangaReaderProps {
  book: BookItem;
  blob: Blob;
  extraImages?: Blob[];
  settings: ReaderSettings;
  annotations?: BookAnnotation[];
  jumpTarget?: ReaderJumpTarget | null;
  pinMode?: boolean;
  viewportMode?: 'phone' | 'tablet' | 'desktop';
  onProgress: (page: number, total: number) => void;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onUpdateSettings?: (patch: Partial<ReaderSettings>) => void;
}

const FIT_CYCLE: Array<ReaderSettings['comicFit']> = ['width', 'contain', 'height', 'original'];
const FIT_LABELS: Record<ReaderSettings['comicFit'], string> = {
  width: 'Ancho',
  contain: 'Pantalla',
  height: 'Alto',
  original: 'Original',
};

export const ComicMangaReader: React.FC<ComicMangaReaderProps> = ({
  book,
  blob,
  extraImages,
  settings,
  annotations = [],
  jumpTarget,
  pinMode = false,
  viewportMode = 'desktop',
  onProgress,
  onTextSelect,
  onAnnotationClick,
  onUpdateSettings,
}) => {
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(Math.max(0, (book.currentPage || 1) - 1));
  const [zoom, setZoom] = useState(1);

  const stripRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const lastReportedPageRef = useRef<number>(Math.max(1, book.currentPage || 1));
  const didInitialStripScrollRef = useRef<boolean>(false);

  useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];
    didInitialStripScrollRef.current = false;

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
          lastReportedPageRef.current = initial + 1;
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
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [book.id]);

  const isStrip = settings.comicMode === 'manhwa-strip';
  const isRtl =
    settings.comicMode === 'manga-rtl' || settings.comicMode === 'manga-rtl-double';
  const isDouble =
    settings.comicMode === 'manga-rtl-double' || settings.comicMode === 'comic-ltr-double';
  const step = isDouble ? 2 : 1;
  const activeFit: ReaderSettings['comicFit'] = settings.comicFit || 'width';

  const scrollToStripPage = useCallback((pageOneBased: number, smooth = true) => {
    const el = stripRef.current;
    if (!el) return;
    const targetEl = el.querySelector(
      `[data-comic-page="${pageOneBased}"]`
    ) as HTMLElement | null;
    targetEl?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }, []);

  // When entering continuous strip mode (initial open or switching from paged), jump to currentIdx
  useEffect(() => {
    if (!isStrip || !pages.length || loading) return;
    if (!didInitialStripScrollRef.current && currentIdx > 0) {
      didInitialStripScrollRef.current = true;
      window.setTimeout(() => scrollToStripPage(currentIdx + 1, false), 60);
    } else {
      didInitialStripScrollRef.current = true;
    }
  }, [isStrip, pages.length, loading]);

  const goNext = useCallback(() => {
    if (!pages.length) return;
    setCurrentIdx((prev) => {
      const next = Math.min(pages.length - 1, prev + step);
      lastReportedPageRef.current = next + 1;
      onProgress(next + 1, pages.length);
      return next;
    });
  }, [pages.length, step, onProgress]);

  const goPrev = useCallback(() => {
    if (!pages.length) return;
    setCurrentIdx((prev) => {
      const next = Math.max(0, prev - step);
      lastReportedPageRef.current = next + 1;
      onProgress(next + 1, pages.length);
      return next;
    });
  }, [pages.length, step, onProgress]);

  useEffect(() => {
    if (!jumpTarget?.page || !pages.length) return;
    const targetIdx = Math.min(pages.length - 1, Math.max(0, jumpTarget.page - 1));
    setCurrentIdx(targetIdx);
    lastReportedPageRef.current = targetIdx + 1;
    onProgress(targetIdx + 1, pages.length);
    if (isStrip) {
      scrollToStripPage(targetIdx + 1, true);
    }
  }, [jumpTarget?.id, pages.length, isStrip, scrollToStripPage]);

  useEffect(() => {
    if (isStrip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
  }, [isStrip, isRtl, goNext, goPrev]);

  // Measure actual visible page in continuous strip mode + debounce progress writes for 60 FPS!
  const handleStripScroll = () => {
    const el = stripRef.current;
    if (!el || !pages.length) return;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const container = stripRef.current;
      if (!container || !pages.length) return;
      const children = container.querySelectorAll<HTMLElement>('[data-comic-page]');
      const viewportMid = container.scrollTop + container.clientHeight * 0.35;
      let detectedPage = 1;
      if (children.length > 0) {
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.offsetTop <= viewportMid) {
            detectedPage = i + 1;
          } else {
            break;
          }
        }
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 24) {
          detectedPage = pages.length;
        }
      } else {
        const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
        const ratio = container.scrollTop / maxScroll;
        detectedPage = Math.min(pages.length, Math.max(1, Math.round(ratio * (pages.length - 1)) + 1));
      }
      setCurrentIdx(detectedPage - 1);
      if (detectedPage !== lastReportedPageRef.current) {
        lastReportedPageRef.current = detectedPage;
        onProgress(detectedPage, pages.length);
      }
    }, 180);
  };

  const toggleContinuousMode = () => {
    if (!onUpdateSettings) return;
    if (isStrip) {
      const pagedDefault: ComicReadMode = book.kind === 'comic' ? 'comic-ltr' : 'manga-rtl';
      onUpdateSettings({ comicMode: pagedDefault });
    } else {
      didInitialStripScrollRef.current = false;
      onUpdateSettings({ comicMode: 'manhwa-strip' });
    }
  };

  const cycleFitMode = () => {
    if (!onUpdateSettings) return;
    const idx = FIT_CYCLE.indexOf(activeFit);
    const nextFit = FIT_CYCLE[(idx + 1) % FIT_CYCLE.length];
    setZoom(1);
    onUpdateSettings({ comicFit: nextFit });
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

  // Shared Quick Controls Bottom Bar (auto-adapts to phone 2-row compact vs tablet/desktop 1-row)
  const renderBottomBar = () =>
    viewportMode === 'phone' ? (
      <div className="reader-bottombar is-compact">
        <div className="reader-bottom-row">
          {!isStrip && (
            <button
              type="button"
              className="circle-arrow-btn reader-bottom-icon"
              onClick={isRtl ? goNext : goPrev}
              title={isRtl ? 'Página siguiente (RTL)' : 'Página anterior'}
            >
              <ChevronLeft size={15} />
            </button>
          )}
          <input
            type="range"
            min={0}
            max={Math.max(0, pages.length - 1)}
            value={currentIdx}
            onChange={(e) => {
              const idx = Number(e.target.value);
              setCurrentIdx(idx);
              lastReportedPageRef.current = idx + 1;
              onProgress(idx + 1, pages.length);
              if (isStrip) scrollToStripPage(idx + 1, false);
            }}
            className="reader-bottom-slider"
            style={{ direction: !isStrip && isRtl ? 'rtl' : 'ltr' }}
          />
          {!isStrip && (
            <button
              type="button"
              className="circle-arrow-btn reader-bottom-icon"
              onClick={isRtl ? goPrev : goNext}
              title={isRtl ? 'Página anterior (RTL)' : 'Página siguiente'}
            >
              <ChevronRight size={15} />
            </button>
          )}
          <span className="reader-page-counter">
            {currentIdx + 1}/{pages.length}
          </span>
        </div>

        <div className="reader-bottom-row reader-bottom-controls">
          {onUpdateSettings && (
            <button
              type="button"
              className={`pill-btn reader-bottom-pill ${isStrip ? 'active' : ''}`}
              onClick={toggleContinuousMode}
            >
              {isStrip ? <Rows3 size={12} /> : <BookOpen size={12} />}
              <span>{isStrip ? 'Continuo' : isRtl ? 'Manga' : 'Paginado'}</span>
            </button>
          )}

          {onUpdateSettings && (
            <button
              type="button"
              className="pill-btn reader-bottom-pill"
              onClick={cycleFitMode}
              title={`Ajuste actual: ${FIT_LABELS[activeFit]}`}
            >
              <Maximize2 size={12} />
              <span>{FIT_LABELS[activeFit]}</span>
            </button>
          )}

          <div className="reader-zoom-group">
            <button
              type="button"
              className="circle-arrow-btn reader-bottom-icon"
              onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
              title="Alejar"
            >
              <ZoomOut size={13} />
            </button>
            <span className="reader-zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="circle-arrow-btn reader-bottom-icon"
              onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.15).toFixed(2)))}
              title="Acercar"
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div className="reader-bottombar">
        {onUpdateSettings && (
          <button
            type="button"
            className={`pill-btn reader-bottom-pill ${isStrip ? 'active' : ''}`}
            onClick={toggleContinuousMode}
            title={
              isStrip
                ? 'Modo lectura continua activo — toca para cambiar a página por página'
                : 'Modo paginado activo — toca para cambiar a lectura continua vertical'
            }
          >
            {isStrip ? <Rows3 size={13} /> : <BookOpen size={13} />}
            <span>{isStrip ? 'Continuo' : isRtl ? 'Manga RTL' : 'Paginado'}</span>
          </button>
        )}

        <span className="reader-page-counter">
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
            lastReportedPageRef.current = idx + 1;
            onProgress(idx + 1, pages.length);
            if (isStrip) scrollToStripPage(idx + 1, false);
          }}
          className="reader-bottom-slider"
          style={{ direction: !isStrip && isRtl ? 'rtl' : 'ltr' }}
        />

        {onUpdateSettings && (
          <button
            type="button"
            className="pill-btn reader-bottom-pill"
            onClick={cycleFitMode}
            title={`Ajuste actual: ${FIT_LABELS[activeFit]} — toca para cambiar`}
          >
            <Maximize2 size={12} />
            <span>{FIT_LABELS[activeFit]}</span>
          </button>
        )}

        <div className="reader-zoom-group">
          <button
            type="button"
            className="circle-arrow-btn reader-bottom-icon"
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
            title="Alejar"
          >
            <ZoomOut size={13} />
          </button>
          <span className="reader-zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="circle-arrow-btn reader-bottom-icon"
            onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.15).toFixed(2)))}
            title="Acercar"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>
    );

  // 1. Seamless Vertical Continuous Strip Mode (Works for Manhwa, Webtoon, Manga, Comics!)
  if (isStrip) {
    const stripWrapperStyle = (): React.CSSProperties => {
      if (activeFit === 'width') {
        const pct = Math.round(zoom * 100);
        return {
          width: zoom === 1 ? '100%' : `${pct}%`,
          maxWidth: zoom === 1 ? 'min(100%, 960px)' : `${Math.round(960 * zoom)}px`,
        };
      }
      if (activeFit === 'contain' || activeFit === 'height') {
        return {
          width: zoom === 1 ? '100%' : `${Math.round(zoom * 100)}%`,
          maxWidth: '100%',
          display: 'flex',
          justifyContent: 'center',
        };
      }
      return {
        width: 'fit-content',
        maxWidth: zoom > 1 ? 'none' : '100%',
      };
    };

    const stripImgStyle = (): React.CSSProperties => {
      if (activeFit === 'contain') {
        return {
          display: 'block',
          maxWidth: '100%',
          maxHeight: zoom === 1 ? 'calc(100dvh - 114px)' : `${Math.round(zoom * 90)}dvh`,
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          margin: '0 auto',
        };
      }
      if (activeFit === 'height') {
        return {
          display: 'block',
          height: `${Math.round(zoom * 92)}dvh`,
          width: 'auto',
          maxWidth: zoom > 1 ? 'none' : '100%',
          objectFit: 'contain',
          margin: '0 auto',
        };
      }
      if (activeFit === 'original') {
        return {
          display: 'block',
          width: zoom === 1 ? 'auto' : `${Math.round(zoom * 100)}%`,
          maxWidth: zoom > 1 ? 'none' : '100%',
          height: 'auto',
          margin: '0 auto',
        };
      }
      // Default: 'width' — edge-to-edge full responsive width on phones & tablets!
      return {
        display: 'block',
        width: '100%',
        height: 'auto',
        objectFit: 'contain',
      };
    };

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div
          ref={stripRef}
          onScroll={handleStripScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: zoom > 1 ? 'auto' : 'hidden',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: 'column',
            alignItems: zoom > 1 ? 'flex-start' : 'center',
            gap: `${settings.comicGap}px`,
            padding: settings.comicGap > 0 ? '8px 0 36px' : '0 0 36px',
          }}
        >
          {pages.map((p, idx) => {
            const pageNo = idx + 1;
            const pagePins = annotations.filter(
              (a) => a.page === pageNo && a.pageX !== undefined && a.pageY !== undefined
            );
            return (
              <div
                key={p.name + idx}
                data-comic-page={pageNo}
                style={{
                  position: 'relative',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                  cursor: pinMode ? 'crosshair' : 'default',
                  ...stripWrapperStyle(),
                }}
                onClick={(e) => {
                  if (!pinMode || !onTextSelect) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pageX = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100);
                  const pageY = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100);
                  const pct = pages.length ? Math.round((pageNo / pages.length) * 100) : 0;
                  onTextSelect({
                    quote: `Viñeta pág. ${pageNo}`,
                    page: pageNo,
                    progress: pct,
                    pageX,
                    pageY,
                  });
                }}
              >
                <img
                  src={p.url}
                  alt={`Página ${pageNo}`}
                  decoding="async"
                  style={stripImgStyle()}
                />
                {pagePins.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`page-pin-badge pin-${a.tool}${a.styleVariant ? ` pin-var-${a.styleVariant}` : ''}`}
                    style={{ left: `${a.pageX}%`, top: `${a.pageY}%`, background: a.color }}
                    title={`${a.quote}${a.note ? ` — ${a.note}` : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnnotationClick?.(a);
                    }}
                  >
                    {a.tool === 'postit' ? (
                      <span className="pin-postit-shape" aria-hidden="true" />
                    ) : (
                      a.sticker || (a.tool === 'pencil' ? '✏️' : a.tool === 'pen' ? '🖊️' : '🖍️')
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        {renderBottomBar()}
      </div>
    );
  }

  // 2. Paged Manga (RTL) / Comic (LTR) — Single or Double Spread (Responsive, Zero Top-Clipping, Touch Swipe!)
  const visiblePages = isDouble
    ? [pages[currentIdx], pages[currentIdx + 1]].filter(Boolean)
    : [pages[currentIdx]];
  const orderedSpread = isRtl && visiblePages.length === 2 ? [visiblePages[1], visiblePages[0]] : visiblePages;

  const pagedImgStyle = (): React.CSSProperties => {
    if (activeFit === 'width') {
      return {
        display: 'block',
        width: isDouble ? `${Math.round(49 * zoom)}%` : `${Math.round(100 * zoom)}%`,
        maxWidth: zoom > 1 ? 'none' : isDouble ? '49%' : 'min(100%, 960px)',
        height: 'auto',
        objectFit: 'contain',
        borderRadius: 4,
        userSelect: 'none',
      };
    }
    if (activeFit === 'height') {
      return {
        display: 'block',
        height: `calc((100dvh - 118px) * ${zoom})`,
        width: 'auto',
        maxWidth: zoom > 1 ? 'none' : isDouble ? '49%' : '100%',
        objectFit: 'contain',
        borderRadius: 4,
        userSelect: 'none',
      };
    }
    if (activeFit === 'original') {
      return {
        display: 'block',
        width: zoom === 1 ? 'auto' : `${Math.round(zoom * 100)}%`,
        maxWidth: zoom > 1 ? 'none' : isDouble ? '49%' : '100%',
        height: 'auto',
        objectFit: 'contain',
        borderRadius: 4,
        userSelect: 'none',
      };
    }
    // 'contain' — fits entire page cleanly inside phone/tablet screen with zero clipping!
    return {
      display: 'block',
      maxWidth: zoom > 1 ? 'none' : isDouble ? '49%' : '100%',
      maxHeight: zoom === 1 ? 'calc(100dvh - 118px)' : `calc((100dvh - 118px) * ${zoom})`,
      width: zoom > 1 ? `${Math.round(zoom * 100)}%` : 'auto',
      height: 'auto',
      objectFit: 'contain',
      borderRadius: 4,
      userSelect: 'none',
    };
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          padding: '6px 6px',
          position: 'relative',
          cursor: pinMode ? 'crosshair' : 'default',
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }
        }}
        onTouchEnd={(e) => {
          if (!touchStartRef.current || pinMode || zoom > 1.05) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStartRef.current.x;
          const dy = t.clientY - touchStartRef.current.y;
          touchStartRef.current = null;
          if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            if (dx < 0) {
              if (isRtl) goPrev();
              else goNext();
            } else {
              if (isRtl) goNext();
              else goPrev();
            }
          }
        }}
        onClick={(e) => {
          if (pinMode && onTextSelect) {
            const rect = e.currentTarget.getBoundingClientRect();
            const pageX = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100);
            const pageY = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100);
            const pageNo = currentIdx + 1;
            const pct = pages.length ? Math.round((pageNo / pages.length) * 100) : 0;
            onTextSelect({
              quote: `Viñeta pág. ${pageNo}`,
              page: pageNo,
              progress: pct,
              pageX,
              pageY,
            });
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const clickLeft = e.clientX - rect.left < rect.width * 0.4;
          const clickRight = e.clientX - rect.left > rect.width * 0.6;
          if (!clickLeft && !clickRight) return;
          if (isRtl) {
            if (clickLeft) goNext();
            else goPrev();
          } else {
            if (clickLeft) goPrev();
            else goNext();
          }
        }}
      >
        {/* margin: auto centers both vertically & horizontally WITHOUT clipping the top edge when taller than screen! */}
        <div
          style={{
            margin: 'auto',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            width: activeFit === 'width' ? '100%' : 'auto',
            maxWidth: zoom > 1 ? 'none' : '100%',
          }}
        >
          {orderedSpread.map((p) => (
            <img key={p.url} src={p.url} alt={p.name} decoding="async" style={pagedImgStyle()} />
          ))}
          {annotations
            .filter((a) => a.page === currentIdx + 1 && a.pageX !== undefined && a.pageY !== undefined)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                className={`page-pin-badge pin-${a.tool}${a.styleVariant ? ` pin-var-${a.styleVariant}` : ''}`}
                style={{ left: `${a.pageX}%`, top: `${a.pageY}%`, background: a.color }}
                title={`${a.quote}${a.note ? ` — ${a.note}` : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAnnotationClick?.(a);
                }}
              >
                {a.tool === 'postit' ? (
                  <span className="pin-postit-shape" aria-hidden="true" />
                ) : (
                  a.sticker || (a.tool === 'pencil' ? '✏️' : a.tool === 'pen' ? '🖊️' : '🖍️')
                )}
              </button>
            ))}
        </div>
      </div>

      {/* Subtle floating side arrows (only on tablet/desktop; on phone users swipe/tap or use compact bottom arrows) */}
      {viewportMode !== 'phone' && (
        <>
          <button
            type="button"
            className="circle-arrow-btn"
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 34,
              height: 34,
              opacity: 0.72,
            }}
            onClick={isRtl ? goNext : goPrev}
            title={isRtl ? 'Página siguiente (RTL)' : 'Página anterior'}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="circle-arrow-btn"
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 34,
              height: 34,
              opacity: 0.72,
            }}
            onClick={isRtl ? goPrev : goNext}
            title={isRtl ? 'Página anterior (RTL)' : 'Página siguiente'}
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      {renderBottomBar()}
    </div>
  );
};
