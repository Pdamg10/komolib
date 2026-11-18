import JSZip from 'jszip';
import { marked } from 'marked';
import type { BookFormat } from '../types/library';
import { parseMobiBlob } from './mobiParser';

export interface ParsedRichDocument {
  title?: string;
  author?: string;
  description?: string;
  coverDataUrl?: string;
  html: string;
  chapters: Array<{ id: string; title: string }>;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractChaptersFromHtml(html: string): {
  html: string;
  chapters: Array<{ id: string; title: string }>;
} {
  const chapters: Array<{ id: string; title: string }> = [];
  let idx = 0;
  const annotated = html.replace(/<(h[1-3])([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner) => {
    const id = `komo-ch-${idx++}`;
    const plain = inner.replace(/<[^>]+>/g, '').trim();
    if (plain) {
      chapters.push({ id, title: plain.slice(0, 72) });
    }
    return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
  });
  return { html: annotated, chapters };
}

export async function parseFb2(blob: Blob): Promise<ParsedRichDocument> {
  const xmlText = await blob.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const title = doc.querySelector('title-info > book-title')?.textContent?.trim() || undefined;
  const firstName = doc.querySelector('title-info > author > first-name')?.textContent?.trim() || '';
  const lastName = doc.querySelector('title-info > author > last-name')?.textContent?.trim() || '';
  const author = `${firstName} ${lastName}`.trim() || undefined;
  const description = doc.querySelector('title-info > annotation')?.textContent?.trim() || undefined;

  // Extract cover from <binary>
  let coverDataUrl: string | undefined;
  const coverRef = doc
    .querySelector('title-info > coverpage > image')
    ?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    ?.replace(/^#/, '');

  const binaries = Array.from(doc.querySelectorAll('binary'));
  const coverBin =
    (coverRef ? binaries.find((b) => b.getAttribute('id') === coverRef) : binaries[0]) || null;
  if (coverBin && coverBin.textContent) {
    const contentType = coverBin.getAttribute('content-type') || 'image/jpeg';
    const b64 = coverBin.textContent.replace(/\s+/g, '');
    coverDataUrl = `data:${contentType};base64,${b64}`;
  }

  // Convert body sections into HTML
  const body = doc.querySelector('body');
  const htmlParts: string[] = [];
  if (body) {
    const walk = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'title') {
        const t = node.textContent?.trim();
        if (t) htmlParts.push(`<h2>${escapeHtml(t)}</h2>`);
        return;
      }
      if (tag === 'subtitle') {
        const t = node.textContent?.trim();
        if (t) htmlParts.push(`<h3>${escapeHtml(t)}</h3>`);
        return;
      }
      if (tag === 'p') {
        htmlParts.push(`<p>${escapeHtml(node.textContent || '')}</p>`);
        return;
      }
      if (tag === 'empty-line') {
        htmlParts.push('<br/>');
        return;
      }
      if (tag === 'poem' || tag === 'cite' || tag === 'epigraph') {
        htmlParts.push(`<blockquote>${escapeHtml(node.textContent || '')}</blockquote>`);
        return;
      }
      Array.from(node.children).forEach(walk);
    };
    Array.from(body.children).forEach(walk);
  }

  const rawHtml = htmlParts.join('\n') || `<p>${escapeHtml(xmlText.slice(0, 4000))}</p>`;
  const { html, chapters } = extractChaptersFromHtml(rawHtml);

  return { title, author, description, coverDataUrl, html, chapters };
}

export async function parseDocx(blob: Blob): Promise<ParsedRichDocument> {
  const zip = await JSZip.loadAsync(blob);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) {
    return { html: '<p>No se encontró contenido en este archivo DOCX.</p>', chapters: [] };
  }
  const parser = new DOMParser();
  const xml = parser.parseFromString(docXml, 'application/xml');
  const paragraphs = Array.from(xml.getElementsByTagName('w:p'));
  const parts: string[] = [];

  for (const p of paragraphs) {
    const texts = Array.from(p.getElementsByTagName('w:t'))
      .map((n) => n.textContent || '')
      .join('');
    if (!texts.trim()) continue;
    const styleVal = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    if (/heading1|título1|title/i.test(styleVal)) {
      parts.push(`<h1>${escapeHtml(texts)}</h1>`);
    } else if (/heading2|título2|subtitle/i.test(styleVal)) {
      parts.push(`<h2>${escapeHtml(texts)}</h2>`);
    } else if (/heading3|título3/i.test(styleVal)) {
      parts.push(`<h3>${escapeHtml(texts)}</h3>`);
    } else {
      parts.push(`<p>${escapeHtml(texts)}</p>`);
    }
  }

  const { html, chapters } = extractChaptersFromHtml(parts.join('\n'));
  return { html, chapters };
}

export async function parseRichFormat(
  blob: Blob,
  format: BookFormat,
  fallbackTitle: string
): Promise<ParsedRichDocument> {
  if (format === 'fb2') {
    return parseFb2(blob);
  }
  if (format === 'docx') {
    return parseDocx(blob);
  }
  if (format === 'mobi' || format === 'azw3') {
    const res = await parseMobiBlob(blob, fallbackTitle);
    const { html, chapters } = extractChaptersFromHtml(res.html);
    return { title: res.title, author: res.author, html, chapters };
  }
  if (format === 'md') {
    const text = await blob.text();
    const rendered = await marked.parse(text);
    const { html, chapters } = extractChaptersFromHtml(String(rendered));
    return { html, chapters };
  }
  if (format === 'html') {
    const raw = await blob.text();
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const { html, chapters } = extractChaptersFromHtml(bodyMatch ? bodyMatch[1] : cleaned);
    return { html, chapters };
  }

  // TXT fallback with smart chapter detection
  const rawTxt = await blob.text();
  const blocks = rawTxt.split(/\r?\n\r?\n+/);
  const htmlBlocks = blocks.map((b) => {
    const trimmed = b.trim();
    if (!trimmed) return '';
    if (/^(cap[ií]tulo|chapter|parte|part|pr[oó]logo|ep[ií]logo)\b/i.test(trimmed) && trimmed.length < 90) {
      return `<h2>${escapeHtml(trimmed)}</h2>`;
    }
    return `<p>${escapeHtml(trimmed).replace(/\r?\n/g, '<br/>')}</p>`;
  });
  const { html, chapters } = extractChaptersFromHtml(htmlBlocks.join('\n'));
  return { html, chapters };
}
