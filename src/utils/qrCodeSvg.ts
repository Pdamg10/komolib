/**
 * Minimal, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level L, Versions 1-6).
 * Generates an inline SVG data/path for local network URLs (up to 134 UTF-8 bytes) completely offline.
 */

interface QrVersionSpec {
  version: number;
  size: number;
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  blocks: number;
  alignment: number[];
}

// Level L specs for versions 1-6
const VERSIONS: QrVersionSpec[] = [
  { version: 1, size: 21, totalCodewords: 26, ecCodewordsPerBlock: 7, blocks: 1, alignment: [] },
  { version: 2, size: 25, totalCodewords: 44, ecCodewordsPerBlock: 10, blocks: 1, alignment: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecCodewordsPerBlock: 15, blocks: 1, alignment: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecCodewordsPerBlock: 20, blocks: 1, alignment: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecCodewordsPerBlock: 26, blocks: 1, alignment: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecCodewordsPerBlock: 18, blocks: 2, alignment: [6, 34] },
];

// GF(256) with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) {
    bits.push((value >>> i) & 1);
  }
}

function encodeDataCodewords(bytes: Uint8Array, dataCapacity: number): Uint8Array {
  const bits: number[] = [];
  // Mode 0100 = Byte
  appendBits(bits, 0b0100, 4);
  // Character count (8 bits for versions 1-9)
  appendBits(bits, bytes.length, 8);
  for (const b of bytes) {
    appendBits(bits, b, 8);
  }

  const maxBits = dataCapacity * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  appendBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(dataCapacity);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let b = 0; b < 8; b++) val = (val << 1) | bits[i + b];
    out[idx++] = val;
  }

  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (idx < dataCapacity) {
    out[idx++] = pads[padIdx % 2];
    padIdx++;
  }
  return out;
}

function computeFormatBits(ecBits: number, mask: number): number {
  const data = (ecBits << 3) | mask;
  let rem = data << 10;
  const poly = 0x537;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= poly << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFinder(grid: Int8Array[], reserved: Uint8Array[], row: number, col: number) {
  const size = grid.length;
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      grid[rr][cc] = inOuter && (isBorder || isCenter) ? 1 : 0;
      reserved[rr][cc] = 1;
    }
  }
}

function drawAlignment(grid: Int8Array[], reserved: Uint8Array[], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r;
      const cc = col + c;
      const dist = Math.max(Math.abs(r), Math.abs(c));
      grid[rr][cc] = dist === 0 || dist === 2 ? 1 : 0;
      reserved[rr][cc] = 1;
    }
  }
}

function applyFormat(grid: Int8Array[], reserved: Uint8Array[], formatBits: number) {
  const size = grid.length;
  const bit = (i: number) => ((formatBits >>> i) & 1) as 0 | 1;

  // Around top-left finder
  const coords1: Array<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = coords1[i];
    grid[r][c] = bit(14 - i);
    reserved[r][c] = 1;
  }

  // Copy 2: bottom-left (MSB bits 14..8) and top-right (bits 7..0)
  for (let i = 0; i < 7; i++) {
    grid[size - 1 - i][8] = bit(14 - i);
    reserved[size - 1 - i][8] = 1;
  }
  for (let i = 7; i < 15; i++) {
    grid[8][size - 15 + i] = bit(14 - i);
    reserved[8][size - 15 + i] = 1;
  }
}

export function generateQrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSIONS.find((v) => {
    const dataCap = v.totalCodewords - v.ecCodewordsPerBlock * v.blocks;
    // 4-bit mode + 8-bit length = 2 bytes overhead
    return bytes.length + 2 <= dataCap;
  });
  if (!spec) return null;

  const dataCapacity = spec.totalCodewords - spec.ecCodewordsPerBlock * spec.blocks;
  const dataCodewords = encodeDataCodewords(bytes, dataCapacity);

  // Split into blocks & compute Reed-Solomon EC codewords
  const blockDataLen = Math.floor(dataCapacity / spec.blocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = dataCodewords.slice(b * blockDataLen, (b + 1) * blockDataLen);
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecCodewordsPerBlock));
  }

  // Interleave
  const finalBytes: number[] = [];
  for (let i = 0; i < blockDataLen; i++) {
    for (let b = 0; b < spec.blocks; b++) finalBytes.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) finalBytes.push(ecBlocks[b][i]);
  }

  const size = spec.size;
  const grid = Array.from({ length: size }, () => new Int8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  drawFinder(grid, reserved, 0, 0);
  drawFinder(grid, reserved, 0, size - 7);
  drawFinder(grid, reserved, size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    grid[6][i] = v;
    reserved[6][i] = 1;
    grid[i][6] = v;
    reserved[i][6] = 1;
  }

  // Alignment patterns
  for (const r of spec.alignment) {
    for (const c of spec.alignment) {
      if (reserved[r][c]) continue;
      drawAlignment(grid, reserved, r, c);
    }
  }

  // Dark module
  grid[size - 8][8] = 1;
  reserved[size - 8][8] = 1;

  // Reserve format info areas before data placement
  const placeholderFormat = computeFormatBits(0b01, 0);
  applyFormat(grid, reserved, placeholderFormat);

  // Place data bits in upward/downward zig-zag columns
  let bitIndex = 0;
  const totalBits = finalBytes.length * 8;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const cc = col - dc;
        if (reserved[row][cc]) continue;
        let bit = 0;
        if (bitIndex < totalBits) {
          bit = (finalBytes[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
          bitIndex++;
        }
        // Apply Mask 0: (row + col) % 2 === 0
        if ((row + cc) % 2 === 0) bit ^= 1;
        grid[row][cc] = bit;
      }
    }
    upward = !upward;
  }

  // Re-apply format info for Level L (0b01) + Mask 0 (0b000)
  applyFormat(grid, reserved, computeFormatBits(0b01, 0));

  return grid.map((row) => Array.from(row, (v) => v === 1));
}

export function generateQrSvgPath(text: string): { size: number; path: string } | null {
  const matrix = generateQrMatrix(text);
  if (!matrix) return null;
  const size = matrix.length;
  const cmds: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        cmds.push(`M${c},${r}h1v1h-1z`);
      }
    }
  }
  return { size, path: cmds.join('') };
}
