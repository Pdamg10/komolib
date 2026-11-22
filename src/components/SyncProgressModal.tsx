import React from 'react';
import { AlertTriangle, CheckCircle2, Cloud, RefreshCw, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

export const SyncProgressModal: React.FC = () => {
  const { syncPopup, dismissSyncPopup } = useLibrary();

  if (!syncPopup.visible) return null;

  const pct = Math.min(100, Math.max(0, Math.round(syncPopup.progress)));
  const isDone = syncPopup.phase === 'done';
  const isError = syncPopup.phase === 'error';

  return (
    <div
      className="sync-popup-overlay"
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      aria-label={syncPopup.title}
    >
      <div className={`sync-popup-card phase-${syncPopup.phase}`}>
        <div className="sync-popup-head">
          <div className={`sync-popup-icon phase-${syncPopup.phase}`}>
            {isDone ? (
              <CheckCircle2 size={20} />
            ) : isError ? (
              <AlertTriangle size={20} />
            ) : (
              <RefreshCw size={18} className="spin" />
            )}
          </div>

          <div className="sync-popup-titles">
            <div className="sync-popup-title">{syncPopup.title}</div>
            <div className="sync-popup-detail">{syncPopup.detail}</div>
          </div>

          {(isError || isDone) && (
            <button
              type="button"
              className="circle-arrow-btn"
              style={{ width: 28, height: 28, flexShrink: 0 }}
              onClick={dismissSyncPopup}
              aria-label="Cerrar aviso de sincronización"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="sync-popup-progress-wrap">
          <div className="sync-popup-track">
            <div
              className={`sync-popup-fill phase-${syncPopup.phase}`}
              style={{ width: `${Math.max(isDone ? 100 : 8, pct)}%` }}
            />
          </div>
          <span className="sync-popup-pct">{pct}%</span>
        </div>

        {syncPopup.summary && (
          <div className="sync-popup-summary">
            <Cloud size={12} style={{ flexShrink: 0 }} />
            <span>{syncPopup.summary}</span>
          </div>
        )}
      </div>
    </div>
  );
};
