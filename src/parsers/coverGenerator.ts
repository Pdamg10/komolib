import type { ContentKind } from '../types/library';

const PALETTES: Array<{ bg1: string; bg2: string; spine: string; ribbon: string; ink: string }> = [
  { bg1: '#233b4d', bg2: '#3d637d', spine: '#22384a', ribbon: '#f0b85c', ink: '#f8f5ef' },
  { bg1: '#8678b5', bg2: '#b3a3d9', spine: '#6f619e', ribbon: '#f3c063', ink: '#ffffff' },
  { bg1: '#db5858', bg2: '#ec7c76', spine: '#be4749', ribbon: '#f4c76b', ink: '#fffaf5' },
  { bg1: '#498b5c', bg2: '#75b583', spine: '#3b734b', ribbon: '#f0bc5e', ink: '#f8fdf8' },
  { bg1: '#355c7d', bg2: '#557ea3', spine: '#2c4c69', ribbon: '#f3b95c', ink: '#fafcff' },
  { bg1: '#c87456', bg2: '#e29a78', spine: '#a85d43', ribbon: '#f5cb75', ink: '#fffaf4' },
  { bg1: '#5d537a', bg2: '#8978ad', spine: '#4a4164', ribbon: '#f69e94', ink: '#faf8ff' },
];

export function pickPaletteForString(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

function escapeXml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= maxChars) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w.slice(0, maxChars);
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ['Sin título'];
}

export function generateCozyCover(
  title: string,
  author: string,
  kind: ContentKind,
  format: string
): { coverDataUrl: string; spineColor: string; ribbonColor: string } {
  const pal = pickPaletteForString(title + author);
  const titleLines = wrapLines(title, 15, 3);
  const safeAuthor = escapeXml((author || 'Autor desconocido').slice(0, 26));
  const badge = escapeXml(
    kind === 'manga'
      ? 'MANGA'
      : kind === 'manhwa'
      ? 'MANHWA'
      : kind === 'comic'
      ? 'COMIC'
      : kind === 'audiobook'
      ? 'AUDIO'
      : format.toUpperCase()
  );

  const motif =
    kind === 'manga' || kind === 'manhwa'
      ? `<circle cx="150" cy="215" r="46" fill="rgba(255,255,255,0.16)"/>
         <path d="M115 225 L150 175 L185 225 Z" fill="rgba(255,255,255,0.28)"/>
         <circle cx="150" cy="195" r="14" fill="${pal.ribbon}"/>`
      : kind === 'audiobook'
      ? `<circle cx="150" cy="215" r="44" fill="rgba(255,255,255,0.18)"/>
         <path d="M122 218 a28 28 0 0 1 56 0" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>
         <rect x="116" y="214" width="12" height="22" rx="6" fill="${pal.ribbon}"/>
         <rect x="172" y="214" width="12" height="22" rx="6" fill="${pal.ribbon}"/>`
      : `<circle cx="150" cy="216" r="42" fill="rgba(255,255,255,0.15)"/>
         <circle cx="150" cy="216" r="24" fill="rgba(255,255,255,0.2)"/>
         <path d="M150 182 L156 208 L182 216 L156 224 L150 250 L144 224 L118 216 L144 208 Z" fill="${pal.ribbon}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal.bg1}"/>
        <stop offset="100%" stop-color="${pal.bg2}"/>
      </linearGradient>
    </defs>
    <rect width="300" height="420" fill="url(#g)"/>
    <circle cx="260" cy="54" r="76" fill="rgba(255,255,255,0.08)"/>
    <circle cx="34" cy="368" r="90" fill="rgba(0,0,0,0.1)"/>
    <rect x="22" y="22" width="256" height="376" rx="14" fill="none" stroke="rgba(255,255,255,0.24)" stroke-width="2"/>
    <rect x="100" y="42" width="100" height="24" rx="12" fill="rgba(0,0,0,0.24)"/>
    <text x="150" y="58" text-anchor="middle" fill="${pal.ink}" font-family="Quicksand,sans-serif" font-size="11" font-weight="700" letter-spacing="1.5">${badge}</text>
    ${titleLines
      .map(
        (line, i) =>
          `<text x="150" y="${108 + i * 28}" text-anchor="middle" fill="${pal.ink}" font-family="Quicksand,sans-serif" font-size="23" font-weight="700">${escapeXml(line)}</text>`
      )
      .join('')}
    ${motif}
    <text x="150" y="346" text-anchor="middle" fill="${pal.ink}" opacity="0.9" font-family="Nunito,sans-serif" font-size="14" font-weight="700">${safeAuthor}</text>
  </svg>`;

  return {
    coverDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    spineColor: pal.spine,
    ribbonColor: pal.ribbon,
  };
}

export async function extractDominantColorFromDataUrl(dataUrl: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(fallback);
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (!count) return resolve(fallback);
        // Darken slightly for crisp spine contrast
        const dr = Math.max(20, Math.round((r / count) * 0.78));
        const dg = Math.max(20, Math.round((g / count) * 0.78));
        const db = Math.max(20, Math.round((b / count) * 0.78));
        resolve(`rgb(${dr}, ${dg}, ${db})`);
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = dataUrl;
  });
}

export function naturalSortStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
