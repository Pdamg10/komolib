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
import { openPdfDocumentReliably } from '../../parsers/pdfParser';
import type {
  BookAnnotation,
  BookItem,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReaderSelectionPayload } from './TextRichReader';

interface PdfReaderProps {
  book: BookItem;
  blob: Blob;
  settings: ReaderSettings;
  annotations?: BookAnnotation[];
  jumpTarget?: ReaderJumpTarget | null;
  pinMode?: boolean;
  onProgress: (page: number, total: number) => void;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onUpdateSettings?: (patch: Partial<ReaderSettings>) => void;
}

interface LazyPdfPageProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  targetWidth: number;
  targetMaxHeight: number;
  fitMode: 'width' | 'contain';
  zoom: number;
  defaultAspect: number;
  annotations: BookAnnotation[];
  pinMode: boolean;
  numPages: number;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
}

const LazyPdfPage: React.FC<LazyPdfPageProps> = React.memo(
  ({
    pdfDoc,
    pageNumber,
    targetWidth,
    targetMaxHeight,
    fitMode,
    zoom,
    defaultAspect,
    annotations,
    pinMode,
    numPages,
    onTextSelect,
    onAnnotationClick,
  }) => {
    const slotRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 3);
    const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(null);

    useEffect(() => {
      const el = slotRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') {
        setIsNearViewport(true);
        return;
      }
      const obs = new IntersectionObserver(
        (entries) => {
          setIsNearViewport(Boolean(entries[0]?.isIntersecting));
        },
        { rootMargin: '900px 0px' }
      );
      obs.observe(el);
      return () => obs.disconnect();
    }, []);

    useEffect(() => {
      if (!isNearViewport || !canvasRef.current) return;
      let cancelled = false;
      let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

      (async () => {
        try {
          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const availW = Math.max(240, targetWidth);
          const availH = Math.max(280, targetMaxHeight);
          const baseScale =
            fitMode === 'contain'
              ? Math.min(availW / baseVp.width, availH / baseVp.height)
              : availW / baseVp.width;
          const cssScale = Math.max(0.25, baseScale * zoom);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: cssScale * dpr });
          const cssW = Math.max(1, Math.round(viewport.width / dpr));
          const cssH = Math.max(1, Math.round(viewport.height / dpr));

          const canvas = canvasRef.current;
          if (!canvas || cancelled) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          canvas.style.width = `${cssW}px`;
          canvas.style.height = `${cssH}px`;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          setRenderedSize({ w: cssW, h: cssH });
          renderTask = page.render({ canvasContext: ctx, viewport });
          await renderTask.promise;
        } catch {
          // ignore cancelled render
        }
      })();

      return () => {
        cancelled = true;
        renderTask?.cancel();
      };
    }, [pdfDoc, pageNumber, isNearViewport, targetWidth, targetMaxHeight, fitMode, zoom]);

    const estW = Math.max(240, Math.round(targetWidth * zoom));
    const estH = Math.round(estW * defaultAspect);
    const boxW = renderedSize?.w ?? estW;
    const boxH = renderedSize?.h ?? estH;

    return (
      <div
        ref={slotRef}
        data-pdf-page={pageNumber}
        style={{
          position: 'relative',
          width: boxW,
          minHeight: boxH,
          marginLeft: 'auto',
          marginRight: 'auto',
          background: '#ffffff',
          borderRadius: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
          overflow: 'hidden',
          cursor: pinMode ? 'crosshair' : 'default',
          flexShrink: 0,
        }}
        onClick={(e) => {
          if (!pinMode || !onTextSelect) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pageX = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100);
          const pageY = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100);
          const pct = numPages ? Math.round((pageNumber / numPages) * 100) : 0;
          onTextSelect({
            quote: `Marca en página ${pageNumber}`,
            page: pageNumber,
            progress: pct,
            pageX,
            pageY,
          });
        }}
      >
        {isNearViewport ? (
          <canvas ref={canvasRef} style={{ display: 'block', background: '#fff' }} />
        ) : (
          <div
            style={{
              width: boxW,
              height: boxH,
              display: 'grid',
              placeItems: 'center',
              color: '#888',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Pág. {pageNumber}
          </div>
        )}
        {annotations.map((a) => (
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
  }
);

export const PdfReader: React.FC<PdfReaderProps> = ({
  book,
  blob,
  settings,
  annotations = [],
  jumpTarget,
  pinMode = false,
  onProgress,
  onTextSelect,
  onAnnotationClick,
  onUpdateSettings,
}) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(Math.max(1, book.currentPage || 1));
  const [zoom, setZoom] = useState(1);
  const [defaultAspect, setDefaultAspect] = useState(1.42);
  const [viewportBox, setViewportBox] = useState<{ w: number; h: number }>({
    w: typeof window !== 'undefined' ? Math.max(300, window.innerWidth - 16) : 720,
    h: typeof window !== 'undefined' ? Math.max(400, window.innerHeight - 120) : 800,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const lastReportedPageRef = useRef<number>(Math.max(1, book.currentPage || 1));
  const didInitialScrollRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const isContinuous = (settings.pdfFlow || 'continuous') === 'continuous';
  const fitMode: 'width' | 'contain' = settings.pdfFit || 'width';

  // Measure actual available reader viewport so PDF pages ALWAYS fit phones & tablets cleanly!
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateBox = () => {
      const w = Math.max(260, el.clientWidth - 12);
      const h = Math.max(280, el.clientHeight - 16);
      setViewportBox((prev) =>
        Math.abs(prev.w - w) > 4 || Math.abs(prev.h - h) > 4 ? { w, h } : prev
      );
    };
    updateBox();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateBox);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateBox);
    return () => window.removeEventListener('resize', updateBox);
  }, [loading, isContinuous]);

  useEffect(() => {
    let active = true;
    let docRef: PDFDocumentProxy | null = null;
    didInitialScrollRef.current = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        const doc = await openPdfDocumentReliably(data);
        docRef = doc;
        if (!active) {
          await doc.destroy();
          return;
        }
        try {
          const firstPage = await doc.getPage(1);
          const vp1 = firstPage.getViewport({ scale: 1 });
          if (vp1.width > 0 && vp1.height > 0) {
            setDefaultAspect(vp1.height / vp1.width);
          }
        } catch {
          // keep default aspect
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        const startPage = Math.min(doc.numPages, Math.max(1, book.currentPage || 1));
        setPageNum(startPage);
        lastReportedPageRef.current = startPage;
        onProgress(startPage, doc.numPages);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error al abrir PDF');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      docRef?.destroy().catch(() => undefined);
    };
  }, [book.id]);

  const scrollToPdfPage = useCallback((targetPage: number, smooth = true) => {
    const el = stageRef.current;
    if (!el) return;
    const node = el.querySelector(`[data-pdf-page="${targetPage}"]`) as HTMLElement | null;
    node?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }, []);

  // Scroll to current page when entering continuous mode
  useEffect(() => {
    if (!isContinuous || !numPages || loading) return;
    if (!didInitialScrollRef.current && pageNum > 1) {
      didInitialScrollRef.current = true;
      window.setTimeout(() => scrollToPdfPage(pageNum, false), 80);
    } else {
      didInitialScrollRef.current = true;
    }
  }, [isContinuous, numPages, loading]);

  // Paginated single-page canvas render (auto-fitted to viewportBox + zoom!)
  useEffect(() => {
    if (isContinuous || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const baseVp = page.getViewport({ scale: 1 });
        const availW = Math.min(viewportBox.w, 1080);
        const availH = viewportBox.h;
        const baseScale =
          fitMode === 'contain'
            ? Math.min(availW / baseVp.width, availH / baseVp.height)
            : availW / baseVp.width;
        const cssScale = Math.max(0.25, baseScale * zoom);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        canvas.style.width = `${Math.max(1, Math.round(viewport.width / dpr))}px`;
        canvas.style.height = `${Math.max(1, Math.round(viewport.height / dpr))}px`;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled && pageNum !== lastReportedPageRef.current) {
          lastReportedPageRef.current = pageNum;
          onProgress(pageNum, pdfDoc.numPages);
        }
      } catch {
        // ignore cancelled render
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [isContinuous, pdfDoc, pageNum, zoom, fitMode, viewportBox.w, viewportBox.h]);

  useEffect(() => {
    if (jumpTarget?.page && numPages > 0) {
      const clamped = Math.min(numPages, Math.max(1, jumpTarget.page));
      setPageNum(clamped);
      lastReportedPageRef.current = clamped;
      onProgress(clamped, numPages);
      if (isContinuous) scrollToPdfPage(clamped, true);
    }
  }, [jumpTarget?.id, numPages, isContinuous, scrollToPdfPage]);

  useEffect(() => {
    if (isContinuous) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') setPageNum((p) => Math.min(numPages, p + 1));
      if (e.key === 'ArrowLeft') setPageNum((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, isContinuous]);

  const handleContinuousScroll = () => {
    if (!stageRef.current || !numPages) return;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const container = stageRef.current;
      if (!container) return;
      const children = container.querySelectorAll<HTMLElement>('[data-pdf-page]');
      const viewportMid = container.scrollTop + container.clientHeight * 0.35;
      let detected = 1;
      for (let i = 0; i < children.length; i++) {
        if (children[i].offsetTop <= viewportMid) detected = i + 1;
        else break;
      }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 24) {
        detected = numPages;
      }
      setPageNum(detected);
      if (detected !== lastReportedPageRef.current) {
        lastReportedPageRef.current = detected;
        onProgress(detected, numPages);
      }
    }, 200);
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
          <Loader2 size={22} className="spin" /> Cargando PDF...
        </div>
      </div>
    );
  }

  if (error || !pdfDoc) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
        <p>{error || 'No se pudo abrir el PDF.'}</p>
      </div>
    );
  }

  const continuousTargetWidth = Math.min(viewportBox.w, 1020);
  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {isContinuous ? (
        <div
          ref={stageRef}
          onScroll={handleContinuousScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: zoom > 1 ? 'auto' : 'hidden',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: 'column',
            alignItems: zoom > 1 ? 'flex-start' : 'center',
            gap: 8,
            padding: '8px 6px 36px',
          }}
        >
          {pageNumbers.map((pn) => (
            <LazyPdfPage
              key={pn}
              pdfDoc={pdfDoc}
              pageNumber={pn}
              targetWidth={continuousTargetWidth}
              targetMaxHeight={viewportBox.h}
              fitMode={fitMode}
              zoom={zoom}
              defaultAspect={defaultAspect}
              annotations={annotations.filter(
                (a) => a.page === pn && a.pageX !== undefined && a.pageY !== undefined
              )}
              pinMode={pinMode}
              numPages={numPages}
              onTextSelect={onTextSelect}
              onAnnotationClick={onAnnotationClick}
            />
          ))}
        </div>
      ) : (
        <div
          ref={stageRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            padding: '8px 6px',
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
              if (dx < 0) setPageNum((p) => Math.min(numPages, p + 1));
              else setPageNum((p) => Math.max(1, p - 1));
            }
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'inline-block',
              margin: 'auto',
              cursor: pinMode ? 'crosshair' : 'default',
            }}
            onClick={(e) => {
              if (!pinMode || !onTextSelect) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pageX = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100);
              const pageY = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100);
              const pct = numPages ? Math.round((pageNum / numPages) * 100) : 0;
              onTextSelect({
                quote: `Marca en página ${pageNum}`,
                page: pageNum,
                progress: pct,
                pageX,
                pageY,
              });
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                display: 'block',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
                background: '#fff',
              }}
            />
            {annotations
              .filter((a) => a.page === pageNum && a.pageX !== undefined && a.pageY !== undefined)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`page-pin-badge pin-${a.tool}${a.styleVariant ? ` pin-var-${a.styleVariant}` : ''}`}
                  style={{
                    left: `${a.pageX}%`,
                    top: `${a.pageY}%`,
                    background: a.color,
                  }}
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
      )}

      <div
        className="reader-bottombar"
        style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'nowrap', padding: '6px 10px' }}
      >
        {onUpdateSettings && (
          <button
            type="button"
            className={`pill-btn ${isContinuous ? 'active' : ''}`}
            style={{ height: 30, padding: '0 9px', fontSize: 11, flexShrink: 0 }}
            onClick={() => {
              didInitialScrollRef.current = false;
              onUpdateSettings({ pdfFlow: isContinuous ? 'paginated' : 'continuous' });
            }}
            title={
              isContinuous
                ? 'Modo continuo vertical — toca para cambiar a página por página'
                : 'Modo paginado — toca para cambiar a scroll continuo'
            }
          >
            {isContinuous ? <Rows3 size={13} /> : <BookOpen size={13} />}
            <span>{isContinuous ? 'Continuo' : 'Paginado'}</span>
          </button>
        )}

        {!isContinuous && (
          <button
            type="button"
            className="circle-arrow-btn"
            style={{ width: 28, height: 28, flexShrink: 0 }}
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
          >
            <ChevronLeft size={15} />
          </button>
        )}

        <span style={{ fontSize: 11.5, fontWeight: 800, minWidth: 50, textAlign: 'center', flexShrink: 0 }}>
          {pageNum} / {numPages}
        </span>

        <input
          type="range"
          min={1}
          max={Math.max(1, numPages)}
          value={pageNum}
          onChange={(e) => {
            const p = Number(e.target.value);
            setPageNum(p);
            lastReportedPageRef.current = p;
            onProgress(p, numPages);
            if (isContinuous) scrollToPdfPage(p, false);
          }}
          style={{ flex: 1, minWidth: 56, maxWidth: 380 }}
        />

        {!isContinuous && (
          <button
            type="button"
            className="circle-arrow-btn"
            style={{ width: 28, height: 28, flexShrink: 0 }}
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
          >
            <ChevronRight size={15} />
          </button>
        )}

        {onUpdateSettings && (
          <button
            type="button"
            className="pill-btn"
            style={{ height: 30, padding: '0 8px', fontSize: 11, flexShrink: 0 }}
            onClick={() => {
              setZoom(1);
              onUpdateSettings({ pdfFit: fitMode === 'width' ? 'contain' : 'width' });
            }}
            title="Alternar entre ajustar al ancho o pantalla completa"
          >
            <Maximize2 size={12} />
            <span>{fitMode === 'width' ? 'Ancho' : 'Pantalla'}</span>
          </button>
        )}

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <button
            type="button"
            className="circle-arrow-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
            title="Alejar"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            className="circle-arrow-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
            title="Acercar"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
