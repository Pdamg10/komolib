import React, { useRef, useState } from 'react';
import { CloudDownload, FolderOpen, HardDrive, Smartphone, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ACCEPTED_EXTENSIONS } from '../parsers';
import { downloadBookFileFromGoogleDrive } from '../services/googleDriveService';
import { downloadBookFromServer, requestBookUploadFromPeer } from '../services/syncService';
import { BookCoverVisual } from './BookCoverVisual';

export const MissingFileModal: React.FC = () => {
  const {
    missingFileBook,
    setMissingFileBook,
    attachLocalFileToBook,
    updateBook,
    openBook,
    syncConfig,
    googleDriveAuth,
    deviceId,
    showToast,
  } = useLibrary();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'cloud' | 'local' | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!missingFileBook) return null;

  const book = missingFileBook;
  const hasDrive = Boolean(googleDriveAuth?.accessToken);
  const hasCloudAccount = hasDrive || Boolean(syncConfig.accountEmail && syncConfig.serverUrl?.trim());

  const handleRetryCloud = async () => {
    if (busy) return;
    setBusy('cloud');
    setErrorMsg('');
    setStatusMsg(hasDrive ? 'Descargando desde tu Google Drive...' : 'Buscando archivo en tu nube...');
    try {
      let downloaded = false;
      let resolvedDriveId = book.driveFileId;

      // 0. If connected to Google Drive, download directly from `Komolib/Libros` (0% Render traffic!)
      if (hasDrive && googleDriveAuth) {
        try {
          const res = await downloadBookFileFromGoogleDrive(syncConfig, googleDriveAuth, book);
          resolvedDriveId = res.driveFileId;
          downloaded = true;
        } catch {
          // Fall back to Render / peer relay if file was uploaded before connecting Drive
        }
      }

      // 1. Try direct Render cloud download if not yet downloaded from Drive
      if (!downloaded && syncConfig.serverUrl?.trim()) {
        try {
          await downloadBookFromServer(syncConfig, book);
          downloaded = true;
        } catch (firstErr) {
          const msg = firstErr instanceof Error ? firstErr.message : '';
          const isNotFound = msg.includes('404');
          if (!isNotFound && !hasDrive) {
            throw firstErr;
          }

          if (isNotFound) {
            setStatusMsg('Solicitando el libro a tu otro dispositivo conectado...');
            const reqRes = await requestBookUploadFromPeer(syncConfig, book, deviceId).catch(() => ({
              ok: false,
              peersNotified: 0,
              totalClients: 0,
            }));

            if (reqRes.peersNotified > 0) {
              for (let attempt = 1; attempt <= 12; attempt++) {
                setStatusMsg(
                  `Tu otro dispositivo está subiendo el archivo (${attempt * 2}s)...`
                );
                await new Promise((r) => setTimeout(r, 2000));
                try {
                  await downloadBookFromServer(syncConfig, book);
                  downloaded = true;
                  break;
                } catch {
                  // keep waiting while tablet uploads
                }
              }
            }
          }
        }
      }

      if (downloaded) {
        const readyBook = {
          ...book,
          hasLocalFile: true,
          hasRemoteFile: true,
          driveFileId: resolvedDriveId,
        };
        await updateBook(book.id, {
          hasLocalFile: true,
          hasRemoteFile: true,
          driveFileId: resolvedDriveId,
        });
        setMissingFileBook(null);
        await openBook(readyBook);
        return;
      }

      setErrorMsg(
        hasDrive
          ? 'Este libro aún no está en tu carpeta Google Drive / Komolib / Libros. En tu tablet, pulsa "Sincronizar libros con Google Drive" en Perfil para subirlo.'
          : 'Este libro todavía no está subido en tu nube. Abre Komolib en tu tablet con internet y toca de nuevo este botón, o pulsa "Sincronizar archivos para leer offline" en Perfil de tu tablet.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con tu cuenta en la nube en este momento.'
      );
    } finally {
      setBusy(null);
      setStatusMsg('');
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
              {busy === 'cloud'
                ? statusMsg || 'Descargando...'
                : hasDrive
                ? 'Descargar desde mi Google Drive'
                : 'Descargar desde mi cuenta en la nube'}
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
