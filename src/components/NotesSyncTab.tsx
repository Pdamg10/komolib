import React, { useState } from 'react';
import {
  Bookmark,
  Bot,
  CheckCircle2,
  Cloud,
  Plus,
  RefreshCw,
  Server,
  StickyNote,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { checkServerHealth } from '../services/syncService';

export const NotesSyncTab: React.FC = () => {
  const {
    books,
    bookmarks,
    deleteBookmark,
    notes,
    addNote,
    deleteNote,
    openBook,
    syncConfig,
    updateSyncConfig,
    syncStatus,
    syncMessage,
    triggerSync,
    showToast,
  } = useLibrary();

  const [noteBookId, setNoteBookId] = useState(books[0]?.id || '');
  const [noteText, setNoteText] = useState('');
  const [healthInfo, setHealthInfo] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = noteBookId || books[0]?.id;
    if (!targetId || !noteText.trim()) return;
    await addNote({
      bookId: targetId,
      text: noteText.trim(),
      color: '#f5b855',
    });
    setNoteText('');
  };

  const handleTestServer = async () => {
    setTesting(true);
    setHealthInfo('');
    try {
      const res = await checkServerHealth(syncConfig);
      setHealthInfo(`Conectado ✓ (${res.booksCount} libros en servidor)`);
      showToast('Servidor KomoLib conectado');
    } catch (err) {
      setHealthInfo(`Sin conexión (${err instanceof Error ? err.message : 'error'})`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="right-panel-body">
      {/* Node.js Sync Backend Card */}
      <div className="studio-card">
        <h4>
          <Server size={14} /> Servidor de Sincronización (Node.js)
        </h4>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Sincroniza libros, progreso, marcadores y temas entre tu PC y tu APK Android en red local o VPS.
        </div>

        <input
          className="studio-input"
          placeholder="http://192.168.1.x:4123"
          value={syncConfig.serverUrl}
          onChange={(e) => updateSyncConfig({ serverUrl: e.target.value })}
        />
        <input
          className="studio-input"
          type="password"
          placeholder="Token opcional (KOMOLIB_TOKEN)"
          value={syncConfig.token}
          onChange={(e) => updateSyncConfig({ token: e.target.value })}
        />

        <div className="toggle-row">
          <span>Auto-subir nuevos archivos</span>
          <button
            type="button"
            className={`switch ${syncConfig.autoSync ? 'on' : ''}`}
            onClick={() => updateSyncConfig({ autoSync: !syncConfig.autoSync })}
          />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="pill-btn"
            style={{ flex: 1, justifyContent: 'center', background: 'var(--accent-primary)', color: '#fff' }}
            onClick={triggerSync}
            disabled={syncStatus === 'syncing'}
          >
            <RefreshCw size={13} className={syncStatus === 'syncing' ? 'spin' : ''} />
            {syncStatus === 'syncing' ? 'Sincronizando...' : 'Sincronizar ahora'}
          </button>
          <button className="pill-btn" onClick={handleTestServer} disabled={testing}>
            <Cloud size={13} /> Probar
          </button>
        </div>

        {(syncMessage || healthInfo) && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: syncStatus === 'error' ? '#c84b4e' : 'var(--text-primary)',
            }}
          >
            {syncStatus === 'error' ? <WifiOff size={13} /> : <CheckCircle2 size={13} />}
            <span>{healthInfo || syncMessage}</span>
          </div>
        )}
      </div>

      {/* Optional AI Endpoint */}
      <div className="studio-card">
        <h4>
          <Bot size={14} /> IA Opcional para el Chat (Ollama / OpenAI)
        </h4>
        <input
          className="studio-input"
          placeholder="Endpoint (ej: http://localhost:11434/v1/chat/completions)"
          value={syncConfig.aiEndpoint}
          onChange={(e) => updateSyncConfig({ aiEndpoint: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="studio-input"
            placeholder="Modelo (ej: llama3.2)"
            value={syncConfig.aiModel}
            onChange={(e) => updateSyncConfig({ aiModel: e.target.value })}
          />
          <input
            className="studio-input"
            type="password"
            placeholder="API Key"
            value={syncConfig.aiApiKey}
            onChange={(e) => updateSyncConfig({ aiApiKey: e.target.value })}
          />
        </div>
      </div>

      {/* Bookmarks */}
      <div className="studio-card">
        <h4>
          <Bookmark size={14} /> Marcadores ({bookmarks.length})
        </h4>
        {bookmarks.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Guarda marcadores mientras lees cualquier libro, manga o PDF.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {bookmarks.map((bm) => {
              const b = books.find((x) => x.id === bm.bookId);
              return (
                <div
                  key={bm.id}
                  style={{
                    background: 'var(--banner-bg)',
                    borderRadius: 12,
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <button
                    onClick={() => b && openBook(b)}
                    style={{ textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {b?.title || 'Título'}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{bm.label}</div>
                  </button>
                  <button
                    onClick={() => deleteBookmark(bm.id)}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="studio-card">
        <h4>
          <StickyNote size={14} /> Notas de Lectura ({notes.length})
        </h4>
        <form onSubmit={handleCreateNote} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select
            className="studio-input"
            value={noteBookId || books[0]?.id || ''}
            onChange={(e) => setNoteBookId(e.target.value)}
          >
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <textarea
            className="studio-input"
            rows={2}
            placeholder="Escribe una cita o idea sobre este libro..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <button
            type="submit"
            className="pill-btn"
            style={{ alignSelf: 'flex-end', background: 'var(--accent-secondary)', color: '#fff' }}
          >
            <Plus size={12} /> Guardar nota
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {notes.map((n) => {
            const b = books.find((x) => x.id === n.bookId);
            return (
              <div
                key={n.id}
                style={{
                  background: 'var(--banner-bg)',
                  borderLeft: `4px solid ${n.color || '#f5b855'}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--author-color)' }}>
                    {b?.title || 'Nota general'}
                  </span>
                  <button
                    onClick={() => deleteNote(n.id)}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>{n.text}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
