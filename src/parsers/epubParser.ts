import JSZip from 'jszip';
import { blobToDataUrl, optimizeCoverDataUrl } from './coverGenerator';

export interface EpubMetaResult {
  title?: string;
  author?: string;
  description?: string;
  coverDataUrl?: string;
}

function resolveRelativePath(baseDir: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split('#')[0].split('?')[0]);
  if (!baseDir) return cleanHref.replace(/^\//, '');
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
  if (direct) return direct;
  const lower = clean.toLowerCase();
  for (const key of Object.keys(zip.files)) {
    if (!zip.files[key].dir && key.replace(/^\/+/, '').toLowerCase() === lower) {
      return zip.files[key];
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
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return fallback;
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
    /<img[^>]+src=["']([^"']+)["']/i,
    /<image[^>]+(?:xlink:href|href)=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1] && !match[1].startsWith('data:')) {
      const resolved = resolveRelativePath(xhtmlDir, match[1]);
      if (findZipFile(zip, resolved)) {
        return { path: resolved, mime: mimeFromImagePath(resolved) };
      }
    }
  }
  return null;
}

export async function extractEpubMetaAndCover(blob: Blob): Promise<EpubMetaResult> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const containerXml = await findZipFile(zip, 'META-INF/container.xml')?.async('string');
    if (!containerXml) return {};

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) return {};

    const opfXml = await findZipFile(zip, opfPath)?.async('string');
    if (!opfXml) return {};

    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

    const title =
      opfDoc.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() ||
      opfDoc.querySelector('title')?.textContent?.trim() ||
      undefined;
    const author =
      opfDoc.getElementsByTagNameNS('*', 'creator')[0]?.textContent?.trim() ||
      opfDoc.querySelector('creator')?.textContent?.trim() ||
      undefined;
    const description =
      opfDoc.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim() || undefined;

    const manifestItems = Array.from(opfDoc.querySelectorAll('manifest > item'));
    let coverPath: string | null = null;
    let coverMediaType = 'image/jpeg';

    // 1. EPUB 3: properties="cover-image"
    const propItem = manifestItems.find((it) =>
      (it.getAttribute('properties') || '').split(/\s+/).includes('cover-image')
    );
    if (propItem?.getAttribute('href')) {
      coverPath = resolveRelativePath(opfDir, propItem.getAttribute('href')!);
      coverMediaType = propItem.getAttribute('media-type') || mimeFromImagePath(coverPath);
    }

    // 2. EPUB 2: <meta name="cover" content="id-or-href"/>
    if (!coverPath) {
      const metaCover = Array.from(opfDoc.querySelectorAll('metadata meta')).find(
        (m) => m.getAttribute('name')?.toLowerCase() === 'cover'
      );
      const coverRef = metaCover?.getAttribute('content')?.trim();
      if (coverRef) {
        const item = manifestItems.find(
          (it) =>
            it.getAttribute('id') === coverRef ||
            it.getAttribute('href') === coverRef ||
            (it.getAttribute('href') || '').endsWith('/' + coverRef)
        );
        if (item?.getAttribute('href')) {
          const mt = item.getAttribute('media-type') || '';
          const resolved = resolveRelativePath(opfDir, item.getAttribute('href')!);
          if (mt.startsWith('image/')) {
            coverPath = resolved;
            coverMediaType = mt;
          } else if (mt.includes('html') || mt.includes('xml')) {
            const inner = await extractImageFromXhtmlCover(zip, resolved);
            if (inner) {
              coverPath = inner.path;
              coverMediaType = inner.mime;
            }
          }
        } else if (/\.(jpe?g|png|webp|gif|svg)$/i.test(coverRef)) {
          const candidate = resolveRelativePath(opfDir, coverRef);
          if (findZipFile(zip, candidate)) {
            coverPath = candidate;
            coverMediaType = mimeFromImagePath(candidate);
          }
        }
      }
    }

    // 3. Manifest image item with 'cover' / 'portada' / 'front' in id or href
    if (!coverPath) {
      const guess = manifestItems.find((it) => {
        const mt = it.getAttribute('media-type') || '';
        const id = (it.getAttribute('id') || '').toLowerCase();
        const href = (it.getAttribute('href') || '').toLowerCase();
        return (
          mt.startsWith('image/') &&
          /(cover|portada|front|titlepage|jacket)/i.test(`${id} ${href}`)
        );
      });
      if (guess?.getAttribute('href')) {
        coverPath = resolveRelativePath(opfDir, guess.getAttribute('href')!);
        coverMediaType = guess.getAttribute('media-type') || mimeFromImagePath(coverPath);
      }
    }

    // 4. <guide><reference type="cover"/> or cover XHTML / first spine document
    if (!coverPath) {
      const xhtmlCandidates: string[] = [];
      const guideCover = Array.from(opfDoc.querySelectorAll('guide > reference')).find((r) =>
        (r.getAttribute('type') || '').toLowerCase().includes('cover')
      );
      if (guideCover?.getAttribute('href')) {
        xhtmlCandidates.push(resolveRelativePath(opfDir, guideCover.getAttribute('href')!));
      }

      const coverHtmlItem = manifestItems.find((it) => {
        const mt = it.getAttribute('media-type') || '';
        const id = (it.getAttribute('id') || '').toLowerCase();
        const href = (it.getAttribute('href') || '').toLowerCase();
        return (mt.includes('html') || mt.includes('xml')) && /(cover|portada|titlepage)/i.test(`${id} ${href}`);
      });
      if (coverHtmlItem?.getAttribute('href')) {
        xhtmlCandidates.push(resolveRelativePath(opfDir, coverHtmlItem.getAttribute('href')!));
      }

      const firstSpineId = opfDoc.querySelector('spine > itemref')?.getAttribute('idref');
      if (firstSpineId) {
        const firstItem = manifestItems.find((it) => it.getAttribute('id') === firstSpineId);
        if (firstItem?.getAttribute('href')) {
          xhtmlCandidates.push(resolveRelativePath(opfDir, firstItem.getAttribute('href')!));
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

    // 5. Fallback: first sizable raster image in manifest (e.g. > 8 KB)
    if (!coverPath) {
      const imageItems = manifestItems.filter((it) => {
        const mt = it.getAttribute('media-type') || '';
        return mt.startsWith('image/') && !mt.includes('svg');
      });
      for (const it of imageItems.slice(0, 6)) {
        const href = it.getAttribute('href');
        if (!href) continue;
        const resolved = resolveRelativePath(opfDir, href);
        const f = findZipFile(zip, resolved);
        if (!f) continue;
        const ab = await f.async('arraybuffer');
        if (ab.byteLength >= 8192) {
          const rawUrl = await blobToDataUrl(
            new Blob([ab], { type: it.getAttribute('media-type') || mimeFromImagePath(resolved) })
          );
          const coverDataUrl = await optimizeCoverDataUrl(rawUrl);
          return { title, author, description, coverDataUrl };
        }
      }
    }

    let coverDataUrl: string | undefined;
    if (coverPath) {
      const imgFile = findZipFile(zip, coverPath);
      if (imgFile) {
        const ab = await imgFile.async('arraybuffer');
        const rawUrl = await blobToDataUrl(
          new Blob([ab], { type: coverMediaType || mimeFromImagePath(coverPath) })
        );
        coverDataUrl = await optimizeCoverDataUrl(rawUrl);
      }
    }

    return { title, author, description, coverDataUrl };
  } catch (err) {
    console.warn('EPUB metadata extraction fallback:', err);
    return {};
  }
}
