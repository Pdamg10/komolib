import JSZip from 'jszip';
import type { BookItem, ChatMessage } from '../types/library';
import { dbPutBook, dbPutBookFile } from '../db/localDb';

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeRichCover(opts: {
  bg1: string;
  bg2: string;
  accent: string;
  title1: string;
  title2?: string;
  author: string;
  art: string;
}): string {
  return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stop-color="${opts.bg1}"/>
        <stop offset="100%" stop-color="${opts.bg2}"/>
      </linearGradient>
    </defs>
    <rect width="300" height="420" fill="url(#bg)"/>
    <rect x="18" y="18" width="264" height="384" rx="12" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.8"/>
    ${opts.art}
    <text x="150" y="76" text-anchor="middle" fill="#fffdf8" font-family="Lora,Georgia,serif" font-size="26" font-weight="700">${opts.title1}</text>
    ${opts.title2 ? `<text x="150" y="108" text-anchor="middle" fill="#fffdf8" font-family="Lora,Georgia,serif" font-size="24" font-weight="700">${opts.title2}</text>` : ''}
    <text x="150" y="370" text-anchor="middle" fill="${opts.accent}" font-family="Quicksand,sans-serif" font-size="14" font-weight="700" letter-spacing="1.2">${opts.author}</text>
  </svg>`);
}

async function createDemoComicCbz(kind: 'manga' | 'manhwa'): Promise<Blob> {
  const zip = new JSZip();
  const isManhwa = kind === 'manhwa';
  const scenes = isManhwa
    ? [
        { bg: '#1e1b38', fg: '#f6d8ae', caption: 'EPISODIO 01 — EL PORTAL DE NEÓN', sub: 'Desliza hacia abajo en modo Webtoon continuo', accent: '#9b82f3' },
        { bg: '#2c254e', fg: '#ffffff', caption: '«Las torres de Seúl brillaban bajo la lluvia púrpura...»', sub: 'Panel 2 · Tira vertical sin bordes', accent: '#f28482' },
        { bg: '#16243a', fg: '#fef3c7', caption: '¡ZAS! — Una grieta azul se abrió en el callejón', sub: 'Panel 3 · Ajusta el ancho o zoom arriba', accent: '#4fd1c5' },
        { bg: '#2d1e38', fg: '#fde68a', caption: '«Si cruzas esta puerta, ya no volverás a ser un lector común.»', sub: 'Panel 4 · Activa el filtro cálido de noche', accent: '#f6ad55' },
        { bg: '#192924', fg: '#e2f8ea', caption: 'FIN DEL CAPÍTULO DEMO — ¡Importa tus propios CBZ, CBR o carpetas!', sub: 'KomoLib soporta CBZ, CBR, PDF e imágenes', accent: '#68d391' },
      ]
    : [
        { bg: '#fcfaf5', fg: '#1e1c1a', caption: 'TOMO 01 — ESPADA DE BAMBÚ', sub: 'Modo Manga RTL (derecha a izquierda)', accent: '#3d7a4f' },
        { bg: '#f6f3ec', fg: '#1e1c1a', caption: 'El viento del valle de Kioto anunciaba un duelo.', sub: 'Página 2 · Usa flechas ← → o toca los bordes', accent: '#e06c64' },
        { bg: '#faf7f0', fg: '#1e1c1a', caption: '¡SHING! — La hoja cortó la neblina matinal.', sub: 'Página 3 · Prueba la vista de doble página', accent: '#4c6c8a' },
        { bg: '#f3efe6', fg: '#1e1c1a', caption: '«La verdadera fuerza reside en la calma del papel.»', sub: 'Página 4 · Guarda un marcador con el botón superior', accent: '#8d7ec7' },
        { bg: '#fcfaf5', fg: '#1e1c1a', caption: 'FIN DEL DEMO MANGA — ¡Arrastra tus tomos .CBZ / .CBR!', sub: 'KomoLib Reader', accent: '#3d7a4f' },
      ];

  scenes.forEach((s, i) => {
    const h = isManhwa ? 1050 : 960;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ${h}">
      <rect width="720" height="${h}" fill="${s.bg}"/>
      <rect x="34" y="34" width="652" height="${h - 68}" rx="18" fill="none" stroke="${s.accent}" stroke-width="5"/>
      <circle cx="360" cy="${Math.round(h * 0.36)}" r="155" fill="${s.accent}" opacity="0.22"/>
      <circle cx="360" cy="${Math.round(h * 0.36)}" r="92" fill="${s.accent}" opacity="0.38"/>
      <path d="M250 ${Math.round(h * 0.48)} L360 ${Math.round(h * 0.22)} L470 ${Math.round(h * 0.48)} Z" fill="${s.fg}" opacity="0.16"/>
      <rect x="64" y="${Math.round(h * 0.62)}" width="592" height="170" rx="22" fill="${isManhwa ? 'rgba(255,255,255,0.1)' : '#ffffff'}" stroke="${s.accent}" stroke-width="3"/>
      <text x="360" y="${Math.round(h * 0.62) + 66}" text-anchor="middle" fill="${s.fg}" font-family="Quicksand,sans-serif" font-size="24" font-weight="700">${s.caption}</text>
      <text x="360" y="${Math.round(h * 0.62) + 114}" text-anchor="middle" fill="${s.accent}" font-family="Nunito,sans-serif" font-size="18" font-weight="700">${s.sub}</text>
      <text x="360" y="${h - 58}" text-anchor="middle" fill="${s.fg}" opacity="0.5" font-family="Quicksand,sans-serif" font-size="18" font-weight="700">${i + 1} / ${scenes.length}</text>
    </svg>`;
    zip.file(`page_0${i + 1}.svg`, svg);
  });

  return zip.generateAsync({ type: 'blob' });
}

