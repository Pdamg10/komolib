import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookOpen,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  Globe,
  Highlighter,
  Images,
  Layers,
  RefreshCw,
  Smartphone,
  StickyNote,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import {
  parseExternalBackupFile,
  type ParsedExternalBackup,
} from '../parsers/externalBackupParser';
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
import {
  pickExternalBackupNatively,
  pickLibraryFolderNatively,
  supportsNativeBackupPicker,
  supportsNativeFolderPicker,
} from '../utils/nativeBridge';

type ImportMode = 'local' | 'backup' | 'device';

export const ImportModal: React.FC = () => {
  const {
    importModalOpen,
    setImportModalOpen,
    books,
    importFiles,
    importNativeFolderBooks,
    duplicateBooksCount,
    removeDuplicateBooks,
    importExternalBackup,
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
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [cleaningDups, setCleaningDups] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [kind, setKind] = useState<ContentKind | 'auto'>('auto');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
    label: string;
  } | null>(null);
  const [folderScanning, setFolderScanning] = useState(false);
  const [folderScanStatus, setFolderScanStatus] = useState<{
    message: string;
    processed: number;
    total: number;
    coversFound: number;
  } | null>(null);

  // External app backup import state
  const [backupDragging, setBackupDragging] = useState(false);
  const [backupAnalyzing, setBackupAnalyzing] = useState(false);
  const [backupStatusText, setBackupStatusText] = useState('');
  const [backupImporting, setBackupImporting] = useState(false);
  const [parsedBackup, setParsedBackup] = useState<ParsedExternalBackup | null>(null);
  const [backupError, setBackupError] = useState('');
  const [optBooks, setOptBooks] = useState(true);
  const [optProgress, setOptProgress] = useState(true);
  const [optBookmarks, setOptBookmarks] = useState(true);
  const [optAnnotations, setOptAnnotations] = useState(true);
  const [optNotes, setOptNotes] = useState(true);
  const backupInputRef = useRef<HTMLInputElement>(null);

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

  // Pre-detect duplicates BEFORE importing so the user gets an immediate visual warning!
  const preImportDupInfo = useMemo(() => {
    if (!files.length) return { count: 0, samples: [] as string[] };
    const norm = (raw: string) =>
      raw
        .split(/[\\/]/)
        .pop()!
        .replace(/\.(epub|pdf|mobi|azw3?|fb2|cbz|cbr|txt|docx|zip|rar|mp3|m4b|m4a|jpe?g|png|webp|gif|avif|bmp)$/i, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const existingKeys = new Set<string>();
    for (const b of books) {
      if (b.isDemo || !b.hasLocalFile) continue;
      const fk = norm(b.fileName || '');
      const tk = norm(b.title || '');
      if (fk) existingKeys.add(fk);
      if (tk) existingKeys.add(tk);
    }
    const seenInSelection = new Set<string>();
    let count = 0;
    const samples: string[] = [];
    for (const f of files) {
      if (isImageFile(f) && bundleImages && imageFiles.length > 1) continue;
      const k = norm(f.name);
      if (!k) continue;
      if (existingKeys.has(k) || seenInSelection.has(k)) {
        count++;
        if (samples.length < 3) samples.push(f.name.replace(/\.[^.]+$/, ''));
      } else {
        seenInSelection.add(k);
      }
    }
    return { count, samples };
  }, [files, books, bundleImages, imageFiles.length]);

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

  const isExternalBackupFileName = (name: string) =>
    /\.(mrpro|mrstd|mrexpt|po|bak|bk|tachibk|db|sqlite3?|json|csv|tsv|lua|opml|xml)$/i.test(name) ||
    /my\s*clippings\.txt$/i.test(name);

  const applySelectedFiles = (rawList: File[]) => {
    const { supported, skippedCount: skipped } = filterSupportedFiles(rawList);
    if (!supported.length && rawList.length === 1 && isExternalBackupFileName(rawList[0].name)) {
      setMode('backup');
      void handleAnalyzeBackupFile(rawList[0]);
      return;
    }
    setFiles(supported);
    setSkippedCount(skipped);
    if (!supported.length && rawList.length > 0) {
      const backupCandidate = rawList.find((f) => isExternalBackupFileName(f.name));
      if (backupCandidate) {
        setMode('backup');
        void handleAnalyzeBackupFile(backupCandidate);
        return;
      }
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
    setImportProgress({ done: 0, total: files.length, label: 'Iniciando importación...' });
    try {
      await importFiles(files, {
        bundleImages: hasMultipleImages && bundleImages,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        kind: kind === 'auto' ? undefined : kind,
        categories: selectedCats,
        skipDuplicates,
        onProgress: (done, total, currentName) => {
          setImportProgress({
            done,
            total,
            label: currentName ? `Importando ${done} / ${total}: ${currentName}` : `Importando ${done} / ${total}...`,
          });
        },
      });
      resetLocalForm();
      setImportModalOpen(false);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleTriggerFolderPicker = async () => {
    if (folderScanning || importing) return;
    if (supportsNativeFolderPicker()) {
      setFolderScanning(true);
      setFolderScanStatus({
        message: 'Abriendo selector de carpetas de Android...',
        processed: 0,
        total: 0,
        coversFound: 0,
      });
      let totalAdded = 0;
      let totalLinked = 0;
      let totalDuplicates = 0;
      const dupSamples: string[] = [];
      try {
        const res = await pickLibraryFolderNatively(
          async (batch) => {
            const r = await importNativeFolderBooks(batch, {
              author: author.trim() || undefined,
              kind: kind === 'auto' ? undefined : kind,
              categories: selectedCats,
            });
            totalAdded += r.added;
            totalLinked += r.linked;
            totalDuplicates += r.duplicatesSkipped;
            for (const s of r.duplicateSamples) {
              if (dupSamples.length < 3 && !dupSamples.includes(s)) dupSamples.push(s);
            }
          },
          (info) => {
            setFolderScanStatus((prev) => ({
              message: info.message || prev?.message || 'Escaneando carpeta...',
              processed: info.processed ?? prev?.processed ?? 0,
              total: info.total ?? prev?.total ?? 0,
              coversFound: info.coversFound ?? prev?.coversFound ?? 0,
            }));
          }
        );
        if (res) {
          await importNativeFolderBooks([], { finalizeSync: true });
          const folderLabel = res.rootFolderName ? `"${res.rootFolderName}"` : 'la carpeta';
          if (res.totalFound === 0) {
            showToast(`No se encontraron libros compatibles dentro de ${folderLabel}`);
          } else {
            const parts: string[] = [];
            if (totalAdded > 0) parts.push(`${totalAdded} nuevos`);
            if (totalLinked > 0) parts.push(`${totalLinked} vinculados`);
            if (totalDuplicates > 0) {
              parts.push(`${totalDuplicates} duplicados omitidos`);
            }
            const sampleTxt = dupSamples.length > 0 && totalAdded === 0 ? ` (${dupSamples.join(', ')})` : '';
            showToast(`Carpeta ${folderLabel}: ${parts.join(' · ') || `${res.totalFound} revisados`}${sampleTxt}`);
            setImportModalOpen(false);
          }
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'No se pudo leer la carpeta seleccionada en Android.'
        );
      } finally {
        setFolderScanning(false);
        setFolderScanStatus(null);
      }
      return;
    }
    folderInputRef.current?.click();
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

  const formatFileSizeShort = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const handleAnalyzeBackupFile = async (
    file: File | null | undefined,
    nativeMeta?: {
      originalSize: number;
      skippedCount: number;
      coversCount?: number;
      booksScannedCount?: number;
      thumbsFoundCount?: number;
    }
  ) => {
    if (!file) return;
    setBackupAnalyzing(true);
    setBackupStatusText(`Leyendo datos de ${file.name}...`);
    setBackupError('');
    setParsedBackup(null);
    try {
      const result = await parseExternalBackupFile(file);
      const withCovers = result.books.filter((b) => Boolean(b.coverDataUrl)).length;
      if (nativeMeta && nativeMeta.originalSize > 20 * 1024 * 1024) {
        const scanInfo =
          (nativeMeta.booksScannedCount || 0) > 0 || (nativeMeta.thumbsFoundCount || 0) > 0
            ? ` (escaneados: ${nativeMeta.booksScannedCount || 0} EPUB/PDF y ${nativeMeta.thumbsFoundCount || 0} miniaturas)`
            : '';
        result.warnings.unshift(
          `Copia procesada (${formatFileSizeShort(nativeMeta.originalSize)}): ${result.books.length} libros, ${withCovers} portadas originales enlazadas${scanInfo}.`
        );
      }
      setParsedBackup(result);
      setOptBooks(true);
      setOptProgress(true);
      setOptBookmarks(true);
      setOptAnnotations(true);
      setOptNotes(true);
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'No se pudo analizar el archivo de copia de seguridad.'
      );
    } finally {
      setBackupAnalyzing(false);
      setBackupStatusText('');
    }
  };

  const handleTriggerBackupPicker = async () => {
    if (backupAnalyzing) return;
    if (supportsNativeBackupPicker()) {
      setBackupAnalyzing(true);
      setBackupStatusText('Abriendo selector seguro de Android...');
      setBackupError('');
      setParsedBackup(null);
      try {
        const picked = await pickExternalBackupNatively((info) => {
          if (info.message) {
            setBackupStatusText(info.message);
            return;
          }
          const sizeTxt = formatFileSizeShort(info.originalSize);
          setBackupStatusText(
            `Extrayendo autores, portadas y datos de ${info.fileName || 'copia'}${sizeTxt ? ` (${sizeTxt})` : ''}...`
          );
        });
        if (!picked) {
          setBackupAnalyzing(false);
          setBackupStatusText('');
          return;
        }
        await handleAnalyzeBackupFile(picked.file, {
          originalSize: picked.originalSize,
          skippedCount: picked.skippedCount,
          coversCount: picked.coversCount,
          booksScannedCount: picked.booksScannedCount,
          thumbsFoundCount: picked.thumbsFoundCount,
        });
      } catch (err) {
        setBackupError(
          err instanceof Error
            ? err.message
            : 'No se pudo leer el archivo seleccionado en Android.'
        );
        setBackupAnalyzing(false);
        setBackupStatusText('');
      }
      return;
    }
    backupInputRef.current?.click();
  };

  const handleConfirmExternalBackup = async () => {
    if (!parsedBackup || backupImporting) return;
    setBackupImporting(true);
    try {
      await importExternalBackup(parsedBackup, {
        importBooks: optBooks,
        importProgress: optProgress,
        importBookmarks: optBookmarks,
        importAnnotations: optAnnotations,
        importNotes: optNotes,
      });
      setParsedBackup(null);
      setImportModalOpen(false);
    } finally {
      setBackupImporting(false);
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
            aria-selected={mode === 'backup'}
            className={`import-tab-btn ${mode === 'backup' ? 'active' : ''}`}
            onClick={() => setMode('backup')}
          >
            <Database size={15} /> Copia de otra app
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
                  disabled={folderScanning || importing}
                  onClick={() => void handleTriggerFolderPicker()}
                >
                  <FolderOpen size={14} /> {folderScanning ? 'Escaneando carpeta...' : 'Elegir carpeta'}
                </button>
              </div>
              {supportsNativeFolderPicker() && (
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
                  Consejo: para importar cientos o miles de libros (ej. +1,000) con todas sus subcarpetas y portadas sin límites, usa <strong>Elegir carpeta</strong>.
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="*/*"
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

            {(folderScanStatus || importProgress) && (
              <div
                style={{
                  background: 'var(--banner-bg)',
                  border: '1px solid var(--accent-primary)',
                  borderRadius: 14,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {folderScanStatus ? folderScanStatus.message : importProgress?.label}
                </div>
                {(() => {
                  const done = folderScanStatus ? folderScanStatus.processed : importProgress?.done || 0;
                  const total = folderScanStatus ? folderScanStatus.total : importProgress?.total || 0;
                  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 12;
                  return (
                    <>
                      <div className="goal-track" style={{ height: 7 }}>
                        <div className="goal-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{total > 0 ? `${done} / ${total} archivos` : 'Leyendo estructura...'}</span>
                        <span>{total > 0 ? `${pct}%` : ''}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {duplicateBooksCount > 0 && (
              <div
                style={{
                  background: 'rgba(242, 186, 89, 0.14)',
                  border: '1px solid rgba(242, 186, 89, 0.55)',
                  borderRadius: 13,
                  padding: '9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} style={{ color: '#c47f17', flexShrink: 0 }} />
                  Se detectaron {duplicateBooksCount} libro{duplicateBooksCount === 1 ? '' : 's'} duplicado{duplicateBooksCount === 1 ? '' : 's'} en tu biblioteca.
                </span>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ height: 28, fontSize: 11, background: 'var(--card-bg)' }}
                  disabled={cleaningDups}
                  onClick={async () => {
                    setCleaningDups(true);
                    try {
                      await removeDuplicateBooks();
                    } finally {
                      setCleaningDups(false);
                    }
                  }}
                >
                  <Trash2 size={12} /> {cleaningDups ? 'Limpiando...' : 'Limpiar duplicados'}
                </button>
              </div>
            )}

            {preImportDupInfo.count > 0 && (
              <div
                style={{
                  background: 'rgba(232, 111, 104, 0.12)',
                  border: '1px solid rgba(232, 111, 104, 0.45)',
                  borderRadius: 13,
                  padding: '9px 12px',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <AlertTriangle size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>Filtro anti-duplicados:</strong> {preImportDupInfo.count} archivo
                  {preImportDupInfo.count === 1 ? '' : 's'} ya existe
                  {preImportDupInfo.count === 1 ? '' : 'n'} en tu biblioteca
                  {preImportDupInfo.samples.length > 0 ? ` (${preImportDupInfo.samples.join(', ')})` : ''}
                  {skipDuplicates ? ' y se omitirán automáticamente.' : ' (filtro desactivado).'}
                </div>
              </div>
            )}

            <div
              className="toggle-row"
              style={{
                background: 'var(--banner-bg)',
                border: '1px solid var(--border-subtle)',
                padding: '9px 12px',
                borderRadius: 12,
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={14} style={{ color: 'var(--accent-primary)' }} />
                Filtro anti-duplicados (omitir libros ya importados y avisar)
              </span>
              <button
                type="button"
                className={`switch ${skipDuplicates ? 'on' : ''}`}
                onClick={() => setSkipDuplicates(!skipDuplicates)}
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
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
        ) : mode === 'backup' ? (
          /* Universal External App Backup Importer (offline-ready, accepts ANY file) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              className={`dropzone ${backupDragging ? 'dragging' : ''}`}
              onClick={() => void handleTriggerBackupPicker()}
              onDragOver={(e) => {
                e.preventDefault();
                setBackupDragging(true);
              }}
              onDragLeave={() => setBackupDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setBackupDragging(false);
                const droppedFile = e.dataTransfer.files?.[0];
                void handleAnalyzeBackupFile(droppedFile);
              }}
            >
              <Database size={30} style={{ color: 'var(--accent-secondary)', marginBottom: 8 }} />
              <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>
                {backupAnalyzing
                  ? backupStatusText || 'Analizando copia de seguridad...'
                  : 'Selecciona cualquier archivo de copia de seguridad'}
              </div>
              <div style={{ fontSize: 11.2, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                ReadEra (<code>.bak</code>) · Moon+ Reader (<code>.mrpro/.mrexpt/.po</code>, incluso +2 GB) · Kindle (<code>My Clippings.txt</code>) · Goodreads / Calibre / StoryGraph (<code>.csv</code>) · Tachiyomi / Mihon / Kotatsu · KOReader (<code>.lua</code>) · KomoLib (<code>.json</code>) · <code>.zip</code> / <code>.xml</code> / <code>.txt</code>
              </div>

              <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ background: 'var(--card-bg)', height: 36 }}
                  onClick={() => void handleTriggerBackupPicker()}
                  disabled={backupAnalyzing}
                >
                  <FileUp size={14} /> {backupAnalyzing ? 'Procesando copia...' : 'Elegir archivo de copia'}
                </button>
              </div>

              <input
                ref={backupInputRef}
                type="file"
                accept="*/*"
                hidden
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = '';
                  void handleAnalyzeBackupFile(chosen);
                }}
              />
            </div>

            {backupError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '9px 11px',
                  borderRadius: 12,
                  background: 'color-mix(in srgb, #d9534f 10%, var(--card-bg))',
                  border: '1px solid color-mix(in srgb, #d9534f 30%, var(--border-subtle))',
                  fontSize: 11.5,
                  color: '#c92a2a',
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{backupError}</span>
              </div>
            )}

            {parsedBackup && (
              <div
                style={{
                  background: 'var(--banner-bg)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 16,
                  padding: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                      Origen detectado: <span style={{ color: 'var(--accent-primary)' }}>{parsedBackup.detectedSource}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                      {parsedBackup.fileName}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pill-btn"
                    style={{ height: 26, fontSize: 10.5, background: 'var(--card-bg)' }}
                    onClick={() => setParsedBackup(null)}
                  >
                    Cambiar archivo
                  </button>
                </div>

                {/* Detected counts */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 6,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ background: 'var(--card-bg)', borderRadius: 10, padding: '8px 4px', border: '1px solid var(--border-subtle)' }}>
                    <BookOpen size={14} style={{ color: 'var(--accent-primary)' }} />
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{parsedBackup.books.length}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Libros</div>
                  </div>
                  <div style={{ background: 'var(--card-bg)', borderRadius: 10, padding: '8px 4px', border: '1px solid var(--border-subtle)' }}>
                    <Bookmark size={14} style={{ color: 'var(--accent-secondary)' }} />
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{parsedBackup.bookmarks.length}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Marcadores</div>
                  </div>
                  <div style={{ background: 'var(--card-bg)', borderRadius: 10, padding: '8px 4px', border: '1px solid var(--border-subtle)' }}>
                    <Highlighter size={14} style={{ color: '#e6b24c' }} />
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{parsedBackup.annotations.length}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Citas</div>
                  </div>
                  <div style={{ background: 'var(--card-bg)', borderRadius: 10, padding: '8px 4px', border: '1px solid var(--border-subtle)' }}>
                    <StickyNote size={14} style={{ color: '#5c8d68' }} />
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{parsedBackup.notes.length}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Notas</div>
                  </div>
                </div>

                {parsedBackup.warnings.map((w, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      fontSize: 11,
                      lineHeight: 1.45,
                      color: 'var(--text-muted)',
                      background: 'var(--card-bg)',
                      borderRadius: 10,
                      padding: '8px 10px',
                      border: '1px dashed var(--border-strong)',
                    }}
                  >
                    <AlertTriangle size={13} style={{ color: '#e6b24c', flexShrink: 0, marginTop: 1 }} />
                    <span>{w}</span>
                  </div>
                ))}

                {/* Selective import toggles */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11.5, fontWeight: 700 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={optBooks} onChange={(e) => setOptBooks(e.target.checked)} />
                    Libros nuevos
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={optProgress} onChange={(e) => setOptProgress(e.target.checked)} />
                    Progresos y estado
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={optBookmarks} onChange={(e) => setOptBookmarks(e.target.checked)} />
                    Marcadores
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={optAnnotations} onChange={(e) => setOptAnnotations(e.target.checked)} />
                    Resaltados / citas
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={optNotes} onChange={(e) => setOptNotes(e.target.checked)} />
                    Notas
                  </label>
                </div>

                {/* Preview sample titles */}
                {parsedBackup.books.length > 0 && (
                  <div
                    style={{
                      maxHeight: 135,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      paddingRight: 2,
                    }}
                  >
                    {parsedBackup.books.slice(0, 8).map((b, idx) => (
                      <div
                        key={`${b.title}-${idx}`}
                        style={{
                          background: 'var(--card-bg)',
                          borderRadius: 9,
                          padding: '6px 9px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          fontSize: 11,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          {b.coverDataUrl && (
                            <img
                              src={b.coverDataUrl}
                              alt=""
                              style={{
                                width: 22,
                                height: 32,
                                objectFit: 'cover',
                                borderRadius: 4,
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {b.title}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {b.author}{b.format ? ` · ${b.format.toUpperCase()}` : ''}
                            </div>
                          </div>
                        </div>
                        {b.progress !== undefined && (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 800,
                              color: 'var(--accent-primary)',
                              flexShrink: 0,
                            }}
                          >
                            {Math.round(b.progress)}%
                          </span>
                        )}
                      </div>
                    ))}
                    {parsedBackup.books.length > 8 && (
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center' }}>
                        + {parsedBackup.books.length - 8} libro(s) más...
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
                  <button type="button" className="pill-btn" onClick={() => setImportModalOpen(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="coral-cta-btn"
                    disabled={
                      backupImporting ||
                      (!parsedBackup.nativeKomoLibData &&
                        parsedBackup.books.length === 0 &&
                        parsedBackup.bookmarks.length === 0 &&
                        parsedBackup.annotations.length === 0 &&
                        parsedBackup.notes.length === 0)
                    }
                    onClick={handleConfirmExternalBackup}
                  >
                    {backupImporting ? 'Importando...' : 'Importar copia a KomoLib'}
                  </button>
                </div>
              </div>
            )}
          </div>
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
