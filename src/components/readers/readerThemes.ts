import type { ReaderSettings } from '../../types/library';

export const READER_PALETTES: Record<
  ReaderSettings['theme'],
  { bg: string; bar: string; fg: string; muted: string; border: string }
> = {
  cream: {
    bg: '#f8f3ea',
    bar: 'rgba(243, 237, 228, 0.92)',
    fg: '#332d29',
    muted: '#7e736a',
    border: 'rgba(59, 53, 50, 0.1)',
  },
  paper: {
    bg: '#ffffff',
    bar: 'rgba(250, 250, 250, 0.94)',
    fg: '#222222',
    muted: '#6e6e6e',
    border: 'rgba(0, 0, 0, 0.08)',
  },
  sepia: {
    bg: '#efe2c9',
    bar: 'rgba(232, 217, 190, 0.94)',
    fg: '#3e2f20',
    muted: '#7a634b',
    border: 'rgba(62, 47, 32, 0.12)',
  },
  dark: {
    bg: '#1c1f29',
    bar: 'rgba(23, 26, 36, 0.94)',
    fg: '#e8e4dc',
    muted: '#9ca3b5',
    border: 'rgba(255, 255, 255, 0.08)',
  },
  oled: {
    bg: '#000000',
    bar: 'rgba(12, 12, 12, 0.94)',
    fg: '#dedede',
    muted: '#888888',
    border: 'rgba(255, 255, 255, 0.1)',
  },
};
