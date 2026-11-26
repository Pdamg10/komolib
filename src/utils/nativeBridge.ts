interface KomoAndroidBridge {
  saveFile?: (fileName: string, mimeType: string, content: string) => string;
  shareFile?: (fileName: string, mimeType: string, content: string) => boolean;
  copyText?: (text: string) => boolean;
  shareText?: (title: string, text: string) => boolean;
  pickExternalBackup?: () => boolean;
  readBackupChunk?: (chunkIndex: number) => string;
  clearBackupTemp?: () => void;
  pickLibraryFolder?: () => boolean;
  rescanLibraryFolder?: (treeUri: string, skipKeysJson: string) => boolean;
  getNativeUriSize?: (uri: string) => number;
  readNativeUriChunk?: (uri: string, chunkIndex: number) => string;
  openExternalUrl?: (url: string) => boolean;
  consumePendingGoogleAuth?: () => string;
}

export interface NativeScannedFolderBook {
  uri: string;
  fileName: string;
  folderPath?: string;
  fileSize: number;
  mimeType: string;
  format: string;
  title?: string;
  author?: string;
  description?: string;
  pageCount?: number;
  coverBase64?: string;
}

export interface NativeFolderScanResult {
  totalFound: number;
  totalEmitted: number;
  skippedCount: number;
  rootFolderName?: string;
  treeUri?: string;
}

export interface DesktopScannedFileItem {
  fullPath: string;
  fileName: string;
  folderPath: string;
  fileSize: number;
  mimeType: string;
  mtimeMs: number;
}

export interface NativePickedBackup {
  file: File;
  originalSize: number;
  payloadSize: number;
  isExtractedZip: boolean;
  keptCount: number;
  skippedCount: number;
  coversCount: number;
  booksScannedCount: number;
  thumbsFoundCount: number;
}

interface KomoDesktopBridge {
  isDesktop?: boolean;
  platform?: string;
  openExternal?: (url: string) => Promise<boolean> | boolean;
  pickWatchFolder?: () => Promise<{ path: string; name: string } | null>;
  scanWatchFolder?: (
    folderPath: string,
    knownKeys?: string[]
  ) => Promise<{
    ok: boolean;
    error?: string;
    totalFound: number;
    newFiles: DesktopScannedFileItem[];
  }>;
  readWatchFile?: (fullPath: string, rootHint?: string) => Promise<Uint8Array | null>;
}

function getBridge(): KomoAndroidBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { KomoAndroid?: KomoAndroidBridge }).KomoAndroid;
}

function getDesktopBridge(): KomoDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { KomoDesktop?: KomoDesktopBridge }).KomoDesktop;
}

export function isKomoAndroidNative(): boolean {
  return Boolean(getBridge()?.saveFile);
}

export function isKomoDesktopNative(): boolean {
  return Boolean(getDesktopBridge()?.isDesktop);
}

