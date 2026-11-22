import * as pdfjsLib from 'pdfjs-dist';
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

export async function openPdfDocumentReliably(data: Uint8Array) {
  try {
    return await pdfjsLib.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
  } catch {
    // Android WebView fallback when ES module Web Worker cannot be instantiated
    return await pdfjsLib.getDocument({
      data: data.slice(),
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      // @ts-expect-error pdfjs-dist supports disableWorker at runtime in browser builds
      disableWorker: true,
    }).promise;
  }
}

export async function extractPdfMetaAndCover(
  blob: Blob
): Promise<{ title?: string; author?: string; coverDataUrl?: string; pageCount: number }> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await openPdfDocumentReliably(data);

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
    const targetWidth = 480;
    const scale = Math.min(1.6, Math.max(0.45, targetWidth / Math.max(1, baseViewport.width)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Fill white page background so transparent PDFs never export black in JPEG
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      coverDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    }
  } catch {
    // fallback cover
  }

  const pageCount = pdf.numPages;
  await pdf.destroy();
  return { title, author, coverDataUrl, pageCount };
}
