import JSZip from 'jszip';
import { blobToDataUrl, optimizeCoverDataUrl } from './coverGenerator';
import { isRasterCoverDataUrl } from '../utils/coverHelpers';

export interface EpubMetaResult {
  title?: string;
  author?: string;
  description?: string;
  coverDataUrl?: string;
}

function safeDecodeUriComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function resolveRelativePath(baseDir: string, href: string): string {
  const cleanHref = safeDecodeUriComponent(href.split('#')[0].split('?')[0]).replace(/\\/g, '/');
  if (!baseDir) return cleanHref.replace(/^\/+/, '');
  const parts = (baseDir + '/' + cleanHref).split('/');
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

function findZipFile(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  const clean = targetPath.replace(/^\/+/, '');
  const direct = zip.file(clean);
  if (direct && !direct.dir) return direct;
  const lower = clean.toLowerCase();
  for (const key of Object.keys(zip.files)) {
    if (!zip.files[key].dir && key.replace(/^\/+/, '').toLowerCase() === lower) {
      return zip.files[key];
    }
  }
  // Last-resort match by basename if path differs only by leading folder
  const targetBase = lower.split('/').pop() || '';
  if (targetBase && targetBase.includes('.')) {
    for (const key of Object.keys(zip.files)) {
      if (!zip.files[key].dir && (key.split('/').pop() || '').toLowerCase() === targetBase) {
        return zip.files[key];
      }
    }
  }
  return null;
}

function mimeFromImagePath(filePath: string, fallback = 'image/jpeg'): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return fallback;
}

function isRasterImageFileName(name: string): boolean {
  return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(name);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(x?[0-9a-fA-F]+);/g, (_m, tok: string) => {
      try {
        const cp = tok.toLowerCase().startsWith('x')
          ? parseInt(tok.slice(1), 16)
          : parseInt(tok, 10);
        return String.fromCodePoint(cp);
      } catch {
        return '';
      }
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function parseXmlSafely(parser: DOMParser, xml: string): Document | null {
  try {
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    return doc;
  } catch {
    return null;
  }
}

async function extractImageFromXhtmlCover(
  zip: JSZip,
  xhtmlPath: string
): Promise<{ path: string; mime: string } | null> {
  const xhtmlFile = findZipFile(zip, xhtmlPath);
  if (!xhtmlFile) return null;
  const html = await xhtmlFile.async('string');
  const xhtmlDir = xhtmlPath.includes('/') ? xhtmlPath.slice(0, xhtmlPath.lastIndexOf('/')) : '';

  const patterns = [
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i,
    /<image\b[^>]*\b(?:xlink:href|href)\s*=\s*["']([^"']+)["']/i,
    /background(?:-image)?\s*:[^;{}]*url\(\s*["']?([^"')]+)["']?\s*\)/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1] && !match[1].startsWith('data:')) {
      const resolved = resolveRelativePath(xhtmlDir, match[1].trim());
      if (findZipFile(zip, resolved)) {
        return { path: resolved, mime: mimeFromImagePath(resolved) };
      }
    }
  }
  return null;
}

interface ParsedManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

