import React, { useState } from 'react';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { BookDetailModal } from './components/BookDetailModal';
import { BookShelf } from './components/BookShelf';
import { CategoryStrip } from './components/CategoryStrip';
import { FeaturedBanner } from './components/FeaturedBanner';
import { ImportModal } from './components/ImportModal';
import { ProfileModal } from './components/ProfileModal';
import { ReaderShell } from './components/readers/ReaderShell';
import { RightPanel } from './components/RightPanel';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LibraryProvider, useLibrary } from './context/LibraryContext';

const AppWorkspace: React.FC = () => {
  const { theme, importFiles, toast, ready } = useLibrary();
  const [globalDragging, setGlobalDragging] = useState(false);

  const shellClasses = [
    'app-shell',
    theme.showRightPanel ? '' : 'no-right-panel',
    theme.compactSidebar ? 'compact-sidebar' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="app-backdrop"
      style={
        theme.customWallpaperUrl
          ? { backgroundImage: `url(${theme.customWallpaperUrl})` }
          : undefined
      }
      onDragOver={(e) => {
        e.preventDefault();
        if (!globalDragging) setGlobalDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setGlobalDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setGlobalDragging(false);
        const dropped = Array.from(e.dataTransfer.files || []);
        if (dropped.length) {
          const allImages = dropped.length > 1 && dropped.every((f) => f.type.startsWith('image/'));
          await importFiles(dropped, { bundleImages: allImages });
        }
      }}
    >
      <div className={shellClasses}>
        <Sidebar />

        <main className="main-canvas">
          <TopBar />
          <CategoryStrip />
          {ready ? (
            <>
              <BookShelf />
              <FeaturedBanner />
            </>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>
              Preparando tu librería KomoLib...
            </div>
          )}
        </main>

        <RightPanel />

        {globalDragging && (
          <div
            style={{
              position: 'absolute',
              inset: 12,
              borderRadius: 24,
              border: '3px dashed var(--accent-primary)',
              background: 'rgba(253, 251, 248, 0.9)',
              backdropFilter: 'blur(6px)',
              zIndex: 80,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-primary)' }}>
                Suelta aquí tus libros, mangas o manhwas
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                EPUB · PDF · CBZ · CBR · MOBI · FB2 · DOCX · TXT · Imágenes · Audio
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Universal Reader */}
      <ReaderShell />

      {/* Modals & Floating Audio Player */}
      <ImportModal />
      <BookDetailModal />
      <ProfileModal />
      <AudioPlayerBar />

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#2f2926',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 700,
            boxShadow: '0 10px 26px rgba(0,0,0,0.28)',
            zIndex: 140,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
};

export function App() {
  return (
    <LibraryProvider>
      <AppWorkspace />
    </LibraryProvider>
  );
}

export default App;