function createDemoNovelBlob(title: string, author: string, genre: string, intro: string): Blob {
  const md = `# ${title}

*Por ${author} — ${genre}*

## Capítulo 1: El Umbral de Papel

${intro}

Las lámparas de la biblioteca despedían un resplandor color crema mientras las hojas pasaban sin prisa. En cada estantería convivían novelas centenarias, volúmenes de manga encuadernados en lino verde y tiras ilustradas traídas desde Seúl.

> «Un buen lector nunca viaja solo: lleva consigo un estudio entero de colores, márgenes y recuerdos.»

Prueba a abrir el panel de ajustes del lector en la esquina superior derecha: puedes cambiar el tema entre **Crema**, **Papel**, **Sepia**, **Oscuro** y **OLED**, ajustar el tamaño de fuente, el interlineado, la tipografía y guardar marcadores en cualquier momento.

## Capítulo 2: Cartografía de Historias

Al caer la tarde, el viento golpeó suavemente las ventanas del torreón. Sobre la mesa descansaban archivos en formato **EPUB**, **PDF**, **MOBI**, **FB2**, **DOCX**, **CBZ** y **CBR**, listos para abrirse sin conexión a internet y sincronizarse después con el servidor local de KomoLib.

Cada libro recordaba automáticamente la última página leída, las notas rápidas tomadas al margen y el color de su cinta marcapáginas.

## Capítulo 3: Tu Biblioteca, Tus Reglas

Desde el panel derecho (**Estudio**) puedes personalizar absolutamente cada color de la interfaz, elegir entre seis temas predefinidos o crear los tuyos propios, activar o desactivar las páginas 3D y las cintas de los libros, e incluso añadir tus propias categorías ilustradas.

¡Arrastra tus propios archivos a la aplicación o pulsa el botón de importar para comenzar tu colección real!
`;
  return new Blob([md], { type: 'text/markdown;charset=utf-8' });
}

