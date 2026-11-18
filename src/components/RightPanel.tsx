import React from 'react';
import { BookmarkCheck, MessageCircle, Palette, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ChatTab } from './ChatTab';
import { NotesSyncTab } from './NotesSyncTab';
import { StudioTab } from './StudioTab';

export const RightPanel: React.FC = () => {
  const { theme, rightTab, setRightTab, mobilePanelOpen, setMobilePanelOpen } = useLibrary();

  if (!theme.showRightPanel && !mobilePanelOpen) return null;

  const title =
    rightTab === 'chat'
      ? 'Chat'
      : rightTab === 'studio'
      ? 'Estudio Visual'
      : 'Notas y Sync';

  return (
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
            className="circle-arrow-btn"
            style={{ background: 'var(--card-bg)' }}
            onClick={() => setMobilePanelOpen(false)}
            title="Cambiar vista / cerrar en móvil"
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
            <MessageCircle size={13} /> Chat
          </button>
          <button
            role="tab"
            aria-selected={rightTab === 'studio'}
            className={`panel-tab-btn ${rightTab === 'studio' ? 'active' : ''}`}
            onClick={() => setRightTab('studio')}
          >
            <Palette size={13} /> Estudio
          </button>
          <button
            role="tab"
            aria-selected={rightTab === 'notes'}
            className={`panel-tab-btn ${rightTab === 'notes' ? 'active' : ''}`}
            onClick={() => setRightTab('notes')}
          >
            <BookmarkCheck size={13} /> Notas
          </button>
        </div>
      </div>

      {rightTab === 'chat' && <ChatTab />}
      {rightTab === 'studio' && <StudioTab />}
      {rightTab === 'notes' && <NotesSyncTab />}
    </aside>
  );
};
