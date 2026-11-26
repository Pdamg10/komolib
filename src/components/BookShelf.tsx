import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Folder,
  Grid,
  Headphones,
  List,
  Plus,
  RefreshCw,
  Rows3,
  Sparkles,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ACCEPTED_AUDIO_EXTENSIONS } from '../parsers';
import type { BookItem, ThemeConfig } from '../types/library';
import { bookNeedsMetadataEnrichment } from '../utils/bookMetadata';
import {
  formatOriginBadge,
  groupLibraryForDisplay,
  type MangaSeriesGroup,
  type OriginTag,
  type ShelfDisplayItem,
} from '../utils/mangaSeriesUtils';
import { getEffectiveStatus } from '../utils/readingStats';
import { BookCard, BookListRow, type SeriesCardMeta } from './BookCard';

type SortKey = NonNullable<ThemeConfig['sortBy']>;
type ReadingFilterKey = NonNullable<ThemeConfig['readingFilter']>;
type LayoutMode = ThemeConfig['viewMode'];

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Lista reciente',
  title: 'Título del libro',
  author: 'Autor',
  imported: 'Hora de importación',
  folder: 'Carpetas',
};

function getBookFolderLabel(book: BookItem): string {
  if (book.folderPath?.trim()) return book.folderPath.trim();
  if (book.seriesName?.trim()) return book.seriesName.trim();
  const nonSystemTag = (book.tags || []).find(
    (t) => !/^(MOON\+|READERA|KINDLE|CALIBRE|GOODREADS|KOMOLIB|COPIA)$/i.test(t.trim())
  );
  if (nonSystemTag?.trim()) return nonSystemTag.trim();
  return 'Sin carpeta';
}

function getReadingBucket(book: BookItem): Exclude<ReadingFilterKey, 'all'> {
  const st = getEffectiveStatus(book);
  if (st === 'completed' || (book.progress || 0) >= 98) return 'completed';
  if (st === 'reading' || st === 'on_hold' || (book.progress || 0) > 0) return 'reading';
  return 'unread';
}

function getDisplayItemBucket(item: ShelfDisplayItem): Exclude<ReadingFilterKey, 'all'> {
  if (item.type === 'book') return getReadingBucket(item.book);
  if (item.series.overallProgress >= 98) return 'completed';
  if (item.series.overallProgress > 0) return 'reading';
  return 'unread';
}

function buildSeriesCardMeta(series: MangaSeriesGroup): SeriesCardMeta {
  const kindBadge =
    series.originTag === 'manhua'
      ? 'MANHUA'
      : series.originTag === 'manhwa'
      ? 'MANHWA'
      : series.originTag === 'comic'
      ? 'CÓMIC'
      : 'MANGA';

  const capShort = series.totalChaptersExpected
    ? `${series.availableChaptersCount}/${series.totalChaptersExpected} caps`
    : series.rangeLabel;

  return {
    seriesKey: series.seriesKey,
    title: series.seriesName,
    subtitle: `${formatOriginBadge(series.originTag)} · ${series.chapters.length} ${series.chapters.length === 1 ? 'archivo' : 'paquetes'}`,
    chapterBadge: capShort,
    kindBadge,
    progress: series.overallProgress,
    favorite: series.favorite,
    wishlist: series.wishlist,
    packCount: series.chapters.length,
    lastActivityAt: series.lastActivityAt,
  };
}

function isLowEndBatchSize(): number {
  if (typeof navigator === 'undefined') return 28;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowMem = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 900;
  return lowMem || lowCpu || narrow ? 20 : 30;
}

