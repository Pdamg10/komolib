import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { pdfjsLib } from '../../parsers/pdfParser';
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
}

export const PdfReader: React.FC<PdfReaderProps> = ({
  book,
  blob,
  annotations = [],
  jumpTarget,
  pinMode = false,
  onProgress,
  onTextSelect,
  onAnnotationClick,
}) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(Math.max(1, book.currentPage || 1));
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let docRef: PDFDocumentProxy | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data }).promise;
        docRef = doc;
        if (!active) {
          await doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        const startPage = Math.min(doc.numPages, Math.max(1, book.currentPage || 1));
        setPageNum(startPage);
        onProgress(startPage, doc.numPages);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error al abrir PDF');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      docRef?.destroy().catch(() => undefined);
    };
  }, [book.id]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) onProgress(pageNum, pdfDoc.numPages);
      } catch {
        // ignore cancelled render
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageNum, scale]);

  useEffect(() => {
    if (jumpTarget?.page && numPages > 0) {
      const clamped = Math.min(numPages, Math.max(1, jumpTarget.page));
      setPageNum(clamped);
    }
  }, [jumpTarget?.id, numPages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') setPageNum((p) => Math.min(numPages, p + 1));
      if (e.key === 'ArrowLeft') setPageNum((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
          <Loader2 size={22} className="spin" /> Cargando PDF...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '18px 16px',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
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
              boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
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

      <div className="reader-bottombar" style={{ justifyContent: 'center' }}>
        <button
          className="circle-arrow-btn"
          onClick={() => setPageNum((p) => Math.max(1, p - 1))}
          disabled={pageNum <= 1}
        >
          <ChevronLeft size={16} />
        </button>

        <span style={{ fontSize: 12, fontWeight: 700, minWidth: 70, textAlign: 'center' }}>
          {pageNum} / {numPages}
        </span>

        <input
          type="range"
          min={1}
          max={Math.max(1, numPages)}
          value={pageNum}
          onChange={(e) => setPageNum(Number(e.target.value))}
          style={{ flex: 1, maxWidth: 380 }}
        />

        <button
          className="circle-arrow-btn"
          onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
          disabled={pageNum >= numPages}
        >
          <ChevronRight size={16} />
        </button>

        <button
          className="circle-arrow-btn"
          onClick={() => setScale((s) => Math.max(0.6, +(s - 0.2).toFixed(2)))}
          title="Alejar"
        >
          <ZoomOut size={15} />
        </button>
        <span style={{ fontSize: 11.5, fontWeight: 700 }}>{Math.round(scale * 100)}%</span>
        <button
          className="circle-arrow-btn"
          onClick={() => setScale((s) => Math.min(2.6, +(s + 0.2).toFixed(2)))}
          title="Acercar"
        >
          <ZoomIn size={15} />
        </button>
      </div>
    </div>
  );
};