function parseOpfWithRegexFallback(opfXml: string): {
  title?: string;
  author?: string;
  description?: string;
  coverMetaRef?: string;
  manifestItems: ParsedManifestItem[];
  guideCoverHref?: string;
  firstSpineId?: string;
} {
  const titleMatch = opfXml.match(
    /<(?:[a-zA-Z0-9_-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?title>/i
  );
  const title = titleMatch ? decodeXmlEntities(titleMatch[1]) || undefined : undefined;

  const authors: string[] = [];
  const creatorRe = /<(?:[a-zA-Z0-9_-]+:)?creator\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?creator>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = creatorRe.exec(opfXml)) !== null) {
    const a = decodeXmlEntities(cm[1]);
    if (a && !authors.includes(a)) authors.push(a);
  }
  const author = authors.length ? authors.join(', ') : undefined;

  const descMatch = opfXml.match(
    /<(?:[a-zA-Z0-9_-]+:)?description\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?description>/i
  );
  const description = descMatch ? decodeXmlEntities(descMatch[1]) || undefined : undefined;

  const metaCover1 = opfXml.match(
    /<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i
  );
  const metaCover2 = opfXml.match(
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']cover["']/i
  );
  const coverMetaRef = (metaCover1?.[1] || metaCover2?.[1])?.trim();

  const manifestItems: ParsedManifestItem[] = [];
  const itemRe = /<item\b([^>]+)\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(opfXml)) !== null) {
    const attrs = im[1];
    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '';
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '';
    const mediaType = attrs.match(/\bmedia-type\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().toLowerCase() || '';
    const properties = attrs.match(/\bproperties\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().toLowerCase() || '';
    if (href) {
      manifestItems.push({ id, href, mediaType, properties });
    }
  }

  const guideMatch =
    opfXml.match(/<reference\b[^>]*\btype\s*=\s*["'][^"']*cover[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i) ||
    opfXml.match(/<reference\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["'][^"']*cover[^"']*["']/i);
  const guideCoverHref = guideMatch?.[1]?.trim();

  const spineMatch = opfXml.match(/<itemref\b[^>]*\bidref\s*=\s*["']([^"']+)["']/i);
  const firstSpineId = spineMatch?.[1]?.trim();

  return { title, author, description, coverMetaRef, manifestItems, guideCoverHref, firstSpineId };
}

export async function extractEpubMetaAndCover(blob: Blob): Promise<EpubMetaResult> {
  try {
    // Reading to ArrayBuffer first avoids Android WebView content:// File stream issues in JSZip
    const rawBuf = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(rawBuf);
    const containerXml = await findZipFile(zip, 'META-INF/container.xml')?.async('string');
    const parser = new DOMParser();
    let opfPath: string | null = null;
    if (containerXml) {
      const containerDoc = parseXmlSafely(parser, containerXml);
      opfPath =
        containerDoc?.querySelector('rootfile')?.getAttribute('full-path') ||
        containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ||
        null;
    }
    if (!opfPath) {
      const fallbackOpf = Object.keys(zip.files).find(
        (k) => !zip.files[k].dir && k.toLowerCase().endsWith('.opf')
      );
      opfPath = fallbackOpf || null;
    }

    let title: string | undefined;
    let author: string | undefined;
    let description: string | undefined;
    let coverPath: string | null = null;
    let coverMediaType = 'image/jpeg';

    if (opfPath) {
      const opfXml = await findZipFile(zip, opfPath)?.async('string');
      if (opfXml) {
        const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
        const opfDoc = parseXmlSafely(parser, opfXml);
        const regexParsed = parseOpfWithRegexFallback(opfXml);

        let manifestItems: ParsedManifestItem[] = regexParsed.manifestItems;
        let coverMetaRef = regexParsed.coverMetaRef;
        let guideCoverHref = regexParsed.guideCoverHref;
        let firstSpineId = regexParsed.firstSpineId;

        if (opfDoc) {
          title =
            opfDoc.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() ||
            opfDoc.querySelector('title')?.textContent?.trim() ||
            regexParsed.title;
          const creatorEls = Array.from(opfDoc.getElementsByTagNameNS('*', 'creator'));
          const domAuthors = creatorEls
            .map((el) => el.textContent?.trim() || '')
            .filter(Boolean);
          author =
            (domAuthors.length ? Array.from(new Set(domAuthors)).join(', ') : undefined) ||
            opfDoc.querySelector('creator')?.textContent?.trim() ||
            regexParsed.author;
          description =
            opfDoc.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim() ||
            regexParsed.description;

          const domItems = Array.from(opfDoc.querySelectorAll('manifest > item'))
            .map((it) => ({
              id: (it.getAttribute('id') || '').trim(),
              href: (it.getAttribute('href') || '').trim(),
              mediaType: (it.getAttribute('media-type') || '').trim().toLowerCase(),
              properties: (it.getAttribute('properties') || '').trim().toLowerCase(),
            }))
            .filter((it) => Boolean(it.href));
          if (domItems.length > 0) manifestItems = domItems;

          const domMetaCover = Array.from(opfDoc.querySelectorAll('metadata meta')).find(
            (m) => m.getAttribute('name')?.toLowerCase() === 'cover'
          );
          if (domMetaCover?.getAttribute('content')?.trim()) {
            coverMetaRef = domMetaCover.getAttribute('content')!.trim();
          }

          const domGuide = Array.from(opfDoc.querySelectorAll('guide > reference')).find((r) =>
            (r.getAttribute('type') || '').toLowerCase().includes('cover')
          );
          if (domGuide?.getAttribute('href')?.trim()) {
            guideCoverHref = domGuide.getAttribute('href')!.trim();
          }

          const domSpineId = opfDoc.querySelector('spine > itemref')?.getAttribute('idref')?.trim();
          if (domSpineId) firstSpineId = domSpineId;
        } else {
          title = regexParsed.title;
          author = regexParsed.author;
          description = regexParsed.description;
        }

        // 1. EPUB 3: properties="cover-image"
        const propItem = manifestItems.find((it) =>
          it.properties.split(/\s+/).includes('cover-image')
        );
        if (propItem?.href) {
          coverPath = resolveRelativePath(opfDir, propItem.href);
          coverMediaType = propItem.mediaType || mimeFromImagePath(coverPath);
        }

        // 2. EPUB 2: <meta name="cover" content="id-or-href"/>
        if (!coverPath && coverMetaRef) {
          const item = manifestItems.find(
            (it) =>
              it.id === coverMetaRef ||
              it.id.toLowerCase() === coverMetaRef.toLowerCase() ||
              it.href === coverMetaRef ||
              it.href.endsWith('/' + coverMetaRef)
          );
          if (item?.href) {
            const mt = item.mediaType;
            const resolved = resolveRelativePath(opfDir, item.href);
            if (mt.startsWith('image/') || isRasterImageFileName(resolved)) {
              coverPath = resolved;
              coverMediaType = mt || mimeFromImagePath(resolved);
            } else if (mt.includes('html') || mt.includes('xml') || /\.x?html?$/i.test(resolved)) {
              const inner = await extractImageFromXhtmlCover(zip, resolved);
              if (inner) {
                coverPath = inner.path;
                coverMediaType = inner.mime;
              }
            }
          } else if (isRasterImageFileName(coverMetaRef)) {
            const candidate = resolveRelativePath(opfDir, coverMetaRef);
            if (findZipFile(zip, candidate)) {
              coverPath = candidate;
              coverMediaType = mimeFromImagePath(candidate);
            }
          }
        }

        // 3. Manifest image item with 'cover' / 'portada' / 'front' in id or href
        if (!coverPath) {
          const guess = manifestItems.find((it) => {
            const isImg = (it.mediaType.startsWith('image/') && !it.mediaType.includes('svg')) || isRasterImageFileName(it.href);
            return isImg && /(cover|portada|front|titlepage|jacket)/i.test(`${it.id} ${it.href}`);
          });
          if (guess?.href) {
            coverPath = resolveRelativePath(opfDir, guess.href);
            coverMediaType = guess.mediaType || mimeFromImagePath(coverPath);
          }
        }

        // 4. <guide><reference type="cover"/> or cover XHTML / first spine document
        if (!coverPath) {
          const xhtmlCandidates: string[] = [];
          if (guideCoverHref) {
            xhtmlCandidates.push(resolveRelativePath(opfDir, guideCoverHref));
          }
          const coverHtmlItem = manifestItems.find((it) => {
            const isHtml =
              it.mediaType.includes('html') ||
              it.mediaType.includes('xml') ||
              /\.x?html?$/i.test(it.href);
            return isHtml && /(cover|portada|titlepage)/i.test(`${it.id} ${it.href}`);
          });
          if (coverHtmlItem?.href) {
            xhtmlCandidates.push(resolveRelativePath(opfDir, coverHtmlItem.href));
          }
          if (firstSpineId) {
            const firstItem = manifestItems.find((it) => it.id === firstSpineId);
            if (firstItem?.href) {
              xhtmlCandidates.push(resolveRelativePath(opfDir, firstItem.href));
            }
          }
          for (const xhtmlPath of xhtmlCandidates) {
            const inner = await extractImageFromXhtmlCover(zip, xhtmlPath);
            if (inner) {
              coverPath = inner.path;
              coverMediaType = inner.mime;
              break;
            }
          }
        }

        // 5. Fallback: first sizable raster image in manifest (>= 8 KB)
        if (!coverPath) {
          const imageItems = manifestItems.filter(
            (it) =>
              (it.mediaType.startsWith('image/') && !it.mediaType.includes('svg')) ||
              isRasterImageFileName(it.href)
          );
          for (const it of imageItems.slice(0, 8)) {
            const resolved = resolveRelativePath(opfDir, it.href);
            const f = findZipFile(zip, resolved);
            if (!f) continue;
            const ab = await f.async('arraybuffer');
            if (ab.byteLength >= 8192) {
              const rawUrl = await blobToDataUrl(
                new Blob([ab], { type: it.mediaType || mimeFromImagePath(resolved) })
              );
              const coverDataUrl = await optimizeCoverDataUrl(rawUrl);
              if (isRasterCoverDataUrl(coverDataUrl)) {
                return { title, author, description, coverDataUrl };
              }
            }
          }
        }
      }
    }

    // 6. Ultimate fallback: scan ZIP entries directly for a named cover or largest raster image (>= 8 KB)
    if (!coverPath) {
      const zipImgKeys = Object.keys(zip.files).filter(
        (k) => !zip.files[k].dir && !k.startsWith('__MACOSX') && isRasterImageFileName(k)
      );
      const named = zipImgKeys.find((k) => /(cover|portada|front|titlepage)/i.test(k));
      if (named) {
        coverPath = named;
        coverMediaType = mimeFromImagePath(named);
      } else {
        let bestKey: string | null = null;
        let bestSize = 0;
        for (const key of zipImgKeys.slice(0, 12)) {
          const ab = await zip.files[key].async('arraybuffer');
          if (ab.byteLength >= 8192 && ab.byteLength > bestSize) {
            bestSize = ab.byteLength;
            bestKey = key;
          }
        }
        if (bestKey) {
          coverPath = bestKey;
          coverMediaType = mimeFromImagePath(bestKey);
        }
      }
    }

    let coverDataUrl: string | undefined;
    if (coverPath) {
      const imgFile = findZipFile(zip, coverPath);
      if (imgFile) {
        const ab = await imgFile.async('arraybuffer');
        if (ab.byteLength > 64) {
          const mime = coverMediaType || mimeFromImagePath(coverPath);
          if (!mime.includes('svg')) {
            const rawUrl = await blobToDataUrl(new Blob([ab], { type: mime }));
            const optimized = await optimizeCoverDataUrl(rawUrl);
            if (isRasterCoverDataUrl(optimized)) {
              coverDataUrl = optimized;
            }
          }
        }
      }
    }

    return { title, author, description, coverDataUrl };
  } catch (err) {
    console.warn('EPUB metadata extraction fallback:', err);
    return {};
  }
}
