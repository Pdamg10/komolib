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
import {
  extractCbrPages,
  openCbzArchive,
  type ComicPage,
  type LazyCbzArchive,
} from '../../parsers/comicParser';
import type {
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  ComicReadMode,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import type { ReaderSelectionPayload } from './TextRichReader';

const EMPTY_ANN_LIST: BookAnnotation[] = [];
const EMPTY_BM_LIST: BookmarkItem[] = [];

interface ComicMangaReaderProps {
  book: BookItem;
  blob: Blob;
  extraImages?: Blob[];
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

const FIT_CYCLE: Array<ReaderSettings['comicFit']> = ['width', 'contain', 'height', 'original'];
const FIT_LABELS: Record<ReaderSettings['comicFit'], string> = {
  width: 'Ancho',
  contain: 'Pantalla',
  height: 'Alto',
  original: 'Original',
};

interface LazyComicStripSlotProps {
  pageNo: number;
  pageName: string;
  staticUrl: string;
  archive: LazyCbzArchive | null;
  cachedHeight?: number;
  observeSlot: (el: HTMLElement, onChange: (visible: boolean) => void) => () => void;
  onHeightMeasured: (pageNo: number, height: number, slotEl: HTMLElement | null) => void;
  wrapperStyle: React.CSSProperties;
  imgStyle: React.CSSProperties;
  pinMode: boolean;
  totalPages: number;
  pagePins: BookAnnotation[];
  pageBookmarks: BookmarkItem[];
  bookmarkDesignsById: Map<string, BookmarkDesign>;
  defaultBookmarkDesign?: BookmarkDesign | null;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onBookmarkClick?: (bm: BookmarkItem) => void;
}

const LazyComicStripSlot: React.FC<LazyComicStripSlotProps> = React.memo(
  ({
    pageNo,
    pageName,
    staticUrl,
    archive,
    cachedHeight,
    observeSlot,
    onHeightMeasured,
    wrapperStyle,
    imgStyle,
    pinMode,
    totalPages,
    pagePins,
    pageBookmarks,
    bookmarkDesignsById,
    defaultBookmarkDesign,
    onTextSelect,
    onAnnotationClick,
    onBookmarkClick,
  }) => {
    const slotRef = useRef<HTMLDivElement>(null);
    const [isNear, setIsNear] = useState(pageNo <= 3);
    const [url, setUrl] = useState(staticUrl);
    const [imgLoaded, setImgLoaded] = useState(false);
    const [knownHeight, setKnownHeight] = useState<number>(cachedHeight || 720);
    const onHeightMeasuredRef = useRef(onHeightMeasured);
    onHeightMeasuredRef.current = onHeightMeasured;

    useEffect(() => {
      setUrl(staticUrl);
    }, [staticUrl]);

    useEffect(() => {
      if (!isNear) {
        setImgLoaded(false);
      }
    }, [isNear]);

    useEffect(() => {
      const el = slotRef.current;
      if (!el) return;
      return observeSlot(el, setIsNear);
    }, [observeSlot]);

    useEffect(() => {
      if (!isNear || !archive || staticUrl) return;
      let cancelled = false;
      archive
        .getPageUrl(pageNo - 1)
        .then((u) => {
          if (!cancelled && u) setUrl(u);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [isNear, archive, pageNo, staticUrl]);

    const effectiveHeight = cachedHeight || knownHeight;
    const primaryBookmark = pageBookmarks[0];
    const bookmarkDesign = primaryBookmark
      ? (primaryBookmark.designId && bookmarkDesignsById.get(primaryBookmark.designId)) ||
        defaultBookmarkDesign ||
        null
      : null;

    return (
      <div
        ref={slotRef}
        data-comic-page={pageNo}
        style={{
          position: 'relative',
          marginLeft: 'auto',
          marginRight: 'auto',
          cursor: pinMode ? 'crosshair' : 'default',
          // Keep minHeight until image actually finishes loading so slot NEVER collapses to 0px mid-scroll!
          minHeight: isNear && url && imgLoaded ? undefined : effectiveHeight,
          ...wrapperStyle,
        }}
        onClick={(e) => {
          if (!pinMode || !onTextSelect) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pageX = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100);
          const pageY = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100);
          const pct = totalPages ? Math.round((pageNo / totalPages) * 100) : 0;
          onTextSelect({
            quote: `Viñeta pág. ${pageNo}`,
            page: pageNo,
            progress: pct,
            pageX,
            pageY,
          });
        }}
      >
        {isNear && url ? (
          <img
            src={url}
            alt={pageName ? `Página ${pageNo}` : `Página ${pageNo}`}
            decoding="async"
            loading="lazy"
            style={imgStyle}
            onLoad={(e) => {
              const h = Math.round(e.currentTarget.getBoundingClientRect().height);
              setImgLoaded(true);
              if (h > 40) {
                setKnownHeight(h);
                onHeightMeasuredRef.current(pageNo, h, slotRef.current);
              }
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: effectiveHeight,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Pág. {pageNo}
          </div>
        )}
        {primaryBookmark && (
          <button
            type="button"
            className="reader-page-bookmark-ribbon"
            title={`Separador: ${bookmarkDesign?.name || primaryBookmark.label} (Pág. ${pageNo})`}
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
  }
);

export const ComicMangaReader: React.FC<ComicMangaReaderProps> = ({
  book,
  blob,
  extraImages,
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
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [cbzArchive, setCbzArchive] = useState<LazyCbzArchive | null>(null);
  const [pagedUrls, setPagedUrls] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(Math.max(0, (book.currentPage || 1) - 1));
  const [zoom, setZoom] = useState(1);
  const [autoAdvancingNext, setAutoAdvancingNext] = useState(false);

  const stripRef = useRef<HTMLDivElement>(null);
  const observerCallbacksRef = useRef<Map<Element, (visible: boolean) => void>>(new Map());
  const sharedObserverRef = useRef<IntersectionObserver | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTouchHandledAtRef = useRef<number>(0);
  const scrollTimerRef = useRef<number | null>(null);
  const restoreReleaseTimerRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const autoAdvanceTriggeredRef = useRef(false);
  const openedAtRef = useRef<number>(Date.now());
  const lastReportedPageRef = useRef<number>(Math.max(1, book.currentPage || 1));
  const lastReportedRatioRef = useRef<number>(book.scrollRatio ?? 0);
  const didInitialStripScrollRef = useRef<boolean>(false);
  const isRestoringRef = useRef<boolean>(false);
  const restoreTargetRef = useRef<{ page: number; ratio: number } | null>(null);
  const pageHeightsRef = useRef<Map<number, number>>(new Map());
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onBookmarkClickRef = useRef(onBookmarkClick);
  onBookmarkClickRef.current = onBookmarkClick;
  const onOpenNextSeriesPackRef = useRef(onOpenNextSeriesPack);
  onOpenNextSeriesPackRef.current = onOpenNextSeriesPack;
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;
  const pagesLenRef = useRef(pages.length);
  pagesLenRef.current = pages.length;
  const isStripRef = useRef(settings.comicMode === 'manhwa-strip');
  isStripRef.current = settings.comicMode === 'manhwa-strip';

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

  useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];
    let openedArchive: LazyCbzArchive | null = null;
    didInitialStripScrollRef.current = false;
    isRestoringRef.current = true;
    pageHeightsRef.current.clear();

    (async () => {
      setLoading(true);
      setError(null);
      setCbzArchive(null);
      setPagedUrls({});
      try {
        let extracted: ComicPage[] = [];
        if (book.format === 'images') {
          const list = extraImages?.length ? extraImages : [blob];
          extracted = list.map((b, i) => ({
            name: `page_${i + 1}`,
            url: URL.createObjectURL(b),
          }));
          extracted.forEach((p) => urlsToRevoke.push(p.url));
        } else if (book.format === 'cbr') {
          extracted = await extractCbrPages(blob);
          extracted.forEach((p) => urlsToRevoke.push(p.url));
        } else {
          // Fast lazy CBZ/ZIP reader: indexes 1,500 pages in ~20ms & extracts on demand!
          openedArchive = await openCbzArchive(blob);
          if (!active) {
            openedArchive.dispose();
            return;
          }
          const initialIdx = Math.min(
            Math.max(0, openedArchive.pageCount - 1),
            Math.max(0, (jumpTarget?.page || book.currentPage || 1) - 1)
          );
          const firstUrl = openedArchive.pageCount > 0 ? await openedArchive.getPageUrl(initialIdx) : '';
          if (!active) {
            openedArchive.dispose();
            return;
          }
          setCbzArchive(openedArchive);
          if (firstUrl) setPagedUrls({ [initialIdx]: firstUrl });
          extracted = openedArchive.pageNames.map((name, i) => ({
            name,
            url: i === initialIdx ? firstUrl : '',
          }));
        }

        if (!active) {
          urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
          openedArchive?.dispose();
          return;
        }
        setPages(extracted);
        if (extracted.length > 0) {
          const initial = Math.min(
            extracted.length - 1,
            Math.max(0, (jumpTarget?.page || book.currentPage || 1) - 1)
          );
          const initialRatio =
            jumpTarget?.scrollRatio !== undefined
              ? jumpTarget.scrollRatio
              : !jumpTarget && book.scrollRatio !== undefined
              ? book.scrollRatio
              : 0;
          restoreTargetRef.current = { page: initial + 1, ratio: initialRatio };
          setCurrentIdx(initial);
          lastReportedPageRef.current = initial + 1;
          lastReportedRatioRef.current = initialRatio;
          if (!book.pageCount || book.pageCount !== extracted.length || book.currentPage !== initial + 1) {
            onProgressRef.current(initial + 1, extracted.length, initialRatio);
          }
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
      if (restoreReleaseTimerRef.current) window.clearTimeout(restoreReleaseTimerRef.current);
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
      openedArchive?.dispose();
    };
  }, [book.id, blob]);

  const isStrip = settings.comicMode === 'manhwa-strip';
  const isRtl =
    settings.comicMode === 'manga-rtl' || settings.comicMode === 'manga-rtl-double';
  const isDouble =
    settings.comicMode === 'manga-rtl-double' || settings.comicMode === 'comic-ltr-double';
  const step = isDouble ? 2 : 1;
  const activeFit: ReaderSettings['comicFit'] = settings.comicFit || 'width';

  // Reset cached heights whenever zoom or fit changes
  useEffect(() => {
    pageHeightsRef.current.clear();
  }, [zoom, activeFit]);

  const pinsByPage = useMemo(() => {
    const map = new Map<number, BookAnnotation[]>();
    for (const a of annotations) {
      if (!a.page || a.pageX === undefined || a.pageY === undefined) continue;
      const list = map.get(a.page);
      if (list) list.push(a);
      else map.set(a.page, [a]);
    }
    return map;
  }, [annotations]);

  const bookmarksByPage = useMemo(() => {
    const map = new Map<number, BookmarkItem[]>();
    for (const bm of bookmarks) {
      if (!bm.page || bm.page < 1) continue;
      const list = map.get(bm.page);
      if (list) list.push(bm);
      else map.set(bm.page, [bm]);
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

  const memoStripWrapperStyle = useMemo<React.CSSProperties>(() => {
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
  }, [activeFit, zoom]);

  const memoStripImgStyle = useMemo<React.CSSProperties>(() => {
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
    return {
      display: 'block',
      width: '100%',
      height: 'auto',
      objectFit: 'contain',
    };
  }, [activeFit, zoom]);

  const measureStripPosition = useCallback((): {
    page: number;
    ratio: number;
    atVeryBottom: boolean;
  } | null => {
    const container = stripRef.current;
    const total = pagesLenRef.current;
    if (!container || !total) return null;
    const children = container.querySelectorAll<HTMLElement>('[data-comic-page]');
    const atVeryBottom =
      container.scrollHeight > container.clientHeight + 40 &&
      container.scrollTop + container.clientHeight >= container.scrollHeight - 28;
    if (children.length > 0) {
      const anchorY = container.scrollTop + Math.min(80, container.clientHeight * 0.22);
      let detectedIdx = 0;
      for (let i = 0; i < children.length; i++) {
        if (children[i].offsetTop <= anchorY) detectedIdx = i;
        else break;
      }
      if (atVeryBottom) detectedIdx = children.length - 1;
      const activeEl = children[detectedIdx];
      const pageH = Math.max(1, activeEl.offsetHeight);
      const intraPx = Math.max(0, container.scrollTop - activeEl.offsetTop);
      const ratio = atVeryBottom
        ? 1
        : Math.min(0.99, Math.max(0, +(intraPx / pageH).toFixed(4)));
      return { page: detectedIdx + 1, ratio, atVeryBottom };
    }
    const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
    const r = container.scrollTop / maxScroll;
    const p = Math.min(total, Math.max(1, Math.round(r * (total - 1)) + 1));
    return { page: p, ratio: 0, atVeryBottom };
  }, []);

  const flushProgressNow = useCallback(() => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    const total = pagesLenRef.current;
    if (!total) return;
    if (isStripRef.current) {
      if (isRestoringRef.current) return;
      const measured = measureStripPosition();
      if (!measured) return;
      lastReportedPageRef.current = measured.page;
      lastReportedRatioRef.current = measured.ratio;
      onProgressRef.current(measured.page, total, measured.ratio);
    } else {
      const p = currentIdxRef.current + 1;
      lastReportedPageRef.current = p;
      lastReportedRatioRef.current = 0;
      onProgressRef.current(p, total, 0);
    }
  }, [measureStripPosition]);

  useEffect(() => {
    onRegisterFlush?.(flushProgressNow);
    return () => {
      flushProgressNow();
      onRegisterFlush?.(null);
    };
  }, [onRegisterFlush, flushProgressNow]);

  // Compensate scrollTop whenever an image ABOVE the viewport changes height from placeholder -> real height
  const handleSlotHeightMeasured = useCallback(
    (pageNo: number, newH: number, slotEl: HTMLElement | null) => {
      const oldH = pageHeightsRef.current.get(pageNo) ?? 720;
      pageHeightsRef.current.set(pageNo, newH);

      const container = stripRef.current;
      if (!container || !slotEl || !isStripRef.current) return;

      if (isRestoringRef.current && restoreTargetRef.current?.page === pageNo) {
        const targetOffset =
          slotEl.offsetTop + Math.round(newH * Math.max(0, Math.min(0.98, restoreTargetRef.current.ratio)));
        container.scrollTop = targetOffset;
        return;
      }

      const delta = newH - oldH;
      if (Math.abs(delta) >= 2 && slotEl.offsetTop + oldH <= container.scrollTop + 4) {
        container.scrollTop += delta;
      }
    },
    []
  );

  // Single shared IntersectionObserver for lazy strip pages
  useEffect(() => {
    if (!isStrip || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = observerCallbacksRef.current.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { root: stripRef.current, rootMargin: '650px 0px' }
    );
    sharedObserverRef.current = obs;
    for (const el of observerCallbacksRef.current.keys()) {
      obs.observe(el);
    }
    return () => {
      obs.disconnect();
      if (sharedObserverRef.current === obs) sharedObserverRef.current = null;
    };
  }, [isStrip, loading]);

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

  // Load current + prefetch next 2 pages in paged mode for lazy CBZ archives
  useEffect(() => {
    if (isStrip || !cbzArchive || pages.length === 0) return;
    let cancelled = false;
    const indices = [currentIdx, currentIdx + 1, currentIdx + 2, currentIdx - 1].filter(
      (i) => i >= 0 && i < cbzArchive.pageCount
    );
    (async () => {
      for (const idx of indices) {
        if (cancelled) return;
        const u = await cbzArchive.getPageUrl(idx);
        if (!cancelled && u) {
          setPagedUrls((prev) => (prev[idx] === u ? prev : { ...prev, [idx]: u }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStrip, cbzArchive, currentIdx, pages.length]);

  const scrollToStripPage = useCallback((pageOneBased: number, smooth = true, intraRatio = 0) => {
    const el = stripRef.current;
    if (!el) return;
    const targetEl = el.querySelector(
      `[data-comic-page="${pageOneBased}"]`
    ) as HTMLElement | null;
    if (!targetEl) return;
    const clampedRatio = Math.max(0, Math.min(0.98, intraRatio || 0));
    const targetTop = targetEl.offsetTop + Math.round(targetEl.offsetHeight * clampedRatio);
    el.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // When entering continuous strip mode (initial open or switching from paged), jump to exact page + ratio
  useEffect(() => {
    if (!isStrip || !pages.length || loading) return;
    const target = restoreTargetRef.current || {
      page: currentIdx + 1,
      ratio: lastReportedRatioRef.current || 0,
    };
    if (!didInitialStripScrollRef.current && (target.page > 1 || target.ratio > 0.01)) {
      didInitialStripScrollRef.current = true;
      isRestoringRef.current = true;
      const runRestore = () => scrollToStripPage(target.page, false, target.ratio);
      requestAnimationFrame(() => {
        runRestore();
        window.setTimeout(runRestore, 90);
      });
      if (restoreReleaseTimerRef.current) window.clearTimeout(restoreReleaseTimerRef.current);
      restoreReleaseTimerRef.current = window.setTimeout(() => {
        isRestoringRef.current = false;
        restoreTargetRef.current = null;
      }, 380);
    } else {
      didInitialStripScrollRef.current = true;
      isRestoringRef.current = false;
      restoreTargetRef.current = null;
    }
  }, [isStrip, pages.length, loading, scrollToStripPage]);

  const goNext = useCallback(() => {
    if (!pages.length) return;
    if (currentIdx >= pages.length - 1 && onOpenNextSeriesPackRef.current) {
      triggerNextPackNow();
      return;
    }
    setCurrentIdx((prev) => {
      const next = Math.min(pages.length - 1, prev + step);
      lastReportedPageRef.current = next + 1;
      lastReportedRatioRef.current = 0;
      onProgressRef.current(next + 1, pages.length, 0);
      return next;
    });
  }, [pages.length, step, currentIdx, triggerNextPackNow]);

  const goPrev = useCallback(() => {
    if (!pages.length) return;
    setCurrentIdx((prev) => {
      const next = Math.max(0, prev - step);
      lastReportedPageRef.current = next + 1;
      lastReportedRatioRef.current = 0;
      onProgressRef.current(next + 1, pages.length, 0);
      return next;
    });
  }, [pages.length, step]);

  useEffect(() => {
    if (!jumpTarget?.page || !pages.length) return;
    const targetIdx = Math.min(pages.length - 1, Math.max(0, jumpTarget.page - 1));
    const targetRatio = jumpTarget.scrollRatio ?? 0;
    setCurrentIdx(targetIdx);
    lastReportedPageRef.current = targetIdx + 1;
    lastReportedRatioRef.current = targetRatio;
    onProgressRef.current(targetIdx + 1, pages.length, targetRatio);
    if (isStrip) {
      isRestoringRef.current = true;
      restoreTargetRef.current = { page: targetIdx + 1, ratio: targetRatio };
      scrollToStripPage(targetIdx + 1, true, targetRatio);
      if (restoreReleaseTimerRef.current) window.clearTimeout(restoreReleaseTimerRef.current);
      restoreReleaseTimerRef.current = window.setTimeout(() => {
        isRestoringRef.current = false;
        restoreTargetRef.current = null;
      }, 480);
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

  // Measure actual visible page + intra-page offset in continuous strip mode (150ms debounce + flush on exit)
  const handleStripScroll = () => {
    const el = stripRef.current;
    if (!el || !pages.length || isRestoringRef.current) return;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      if (isRestoringRef.current) return;
      const measured = measureStripPosition();
      if (!measured) return;
      const { page: detectedPage, ratio, atVeryBottom } = measured;
      setCurrentIdx(detectedPage - 1);
      if (
        detectedPage !== lastReportedPageRef.current ||
        Math.abs(ratio - lastReportedRatioRef.current) >= 0.02
      ) {
        lastReportedPageRef.current = detectedPage;
        lastReportedRatioRef.current = ratio;
        onProgressRef.current(detectedPage, pages.length, ratio);
      }

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

  const renderSliderBookmarkDots = () => {
    if (pages.length <= 1 || bookmarkedPageNumbers.length === 0) return null;
    const reverseRtl = !isStrip && isRtl;
    return (
      <div className="reader-slider-dots" aria-hidden="true">
        {bookmarkedPageNumbers.map((pn) => {
          const rawPct = Math.min(100, Math.max(0, ((pn - 1) / Math.max(1, pages.length - 1)) * 100));
          const leftPct = reverseRtl ? 100 - rawPct : rawPct;
          return (
            <span
              key={pn}
              className={`reader-slider-bm-dot${pn === currentIdx + 1 ? ' is-current' : ''}`}
              style={{ left: `${leftPct}%` }}
            />
          );
        })}
      </div>
    );
  };

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
          <div className="reader-slider-wrap">
            <input
              type="range"
              min={0}
              max={Math.max(0, pages.length - 1)}
              value={currentIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setCurrentIdx(idx);
                lastReportedPageRef.current = idx + 1;
                lastReportedRatioRef.current = 0;
                onProgressRef.current(idx + 1, pages.length, 0);
                if (isStrip) scrollToStripPage(idx + 1, false, 0);
              }}
              className="reader-bottom-slider"
              style={{ direction: !isStrip && isRtl ? 'rtl' : 'ltr' }}
            />
            {renderSliderBookmarkDots()}
          </div>
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

        <div className="reader-slider-wrap">
          <input
            type="range"
            min={0}
            max={Math.max(0, pages.length - 1)}
            value={currentIdx}
            onChange={(e) => {
              const idx = Number(e.target.value);
              setCurrentIdx(idx);
              lastReportedPageRef.current = idx + 1;
              lastReportedRatioRef.current = 0;
              onProgressRef.current(idx + 1, pages.length, 0);
              if (isStrip) scrollToStripPage(idx + 1, false, 0);
            }}
            className="reader-bottom-slider"
            style={{ direction: !isStrip && isRtl ? 'rtl' : 'ltr' }}
          />
          {renderSliderBookmarkDots()}
        </div>

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
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div
          ref={stripRef}
          onScroll={handleStripScroll}
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
            if (targetEl?.closest('button, a, .page-pin-badge, .reader-page-bookmark-ribbon')) return;
            if (Math.hypot(dx, dy) <= 10 && dt >= 25 && dt <= 300 && stripRef.current) {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (t.clientX - rect.left) / Math.max(1, rect.width);
              const stepPx = Math.max(200, Math.round(stripRef.current.clientHeight * 0.8));
              if (ratio >= 0.78) {
                stripRef.current.scrollBy({ top: stepPx, behavior: 'smooth' });
              } else if (ratio <= 0.22) {
                stripRef.current.scrollBy({ top: -stepPx, behavior: 'smooth' });
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
            gap: `${settings.comicGap}px`,
            padding: settings.comicGap > 0 ? '8px 0 36px' : '0 0 36px',
          }}
        >
          {pages.map((p, idx) => {
            const pageNo = idx + 1;
            return (
              <LazyComicStripSlot
                key={p.name + idx}
                pageNo={pageNo}
                pageName={p.name}
                staticUrl={p.url}
                archive={cbzArchive}
                cachedHeight={pageHeightsRef.current.get(pageNo)}
                observeSlot={observeSlot}
                onHeightMeasured={handleSlotHeightMeasured}
                wrapperStyle={memoStripWrapperStyle}
                imgStyle={memoStripImgStyle}
                pinMode={pinMode}
                totalPages={pages.length}
                pagePins={pinsByPage.get(pageNo) ?? EMPTY_ANN_LIST}
                pageBookmarks={bookmarksByPage.get(pageNo) ?? EMPTY_BM_LIST}
                bookmarkDesignsById={bookmarkDesignsById}
                defaultBookmarkDesign={defaultBookmarkDesign}
                onTextSelect={onTextSelect}
                onAnnotationClick={onAnnotationClick}
                onBookmarkClick={onBookmarkClick}
              />
            );
          })}
          {nextSeriesLabel && onOpenNextSeriesPack && (
            <div
              style={{
                width: 'min(92%, 540px)',
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
        {renderBottomBar()}
      </div>
    );
  }

  // 2. Paged Manga (RTL) / Comic (LTR) — Single or Double Spread (Responsive, Zero Top-Clipping, Touch Swipe!)
  const resolvePage = (idx: number): ComicPage | undefined => {
    const base = pages[idx];
    if (!base) return undefined;
    const u = base.url || pagedUrls[idx] || '';
    return { name: base.name, url: u };
  };
  const visiblePages = isDouble
    ? [resolvePage(currentIdx), resolvePage(currentIdx + 1)].filter(Boolean) as ComicPage[]
    : ([resolvePage(currentIdx)].filter(Boolean) as ComicPage[]);
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
          if (hasOpenOverlay || !touchStartRef.current || pinMode || zoom > 1.05) {
            touchStartRef.current = null;
            return;
          }
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStartRef.current.x;
          const dy = t.clientY - touchStartRef.current.y;
          const dt = Date.now() - touchStartRef.current.t;
          touchStartRef.current = null;
          if (Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 650) {
            lastTouchHandledAtRef.current = Date.now();
            if (dx < 0) {
              if (isRtl) goPrev();
              else goNext();
            } else {
              if (isRtl) goNext();
              else goPrev();
            }
          } else if (Math.hypot(dx, dy) > 12 || dt > 300) {
            // Suppress synthetic click after a scroll/drag/long-press gesture
            lastTouchHandledAtRef.current = Date.now();
          }
        }}
        onClick={(e) => {
          if (Date.now() - lastTouchHandledAtRef.current < 450) return;
          if (hasOpenOverlay) return;
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
          if (zoom > 1.05) return;
          const targetEl = e.target as HTMLElement | null;
          if (targetEl?.closest('button, a, .page-pin-badge, .reader-page-bookmark-ribbon')) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
          const clickLeft = ratio <= 0.22;
          const clickRight = ratio >= 0.78;
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
          {(() => {
            const pageBms = bookmarksByPage.get(currentIdx + 1) ?? EMPTY_BM_LIST;
            const primaryBm = pageBms[0];
            if (!primaryBm) return null;
            const bmDesign =
              (primaryBm.designId && bookmarkDesignsById.get(primaryBm.designId)) ||
              defaultBookmarkDesign ||
              null;
            return (
              <button
                type="button"
                className="reader-page-bookmark-ribbon"
                title={`Separador: ${bmDesign?.name || primaryBm.label} (Pág. ${currentIdx + 1})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onBookmarkClickRef.current?.(primaryBm);
                }}
              >
                {bmDesign?.imageUrl ? (
                  <img src={bmDesign.imageUrl} alt={bmDesign.name} />
                ) : (
                  <span className="reader-page-bookmark-fallback" aria-hidden="true" />
                )}
                {pageBms.length > 1 && (
                  <span className="reader-page-bookmark-count">{pageBms.length}</span>
                )}
              </button>
            );
          })()}
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
