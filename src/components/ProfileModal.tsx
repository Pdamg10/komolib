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
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [emailInput, setEmailInput] = useState(profile.email || syncConfig.accountEmail || '');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profileModalOpen) {
      setEmailInput(profile.email || syncConfig.accountEmail || '');
      setPinError('');
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

  const requirePinOrWarn = (): boolean => {
    if (!pinInput.trim()) {
      setPinError('Se requiere PIN');
      showToast('Se requiere PIN');
      pinInputRef.current?.focus();
      return false;
    }
    setPinError('');
    return true;
  };

  const handleConnectEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || busy) return;
    if (!requirePinOrWarn()) return;
    setBusy(true);
    try {
      await loginWithEmail(emailInput, pinInput);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNow = async () => {
    if (busy) return;
    if (!requirePinOrWarn()) return;
    const targetEmail = (emailInput.trim() || linkedEmail).toLowerCase();
    if (!targetEmail) {
      showToast('Ingresa tu correo electrónico o nombre de usuario');
      return;
    }
    setBusy(true);
    try {
      const derivedSpace = deriveEmailSpaceId(targetEmail, pinInput);
      if (syncConfig.spaceId === derivedSpace && syncConfig.accountEmail === targetEmail) {
        await triggerSync(false);
      } else {
        await loginWithEmail(targetEmail, pinInput);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSyncOfflineFiles = async () => {
    if (busy || offlineSyncProgress) return;
    if (!requirePinOrWarn()) return;
    const targetEmail = (emailInput.trim() || linkedEmail).toLowerCase();
    if (targetEmail) {
      const derivedSpace = deriveEmailSpaceId(targetEmail, pinInput);
      if (syncConfig.spaceId !== derivedSpace || syncConfig.accountEmail !== targetEmail) {
        const ok = await loginWithEmail(targetEmail, pinInput);
        if (!ok) return;
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
  const linkedEmail = syncConfig.accountEmail || profile.email || '';
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

        {/* Cloud Account by Email + Automatic Backup */}
        <div
          style={{
            background: 'var(--banner-bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cloud size={15} style={{ color: 'var(--accent-primary)' }} />
              Cuenta en la Nube y Respaldo por Correo
            </div>
            {linkedEmail && (
              <span
                className="pill-btn"
                style={{
                  height: 24,
                  fontSize: 10.5,
                  padding: '0 9px',
                  background: 'color-mix(in srgb, #52b788 18%, var(--card-bg))',
                  color: 'var(--text-primary)',
                }}
              >
                <CheckCircle2 size={11} style={{ color: '#2d936c' }} /> {linkedEmail}
              </span>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Ingresa tu correo electrónico y tu PIN para guardar o sincronizar tus libros, progreso, marcas y personalización desde cualquier navegador, APK o internet.
          </div>

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
                API de KomoLib. Sin esa variable el respaldo por correo no puede guardarse en la
                nube.
              </span>
            </div>
          )}

          <form onSubmit={handleConnectEmail} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 210px' }}>
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
                  placeholder="tucorreo@ejemplo.com o usuario (ej. Sakura)"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  required
                />
              </div>
              <input
                ref={pinInputRef}
                type="password"
                className="studio-input"
                style={{
                  flex: '1 1 110px',
                  minWidth: 0,
                  borderColor: pinError ? '#d9534f' : undefined,
                }}
                placeholder="PIN"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  if (pinError && e.target.value.trim()) setPinError('');
                }}
                title="PIN obligatorio para guardar y sincronizar tu bóveda en la nube"
              />
            </div>

            {pinError && (
              <div
                role="alert"
                style={{
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: '#d9534f',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <AlertTriangle size={13} /> {pinError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button
                type="submit"
                className="coral-cta-btn"
                disabled={busy}
                style={{ flex: 1, height: 34, fontSize: 12, justifyContent: 'center' }}
              >
                <Cloud size={14} />{' '}
                {busy
                  ? 'Sincronizando cuenta...'
                  : linkedEmail && linkedEmail === emailInput.trim().toLowerCase()
                  ? 'Actualizar / Restaurar desde la nube'
                  : 'Conectar / Restaurar con mi correo'}
              </button>

              {linkedEmail && (
                <button
                  type="button"
                  className="pill-btn"
                  disabled={busy}
                  style={{ height: 34, fontSize: 11.5 }}
                  onClick={() => void handleSaveNow()}
                  title="Guardar copia en la nube ahora (requiere PIN)"
                >
                  <RefreshCw size={13} /> Guardar ahora
                </button>
              )}
            </div>
          </form>

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

          {syncStatus === 'error' && SYNC_SERVER_URL && savedServer && savedServer !== SYNC_SERVER_URL && (
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

          {linkedEmail && books.length > 0 && (
            <div
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '9px 11px',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 800 }}>
                  Lectura sin internet en este dispositivo
                </span>
                <span className="section-count" style={{ fontSize: 10.5 }}>
                  {books.filter((b) => b.hasLocalFile).length} / {books.length} guardados offline
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Sube los libros locales de este equipo a tu cuenta y descarga los que subiste desde tu tablet/teléfono para abrirlos siempre, con o sin internet.
              </div>
              <button
                type="button"
                className="pill-btn"
                style={{
                  height: 32,
                  justifyContent: 'center',
                  background: 'var(--accent-secondary)',
                  color: 'var(--accent-secondary-contrast)',
                  borderColor: 'transparent',
                  fontSize: 11.5,
                }}
                disabled={Boolean(offlineSyncProgress) || busy}
                onClick={() => void handleSyncOfflineFiles()}
              >
                <Download size={13} />{' '}
                {offlineSyncProgress || 'Sincronizar archivos para leer offline'}
              </button>
            </div>
          )}

          {/* Local JSON Backup Export / Import & Logout */}
          <div className="profile-backup-actions">
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

            {(linkedEmail || books.length > 0) && (
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
                  setPinInput('');
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