export function openExternalUrlNatively(url: string): boolean {
  const bridge = getBridge();
  if (bridge?.openExternalUrl) {
    try {
      return Boolean(bridge.openExternalUrl(url));
    } catch {
      return false;
    }
  }
  const desktop = getDesktopBridge();
  if (desktop?.openExternal) {
    try {
      void desktop.openExternal(url);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function consumePendingNativeGoogleAuth(): string {
  const bridge = getBridge();
  if (bridge?.consumePendingGoogleAuth) {
    try {
      return bridge.consumePendingGoogleAuth() || '';
    } catch {
      return '';
    }
  }
  return '';
}

export function supportsNativeBackupPicker(): boolean {
  const b = getBridge();
  return Boolean(b?.pickExternalBackup && b?.readBackupChunk);
}

export function supportsNativeFolderPicker(): boolean {
  const b = getBridge();
  return Boolean(b?.pickLibraryFolder && b?.readNativeUriChunk);
}

export function supportsDesktopWatchFolder(): boolean {
  const d = getDesktopBridge();
  return Boolean(d?.pickWatchFolder && d?.scanWatchFolder && d?.readWatchFile);
}

export function supportsSmartLinkedFolder(): boolean {
  return (
    supportsDesktopWatchFolder() ||
    Boolean(getBridge()?.pickLibraryFolder && getBridge()?.rescanLibraryFolder) ||
    (typeof window !== 'undefined' && 'showDirectoryPicker' in window)
  );
}

export async function pickDesktopWatchFolder(): Promise<{ path: string; name: string } | null> {
  const d = getDesktopBridge();
  if (!d?.pickWatchFolder) return null;
  return d.pickWatchFolder();
}

export async function scanDesktopWatchFolder(
  folderPath: string,
  knownKeys: string[] = []
): Promise<{
  ok: boolean;
  error?: string;
  totalFound: number;
  newFiles: DesktopScannedFileItem[];
}> {
  const d = getDesktopBridge();
  if (!d?.scanWatchFolder) {
    return { ok: false, error: 'Solo disponible en la app de escritorio', totalFound: 0, newFiles: [] };
  }
  return d.scanWatchFolder(folderPath, knownKeys);
}

export async function readDesktopWatchFileAsFile(
  item: DesktopScannedFileItem,
  rootHint: string
): Promise<File | null> {
  const d = getDesktopBridge();
  if (!d?.readWatchFile) return null;
  const raw = await d.readWatchFile(item.fullPath, rootHint);
  if (!raw || raw.byteLength === 0) return null;
  const bytes = new Uint8Array(raw.byteLength);
  bytes.set(raw);
  const f = new File([bytes], item.fileName, {
    type: item.mimeType || 'application/octet-stream',
    lastModified: item.mtimeMs || Date.now(),
  });
  Object.defineProperty(f, '_komoRelativePath', {
    value: item.folderPath ? `${item.folderPath}/${item.fileName}` : item.fileName,
    configurable: true,
  });
  return f;
}

/**
 * Streams a file directly from a persistent Android SAF content:// URI into a Blob
 * using 1 MB Base64 chunks — allows reading 1,600+ folder-imported books 100% offline
 * without duplicating gigabytes into IndexedDB!
 */
export async function readNativeUriAsBlob(
  uri: string,
  mimeType = 'application/octet-stream'
): Promise<Blob | null> {
  const bridge = getBridge();
  if (!uri || !bridge?.readNativeUriChunk) return null;
  try {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < 4096; i++) {
      const b64 = bridge.readNativeUriChunk(uri, i);
      if (!b64) break;
      parts.push(decodeBase64ToUint8Array(b64));
      if (i % 4 === 3) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (!parts.length) return null;
    return new Blob(parts, { type: mimeType || 'application/octet-stream' });
  } catch {
    return null;
  }
}

/**
 * Opens Android's native SAF folder picker (ACTION_OPEN_DOCUMENT_TREE), recursively walks
 * ALL nested subfolders (no 1 MB Binder limit — handles 1,600+ or 10,000+ books!), extracts
 * real authors/titles/covers natively, and streams batches directly to JS!
 */
export function pickLibraryFolderNatively(
  onBatch: (items: NativeScannedFolderBook[], progress: { processed: number; total: number }) => Promise<void> | void,
  onStatus?: (info: { message?: string; processed?: number; total?: number; coversFound?: number }) => void
): Promise<NativeFolderScanResult | null> {
  const bridge = getBridge();
  if (!bridge?.pickLibraryFolder) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const win = window as unknown as {
      __komoNativeFolderStatus?: (info: {
        message?: string;
        processed?: number;
        total?: number;
        coversFound?: number;
      }) => void;
      __komoNativeFolderBatch?: (payload: {
        items?: NativeScannedFolderBook[];
        processed?: number;
        total?: number;
      }) => void;
      __komoNativeFolderDone?: (res: {
        ok?: boolean;
        cancelled?: boolean;
        error?: string;
        totalFound?: number;
        totalEmitted?: number;
        skippedCount?: number;
        rootFolderName?: string;
        treeUri?: string;
      }) => void;
    };

    let batchChain: Promise<void> = Promise.resolve();

    const cleanup = () => {
      delete win.__komoNativeFolderStatus;
      delete win.__komoNativeFolderBatch;
      delete win.__komoNativeFolderDone;
    };

    win.__komoNativeFolderStatus = (info) => {
      onStatus?.(info || {});
    };

    win.__komoNativeFolderBatch = (payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const processed = payload?.processed || 0;
      const total = payload?.total || processed;
      if (!items.length) return;
      batchChain = batchChain
        .then(() => onBatch(items, { processed, total }))
        .catch(() => undefined);
    };

    win.__komoNativeFolderDone = (res) => {
      batchChain.finally(() => {
        cleanup();
        if (!res || res.cancelled) {
          resolve(null);
          return;
        }
        if (!res.ok) {
          reject(new Error(res.error || 'No se pudo leer la carpeta seleccionada en Android.'));
          return;
        }
        resolve({
          totalFound: res.totalFound || 0,
          totalEmitted: res.totalEmitted || 0,
          skippedCount: res.skippedCount || 0,
          rootFolderName: res.rootFolderName,
          treeUri: res.treeUri,
        });
      });
    };

    try {
      bridge.pickLibraryFolder!();
    } catch (err) {
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error('No se pudo abrir el selector nativo de carpetas de Android.')
      );
    }
  });
}

