import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };

export async function extractPdfMetaAndCover(
  blob: Blob
): Promise<{ title?: string; author?: string; coverDataUrl?: string; pageCount: number }> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

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
    const viewport = page.getViewport({ scale: 0.65 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      coverDataUrl = canvas.toDataURL('image/jpeg', 0.82);
    }
  } catch {
    // fallback cover
  }

  const pageCount = pdf.numPages;
  await pdf.destroy();
  return { title, author, coverDataUrl, pageCount };
}
