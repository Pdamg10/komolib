import type { AnnotationTool, BookmarkDesign } from '../types/library';

export const BUILTIN_BOOKMARK_DESIGNS: BookmarkDesign[] = [
  {
    id: 'bm-dragon-galaxy',
    name: 'Dragón Galaxia',
    imageUrl: './bookmarks/dragon-galaxy.webp',
    accentColor: '#9b59b6',
    builtin: true,
  },
  {
    id: 'bm-dragon-amber',
    name: 'Dragón Luna Ámbar',
    imageUrl: './bookmarks/dragon-amber.webp',
    accentColor: '#e07a3f',
    builtin: true,
  },
  {
    id: 'bm-stained-sun',
    name: 'Vitral Sol y Flores',
    imageUrl: './bookmarks/stained-sun.webp',
    accentColor: '#e6a93c',
    builtin: true,
  },
  {
    id: 'bm-stained-moon',
    name: 'Vitral Luna Nocturna',
    imageUrl: './bookmarks/stained-moon.webp',
    accentColor: '#4c79c4',
    builtin: true,
  },
  {
    id: 'bm-moth-botanical',
    name: 'Polilla Lunar',
    imageUrl: './bookmarks/moth-botanical.webp',
    accentColor: '#c94a38',
    builtin: true,
  },
  {
    id: 'bm-skull-botanical',
    name: 'Cráneo Botánico',
    imageUrl: './bookmarks/skull-botanical.webp',
    accentColor: '#b9413a',
    builtin: true,
  },
  {
    id: 'bm-dagger-roses',
    name: 'Daga y Rosas',
    imageUrl: './bookmarks/dagger-roses.webp',
    accentColor: '#b8323e',
    builtin: true,
  },
  {
    id: 'bm-masquerade-gold',
    name: 'Máscara Dorada',
    imageUrl: './bookmarks/masquerade-gold.webp',
    accentColor: '#c89e47',
    builtin: true,
  },
];

export interface SwatchPreset {
  color: string;
  name: string;
  meaning: string;
}

export interface StyleVariantOption {
  id: string;
  label: string;
}

export const TOOL_META: Record<
  AnnotationTool,
  {
    label: string;
    short: string;
    defaultColor: string;
    defaultVariant: string;
    colors: string[];
    swatches: SwatchPreset[];
    variants: StyleVariantOption[];
  }