/**
 * Re-scans an already-linked persistent Android SAF folder URI without opening the OS picker,
 * skipping already-imported URIs/filenames on the native thread so checks take milliseconds.
 */
export function rescanLibraryFolderNatively(
  treeUri: string,
  skipKeys: { uris: string[]; fileNames: string[] },
  onBatch: (items: NativeScannedFolderBook[], progress: { processed: number; total: number }) => Promise<void> | void,
  onStatus?: (info: { message?: string; processed?: number; total?: number; coversFound?: number }) => void
): Promise<NativeFolderScanResult | null> {
  const bridge = getBridge();
  if (!treeUri || !bridge?.rescanLibraryFolder) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const win = window as unknown as {
      __komoNativeFolderStatus?: (info: {
        message?: string;
        processed?: number;
        total?: number;
        coversFound?: number;
      }) => void;
      __komoNativeFolderBatch?: (payload: {
        items?: NativeScannedFolderBook[];
        processed?: number;
        total?: number;
      }) => void;
      __komoNativeFolderDone?: (res: {
        ok?: boolean;
        cancelled?: boolean;
        error?: string;
        totalFound?: number;
        totalEmitted?: number;
        skippedCount?: number;
        rootFolderName?: string;
        treeUri?: string;
      }) => void;
    };

    let batchChain: Promise<void> = Promise.resolve();

    const cleanup = () => {
      delete win.__komoNativeFolderStatus;
      delete win.__komoNativeFolderBatch;
      delete win.__komoNativeFolderDone;
    };

    win.__komoNativeFolderStatus = (info) => {
      onStatus?.(info || {});
    };

    win.__komoNativeFolderBatch = (payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const processed = payload?.processed || 0;
      const total = payload?.total || processed;
      if (!items.length) return;
      batchChain = batchChain
        .then(() => onBatch(items, { processed, total }))
        .catch(() => undefined);
    };

    win.__komoNativeFolderDone = (res) => {
      batchChain.finally(() => {
        cleanup();
        if (!res || res.cancelled) {
          resolve(null);
          return;
        }
        if (!res.ok) {
          reject(new Error(res.error || 'No se pudo re-escanear la carpeta vinculada en Android.'));
          return;
        }
        resolve({
          totalFound: res.totalFound || 0,
          totalEmitted: res.totalEmitted || 0,
          skippedCount: res.skippedCount || 0,
          rootFolderName: res.rootFolderName,
          treeUri: res.treeUri || treeUri,
        });
      });
    };

    try {
      bridge.rescanLibraryFolder!(treeUri, JSON.stringify(skipKeys));
    } catch (err) {
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error('No se pudo re-escanear la carpeta vinculada en Android.')
      );
    }
  });
}

function decodeBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Opens Android's native SAF file picker (ACTION_OPEN_DOCUMENT) and extracts backup metadata
 * on a native background thread using FileChannel/ZIP64 — handles > 2 GB files (like Moon+ Reader
 * .mrpro backups) with guaranteed OS read permissions and < 20 MB RAM usage.
 */
