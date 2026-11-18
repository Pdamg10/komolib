import type { BookItem, CategoryItem, ReadingStatus } from '../types/library';

export const STATUS_META: Record<
  ReadingStatus,
  { label: string; short: string; color: string; bg: string; text: string }
> = {
  completed: {
    label: 'Completado',
    short: 'Completado',
    color: '#7c9a6e',
    bg: 'rgba(138, 168, 124, 0.24)',
    text: '#58784b',
  },
  reading: {
    label: 'Leyendo',
    short: 'Leyendo',
    color: '#d5a84f',
    bg: 'rgba(213, 182, 109, 0.26)',
    text: '#9c7524',
  },
  want_to_read: {
    label: 'Por leer',
    short: 'Por leer',
    color: '#9c86ba',
    bg: 'rgba(184, 161, 201, 0.26)',
    text: '#745e96',
  },
  on_hold: {
    label: 'En pausa',
    short: 'En pausa',
    color: '#c9938b',
    bg: 'rgba(215, 180, 173, 0.3)',
    text: '#9c625a',
  },
  dropped: {
    label: 'Abandonado',
    short: 'Abandonado',
    color: '#b87671',
    bg: 'rgba(232, 180, 176, 0.3)',
    text: '#9b4f4a',
  },
};

export const STATUS_ORDER: ReadingStatus[] = [
  'completed',
  'reading',
  'want_to_read',
  'on_hold',
  'dropped',
];

export function getEffectiveStatus(book: BookItem): ReadingStatus {
  if (book.readingStatus) return book.readingStatus;
  if (book.progress >= 98) return 'completed';
  if (book.progress > 0) return 'reading';
  if (book.wishlist) return 'want_to_read';
  return 'want_to_read';
}

export function formatShortDate(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

export function getPrimaryGenreLabel(book: BookItem, categories: CategoryItem[]): string {
  for (const catId of book.categories || []) {
    if (catId === 'all' || catId === 'new') continue;
    const found = categories.find((c) => c.id === catId);
    if (found) return found.label;
  }
  if (book.kind === 'manga') return 'Manga';
  if (book.kind === 'manhwa') return 'Manhwa';
  if (book.kind === 'comic') return 'Cómic';
  if (book.kind === 'audiobook') return 'Audiolibro';
  return 'eBook';
}

export function computeLibraryStats(books: BookItem[], categories: CategoryItem[]) {
  const statusCounts: Record<ReadingStatus, number> = {
    completed: 0,
    reading: 0,
    want_to_read: 0,
    on_hold: 0,
    dropped: 0,
  };

  let totalPagesRead = 0;
  let ratingSum = 0;
  let ratedCount = 0;
  const genreCounts = new Map<string, { label: string; count: number; color: string }>();
  const seriesMap = new Map<
    string,
    { name: string; total: number; completed: number; reading: number; books: BookItem[] }
  >();

  for (const book of books) {
    const st = getEffectiveStatus(book);
    statusCounts[st]++;

    const estPages = book.pageCount || (book.format === 'audio' ? 0 : 240);
    if (st === 'completed') {
      totalPagesRead += estPages;
    } else if (book.progress > 0) {
      totalPagesRead += Math.round((estPages * book.progress) / 100);
    }

    if (book.rating && book.rating > 0) {
      ratingSum += book.rating;
      ratedCount++;
    }

    const genreLabel = getPrimaryGenreLabel(book, categories);
    const matchedCat = categories.find((c) => c.label === genreLabel);
    const existing = genreCounts.get(genreLabel) || {
      label: genreLabel,
      count: 0,
      color: matchedCat?.color || '#a87655',
    };
    existing.count += 1;
    genreCounts.set(genreLabel, existing);

    if (book.seriesName?.trim()) {
      const key = book.seriesName.trim();
      const s = seriesMap.get(key) || {
        name: key,
        total: 0,
        completed: 0,
        reading: 0,
        books: [],
      };
      s.total += 1;
      if (st === 'completed') s.completed += 1;
      if (st === 'reading') s.reading += 1;
      s.books.push(book);
      seriesMap.set(key, s);
    }
  }

  const avgRating = ratedCount > 0 ? +(ratingSum / ratedCount).toFixed(1) : 0;
  const topGenres = Array.from(genreCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const topRated = [...books]
    .filter((b) => (b.rating || 0) > 0)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 6);

  const seriesList = Array.from(seriesMap.values()).sort((a, b) => b.total - a.total);

  return {
    totalBooks: books.length,
    statusCounts,
    totalPagesRead,
    avgRating,
    ratedCount,
    topGenres,
    topRated,
    seriesList,
  };
}
