import React, { useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Cloud, Grid, Plus, Rows3 } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { BookCard } from './BookCard';

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

  const filteredBooks = useMemo(() => {
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
        const hay = `${b.title} ${b.author} ${b.format} ${b.kind} ${b.tags.join(' ')} ${b.categories.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeCategory, books, categories, navSection, searchQuery]);

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
      ? 'Populares y Tu Biblioteca'
      : categories.find((c) => c.id === activeCategory)?.label || 'Biblioteca';

  const scrollShelf = (dir: -1 | 1) => {
    shelfRef.current?.scrollBy({ left: dir * 340, behavior: 'smooth' });
  };

  return (
    <section aria-label={sectionLabel}>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <h2 className="section-title">
          {sectionLabel}
          <span className="section-count">{filteredBooks.length}</span>
        </h2>

        <div className="section-controls">
          <button
            className="pill-btn"
            onClick={() =>
              updateTheme({ viewMode: theme.viewMode === 'shelf' ? 'grid' : 'shelf' })
            }
            title={theme.viewMode === 'shelf' ? 'Cambiar a cuadrícula' : 'Cambiar a estantería'}
          >
            {theme.viewMode === 'shelf' ? <Grid size={13} /> : <Rows3 size={13} />}
            {theme.viewMode === 'shelf' ? 'Ver todos' : 'Estantería'}
          </button>

          {activeCategory !== 'all' && (
            <button className="pill-btn" onClick={() => setActiveCategory('all')}>
              Mostrar todos
            </button>
          )}

          {theme.viewMode === 'shelf' && (
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

      {filteredBooks.length === 0 ? (
        <div
          style={{
            background: 'var(--banner-bg)',
            borderRadius: 'var(--radius-card)',
            padding: '34px 20px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            {books.length === 0 ? 'Tu biblioteca está vacía' : 'No hay títulos en esta vista todavía'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 460 }}>
            {books.length === 0
              ? 'Importa tus primeros libros (EPUB, PDF, CBZ, CBR, MOBI, FB2, DOCX, TXT, carpetas de manga/manhwa o audiolibros) o ingresa tu correo para restaurar tu cuenta y personalización desde la nube.'
              : 'Arrastra aquí tus archivos o cambia el filtro de categoría/búsqueda.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="coral-cta-btn" onClick={() => setImportModalOpen(true)}>
              <Plus size={15} /> Importar archivos
            </button>
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
      ) : theme.viewMode === 'grid' ? (
        <div className="books-grid">
          {filteredBooks.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : (
        <div className="books-shelf" ref={shelfRef}>
          {filteredBooks.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </section>
  );
};
