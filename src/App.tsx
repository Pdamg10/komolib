import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Smartphone, X } from 'lucide-react';
import { AnnotationsView } from './components/AnnotationsView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { BookDetailModal } from './components/BookDetailModal';
import {
  BookOptionsSheet,
  closeBookOptionsMenu,
  isBookOptionsMenuOpen,
} from './components/BookOptionsSheet';
import { BookShelf } from './components/BookShelf';
import { CategoryStrip } from './components/CategoryStrip';
import { DashboardView } from './components/DashboardView';
import { ImportModal } from './components/ImportModal';
import { MangaSeriesModal } from './components/MangaSeriesModal';
import { MissingFileModal } from './components/MissingFileModal';
import { ProfileModal } from './components/ProfileModal';
import { ReadingLogView } from './components/ReadingLogView';
import { ReaderShell } from './components/readers/ReaderShell';
import { RightPanel } from './components/RightPanel';
import { SharedReadingView } from './components/SharedReadingView';
import { Sidebar } from './components/Sidebar';
import { StudioModal } from './components/StudioModal';
import { SyncProgressModal } from './components/SyncProgressModal';
import { TopBar } from './components/TopBar';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { extractFilesFromDataTransfer, isImageFile } from './utils/fileFolderImport';

const AppWorkspace: React.FC = () => {
  const {
    theme,
    navSection,
    setNavSection,
    books,
    activeBook,
    audioBook,
    closeReader,
    openBook,
    importModalOpen,
    setImportModalOpen,
    studioModalOpen,
    setStudioModalOpen,
    profileModalOpen,
    setProfileModalOpen,
    editingBook,
    setEditingBook,
    activeSeriesKey,
    setActiveSeriesKey,
    missingFileBook,
    setMissingFileBook,
    remoteActiveSession,
    dismissRemoteSession,
    importFiles,
    toast,
    ready,
  } = useLibrary();
  const [globalDragging, setGlobalDragging] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const mainCanvasRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = mainCanvasRef.current;
    if (!el) return;
    let visible = false;
    const onScroll = () => {
      const y = el.scrollTop || window.scrollY || 0;
      const next = y > 320;
      if (next !== visible) {
        visible = next;
        setShowScrollTop(next);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    const el = mainCanvasRef.current;
    if (el && el.scrollTop > 0) {
      el.scrollTop = 0;
    }
    setShowScrollTop(false);
  }, [navSection]);

  // Unified back-gesture handler for BOTH Android APK (MainActivity OnBackPressedCallback) and Web PWA
  const handleAppBack = useCallback((): boolean => {
    if (isBookOptionsMenuOpen()) {
      closeBookOptionsMenu();
      return true;
    }
    if (missingFileBook) {
      setMissingFileBook(null);
      return true;
    }
    if (editingBook) {
      setEditingBook(null);
      return true;
    }
    if (activeSeriesKey) {
      setActiveSeriesKey(null);
      return true;
    }
    if (studioModalOpen) {
      setStudioModalOpen(false);
      return true;
    }
    if (importModalOpen) {
      setImportModalOpen(false);
      return true;
    }
    if (profileModalOpen) {
      setProfileModalOpen(false);
      return true;
    }
    if (activeBook) {
      const win = window as unknown as { __komoCloseReaderDrawer?: () => boolean };
      if (win.__komoCloseReaderDrawer?.()) {
        return true;
      }
      closeReader();
      return true;
    }
    if (navSection !== 'home') {
      setNavSection('home');
      return true;
    }
    return false;
  }, [
    activeBook,
    activeSeriesKey,
    closeReader,
    editingBook,
    importModalOpen,
    missingFileBook,
    navSection,
    profileModalOpen,
    setActiveSeriesKey,
    setEditingBook,
    setImportModalOpen,
    setMissingFileBook,
    setNavSection,
    setProfileModalOpen,
    setStudioModalOpen,
    studioModalOpen,
  ]);

  const handleAppBackRef = useRef(handleAppBack);
  handleAppBackRef.current = handleAppBack;

  useEffect(() => {
    const win = window as unknown as { __komoHandleAndroidBack?: () => boolean };
    win.__komoHandleAndroidBack = () => handleAppBackRef.current();
    return () => {
      delete win.__komoHandleAndroidBack;
    };
  }, []);

  // Push browser history sentinel when opening the fullscreen reader so Web/PWA swipe-back closes reader cleanly
  const readerHistoryPushedRef = useRef(false);
  useEffect(() => {
    if (activeBook && !readerHistoryPushedRef.current) {
      try {
        window.history.pushState({ komoReader: true }, '');
        readerHistoryPushedRef.current = true;
      } catch {
        // ignore history API restriction
      }
    } else if (!activeBook) {
      readerHistoryPushedRef.current = false;
    }
  }, [activeBook]);

  useEffect(() => {
    const onPopState = () => {
      readerHistoryPushedRef.current = false;
      handleAppBackRef.current();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const isFullView = theme.fullView !== false;
  const hasWallpaper = Boolean(theme.customWallpaperUrl);

  // Auto-detect low-end PCs, phones/tablets, reduced-motion preference, or large libraries
  const autoLowEnd = React.useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const lowMem = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
    const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
    const isAndroidMobile =
      /Android/i.test(nav.userAgent || '') &&
      typeof window !== 'undefined' &&
      window.innerWidth <= 1024;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return lowMem || lowCpu || isAndroidMobile || prefersReducedMotion;
  }, []);

  const isPerfLite =
    theme.lowPerformanceMode === 'on' ||
    (theme.lowPerformanceMode !== 'off' && (autoLowEnd || books.length >= 120));

  const backdropClasses = [
    'app-backdrop',
    isFullView ? 'full-view' : '',
    hasWallpaper ? 'has-wallpaper' : '',
    isPerfLite ? 'perf-lite' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const shellClasses = [
    'app-shell',
    isFullView ? 'full-view' : '',
    hasWallpaper ? 'has-wallpaper' : '',
    isPerfLite ? 'perf-lite' : '',
    theme.showRightPanel ? '' : 'no-right-panel',
    theme.compactSidebar ? 'compact-sidebar' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={backdropClasses}
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
        const dropped = await extractFilesFromDataTransfer(e.dataTransfer);
        if (dropped.length) {
          const imageCount = dropped.filter((f) => isImageFile(f)).length;
          await importFiles(dropped, { bundleImages: imageCount > 1 });
        }
      }}
    >
      {hasWallpaper && (
        <div
          className="app-wallpaper-bg"
          style={{ backgroundImage: `url(${theme.customWallpaperUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className={shellClasses}>
        <Sidebar />

        <main ref={mainCanvasRef} className="main-canvas">
          <TopBar />

          {remoteActiveSession && (
            <div className="remote-resume-banner">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                <span className="quickstart-step-icon" style={{ width: 32, height: 32, flexShrink: 0 }}>
                  <Smartphone size={15} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Continuar desde {remoteActiveSession.deviceName}: {remoteActiveSession.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                    Progreso sincronizado: {Math.round(remoteActiveSession.progress || 0)}%
                    {remoteActiveSession.currentPage ? ` · Página ${remoteActiveSession.currentPage}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="coral-cta-btn"
                  style={{ height: 30, padding: '0 13px', fontSize: 11.5 }}
                  onClick={() => {
                    const target = books.find((b) => b.id === remoteActiveSession.bookId);
                    if (target) openBook(target);
                    dismissRemoteSession();
                  }}
                >
                  <BookOpen size={12} /> Continuar aquí
                </button>
                <button
                  type="button"
                  className="circle-arrow-btn"
                  style={{ width: 28, height: 28 }}
                  onClick={dismissRemoteSession}
                  aria-label="Ocultar aviso"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          {!ready ? (
            <div style={{ padding: 40, textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>
              Preparando tu librería KomoLib...
            </div>
          ) : navSection === 'dashboard' ? (
            <DashboardView />
          ) : navSection === 'reading-log' ? (
            <ReadingLogView />
          ) : navSection === 'annotations' ? (
            <AnnotationsView />
          ) : navSection === 'shared' ? (
            <SharedReadingView />
          ) : (
            <>
              {navSection !== 'audiobooks' && navSection !== 'manga' && <CategoryStrip />}
              <BookShelf />
            </>
          )}

          {showScrollTop && !activeBook && (
            <div
              className={`scroll-top-anchor ${audioBook ? 'with-audio' : ''}`}
              aria-hidden="false"
            >
              <button
                type="button"
                className="scroll-top-btn"
                onClick={() => {
                  const behavior: ScrollBehavior = isPerfLite ? 'auto' : 'smooth';
                  mainCanvasRef.current?.scrollTo({ top: 0, behavior });
                  if (window.scrollY > 0) {
                    window.scrollTo({ top: 0, behavior });
                  }
                }}
                title="Volver al inicio"
                aria-label="Volver al inicio"
              >
                <ArrowUp size={17} />
                <span>Subir</span>
              </button>
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
              background: 'color-mix(in srgb, var(--shell-bg) 92%, transparent)',
              backdropFilter: 'blur(6px)',
              zIndex: 80,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-primary)' }}>
                Suelta aquí tus archivos o carpetas
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                Carpetas · EPUB · PDF · CBZ · CBR · MOBI · FB2 · DOCX · TXT · Imágenes · Audio
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Universal Reader */}
      <ReaderShell />

      {/* Modals & Floating Audio Player (mounted lazily only when open for instant UI responsiveness) */}
      {importModalOpen && <ImportModal />}
      {studioModalOpen && <StudioModal />}
      <BookOptionsSheet />
      {activeSeriesKey && <MangaSeriesModal />}
      {editingBook && <BookDetailModal />}
      {missingFileBook && <MissingFileModal />}
      {profileModalOpen && <ProfileModal />}
      <SyncProgressModal />
      <AudioPlayerBar />

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text-primary)',
            color: 'var(--shell-bg)',
            border: '1px solid var(--border-subtle)',
            padding: '10px 18px',
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 700,
            maxWidth: 'calc(100vw - 24px)',
            textAlign: 'center',
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
