import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ePub, { type Book, type Contents, type NavItem, type Rendition } from 'epubjs';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type {
  BookAnnotation,
  BookItem,
  BookmarkItem,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import { READER_PALETTES } from './readerThemes';
import type { ReaderSelectionPayload } from './TextRichReader';
import {
  applyAnnotationsToRoot,
  injectReaderMarksStyle,
} from '../../utils/readerMarks';

const EMPTY_BM_LIST: BookmarkItem[] = [];

interface EpubReaderProps {
  book: BookItem;
  blob: Blob;
  settings: ReaderSettings;
  annotations: BookAnnotation[];
  bookmarks?: BookmarkItem[];
  onTocLoaded: (items: Array<{ id: string; title: string; href: string }>) => void;
  jumpHref: string | null;
  jumpTarget?: ReaderJumpTarget | null;
  hasOpenOverlay?: boolean;
  viewportMode?: 'phone' | 'tablet' | 'desktop';
  onProgress: (
    percent: number,
    cfi: string,
    chapter?: string,
    chapterHref?: string,
    page?: number
  ) => void;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onBookmarkClick?: (bm: BookmarkItem) => void;
  onRegisterFlush?: (fn: (() => void) | null) => void;
}

function buildEpubThemeRules(settings: ReaderSettings) {
  const pal = READER_PALETTES[settings.theme];
  const accentLink =
    (typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent-secondary').trim()
      : '') || '#8d7ec7';
  return {
    'html, body, *': {
      'scrollbar-width': 'none !important',
      '-ms-overflow-style': 'none !important',
    },
    '*::-webkit-scrollbar': {
      display: 'none !important',
      width: '0 !important',
      height: '0 !important',
    },
    body: {
      background: `${pal.bg} !important`,
      color: `${pal.fg} !important`,
      'font-family': `${settings.fontFamily}, serif !important`,
      'font-size': `${settings.fontSize}px !important`,
      'line-height': `${settings.lineHeight} !important`,
      'text-align': `${settings.textAlign} !important`,
      'max-width': `${settings.maxWidth}px`,
      margin: '0 auto !important',
      padding: '24px 28px !important',
    },
    'a, a:link': {
      color: `${accentLink} !important`,
    },
    'img, svg, image': {
      'max-width': '100% !important',
      'max-height': '92vh !important',
      width: 'auto !important',
      height: 'auto !important',
      'object-fit': 'contain !important',
      display: 'block !important',
      margin: '0 auto !important',
    },
  };
}

export const EpubReader: React.FC<EpubReaderProps> = ({
  book,
  blob,
  settings,
  annotations,
  bookmarks = EMPTY_BM_LIST,
  onTocLoaded,
  jumpHref,
  jumpTarget,
  hasOpenOverlay = false,
  viewportMode = 'desktop',
  onProgress,
  onTextSelect,
  onAnnotationClick,
  onBookmarkClick,
  onRegisterFlush,
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const tocFlatRef = useRef<Array<{ id: string; title: string; href: string }>>([]);
  const locationsReadyRef = useRef(false);
  const didInitialRelocateRef = useRef(false);
  const lastMarksSigByDocRef = useRef<WeakMap<Document, string>>(new WeakMap());
  const currentMetaRef = useRef<{
    pct: number;
    cfi: string;
    chapter?: string;
    href?: string;
    page?: number;
  }>({
    pct: book.progress || 0,
    cfi: book.currentCfi || '',
    chapter: book.currentChapter,
    page: book.currentPage,
  });
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hasOpenOverlayRef = useRef(hasOpenOverlay);
  hasOpenOverlayRef.current = hasOpenOverlay;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;
  const onAnnotationClickRef = useRef(onAnnotationClick);
  onAnnotationClickRef.current = onAnnotationClick;

  const annotationsSig = useMemo(
    () => annotations.map((a) => `${a.id}:${a.updatedAt}:${a.color}:${a.styleVariant || ''}`).join('|'),
    [annotations]
  );
  const annotationsSigRef = useRef(annotationsSig);
  annotationsSigRef.current = annotationsSig;

  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(book.progress || 0);
  const [chapterLabel, setChapterLabel] = useState(book.currentChapter || '');
  const [pageNum, setPageNum] = useState<number | undefined>(book.currentPage);

  const normalizeHref = (href?: string) =>
    (href || '').split('#')[0].replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();

  const applyMarksToContents = (
    contents: Contents | null | undefined,
    clearSelection = false,
    force = false
  ) => {
    if (!contents?.document?.body) return;
    const doc = contents.document;
    const sig = annotationsSigRef.current;
    if (!force && lastMarksSigByDocRef.current.get(doc) === sig) {
      return;
    }
    lastMarksSigByDocRef.current.set(doc, sig);
    injectReaderMarksStyle(doc);

    if (clearSelection) {
      try {
        contents.window?.getSelection?.()?.removeAllRanges?.();
      } catch {
        // ignore
      }
    }

    const epubBook = epubBookRef.current;
    let sectionHref = '';
    try {
      const spineItem = epubBook?.spine?.get?.(contents.sectionIndex);
      sectionHref = normalizeHref(spineItem?.href || currentMetaRef.current.href);
    } catch {
      sectionHref = normalizeHref(currentMetaRef.current.href);
    }

    applyAnnotationsToRoot(doc, doc.body, annotationsRef.current, {
      resolveRange: (ann) => {
        if (!ann.cfi) return null;
        try {
          return contents.range(ann.cfi) || null;
        } catch {
          return null;
        }
      },
      allowQuoteFallback: (ann) => {
        if (!ann.chapterHref || !sectionHref) return true;
        const annHref = normalizeHref(ann.chapterHref);
        if (!annHref) return true;
        return (
          sectionHref === annHref ||
          sectionHref.endsWith(annHref) ||
          annHref.endsWith(sectionHref)
        );
      },
      onAnnotationClick: (ann) => {
        const latest = annotationsRef.current.find((x) => x.id === ann.id);
        if (latest) onAnnotationClickRef.current?.(latest);
      },
    });
  };

  const syncAllVisibleEpubMarks = (clearSelection = false, force = false) => {
    const r = renditionRef.current;
    if (!r) return;
    try {
      const raw = r.getContents() as unknown as Contents | Contents[];
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const c of list) {
        applyMarksToContents(c, clearSelection, force);
      }
    } catch {
      // ignore if rendition not mounted
    }
  };

  const resolveChapterFromHref = (href?: string): { title?: string; href?: string } => {
    if (!href) return {};
    const clean = href.split('#')[0];
    const match = tocFlatRef.current.find(
      (item) => item.href === href || item.href.split('#')[0] === clean || clean.endsWith(item.href.split('#')[0])
    );
    return match ? { title: match.title, href: match.href } : { href };
  };

  const flushProgressNow = useCallback(() => {
    const r = renditionRef.current;
    const epubBook = epubBookRef.current;
    let meta = currentMetaRef.current;
    if (r) {
      try {
        const loc = r.currentLocation() as unknown as {
          start?: {
            cfi?: string;
            href?: string;
            percentage?: number;
            index?: number;
            displayed?: { page?: number };
          };
        } | null;
        const start = loc?.start;
        if (start?.cfi) {
          let computedPct = meta.pct;
          if (locationsReadyRef.current && epubBook?.locations) {
            const p = epubBook.locations.percentageFromCfi(start.cfi);
            if (typeof p === 'number' && !Number.isNaN(p)) {
              computedPct = Math.min(100, Math.max(0, Math.round(p * 100)));
            }
          } else if (typeof start.percentage === 'number' && start.percentage > 0) {
            computedPct = Math.min(100, Math.max(0, Math.round(start.percentage * 100)));
          }
          const ch = resolveChapterFromHref(start.href);
          meta = {
            pct: computedPct,
            cfi: start.cfi,
            chapter: ch.title || meta.chapter,
            href: ch.href || start.href || meta.href,
            page: start.displayed?.page ?? meta.page,
          };
          currentMetaRef.current = meta;
        }
      } catch {
        // fallback to last known meta
      }
    }
    if (meta.cfi || meta.pct > 0) {
      onProgressRef.current(meta.pct, meta.cfi, meta.chapter, meta.href, meta.page);
    }
  }, []);

  useEffect(() => {
    onRegisterFlush?.(flushProgressNow);
    return () => {
      flushProgressNow();
      onRegisterFlush?.(null);
    };
  }, [onRegisterFlush, flushProgressNow]);

  useEffect(() => {
    let mounted = true;
    let epubInstance: Book | null = null;
    locationsReadyRef.current = false;
    didInitialRelocateRef.current = false;
    lastMarksSigByDocRef.current = new WeakMap();
    currentMetaRef.current = {
      pct: book.progress || 0,
      cfi: book.currentCfi || '',
      chapter: book.currentChapter,
      page: book.currentPage,
    };

    (async () => {
      if (!viewerRef.current) return;
      setLoading(true);
      const ab = await blob.arrayBuffer();
      if (!mounted) return;

      epubInstance = ePub(ab);
      epubBookRef.current = epubInstance;

      const rendition = epubInstance.renderTo(viewerRef.current, {
        width: '100%',
        height: '100%',
        flow: settings.epubFlow === 'scrolled' ? 'scrolled' : 'paginated',
        manager: settings.epubFlow === 'scrolled' ? 'continuous' : 'default',
        spread: 'none',
      });
      renditionRef.current = rendition;

      // Apply typography & theme BEFORE display() so initial CFI layout never shifts post-load!
      rendition.themes.default(buildEpubThemeRules(settingsRef.current));

      // Inject KomoLib reading marks styles & DOM marks into every rendered EPUB section
      // + safe left/right edge tap-to-turn in paginated mode (and optional in scrolled mode)
      rendition.hooks.content.register((contents: Contents) => {
        if (!mounted) return;
        applyMarksToContents(contents, false, true);

        const doc = contents?.document;
        const win = contents?.window;
        if (!doc || !win) return;

        let touchStart: { x: number; y: number; t: number } | null = null;
        let lastTouchTurnAt = 0;

        const isInteractiveTarget = (target: EventTarget | null): boolean => {
          const el = target as HTMLElement | null;
          if (!el || typeof el.closest !== 'function') return false;
          return Boolean(
            el.closest(
              'a, button, input, textarea, select, summary, details, mark.komo-inline-mark, .komo-inline-badge'
            )
          );
        };

        const turnPage = (dir: 'next' | 'prev') => {
          if (settingsRef.current.epubFlow === 'scrolled') {
            const scrollHost = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
            if (scrollHost) {
              const step = Math.max(180, Math.round(scrollHost.clientHeight * 0.8));
              scrollHost.scrollBy({ top: dir === 'next' ? step : -step, behavior: 'smooth' });
              return;
            }
          }
          if (dir === 'next') {
            rendition.next().catch(() => undefined);
          } else {
            rendition.prev().catch(() => undefined);
          }
        };

        const resolveTapZone = (clientX: number): 'prev' | 'next' | 'center' => {
          const viewerRect = viewerRef.current?.getBoundingClientRect();
          const frameRect = win.frameElement?.getBoundingClientRect?.();
          const screenX = frameRect ? frameRect.left + clientX : clientX;
          const width = viewerRect?.width || window.innerWidth || 1;
          const leftEdge = viewerRect?.left || 0;
          const ratio = (screenX - leftEdge) / Math.max(1, width);
          if (ratio >= 0.78) return 'next';
          if (ratio <= 0.22) return 'prev';
          return 'center';
        };

        doc.addEventListener(
          'touchstart',
          (ev: TouchEvent) => {
            if (ev.touches.length === 1) {
              touchStart = {
                x: ev.touches[0].clientX,
                y: ev.touches[0].clientY,
                t: Date.now(),
              };
            } else {
              touchStart = null;
            }
          },
          { passive: true }
        );

        doc.addEventListener(
          'touchend',
          (ev: TouchEvent) => {
            if (!touchStart || ev.changedTouches.length === 0) return;
            const start = touchStart;
            touchStart = null;
            if (hasOpenOverlayRef.current) return;

            const t = ev.changedTouches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            const dt = Date.now() - start.t;

            const selText = (win.getSelection?.()?.toString() || '').trim();
            if (selText.length > 0 || isInteractiveTarget(ev.target)) return;

            const isScrolledFlow = settingsRef.current.epubFlow === 'scrolled';

            // 1. Horizontal swipe turn (paginated mode only — never hijack vertical scroll!)
            if (!isScrolledFlow && Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 650) {
              lastTouchTurnAt = Date.now();
              turnPage(dx < 0 ? 'next' : 'prev');
              return;
            }

            // 2. Clean short tap on outer left/right edges (paginated always; scrolled only if tapToScroll opted in)
            if (
              (!isScrolledFlow || settingsRef.current.tapToScroll) &&
              Math.hypot(dx, dy) <= 10 &&
              dt >= 25 &&
              dt <= 300
            ) {
              const zone = resolveTapZone(t.clientX);
              if (zone !== 'center') {
                lastTouchTurnAt = Date.now();
                turnPage(zone);
              }
            }
          },
          { passive: true }
        );

        // Fallback click handler strictly for touch devices in paginated mode
        doc.addEventListener('click', (ev: MouseEvent) => {
          if (Date.now() - lastTouchTurnAt < 450) return;
          if (hasOpenOverlayRef.current) return;
          if (ev.button !== 0 || isInteractiveTarget(ev.target)) return;
          const isScrolledFlow = settingsRef.current.epubFlow === 'scrolled';
          if (isScrolledFlow && !settingsRef.current.tapToScroll) return;
          const selText = (win.getSelection?.()?.toString() || '').trim();
          if (selText.length > 0) return;
          if (window.innerWidth > 1024 || !('ontouchstart' in window)) return;
          const zone = resolveTapZone(ev.clientX);
          if (zone !== 'center') {
            turnPage(zone);
          }
        });
      });

      rendition.on('rendered', (_section: unknown, view: { contents?: Contents }) => {
        if (!mounted) return;
        if (view?.contents) {
          applyMarksToContents(view.contents, false, false);
        } else {
          syncAllVisibleEpubMarks(false, false);
        }
      });

      rendition.on(
        'relocated',
        (location: {
          start: {
            cfi: string;
            href?: string;
            percentage?: number;
            index?: number;
            displayed?: { page?: number; total?: number };
          };
        }) => {
          const cfi = location?.start?.cfi || '';
          const ch = resolveChapterFromHref(location?.start?.href);
          const displayedPage = location?.start?.displayed?.page;
          let percentage: number;

          if (locationsReadyRef.current && epubInstance?.locations && cfi) {
            const p = epubInstance.locations.percentageFromCfi(cfi);
            percentage =
              typeof p === 'number' && !Number.isNaN(p)
                ? Math.min(100, Math.max(0, Math.round(p * 100)))
                : Math.round(((location?.start?.percentage || 0) as number) * 100);
          } else if (typeof location?.start?.percentage === 'number' && location.start.percentage > 0) {
            percentage = Math.min(100, Math.max(0, Math.round(location.start.percentage * 100)));
          } else if (!didInitialRelocateRef.current && currentMetaRef.current.pct > 0) {
            // Preserve saved progress until locations.generate() finishes — NEVER overwrite with 0%!
            percentage = currentMetaRef.current.pct;
          } else {
            // Estimate from spine index while locations are generating
            const spineItems = (epubInstance?.spine as unknown as { spineItems?: unknown[] })?.spineItems;
            const spineLen = Array.isArray(spineItems) ? spineItems.length : 0;
            const secIdx = typeof location?.start?.index === 'number' ? location.start.index : 0;
            percentage =
              spineLen > 1
                ? Math.min(99, Math.max(currentMetaRef.current.pct > 0 && secIdx === 0 ? currentMetaRef.current.pct : 0, Math.round((secIdx / spineLen) * 100)))
                : currentMetaRef.current.pct;
          }
          didInitialRelocateRef.current = true;

          currentMetaRef.current = {
            pct: percentage,
            cfi: cfi || currentMetaRef.current.cfi,
            chapter: ch.title || currentMetaRef.current.chapter,
            href: ch.href || location?.start?.href,
            page: displayedPage,
          };
          setPct(percentage);
          if (ch.title) setChapterLabel(ch.title);
          if (displayedPage) setPageNum(displayedPage);
          onProgressRef.current(
            percentage,
            cfi || currentMetaRef.current.cfi,
            ch.title || currentMetaRef.current.chapter,
            ch.href || location?.start?.href,
            displayedPage
          );
        }
      );

      // Capture text selection inside EPUB iframe for highlighter / pencil / pen / post-it / sticker / emoji!
      rendition.on('selected', (cfiRange: string, contents: Contents) => {
        try {
          const sel = contents?.window?.getSelection?.();
          const quote = (sel?.toString() || '').replace(/\s+/g, ' ').trim();
          if (quote.length < 2) return;
          const meta = currentMetaRef.current;
          onTextSelectRef.current?.({
            quote: quote.slice(0, 400),
            cfi: cfiRange,
            chapter: meta.chapter,
            chapterHref: meta.href,
            page: meta.page,
            progress: meta.pct,
          });
        } catch {
          // ignore iframe selection errors
        }
      });

      const initialTarget = jumpTarget?.cfi || jumpTarget?.chapterHref || book.currentCfi || undefined;
      try {
        await rendition.display(initialTarget);
      } catch {
        // Fallback safely if saved CFI became invalid
        await rendition.display().catch(() => undefined);
      }

      epubInstance.loaded.navigation.then((nav) => {
        if (!mounted) return;
        const flat: Array<{ id: string; title: string; href: string }> = [];
        const walk = (list: NavItem[]) => {
          for (const item of list) {
            flat.push({ id: item.id || item.href, title: item.label.trim(), href: item.href });
            if (item.subitems?.length) walk(item.subitems);
          }
        };
        walk(nav.toc || []);
        tocFlatRef.current = flat;
        onTocLoaded(flat);
      });

      epubInstance.ready.then(() => {
        epubInstance?.locations
          .generate(1200)
          .then(() => {
            if (!mounted || !epubInstance) return;
            locationsReadyRef.current = true;
            const cfi = currentMetaRef.current.cfi;
            if (cfi) {
              const exact = epubInstance.locations.percentageFromCfi(cfi);
              if (typeof exact === 'number' && !Number.isNaN(exact)) {
                const exactPct = Math.min(100, Math.max(0, Math.round(exact * 100)));
                currentMetaRef.current.pct = exactPct;
                setPct(exactPct);
                onProgressRef.current(
                  exactPct,
                  cfi,
                  currentMetaRef.current.chapter,
                  currentMetaRef.current.href,
                  currentMetaRef.current.page
                );
              }
            }
          })
          .catch(() => undefined);
      });

      if (mounted) {
        setLoading(false);
        window.setTimeout(() => {
          if (mounted) syncAllVisibleEpubMarks(false, true);
        }, 60);
      }
    })();

    return () => {
      mounted = false;
      flushProgressNow();
      try {
        epubInstance?.destroy();
      } catch {
        // ignore
      }
      renditionRef.current = null;
      epubBookRef.current = null;
    };
  }, [book.id, settings.epubFlow]);

  // Re-render saved EPUB annotations visually on every add / edit / delete
  useEffect(() => {
    if (loading || !renditionRef.current) return;
    syncAllVisibleEpubMarks(true, true);
  }, [annotationsSig, loading]);

  // Apply live typography & theme styles to EPUB rendition
  useEffect(() => {
    const r = renditionRef.current;
    if (!r || loading) return;
    r.themes.default(buildEpubThemeRules(settings));
  }, [
    settings.theme,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.maxWidth,
    settings.textAlign,
    loading,
  ]);

  useEffect(() => {
    if (jumpHref && renditionRef.current) {
      renditionRef.current.display(jumpHref).catch(() => undefined);
    }
  }, [jumpHref]);

  useEffect(() => {
    if (!loading && jumpTarget && renditionRef.current) {
      const dest = jumpTarget.cfi || jumpTarget.chapterHref;
      if (dest) {
        renditionRef.current
          .display(dest)
          .then(() => {
            window.setTimeout(() => {
              syncAllVisibleEpubMarks(false);
              if (jumpTarget.annotationId) {
                const raw = renditionRef.current?.getContents() as unknown as Contents | Contents[];
                const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
                for (const c of list) {
                  const el = c?.document?.querySelector?.(
                    `mark[data-ann-id="${CSS.escape(jumpTarget.annotationId)}"]`
                  ) as HTMLElement | null;
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('komo-mark-pulse');
                    window.setTimeout(() => el.classList.remove('komo-mark-pulse'), 1800);
                    break;
                  }
                }
              }
            }, 120);
          })
          .catch(() => undefined);
      }
    }
  }, [loading, jumpTarget?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') renditionRef.current?.next();
      if (e.key === 'ArrowLeft') renditionRef.current?.prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            zIndex: 5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
            <Loader2 size={20} className="spin" /> Abriendo EPUB...
          </div>
        </div>
      )}

      <div ref={viewerRef} style={{ flex: 1, width: '100%', height: '100%' }} />

      <div className="reader-bottombar" style={{ justifyContent: 'space-between', flexDirection: 'column', gap: 5 }}>
        {bookmarks.length > 0 && (
          <div className="reader-progress-track-bar" aria-label="Progreso y separadores">
            <div className="reader-progress-track-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            {bookmarks.map((bm) => {
              const pos = Math.min(100, Math.max(0, Math.round(bm.progress ?? 0)));
              return (
                <button
                  key={bm.id}
                  type="button"
                  className="reader-progress-bm-pip"
                  style={{ left: `${pos}%` }}
                  title={`Ir al separador: ${bm.label}`}
                  onClick={() => onBookmarkClick?.(bm)}
                />
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10 }}>
          <button
            type="button"
            className="pill-btn reader-bottom-pill"
            onClick={() => renditionRef.current?.prev()}
          >
            <ChevronLeft size={15} /> {viewportMode === 'phone' ? 'Ant.' : 'Anterior'}
          </button>
          <span className="reader-bottom-center-label">
            {chapterLabel ? `${chapterLabel} · ` : ''}
            {pageNum ? `Pág. ${pageNum} · ` : ''}
            {pct}%
          </span>
          <button
            type="button"
            className="pill-btn reader-bottom-pill"
            onClick={() => renditionRef.current?.next()}
          >
            {viewportMode === 'phone' ? 'Sig.' : 'Siguiente'} <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};
