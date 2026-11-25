import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseRichFormat } from '../../parsers/textParser';
import type {
  BookAnnotation,
  BookItem,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import {
  applyAnnotationsToRoot,
  injectReaderMarksStyle,
} from '../../utils/readerMarks';

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
  onTocLoaded: (items: Array<{ id: string; title: string; href: string }>) => void;
  jumpHref: string | null;
  jumpTarget?: ReaderJumpTarget | null;
  onProgress: (percent: number, scrollRatio: number, chapter?: string, chapterHref?: string) => void;
  onTextSelect?: (sel: ReaderSelectionPayload) => void;
  onAnnotationClick?: (ann: BookAnnotation) => void;
}

export const TextRichReader: React.FC<TextRichReaderProps> = ({
  book,
  blob,
  settings,
  annotations,
  onTocLoaded,
  jumpHref,
  jumpTarget,
  onProgress,
  onTextSelect,
  onAnnotationClick,
}) => {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(book.progress || 0);
  const [chapterLabel, setChapterLabel] = useState(book.currentChapter || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const chaptersRef = useRef<Array<{ id: string; title: string }>>([]);
  const memoHtml = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    let active = true;
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
    };
  }, [book.id]);

  // Apply visual inline highlights/pencil/pen/post-its/stickers/emojis cleanly on the rendered text
  useEffect(() => {
    if (loading || !articleRef.current) return;
    injectReaderMarksStyle(document);
    applyAnnotationsToRoot(document, articleRef.current, annotations);
  }, [loading, html, annotations]);

  // Restore scroll ratio
  useEffect(() => {
    if (!loading && containerRef.current && book.scrollRatio && !jumpTarget) {
      const el = containerRef.current;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = max * book.scrollRatio;
    }
  }, [loading]);

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

  const detectCurrentChapter = (): { title?: string; href?: string } => {
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
  };

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, Math.max(0, el.scrollTop / max));
    const percent = Math.round(ratio * 100);
    const ch = detectCurrentChapter();
    setPct(percent);
    if (ch.title) setChapterLabel(ch.title);
    onProgress(percent, ratio, ch.title, ch.href);
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
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
          if (!touchStartRef.current || !containerRef.current) {
            touchStartRef.current = null;
            return;
          }
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStartRef.current.x;
          const dy = t.clientY - touchStartRef.current.y;
          touchStartRef.current = null;
          const targetEl = e.target as HTMLElement | null;
          if (
            targetEl?.closest(
              'a, button, input, mark.komo-inline-mark, .komo-inline-badge'
            )
          ) {
            return;
          }
          if (Math.hypot(dx, dy) <= 14) {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (t.clientX - rect.left) / Math.max(1, rect.width);
            const stepPx = Math.max(180, Math.round(containerRef.current.clientHeight * 0.85));
            if (ratio >= 0.68) {
              containerRef.current.scrollBy({ top: stepPx, behavior: 'smooth' });
            } else if (ratio <= 0.32) {
              containerRef.current.scrollBy({ top: -stepPx, behavior: 'smooth' });
            }
          }
        }}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '28px 24px 96px',
        }}
      >
        <article
          ref={articleRef}
          className="rich-reader-article"
          onClick={handleArticleClick}
          style={{
            maxWidth: `${settings.maxWidth}px`,
            margin: '0 auto',
            fontFamily: `${settings.fontFamily}, Georgia, serif`,
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            textAlign: settings.textAlign,
          }}
          dangerouslySetInnerHTML={memoHtml}
        />
      </div>

      <div className="reader-bottombar" style={{ justifyContent: 'space-between' }}>
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
  );
};
