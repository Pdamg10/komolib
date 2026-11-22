import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Folder,
  Grid,
  List,
  Plus,
  Rows3,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { BookItem, ThemeConfig } from '../types/library';
import { getEffectiveStatus } from '../utils/readingStats';
import { BookCard, BookListRow } from './BookCard';

type SortKey = NonNullable<ThemeConfig['sortBy']>;
type ReadingFilterKey = NonNullable<ThemeConfig['readingFilter']>;
type LayoutMode = ThemeConfig['viewMode'];

const RENDER_BATCH = 48;

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

export const BookShelf: React.FC = () => {
  const {
    books,
    navSection,
    activeCategory,
    setActiveCategory,
    categories,
    searchQuery,
    theme,
    updateTheme,
    setImportModalOpen,
    setProfileModalOpen,
  } = useLibrary();

  const shelfRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const viewMode: LayoutMode = theme.viewMode || 'grid';
  const sortBy: SortKey = theme.sortBy || 'recent';
  const sortDir: 'asc' | 'desc' = theme.sortDir || (sortBy === 'title' || sortBy === 'author' || sortBy === 'folder' ? 'asc' : 'desc');
  const readingFilter: ReadingFilterKey = theme.readingFilter || 'all';

  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH);

  // Base list filtered by nav section, category, and search query (used for reading filter counts)
  const baseFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const catObj = categories.find((c) => c.id === activeCategory);

    return books.filter((b) => {
      if (navSection === 'favorites' && !b.favorite) return false;
      if (navSection === 'wishlist' && !b.wishlist) return false;
      if (navSection === 'reading' && b.progress <= 0 && b.format !== 'audio') return false;

      if (activeCategory !== 'all') {
        const matchesKind = catObj?.filterKind && b.kind === catObj.filterKind;
        const matchesCat = b.categories.includes(activeCategory);
        if (!matchesKind && !matchesCat) return false;
      }

      if (q) {
        const hay = `${b.title} ${b.author} ${b.format} ${b.kind} ${b.folderPath || ''} ${b.tags.join(' ')} ${b.categories.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeCategory, books, categories, navSection, searchQuery]);

  // Reading filter counts
  const filterCounts = useMemo(() => {
    let unread = 0;
    let reading = 0;
    let completed = 0;
    for (const b of baseFiltered) {
      const bucket = getReadingBucket(b);
      if (bucket === 'completed') completed++;
      else if (bucket === 'reading') reading++;
      else unread++;
    }
    return { all: baseFiltered.length, unread, reading, completed };
  }, [baseFiltered]);

  // Apply reading status filter + sorting
  const sortedBooks = useMemo(() => {
    const list =
      readingFilter === 'all'
        ? [...baseFiltered]
        : baseFiltered.filter((b) => getReadingBucket(b) === readingFilter);

    const dir = sortDir === 'asc' ? 1 : -1;
    const isUnknown = (a: string) => {
      const low = (a || '').trim().toLowerCase();
      return !low || low === 'autor desconocido' || low === 'unknown';
    };

    list.sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, 'es', { numeric: true, sensitivity: 'base' }) * dir;
      }
      if (sortBy === 'author') {
        const aUnk = isUnknown(a.author);
        const bUnk = isUnknown(b.author);
        if (aUnk !== bUnk) return aUnk ? 1 : -1;
        const cmp = (a.author || '').localeCompare(b.author || '', 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
        return a.title.localeCompare(b.title, 'es', { numeric: true, sensitivity: 'base' });
      }
      if (sortBy === 'imported') {
        return ((a.addedAt || 0) - (b.addedAt || 0)) * dir;
      }
      if (sortBy === 'folder') {
        const fa = getBookFolderLabel(a);
        const fb = getBookFolderLabel(b);
        const aNone = fa === 'Sin carpeta';
        const bNone = fb === 'Sin carpeta';
        if (aNone !== bNone) return aNone ? 1 : -1;
        const cmp = fa.localeCompare(fb, 'es', { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
        return a.title.localeCompare(b.title, 'es', { numeric: true, sensitivity: 'base' });
      }
      // 'recent' -> most recently read / finished / updated / added
      const ta = Math.max(a.lastReadAt || 0, a.finishedAt || 0, a.lastChapterFinishedAt || 0, a.addedAt || 0);
      const tb = Math.max(b.lastReadAt || 0, b.finishedAt || 0, b.lastChapterFinishedAt || 0, b.addedAt || 0);
      return (ta - tb) * dir;
    });

    return list;
  }, [baseFiltered, readingFilter, sortBy, sortDir]);

  // Reset progressive render window whenever filters/sorting/view change
  useEffect(() => {
    setVisibleCount(RENDER_BATCH);
  }, [activeCategory, navSection, searchQuery, readingFilter, sortBy, sortDir, viewMode]);

  const visibleBooks = useMemo(
    () => (viewMode === 'shelf' ? sortedBooks.slice(0, Math.min(sortedBooks.length, visibleCount)) : sortedBooks.slice(0, visibleCount)),
    [sortedBooks, visibleCount, viewMode]
  );

  const hasMore = visibleCount < sortedBooks.length;

  // Progressive infinite loading via IntersectionObserver (keeps low-end Android phones 60 FPS!)
  useEffect(() => {
    if (!hasMore || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(sortedBooks.length, c + RENDER_BATCH));
        }
      },
      { rootMargin: '260px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, sortedBooks.length, visibleCount]);

  // Folder grouping when sorted by 'folder' in grid/list mode
  const folderGroups = useMemo(() => {
    if (sortBy !== 'folder' || viewMode === 'shelf') return null;
    const map = new Map<string, BookItem[]>();
    for (const b of visibleBooks) {
      const folder = getBookFolderLabel(b);
      const arr = map.get(folder) || [];
      arr.push(b);
      map.set(folder, arr);
    }
    return Array.from(map.entries());
  }, [sortBy, viewMode, visibleBooks]);

  const sectionLabel =
    navSection === 'favorites'
      ? 'Favoritos'
      : navSection === 'wishlist'
      ? 'Por leer'
      : navSection === 'reading'
      ? 'Leyendo y Audio'
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

  return (
    <section aria-label={sectionLabel} className="shelf-section">
      {/* Row 1: Title + 3-Layout Switcher */}
      <div className="section-header">
        <h2 className="section-title">
          {sectionLabel}
          <span className="section-count">{sortedBooks.length}</span>
        </h2>

        <div className="section-controls">
          {activeCategory !== 'all' && (
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

      {/* Row 2: Reading Filter Pills + Sort Selector */}
      <div className="shelf-controls-bar">
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
      {sortedBooks.length === 0 ? (
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
            {books.length === 0 ? 'Tu biblioteca está vacía' : 'No hay títulos con este filtro'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 460 }}>
            {books.length === 0
              ? 'Importa tus primeros libros (EPUB, PDF, CBZ, CBR, MOBI, FB2, DOCX, TXT, carpetas o copias de otra app) o ingresa tu correo para restaurar tu cuenta.'
              : 'Cambia el filtro de lectura, la categoría o la búsqueda para ver tus otros títulos.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {books.length > 0 && readingFilter !== 'all' ? (
              <button className="pill-btn active" onClick={() => updateTheme({ readingFilter: 'all' })}>
                Ver todos los libros
              </button>
            ) : (
              <button className="coral-cta-btn" onClick={() => setImportModalOpen(true)}>
                <Plus size={15} /> Importar archivos
              </button>
            )}
            {books.length === 0 && (
              <button
                className="pill-btn"
                style={{ height: 36, padding: '0 14px', fontSize: 12, background: 'var(--card-bg)' }}
                onClick={() => setProfileModalOpen(true)}
              >
                <Cloud size={14} /> Restaurar cuenta con mi correo
              </button>
            )}
          </div>
        </div>
      ) : folderGroups ? (
        <div className="folder-groups-wrap">
          {folderGroups.map(([folderName, groupBooks]) => (
            <div key={folderName} className="folder-group-section">
              <div className="folder-group-head">
                <Folder size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <span>{folderName}</span>
                <span className="section-count">{groupBooks.length}</span>
              </div>
              {viewMode === 'list' ? (
                <div className="books-list">
                  {groupBooks.map((book) => (
                    <BookListRow key={book.id} book={book} />
                  ))}
                </div>
              ) : (
                <div className="books-grid">
                  {groupBooks.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div className="books-list">
          {visibleBooks.map((book) => (
            <BookListRow key={book.id} book={book} />
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="books-grid">
          {visibleBooks.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : (
        <div className="books-shelf-wrap">
          <div className="books-shelf" ref={shelfRef}>
            {visibleBooks.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
          <div className="books-shelf-ledge" aria-hidden="true" />
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="shelf-load-more">
          <button
            type="button"
            className="pill-btn"
            onClick={() => setVisibleCount((c) => Math.min(sortedBooks.length, c + RENDER_BATCH))}
          >
            Mostrar más ({visibleBooks.length} de {sortedBooks.length})
          </button>
        </div>
      )}
    </section>
  );
};
