import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { openPdfFromBlobReliably, pdfjsLib } from '../../parsers/pdfParser';
import type {
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReaderSelectionPayload } from './TextRichReader';
import { isVisualSeriesKind } from '../../utils/mangaSeriesUtils';
import {
  applyAnnotationsToRoot,
  injectReaderMarksStyle,
} from '../../utils/readerMarks';

const EMPTY_ANN_LIST: BookAnnotation[] = [];
const EMPTY_BM_LIST: BookmarkItem[] = [];

/**
 * Safely caps PDF canvas dimensions/pixels so ultra-tall Manhwa/Webtoon PDF pages
 * (e.g. 800x18000px) never exceed GPU max texture size, never blank out, and render in <80ms.
 */
function computeSafePdfScale(
  baseW: number,
  baseH: number,
  cssScale: number,
  isPhone: boolean
): { renderScale: number; cssW: number; cssH: number; canvasW: number; canvasH: number } {
  const maxDpr = isPhone ? 1.5 : 1.75;
  const maxDim = isPhone ? 6144 : 8192;
  const maxPixels = isPhone ? 5_500_000 : 12_000_000;

  const cssW = Math.max(1, Math.round(baseW * cssScale));
  const cssH = Math.max(1, Math.round(baseH * cssScale));

  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  let renderScale = cssScale * dpr;

  const rawW = baseW * renderScale;
  if (rawW > maxDim) renderScale *= maxDim / rawW;
  const scaledH = baseH * renderScale;
  if (scaledH > maxDim) renderScale *= maxDim / scaledH;

  const pixels = baseW * renderScale * (baseH * renderScale);
  if (pixels > maxPixels) {
    renderScale *= Math.sqrt(maxPixels / pixels);
  }

  return {
    renderScale: Math.max(0.2, renderScale),
    cssW,
    cssH,
    canvasW: Math.max(1, Math.round(baseW * Math.max(0.2, renderScale))),
    canvasH: Math.max(1, Math.round(baseH * Math.max(0.2, renderScale))),
  };
}

