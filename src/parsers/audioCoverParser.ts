import { blobToDataUrl, optimizeCoverDataUrl } from './coverGenerator';

/**
 * Pure TypeScript embedded metadata & cover art extractor for audiobooks
 * (MP3 ID3v2 APIC/TIT2/TPE1/TPE2/COMM & M4B/M4A/AAC MP4 covr/©nam/©ART/aART/desc).
 */

export interface AudioMetaAndCover {
  title?: string;
  author?: string;
  description?: string;
  coverDataUrl?: string;
}

function readSyncSafe32(b: Uint8Array, off: number): number {
  return (
    ((b[off] & 0x7f) << 21) |
    ((b[off + 1] & 0x7f) << 14) |
    ((b[off + 2] & 0x7f) << 7) |
    (b[off + 3] & 0x7f)
  );
}

function readU32(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
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

function decodeId3Text(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 1 || encoding === 2) {
      const hasBomLE = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
      const hasBomBE = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
      const label = hasBomLE ? 'utf-16le' : hasBomBE || encoding === 2 ? 'utf-16be' : 'utf-16le';
      const slice = hasBomLE || hasBomBE ? bytes.slice(2) : bytes;
      return new TextDecoder(label).decode(slice).replace(/\0/g, '').trim();
    }
    if (encoding === 3) {
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
    }
    return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

function extractId3v2MetaAndCover(bytes: Uint8Array): {
  title?: string;
  author?: string;
  description?: string;
  cover?: { data: Uint8Array; mime: string };
} {
  if (bytes.length < 16) return {};
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return {}; // "ID3"
  const version = bytes[3];
  const flags = bytes[5];
  const tagSize = readSyncSafe32(bytes, 6);
  let pos = 10;
  const end = Math.min(bytes.length, 10 + tagSize);

  if (flags & 0x40 && pos + 4 <= end) {
    const extSize = version === 4 ? readSyncSafe32(bytes, pos) : readU32(bytes, pos);
    pos += version === 4 ? extSize : extSize + 4;
  }

  let title: string | undefined;
  let album: string | undefined;
  let author: string | undefined;
  let description: string | undefined;
  let cover: { data: Uint8Array; mime: string } | undefined;

  while (pos + 10 < end) {
    if (bytes[pos] === 0) break;
    const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const frameSize = version === 4 ? readSyncSafe32(bytes, pos + 4) : readU32(bytes, pos + 4);
    const frameStart = pos + 10;
    const frameEnd = frameStart + frameSize;
    if (frameSize <= 0 || frameEnd > end) break;

    if (frameId === 'TIT2' && !title && frameSize > 1) {
      const txt = decodeId3Text(bytes.slice(frameStart + 1, frameEnd), bytes[frameStart]);
      if (txt) title = txt;
    } else if (frameId === 'TALB' && !album && frameSize > 1) {
      const txt = decodeId3Text(bytes.slice(frameStart + 1, frameEnd), bytes[frameStart]);
      if (txt) album = txt;
    } else if ((frameId === 'TPE1' || frameId === 'TPE2' || frameId === 'TCOM') && !author && frameSize > 1) {
      const txt = decodeId3Text(bytes.slice(frameStart + 1, frameEnd), bytes[frameStart]);
      if (txt) author = txt;
    } else if (frameId === 'COMM' && !description && frameSize > 5) {
      const encoding = bytes[frameStart];
      let p = frameStart + 4; // skip encoding + 3-byte lang
      if (encoding === 1 || encoding === 2) {
        while (p + 1 < frameEnd && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < frameEnd && bytes[p] !== 0) p++;
        p++;
      }
      if (p < frameEnd) {
        const txt = decodeId3Text(bytes.slice(p, frameEnd), encoding);
        if (txt) description = txt;
      }
    } else if (frameId === 'APIC' && !cover) {
      const encoding = bytes[frameStart];
      let p = frameStart + 1;
      let mime = '';
      while (p < frameEnd && bytes[p] !== 0) {
        mime += String.fromCharCode(bytes[p++]);
      }
      p++; // skip null
      p++; // skip picture type byte
      if (encoding === 1 || encoding === 2) {
        while (p + 1 < frameEnd && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < frameEnd && bytes[p] !== 0) p++;
        p++;
      }
      if (p < frameEnd) {
        const imgBytes = bytes.slice(p, frameEnd);
        const detected = detectImageMime(imgBytes);
        if (detected) {
          cover = { data: imgBytes, mime: mime.startsWith('image/') ? mime : detected };
        }
      }
    }

    pos = frameEnd;
  }

  return { title: title || album, author, description, cover };
}

function findMp4DataText(bytes: Uint8Array, tagBytes: [number, number, number, number]): string | undefined {
  const decoder = new TextDecoder('utf-8');
  for (let i = 4; i < bytes.length - 24; i++) {
    if (
      bytes[i] === tagBytes[0] &&
      bytes[i + 1] === tagBytes[1] &&
      bytes[i + 2] === tagBytes[2] &&
      bytes[i + 3] === tagBytes[3]
    ) {
      const atomSize = readU32(bytes, i - 4);
      if (atomSize < 24 || atomSize > 65536) continue;
      const atomEnd = Math.min(bytes.length, i - 4 + atomSize);
      const dataPos = i + 4;
      if (
        dataPos + 16 < atomEnd &&
        bytes[dataPos + 4] === 0x64 &&
        bytes[dataPos + 5] === 0x61 &&
        bytes[dataPos + 6] === 0x74 &&
        bytes[dataPos + 7] === 0x61
      ) {
        const dataSize = readU32(bytes, dataPos);
        const txtStart = dataPos + 16;
        const txtEnd = Math.min(atomEnd, dataPos + dataSize);
        if (txtEnd > txtStart) {
          const txt = decoder.decode(bytes.slice(txtStart, txtEnd)).replace(/\0/g, '').trim();
          if (txt) return txt;
        }
      }
    }
  }
  return undefined;
}

function extractMp4MetaAndCover(bytes: Uint8Array): {
  title?: string;
  author?: string;
  description?: string;
  cover?: { data: Uint8Array; mime: string };
} {
  let cover: { data: Uint8Array; mime: string } | undefined;
  for (let i = 4; i < bytes.length - 24; i++) {
    if (
      bytes[i] === 0x63 &&
      bytes[i + 1] === 0x6f &&
      bytes[i + 2] === 0x76 &&
      bytes[i + 3] === 0x72
    ) {
      const atomSize = readU32(bytes, i - 4);
      const atomEnd = Math.min(bytes.length, i - 4 + atomSize);
      const dataPos = i + 4;
      if (
        dataPos + 16 < atomEnd &&
        bytes[dataPos + 4] === 0x64 &&
        bytes[dataPos + 5] === 0x61 &&
        bytes[dataPos + 6] === 0x74 &&
        bytes[dataPos + 7] === 0x61
      ) {
        const dataSize = readU32(bytes, dataPos);
        const imgStart = dataPos + 16;
        const imgEnd = Math.min(atomEnd, dataPos + dataSize);
        if (imgEnd > imgStart + 32) {
          const imgBytes = bytes.slice(imgStart, imgEnd);
          const mime = detectImageMime(imgBytes);
          if (mime) {
            cover = { data: imgBytes, mime };
            break;
          }
        }
      }
    }
  }

  const title =
    findMp4DataText(bytes, [0xa9, 0x6e, 0x61, 0x6d]) || // ©nam
    findMp4DataText(bytes, [0xa9, 0x61, 0x6c, 0x62]); // ©alb
  const author =
    findMp4DataText(bytes, [0xa9, 0x41, 0x52, 0x54]) || // ©ART
    findMp4DataText(bytes, [0x61, 0x41, 0x52, 0x54]); // aART
  const description =
    findMp4DataText(bytes, [0x64, 0x65, 0x73, 0x63]) || // desc
    findMp4DataText(bytes, [0x6c, 0x64, 0x65, 0x73]) || // ldes
    findMp4DataText(bytes, [0xa9, 0x63, 0x6d, 0x74]); // ©cmt

  return { title, author, description, cover };
}

export async function extractAudioMetaAndCover(blob: Blob): Promise<AudioMetaAndCover> {
  try {
    const slice = blob.slice(0, Math.min(blob.size, 4 * 1024 * 1024));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const id3 = extractId3v2MetaAndCover(bytes);
    const mp4 = !id3.cover && !id3.title && !id3.author ? extractMp4MetaAndCover(bytes) : {};
    const coverFound = id3.cover || mp4.cover;
    let coverDataUrl: string | undefined;
    if (coverFound) {
      const copy = new Uint8Array(coverFound.data);
      const rawUrl = await blobToDataUrl(new Blob([copy], { type: coverFound.mime }));
      coverDataUrl = await optimizeCoverDataUrl(rawUrl);
    }
    return {
      title: id3.title || mp4.title,
      author: id3.author || mp4.author,
      description: id3.description || mp4.description,
      coverDataUrl,
    };
  } catch {
    return {};
  }
}

export async function extractAudioCover(blob: Blob): Promise<string | undefined> {
  const res = await extractAudioMetaAndCover(blob);
  return res.coverDataUrl;
}
