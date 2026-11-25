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
import { openPdfDocumentReliably, pdfjsLib } from '../../parsers/pdfParser';
import type {
  BookAnnotation,
  BookItem,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReaderSelectionPayload } from './TextRichReader';
import {
  applyAnnotationsToRoot,
  injectReaderMarksStyle,
} from '../../utils/readerMarks';

interface PdfReaderProps {
  book: BookItem;
  blob: Blob;
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

function getPdfCanvasFilter(theme: ReaderSettings['theme']): string | undefined {
  switch (theme) {
    case 'cream':
      return 'sepia(0.14) contrast(0.98) brightness(0.99)';
    case 'sepia':
      return 'sepia(0.38) contrast(0.96) brightness(0.95)';
    case 'dark':
      return 'invert(0.88) hue-rotate(180deg) contrast(0.94)';
    case 'oled':
      return 'invert(0.96) hue-rotate(180deg) contrast(1.02)';
    case 'paper':
    default:
      return undefined;
  }
}

interface LazyPdfPageProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  targetWidth: number;
  targetMaxHeight: number;
  fitMode: 'width' | 'contain';
  zoom: number;
  paperTheme: ReaderSettings['theme'];
  defaultAspect: number;
  pinAnnotations: BookAnnotation[];
  textAnnotations: BookAnnotation[];
  pinMode: boolean;
  numPages: number;
  highlightAnnId?: string | null;
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
    paperTheme,
    defaultAspect,
    pinAnnotations,
    textAnnotations,
    pinMode,
    numPages,
    highlightAnnId,
    onTextSelect,
    onAnnotationClick,
  }) => {
    const slotRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 3);
    const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(null);
    const [textReadyVersion, setTextReadyVersion] = useState(0);
    const onAnnotationClickRef = useRef(onAnnotationClick);
    onAnnotationClickRef.current = onAnnotationClick;

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
      let textLayerTask: { cancel: () => void; render: () => Promise<void> } | null = null;

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
          const cssViewport = page.getViewport({ scale: cssScale });
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
          if (cancelled) return;

          const textContainer = textLayerRef.current;
          if (textContainer) {
            textContainer.innerHTML = '';
            textContainer.style.setProperty('--scale-factor', String(cssScale));
            textContainer.style.width = `${cssW}px`;
            textContainer.style.height = `${cssH}px`;
            try {
              const textContent = await page.getTextContent();
              if (cancelled || !textLayerRef.current) return;
              const tl = new pdfjsLib.TextLayer({
                textContentSource: textContent,
                container: textContainer,
                viewport: cssViewport,
              });
              textLayerTask = tl;
              await tl.render();
              if (!cancelled) {
                setTextReadyVersion((v) => v + 1);
              }
            } catch {
              // ignore cancelled or image-only PDF text layer errors
            }
          }
        } catch {
          // ignore cancelled render
        }
      })();

      return () => {
        cancelled = true;
        renderTask?.cancel();
        textLayerTask?.cancel();
      };
    }, [pdfDoc, pageNumber, isNearViewport, targetWidth, targetMaxHeight, fitMode, zoom]);

    // Apply inline annotations (highlighter, pencil, pen, post-it, sticker, emoji) onto PDF text layer
    useEffect(() => {
      const container = textLayerRef.current;
      if (!isNearViewport || !container || textReadyVersion === 0) return;
      injectReaderMarksStyle(document);
      applyAnnotationsToRoot(document, container, textAnnotations, {
        onAnnotationClick: (ann) => onAnnotationClickRef.current?.(ann),
      });
      if (highlightAnnId) {
        const markEl = container.querySelector(
          `mark[data-ann-id="${CSS.escape(highlightAnnId)}"]`
        ) as HTMLElement | null;
        if (markEl) {
          markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          markEl.classList.add('komo-mark-pulse');
          window.setTimeout(() => markEl.classList.remove('komo-mark-pulse'), 1800);
        }
      }
    }, [isNearViewport, textReadyVersion, textAnnotations, highlightAnnId]);

    const estW = Math.max(240, Math.round(targetWidth * zoom));
    const estH = Math.round(estW * defaultAspect);
    const boxW = renderedSize?.w ?? estW;
    const boxH = renderedSize?.h ?? estH;
    const canvasFilter = getPdfCanvasFilter(paperTheme);

    return (
      <div
        ref={slotRef}
        data-pdf-page={pageNumber}
        className={`pdf-page-shell pdf-page-theme-${paperTheme}`}
        style={{
          position: 'relative',
          width: boxW,
          minHeight: boxH,
          marginLeft: 'auto',
          marginRight: 'auto',
          background: paperTheme === 'dark' || paperTheme === 'oled' ? '#121318' : '#ffffff',
          borderRadius: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
          overflow: 'hidden',
          cursor: pinMode ? 'crosshair' : 'text',
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
          <>
            <canvas
              ref={canvasRef}
              style={{
                display: 'block',
                background: '#fff',
                filter: canvasFilter,
              }}
            />
            <div
              ref={textLayerRef}
              className={`pdf-text-layer${pinMode ? ' pin-mode-disabled' : ''}`}
              data-pdf-text-page={pageNumber}
            />
          </>
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
        {pinAnnotations.map((a) => (
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
  viewportMode = 'desktop',
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
  const [singleTextReadyVersion, setSingleTextReadyVersion] = useState(0);
  const [pulsingAnnId, setPulsingAnnId] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const singleTextLayerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const lastCapturedSelRef = useRef<string>('');
  const lastReportedPageRef = useRef<number>(Math.max(1, book.currentPage || 1));
  const didInitialScrollRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;
  const onAnnotationClickRef = useRef(onAnnotationClick);
  onAnnotationClickRef.current = onAnnotationClick;

  const isContinuous = (settings.pdfFlow || 'continuous') === 'continuous';
  const fitMode: 'width' | 'contain' = settings.pdfFit || 'width';

  // Capture text selections across any PDF page (desktop mouse + Android/iOS touch selection handles!)
  const capturePdfTextSelection = useCallback(() => {
    if (pinMode || !onTextSelectRef.current || !stageRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      lastCapturedSelRef.current = '';
      return;
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;

    const anchorEl =
      sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement;
    const focusEl =
      sel.focusNode instanceof HTMLElement ? sel.focusNode : sel.focusNode?.parentElement;
    const layerEl =
      (anchorEl?.closest('.pdf-text-layer') as HTMLElement | null) ||
      (focusEl?.closest('.pdf-text-layer') as HTMLElement | null);
    if (!layerEl || !stageRef.current.contains(layerEl)) return;

    const detectedPage = Number(layerEl.dataset.pdfTextPage) || pageNum;
    const sig = `${detectedPage}::${text}`;
    if (lastCapturedSelRef.current === sig) return;
    lastCapturedSelRef.current = sig;

    const pct = numPages ? Math.round((detectedPage / numPages) * 100) : 0;
    onTextSelectRef.current({
      quote: text.slice(0, 400),
      page: detectedPage,
      progress: pct,
    });
  }, [pinMode, pageNum, numPages]);

  // Listen for selectionchange (essential for Android WebView long-press word/phrase selection!)
  useEffect(() => {
    if (pinMode || loading) return;
    const onSelectionChange = () => {
      if (selectionTimerRef.current) window.clearTimeout(selectionTimerRef.current);
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        lastCapturedSelRef.current = '';
        return;
      }
      selectionTimerRef.current = window.setTimeout(() => {
        capturePdfTextSelection();
      }, 320);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (selectionTimerRef.current) window.clearTimeout(selectionTimerRef.current);
    };
  }, [pinMode, loading, capturePdfTextSelection]);

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

  // Paginated single-page canvas + selectable text layer render
  useEffect(() => {
    if (isContinuous || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayerTask: { cancel: () => void; render: () => Promise<void> } | null = null;

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
        const cssViewport = page.getViewport({ scale: cssScale });
        const viewport = page.getViewport({ scale: cssScale * dpr });
        const cssW = Math.max(1, Math.round(viewport.width / dpr));
        const cssH = Math.max(1, Math.round(viewport.height / dpr));
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled) return;

        const textContainer = singleTextLayerRef.current;
        if (textContainer) {
          textContainer.innerHTML = '';
          textContainer.style.setProperty('--scale-factor', String(cssScale));
          textContainer.style.width = `${cssW}px`;
          textContainer.style.height = `${cssH}px`;
          try {
            const textContent = await page.getTextContent();
            if (cancelled || !singleTextLayerRef.current) return;
            const tl = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textContainer,
              viewport: cssViewport,
            });
            textLayerTask = tl;
            await tl.render();
            if (!cancelled) {
              setSingleTextReadyVersion((v) => v + 1);
            }
          } catch {
            // ignore cancelled or scanned-only PDF text layer errors
          }
        }

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
      textLayerTask?.cancel();
    };
  }, [isContinuous, pdfDoc, pageNum, zoom, fitMode, viewportBox.w, viewportBox.h]);

  // Apply inline annotations onto paginated PDF text layer
  useEffect(() => {
    if (isContinuous || !singleTextLayerRef.current || singleTextReadyVersion === 0) return;
    const container = singleTextLayerRef.current;
    const pageTextAnns = annotations.filter(
      (a) => a.page === pageNum && (a.pageX === undefined || a.pageY === undefined)
    );
    injectReaderMarksStyle(document);
    applyAnnotationsToRoot(document, container, pageTextAnns, {
      onAnnotationClick: (ann) => onAnnotationClickRef.current?.(ann),
    });
    if (pulsingAnnId) {
      const markEl = container.querySelector(
        `mark[data-ann-id="${CSS.escape(pulsingAnnId)}"]`
      ) as HTMLElement | null;
      if (markEl) {
        markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        markEl.classList.add('komo-mark-pulse');
        window.setTimeout(() => markEl.classList.remove('komo-mark-pulse'), 1800);
      }
    }
  }, [isContinuous, pageNum, singleTextReadyVersion, annotations, pulsingAnnId]);

  useEffect(() => {
    if (jumpTarget?.page && numPages > 0) {
      const clamped = Math.min(numPages, Math.max(1, jumpTarget.page));
      setPageNum(clamped);
      lastReportedPageRef.current = clamped;
      onProgress(clamped, numPages);
      if (isContinuous) scrollToPdfPage(clamped, true);
      if (jumpTarget.annotationId) {
        setPulsingAnnId(jumpTarget.annotationId);
        window.setTimeout(() => setPulsingAnnId(null), 2600);
      }
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
  const singleCanvasFilter = getPdfCanvasFilter(settings.theme);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {isContinuous ? (
        <div
          ref={stageRef}
          onScroll={handleContinuousScroll}
          onMouseUp={capturePdfTextSelection}
          onTouchEnd={() => window.setTimeout(capturePdfTextSelection, 220)}
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
              paperTheme={settings.theme}
              defaultAspect={defaultAspect}
              pinAnnotations={annotations.filter(
                (a) => a.page === pn && a.pageX !== undefined && a.pageY !== undefined
              )}
              textAnnotations={annotations.filter(
                (a) => a.page === pn && (a.pageX === undefined || a.pageY === undefined)
              )}
              pinMode={pinMode}
              numPages={numPages}
              highlightAnnId={jumpTarget?.page === pn ? pulsingAnnId : null}
              onTextSelect={onTextSelect}
              onAnnotationClick={onAnnotationClick}
            />
          ))}
        </div>
      ) : (
        <div
          ref={stageRef}
          onMouseUp={capturePdfTextSelection}
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
            window.setTimeout(capturePdfTextSelection, 220);
            const activeSel = window.getSelection();
            if (activeSel && !activeSel.isCollapsed) {
              touchStartRef.current = null;
              return;
            }
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
            className={`pdf-page-shell pdf-page-theme-${settings.theme}`}
            style={{
              position: 'relative',
              display: 'inline-block',
              margin: 'auto',
              cursor: pinMode ? 'crosshair' : 'text',
              borderRadius: 6,
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
              background:
                settings.theme === 'dark' || settings.theme === 'oled' ? '#121318' : '#ffffff',
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
                background: '#fff',
                filter: singleCanvasFilter,
              }}
            />
            <div
              ref={singleTextLayerRef}
              className={`pdf-text-layer${pinMode ? ' pin-mode-disabled' : ''}`}
              data-pdf-text-page={pageNum}
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

      {viewportMode === 'phone' ? (
        <div className="reader-bottombar is-compact">
          <div className="reader-bottom-row">
            {!isContinuous && (
              <button
                type="button"
                className="circle-arrow-btn reader-bottom-icon"
                onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                disabled={pageNum <= 1}
                title="Página anterior"
              >
                <ChevronLeft size={15} />
              </button>
            )}
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
              className="reader-bottom-slider"
            />
            {!isContinuous && (
              <button
                type="button"
                className="circle-arrow-btn reader-bottom-icon"
                onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
                disabled={pageNum >= numPages}
                title="Página siguiente"
              >
                <ChevronRight size={15} />
              </button>
            )}
            <span className="reader-page-counter">
              {pageNum}/{numPages}
            </span>
          </div>

          <div className="reader-bottom-row reader-bottom-controls">
            {onUpdateSettings && (
              <button
                type="button"
                className={`pill-btn reader-bottom-pill ${isContinuous ? 'active' : ''}`}
                onClick={() => {
                  didInitialScrollRef.current = false;
                  onUpdateSettings({ pdfFlow: isContinuous ? 'paginated' : 'continuous' });
                }}
              >
                {isContinuous ? <Rows3 size={12} /> : <BookOpen size={12} />}
                <span>{isContinuous ? 'Continuo' : 'Paginado'}</span>
              </button>
            )}

            {onUpdateSettings && (
              <button
                type="button"
                className="pill-btn reader-bottom-pill"
                onClick={() => {
                  setZoom(1);
                  onUpdateSettings({ pdfFit: fitMode === 'width' ? 'contain' : 'width' });
                }}
              >
                <Maximize2 size={12} />
                <span>{fitMode === 'width' ? 'Ancho' : 'Pantalla'}</span>
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
                onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
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
              className={`pill-btn reader-bottom-pill ${isContinuous ? 'active' : ''}`}
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
              className="circle-arrow-btn reader-bottom-icon"
              onClick={() => setPageNum((p) => Math.max(1, p - 1))}
              disabled={pageNum <= 1}
              title="Página anterior"
            >
              <ChevronLeft size={15} />
            </button>
          )}

          <span className="reader-page-counter">
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
            className="reader-bottom-slider"
          />

          {!isContinuous && (
            <button
              type="button"
              className="circle-arrow-btn reader-bottom-icon"
              onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
              disabled={pageNum >= numPages}
              title="Página siguiente"
            >
              <ChevronRight size={15} />
            </button>
          )}

          {onUpdateSettings && (
            <button
              type="button"
              className="pill-btn reader-bottom-pill"
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
              onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
              title="Acercar"
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
