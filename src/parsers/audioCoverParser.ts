import { blobToDataUrl, optimizeCoverDataUrl } from './coverGenerator';

/**
 * Pure TypeScript embedded cover art extractor for audiobooks (MP3 ID3v2 APIC & M4B/M4A MP4 covr).
 */

function readSyncSafe32(b: Uint8Array, off: number): number {
  return ((b[off] & 0x7f) << 21) | ((b[off + 1] & 0x7f) << 14) | ((b[off + 2] & 0x7f) << 7) | (b[off + 3] & 0x7f);
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

function extractId3v2Cover(bytes: Uint8Array): { data: Uint8Array; mime: string } | null {
  if (bytes.length < 16) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"
  const version = bytes[3];
  const flags = bytes[5];
  const tagSize = readSyncSafe32(bytes, 6);
  let pos = 10;
  const end = Math.min(bytes.length, 10 + tagSize);

  // Skip extended header if present
  if (flags & 0x40 && pos + 4 <= end) {
    const extSize = version === 4 ? readSyncSafe32(bytes, pos) : readU32(bytes, pos);
    pos += version === 4 ? extSize : extSize + 4;
  }

  while (pos + 10 < end) {
    if (bytes[pos] === 0) break;
    const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const frameSize = version === 4 ? readSyncSafe32(bytes, pos + 4) : readU32(bytes, pos + 4);
    const frameStart = pos + 10;
    const frameEnd = frameStart + frameSize;
    if (frameSize <= 0 || frameEnd > end) break;

    if (frameId === 'APIC') {
      const encoding = bytes[frameStart];
      let p = frameStart + 1;
      // Read null-terminated MIME string
      let mime = '';
      while (p < frameEnd && bytes[p] !== 0) {
        mime += String.fromCharCode(bytes[p++]);
      }
      p++; // skip null
      p++; // skip picture type byte
      // Skip null-terminated description
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
          return { data: imgBytes, mime: mime.startsWith('image/') ? mime : detected };
        }
      }
    }

    pos = frameEnd;
  }
  return null;
}

function extractMp4Covr(bytes: Uint8Array): { data: Uint8Array; mime: string } | null {
  // Scan for 'covr' atom containing a 'data' sub-atom (common in M4B/M4A audiobooks)
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
          if (mime) return { data: imgBytes, mime };
        }
      }
    }
  }
  return null;
}

export async function extractAudioCover(blob: Blob): Promise<string | undefined> {
  try {
    // Only inspect the first 4 MB where ID3v2 / MP4 moov metadata normally lives
    const slice = blob.slice(0, Math.min(blob.size, 4 * 1024 * 1024));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const found = extractId3v2Cover(bytes) || extractMp4Covr(bytes);
    if (!found) return undefined;
    const copy = new Uint8Array(found.data);
    const rawUrl = await blobToDataUrl(new Blob([copy], { type: found.mime }));
    return await optimizeCoverDataUrl(rawUrl);
  } catch {
    return undefined;
  }
}
