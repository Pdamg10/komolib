import React, { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type NavItem, type Rendition } from 'epubjs';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { BookItem, ReaderSettings } from '../../types/library';
import { READER_PALETTES } from './readerThemes';

interface EpubReaderProps {
  book: BookItem;
  blob: Blob;
  settings: ReaderSettings;
  onTocLoaded: (items: Array<{ id: string; title: string; href: string }>) => void;
  jumpHref: string | null;
  onProgress: (percent: number, cfi: string) => void;
}

export const EpubReader: React.FC<EpubReaderProps> = ({
  book,
  blob,
  settings,
  onTocLoaded,
  jumpHref,
  onProgress,
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(book.progress || 0);

  useEffect(() => {
    let mounted = true;
    let epubInstance: Book | null = null;

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
        flow: settings.epubFlow === 'scrolled' ? 'scrolled-doc' : 'paginated',
        spread: 'none',
      });
      renditionRef.current = rendition;

      await rendition.display(book.currentCfi || undefined);

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
        onTocLoaded(flat);
      });

      epubInstance.ready.then(() => {
        epubInstance?.locations.generate(1200).catch(() => undefined);
      });

      rendition.on('relocated', (location: { start: { cfi: string; percentage?: number } }) => {
        const cfi = location?.start?.cfi || '';
        const percentage = Math.round(((location?.start?.percentage || 0) as number) * 100);
        setPct(percentage);
        onProgress(percentage, cfi);
      });

      if (mounted) setLoading(false);
    })();

    return () => {
      mounted = false;
      try {
        epubInstance?.destroy();
      } catch {
        // ignore
      }
      renditionRef.current = null;
      epubBookRef.current = null;
    };
  }, [book.id, settings.epubFlow]);

  // Apply live typography & theme styles to EPUB rendition
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    const pal = READER_PALETTES[settings.theme];
    r.themes.default({
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
        color: '#8d7ec7 !important',
      },
      img: {
        'max-width': '100% !important',
        height: 'auto !important',
      },
    });
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
    const onKey = (e: KeyboardEvent) => {
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

      <div className="reader-bottombar" style={{ justifyContent: 'space-between' }}>
        <button className="pill-btn" onClick={() => renditionRef.current?.prev()}>
          <ChevronLeft size={15} /> Anterior
        </button>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{pct}% leído</span>
        <button className="pill-btn" onClick={() => renditionRef.current?.next()}>
          Siguiente <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
};
