import { detectFormat } from '../parsers';

export type FileWithRelPath = File & {
  __relativePath?: string;
};

interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: WebkitFileSystemEntry[]) => void,
      error?: (err: unknown) => void
    ) => void;
  };
}

function readAllDirectoryEntries(entry: WebkitFileSystemEntry): Promise<WebkitFileSystemEntry[]> {
  return new Promise((resolve) => {
    const reader = entry.createReader?.();
    if (!reader) {
      resolve([]);
      return;
    }
    const all: WebkitFileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all);
          } else {
            all.push(...batch);
            readBatch();
          }
        },
        () => resolve(all)
      );
    };
    readBatch();
  });
}

async function traverseEntry(entry: WebkitFileSystemEntry, prefix = ''): Promise<FileWithRelPath[]> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file!(
        (file) => {
          const tagged = file as FileWithRelPath;
          tagged.__relativePath = prefix ? `${prefix}/${file.name}` : file.name;
          resolve([tagged]);
        },
        () => resolve([])
      );
    });
  }

  if (entry.isDirectory) {
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const children = await readAllDirectoryEntries(entry);
    const nested = await Promise.all(children.map((child) => traverseEntry(child, nextPrefix)));
    return nested.flat();
  }

  return [];
}

/**
 * Extracts all files from a Drag & Drop DataTransfer, including recursively walking dropped folders.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<FileWithRelPath[]> {
  const items = Array.from(dataTransfer.items || []);
  const entries: WebkitFileSystemEntry[] = [];
  for (const item of items) {
    const anyItem = item as unknown as {
      webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
    };
    const entry = typeof anyItem.webkitGetAsEntry === 'function' ? anyItem.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }

  if (entries.length > 0) {
    const results = await Promise.all(entries.map((entry) => traverseEntry(entry)));
    const flattened = results.flat();
    if (flattened.length > 0) return flattened;
  }

  return Array.from(dataTransfer.files || []) as FileWithRelPath[];
}

export function getRelativePath(file: File): string {
  const tagged = file as FileWithRelPath;
  return tagged.__relativePath || file.webkitRelativePath || file.name;
}

export function getFolderPath(file: File): string {
  const rel = getRelativePath(file).replace(/\\/g, '/');
  const idx = rel.lastIndexOf('/');
  return idx > 0 ? rel.slice(0, idx) : '';
}

export function getFolderDisplayName(folderPath: string): string {
  const clean = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function isIgnoredSystemFile(file: File): boolean {
  const rel = getRelativePath(file).replace(/\\/g, '/');
  const segments = rel.split('/');
  return segments.some(
    (seg) =>
      seg.startsWith('.') ||
      seg === '__MACOSX' ||
      seg.toLowerCase() === 'thumbs.db' ||
      seg.toLowerCase() === 'desktop.ini'
  );
}

export function filterSupportedFiles(files: File[]): {
  supported: FileWithRelPath[];
  skippedCount: number;
} {
  const supported: FileWithRelPath[] = [];
  let skippedCount = 0;

  for (const file of files) {
    if (isIgnoredSystemFile(file) || file.size === 0) {
      skippedCount += 1;
      continue;
    }
    if (detectFormat(file.name, file.type) !== null) {
      supported.push(file as FileWithRelPath);
    } else {
      skippedCount += 1;
    }
  }

  return { supported, skippedCount };
}

export function isImageFile(file: File): boolean {
  return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name) || file.type.startsWith('image/');
}

/**
 * Groups image files by their parent folder so selecting a folder containing
 * multiple manga/manhwa chapters creates one volume per chapter folder.
 */
export function groupImagesByFolder(imageFiles: File[]): Array<{ folderName: string; files: File[] }> {
  const map = new Map<string, File[]>();
  for (const f of imageFiles) {
    const folder = getFolderPath(f) || '__root__';
    const list = map.get(folder) || [];
    list.push(f);
    map.set(folder, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([folderPath, files]) => ({
      folderName: folderPath === '__root__' ? '' : getFolderDisplayName(folderPath),
      files,
    }));
}
