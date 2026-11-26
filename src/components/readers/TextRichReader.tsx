import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseRichFormat } from '../../parsers/textParser';
import type {
  BookAnnotation,
  BookItem,
  BookmarkDesign,
  BookmarkItem,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import {
  applyAnnotationsToRoot,
  injectReaderMarksStyle,
} from '../../utils/readerMarks';

const EMPTY_BM_LIST: BookmarkItem[] = [];

export interface ReaderSelectionPayload {
  quote: string;
  chapter?: string;
  chapterHref?: string;
  page?: number;
  progress: number;
  cfi?: string;
  scrollRatio?: number;
  pageX?: number;
  pageY?: number;
}

interface TextRichReaderProps {
  book: BookItem;
  blob: Blob;
  settings: ReaderSettings;
  annotations: BookAnnotation[];
  bookmarks?: BookmarkItem[];
  bookmarkDesigns?: BookmarkDesign[];
  defaultBookmarkDesign?: BookmarkDesign | null;
  onTocLoaded: (items: Array<{ id: string; title: string; href: string }>) => void;
  jumpHref: string | null;
  jumpTarget?: ReaderJumpTarget | null;
  hasOpenOverlay?: boolean;
  onProgress: (percent: number, scrollRatio: number, chapter?: string, chapterHref?: string) => void;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
  onBookmarkClick?: (bm: BookmarkItem) => void;
  onRegisterFlush?: (fn: (() => void) | null) => void;
}

export const TextRichReader: React.FC<TextRichReaderProps> = ({
  book,
  blob,
  settings,
  annotations,
  bookmarks = EMPTY_BM_LIST,
  bookmarkDesigns = [],
  defaultBookmarkDesign = null,
  onTocLoaded,
  jumpHref,
  jumpTarget,
  hasOpenOverlay = false,
  onProgress,
  onTextSelect,
  onAnnotationClick,
  onBookmarkClick,
  onRegisterFlush,
}) => {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(book.progress || 0);
  const [chapterLabel, setChapterLabel] = useState(book.currentChapter || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const chaptersRef = useRef<Array<{ id: string; title: string }>>([]);
  const isRestoringRef = useRef(true);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSavedRatioRef = useRef<number>(book.scrollRatio ?? 0);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const memoHtml = useMemo(() => ({ __html: html }), [html]);

  const bookmarkDesignsById = useMemo(() => {
    const map = new Map<string, BookmarkDesign>();
    for (const d of bookmarkDesigns) map.set(d.id, d);
    return map;
  }, [bookmarkDesigns]);

  const detectCurrentChapter = useCallback((): { title?: string; href?: string } => {
    const container = containerRef.current;
    if (!container || !chaptersRef.current.length) return {};
    const topEdge = container.getBoundingClientRect().top + 80;
    let current = chaptersRef.current[0];
    for (const ch of chaptersRef.current) {
      const el = container.querySelector(`#${CSS.escape(ch.id)}`);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= topEdge) {
        current = ch;
      } else {
        break;
      }
    }
    return { title: current?.title, href: current?.id };
  }, []);

  const flushProgressNow = useCallback(() => {
    if (scrollSaveTimerRef.current) {
      window.clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = null;
    }
    if (isRestoringRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max <= 0) return;
    const ratio = Math.min(1, Math.max(0, +(el.scrollTop / max).toFixed(4)));
    const percent = Math.round(ratio * 100);
    const ch = detectCurrentChapter();
    lastSavedRatioRef.current = ratio;
    onProgressRef.current(percent, ratio, ch.title, ch.href);
  }, [detectCurrentChapter]);

  useEffect(() => {
    onRegisterFlush?.(flushProgressNow);
    return () => {
      flushProgressNow();
      onRegisterFlush?.(null);
    };
  }, [onRegisterFlush, flushProgressNow]);

  useEffect(() => {
    let active = true;
    isRestoringRef.current = true;
    (async () => {
      setLoading(true);
      try {
        const parsed = await parseRichFormat(blob, book.format, book.title);
        if (!active) return;
        setHtml(parsed.html);
        chaptersRef.current = parsed.chapters.map((c) => ({ id: c.id, title: c.title }));
        onTocLoaded(parsed.chapters.map((c) => ({ id: c.id, title: c.title, href: c.id })));
      } catch (err) {
        if (active) {
          setHtml(
            `<p>Error al interpretar el documento: ${err instanceof Error ? err.message : 'desconocido'}</p>`
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (scrollSaveTimerRef.current) window.clearTimeout(scrollSaveTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [book.id]);

  // Apply visual inline highlights/pencil/pen/post-its/stickers/emojis cleanly on the rendered text
  useEffect(() => {
    if (loading || !articleRef.current) return;
    injectReaderMarksStyle(document);
    applyAnnotationsToRoot(document, articleRef.current, annotations);
  }, [loading, html, annotations]);

  // Restore scroll ratio safely after layout settles (without triggering a 0% overwrite!)
  useEffect(() => {
    if (loading || !containerRef.current) return;
    if (jumpTarget) {
      isRestoringRef.current = false;
      return;
    }
    const targetRatio = book.scrollRatio ?? 0;
    if (targetRatio > 0.002) {
      isRestoringRef.current = true;
      const applyRestore = () => {
        const el = containerRef.current;
        if (!el) return;
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        if (max > 0) {
          el.scrollTop = max * targetRatio;
        }
      };
      requestAnimationFrame(() => {
        applyRestore();
        requestAnimationFrame(() => {
          applyRestore();
        });
      });
      const release = window.setTimeout(() => {
        applyRestore();
        isRestoringRef.current = false;
      }, 240);
      return () => window.clearTimeout(release);
    }
    isRestoringRef.current = false;
  }, [loading, book.id]);

  // Jump to chapter id
  useEffect(() => {
    if (!jumpHref || !containerRef.current) return;
    const target = containerRef.current.querySelector(`#${CSS.escape(jumpHref)}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jumpHref]);

  // Jump to exact annotation or bookmark target
  useEffect(() => {
    if (loading || !jumpTarget || !containerRef.current) return;
    const container = containerRef.current;

    if (jumpTarget.annotationId) {
      const markEl = container.querySelector(
        `mark[data-ann-id="${CSS.escape(jumpTarget.annotationId)}"]`
      ) as HTMLElement | null;
      if (markEl) {
        markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        markEl.classList.add('komo-mark-pulse');
        window.setTimeout(() => markEl.classList.remove('komo-mark-pulse'), 1800);
        return;
      }
    }
    if (jumpTarget.scrollRatio !== undefined) {
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTo({ top: max * jumpTarget.scrollRatio, behavior: 'smooth' });
      return;
    }
    if (jumpTarget.chapterHref) {
      const target = container.querySelector(`#${CSS.escape(jumpTarget.chapterHref)}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, jumpTarget?.id]);

  const handleScroll = () => {
    if (isRestoringRef.current) return;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = containerRef.current;
        if (!el || isRestoringRef.current) return;
        const max = Math.max(1, el.scrollHeight - el.clientHeight);
        const ratio = Math.min(1, Math.max(0, el.scrollTop / max));
        const percent = Math.round(ratio * 100);
        setPct((prev) => (prev === percent ? prev : percent));
      });
    }
    if (scrollSaveTimerRef.current) window.clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = null;
      if (isRestoringRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      const ratio = Math.min(1, Math.max(0, +(el.scrollTop / max).toFixed(4)));
      if (Math.abs(ratio - lastSavedRatioRef.current) < 0.003 && ratio > 0 && ratio < 1) return;
      lastSavedRatioRef.current = ratio;
      const percent = Math.round(ratio * 100);
      const ch = detectCurrentChapter();
      setPct(percent);
      if (ch.title) setChapterLabel(ch.title);
      onProgressRef.current(percent, ratio, ch.title, ch.href);
    }, 180);
  };

  const handleSelectionCapture = () => {
    if (!onTextSelect || !articleRef.current || !containerRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    if (!articleRef.current.contains(sel.anchorNode)) return;

    const el = containerRef.current;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, Math.max(0, el.scrollTop / max));
    const percent = Math.round(ratio * 100);
    const ch = detectCurrentChapter();

    onTextSelect({
      quote: text.slice(0, 400),
      chapter: ch.title || chapterLabel || undefined,
      chapterHref: ch.href,
      progress: percent,
      scrollRatio: ratio,
    });
  };

  const handleArticleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const mark = target?.closest('mark.komo-inline-mark, .komo-inline-badge') as HTMLElement | null;
    if (mark?.dataset.annId && onAnnotationClick) {
      const found = annotations.find((a) => a.id === mark.dataset.annId);
      if (found) onAnnotationClick(found);
    }
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
          <Loader2 size={20} className="spin" /> Preparando lectura...
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseUp={handleSelectionCapture}
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
          window.setTimeout(handleSelectionCapture, 160);
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
            touchStartRef.current = null;
            return;
          }
          if (!settings.tapToScroll || hasOpenOverlay || !touchStartRef.current || !containerRef.current) {
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
              'a, button, input, .reader-text-bookmark-marker, mark.komo-inline-mark, .komo-inline-badge'
            )
          ) {
            return;
          }
          if (Math.hypot(dx, dy) <= 10 && dt >= 25 && dt <= 300) {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (t.clientX - rect.left) / Math.max(1, rect.width);
            const stepPx = Math.max(180, Math.round(containerRef.current.clientHeight * 0.8));
            if (ratio >= 0.78) {
              containerRef.current.scrollBy({ top: stepPx, behavior: 'smooth' });
            } else if (ratio <= 0.22) {
              containerRef.current.scrollBy({ top: -stepPx, behavior: 'smooth' });
            }
          }
        }}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowAnchor: 'auto',
          padding: '28px 24px 96px',
        }}
      >
        <div style={{ position: 'relative', maxWidth: `${settings.maxWidth}px`, margin: '0 auto' }}>
          <article
            ref={articleRef}
            className="rich-reader-article"
            onClick={handleArticleClick}
            style={{
              fontFamily: `${settings.fontFamily}, Georgia, serif`,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              textAlign: settings.textAlign,
            }}
            dangerouslySetInnerHTML={memoHtml}
          />
          {bookmarks.map((bm) => {
            const ratio =
              bm.scrollRatio !== undefined
                ? bm.scrollRatio
                : bm.progress !== undefined
                ? bm.progress / 100
                : undefined;
            if (ratio === undefined) return null;
            const bmDesign =
              (bm.designId && bookmarkDesignsById.get(bm.designId)) ||
              defaultBookmarkDesign ||
              null;
            const topPct = Math.min(98, Math.max(1, ratio * 100));
            return (
              <button
                key={bm.id}
                type="button"
                className="reader-text-bookmark-marker"
                style={{ top: `${topPct}%` }}
                title={`Separador: ${bmDesign?.name || bm.label}`}
                onClick={() => onBookmarkClick?.(bm)}
              >
                {bmDesign?.imageUrl ? (
                  <img src={bmDesign.imageUrl} alt={bmDesign.name} />
                ) : (
                  <span className="reader-page-bookmark-fallback" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="reader-bottombar" style={{ flexDirection: 'column', gap: 5 }}>
        {bookmarks.length > 0 && (
          <div className="reader-progress-track-bar" aria-label="Progreso y separadores">
            <div className="reader-progress-track-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            {bookmarks.map((bm) => {
              const pos = Math.min(
                100,
                Math.max(
                  0,
                  Math.round(
                    bm.scrollRatio !== undefined ? bm.scrollRatio * 100 : bm.progress ?? 0
                  )
                )
              );
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              opacity: 0.78,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '65%',
            }}
          >
            {chapterLabel ? `${chapterLabel} · ` : ''}
            {book.format.toUpperCase()}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800 }}>{pct}% leído</span>
        </div>
      </div>
    </div>
  );
};
