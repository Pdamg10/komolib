import React from 'react';
import { BookmarkCheck, MessageCircle, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ChatTab } from './ChatTab';
import { NotesSyncTab } from './NotesSyncTab';

const RightPanelInner: React.FC = () => {
  const { theme, updateTheme, rightTab, setRightTab, mobilePanelOpen, setMobilePanelOpen } =
    useLibrary();

  if (!theme.showRightPanel && !mobilePanelOpen) return null;

  const title = rightTab === 'chat' ? 'Chat IA' : 'Diario y Notas';

  const handleClosePanel = () => {
    setMobilePanelOpen(false);
    if (typeof window === 'undefined' || window.innerWidth > 960) {
      updateTheme({ showRightPanel: false });
    }
  };

  return (
    <>
      {mobilePanelOpen && (
        <div
          className="right-panel-scrim"
          onClick={() => setMobilePanelOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`right-panel ${theme.showDoodlePattern ? 'with-doodle' : ''} ${
          mobilePanelOpen ? '' : 'mobile-hidden'
        }`}
        aria-label="Panel multipropósito"
      >
        <div className="right-panel-header">
          <div className="right-panel-top">
            <h3 className="right-panel-title">{title}</h3>
            <button
              type="button"
              className="circle-arrow-btn"
              style={{ background: 'var(--card-bg)' }}
              onClick={handleClosePanel}
              title="Cerrar panel lateral"
              aria-label="Cerrar panel lateral"
            >
              <X size={15} />
            </button>
          </div>

          <div className="panel-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={rightTab === 'chat'}
              className={`panel-tab-btn ${rightTab === 'chat' ? 'active' : ''}`}
              onClick={() => setRightTab('chat')}
            >
              <MessageCircle size={13} /> Chat IA
            </button>
            <button
              role="tab"
              aria-selected={rightTab === 'notes'}
              className={`panel-tab-btn ${rightTab === 'notes' ? 'active' : ''}`}
              onClick={() => setRightTab('notes')}
            >
              <BookmarkCheck size={13} /> Diario / Notas
            </button>
          </div>
        </div>

        {rightTab === 'chat' ? <ChatTab /> : <NotesSyncTab />}
      </aside>
    </>
  );
};

export const RightPanel = React.memo(RightPanelInner);