interface PdfReaderProps {
  book: BookItem;
  blob: Blob;
  settings: ReaderSettings;
  annotations?: BookAnnotation[];
  bookmarks?: BookmarkItem[];
  bookmarkDesigns?: BookmarkDesign[];
  defaultBookmarkDesign?: BookmarkDesign | null;
  jumpTarget?: ReaderJumpTarget | null;
  pinMode?: boolean;
  hasOpenOverlay?: boolean;
  viewportMode?: 'phone' | 'tablet' | 'desktop';
  nextSeriesLabel?: string;
  onOpenNextSeriesPack?: () => void;
  onProgress: (page: number, total: number, scrollRatio?: number) => void;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onBookmarkClick?: (bm: BookmarkItem) => void;
  onUpdateSettings?: (patch: Partial<ReaderSettings>) => void;
  onRegisterFlush?: (fn: (() => void) | null) => void;
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
  cachedSize?: { w: number; h: number };
  skipTextLayer: boolean;
  isPhone: boolean;
  observeSlot: (el: HTMLElement, onChange: (visible: boolean) => void) => () => void;
  onSizeMeasured: (pageNumber: number, w: number, h: number, slotEl: HTMLElement | null) => void;
  pinAnnotations: BookAnnotation[];
  textAnnotations: BookAnnotation[];
  pageBookmarks: BookmarkItem[];
  bookmarkDesignsById: Map<string, BookmarkDesign>;
  defaultBookmarkDesign?: BookmarkDesign | null;
  pinMode: boolean;
  numPages: number;
  highlightAnnId?: string | null;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onBookmarkClick?: (bm: BookmarkItem) => void;
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
    cachedSize,
    skipTextLayer,
    isPhone,
    observeSlot,
    onSizeMeasured,
    pinAnnotations,
    textAnnotations,
    pageBookmarks,
    bookmarkDesignsById,
    defaultBookmarkDesign,
    pinMode,
    numPages,
    highlightAnnId,
    onTextSelect,
    onAnnotationClick,
    onBookmarkClick,
  }) => {
    const slotRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 2);
    const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(
      cachedSize || null
    );
    const [textReadyVersion, setTextReadyVersion] = useState(0);
    const onAnnotationClickRef = useRef(onAnnotationClick);
    onAnnotationClickRef.current = onAnnotationClick;
    const onSizeMeasuredRef = useRef(onSizeMeasured);
    onSizeMeasuredRef.current = onSizeMeasured;

    useEffect(() => {
      const el = slotRef.current;
      if (!el) return;
      return observeSlot(el, setIsNearViewport);
    }, [observeSlot]);

    useEffect(() => {
      if (!isNearViewport || !canvasRef.current) {
        // Release GPU bitmap backing store when scrolled away
        const c = canvasRef.current;
        if (c && (c.width > 1 || c.height > 1)) {
          c.width = 1;
          c.height = 1;
        }
        return;
      }
      let cancelled = false;
      let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
      let textLayerTask: { cancel: () => void; render: () => Promise<void> } | null = null;

      (async () => {
        try {
          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const availW = Math.max(240, targetWidth);
          const availH = Math.max(280, targetMaxHeight || 600);
          const baseScale =
            fitMode === 'contain'
              ? Math.min(availW / baseVp.width, availH / baseVp.height)
              : availW / baseVp.width;
          const cssScale = Math.max(0.25, baseScale * zoom);
          const safe = computeSafePdfScale(baseVp.width, baseVp.height, cssScale, isPhone);
          const cssViewport = page.getViewport({ scale: cssScale });
          const viewport = page.getViewport({ scale: safe.renderScale });

          const canvas = canvasRef.current;
          if (!canvas || cancelled) return;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) return;

          canvas.width = safe.canvasW;
          canvas.height = safe.canvasH;
          canvas.style.width = `${safe.cssW}px`;
          canvas.style.height = `${safe.cssH}px`;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          setRenderedSize((prev) => {
            if (prev && prev.w === safe.cssW && prev.h === safe.cssH) return prev;
            return { w: safe.cssW, h: safe.cssH };
          });
          onSizeMeasuredRef.current(pageNumber, safe.cssW, safe.cssH, slotRef.current);
          renderTask = page.render({ canvasContext: ctx, viewport });
          await renderTask.promise;
          if (cancelled) return;

          if (!skipTextLayer) {
            const textContainer = textLayerRef.current;
            if (textContainer) {
              textContainer.innerHTML = '';
              textContainer.style.setProperty('--scale-factor', String(cssScale));
              textContainer.style.width = `${safe.cssW}px`;
              textContainer.style.height = `${safe.cssH}px`;
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
    }, [pdfDoc, pageNumber, isNearViewport, targetWidth, targetMaxHeight, fitMode, zoom, skipTextLayer, isPhone]);

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
    const boxW = renderedSize?.w ?? cachedSize?.w ?? estW;
    const boxH = renderedSize?.h ?? cachedSize?.h ?? estH;
    const canvasFilter = getPdfCanvasFilter(paperTheme);
    const primaryBookmark = pageBookmarks[0];
    const bookmarkDesign = primaryBookmark
      ? (primaryBookmark.designId && bookmarkDesignsById.get(primaryBookmark.designId)) ||
        defaultBookmarkDesign ||
        null
      : null;

    return (
      <div
        ref={slotRef}
        data-pdf-page={pageNumber}
        className={`pdf-page-shell pdf-page-theme-${paperTheme}`}
        style={{
          position: 'relative',
          width: boxW,
          height: boxH,
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
        {primaryBookmark && (
          <button
            type="button"
            className="reader-page-bookmark-ribbon"
            title={`Separador: ${bookmarkDesign?.name || primaryBookmark.label} (Pág. ${pageNumber})`}
            onClick={(e) => {
              e.stopPropagation();
              onBookmarkClick?.(primaryBookmark);
            }}
          >
            {bookmarkDesign?.imageUrl ? (
              <img src={bookmarkDesign.imageUrl} alt={bookmarkDesign.name} />
            ) : (
              <span className="reader-page-bookmark-fallback" aria-hidden="true" />
            )}
            {pageBookmarks.length > 1 && (
              <span className="reader-page-bookmark-count">{pageBookmarks.length}</span>
            )}
          </button>
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
  bookmarks = EMPTY_BM_LIST,
  bookmarkDesigns = [],
  defaultBookmarkDesign = null,
  jumpTarget,
  pinMode = false,
  hasOpenOverlay = false,
  viewportMode = 'desktop',
  nextSeriesLabel,
  onOpenNextSeriesPack,
  onProgress,
  onTextSelect,
  onAnnotationClick,
  onBookmarkClick,
  onUpdateSettings,
  onRegisterFlush,
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
  const [autoAdvancingNext, setAutoAdvancingNext] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const singleTextLayerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const restoreReleaseTimerRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const autoAdvanceTriggeredRef = useRef(false);
  const openedAtRef = useRef<number>(Date.now());
  const selectionTimerRef = useRef<number | null>(null);
  const lastCapturedSelRef = useRef<string>('');
  const lastReportedPageRef = useRef<number>(Math.max(1, book.currentPage || 1));
  const lastReportedRatioRef = useRef<number>(book.scrollRatio ?? 0);
  const didInitialScrollRef = useRef(false);
  const isRestoringRef = useRef(false);
  const restoreTargetRef = useRef<{ page: number; ratio: number } | null>(null);
  const pageSizesRef = useRef<Map<number, { w: number; h: number }>>(new Map());
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;
  const onAnnotationClickRef = useRef(onAnnotationClick);
  onAnnotationClickRef.current = onAnnotationClick;
  const onBookmarkClickRef = useRef(onBookmarkClick);
  onBookmarkClickRef.current = onBookmarkClick;
  const onOpenNextSeriesPackRef = useRef(onOpenNextSeriesPack);
  onOpenNextSeriesPackRef.current = onOpenNextSeriesPack;
  const pageNumRef = useRef(pageNum);
  pageNumRef.current = pageNum;
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;
  const isContinuousRef = useRef((settings.pdfFlow || 'continuous') === 'continuous');
  isContinuousRef.current = (settings.pdfFlow || 'continuous') === 'continuous';

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvancingNext(false);
  }, []);

  const triggerNextPackNow = useCallback(() => {
    if (autoAdvanceTriggeredRef.current || !onOpenNextSeriesPackRef.current) return;
    autoAdvanceTriggeredRef.current = true;
    cancelAutoAdvance();
    onOpenNextSeriesPackRef.current();
  }, [cancelAutoAdvance]);

  useEffect(() => {
    autoAdvanceTriggeredRef.current = false;
    openedAtRef.current = Date.now();
    cancelAutoAdvance();
    return () => cancelAutoAdvance();
  }, [book.id, cancelAutoAdvance]);

  const isContinuous = (settings.pdfFlow || 'continuous') === 'continuous';
  const fitMode: 'width' | 'contain' = settings.pdfFit || 'width';
  const isPhone = viewportMode === 'phone';
  const isVisualPdf = isVisualSeriesKind(book.kind);

  // Single shared IntersectionObserver for all PDF pages (eliminates 1,000+ observers on large Manhwa PDFs!)
  const observerCallbacksRef = useRef<Map<Element, (visible: boolean) => void>>(new Map());
  const sharedObserverRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!isContinuous || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = observerCallbacksRef.current.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { root: stageRef.current, rootMargin: isPhone ? '480px 0px' : '720px 0px' }
    );
    sharedObserverRef.current = obs;
    for (const el of observerCallbacksRef.current.keys()) {
      obs.observe(el);
    }
    return () => {
      obs.disconnect();
      if (sharedObserverRef.current === obs) sharedObserverRef.current = null;
    };
  }, [isContinuous, isPhone, loading]);

  const observeSlot = useCallback((el: HTMLElement, onChange: (visible: boolean) => void) => {
    if (typeof IntersectionObserver === 'undefined') {
      onChange(true);
      return () => undefined;
    }
    observerCallbacksRef.current.set(el, onChange);
    sharedObserverRef.current?.observe(el);
    return () => {
      observerCallbacksRef.current.delete(el);
      sharedObserverRef.current?.unobserve(el);
    };
  }, []);

  // Pre-group annotations by page once (O(1) per page instead of scanning all annotations x 1,000 pages)
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, { pins: BookAnnotation[]; texts: BookAnnotation[] }>();
    for (const a of annotations) {
      const p = a.page || 0;
      if (!p) continue;
      let bucket = map.get(p);
      if (!bucket) {
        bucket = { pins: [], texts: [] };
        map.set(p, bucket);
      }
      if (a.pageX !== undefined && a.pageY !== undefined) bucket.pins.push(a);
      else bucket.texts.push(a);
    }
    return map;
  }, [annotations]);

  const bookmarksByPage = useMemo(() => {
    const map = new Map<number, BookmarkItem[]>();
    for (const bm of bookmarks) {
      const p = bm.page || 0;
      if (!p) continue;
      const list = map.get(p);
      if (list) list.push(bm);
      else map.set(p, [bm]);
    }
    return map;
  }, [bookmarks]);

  const bookmarkDesignsById = useMemo(() => {
    const map = new Map<string, BookmarkDesign>();
    for (const d of bookmarkDesigns) map.set(d.id, d);
    return map;
  }, [bookmarkDesigns]);

  const bookmarkedPageNumbers = useMemo(() => {
    const set = new Set<number>();
    for (const bm of bookmarks) {
      if (bm.page && bm.page >= 1) set.add(bm.page);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [bookmarks]);

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
  // In continuous 'width' mode, ignore minor vertical height jitter (mobile URL bar / keyboard / toast)
  // so scrolling never triggers full page re-renders or layout shifts.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateBox = () => {
      const w = Math.max(260, el.clientWidth - 12);
      const h = Math.max(280, el.clientHeight - 16);
      setViewportBox((prev) => {
        const wChanged = Math.abs(prev.w - w) > 6;
        const hThreshold = isContinuous && fitMode === 'width' ? 120 : 12;
        const hChanged = Math.abs(prev.h - h) > hThreshold;
        return wChanged || hChanged ? { w, h } : prev;
      });
    };
    updateBox();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateBox);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateBox);
    return () => window.removeEventListener('resize', updateBox);
  }, [loading, isContinuous, fitMode]);

  const continuousTargetWidth = Math.min(viewportBox.w, 1020);
  const effectiveMaxHeight = fitMode === 'contain' ? viewportBox.h : 0;

  // Reset cached page dimensions whenever layout scale parameters change
  useEffect(() => {
    pageSizesRef.current.clear();
  }, [book.id, zoom, fitMode, continuousTargetWidth, effectiveMaxHeight]);

  // Measure current visible page + exact intra-page scroll ratio (0..1) synchronously
  const measureContinuousPosition = useCallback((): {
    page: number;
    ratio: number;
    atVeryBottom: boolean;
  } | null => {
    const container = stageRef.current;
    const total = numPagesRef.current;
    if (!container || !total) return null;
    const children = container.querySelectorAll<HTMLElement>('[data-pdf-page]');
    if (!children.length) return null;
    const anchorY = container.scrollTop + Math.min(80, container.clientHeight * 0.22);
    let detectedIdx = 0;
    for (let i = 0; i < children.length; i++) {
      if (children[i].offsetTop <= anchorY) detectedIdx = i;
      else break;
    }
    const atVeryBottom =
      container.scrollHeight > container.clientHeight + 40 &&
      container.scrollTop + container.clientHeight >= container.scrollHeight - 28;
    if (atVeryBottom) {
      detectedIdx = children.length - 1;
    }
    const activeEl = children[detectedIdx];
    const pageH = Math.max(1, activeEl.offsetHeight);
    const intraPx = Math.max(0, container.scrollTop - activeEl.offsetTop);
    const ratio = atVeryBottom
      ? 1
      : Math.min(0.99, Math.max(0, +(intraPx / pageH).toFixed(4)));
    return { page: detectedIdx + 1, ratio, atVeryBottom };
  }, []);

  const flushProgressNow = useCallback(() => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    const total = numPagesRef.current;
    if (!total) return;
    if (isContinuousRef.current) {
      if (isRestoringRef.current) return;
      const measured = measureContinuousPosition();
      if (!measured) return;
      lastReportedPageRef.current = measured.page;
      lastReportedRatioRef.current = measured.ratio;
      onProgressRef.current(measured.page, total, measured.ratio);
    } else {
      const p = pageNumRef.current;
      lastReportedPageRef.current = p;
      lastReportedRatioRef.current = 0;
      onProgressRef.current(p, total, 0);
    }
  }, [measureContinuousPosition]);

  useEffect(() => {
    onRegisterFlush?.(flushProgressNow);
    return () => {
      flushProgressNow();
      onRegisterFlush?.(null);
    };
  }, [onRegisterFlush, flushProgressNow]);

  // Compensate scrollTop whenever a page ABOVE the current viewport changes height after rendering,
  // eliminating involuntary upward/downward jumps while scrolling!
  const handlePageSizeMeasured = useCallback(
    (pn: number, w: number, h: number, slotEl: HTMLElement | null) => {
      const prev = pageSizesRef.current.get(pn);
      const estW = Math.max(240, Math.round(continuousTargetWidth * zoom));
      const estH = Math.round(estW * defaultAspect);
      const oldH = prev?.h ?? estH;
      pageSizesRef.current.set(pn, { w, h });

      const container = stageRef.current;
      if (!container || !slotEl || !isContinuousRef.current) return;

      // If we are still aligning initial restore target and this IS the target page, snap precisely!
      if (isRestoringRef.current && restoreTargetRef.current?.page === pn) {
        const targetOffset =
          slotEl.offsetTop + Math.round(h * Math.max(0, Math.min(0.98, restoreTargetRef.current.ratio)));
        container.scrollTop = targetOffset;
        return;
      }

      const delta = h - oldH;
      if (Math.abs(delta) >= 2 && slotEl.offsetTop + oldH <= container.scrollTop + 4) {
        container.scrollTop += delta;
      }
    },
    [continuousTargetWidth, zoom, defaultAspect]
  );

  useEffect(() => {
    let active = true;
    let docRef: PDFDocumentProxy | null = null;
    let cleanupUrl: (() => void) | null = null;
    didInitialScrollRef.current = false;
    isRestoringRef.current = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const opened = await openPdfFromBlobReliably(blob);
        docRef = opened.doc;
        cleanupUrl = opened.cleanup;
        if (!active) {
          await opened.doc.destroy();
          opened.cleanup();
          return;
        }
        try {
          const firstPage = await opened.doc.getPage(1);
          const vp1 = firstPage.getViewport({ scale: 1 });
          if (vp1.width > 0 && vp1.height > 0) {
            // Clamp initial placeholder aspect so ultra-tall pages don't distort offscreen estimates
            setDefaultAspect(Math.min(4.5, Math.max(0.5, vp1.height / vp1.width)));
          }
        } catch {
          // keep default aspect
        }
        setPdfDoc(opened.doc);
        setNumPages(opened.doc.numPages);
        const startPage = Math.min(
          opened.doc.numPages,
          Math.max(1, jumpTarget?.page || book.currentPage || 1)
        );
        const startRatio =
          jumpTarget?.scrollRatio !== undefined
            ? jumpTarget.scrollRatio
            : !jumpTarget && book.scrollRatio !== undefined
            ? book.scrollRatio
            : 0;
        restoreTargetRef.current = { page: startPage, ratio: startRatio };
        setPageNum(startPage);
        lastReportedPageRef.current = startPage;
        lastReportedRatioRef.current = startRatio;
        // Only emit initial progress if pageCount was missing or clamped, ALWAYS preserving scrollRatio!
        if (!book.pageCount || book.pageCount !== opened.doc.numPages || book.currentPage !== startPage) {
          onProgressRef.current(startPage, opened.doc.numPages, startRatio);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error al abrir PDF');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      if (restoreReleaseTimerRef.current) window.clearTimeout(restoreReleaseTimerRef.current);
      docRef?.destroy().catch(() => undefined);
      cleanupUrl?.();
    };
  }, [book.id, blob]);

  const scrollToPdfPage = useCallback((targetPage: number, smooth = true, intraRatio = 0) => {
    const el = stageRef.current;
    if (!el) return;
    const node = el.querySelector(`[data-pdf-page="${targetPage}"]`) as HTMLElement | null;
    if (!node) return;
    const clampedRatio = Math.max(0, Math.min(0.98, intraRatio || 0));
    const targetTop = node.offsetTop + Math.round(node.offsetHeight * clampedRatio);
    el.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Scroll to exact saved page + intra-page ratio when entering continuous mode
  useEffect(() => {
    if (!isContinuous || !numPages || loading) return;
    const target = restoreTargetRef.current || {
      page: pageNum,
      ratio: lastReportedRatioRef.current || 0,
    };
    if (!didInitialScrollRef.current && (target.page > 1 || target.ratio > 0.01)) {
      didInitialScrollRef.current = true;
      isRestoringRef.current = true;
      const runRestore = () => scrollToPdfPage(target.page, false, target.ratio);
      requestAnimationFrame(() => {
        runRestore();
        window.setTimeout(runRestore, 90);
      });
      if (restoreReleaseTimerRef.current) window.clearTimeout(restoreReleaseTimerRef.current);
      restoreReleaseTimerRef.current = window.setTimeout(() => {
        isRestoringRef.current = false;
        restoreTargetRef.current = null;
      }, 360);
    } else {
      didInitialScrollRef.current = true;
      isRestoringRef.current = false;
      restoreTargetRef.current = null;
    }
  }, [isContinuous, numPages, loading, scrollToPdfPage]);

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
        const safe = computeSafePdfScale(baseVp.width, baseVp.height, cssScale, isPhone);
        const cssViewport = page.getViewport({ scale: cssScale });
        const viewport = page.getViewport({ scale: safe.renderScale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        canvas.width = safe.canvasW;
        canvas.height = safe.canvasH;
        canvas.style.width = `${safe.cssW}px`;
        canvas.style.height = `${safe.cssH}px`;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled) return;

        if (!isVisualPdf) {
          const textContainer = singleTextLayerRef.current;
          if (textContainer) {
            textContainer.innerHTML = '';
            textContainer.style.setProperty('--scale-factor', String(cssScale));
            textContainer.style.width = `${safe.cssW}px`;
            textContainer.style.height = `${safe.cssH}px`;
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
      const targetRatio = jumpTarget.scrollRatio ?? 0;
      setPageNum(clamped);
      lastReportedPageRef.current = clamped;
      lastReportedRatioRef.current = targetRatio;
      onProgressRef.current(clamped, numPages, targetRatio);
      if (isContinuous) {
        isRestoringRef.current = true;
        restoreTargetRef.current = { page: clamped, ratio: targetRatio };
        scrollToPdfPage(clamped, true, targetRatio);
        if (restoreReleaseTimerRef.current) window.clearTimeout(restoreReleaseTimerRef.current);
        restoreReleaseTimerRef.current = window.setTimeout(() => {
          isRestoringRef.current = false;
          restoreTargetRef.current = null;
        }, 480);
      }
      if (jumpTarget.annotationId) {
        setPulsingAnnId(jumpTarget.annotationId);
        window.setTimeout(() => setPulsingAnnId(null), 2600);
      }
    }
  }, [jumpTarget?.id, numPages, isContinuous, scrollToPdfPage]);

  const advancePdfPageOrNextPack = useCallback(() => {
    if (pageNum >= numPages && numPages > 0 && onOpenNextSeriesPackRef.current) {
      triggerNextPackNow();
      return;
    }
    setPageNum((p) => Math.min(numPages, p + 1));
  }, [pageNum, numPages, triggerNextPackNow]);

  useEffect(() => {
    if (isContinuous) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') advancePdfPageOrNextPack();
      if (e.key === 'ArrowLeft') setPageNum((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, isContinuous, advancePdfPageOrNextPack]);

  const handleContinuousScroll = () => {
    if (!stageRef.current || !numPages || isRestoringRef.current) return;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      if (isRestoringRef.current) return;
      const measured = measureContinuousPosition();
      if (!measured) return;
      const { page: detected, ratio, atVeryBottom } = measured;
      setPageNum(detected);
      if (
        detected !== lastReportedPageRef.current ||
        Math.abs(ratio - lastReportedRatioRef.current) >= 0.02
      ) {
        lastReportedPageRef.current = detected;
        lastReportedRatioRef.current = ratio;
        onProgressRef.current(detected, numPages, ratio);
      }

      // Seamless auto-advance when user reaches the very bottom of the last page of a chapter pack!
      if (
        atVeryBottom &&
        onOpenNextSeriesPackRef.current &&
        !autoAdvanceTriggeredRef.current &&
        Date.now() - openedAtRef.current > 1000
      ) {
        if (autoAdvanceTimerRef.current === null) {
          setAutoAdvancingNext(true);
          autoAdvanceTimerRef.current = window.setTimeout(() => {
            triggerNextPackNow();
          }, 950);
        }
      } else if (!atVeryBottom && autoAdvanceTimerRef.current !== null) {
        cancelAutoAdvance();
      }
    }, 150);
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

  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);
  const singleCanvasFilter = getPdfCanvasFilter(settings.theme);
  const singlePageBookmarks = bookmarksByPage.get(pageNum) ?? EMPTY_BM_LIST;
  const singlePrimaryBookmark = singlePageBookmarks[0];
  const singleBookmarkDesign = singlePrimaryBookmark
    ? (singlePrimaryBookmark.designId && bookmarkDesignsById.get(singlePrimaryBookmark.designId)) ||
      defaultBookmarkDesign ||
      null
    : null;

  const renderSliderBookmarkDots = () => {
    if (numPages <= 1 || bookmarkedPageNumbers.length === 0) return null;
    return (
      <div className="reader-slider-dots" aria-hidden="true">
        {bookmarkedPageNumbers.map((pn) => {
          const leftPct = Math.min(100, Math.max(0, ((pn - 1) / Math.max(1, numPages - 1)) * 100));
          return (
            <span
              key={pn}
              className={`reader-slider-bm-dot${pn === pageNum ? ' is-current' : ''}`}
              style={{ left: `${leftPct}%` }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {isContinuous ? (
        <div
          ref={stageRef}
          onScroll={handleContinuousScroll}
          onMouseUp={capturePdfTextSelection}
          onTouchStart={(e) => {
            if (e.touches.length === 1) {
              touchStartRef.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                t: Date.now(),
              };
            } else {
              touchStartRef.current = null;
            }
          }}
          onTouchEnd={(e) => {
            window.setTimeout(capturePdfTextSelection, 220);
            const activeSel = window.getSelection();
            if (activeSel && !activeSel.isCollapsed) {
              touchStartRef.current = null;
              return;
            }
            if (!settings.tapToScroll || hasOpenOverlay || !touchStartRef.current || pinMode || zoom > 1.05) {
              touchStartRef.current = null;
              return;
            }
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartRef.current.x;
            const dy = t.clientY - touchStartRef.current.y;
            const dt = Date.now() - touchStartRef.current.t;
            touchStartRef.current = null;
            const targetEl = e.target as HTMLElement | null;
            if (
              targetEl?.closest(
                'button, a, input, .page-pin-badge, .reader-page-bookmark-ribbon, mark.komo-inline-mark, .komo-inline-badge'
              )
            ) {
              return;
            }
            if (Math.hypot(dx, dy) <= 10 && dt >= 25 && dt <= 300 && stageRef.current) {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (t.clientX - rect.left) / Math.max(1, rect.width);
              const stepPx = Math.max(180, Math.round(stageRef.current.clientHeight * 0.8));
              if (ratio >= 0.78) {
                stageRef.current.scrollBy({ top: stepPx, behavior: 'smooth' });
              } else if (ratio <= 0.22) {
                stageRef.current.scrollBy({ top: -stepPx, behavior: 'smooth' });
              }
            }
          }}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: zoom > 1 ? 'auto' : 'hidden',
            overflowAnchor: 'auto',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: 'column',
            alignItems: zoom > 1 ? 'flex-start' : 'center',
            gap: 8,
            padding: '8px 6px 36px',
          }}
        >
          {pageNumbers.map((pn) => {
            const pageAnns = annotationsByPage.get(pn);
            return (
              <LazyPdfPage
                key={pn}
                pdfDoc={pdfDoc}
                pageNumber={pn}
                targetWidth={continuousTargetWidth}
                targetMaxHeight={effectiveMaxHeight}
                fitMode={fitMode}
                zoom={zoom}
                paperTheme={settings.theme}
                defaultAspect={defaultAspect}
                cachedSize={pageSizesRef.current.get(pn)}
                skipTextLayer={isVisualPdf}
                isPhone={isPhone}
                observeSlot={observeSlot}
                onSizeMeasured={handlePageSizeMeasured}
                pinAnnotations={pageAnns?.pins ?? EMPTY_ANN_LIST}
                textAnnotations={pageAnns?.texts ?? EMPTY_ANN_LIST}
                pageBookmarks={bookmarksByPage.get(pn) ?? EMPTY_BM_LIST}
                bookmarkDesignsById={bookmarkDesignsById}
                defaultBookmarkDesign={defaultBookmarkDesign}
                pinMode={pinMode}
                numPages={numPages}
                highlightAnnId={jumpTarget?.page === pn ? pulsingAnnId : null}
                onTextSelect={onTextSelect}
                onAnnotationClick={onAnnotationClick}
                onBookmarkClick={onBookmarkClick}
              />
            );
          })}
          {nextSeriesLabel && onOpenNextSeriesPack && (
            <div
              style={{
                width: 'min(100%, 540px)',
                margin: '18px auto 12px',
                padding: '16px 18px',
                borderRadius: 16,
                background: 'var(--card-bg, rgba(128,128,128,0.12))',
                border: '1px solid var(--border-subtle, rgba(128,128,128,0.22))',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.78 }}>
                {autoAdvancingNext
                  ? `Pasando automáticamente a ${nextSeriesLabel}...`
                  : `Fin de este lote · Siguiente: ${nextSeriesLabel}`}
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="coral-cta-btn"
                  style={{ height: 36, fontSize: 12.5, padding: '0 16px' }}
                  onClick={triggerNextPackNow}
                >
                  Continuar a {nextSeriesLabel} <ChevronRight size={15} />
                </button>
                {autoAdvancingNext && (
                  <button
                    type="button"
                    className="pill-btn"
                    style={{ height: 36, fontSize: 12 }}
                    onClick={cancelAutoAdvance}
                  >
                    Quedarme aquí
                  </button>
                )}
              </div>
            </div>
          )}
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
              touchStartRef.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                t: Date.now(),
              };
            } else {
              touchStartRef.current = null;
            }
          }}
          onTouchEnd={(e) => {
            window.setTimeout(capturePdfTextSelection, 220);
            const activeSel = window.getSelection();
            if (activeSel && !activeSel.isCollapsed) {
              touchStartRef.current = null;
              return;
            }
            if (hasOpenOverlay || !touchStartRef.current || pinMode || zoom > 1.05) {
              touchStartRef.current = null;
              return;
            }
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartRef.current.x;
            const dy = t.clientY - touchStartRef.current.y;
            const dt = Date.now() - touchStartRef.current.t;
            touchStartRef.current = null;
            const targetEl = e.target as HTMLElement | null;
            if (
              targetEl?.closest(
                'button, a, input, .page-pin-badge, .reader-page-bookmark-ribbon, mark.komo-inline-mark, .komo-inline-badge'
              )
            ) {
              return;
            }
            if (Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 650) {
              if (dx < 0) advancePdfPageOrNextPack();
              else setPageNum((p) => Math.max(1, p - 1));
            } else if (Math.hypot(dx, dy) <= 10 && dt >= 25 && dt <= 300) {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (t.clientX - rect.left) / Math.max(1, rect.width);
              if (ratio >= 0.78) {
                advancePdfPageOrNextPack();
              } else if (ratio <= 0.22) {
                setPageNum((p) => Math.max(1, p - 1));
              }
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
            {singlePrimaryBookmark && (
              <button
                type="button"
                className="reader-page-bookmark-ribbon"
                title={`Separador: ${singleBookmarkDesign?.name || singlePrimaryBookmark.label} (Pág. ${pageNum})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onBookmarkClickRef.current?.(singlePrimaryBookmark);
                }}
              >
                {singleBookmarkDesign?.imageUrl ? (
                  <img src={singleBookmarkDesign.imageUrl} alt={singleBookmarkDesign.name} />
                ) : (
                  <span className="reader-page-bookmark-fallback" aria-hidden="true" />
                )}
                {singlePageBookmarks.length > 1 && (
                  <span className="reader-page-bookmark-count">{singlePageBookmarks.length}</span>
                )}
              </button>
            )}
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
            <div className="reader-slider-wrap">
              <input
                type="range"
                min={1}
                max={Math.max(1, numPages)}
                value={pageNum}
                onChange={(e) => {
                  const p = Number(e.target.value);
                  setPageNum(p);
                  lastReportedPageRef.current = p;
                  lastReportedRatioRef.current = 0;
                  onProgressRef.current(p, numPages, 0);
                  if (isContinuous) scrollToPdfPage(p, false, 0);
                }}
                className="reader-bottom-slider"
              />
              {renderSliderBookmarkDots()}
            </div>
            {!isContinuous && (
              <button
                type="button"
                className="circle-arrow-btn reader-bottom-icon"
                onClick={advancePdfPageOrNextPack}
                disabled={pageNum >= numPages && !onOpenNextSeriesPack}
                title={
                  pageNum >= numPages && nextSeriesLabel
                    ? `Pasar a ${nextSeriesLabel}`
                    : 'Página siguiente'
                }
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

          <div className="reader-slider-wrap">
            <input
              type="range"
              min={1}
              max={Math.max(1, numPages)}
              value={pageNum}
              onChange={(e) => {
                const p = Number(e.target.value);
                setPageNum(p);
                lastReportedPageRef.current = p;
                lastReportedRatioRef.current = 0;
                onProgressRef.current(p, numPages, 0);
                if (isContinuous) scrollToPdfPage(p, false, 0);
              }}
              className="reader-bottom-slider"
            />
            {renderSliderBookmarkDots()}
          </div>

          {!isContinuous && (
            <button
              type="button"
              className="circle-arrow-btn reader-bottom-icon"
              onClick={advancePdfPageOrNextPack}
              disabled={pageNum >= numPages && !onOpenNextSeriesPack}
              title={
                pageNum >= numPages && nextSeriesLabel
                  ? `Pasar a ${nextSeriesLabel}`
                  : 'Página siguiente'
              }
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
