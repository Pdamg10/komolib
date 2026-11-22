import JSZip from 'jszip';
import type { BookFormat } from '../types/library';
import { openPdfDocumentReliably } from '../parsers/pdfParser';
import { parseMobiBlob } from '../parsers/mobiParser';

const MAX_EXCERPT_CHARS = 2600;

function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function findZipEntryCaseInsensitive(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  const clean = targetPath.replace(/^\/+/, '');
  const direct = zip.file(clean);
  if (direct && !direct.dir) return direct;
  const low = clean.toLowerCase();
  for (const key of Object.keys(zip.files)) {
    if (!zip.files[key].dir && key.replace(/^\/+/, '').toLowerCase() === low) {
      return zip.files[key];
    }
  }
  return null;
}

function resolvePath(baseDir: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0].replace(/\\/g, '/');
  let decoded = cleanHref;
  try {
    decoded = decodeURIComponent(cleanHref);
  } catch {
    // ignore malformed percent encoding
  }
  if (!baseDir) return decoded.replace(/^\/+/, '');
  const parts = `${baseDir}/${decoded}`.split('/');
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

async function extractEpubExcerpt(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await findZipEntryCaseInsensitive(zip, 'META-INF/container.xml')?.async('string');
  let opfPath =
    containerXml?.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ||
    Object.keys(zip.files).find((k) => !zip.files[k].dir && k.toLowerCase().endsWith('.opf')) ||
    '';

  const parts: string[] = [];
  let totalLen = 0;

  if (opfPath) {
    const opfXml = await findZipEntryCaseInsensitive(zip, opfPath)?.async('string');
    if (opfXml) {
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
      const manifest = new Map<string, string>();
      const itemRe = /<item\b([^>]+)\/?>/gi;
      let im: RegExpExecArray | null;
      while ((im = itemRe.exec(opfXml)) !== null) {
        const id = im[1].match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
        const href = im[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
        if (id && href) manifest.set(id, href);
      }

      const spineIds: string[] = [];
      const spineRe = /<itemref\b[^>]*\bidref\s*=\s*["']([^"']+)["']/gi;
      let sm: RegExpExecArray | null;
      while ((sm = spineRe.exec(opfXml)) !== null && spineIds.length < 6) {
        if (sm[1]) spineIds.push(sm[1].trim());
      }

      for (const id of spineIds) {
        const href = manifest.get(id);
        if (!href) continue;
        const path = resolvePath(opfDir, href);
        const entry = findZipEntryCaseInsensitive(zip, path);
        if (!entry) continue;
        const html = await entry.async('string');
        const plain = stripHtmlToPlain(html);
        if (plain.length >= 12) {
          parts.push(plain.slice(0, MAX_EXCERPT_CHARS - totalLen));
          totalLen += plain.length;
          if (totalLen >= MAX_EXCERPT_CHARS) break;
        }
      }
    }
  }

  // Fallback: scan first HTML/XHTML files in archive
  if (parts.length === 0) {
    const htmlKeys = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir && /\.(x?html?|xml)$/i.test(k) && !/container\.xml|toc\.ncx/i.test(k))
      .sort()
      .slice(0, 5);
    for (const k of htmlKeys) {
      const html = await zip.files[k].async('string');
      const plain = stripHtmlToPlain(html);
      if (plain.length >= 12) {
        parts.push(plain.slice(0, MAX_EXCERPT_CHARS - totalLen));
        totalLen += plain.length;
        if (totalLen >= MAX_EXCERPT_CHARS) break;
      }
    }
  }

  return parts.join('\n\n').slice(0, MAX_EXCERPT_CHARS).trim();
}

async function extractPdfExcerpt(blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await openPdfDocumentReliably(data);
  try {
    const parts: string[] = [];
    let totalLen = 0;
    const maxPages = Math.min(pdf.numPages, 4);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items
        .map((it) => ('str' in it && typeof it.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length >= 8) {
        parts.push(text.slice(0, MAX_EXCERPT_CHARS - totalLen));
        totalLen += text.length;
        if (totalLen >= MAX_EXCERPT_CHARS) break;
      }
    }
    return parts.join('\n\n').slice(0, MAX_EXCERPT_CHARS).trim();
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}

async function extractDocxExcerpt(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await findZipEntryCaseInsensitive(zip, 'word/document.xml')?.async('string');
  if (!xml) return '';
  return stripHtmlToPlain(xml).slice(0, MAX_EXCERPT_CHARS).trim();
}

/**
 * Extracts a lightweight text excerpt from the opening pages of a local book file
 * so AI can accurately identify its title, author, and synopsis.
 */
export async function extractBookOpeningExcerpt(
  blob: Blob,
  format: BookFormat
): Promise<string> {
  try {
    if (format === 'epub') return await extractEpubExcerpt(blob);
    if (format === 'pdf') return await extractPdfExcerpt(blob);
    if (format === 'docx') return await extractDocxExcerpt(blob);
    if (format === 'mobi' || format === 'azw3') {
      const parsed = await parseMobiBlob(blob, 'Libro');
      return stripHtmlToPlain(parsed.html || '').slice(0, MAX_EXCERPT_CHARS).trim();
    }
    if (format === 'fb2' || format === 'html') {
      const raw = await blob.slice(0, 64 * 1024).text();
      return stripHtmlToPlain(raw).slice(0, MAX_EXCERPT_CHARS).trim();
    }
    if (format === 'txt' || format === 'md') {
      const raw = await blob.slice(0, 12 * 1024).text();
      return raw.replace(/\s+/g, ' ').slice(0, MAX_EXCERPT_CHARS).trim();
    }
  } catch {
    // ignore parsing failure and fall back to cover/filename
  }
  return '';
}