export async function seedInitialLibrary(): Promise<BookItem[]> {
  const now = Date.now();

  const booksData: Array<{ book: BookItem; blob: Blob }> = [
    {
      book: {
        id: 'demo_fairy_tale',
        title: 'Crónicas Estelares',
        author: 'S. Hawthorne',
        description: 'Un portal secreto en el fondo de un jardín olvidado conduce a un reino donde los cuentos cobran vida.',
        format: 'md',
        kind: 'book',
        categories: ['ebooks', 'fantasy', 'new'],
        tags: ['FANTASÍA', 'DEMO'],
        coverDataUrl: makeRichCover({
          bg1: '#1d3647',
          bg2: '#395d75',
          accent: '#f0c674',
          title1: 'CRÓNICAS',
          title2: 'ESTELARES',
          author: 'S. HAWTHORNE',
          art: `<circle cx="150" cy="235" r="64" fill="#132531" stroke="#7fb3c8" stroke-width="4"/>
                <circle cx="150" cy="235" r="36" fill="#2a5a72"/>
                <circle cx="150" cy="235" r="14" fill="#f7d07a"/>`,
        }),
        spineColor: '#213849',
        ribbonColor: '#f2ba59',
        fileName: 'cronicas-estelares.md',
        fileSize: 2048,
        mimeType: 'text/markdown',
        pageCount: 3,
        progress: 34,
        favorite: true,
        wishlist: false,
        isDemo: true,
        hasLocalFile: true,
        addedAt: now - 5000,
        lastReadAt: now - 1000,
        updatedAt: now - 1000,
      },
      blob: createDemoNovelBlob(
        'Crónicas Estelares',
        'S. Hawthorne',
        'Fantasía',
        'El farol del relojero se encendió exactamente a medianoche, revelando una escalera de piedra oculta tras la estantería principal.'
      ),
    },
    {
      book: {
        id: 'demo_manhwa_seoul',
        title: 'Sombras de Seúl',
        author: 'H. Kang Studio',
        description: 'Manhwa interactivo de prueba en modo tira vertical Webtoon sin bordes.',
        format: 'cbz',
        kind: 'manhwa',
        categories: ['manhwa', 'fantasy', 'new'],
        tags: ['MANHWA', 'WEBTOON', 'CBZ'],
        coverDataUrl: makeRichCover({
          bg1: '#7d6cb0',
          bg2: '#b29fd9',
          accent: '#ffe3a3',
          title1: 'SOMBRAS',
          title2: 'DE SEÚL',
          author: 'H. KANG STUDIO',
          art: `<path d="M50 320 L110 190 L165 270 L215 170 L260 320 Z" fill="rgba(26,18,52,0.45)"/>
                <circle cx="215" cy="145" r="24" fill="#ffe08a" opacity="0.88"/>`,
        }),
        spineColor: '#6b5b9e',
        ribbonColor: '#f4be5f',
        fileName: 'sombras-de-seul-cap1.cbz',
        fileSize: 9800,
        mimeType: 'application/vnd.comicbook+zip',
        pageCount: 5,
        progress: 20,
        favorite: true,
        wishlist: false,
        isDemo: true,
        hasLocalFile: true,
        addedAt: now - 4000,
        updatedAt: now - 4000,
      },
      blob: await createDemoComicCbz('manhwa'),
    },
    {
      book: {
        id: 'demo_klara_sun',
        title: 'Klara y el Sol',
        author: 'K. Ishiguro',
        description: 'Una mirada cálida y poética a la amistad, la memoria y la luz artificial.',
        format: 'md',
        kind: 'book',
        categories: ['ebooks', 'fiction', 'romance'],
        tags: ['FICCIÓN', 'SCI-FI'],
        coverDataUrl: makeRichCover({
          bg1: '#d95354',
          bg2: '#eb796f',
          accent: '#fff1cc',
          title1: 'KLARA Y',
          title2: 'EL SOL',
          author: 'K. ISHIGURO',
          art: `<circle cx="150" cy="230" r="46" fill="#ffd97d" opacity="0.92"/>
                <path d="M90 230 H210 M150 170 V290 M108 188 L192 272 M192 188 L108 272" stroke="#fff7e2" stroke-width="5" stroke-linecap="round"/>`,
        }),
        spineColor: '#bf4548',
        ribbonColor: '#f4c261',
        fileName: 'klara-y-el-sol.md',
        fileSize: 1920,
        mimeType: 'text/markdown',
        pageCount: 3,
        progress: 62,
        favorite: false,
        wishlist: true,
        isDemo: true,
        hasLocalFile: true,
        addedAt: now - 3000,
        updatedAt: now - 3000,
      },
      blob: createDemoNovelBlob(
        'Klara y el Sol',
        'K. Ishiguro',
        'Ficción',
        'Desde el escaparate orientado hacia el oeste, Klara observaba con devoción cómo el sol pintaba líneas doradas sobre la acera.'
      ),
    },
    {
      book: {
        id: 'demo_manga_bamboo',
        title: 'Espada de Bambú',
        author: 'A. Takahashi',
        description: 'Manga de demostración en lectura japonesa derecha-a-izquierda (RTL) con soporte de doble página.',
        format: 'cbz',
        kind: 'manga',
        categories: ['manga', 'fantasy', 'new'],
        tags: ['MANGA', 'RTL', 'CBZ'],
        coverDataUrl: makeRichCover({
          bg1: '#3f7f53',
          bg2: '#6eaa7b',
          accent: '#f9e29c',
          title1: 'ESPADA DE',
          title2: 'BAMBÚ',
          author: 'A. TAKAHASHI',
          art: `<rect x="136" y="155" width="12" height="170" rx="6" fill="rgba(255,255,255,0.28)"/>
                <rect x="158" y="175" width="10" height="150" rx="5" fill="rgba(255,255,255,0.2)"/>
                <circle cx="150" cy="225" r="56" fill="none" stroke="#f7df99" stroke-width="3" stroke-dasharray="8 6"/>`,
        }),
        spineColor: '#356b46',
        ribbonColor: '#f1ba5a',
        fileName: 'espada-de-bambu-vol1.cbz',
        fileSize: 9600,
        mimeType: 'application/vnd.comicbook+zip',
        pageCount: 5,
        progress: 0,
        favorite: false,
        wishlist: false,
        isDemo: true,
        hasLocalFile: true,
        addedAt: now - 2000,
        updatedAt: now - 2000,
      },
      blob: await createDemoComicCbz('manga'),
    },
    {
      book: {
        id: 'demo_hamnet',
        title: 'Mapa de Mareas',
        author: 'M. O’Farrell',
        description: 'Misterio literario e historia íntima ambientada junto a los puertos neblinosos del norte.',
        format: 'md',
        kind: 'book',
        categories: ['ebooks', 'crime', 'fiction'],
        tags: ['MISTERIO', 'CLÁSICO'],
        coverDataUrl: makeRichCover({
          bg1: '#33597a',
          bg2: '#557d9e',
          accent: '#f7d98c',
          title1: 'MAPA DE',
          title2: 'MAREAS',
          author: 'M. O’FARRELL',
          art: `<text x="150" y="275" text-anchor="middle" fill="rgba(255,255,255,0.22)" font-family="Lora,serif" font-size="145" font-weight="700">M</text>`,
        }),
        spineColor: '#294964',
        ribbonColor: '#f3bb5c',
        fileName: 'mapa-de-mareas.md',
        fileSize: 1850,
        mimeType: 'text/markdown',
        pageCount: 3,
        progress: 12,
        favorite: false,
        wishlist: true,
        isDemo: true,
        hasLocalFile: true,
        addedAt: now - 1000,
        updatedAt: now - 1000,
      },
      blob: createDemoNovelBlob(
        'Mapa de Mareas',
        'M. O’Farrell',
        'Misterio',
        'Nadie en el puerto recordaba quién había trazado aquellas coordenadas con tinta azul en la última página del cuaderno de bitácora.'
      ),
    },
  ];

  for (const item of booksData) {
    await dbPutBook(item.book);
    await dbPutBookFile(item.book.id, item.blob);
  }

  return booksData.map((x) => x.book);
}

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'msg_welcome_1',
    sender: 'assistant',
    text: '¡Bienvenido a KomoLib! 📚 Aquí puedes buscar en tu biblioteca, pedir recomendaciones o escribir notas rápidas. Prueba abriendo uno de tus títulos de muestra:',
    bookIds: ['demo_fairy_tale', 'demo_manhwa_seoul', 'demo_manga_bamboo'],
    createdAt: Date.now() - 2000,
  },
];
