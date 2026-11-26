import JSZip from 'jszip';
import { blobToDataUrl, naturalSortStrings, optimizeCoverDataUrl } from './coverGenerator';

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i;

function isValidComicImage(name: string): boolean {
  if (name.startsWith('__MACOSX')) return false;
  const base = name.split('/').pop() || name;
  if (base.startsWith('.')) return false;
  return IMAGE_EXT_RE.test(base);
}

function pickCoverEntry<T extends { name: string }>(entries: T[]): T {
  const explicit = entries.find((e) => {
    const base = (e.name.split('/').pop() || e.name).toLowerCase();
    return /^(cover|portada|front|000|00)[\W_.]/.test(base) || /^cover\./.test(base);
  });
  return explicit || entries[0];
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

export interface ComicPage {
  name: string;
  url: string;
}

export interface LazyCbzArchive {
  pageNames: string[];
  pageCount: number;
  getPageUrl: (index: number) => Promise<string>;
  dispose: () => void;
}

/**
 * Opens a CBZ/ZIP archive by reading ONLY its directory index (~20 ms even for 1,500 pages)
 * and extracts images on demand with a bounded LRU cache so large 30-chapter Manhwa CBZs
 * open Page 1 instantly without exhausting RAM!
 */
export async function openCbzArchive(blob: Blob, maxCached = 28): Promise<LazyCbzArchive> {
  const zip = await JSZip.loadAsync(blob);
  const imageFiles = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith('__MACOSX') && IMAGE_EXT_RE.test(f.name))
    .sort((a, b) => naturalSortStrings(a.name, b.name));

  const cache = new Map<number, string>();
  const inflight = new Map<number, Promise<string>>();
  let disposed = false;

  const touchLru = (idx: number, url: string) => {
    cache.delete(idx);
    cache.set(idx, url);
    while (cache.size > maxCached) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldUrl = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (oldUrl) {
        try {
          URL.revokeObjectURL(oldUrl);
        } catch {
          // ignore
        }
      }
    }
  };

  const getPageUrl = async (index: number): Promise<string> => {
    if (disposed || index < 0 || index >= imageFiles.length) return '';
    const existing = cache.get(index);
    if (existing) {
      touchLru(index, existing);
      return existing;
    }
    const pending = inflight.get(index);
    if (pending) return pending;

    const p = (async () => {
      try {
        const file = imageFiles[index];
        const ab = await file.async('arraybuffer');
        if (disposed) return '';
        const imgBlob = new Blob([ab], { type: mimeFromName(file.name) });
        const url = URL.createObjectURL(imgBlob);
        if (disposed) {
          URL.revokeObjectURL(url);
          return '';
        }
        touchLru(index, url);
        return url;
      } finally {
        inflight.delete(index);
      }
    })();

    inflight.set(index, p);
    return p;
  };

  const dispose = () => {
    disposed = true;
    for (const url of cache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    cache.clear();
    inflight.clear();
  };

  return {
    pageNames: imageFiles.map((f) => f.name),
    pageCount: imageFiles.length,
    getPageUrl,
    dispose,
  };
}

export async function extractCbzPages(blob: Blob): Promise<ComicPage[]> {
  const rawBuf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(rawBuf);
  const imageFiles = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith('__MACOSX') && IMAGE_EXT_RE.test(f.name))
    .sort((a, b) => naturalSortStrings(a.name, b.name));

  const pages: ComicPage[] = [];
  for (const file of imageFiles) {
    const ab = await file.async('arraybuffer');
    const imgBlob = new Blob([ab], { type: mimeFromName(file.name) });
    pages.push({
      name: file.name,
      url: URL.createObjectURL(imgBlob),
    });
  }
  return pages;
}

export async function extractCbzCoverAndCount(
  blob: Blob
): Promise<{ coverDataUrl?: string; pageCount: number }> {
  const rawBuf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(rawBuf);
  const imageFiles = Object.values(zip.files)
    .filter((f) => !f.dir && isValidComicImage(f.name))
    .sort((a, b) => naturalSortStrings(a.name, b.name));

  if (imageFiles.length === 0) {
    return { pageCount: 0 };
  }
  const coverEntry = pickCoverEntry(imageFiles);
  const ab = await coverEntry.async('arraybuffer');
  const imgBlob = new Blob([ab], { type: mimeFromName(coverEntry.name) });
  const rawUrl = await blobToDataUrl(imgBlob);
  const coverDataUrl = await optimizeCoverDataUrl(rawUrl);
  return { coverDataUrl, pageCount: imageFiles.length };
}

let cachedWasmBinary: ArrayBuffer | null = null;

async function loadUnrarWasm(): Promise<ArrayBuffer> {
  if (cachedWasmBinary) return cachedWasmBinary;
  const wasmUrl = new URL('node-unrar-js/esm/js/unrar.wasm', import.meta.url).href;
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error('No se pudo cargar unrar.wasm');
  cachedWasmBinary = await res.arrayBuffer();
  return cachedWasmBinary;
}

export async function extractCbrPages(blob: Blob): Promise<ComicPage[]> {
  const { createExtractorFromData } = await import('node-unrar-js');
  const wasmBinary = await loadUnrarWasm();
  const data = await blob.arrayBuffer();
  const extractor = await createExtractorFromData({ data, wasmBinary });
  const list = extractor.getFileList();
  const headers = [...list.fileHeaders]
    .filter((h) => !h.flags.directory && IMAGE_EXT_RE.test(h.name))
    .sort((a, b) => naturalSortStrings(a.name, b.name));

  const extracted = extractor.extract({ files: headers.map((h) => h.name) });
  const pages: ComicPage[] = [];
  for (const file of extracted.files) {
    if (!file.extraction) continue;
    const copy = new Uint8Array(file.extraction);
    const imgBlob = new Blob([copy], { type: mimeFromName(file.fileHeader.name) });
    pages.push({
      name: file.fileHeader.name,
      url: URL.createObjectURL(imgBlob),
    });
  }
  pages.sort((a, b) => naturalSortStrings(a.name, b.name));
  return pages;
}

export async function extractCbrCoverAndCount(
  blob: Blob
): Promise<{ coverDataUrl?: string; pageCount: number }> {
  try {
    const { createExtractorFromData } = await import('node-unrar-js');
    const wasmBinary = await loadUnrarWasm();
    const data = await blob.arrayBuffer();
    const extractor = await createExtractorFromData({ data, wasmBinary });
    const list = extractor.getFileList();
    const headers = [...list.fileHeaders]
      .filter((h) => !h.flags.directory && isValidComicImage(h.name))
      .sort((a, b) => naturalSortStrings(a.name, b.name));

    if (!headers.length) return { pageCount: 0 };
    const coverEntry = pickCoverEntry(headers);
    const extracted = extractor.extract({ files: [coverEntry.name] });
    for (const file of extracted.files) {
      if (file.extraction) {
        const copy = new Uint8Array(file.extraction);
        const imgBlob = new Blob([copy], { type: mimeFromName(coverEntry.name) });
        const rawUrl = await blobToDataUrl(imgBlob);
        const coverDataUrl = await optimizeCoverDataUrl(rawUrl);
        return { coverDataUrl, pageCount: headers.length };
      }
    }
    return { pageCount: headers.length };
  } catch (err) {
    console.warn('CBR metadata parse fallback:', err);
    return { pageCount: 0 };
  }
}
