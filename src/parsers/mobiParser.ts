/**
 * Pure TypeScript PalmDB / PalmDOC / MOBI / AZW parser.
 * Supports uncompressed (type 1) and PalmDOC LZ77 compressed (type 2) MOBI/PRC/AZW files.
 */

import { blobToDataUrl, optimizeCoverDataUrl } from './coverGenerator';

export interface MobiParseResult {
  title: string;
  author: string;
  coverDataUrl?: string;
  html: string;
  warning?: string;
}

function detectMobiImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 16) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

async function extractMobiCoverFromRecords(
  bytes: Uint8Array,
  offsets: number[],
  firstImageIndex: number,
  coverOffset: number | null,
  thumbOffset: number | null,
  fallbackStart: number
): Promise<string | undefined> {
  const tryRecord = async (recIdx: number): Promise<string | undefined> => {
    if (recIdx <= 0 || recIdx >= offsets.length) return undefined;
    const start = offsets[recIdx];
    const end = recIdx + 1 < offsets.length ? offsets[recIdx + 1] : bytes.byteLength;
    if (end - start < 512) return undefined;
    const slice = bytes.subarray(start, end);
    const mime = detectMobiImageMime(slice);
    if (!mime) return undefined;
    const copy = new Uint8Array(slice);
    const raw = await blobToDataUrl(new Blob([copy], { type: mime }));
    return optimizeCoverDataUrl(raw);
  };

  if (firstImageIndex !== 0xffffffff && firstImageIndex < offsets.length) {
    if (coverOffset !== null && coverOffset !== 0xffffffff) {
      const url = await tryRecord(firstImageIndex + coverOffset);
      if (url) return url;
    }
    if (thumbOffset !== null && thumbOffset !== 0xffffffff) {
      const url = await tryRecord(firstImageIndex + thumbOffset);
      if (url) return url;
    }
  }

  // Fallback: scan image records after text records for the first sizable cover image
  const scanStart =
    firstImageIndex !== 0xffffffff && firstImageIndex < offsets.length
      ? firstImageIndex
      : Math.max(1, fallbackStart);
  const scanLimit = Math.min(offsets.length, scanStart + 24);
  for (let idx = scanStart; idx < scanLimit; idx++) {
    const start = offsets[idx];
    const end = idx + 1 < offsets.length ? offsets[idx + 1] : bytes.byteLength;
    if (end - start < 2048) continue;
    const url = await tryRecord(idx);
    if (url) return url;
  }
  return undefined;
}

function decompressPalmDoc(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const byte = input[i++];
    if (byte === 0) {
      out.push(0);
    } else if (byte >= 1 && byte <= 8) {
      for (let k = 0; k < byte && i < input.length; k++) {
        out.push(input[i++]);
      }
    } else if (byte <= 0x7f) {
      out.push(byte);
    } else if (byte >= 0xc0) {
      out.push(0x20);
      out.push(byte ^ 0x80);
    } else {
      // 0x80..0xbf: LZ77 distance/length pair
      if (i >= input.length) break;
      const next = input[i++];
      const combined = ((byte << 8) | next) & 0x3fff;
      const dist = combined >> 3;
      const len = (combined & 0x07) + 3;
      if (dist === 0 || dist > out.length) continue;
      for (let k = 0; k < len; k++) {
        out.push(out[out.length - dist]);
      }
    }
  }
  return new Uint8Array(out);
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

