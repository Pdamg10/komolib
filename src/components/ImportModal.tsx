import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  Globe,
  Images,
  Layers,
  RefreshCw,
  Smartphone,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ACCEPTED_EXTENSIONS } from '../parsers';
import {
  checkServerHealth,
  deleteInboxFile,
  downloadInboxFile,
  fetchFileFromDirectUrl,
  listInboxFiles,
  resolveServerUrl,
  type InboxItem,
  type ServerHealth,
} from '../services/syncService';
import type { ContentKind } from '../types/library';
import {
  extractFilesFromDataTransfer,
  filterSupportedFiles,
  getFolderPath,
  getRelativePath,
  groupImagesByFolder,
  isImageFile,
  type FileWithRelPath,
} from '../utils/fileFolderImport';
import { generateQrSvgPath } from '../utils/qrCodeSvg';

type ImportMode = 'local' | 'device';

export const ImportModal: React.FC = () => {
  const {
    importModalOpen,
    setImportModalOpen,
    importFiles,
    categories,
    syncConfig,
    updateSyncConfig,
    triggerSync,
    syncStatus,
    showToast,
  } = useLibrary();

  const [mode, setMode] = useState<ImportMode>('local');
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileWithRelPath[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [bundleImages, setBundleImages] = useState(true);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [kind, setKind] = useState<ContentKind | 'auto'>('auto');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  // Device transfer state
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [serverChecking, setServerChecking] = useState(false);
  const [serverError, setServerError] = useState('');
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [importingInbox, setImportingInbox] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [directUrl, setDirectUrl] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const imageFiles = useMemo(() => files.filter((f) => isImageFile(f)), [files]);
  const hasMultipleImages = imageFiles.length > 1;
  const imageFolderGroups = useMemo(() => groupImagesByFolder(imageFiles), [imageFiles]);
  const folderCount = useMemo(() => {
    const folders = new Set(files.map((f) => getFolderPath(f)).filter(Boolean));
    return folders.size;
  }, [files]);

  const uploadUrl = useMemo(() => {
    const publicBase = (syncConfig.publicUrl || serverHealth?.publicUrl || '')
      .trim()
      .replace(/\/+$/, '');
    const base =
      (publicBase ? `${publicBase}/upload` : '') ||
      serverHealth?.uploadUrls?.[0] ||
      (resolveServerUrl(syncConfig.serverUrl)
        ? `${resolveServerUrl(syncConfig.serverUrl)}/upload`
        : '');
    if (!base) return '';
    if (syncConfig.token.trim()) {
      return `${base}?token=${encodeURIComponent(syncConfig.token.trim())}`;
    }
    return base;
  }, [serverHealth, syncConfig.publicUrl, syncConfig.serverUrl, syncConfig.token]);

  const qrSvg = useMemo(() => (uploadUrl ? generateQrSvgPath(uploadUrl) : null), [uploadUrl]);

  const refreshDeviceInbox = useCallback(
    async (silent = false) => {
      if (!syncConfig.serverUrl.trim()) {
        setServerHealth(null);
        setServerError('Configura la URL del servidor KomoLib.');
        return;
      }
      if (!silent) setServerChecking(true);
      try {
        const health = await checkServerHealth(syncConfig);
        setServerHealth(health);
        setServerError('');
        const items = await listInboxFiles(syncConfig);
        setInboxItems(items);
      } catch (err) {
        setServerHealth(null);
        setInboxItems([]);
        setServerError(
          err instanceof Error ? err.message : 'No se pudo conectar con el servidor local'
        );
      } finally {
        if (!silent) setServerChecking(false);
      }
    },
    [syncConfig]
  );

  useEffect(() => {
    if (!importModalOpen || mode !== 'device') return;
    refreshDeviceInbox(false);
    const timer = window.setInterval(() => {
      refreshDeviceInbox(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [importModalOpen, mode, refreshDeviceInbox]);

  if (!importModalOpen) return null;

  const applySelectedFiles = (rawList: File[]) => {
    const { supported, skippedCount: skipped } = filterSupportedFiles(rawList);
    setFiles(supported);
    setSkippedCount(skipped);
    if (!supported.length && rawList.length > 0) {
      showToast('No se encontraron archivos compatibles en la selección');
    }
  };

  const handleSelectFiles = (list: FileList | null) => {
    if (!list) return;
    applySelectedFiles(Array.from(list));
  };

  const toggleCat = (id: string) => {
    setSelectedCats((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const resetLocalForm = () => {
    setFiles([]);
    setSkippedCount(0);
    setTitle('');
    setAuthor('');
    setKind('auto');
    setSelectedCats([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleConfirm = async () => {
    if (!files.length || importing) return;
    setImporting(true);
    try {
      await importFiles(files, {
        bundleImages: hasMultipleImages && bundleImages,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        kind: kind === 'auto' ? undefined : kind,
        categories: selectedCats,
      });
      resetLocalForm();
      setImportModalOpen(false);
    } finally {
      setImporting(false);
    }
  };

  const handleCopyUploadUrl = async () => {
    if (!uploadUrl) return;
    try {
      await navigator.clipboard.writeText(uploadUrl);
      setCopiedUrl(true);
      showToast('Enlace copiado al portapapeles');
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      showToast('No se pudo copiar automáticamente');
    }
  };

  const handleImportInboxItems = async (targets: InboxItem[]) => {
    if (!targets.length || importingInbox) return;
    setImportingInbox(true);
    try {
      const downloaded: FileWithRelPath[] = [];
      for (const item of targets) {
        const f = await downloadInboxFile(syncConfig, item);
        downloaded.push(f);
      }

      const firstKind = targets[0]?.kind;
      const resolvedKind = firstKind && firstKind !== 'auto' ? firstKind : undefined;
      const firstAuthor = targets[0]?.author || undefined;
      const imgsCount = downloaded.filter((f) => isImageFile(f)).length;

      await importFiles(downloaded, {
        bundleImages: imgsCount > 1,
        kind: resolvedKind,
        author: firstAuthor,
      });

      for (const item of targets) {
        await deleteInboxFile(syncConfig, item.id);
      }
      await refreshDeviceInbox(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al importar desde otro dispositivo');
    } finally {
      setImportingInbox(false);
    }
  };

  const handleDiscardInboxItem = async (id: string) => {
    await deleteInboxFile(syncConfig, id);
    setInboxItems((prev) => prev.filter((x) => x.id !== id));
  };

  const handleImportFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directUrl.trim() || fetchingUrl) return;
    setFetchingUrl(true);
    try {
      const file = await fetchFileFromDirectUrl(directUrl);
      await importFiles([file]);
      setDirectUrl('');
      setImportModalOpen(false);
    } catch (err) {
      showToast(
        err instanceof Error
          ? `No se pudo descargar el enlace: ${err.message}`
          : 'No se pudo importar desde esa URL'
      );
    } finally {
      setFetchingUrl(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setImportModalOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Importar Libros, Mangas y Manhwas
          </h3>
          <button className="circle-arrow-btn" onClick={() => setImportModalOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {/* Source Switcher Tabs */}
        <div className="import-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'local'}
            className={`import-tab-btn ${mode === 'local' ? 'active' : ''}`}
            onClick={() => setMode('local')}
          >
            <FolderOpen size={15} /> Archivos / Carpeta
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'device'}
            className={`import-tab-btn ${mode === 'device' ? 'active' : ''}`}
            onClick={() => setMode('device')}
          >
            <Smartphone size={15} /> Otro dispositivo
            {inboxItems.length > 0 && (
              <span
                style={{
                  background: 'var(--accent-primary)',
                  color: 'var(--accent-contrast)',
                  borderRadius: 999,
                  padding: '1px 6px',
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {inboxItems.length}
              </span>
            )}
          </button>
        </div>

        {mode === 'local' ? (
          <>
            <div
              className={`dropzone ${dragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragging(false);
                const extracted = await extractFilesFromDataTransfer(e.dataTransfer);
                applySelectedFiles(extracted);
              }}
            >
              <Upload size={32} style={{ color: 'var(--accent-primary)', marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
                Arrastra archivos o una carpeta completa aquí
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                EPUB · PDF · CBZ · CBR · ZIP · RAR · MOBI · AZW3 · FB2 · DOCX · TXT · MD · HTML · MP3/M4B · Imágenes
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 14,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="pill-btn"
                  style={{ background: 'var(--card-bg)', height: 36 }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp size={14} /> Elegir archivos
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  style={{
                    background: 'var(--accent-secondary)',
                    color: 'var(--accent-secondary-contrast)',
                    borderColor: 'transparent',
                    height: 36,
                  }}
                  onClick={() => folderInputRef.current?.click()}
                >
                  <FolderOpen size={14} /> Elegir carpeta
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                hidden
                onChange={(e) => handleSelectFiles(e.target.files)}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                hidden
                {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => handleSelectFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div
                style={{
                  background: 'var(--banner-bg)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 14,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileUp size={14} /> {files.length} archivo(s) compatible(s)
                    {folderCount > 0 ? ` en ${folderCount} carpeta(s)` : ''}
                  </span>
                  <button
                    type="button"
                    className="pill-btn"
                    style={{ height: 24, fontSize: 10.5, padding: '0 9px' }}
                    onClick={resetLocalForm}
                  >
                    Limpiar
                  </button>
                </div>
                {skippedCount > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Se omitieron {skippedCount} archivo(s) no soportados o del sistema.
                  </div>
                )}
                <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {files.slice(0, 50).map((f, i) => (
                    <div key={i}>
                      • {getRelativePath(f)} ({(f.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  ))}
                  {files.length > 50 && <div>... y {files.length - 50} archivo(s) más</div>}
                </div>
              </div>
            )}

            {hasMultipleImages && (
              <div
                className="toggle-row"
                style={{
                  background: 'var(--banner-bg)',
                  border: '1px solid var(--border-subtle)',
                  padding: '10px 12px',
                  borderRadius: 12,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Images size={15} />
                  {imageFolderGroups.length > 1
                    ? `Agrupar imágenes por subcarpeta (${imageFolderGroups.length} volúmenes)`
                    : 'Unir imágenes en un solo volumen de Manga / Manhwa'}
                </span>
                <button
                  type="button"
                  className={`switch ${bundleImages ? 'on' : ''}`}
                  onClick={() => setBundleImages(!bundleImages)}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Tipo de lectura
                </label>
                <select
                  className="studio-input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ContentKind | 'auto')}
                >
                  <option value="auto">Auto-detectar por archivo</option>
                  <option value="book">Libro / Novela</option>
                  <option value="manga">Manga (Derecha → Izquierda)</option>
                  <option value="manhwa">Manhwa / Webtoon (Tira vertical)</option>
                  <option value="comic">Cómic (Izquierda → Derecha)</option>
                  <option value="audiobook">Audiolibro</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Autor (opcional)
                </label>
                <input
                  className="studio-input"
                  placeholder="Auto o nombre del autor"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
            </div>

            {(files.length === 1 ||
              (hasMultipleImages && bundleImages && imageFolderGroups.length === 1)) && (
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Título personalizado (opcional)
                </label>
                <input
                  className="studio-input"
                  placeholder="Déjalo vacío para extraer del archivo o carpeta"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            )}

            <div>
              <label
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  marginBottom: 6,
                }}
              >
                <Layers size={13} /> Categorías adicionales
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {categories
                  .filter((c) => c.id !== 'all')
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`pill-btn ${selectedCats.includes(c.id) ? 'active' : ''}`}
                      style={{ height: 28, fontSize: 11 }}
                      onClick={() => toggleCat(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button className="pill-btn" onClick={() => setImportModalOpen(false)}>
                Cancelar
              </button>
              <button
                className="coral-cta-btn"
                disabled={!files.length || importing}
                onClick={handleConfirm}
              >
                {importing ? 'Procesando archivos...' : `Importar (${files.length})`}
              </button>
            </div>
          </>
        ) : (
          /* Device-to-device & Direct URL Import Tab */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Server connection row */}
            <div
              style={{
                background: 'var(--banner-bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 16,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {serverHealth ? (
                    <Wifi size={14} style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <WifiOff size={14} style={{ color: 'var(--text-muted)' }} />
                  )}
                  Recepción por Wi-Fi / Red Local
                </span>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ height: 27, fontSize: 11, background: 'var(--card-bg)' }}
                  onClick={() => refreshDeviceInbox(false)}
                  disabled={serverChecking}
                >
                  <RefreshCw size={12} className={serverChecking ? 'spin' : ''} /> Actualizar
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="studio-input"
                  placeholder="http://localhost:4123 o http://192.168.x.x:4123"
                  value={syncConfig.serverUrl}
                  onChange={(e) => updateSyncConfig({ serverUrl: e.target.value })}
                />
                <button
                  type="button"
                  className="pill-btn"
                  style={{ flexShrink: 0, height: 35, background: 'var(--card-bg)' }}
                  onClick={() => triggerSync(false)}
                  disabled={syncStatus === 'syncing' || !serverHealth}
                  title="Sincronizar biblioteca completa con otro dispositivo KomoLib"
                >
                  <RefreshCw size={12} className={syncStatus === 'syncing' ? 'spin' : ''} /> Sync
                </button>
              </div>
            </div>

            {serverHealth ? (
              <>
                <div className="device-qr-card">
                  {qrSvg && (
                    <div className="device-qr-box" title="Escanea con tu celular o tablet">
                      <svg
                        viewBox={`-2 -2 ${qrSvg.size + 4} ${qrSvg.size + 4}`}
                        width="110"
                        height="110"
                        shapeRendering="crispEdges"
                      >
                        <rect
                          x="-2"
                          y="-2"
                          width={qrSvg.size + 4}
                          height={qrSvg.size + 4}
                          fill="#ffffff"
                        />
                        <path d={qrSvg.path} fill="#161616" />
                      </svg>
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>
                      Escanea el QR o abre este enlace en tu celular / otra PC:
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '7px 10px',
                        borderRadius: 10,
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-subtle)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {uploadUrl}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button
                        type="button"
                        className="pill-btn"
                        style={{ height: 29, fontSize: 11, background: 'var(--card-bg)' }}
                        onClick={handleCopyUploadUrl}
                      >
                        {copiedUrl ? <Check size={12} /> : <Copy size={12} />}
                        {copiedUrl ? 'Copiado' : 'Copiar enlace'}
                      </button>
                      <a
                        href={uploadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="pill-btn"
                        style={{
                          height: 29,
                          fontSize: 11,
                          background: 'var(--card-bg)',
                          textDecoration: 'none',
                        }}
                      >
                        <ExternalLink size={12} /> Abrir página de envío
                      </a>
                    </div>
                  </div>
                </div>

                {/* Received Files Inbox */}
                <div
                  style={{
                    background: 'var(--banner-bg)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 16,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                      Bandeja recibida ({inboxItems.length})
                    </span>
                    {inboxItems.length > 0 && (
                      <button
                        type="button"
                        className="coral-cta-btn"
                        style={{ height: 30, padding: '0 14px', fontSize: 11.5 }}
                        disabled={importingInbox}
                        onClick={() => handleImportInboxItems(inboxItems)}
                      >
                        <Download size={13} />
                        {importingInbox ? 'Importando...' : `Importar todo (${inboxItems.length})`}
                      </button>
                    )}
                  </div>

                  {inboxItems.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      Esperando archivos... Cuando envíes libros, mangas o carpetas desde otro dispositivo usando el enlace o QR, aparecerán aquí automáticamente.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 170, overflowY: 'auto' }}>
                      {inboxItems.map((item) => (
                        <div key={item.id} className="inbox-row">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={item.relativePath || item.originalName}
                            >
                              {item.relativePath || item.originalName}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                              {item.deviceName || 'Dispositivo'} · {(item.size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            <button
                              type="button"
                              className="pill-btn"
                              style={{
                                height: 28,
                                fontSize: 11,
                                background: 'var(--accent-primary)',
                                color: 'var(--accent-contrast)',
                                borderColor: 'transparent',
                              }}
                              disabled={importingInbox}
                              onClick={() => handleImportInboxItems([item])}
                            >
                              <Download size={12} /> Importar
                            </button>
                            <button
                              type="button"
                              className="circle-arrow-btn"
                              style={{ width: 28, height: 28 }}
                              onClick={() => handleDiscardInboxItem(item.id)}
                              title="Descartar archivo"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  background: 'var(--banner-bg)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 16,
                  padding: 14,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--text-muted)',
                }}
              >
                <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Servidor local no detectado ({serverError || 'sin conexión'})
                </div>
                Para recibir archivos desde tu celular, tablet u otra PC por Wi-Fi, inicia el servidor con{' '}
                <code
                  style={{
                    background: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    padding: '2px 6px',
                    borderRadius: 6,
                    fontWeight: 700,
                  }}
                >
                  npm run dev:server
                </code>{' '}
                y pulsa <strong>Actualizar</strong>.
              </div>
            )}

            {/* Direct URL Import (works even without Node server) */}
            <form
              onSubmit={handleImportFromUrl}
              style={{
                background: 'var(--banner-bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 16,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <label style={{ fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Globe size={14} /> O importar desde un enlace directo (URL)
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="studio-input"
                  type="url"
                  placeholder="https://ejemplo.com/libro.epub o .pdf / .cbz"
                  value={directUrl}
                  onChange={(e) => setDirectUrl(e.target.value)}
                />
                <button
                  type="submit"
                  className="coral-cta-btn"
                  style={{ height: 36, padding: '0 16px', flexShrink: 0 }}
                  disabled={!directUrl.trim() || fetchingUrl}
                >
                  {fetchingUrl ? 'Descargando...' : 'Traer'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
