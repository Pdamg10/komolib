import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const resolvedWorkerSrc = (() => {
  try {
    if (typeof window !== 'undefined' && window.location?.href) {
      return new URL(pdfWorkerUrl, window.location.href).href;
    }
  } catch {
    // ignore URL resolution error
  }
  return pdfWorkerUrl;
})();

pdfjsLib.GlobalWorkerOptions.workerSrc = resolvedWorkerSrc;

export { pdfjsLib };

export async function openPdfDocumentReliably(data: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    // Pass data directly (avoid duplicating 150-300 MB buffers via data.slice())
    return await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  } catch {
    // Android WebView fallback when ES module Web Worker cannot be instantiated
    return await pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      // @ts-expect-error pdfjs-dist supports disableWorker at runtime in browser builds
      disableWorker: true,
    }).promise;
  }
}

/**
 * Fast, zero-copy PDF loader using an Object URL so PDF.js streams only the XRef table
 * and requested pages instead of copying 100-400 MB Manhwa PDFs into RAM upfront!
 */
export async function openPdfFromBlobReliably(
  blob: Blob
): Promise<{ doc: PDFDocumentProxy; cleanup: () => void }> {
  const objectUrl = URL.createObjectURL(blob);
  const cleanup = () => {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  };

  try {
    const doc = await pdfjsLib.getDocument({
      url: objectUrl,
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: false,
    }).promise;
    return { doc, cleanup };
  } catch {
    // Fallback for WebViews that block worker Blob URL fetches
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      const doc = await openPdfDocumentReliably(data);
      cleanup();
      return { doc, cleanup: () => undefined };
    } catch (err) {
      cleanup();
      throw err;
    }
  }
}

export async function extractPdfMetaAndCover(
  blob: Blob
): Promise<{ title?: string; author?: string; coverDataUrl?: string; pageCount: number }> {
  const { doc: pdf, cleanup } = await openPdfFromBlobReliably(blob);

  let title: string | undefined;
  let author: string | undefined;
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, unknown> | undefined;
    if (info?.Title && typeof info.Title === 'string' && info.Title.trim()) {
      title = info.Title.trim();
    }
    if (info?.Author && typeof info.Author === 'string' && info.Author.trim()) {
      author = info.Author.trim();
    }
  } catch {
    // ignore metadata errors
  }

  let coverDataUrl: string | undefined;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    // Always capture the TOP first image of Page 1 at full crisp 420px cover width (2:3 max crop)
    // so ultra-tall webtoon/manhwa strips never shrink into skinny unreadable slivers!
    const targetWidth = 420;
    const scale = Math.min(1.6, Math.max(0.4, targetWidth / Math.max(1, baseViewport.width)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    const maxCoverHeight = Math.round(canvas.width * 1.55);
    canvas.height = Math.max(1, Math.min(Math.round(viewport.height), maxCoverHeight));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      coverDataUrl = canvas.toDataURL('image/jpeg', 0.86);
    }
  } catch {
    // fallback cover
  }

  const pageCount = pdf.numPages;
  await pdf.destroy();
  cleanup();
  return { title, author, coverDataUrl, pageCount };
}
