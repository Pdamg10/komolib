import React, { useRef } from 'react';
import { PanelRight, Plus, Search, Upload, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

export const TopBar: React.FC = () => {
  const {
    searchQuery,
    setSearchQuery,
    books,
    setImportModalOpen,
    theme,
    updateTheme,
    mobilePanelOpen,
    setMobilePanelOpen,
  } = useLibrary();

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="top-bar">
      <div className="search-box">
        <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar libros, mangas, manhwas, autores o formatos..."
          aria-label="Buscar en tu librería"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ color: 'var(--text-muted)', display: 'grid', placeItems: 'center' }}
            title="Limpiar búsqueda"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <button
        className="gradient-search-btn"
        onClick={() => inputRef.current?.focus()}
        title="Buscar"
      >
        buscar
      </button>

      <button
        className="top-action-circle"
        onClick={() => setImportModalOpen(true)}
        title="Importar libros, mangas, manhwas, PDF, CBZ, CBR, EPUB..."
      >
        <Upload size={18} style={{ color: 'var(--accent-primary)' }} />
        <span className="top-action-badge">{books.length}</span>
      </button>

      <button
        className="top-action-circle"
        onClick={() => {
          if (window.innerWidth <= 960) {
            setMobilePanelOpen(!mobilePanelOpen);
          } else {
            updateTheme({ showRightPanel: !theme.showRightPanel });
          }
        }}
        title={theme.showRightPanel ? 'Ocultar panel derecho' : 'Mostrar panel derecho (Chat / Estudio / Sync)'}
      >
        <PanelRight size={18} />
      </button>
    </header>
  );
};

export const QuickImportFloat: React.FC = () => {
  const { setImportModalOpen } = useLibrary();
  return (
    <button
      className="pill-btn"
      onClick={() => setImportModalOpen(true)}
      style={{ background: 'var(--accent-primary)', color: '#fff' }}
    >
      <Plus size={14} /> Importar
    </button>
  );
};