> = {
  highlighter: {
    label: 'Resaltador',
    short: 'Resaltador',
    defaultColor: '#fff176',
    defaultVariant: 'pastel',
    colors: [
      '#fff176',
      '#ffb3c6',
      '#a8e6cf',
      '#cdb4db',
      '#a2d2ff',
      '#ffcab0',
      '#e9d8a6',
      '#ced4da',
      '#ffee32',
      '#b5f44a',
      '#ff9f1c',
      '#ff70a6',
    ],
    swatches: [
      { color: '#fff176', name: 'Mildliner Amarillo', meaning: 'Cita favorita / Clave' },
      { color: '#ffb3c6', name: 'Rosa Sakura', meaning: 'Romance / Emoción' },
      { color: '#a8e6cf', name: 'Verde Menta', meaning: 'Reflexión / Calma' },
      { color: '#cdb4db', name: 'Lavanda Pastel', meaning: 'Magia / Teoría' },
      { color: '#a2d2ff', name: 'Azul Cielo', meaning: 'Mundo / Datos' },
      { color: '#ffcab0', name: 'Durazno', meaning: 'Personajes' },
      { color: '#e9d8a6', name: 'Arena Vintage', meaning: 'Estética / Clásico' },
      { color: '#ced4da', name: 'Gris Suave', meaning: 'Sutil / Mínimo' },
      { color: '#ffee32', name: 'Neón Amarillo', meaning: 'Resaltador clásico' },
      { color: '#b5f44a', name: 'Neón Lima', meaning: 'Estudio / Definición' },
      { color: '#ff9f1c', name: 'Neón Naranja', meaning: 'Alerta / Giro' },
      { color: '#ff70a6', name: 'Neón Fucsia', meaning: 'Impacto / Clímax' },
    ],
    variants: [
      { id: 'pastel', label: 'Pastel (Mildliner)' },
      { id: 'neon', label: 'Fluorescente' },
      { id: 'thick-underline', label: 'Subrayado grueso' },
    ],
  },
  pencil: {
    label: 'Lápiz',
    short: 'Lápiz',
    defaultColor: '#5c5c66',
    defaultVariant: 'wavy',
    colors: ['#5c5c66', '#2b2d33', '#7f5539', '#c1121f', '#2b59c3', '#386641', '#6d4c7d'],
    swatches: [
      { color: '#5c5c66', name: 'Grafito HB', meaning: 'Subrayado clásico de margen' },
      { color: '#2b2d33', name: 'Grafito 2B', meaning: 'Trazo intenso' },
      { color: '#7f5539', name: 'Lápiz Sepia', meaning: 'Tono cálido vintage' },
      { color: '#c1121f', name: 'Lápiz Rojo', meaning: 'Corrección / Muy importante' },
      { color: '#2b59c3', name: 'Lápiz Azul', meaning: 'Estudio / Referencia' },
      { color: '#386641', name: 'Lápiz Bosque', meaning: 'Descripción / Paisaje' },
      { color: '#6d4c7d', name: 'Lápiz Ciruela', meaning: 'Frase poética' },
    ],
    variants: [
      { id: 'wavy', label: 'Ondulado lápiz' },
      { id: 'dashed', label: 'Punteado suave' },
      { id: 'shade', label: 'Sombreado grafito' },
    ],
  },
  pen: {
    label: 'Bolígrafo',
    short: 'Bolígrafo',
    defaultColor: '#1d4ed8',
    defaultVariant: 'fine',
    colors: ['#1a1a1f', '#1d4ed8', '#c92a2a', '#7b1e3a', '#1b7a43', '#6f42c1', '#6f4e37', '#b8860b'],
    swatches: [
      { color: '#1a1a1f', name: 'Gel Negro 0.5', meaning: 'Muji / Fineliner nítido' },
      { color: '#1d4ed8', name: 'Bolígrafo Azul', meaning: 'Clásico de lectura' },
      { color: '#c92a2a', name: 'Tinta Roja', meaning: 'Frase impactante' },
      { color: '#7b1e3a', name: 'Tinta Vino', meaning: 'Drama / Oscuro' },
      { color: '#1b7a43', name: 'Tinta Esmeralda', meaning: 'Aprendizaje' },
      { color: '#6f42c1', name: 'Tinta Violeta', meaning: 'Misterio / Pista' },
      { color: '#6f4e37', name: 'Pluma Sepia', meaning: 'Estilo pluma fuente' },
      { color: '#b8860b', name: 'Tinta Dorada', meaning: 'Cita de oro' },
    ],
    variants: [
      { id: 'fine', label: 'Trazo fino 0.5' },
      { id: 'double', label: 'Doble subrayado' },
      { id: 'box', label: 'Recuadro tinta' },
    ],
  },
  postit: {
    label: 'Post-it y Banderitas',
    short: 'Post-it',
    defaultColor: '#fff3a1',
    defaultVariant: 'classic',
    colors: ['#fff3a1', '#ffd6e0', '#d8f3dc', '#e4d9ff', '#d0ebff', '#ffe5c4', '#e6ccb2', '#f1f3f5'],
    swatches: [
      { color: '#fff3a1', name: 'Post-it Amarillo', meaning: 'Nota general / Cita' },
      { color: '#ffd6e0', name: 'Post-it Rosa', meaning: 'Romance / Favorito' },
      { color: '#d8f3dc', name: 'Post-it Menta', meaning: 'Reflexión / Frase bonita' },
      { color: '#e4d9ff', name: 'Post-it Lavanda', meaning: 'Teorías / Magia' },
      { color: '#d0ebff', name: 'Post-it Azul', meaning: 'Pistas / Worldbuilding' },
      { color: '#ffe5c4', name: 'Post-it Durazno', meaning: 'Personajes / Diálogos' },
      { color: '#e6ccb2', name: 'Papel Kraft', meaning: 'Nota vintage' },
      { color: '#f1f3f5', name: 'Translúcido', meaning: 'Post-it transparente' },
    ],
    variants: [
      { id: 'classic', label: 'Post-it cuadrado' },
      { id: 'tab', label: 'Banderita / Tab' },
      { id: 'kraft', label: 'Papel Kraft' },
      { id: 'translucent', label: 'Translúcido' },
    ],
  },
  sticker: {
    label: 'Stickers',
    short: 'Sticker',
    defaultColor: '#e86f68',
    defaultVariant: 'badge',
    colors: ['#e86f68', '#8d7ec7', '#4ea8de', '#52b788', '#f4a261'],
    swatches: [],
    variants: [
      { id: 'badge', label: 'Etiqueta sticker' },
      { id: 'pill', label: 'Sello flotante' },
    ],
  },
  emoji: {
    label: 'Emojis',
    short: 'Emoji',
    defaultColor: '#f5b855',
    defaultVariant: 'inline',
    colors: ['#f5b855', '#e86f68', '#8d7ec7', '#52b788'],
    swatches: [],
    variants: [{ id: 'inline', label: 'Reacción en texto' }],
  },
};

export interface ReadingStickerItem {
  id: string;
  emoji: string;
  label: string;
  color: string;
  group: 'emociones' | 'trama' | 'estetica';
}