export function pickExternalBackupNatively(
  onStatus?: (info: { fileName?: string; originalSize?: number; message?: string }) => void
): Promise<NativePickedBackup | null> {
  const bridge = getBridge();
  if (!bridge?.pickExternalBackup || !bridge.readBackupChunk) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const win = window as unknown as {
      __komoNativeBackupStatus?: (info: {
        fileName?: string;
        originalSize?: number;
        message?: string;
      }) => void;
      __komoNativeBackupReady?: (res: {
        ok?: boolean;
        cancelled?: boolean;
        error?: string;
        fileName?: string;
        originalSize?: number;
        payloadSize?: number;
        chunkCount?: number;
        isExtractedZip?: boolean;
        keptCount?: number;
        skippedCount?: number;
        coversCount?: number;
        booksScannedCount?: number;
        thumbsFoundCount?: number;
      }) => void;
    };

    const cleanup = () => {
      delete win.__komoNativeBackupStatus;
      delete win.__komoNativeBackupReady;
    };

    win.__komoNativeBackupStatus = (info) => {
      onStatus?.(info || {});
    };

    win.__komoNativeBackupReady = (res) => {
      cleanup();
      if (!res || res.cancelled) {
        resolve(null);
        return;
      }
      if (!res.ok) {
        reject(new Error(res.error || 'No se pudo leer el archivo de copia de seguridad.'));
        return;
      }

      try {
        const chunkCount = Math.max(0, res.chunkCount || 0);
        const parts: Uint8Array<ArrayBuffer>[] = [];
        for (let i = 0; i < chunkCount; i++) {
          const b64 = bridge.readBackupChunk!(i);
          if (!b64) break;
          parts.push(decodeBase64ToUint8Array(b64));
        }
        bridge.clearBackupTemp?.();

        const fileName = res.fileName || 'backup.zip';
        const file = new File(parts, fileName, {
          type: res.isExtractedZip ? 'application/zip' : 'application/octet-stream',
        });

        resolve({
          file,
          originalSize: res.originalSize || file.size,
          payloadSize: res.payloadSize || file.size,
          isExtractedZip: Boolean(res.isExtractedZip),
          keptCount: res.keptCount || 0,
          skippedCount: res.skippedCount || 0,
          coversCount: res.coversCount || 0,
          booksScannedCount: res.booksScannedCount || 0,
          thumbsFoundCount: res.thumbsFoundCount || 0,
        });
      } catch (err) {
        bridge.clearBackupTemp?.();
        reject(
          err instanceof Error
            ? err
            : new Error('Error al ensamblar los metadatos de la copia de seguridad.')
        );
      }
    };

    try {
      bridge.pickExternalBackup!();
    } catch (err) {
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error('No se pudo abrir el selector nativo de archivos.')
      );
    }
  });
}

/**
 * Saves a text/JSON file locally on both Desktop browsers (<a download>)
 * and Capacitor Android APK (native MediaStore Downloads/Komolib/ via KomoAndroid bridge).
 */
export function saveTextFileLocally(
  fileName: string,
  content: string,
  mimeType = 'application/json'
): { ok: boolean; location?: string; error?: string } {
  const bridge = getBridge();
  if (bridge?.saveFile) {
    try {
      const raw = bridge.saveFile(fileName, mimeType, content);
      const parsed = JSON.parse(raw) as { ok?: boolean; location?: string; error?: string };
      if (parsed.ok) {
        return { ok: true, location: parsed.location };
      }
      return { ok: false, error: parsed.error || 'No se pudo guardar en Descargas' };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Error al guardar el archivo',
      };
    }
  }

  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { ok: true, location: fileName };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'No se pudo descargar el archivo',
    };
  }
}

/**
 * Shares a text/JSON file using the Android Share Sheet (or Web Share API / download fallback).
 */
export async function shareTextFileNatively(
  fileName: string,
  content: string,
  mimeType = 'application/json'
): Promise<boolean> {
  const bridge = getBridge();
  if (bridge?.shareFile) {
    return Boolean(bridge.shareFile(fileName, mimeType, content));
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([content], fileName, { type: mimeType });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: fileName, files: [file] });
        return true;
      }
    } catch {
      // fall through to download
    }
  }

  return saveTextFileLocally(fileName, content, mimeType).ok;
}

/**
 * Reliably copies text to clipboard across Desktop HTTPS, Mobile Web, and Android HTTP WebView.
 */
export async function copyTextReliably(text: string): Promise<boolean> {
  const bridge = getBridge();
  if (bridge?.copyText) {
    return Boolean(bridge.copyText(text));
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand fallback
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Shares an invite link/code using Android Share Sheet, Web Share API, or clipboard fallback.
 */
export async function shareLinkOrText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  const bridge = getBridge();
  if (bridge?.shareText) {
    return bridge.shareText(title, text) ? 'shared' : 'failed';
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch {
      // fall through to clipboard
    }
  }

  const copied = await copyTextReliably(text);
  return copied ? 'copied' : 'failed';
}
