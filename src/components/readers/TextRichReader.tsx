import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseRichFormat } from '../../parsers/textParser';
import type { BookItem, ReaderSettings } from '../../types/library';

interface TextRichReaderProps {
  book: BookItem;
  blob: Blob;
  settings: ReaderSettings;
  onTocLoaded: (items: Array<{ id: string; title: string; href: string }>) => void;
  jumpHref: string | null;
  onProgress: (percent: number, scrollRatio: number) => void;
}

export const TextRichReader: React.FC<TextRichReaderProps> = ({
  book,
  blob,
  settings,
  onTocLoaded,
  jumpHref,
  onProgress,
}) => {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(book.progress || 0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const parsed = await parseRichFormat(blob, book.format, book.title);
        if (!active) return;
        setHtml(parsed.html);
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

  // Restore scroll ratio
  useEffect(() => {
    if (!loading && containerRef.current && book.scrollRatio) {
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

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, Math.max(0, el.scrollTop / max));
    const percent = Math.round(ratio * 100);
    setPct(percent);
    onProgress(percent, ratio);
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
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '28px 24px 90px',
        }}
      >
        <article
          className="rich-reader-article"
          style={{
            maxWidth: `${settings.maxWidth}px`,
            margin: '0 auto',
            fontFamily: `${settings.fontFamily}, Georgia, serif`,
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            textAlign: settings.textAlign,
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      <div className="reader-bottombar" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.75 }}>
          {book.format.toUpperCase()} · {book.author}
        </span>
        <span style={{ fontSize: 12, fontWeight: 800 }}>{pct}% leído</span>
      </div>
    </div>
  );
};