export const READING_STICKERS: ReadingStickerItem[] = [
  // Emociones y Reacciones (BookTok / Bookstagram favoritos)
  { id: 'fav', emoji: '⭐', label: 'Cita Top', color: '#e6a700', group: 'emociones' },
  { id: 'heart', emoji: '❤️‍🔥', label: 'Me encantó', color: '#e04f6b', group: 'emociones' },
  { id: 'cry', emoji: '😭', label: 'Lloré', color: '#4c8ed9', group: 'emociones' },
  { id: 'twist', emoji: '🤯', label: 'Plot Twist', color: '#8465c9', group: 'emociones' },
  { id: 'laugh', emoji: '😂', label: 'Me reí', color: '#f09d35', group: 'emociones' },
  { id: 'aww', emoji: '🥹', label: 'Qué tierno', color: '#e6789c', group: 'emociones' },
  { id: 'shock', emoji: '😱', label: 'En shock', color: '#6b5ce7', group: 'emociones' },
  { id: 'broken', emoji: '💔', label: 'Me rompió', color: '#b53d52', group: 'emociones' },
  { id: 'angry', emoji: '😡', label: 'Qué rabia', color: '#c92a2a', group: 'emociones' },
  { id: 'comfort', emoji: '🫶', label: 'Comfort', color: '#d97b8a', group: 'emociones' },
  // Análisis y Trama
  { id: 'clue', emoji: '🔎', label: 'Pista clave', color: '#3b9a7a', group: 'trama' },
  { id: 'theory', emoji: '🧠', label: 'Teoría', color: '#5b6ec4', group: 'trama' },
  { id: 'pin', emoji: '📌', label: 'Importante', color: '#d9534f', group: 'trama' },
  { id: 'climax', emoji: '⚡', label: 'Clímax', color: '#e08e26', group: 'trama' },
  { id: 'reread', emoji: '🔁', label: 'Releer', color: '#4c6c8a', group: 'trama' },
  { id: 'quote', emoji: '💬', label: 'Diálogo Top', color: '#4ea8de', group: 'trama' },
  { id: 'redflag', emoji: '🚩', label: 'Red Flag', color: '#cc3333', group: 'trama' },
  { id: 'greenflag', emoji: '✅', label: 'Green Flag', color: '#3a9b5c', group: 'trama' },
  { id: 'doubt', emoji: '❓', label: 'Duda', color: '#6c757d', group: 'trama' },
  // Géneros y Estética
  { id: 'epic', emoji: '⚔️', label: 'Épico', color: '#c76938', group: 'estetica' },
  { id: 'magic', emoji: '✨', label: 'Mágico', color: '#9c5fd1', group: 'estetica' },
  { id: 'romance', emoji: '🌹', label: 'Romántico', color: '#c93855', group: 'estetica' },
  { id: 'night', emoji: '🌙', label: 'Nocturno', color: '#4a5fa5', group: 'estetica' },
  { id: 'dark', emoji: '🕯️', label: 'Gótico', color: '#594a4e', group: 'estetica' },
  { id: 'iconic', emoji: '👑', label: 'Icónico', color: '#c29223', group: 'estetica' },
  { id: 'dragon', emoji: '🐉', label: 'Fantasía', color: '#2b7a5b', group: 'estetica' },
  { id: 'symbol', emoji: '🦋', label: 'Simbólico', color: '#5680c4', group: 'estetica' },
];

export const STICKER_GROUPS: Array<{ id: ReadingStickerItem['group']; label: string }> = [
  { id: 'emociones', label: 'Reacciones' },
  { id: 'trama', label: 'Trama y Estudio' },
  { id: 'estetica', label: 'Fantasía y Estética' },
];

export const READING_EMOJI_GROUPS: Array<{ id: string; label: string; emojis: string[] }> = [
  {
    id: 'reacciones',
    label: 'Emociones',
    emojis: ['⭐', '✨', '❤️', '❤️‍🔥', '💔', '😭', '🥹', '😍', '🤯', '😱', '😂', '😡', '🥺', '🫶', '👏', '🔥'],
  },
  {
    id: 'estudio',
    label: 'Lectura y Pistas',
    emojis: ['📖', '🔖', '📌', '📝', '💡', '🔎', '🧠', '❓', '❗', '✅', '⚠️', '🚩', '🔁', '💬', '🎯', '🏆'],
  },
  {
    id: 'estetica',
    label: 'Mundos y Estética',
    emojis: ['🌙', '☀️', '🌟', '🦋', '🌹', '🌸', '🗡️', '⚔️', '👑', '🐉', '🕯️', '💀', '🖤', '💌', '☕', '🍃'],
  },
];

export const READING_EMOJIS = READING_EMOJI_GROUPS.flatMap((g) => g.emojis);

/**
 * Compresses a user-uploaded bookmark image into a lightweight WebP/JPEG data URL
 * (max 240x680px, ~15-35 KB) so local storage stays ultra light.
 */
export async function compressBookmarkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagen no compatible'));
      img.onload = () => {
        const maxW = 240;
        const maxH = 680;
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const webp = canvas.toDataURL('image/webp', 0.8);
        if (webp.startsWith('data:image/webp')) {
          resolve(webp);
        } else {
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
