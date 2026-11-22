import React, { useRef, useState } from 'react';
import { CloudDownload, FolderOpen, HardDrive, Smartphone, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ACCEPTED_EXTENSIONS } from '../parsers';
import { BookCoverVisual } from './BookCoverVisual';

export const MissingFileModal: React.FC = () => {
  const {
    missingFileBook,
    setMissingFileBook,
    attachLocalFileToBook,
    openBook,
    syncConfig,
    showToast,
  } = useLibrary();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'cloud' | 'local' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!missingFileBook) return null;

  const book = missingFileBook;
  const hasCloudAccount = Boolean(syncConfig.accountEmail && syncConfig.serverUrl?.trim());

  const handleRetryCloud = async () => {
    if (busy) return;
    setBusy('cloud');
    setErrorMsg('');
    try {
      setMissingFileBook(null);
      await openBook({ ...book, hasRemoteFile: true });
    } catch {
      setErrorMsg('No se pudo descargar desde la nube en este momento.');
    } finally {
      setBusy(null);
    }
  };

  const handlePickLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setBusy('local');
    setErrorMsg('');
    try {
      const updated = await attachLocalFileToBook(book.id, file);
      if (updated) {
        setMissingFileBook(null);
        await openBook(updated);
      } else {
        showToast('No se pudo vincular el archivo seleccionado');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo guardar el archivo local.'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setMissingFileBook(null)}>
      <div
        className="modal-card"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Archivo del libro no descargado"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
            Archivo no guardado en este dispositivo
          </h3>
          <button
            type="button"
            className="circle-arrow-btn"
            onClick={() => setMissingFileBook(null)}
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--banner-bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: 11,
          }}
        >
          <div className="log-mini-thumb" style={{ width: 46, height: 66 }}>
            <BookCoverVisual book={book} compact />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.25 }}>{book.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--author-color)', marginTop: 2 }}>
              {book.author} · {book.format.toUpperCase()}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
              Progreso guardado: <strong>{Math.round(book.progress || 0)}%</strong>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          El registro de este libro ya está en tu biblioteca, pero el archivo (<code>.{book.format}</code>) todavía está solo en tu otro dispositivo o no se ha subido a tu cuenta.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hasCloudAccount && (
            <button
              type="button"
              className="coral-cta-btn"
              style={{ height: 38, justifyContent: 'center' }}
              disabled={busy !== null}
              onClick={handleRetryCloud}
            >
              <CloudDownload size={15} />{' '}
              {busy === 'cloud' ? 'Descargando...' : 'Descargar desde mi cuenta en la nube'}
            </button>
          )}

          <button
            type="button"
            className="pill-btn"
            style={{
              height: 38,
              justifyContent: 'center',
              background: 'var(--card-bg)',
              fontSize: 12,
            }}
            disabled={busy !== null}
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen size={14} />{' '}
            {busy === 'local'
              ? 'Guardando offline...'
              : 'Vincular archivo local en este dispositivo (sin internet)'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={`${ACCEPTED_EXTENSIONS},*/*`}
            hidden
            onChange={handlePickLocalFile}
          />
        </div>

        {errorMsg && (
          <div style={{ fontSize: 11.5, color: '#c92a2a', fontWeight: 700 }}>{errorMsg}</div>
        )}

        <div
          style={{
            background: 'var(--banner-bg)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 12,
            padding: '9px 11px',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.45,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, color: 'var(--text-primary)' }}>
            <Smartphone size={13} /> Cómo leer tus libros de la tablet en tu teléfono (incluso sin internet):
          </div>
          <div>
            1. En tu <strong>tablet</strong> (con conexión), abre <strong>Perfil → Sincronizar archivos para leer offline</strong> para subir tus libros a tu cuenta.
          </div>
          <div>
            2. En tu <strong>teléfono</strong>, pulsa ese mismo botón: se descargan una sola vez y quedan guardados en memoria local (<HardDrive size={10} style={{ verticalAlign: 'middle' }} />) para leer <strong>100% sin internet</strong>.
          </div>
        </div>
      </div>
    </div>
  );
};
