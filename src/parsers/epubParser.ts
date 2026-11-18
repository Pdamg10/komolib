import JSZip from 'jszip';
import { blobToDataUrl } from './coverGenerator';

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

export async function extractEpubMetaAndCover(blob: Blob): Promise<EpubMetaResult> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) return {};

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) return {};

    const opfXml = await zip.file(opfPath)?.async('string');
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

    // Locate cover item in manifest
    const manifestItems = Array.from(opfDoc.querySelectorAll('manifest > item'));
    let coverHref: string | null = null;
    let coverMediaType = 'image/jpeg';

    // EPUB 3: properties="cover-image"
    const propItem = manifestItems.find((it) =>
      (it.getAttribute('properties') || '').split(/\s+/).includes('cover-image')
    );
    if (propItem) {
      coverHref = propItem.getAttribute('href');
      coverMediaType = propItem.getAttribute('media-type') || coverMediaType;
    }

    // EPUB 2: <meta name="cover" content="id"/>
    if (!coverHref) {
      const metaCover = Array.from(opfDoc.querySelectorAll('metadata meta')).find(
        (m) => m.getAttribute('name')?.toLowerCase() === 'cover'
      );
      const coverId = metaCover?.getAttribute('content');
      if (coverId) {
        const item = manifestItems.find((it) => it.getAttribute('id') === coverId);
        if (item) {
          coverHref = item.getAttribute('href');
          coverMediaType = item.getAttribute('media-type') || coverMediaType;
        }
      }
    }

    // Fallback: any image item with 'cover' in id or href
    if (!coverHref) {
      const guess = manifestItems.find((it) => {
        const mt = it.getAttribute('media-type') || '';
        const id = (it.getAttribute('id') || '').toLowerCase();
        const href = (it.getAttribute('href') || '').toLowerCase();
        return mt.startsWith('image/') && (id.includes('cover') || href.includes('cover'));
      });
      if (guess) {
        coverHref = guess.getAttribute('href');
        coverMediaType = guess.getAttribute('media-type') || coverMediaType;
      }
    }

    let coverDataUrl: string | undefined;
    if (coverHref) {
      const fullPath = resolveRelativePath(opfDir, coverHref);
      const imgFile = zip.file(fullPath);
      if (imgFile) {
        const ab = await imgFile.async('arraybuffer');
        coverDataUrl = await blobToDataUrl(new Blob([ab], { type: coverMediaType }));
      }
    }

    return { title, author, description, coverDataUrl };
  } catch (err) {
    console.warn('EPUB metadata extraction fallback:', err);
    return {};
  }
}