export async function parseMobiBlob(blob: Blob, fallbackTitle: string): Promise<MobiParseResult> {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  if (buf.byteLength < 90) {
    return {
      title: fallbackTitle,
      author: 'Desconocido',
      html: `<p>Archivo MOBI demasiado pequeño o corrupto.</p>`,
    };
  }

  const pdbName = readAscii(view, 0, 32).replace(/_/g, ' ') || fallbackTitle;
  const numRecords = view.getUint16(76, false);

  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) {
    const pos = 78 + i * 8;
    if (pos + 4 > buf.byteLength) break;
    offsets.push(view.getUint32(pos, false));
  }
  if (offsets.length < 2) {
    return {
      title: pdbName,
      author: 'Desconocido',
      html: `<p>No se encontraron registros de contenido en este archivo MOBI.</p>`,
    };
  }

  const rec0Start = offsets[0];
  const rec0End = offsets[1] || buf.byteLength;
  const rec0 = new DataView(buf, rec0Start, Math.max(0, rec0End - rec0Start));

  const compression = rec0.getUint16(0, false);
  const textRecordCount = rec0.getUint16(8, false);
  const encryption = rec0.byteLength >= 14 ? rec0.getUint16(12, false) : 0;

  if (encryption !== 0) {
    return {
      title: pdbName,
      author: 'Desconocido',
      warning: 'DRM detectado',
      html: `<div style="padding:20px;border-radius:14px;background:rgba(232,111,104,0.12);">
        <h3>Archivo protegido con DRM</h3>
        <p>Este archivo MOBI/AZW contiene cifrado DRM. Para leerlo en KomoLib necesitas una copia libre de DRM o convertirlo a EPUB.</p>
      </div>`,
    };
  }

  let title = pdbName;
  let author = 'Biblioteca MOBI';
  let encoding = 65001; // UTF-8 default
  let extraFlags = 0;
  let firstImageIndex = 0xffffffff;
  let coverOffset: number | null = null;
  let thumbOffset: number | null = null;

  // Check MOBI header magic at offset 16
  if (rec0.byteLength >= 132 && readAscii(rec0, 16, 4) === 'MOBI') {
    const mobiHeaderLen = rec0.getUint32(20, false);
    encoding = rec0.getUint32(28, false);
    const fullNameOffset = rec0.getUint32(84, false);
    const fullNameLen = rec0.getUint32(88, false);
    if (fullNameLen > 0 && fullNameOffset + fullNameLen <= rec0.byteLength) {
      const dec = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8', { fatal: false });
      const parsedTitle = dec.decode(new Uint8Array(buf, rec0Start + fullNameOffset, fullNameLen)).trim();
      if (parsedTitle) title = parsedTitle;
    }
    firstImageIndex = rec0.getUint32(108, false);
    const exthFlags = rec0.getUint32(128, false);
    if (rec0.byteLength >= 244) {
      extraFlags = rec0.getUint16(242, false);
    }

    // Parse EXTH header for cover offset (201), thumbnail offset (202), and author (100)
    const exthStart = 16 + mobiHeaderLen;
    if ((exthFlags & 0x40) !== 0 && exthStart + 12 <= rec0.byteLength && readAscii(rec0, exthStart, 4) === 'EXTH') {
      const exthCount = rec0.getUint32(exthStart + 8, false);
      let pos = exthStart + 12;
      const dec = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8', { fatal: false });
      for (let i = 0; i < exthCount && pos + 8 <= rec0.byteLength; i++) {
        const recType = rec0.getUint32(pos, false);
        const recLen = rec0.getUint32(pos + 4, false);
        if (recLen < 8 || pos + recLen > rec0.byteLength) break;
        const valLen = recLen - 8;
        if (recType === 201 && valLen === 4) {
          coverOffset = rec0.getUint32(pos + 8, false);
        } else if (recType === 202 && valLen === 4) {
          thumbOffset = rec0.getUint32(pos + 8, false);
        } else if (recType === 100 && valLen > 0) {
          const parsedAuthor = dec
            .decode(new Uint8Array(buf, rec0Start + pos + 8, valLen))
            .trim();
          if (parsedAuthor) author = parsedAuthor;
        }
        pos += recLen;
      }
    }
  }

  const coverDataUrl = await extractMobiCoverFromRecords(
    bytes,
    offsets,
    firstImageIndex,
    coverOffset,
    thumbOffset,
    textRecordCount + 1
  );

  if (compression === 17480) {
    return {
      title,
      author,
      coverDataUrl,
      warning: 'Compresión Huff/CDIC',
      html: `<div style="padding:20px;border-radius:14px;background:rgba(141,126,199,0.12);">
        <h3>Formato AZW/MOBI con compresión Huff/CDIC</h3>
        <p>Este archivo usa compresión propietaria Huff/CDIC. KomoLib soporta MOBI estándar (sin compresión y PalmDOC LZ77). Convierte este archivo a EPUB con Calibre para disfrutar de todas las funciones.</p>
      </div>`,
    };
  }

  const chunks: Uint8Array[] = [];
  const maxIdx = Math.min(textRecordCount, offsets.length - 1);
  for (let idx = 1; idx <= maxIdx; idx++) {
    const start = offsets[idx];
    const end = idx + 1 < offsets.length ? offsets[idx + 1] : buf.byteLength;
    if (end <= start) continue;
    let slice = bytes.subarray(start, end);

    // Strip trailing extra data bytes if extraFlags set
    if (extraFlags) {
      let trim = 0;
      let flags = extraFlags >> 1;
      let pos = slice.length;
      while (flags > 0 && pos > 0) {
        if (flags & 1) {
          // backward variable-width integer
          let size = 0;
          let shift = 0;
          while (pos > 0) {
            const b = slice[--pos];
            size |= (b & 0x7f) << shift;
            shift += 7;
            if (b & 0x80) break;
          }
          trim += size;
        }
        flags >>= 1;
      }
      if (extraFlags & 1 && slice.length > trim) {
        const multibyte = (slice[slice.length - trim - 1] & 0x03) + 1;
        trim += multibyte;
      }
      if (trim > 0 && trim < slice.length) {
        slice = slice.subarray(0, slice.length - trim);
      }
    }

    if (compression === 2) {
      chunks.push(decompressPalmDoc(slice));
    } else {
      chunks.push(slice);
    }
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let cursor = 0;
  for (const c of chunks) {
    merged.set(c, cursor);
    cursor += c.length;
  }

  const decoder = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8', { fatal: false });
  let text = decoder.decode(merged);

  // Clean dangerous tags & Kindle-specific attributes
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<mbp:pagebreak\s*\/?>/gi, '<hr class="chapter-break" />');

  const isHtml = /<(p|div|html|body|br|h1|h2)\b/i.test(text);
  const html = isHtml
    ? text
    : text
        .split(/\r?\n\r?\n+/)
        .map((p) => `<p>${p.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br/>')}</p>`)
        .join('');

  return {
    title,
    author,
    coverDataUrl,
    html,
  };
}
