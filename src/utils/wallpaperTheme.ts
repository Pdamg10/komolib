import type { ThemeConfig } from '../types/library';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 1);
  const ln = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * Analyzes an uploaded wallpaper image and generates a high-contrast, color-harmonized
 * ThemeConfig patch so all panels, text, and accents match the background image cleanly.
 */
export async function extractWallpaperTheme(dataUrl: string): Promise<Partial<ThemeConfig>> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = 64;
        const h = 64;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve({});
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumLum = 0;
        let count = 0;

        let bestAccentScore = -1;
        let bestAccentHsl: [number, number, number] = [18, 0.62, 0.56];
        let secondAccentHsl: [number, number, number] | null = null;
        let secondAccentScore = -1;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          sumR += r;
          sumG += g;
          sumB += b;
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          sumLum += lum;
          count++;

          const [hue, sat, lig] = rgbToHsl(r, g, b);
          const midWeight = 1 - Math.abs(lig - 0.52) * 1.45;
          const score = sat * Math.max(0.1, midWeight);
          if (sat > 0.24 && score > bestAccentScore) {
            bestAccentScore = score;
            bestAccentHsl = [hue, sat, lig];
          }
        }

        if (!count) return resolve({});

        // Second pass for a harmonious secondary hue at least 35 deg away
        for (let i = 0; i < data.length; i += 16) {
          if (data[i + 3] < 128) continue;
          const [hue, sat, lig] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          const dist = Math.min(
            Math.abs(hue - bestAccentHsl[0]),
            360 - Math.abs(hue - bestAccentHsl[0])
          );
          if (dist < 35 || sat < 0.2) continue;
          const score = sat * (1 - Math.abs(lig - 0.52) * 1.3);
          if (score > secondAccentScore) {
            secondAccentScore = score;
            secondAccentHsl = [hue, sat, lig];
          }
        }

        const avgR = sumR / count;
        const avgG = sumG / count;
        const avgB = sumB / count;
        const avgLum = sumLum / count;
        const [baseHue, baseSat] = rgbToHsl(avgR, avgG, avgB);
        const tintSat = clamp(baseSat * 0.45, 0.06, 0.26);
        const isDark = avgLum < 0.48;

        const accentHue = bestAccentScore > 0.14 ? bestAccentHsl[0] : baseHue;
        const secondaryHue = secondAccentHsl ? secondAccentHsl[0] : (accentHue + 42) % 360;

        if (isDark) {
          const accentPrimary = hslToHex(accentHue, clamp(bestAccentHsl[1], 0.52, 0.78), 0.64);
          const accentSecondary = hslToHex(secondaryHue, 0.52, 0.64);
          const sidebarPillBg = hslToHex(secondaryHue, 0.45, 0.4);
          const authorColor = hslToHex(accentHue, 0.65, 0.76);

          resolve({
            presetId: 'custom',
            outerBg: hslToHex(baseHue, tintSat, 0.09),
            shellBg: hslToHex(baseHue, tintSat, 0.13),
            sidebarBg: hslToHex(baseHue, tintSat, 0.1),
            panelBg: hslToHex(baseHue, tintSat, 0.15),
            cardBg: hslToHex(baseHue, tintSat, 0.2),
            bannerBg: hslToHex(baseHue, tintSat, 0.17),
            textPrimary: '#f6f3ef',
            textMuted: hslToHex(baseHue, clamp(tintSat, 0.08, 0.18), 0.74),
            authorColor,
            accentPrimary,
            accentSecondary,
            sidebarPillBg,
            chatUserBubble: accentPrimary,
            chatBotBubble: hslToHex(baseHue, tintSat, 0.21),
            searchGradient: `linear-gradient(100deg, ${accentSecondary} 0%, ${accentPrimary} 100%)`,
            wallpaperOpacity: 0.76,
            wallpaperBlur: 12,
          });
        } else {
          const accentPrimary = hslToHex(accentHue, clamp(bestAccentHsl[1], 0.48, 0.72), 0.46);
          const accentSecondary = hslToHex(secondaryHue, 0.44, 0.48);
          const sidebarPillBg = hslToHex(baseHue, clamp(tintSat + 0.16, 0.2, 0.45), 0.34);
          const authorColor = hslToHex(accentHue, 0.52, 0.42);

          resolve({
            presetId: 'custom',
            outerBg: hslToHex(baseHue, tintSat, 0.84),
            shellBg: hslToHex(baseHue, tintSat, 0.96),
            sidebarBg: hslToHex(baseHue, tintSat, 0.92),
            panelBg: hslToHex(baseHue, tintSat, 0.9),
            cardBg: '#ffffff',
            bannerBg: hslToHex(baseHue, tintSat, 0.93),
            textPrimary: hslToHex(baseHue, clamp(tintSat, 0.12, 0.28), 0.2),
            textMuted: hslToHex(baseHue, clamp(tintSat, 0.1, 0.22), 0.45),
            authorColor,
            accentPrimary,
            accentSecondary,
            sidebarPillBg,
            chatUserBubble: accentPrimary,
            chatBotBubble: '#ffffff',
            searchGradient: `linear-gradient(100deg, ${accentSecondary} 0%, ${accentPrimary} 100%)`,
            wallpaperOpacity: 0.78,
            wallpaperBlur: 12,
          });
        }
      } catch {
        resolve({});
      }
    };
    img.onerror = () => resolve({});
    img.src = dataUrl;
  });
}
