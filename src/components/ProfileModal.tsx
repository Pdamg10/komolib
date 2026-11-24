import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cloud,
  Download,
  Flame,
  FolderUp,
  LogOut,
  Mail,
  RefreshCw,
  Share2,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { SYNC_SERVER_URL } from '../config';
import { deriveEmailSpaceId } from '../services/syncService';
import {
  pickExternalBackupNatively,
  supportsNativeBackupPicker,
} from '../utils/nativeBridge';

const EMOJIS = ['🦊', '🐱', '🦉', '🐻', '🌸', '📚', '✨', '🧙', '🎧', '🐉'];

export const ProfileModal: React.FC = () => {
  const {
    profileModalOpen,
    setProfileModalOpen,
    profile,
    updateProfile,
    syncConfig,
    updateSyncConfig,
    syncStatus,
    syncMessage,
    offlineSyncProgress,
    triggerSync,
    syncAllBookFilesForOffline,
    googleDriveAuth,
    connectGoogleDrive,
    disconnectGoogleDrive,
    refreshServerHealth,
    loginWithEmail,
    logoutAccount,
    exportBackupJson,
    shareBackupJson,
    importBackupJson,
    showToast,
    books,
    duplicateBooksCount,
    removeDuplicateBooks,
    bookmarks,
    annotations,
    notes,
  } = useLibrary();

  const imgRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [emailInput, setEmailInput] = useState(profile.email || syncConfig.accountEmail || '');
  const [showEmailFallback, setShowEmailFallback] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profileModalOpen) {
      setEmailInput(profile.email || syncConfig.accountEmail || '');
      setShowEmailFallback(false);
    }
  }, [profileModalOpen, profile.email, syncConfig.accountEmail]);

  if (!profileModalOpen) return null;

  const compressAvatarImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => {
        const rawUrl = String(reader.result || '');
        const img = new Image();
        img.onerror = () => resolve(rawUrl);
        img.onload = () => {
          const outSize = 256;
          const iw = img.width || 1;
          const ih = img.height || 1;
          const crop = Math.min(iw, ih);
          const sx = Math.round((iw - crop) / 2);
          const sy = Math.round((ih - crop) / 2);
          const canvas = document.createElement('canvas');
          canvas.width = outSize;
          canvas.height = outSize;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawUrl);
            return;
          }
          ctx.drawImage(img, sx, sy, crop, crop, 0, 0, outSize, outSize);
          try {
            const webp = canvas.toDataURL('image/webp', 0.82);
            if (webp.startsWith('data:image/webp')) {
              resolve(webp);
              return;
            }
          } catch {
            // fallback to jpeg
          }
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const optimized = await compressAvatarImage(file);
      updateProfile({ avatarImageUrl: optimized });
    } catch {
      // ignore invalid file
    } finally {
      e.target.value = '';
    }
  };

  const handleConnectEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || busy) return;
    setBusy(true);
    try {
      await loginWithEmail(emailInput);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNow = async () => {
    if (busy) return;
    const targetEmail = (emailInput.trim() || linkedEmail).toLowerCase();
    if (!targetEmail) {
      showToast('Ingresa tu correo electrónico o nombre de usuario');
      return;
    }
    setBusy(true);
    try {
      const derivedSpace = deriveEmailSpaceId(targetEmail, '');
      if (syncConfig.spaceId === derivedSpace && syncConfig.accountEmail === targetEmail) {
        await triggerSync(false);
      } else {
        await loginWithEmail(targetEmail);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSyncOfflineFiles = async () => {
    if (busy || offlineSyncProgress) return;
    if (!isDriveConnected) {
      const targetEmail = (emailInput.trim() || linkedEmail).toLowerCase();
      if (targetEmail) {
        const derivedSpace = deriveEmailSpaceId(targetEmail, '');
        if (syncConfig.spaceId !== derivedSpace || syncConfig.accountEmail !== targetEmail) {
          const ok = await loginWithEmail(targetEmail);
          if (!ok) return;
        }
      }
    }
    await syncAllBookFilesForOffline();
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importBackupJson(file);
    e.target.value = '';
  };

  const handleImportBackupClick = async () => {
    if (supportsNativeBackupPicker()) {
      try {
        showToast('Abriendo selector seguro de copias...');
        const picked = await pickExternalBackupNatively((info) => {
          showToast(`Leyendo ${info.fileName || 'copia'}...`);
        });
        if (!picked) return;
        await importBackupJson(picked.file);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'No se pudo leer el archivo seleccionado');
      }
      return;
    }
    backupFileRef.current?.click();
  };

  const completed = books.filter((b) => b.progress >= 98).length;
  const favorites = books.filter((b) => b.favorite).length;
  const localFilesCount = books.filter((b) => b.hasLocalFile).length;
  const isDriveConnected = Boolean(googleDriveAuth?.email);
  const linkedEmail = syncConfig.accountEmail || profile.email || '';
  const isCloudConnected = isDriveConnected || Boolean(linkedEmail);
  const showEmailForm = !isDriveConnected && (Boolean(linkedEmail) || showEmailFallback);
  const appOrigin = typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '';
  const savedServer = syncConfig.serverUrl.trim().replace(/\/+$/, '');
  const cloudServerMissing =
    typeof window !== 'undefined' &&
    !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) &&
    !SYNC_SERVER_URL &&
    (!savedServer || savedServer === appOrigin);

  return (
    <div className="modal-overlay" onClick={() => setProfileModalOpen(false)}>
      <div
        className="modal-card"
        style={{ maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Tu Perfil y Cuenta en la Nube
          </h3>
          <button className="circle-arrow-btn" onClick={() => setProfileModalOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {/* Avatar & Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            className="avatar-btn"
            style={{ width: 64, height: 64, fontSize: 30, background: profile.avatarBg }}
          >
            {profile.avatarImageUrl ? (
              <img src={profile.avatarImageUrl} alt={profile.name} />
            ) : (
              <span>{profile.avatarEmoji}</span>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="studio-input"
              value={profile.name}
              onChange={(e) => updateProfile({ name: e.target.value })}
              placeholder="Tu nombre"
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="pill-btn" onClick={() => imgRef.current?.click()}>
                <Upload size={12} /> Subir foto
              </button>
              {profile.avatarImageUrl && (
                <button
                  className="pill-btn"
                  onClick={() => updateProfile({ avatarImageUrl: undefined })}
                >
                  Usar emoji
                </button>
              )}
              <input ref={imgRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className="circle-arrow-btn"
              style={{
                width: 36,
                height: 36,
                fontSize: 19,
                padding: 0,
                lineHeight: 1,
                background:
                  !profile.avatarImageUrl && profile.avatarEmoji === em
                    ? 'var(--accent-secondary)'
                    : 'var(--banner-bg)',
              }}
              onClick={() => updateProfile({ avatarEmoji: em, avatarImageUrl: undefined })}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                {em}
              </span>
            </button>
          ))}
        </div>

        {/* Unified Cloud & Sync Card (Google Drive primary, Email fallback) */}
        <div
          style={{
            background: isDriveConnected
              ? 'color-mix(in srgb, var(--accent-secondary) 9%, var(--banner-bg))'
              : 'var(--banner-bg)',
            border: isDriveConnected
              ? '1px solid color-mix(in srgb, var(--accent-secondary) 36%, var(--border-subtle))'
              : '1px solid var(--border-subtle)',
            borderRadius: 16,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cloud size={15} style={{ color: isDriveConnected ? 'var(--accent-secondary)' : 'var(--accent-primary)' }} />
              Nube y Sincronización
            </div>
            {(isDriveConnected ? googleDriveAuth?.email : linkedEmail) && (
              <span
                className="pill-btn"
                style={{
                  height: 24,
                  fontSize: 10.5,
                  padding: '0 9px',
                  background: 'color-mix(in srgb, #52b788 18%, var(--card-bg))',
                  color: 'var(--text-primary)',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={isDriveConnected ? `Google Drive: ${googleDriveAuth?.email}` : linkedEmail}
              >
                <CheckCircle2 size={11} style={{ color: '#2d936c', flexShrink: 0 }} />
                {isDriveConnected ? `Drive · ${googleDriveAuth?.email}` : linkedEmail}
              </span>
            )}
          </div>

          {isDriveConnected ? (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Sincronizado con tu carpeta <strong>Google Drive / Komolib / Libros</strong> (15 GB gratis).
              </div>

              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="coral-cta-btn"
                  disabled={busy}
                  style={{ flex: '1 1 170px', height: 35, fontSize: 12, justifyContent: 'center' }}
                  onClick={async () => {
                    if (busy) return;
                    setBusy(true);
                    try {
                      await triggerSync(false);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RefreshCw size={13} /> {busy ? 'Sincronizando...' : 'Guardar / Sincronizar ahora'}
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ height: 35, fontSize: 11.5, color: '#c92a2a', background: 'var(--card-bg)' }}
                  onClick={() => void disconnectGoogleDrive()}
                >
                  <LogOut size={12} /> Desconectar
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {linkedEmail
                  ? 'Sincronizado por correo. También puedes cambiar a Google Drive para guardar tus libros en tu propio espacio (15 GB gratis).'
                  : 'Sincroniza tus libros, portadas, progreso, marcas y personalización entre tu tablet, teléfono y web.'}
              </div>

              <button
                type="button"
                className={linkedEmail ? 'pill-btn' : 'coral-cta-btn'}
                style={{
                  height: linkedEmail ? 33 : 38,
                  justifyContent: 'center',
                  fontSize: linkedEmail ? 11.5 : 12.5,
                  ...(linkedEmail ? { background: 'var(--card-bg)' } : {}),
                }}
                onClick={() => connectGoogleDrive()}
              >
                <Cloud size={15} />{' '}
                {linkedEmail
                  ? 'Cambiar a Google Drive (15 GB gratis)'
                  : 'Conectar con Google Drive (15 GB gratis)'}
              </button>

              {!showEmailForm ? (
                <button
                  type="button"
                  className="pill-btn"
                  style={{
                    height: 28,
                    fontSize: 11,
                    justifyContent: 'center',
                    background: 'transparent',
                    borderStyle: 'dashed',
                    color: 'var(--text-muted)',
                  }}
                  onClick={() => setShowEmailFallback(true)}
                >
                  <Mail size={12} /> ¿Sin Google? Usar correo
                </button>
              ) : (
                <>
                  {cloudServerMissing && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 7,
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'color-mix(in srgb, #d9534f 10%, var(--card-bg))',
                        border: '1px solid color-mix(in srgb, #d9534f 30%, var(--border-subtle))',
                        fontSize: 11,
                        lineHeight: 1.45,
                      }}
                    >
                      <AlertTriangle size={14} style={{ color: '#d9534f', flexShrink: 0, marginTop: 1 }} />
                      <span>
                        Falta configurar <strong>VITE_SYNC_SERVER_URL</strong> en Netlify con la URL del
                        API de KomoLib.
                      </span>
                    </div>
                  )}

                  <form onSubmit={handleConnectEmail} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ position: 'relative' }}>
                      <Mail
                        size={14}
                        style={{
                          position: 'absolute',
                          left: 11,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--text-muted)',
                        }}
                      />
                      <input
                        type="text"
                        className="studio-input"
                        style={{ paddingLeft: 32, width: '100%' }}
                        placeholder="tucorreo@ejemplo.com o usuario"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        required
                      />
                    </div>

                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                      <button
                        type="submit"
                        className="coral-cta-btn"
                        disabled={busy}
                        style={{ flex: 1, height: 34, fontSize: 12, justifyContent: 'center' }}
                      >
                        <Cloud size={14} />{' '}
                        {busy
                          ? 'Sincronizando...'
                          : linkedEmail && linkedEmail === emailInput.trim().toLowerCase()
                          ? 'Actualizar / Restaurar'
                          : 'Conectar con correo'}
                      </button>

                      {linkedEmail && (
                        <button
                          type="button"
                          className="pill-btn"
                          disabled={busy}
                          style={{ height: 34, fontSize: 11.5 }}
                          onClick={() => void handleSaveNow()}
                          title="Guardar copia en la nube ahora"
                        >
                          <RefreshCw size={13} /> Guardar ahora
                        </button>
                      )}
                    </div>
                  </form>
                </>
              )}
            </>
          )}

          {syncMessage && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: syncStatus === 'error' ? '#d9534f' : 'var(--accent-primary)',
                lineHeight: 1.45,
                wordBreak: 'break-word',
              }}
            >
              {syncMessage}
            </div>
          )}

          {syncStatus === 'error' && !isDriveConnected && SYNC_SERVER_URL && savedServer && savedServer !== SYNC_SERVER_URL && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="pill-btn"
                style={{ height: 24, fontSize: 10.5, padding: '0 9px', background: 'var(--card-bg)' }}
                onClick={async () => {
                  updateSyncConfig({ serverUrl: SYNC_SERVER_URL });
                  await refreshServerHealth();
                }}
              >
                Restablecer servidor oficial
              </button>
            </div>
          )}

          {isCloudConnected && books.length > 0 && (
            <button
              type="button"
              className="pill-btn"
              style={{
                height: 34,
                justifyContent: 'center',
                background: 'var(--accent-secondary)',
                color: 'var(--accent-secondary-contrast)',
                borderColor: 'transparent',
                fontSize: 11.5,
              }}
              disabled={Boolean(offlineSyncProgress) || busy}
              onClick={() =>
                void (isDriveConnected ? syncAllBookFilesForOffline() : handleSyncOfflineFiles())
              }
            >
              <Download size={13} />{' '}
              {offlineSyncProgress ||
                `Sincronizar libros offline (${localFilesCount}/${books.length} guardados)`}
            </button>
          )}

          {/* Local JSON Backup Export / Import & Logout */}
          <div
            className="profile-backup-actions"
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 10,
              marginTop: 2,
            }}
          >
            <button
              type="button"
              className="pill-btn"
              style={{ height: 29, fontSize: 11, background: 'var(--card-bg)' }}
              onClick={exportBackupJson}
            >
              <Download size={12} /> Guardar copia (.json)
            </button>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 29, fontSize: 11, background: 'var(--card-bg)' }}
              onClick={() => void shareBackupJson()}
              title="Enviar o guardar tu copia local en Drive, Telegram, WhatsApp o archivos"
            >
              <Share2 size={12} /> Compartir copia
            </button>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 29, fontSize: 11, background: 'var(--card-bg)' }}
              onClick={() => void handleImportBackupClick()}
              title="Restaura una copia de KomoLib (.json) o importa libros, progresos y marcadores de otra app"
            >
              <FolderUp size={12} /> Importar copia / otra app
            </button>
            <input
              ref={backupFileRef}
              type="file"
              accept="*/*"
              hidden
              onChange={handleRestoreFile}
            />

            {duplicateBooksCount > 0 && (
              <button
                type="button"
                className="pill-btn"
                style={{
                  height: 29,
                  fontSize: 11,
                  background: 'rgba(242, 186, 89, 0.18)',
                  borderColor: 'rgba(242, 186, 89, 0.6)',
                  color: 'var(--text-primary)',
                }}
                onClick={() => void removeDuplicateBooks()}
              >
                Limpiar {duplicateBooksCount} duplicado{duplicateBooksCount === 1 ? '' : 's'}
              </button>
            )}

            {(isCloudConnected || books.length > 0) && (
              <button
                type="button"
                className="pill-btn"
                style={{
                  height: 29,
                  fontSize: 11,
                  marginLeft: 'auto',
                  color: '#c92a2a',
                  background: 'var(--card-bg)',
                }}
                onClick={async () => {
                  await logoutAccount();
                  setEmailInput('');
                  setProfileModalOpen(false);
                }}
                title="Guarda tu copia en la nube y deja este dispositivo vacío como usuario nuevo"
              >
                <LogOut size={12} /> Salir en este dispositivo
              </button>
            )}
          </div>
        </div>

        {/* Reader Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            background: 'var(--banner-bg)',
            padding: 12,
            borderRadius: 16,
            textAlign: 'center',
          }}
        >
          <div>
            <BookOpen size={16} style={{ color: 'var(--accent-primary)' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>{books.length}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Títulos</div>
          </div>
          <div>
            <Star size={16} style={{ color: '#f2ba59' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>{favorites}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Favoritos</div>
          </div>
          <div>
            <Flame size={16} style={{ color: 'var(--accent-secondary)' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {completed + bookmarks.length + annotations.length + notes.length}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Actividad</div>
          </div>
        </div>
      </div>
    </div>
  );
};