const BookShelfInner: React.FC = () => {
  const {
    books,
    navSection,
    activeCategory,
    setActiveCategory,
    categories,
    searchQuery,
    theme,
    updateTheme,
    openBook,
    updateBook,
    updateSeriesBooks,
    setEditingBook,
    setActiveSeriesKey,
    importFiles,
    identifyBookWithAI,
    setImportModalOpen,
    setProfileModalOpen,
    linkedFolder,
    folderAutoScanBusy,
    scanLinkedLibraryFolder,
    showToast,
  } = useLibrary();

  const shelfRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const aiCancelRef = useRef(false);

  const renderBatch = useMemo(() => isLowEndBatchSize(), []);
  const deferredSearch = useDeferredValue(searchQuery);

  const viewMode: LayoutMode = theme.viewMode || 'grid';
  const sortBy: SortKey = theme.sortBy || 'recent';
  const sortDir: 'asc' | 'desc' =
    theme.sortDir || (sortBy === 'title' || sortBy === 'author' || sortBy === 'folder' ? 'asc' : 'desc');
  const readingFilter: ReadingFilterKey = theme.readingFilter || 'all';

  const [visibleCount, setVisibleCount] = useState(renderBatch);
  const [mangaOriginFilter, setMangaOriginFilter] = useState<OriginTag | 'all'>('all');
  const [aiBatchState, setAiBatchState] = useState<{ done: number; total: number; updated: number } | null>(null);

  // Stable callbacks so React.memo on BookCard/BookListRow prevents mass re-renders on low-end devices
  const handleToggleFavorite = useCallback(
    (b: BookItem) => {
      void updateBook(b.id, { favorite: !b.favorite });
    },
    [updateBook]
  );

  const handleToggleWishlist = useCallback(
    (b: BookItem) => {
      void updateBook(b.id, { wishlist: !b.wishlist });
    },
    [updateBook]
  );

  // Pre-build lowercase search index once per books mutation (avoids O(N) string concatenation per keystroke)
  const searchIndexMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of books) {
      map.set(
        b.id,
        `${b.title} ${b.seriesName || ''} ${b.author} ${b.format} ${b.kind} ${b.folderPath || ''} ${(b.genres || []).join(' ')} ${(b.fansubs || []).join(' ')} ${b.tags.join(' ')} ${b.categories.join(' ')}`.toLowerCase()
      );
    }
    return map;
  }, [books]);

  // Base list filtered by nav section, category, and search query
  const baseFiltered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const catObj = categories.find((c) => c.id === activeCategory);

    return books.filter((b) => {
      if (navSection === 'favorites' && !b.favorite) return false;
      if (navSection === 'wishlist' && !b.wishlist) return false;
      if (navSection === 'audiobooks' && b.format !== 'audio' && b.kind !== 'audiobook') return false;

      if (activeCategory !== 'all' && navSection !== 'audiobooks' && navSection !== 'manga') {
        const matchesKind = catObj?.filterKind && b.kind === catObj.filterKind;
        const matchesCat = b.categories.includes(activeCategory);
        if (!matchesKind && !matchesCat) return false;
      }

      if (q) {
        const hay = searchIndexMap.get(b.id) || '';
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeCategory, books, categories, deferredSearch, navSection, searchIndexMap]);

  // Group Manga/Manhwa/Comic chapter packs into unified series (Books & Audiobooks remain 100% untouched)
  const groupedBaseItems = useMemo(() => {
    let grouped = groupLibraryForDisplay(baseFiltered);
    if (navSection === 'manga') {
      grouped = grouped.filter((it) => {
        if (it.type !== 'series') return false;
        if (mangaOriginFilter !== 'all' && it.series.originTag !== mangaOriginFilter) return false;
        return true;
      });
    }
    if (navSection === 'reading') {
      return grouped.filter((it) => getDisplayItemBucket(it) === 'completed');
    }
    return grouped;
  }, [baseFiltered, navSection, mangaOriginFilter]);

  // Reading filter counts
  const filterCounts = useMemo(() => {
    let unread = 0;
    let reading = 0;
    let completed = 0;
    for (const item of groupedBaseItems) {
      const bucket = getDisplayItemBucket(item);
      if (bucket === 'completed') completed++;
      else if (bucket === 'reading') reading++;
      else unread++;
    }
    return { all: groupedBaseItems.length, unread, reading, completed };
  }, [groupedBaseItems]);

  const effectiveReadingFilter: ReadingFilterKey = navSection === 'reading' ? 'all' : readingFilter;

  // Apply reading status filter + sorting across unified display items
  const sortedItems = useMemo(() => {
    const list =
      effectiveReadingFilter === 'all'
        ? [...groupedBaseItems]
        : groupedBaseItems.filter((it) => getDisplayItemBucket(it) === effectiveReadingFilter);

    const dir = sortDir === 'asc' ? 1 : -1;
    const isUnknown = (a: string) => {
      const low = (a || '').trim().toLowerCase();
      return !low || low === 'autor desconocido' || low === 'unknown' || low === 'biblioteca personal';
    };
    const itemTitle = (it: ShelfDisplayItem) =>
      it.type === 'series' ? it.series.seriesName : it.book.title;
    const itemBook = (it: ShelfDisplayItem) =>
      it.type === 'series' ? it.series.primaryBook : it.book;

    list.sort((ia, ib) => {
      const a = itemBook(ia);
      const b = itemBook(ib);
      const taTitle = itemTitle(ia);
      const tbTitle = itemTitle(ib);
      if (sortBy === 'title') {
        return taTitle.localeCompare(tbTitle, 'es', { numeric: true, sensitivity: 'base' }) * dir;
      }
      if (sortBy === 'author') {
        const aUnk = isUnknown(a.author);
        const bUnk = isUnknown(b.author);
        if (aUnk !== bUnk) return aUnk ? 1 : -1;
        const cmp = (a.author || '').localeCompare(b.author || '', 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
        return taTitle.localeCompare(tbTitle, 'es', { numeric: true, sensitivity: 'base' });
      }
      if (sortBy === 'imported') {
        const aa = ia.type === 'series' ? Math.max(...ia.series.allBooks.map((x) => x.addedAt || 0)) : a.addedAt || 0;
        const bb = ib.type === 'series' ? Math.max(...ib.series.allBooks.map((x) => x.addedAt || 0)) : b.addedAt || 0;
        return (aa - bb) * dir;
      }
      if (sortBy === 'folder') {
        const fa = getBookFolderLabel(a);
        const fb = getBookFolderLabel(b);
        const aNone = fa === 'Sin carpeta';
        const bNone = fb === 'Sin carpeta';
        if (aNone !== bNone) return aNone ? 1 : -1;
        const cmp = fa.localeCompare(fb, 'es', { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
        return taTitle.localeCompare(tbTitle, 'es', { numeric: true, sensitivity: 'base' });
      }
      const ta =
        ia.type === 'series'
          ? ia.series.lastActivityAt
          : Math.max(a.lastReadAt || 0, a.finishedAt || 0, a.lastChapterFinishedAt || 0, a.addedAt || 0);
      const tb =
        ib.type === 'series'
          ? ib.series.lastActivityAt
          : Math.max(b.lastReadAt || 0, b.finishedAt || 0, b.lastChapterFinishedAt || 0, b.addedAt || 0);
      return (ta - tb) * dir;
    });

    return list;
  }, [groupedBaseItems, effectiveReadingFilter, sortBy, sortDir]);

  // Count items in current view that are missing metadata and haven't been checked by AI yet
  const incompleteTargets = useMemo(
    () =>
      sortedItems
        .map((it) => {
          if (it.type === 'series') {
            const s = it.series;
            const anyEnriched = s.allBooks.some((b) => Boolean(b.aiEnrichedAt));
            const needs =
              !anyEnriched &&
              bookNeedsMetadataEnrichment({
                title: s.seriesName,
                author: s.primaryBook.author,
                description: s.synopsis,
                kind: s.kind,
                genres: s.genres,
                seriesStatus: s.seriesStatus,
                aiEnrichedAt: anyEnriched ? 1 : undefined,
              });
            return needs
              ? {
                  id: s.primaryBook.id,
                  seriesBookIds: s.allBooks.map((b) => b.id),
                  isVisualSeries: true,
                  seriesName: s.seriesName,
                }
              : null;
          }
          return bookNeedsMetadataEnrichment(it.book)
            ? {
                id: it.book.id,
                seriesBookIds: undefined,
                isVisualSeries: false,
                seriesName: undefined,
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    [sortedItems]
  );

  // Targets eligible for AI type classification (Manga/Manhwa/Manhua/Cómic vs Libro) & series name unification
  // Only inspects PDF/CBZ/CBR/Images so standard EPUB/MOBI/TXT books remain 100% untouched.
  const visualClassifyTargets = useMemo(
    () =>
      sortedItems
        .map((it) => {
          if (it.type === 'series') {
            return {
              id: it.series.primaryBook.id,
              seriesBookIds: it.series.allBooks.map((b) => b.id),
              isVisualSeries: true,
              seriesName: it.series.seriesName,
            };
          }
          const fmt = it.book.format;
          if (fmt === 'pdf' || fmt === 'cbz' || fmt === 'cbr' || fmt === 'images') {
            return {
              id: it.book.id,
              seriesBookIds: undefined,
              isVisualSeries: false,
              seriesName: undefined,
            };
          }
          return null;
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    [sortedItems]
  );

  // Reset progressive render window whenever filters/sorting/view change
  useEffect(() => {
    setVisibleCount(renderBatch);
  }, [activeCategory, navSection, deferredSearch, effectiveReadingFilter, sortBy, sortDir, viewMode, renderBatch]);

  const visibleItems = useMemo(
    () => sortedItems.slice(0, visibleCount),
    [sortedItems, visibleCount]
  );

  const hasMore = visibleCount < sortedItems.length;

  // Progressive infinite loading via IntersectionObserver (keeps low-end Android phones 60 FPS)
  useEffect(() => {
    if (!hasMore || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(sortedItems.length, c + renderBatch));
        }
      },
      { rootMargin: '320px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, sortedItems.length, visibleCount, renderBatch]);

  // Folder grouping when sorted by 'folder' in grid/list mode
  const folderGroups = useMemo(() => {
    if (sortBy !== 'folder' || viewMode === 'shelf') return null;
    const map = new Map<string, ShelfDisplayItem[]>();
    for (const item of visibleItems) {
      const targetBook = item.type === 'series' ? item.series.primaryBook : item.book;
      const folder = getBookFolderLabel(targetBook);
      const arr = map.get(folder) || [];
      arr.push(item);
      map.set(folder, arr);
    }
    return Array.from(map.entries());
  }, [sortBy, viewMode, visibleItems]);

  const renderDisplayCard = (item: ShelfDisplayItem) => {
    if (item.type === 'book') {
      return (
        <BookCard
          key={item.book.id}
          book={item.book}
          onOpen={openBook}
          onToggleFavorite={handleToggleFavorite}
          onToggleWishlist={handleToggleWishlist}
          onEdit={setEditingBook}
          showBookPages3D={theme.showBookPages3D}
          showBookRibbons={theme.showBookRibbons}
        />
      );
    }
    const { series } = item;
    const meta = buildSeriesCardMeta(series);
    return (
      <BookCard
        key={`series_${series.seriesKey}`}
        book={series.primaryBook}
        seriesMeta={meta}
        onOpen={() => setActiveSeriesKey(series.seriesKey)}
        onToggleFavorite={() =>
          void updateSeriesBooks(
            series.allBooks.map((b) => b.id),
            { favorite: !series.favorite }
          )
        }
        onToggleWishlist={() =>
          void updateSeriesBooks(
            series.allBooks.map((b) => b.id),
            { wishlist: !series.wishlist }
          )
        }
        onEdit={() => setActiveSeriesKey(series.seriesKey)}
        showBookPages3D={theme.showBookPages3D}
        showBookRibbons={theme.showBookRibbons}
      />
    );
  };

  const renderDisplayRow = (item: ShelfDisplayItem) => {
    if (item.type === 'book') {
      return (
        <BookListRow
          key={item.book.id}
          book={item.book}
          onOpen={openBook}
          onToggleFavorite={handleToggleFavorite}
          onEdit={setEditingBook}
        />
      );
    }
    const { series } = item;
    const meta = buildSeriesCardMeta(series);
    return (
      <BookListRow
        key={`series_${series.seriesKey}`}
        book={series.primaryBook}
        seriesMeta={meta}
        onOpen={() => setActiveSeriesKey(series.seriesKey)}
        onToggleFavorite={() =>
          void updateSeriesBooks(
            series.allBooks.map((b) => b.id),
            { favorite: !series.favorite }
          )
        }
        onEdit={() => setActiveSeriesKey(series.seriesKey)}
      />
    );
  };

  const sectionLabel =
    navSection === 'favorites'
      ? 'Favoritos'
      : navSection === 'wishlist'
      ? 'Por leer'
      : navSection === 'reading'
      ? 'Lecturas terminadas'
      : navSection === 'manga'
      ? 'Mangas, Manhwas y Cómics'
      : navSection === 'audiobooks'
      ? 'Audiolibros'
      : navSection === 'collections'
      ? 'Todas las Colecciones'
      : activeCategory === 'all'
      ? 'Tu Biblioteca'
      : categories.find((c) => c.id === activeCategory)?.label || 'Biblioteca';

  const scrollShelf = (dir: -1 | 1) => {
    shelfRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  const handleSortChange = (nextSort: SortKey) => {
    const defaultDir: 'asc' | 'desc' =
      nextSort === 'title' || nextSort === 'author' || nextSort === 'folder' ? 'asc' : 'desc';
    updateTheme({ sortBy: nextSort, sortDir: defaultDir });
  };

  const handleAddAudiobooks = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!list.length) return;
    await importFiles(list, { kind: 'audiobook', categories: ['audiobooks'] });
  };

  const runAiBatchOnTargets = async (
    list: Array<{
      id: string;
      seriesBookIds?: string[];
      isVisualSeries: boolean;
      seriesName?: string;
    }>,
    modeLabel: string
  ) => {
    if (aiBatchState || list.length === 0) return;
    aiCancelRef.current = false;
    const targets = list.slice(0, 40);
    setAiBatchState({ done: 0, total: targets.length, updated: 0 });
    let updated = 0;
    let consecutiveFailures = 0;
    let rateLimited = false;

    for (let i = 0; i < targets.length; i++) {
      if (aiCancelRef.current) break;
      const t = targets[i];
      const res = await identifyBookWithAI(t.id, {
        silent: true,
        seriesBookIds: t.seriesBookIds,
        isVisualSeries: t.isVisualSeries,
        seriesName: t.seriesName,
      });
      if (res) {
        updated++;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          rateLimited = true;
          break;
        }
      }
      setAiBatchState({ done: i + 1, total: targets.length, updated });
      await new Promise((r) => window.setTimeout(r, 420));
    }
    setAiBatchState(null);
    showToast(
      rateLimited
        ? `${modeLabel} pausada por límite temporal (${updated} revisado${updated === 1 ? '' : 's'})`
        : aiCancelRef.current
        ? `${modeLabel} detenida (${updated} revisado${updated === 1 ? '' : 's'})`
        : `${modeLabel} completada: ${updated} de ${targets.length} revisado${targets.length === 1 ? '' : 's'}`
    );
  };

  const handleBatchAiEnrich = async () => {
    await runAiBatchOnTargets(incompleteTargets, 'IA');
  };

  const handleBatchClassifyAndUnify = async () => {
    await runAiBatchOnTargets(visualClassifyTargets, 'Clasificación y unión con IA');
  };

  const isAudiobooksView = navSection === 'audiobooks';
  const isMangaView = navSection === 'manga';

  return (
    <section aria-label={sectionLabel} className="shelf-section">
      <input
        ref={audioInputRef}
        type="file"
        multiple
        accept={`audio/*,${ACCEPTED_AUDIO_EXTENSIONS}`}
        hidden
        onChange={handleAddAudiobooks}
      />

      {/* Row 1: Title + Controls */}
      <div className="section-header">
        <h2 className="section-title">
          {sectionLabel}
          <span className="section-count">{sortedItems.length}</span>
        </h2>

        <div className="section-controls">
          {isAudiobooksView && (
            <button
              type="button"
              className="coral-cta-btn"
              style={{ height: 32, padding: '0 13px', fontSize: 11.5 }}
              onClick={() => audioInputRef.current?.click()}
              title="Agregar audiolibros en MP3, M4B, M4A, AAC, OGG, OPUS, WAV, FLAC, WMA y más"
            >
              <Headphones size={13} /> Agregar audiolibros
            </button>
          )}

          {incompleteTargets.length > 0 && !aiBatchState && (
            <button
              type="button"
              className="pill-btn"
              style={{ height: 30, fontSize: 11 }}
              onClick={() => void handleBatchAiEnrich()}
              title="Analiza la portada y metadatos con IA para completar título, autor, géneros y sinopsis"
            >
              <Sparkles size={12} /> Completar con IA ({incompleteTargets.length})
            </button>
          )}

          {visualClassifyTargets.length > 0 && !aiBatchState && (navSection === 'manga' || navSection === 'home') && (
            <button
              type="button"
              className="pill-btn"
              style={{ height: 30, fontSize: 11 }}
              onClick={() => void handleBatchClassifyAndUnify()}
              title="Usa la IA para distinguir Manga, Manhwa, Manhua, Cómic o Libro en tus PDFs/CBZ/CBR y unir series con nombres distintos"
            >
              <Sparkles size={12} /> Clasificar y unir con IA
            </button>
          )}

          {aiBatchState && (
            <button
              type="button"
              className="pill-btn active"
              style={{ height: 30, fontSize: 11 }}
              onClick={() => {
                aiCancelRef.current = true;
              }}
              title="Toca para detener el análisis con IA"
            >
              <Sparkles size={12} /> IA {aiBatchState.done}/{aiBatchState.total} (faltan {incompleteTargets.length}) <X size={11} />
            </button>
          )}

          {linkedFolder && (
            <button
              type="button"
              className="pill-btn"
              style={{ height: 30, fontSize: 11 }}
              disabled={folderAutoScanBusy}
              onClick={() => void scanLinkedLibraryFolder({ silent: false })}
              title={`Buscar archivos nuevos en tu carpeta vinculada "${linkedFolder.name}" (no revisa en segundo plano)`}
            >
              <RefreshCw size={12} className={folderAutoScanBusy ? 'spin' : ''} />
              {folderAutoScanBusy ? 'Buscando...' : 'Actualizar carpeta'}
            </button>
          )}

          {activeCategory !== 'all' && !isAudiobooksView && !isMangaView && (
            <button className="pill-btn" style={{ height: 30, fontSize: 11 }} onClick={() => setActiveCategory('all')}>
              Ver todos
            </button>
          )}

          {/* 3 Disposiciones: Cuadrícula, Lista, Estantería */}
          <div className="layout-switcher" role="group" aria-label="Tipo de disposición">
            <button
              type="button"
              className={`layout-switch-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => updateTheme({ viewMode: 'grid' })}
              title="Vista en cuadrícula"
            >
              <Grid size={13} />
              <span>Cuadrícula</span>
            </button>
            <button
              type="button"
              className={`layout-switch-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => updateTheme({ viewMode: 'list' })}
              title="Vista en lista detallada"
            >
              <List size={13} />
              <span>Lista</span>
            </button>
            <button
              type="button"
              className={`layout-switch-btn ${viewMode === 'shelf' ? 'active' : ''}`}
              onClick={() => updateTheme({ viewMode: 'shelf' })}
              title="Vista en estantería horizontal"
            >
              <Rows3 size={13} />
              <span>Estantería</span>
            </button>
          </div>

          {viewMode === 'shelf' && (
            <>
              <button
                className="circle-arrow-btn"
                onClick={() => scrollShelf(-1)}
                aria-label="Desplazar izquierda"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="circle-arrow-btn"
                onClick={() => scrollShelf(1)}
                aria-label="Desplazar derecha"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Dedicated Origin Sub-Filter Pills inside the Manga/Manhwa/Comic section */}
      {isMangaView && (
        <div className="shelf-filter-pills" style={{ marginBottom: 8 }} role="group" aria-label="Filtrar por tipo">
          {(
            [
              ['all', 'Todos'],
              ['manhwa', '#Manhwa 🇰🇷'],
              ['manga', '#Manga 🇯🇵'],
              ['manhua', '#Manhua 🇨🇳'],
              ['comic', '#Cómic'],
            ] as Array<[OriginTag | 'all', string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`pill-btn shelf-filter-btn ${mangaOriginFilter === key ? 'active' : ''}`}
              onClick={() => setMangaOriginFilter(key)}
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Row 2: Reading Filter Pills + Sort Selector */}
      <div className="shelf-controls-bar">
        {navSection !== 'reading' ? (
          <div className="shelf-filter-pills" role="group" aria-label="Filtro de lectura">
            {(
              [
                ['all', 'Todos', filterCounts.all],
                ['unread', 'Sin leer', filterCounts.unread],
                ['reading', 'Leyendo', filterCounts.reading],
                ['completed', 'Finalizados', filterCounts.completed],
              ] as Array<[ReadingFilterKey, string, number]>
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={`pill-btn shelf-filter-btn ${readingFilter === key ? 'active' : ''}`}
                onClick={() => updateTheme({ readingFilter: key })}
              >
                <span>{label}</span>
                <span className="shelf-filter-count">{count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
            Todos tus libros y lecturas finalizadas al 100%
          </div>
        )}

        <div className="shelf-sort-group">
          <select
            className="studio-input shelf-sort-select"
            aria-label="Ordenar libros por"
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value as SortKey)}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                Ordenar: {SORT_LABELS[k]}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="circle-arrow-btn shelf-sort-dir-btn"
            onClick={() => updateTheme({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })}
            title={sortDir === 'asc' ? 'Orden ascendente (toca para invertir)' : 'Orden descendente (toca para invertir)'}
            aria-label="Invertir orden"
          >
            {sortDir === 'asc' ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
          </button>
        </div>
      </div>

      {/* Books Container */}
      {sortedItems.length === 0 ? (
        <div
          style={{
            background: 'var(--banner-bg)',
            borderRadius: 'var(--radius-card)',
            padding: '28px 18px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            {isAudiobooksView
              ? 'Aún no tienes audiolibros'
              : navSection === 'reading'
              ? 'Aún no tienes lecturas terminadas'
              : books.length === 0
              ? 'Tu biblioteca está vacía'
              : 'No hay títulos con este filtro'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 480 }}>
            {isAudiobooksView
              ? 'Agrega audiolibros en cualquier formato: MP3, M4B, M4A, AAC, OGG, OPUS, WAV, FLAC, WEBM, WMA, AMR, AIFF y más.'
              : navSection === 'reading'
              ? 'Cuando termines un libro o lo marques como completado, aparecerá automáticamente aquí.'
              : books.length === 0
              ? 'Importa tus primeros libros (EPUB, PDF, CBZ, CBR, MOBI, FB2, DOCX, TXT, audiolibros, carpetas o copias de otra app) o conecta tu nube para restaurar tu cuenta.'
              : 'Cambia el filtro de lectura, la categoría o la búsqueda para ver tus otros títulos.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {isAudiobooksView ? (
              <button className="coral-cta-btn" onClick={() => audioInputRef.current?.click()}>
                <Headphones size={15} /> Agregar audiolibros
              </button>
            ) : books.length > 0 && effectiveReadingFilter !== 'all' ? (
              <button className="pill-btn active" onClick={() => updateTheme({ readingFilter: 'all' })}>
                Ver todos los libros
              </button>
            ) : (
              <button className="coral-cta-btn" onClick={() => setImportModalOpen(true)}>
                <Plus size={15} /> Importar archivos
              </button>
            )}
            {books.length === 0 && !isAudiobooksView && (
              <button
                className="pill-btn"
                style={{ height: 36, padding: '0 14px', fontSize: 12, background: 'var(--card-bg)' }}
                onClick={() => setProfileModalOpen(true)}
              >
                <Cloud size={14} /> Conectar mi nube
              </button>
            )}
          </div>
        </div>
      ) : folderGroups ? (
        <div className="folder-groups-wrap">
          {folderGroups.map(([folderName, groupItems]) => (
            <div key={folderName} className="folder-group-section">
              <div className="folder-group-head">
                <Folder size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <span>{folderName}</span>
                <span className="section-count">{groupItems.length}</span>
              </div>
              {viewMode === 'list' ? (
                <div className="books-list">{groupItems.map(renderDisplayRow)}</div>
              ) : (
                <div className="books-grid">{groupItems.map(renderDisplayCard)}</div>
              )}
            </div>
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div className="books-list">{visibleItems.map(renderDisplayRow)}</div>
      ) : viewMode === 'grid' ? (
        <div className="books-grid">{visibleItems.map(renderDisplayCard)}</div>
      ) : (
        <div className="books-shelf-wrap">
          <div className="books-shelf" ref={shelfRef}>
            {visibleItems.map(renderDisplayCard)}
          </div>
          <div className="books-shelf-ledge" aria-hidden="true" />
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="shelf-load-more">
          <button
            type="button"
            className="pill-btn"
            onClick={() => setVisibleCount((c) => Math.min(sortedItems.length, c + renderBatch))}
          >
            Mostrar más ({visibleItems.length} de {sortedItems.length})
          </button>
        </div>
      )}
    </section>
  );
};

export const BookShelf = React.memo(BookShelfInner);
