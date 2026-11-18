import type { ReaderSettings } from '../../types/library';

export const READER_PALETTES: Record<
  ReaderSettings['theme'],
  {
    bg: string;
    bar: string;
    surface: string;
    inputBg: string;
    fg: string;
    muted: string;
    border: string;
    isDark: boolean;
  }
> = {
  cream: {
    bg: '#f8f3ea',
    bar: 'rgba(243, 237, 228, 0.94)',
    surface: '#ede5d8',
    inputBg: '#fffdf9',
    fg: '#332d29',
    muted: '#7e736a',
    border: 'rgba(59, 53, 50, 0.12)',
    isDark: false,
  },
  paper: {
    bg: '#ffffff',
    bar: 'rgba(250, 250, 250, 0.95)',
    surface: '#f1f1f1',
    inputBg: '#ffffff',
    fg: '#222222',
    muted: '#6e6e6e',
    border: 'rgba(0, 0, 0, 0.1)',
    isDark: false,
  },
  sepia: {
    bg: '#efe2c9',
    bar: 'rgba(232, 217, 190, 0.95)',
    surface: '#e4d3b4',
    inputBg: '#f7eedc',
    fg: '#3e2f20',
    muted: '#7a634b',
    border: 'rgba(62, 47, 32, 0.14)',
    isDark: false,
  },
  dark: {
    bg: '#1c1f29',
    bar: 'rgba(23, 26, 36, 0.95)',
    surface: '#272b3a',
    inputBg: '#161922',
    fg: '#e8e4dc',
    muted: '#9ca3b5',
    border: 'rgba(255, 255, 255, 0.1)',
    isDark: true,
  },
  oled: {
    bg: '#000000',
    bar: 'rgba(12, 12, 12, 0.95)',
    surface: '#191919',
    inputBg: '#0b0b0b',
    fg: '#dedede',
    muted: '#8d8d8d',
    border: 'rgba(255, 255, 255, 0.12)',
    isDark: true,
  },
};
