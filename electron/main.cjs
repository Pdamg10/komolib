const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_WATCH_EXTS = new Set([
  '.epub', '.pdf', '.cbz', '.cbr', '.zip', '.rar',
  '.txt', '.md', '.markdown', '.html', '.htm', '.fb2',
  '.mobi', '.azw', '.azw3', '.prc', '.docx',
  '.mp3', '.m4b', '.m4a', '.aac', '.ogg', '.oga', '.opus',
  '.wav', '.flac', '.webm', '.wma', '.amr', '.3gp', '.aif', '.aiff', '.caf', '.alac', '.ac3', '.mp2', '.mka',
]);

const WATCH_MIME_BY_EXT = {
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.cbz': 'application/vnd.comicbook+zip',
  '.zip': 'application/zip',
  '.cbr': 'application/vnd.comicbook-rar',
  '.rar': 'application/vnd.rar',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.fb2': 'application/x-fictionbook+xml',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw': 'application/vnd.amazon.ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.prc': 'application/x-mobipocket-ebook',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp3': 'audio/mpeg',
  '.m4b': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.wma': 'audio/x-ms-wma',
};

let allowedWatchRoot = '';

function normalizeWatchKey(raw) {
  return String(raw || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function scanDirectoryRecursive(rootDir, currentDir, depth, knownKeySet, results, stats) {
  if (depth > 8 || results.length >= 2500) return;
  let entries;
  try {
    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  let processed = 0;
  for (const entry of entries) {
    processed += 1;
    if (processed % 60 === 0) {
      await new Promise((r) => setImmediate(r));
    }
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__MACOSX') continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await scanDirectoryRecursive(rootDir, fullPath, depth + 1, knownKeySet, results, stats);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_WATCH_EXTS.has(ext)) continue;
      stats.totalFound += 1;
      const key = normalizeWatchKey(entry.name);
      if (key && knownKeySet.has(key)) continue;
      try {
        const st = await fs.promises.stat(fullPath);
        if (!st.isFile() || st.size <= 0) continue;
        const relDir = path.relative(rootDir, currentDir).replace(/\\/g, '/');
        const rootBase = path.basename(rootDir);
        const folderPath = relDir ? `${rootBase}/${relDir}` : rootBase;
        results.push({
          fullPath,
          fileName: entry.name,
          folderPath,
          fileSize: st.size,
          mimeType: WATCH_MIME_BY_EXT[ext] || 'application/octet-stream',
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // skip unreadable file
      }
    }
  }
}

// Balanced Wayland/X11 & memory tuning for smooth scrolling with low RAM/CPU footprint
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');

// Pin userData to a single stable lowercase directory across Linux (case-sensitive!) and Windows
// so app name / packaging changes NEVER split IndexedDB/localStorage into a fresh empty profile.
try {
  const stableUserData = path.join(app.getPath('appData'), 'komolib');
  app.setPath('userData', stableUserData);
} catch {
  // ignore if appData unavailable
}

app.setName('Komolib');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.komolib.reader');
}
if (process.platform === 'linux' && typeof app.setDesktopName === 'function') {
  app.setDesktopName('komolib.desktop');
}

const DIST_DIR = path.join(__dirname, '..', 'dist');
const PREFERRED_PORTS = [41735, 41736, 41737];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

let mainWindow = null;
let localServer = null;
const staticCache = new Map();

function createOAuthBridgeHtml() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Komolib · Google Drive</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f3ede4; color: #2e2621; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
    .card { background: #fffdf9; border-radius: 20px; padding: 28px 24px; max-width: 420px; box-shadow: 0 12px 34px rgba(0,0,0,0.08); }
    h2 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; font-size: 14px; color: #6f6259; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2 id="title">Conectando con Komolib...</h2>
    <p id="msg">Enviando sesión de Google Drive a tu aplicación de escritorio.</p>
  </div>
  <script>
    (async function () {
      try {
        var m = window.location.hash.match(/gdrive_auth=([^&]+)/);
        if (!m || !m[1]) throw new Error('No se recibió respuesta de Google');
        var encoded = decodeURIComponent(m[1]);
        var res = await fetch('/__komo_oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encoded: encoded })
        });
        if (!res.ok) throw new Error('No se pudo entregar la sesión a Komolib');
        document.getElementById('title').textContent = 'Google Drive conectado';
        document.getElementById('msg').textContent = 'Listo. Ya puedes cerrar esta pestaña y volver a Komolib.';
        window.setTimeout(function () { window.close(); }, 1200);
      } catch (err) {
        document.getElementById('title').textContent = 'No se pudo completar';
        document.getElementById('msg').textContent = err && err.message ? err.message : 'Error desconocido';
      }
    })();
  </script>
</body>
</html>`;
}

function readCachedAsset(filePath) {
  let cached = staticCache.get(filePath);
  if (cached) return cached;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  cached = {
    buf,
    contentType: MIME_TYPES[ext] || 'application/octet-stream',
    cacheControl: ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  if (buf.byteLength <= 4 * 1024 * 1024) {
    staticCache.set(filePath, cached);
  }
  return cached;
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(reqUrl.pathname);

      // OAuth bridge page loaded in system browser after Google Sign-In
      if (req.method === 'GET' && pathname === '/oauth-bridge') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(createOAuthBridgeHtml());
        return;
      }

      // Receive OAuth payload from system browser and forward straight into Electron window
      if (req.method === 'POST' && pathname === '/__komo_oauth') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 100_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const encoded = typeof parsed.encoded === 'string' ? parsed.encoded : '';
            if (encoded && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents
                .executeJavaScript(
                  `window.__komoGoogleAuthResult && window.__komoGoogleAuthResult({ encoded: ${JSON.stringify(encoded)} });`
                )
                .catch(() => undefined);
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.show();
              mainWindow.focus();
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end('{"ok":false}');
          }
        });
        return;
      }

      // Serve static files from dist/ with fast in-memory caching
      const safeRel = pathname === '/' ? '/index.html' : pathname;
      let filePath = path.normalize(path.join(DIST_DIR, safeRel));
      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      try {
        const asset = readCachedAsset(filePath);
        res.writeHead(200, {
          'Content-Type': asset.contentType,
          'Content-Length': String(asset.buf.byteLength),
          'Cache-Control': asset.cacheControl,
        });
        res.end(asset.buf);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    let attempt = 0;
    let portIdx = 0;

    const tryListen = () => {
      const targetPort = PREFERRED_PORTS[portIdx] ?? PREFERRED_PORTS[0];
      server.listen(targetPort, '127.0.0.1', () => {
        const addr = server.address();
        resolve({ server, port: addr.port });
      });
    };

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Retry PREFERRED_PORTS[0] briefly in case a previous instance is still shutting down
        // so the HTTP origin (and thus IndexedDB/localStorage) NEVER changes unexpectedly!
        if (portIdx === 0 && attempt < 12) {
          attempt += 1;
          setTimeout(tryListen, 220);
          return;
        }
        if (portIdx + 1 < PREFERRED_PORTS.length) {
          portIdx += 1;
          attempt = 0;
          tryListen();
          return;
        }
      }
      reject(err);
    });

    tryListen();
  });
}

async function createWindow(port) {
  const iconPath = path.join(__dirname, 'icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Komolib',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#f3ede4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', () => {
    try {
      session.defaultSession.flushStorageData();
    } catch {
      // ignore flush errors
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => undefined);
    }
    return { action: 'deny' };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

// Single-instance lock so launching Komolib again focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.handle('komo:openExternal', async (_event, targetUrl) => {
    if (typeof targetUrl === 'string' && /^https?:\/\//i.test(targetUrl)) {
      await shell.openExternal(targetUrl);
      return true;
    }
    return false;
  });

  ipcMain.handle('komo:pickWatchFolder', async () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const res = await dialog.showOpenDialog(win, {
      title: 'Seleccionar carpeta de biblioteca KomoLib',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) return null;
    const selected = path.resolve(res.filePaths[0]);
    allowedWatchRoot = selected;
    return { path: selected, name: path.basename(selected) || selected };
  });

  ipcMain.handle('komo:scanWatchFolder', async (_event, folderPath, knownKeys = []) => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
      return { ok: false, error: 'Carpeta inválida', totalFound: 0, newFiles: [] };
    }
    const resolved = path.resolve(folderPath);
    try {
      const st = await fs.promises.stat(resolved);
      if (!st.isDirectory()) {
        return { ok: false, error: 'La carpeta ya no existe', totalFound: 0, newFiles: [] };
      }
    } catch {
      return { ok: false, error: 'No se pudo acceder a la carpeta', totalFound: 0, newFiles: [] };
    }
    allowedWatchRoot = resolved;
    const knownKeySet = new Set(Array.isArray(knownKeys) ? knownKeys.map((k) => String(k || '')) : []);
    const newFiles = [];
    const stats = { totalFound: 0 };
    await scanDirectoryRecursive(resolved, resolved, 0, knownKeySet, newFiles, stats);
    return { ok: true, totalFound: stats.totalFound, newFiles };
  });

  ipcMain.handle('komo:readWatchFile', async (_event, fullPath, rootHint = '') => {
    if (typeof fullPath !== 'string' || !fullPath.trim()) return null;
    const resolvedFile = path.resolve(fullPath);
    const root = allowedWatchRoot || (typeof rootHint === 'string' && rootHint ? path.resolve(rootHint) : '');
    if (!root || (!resolvedFile.startsWith(root + path.sep) && resolvedFile !== root)) {
      return null;
    }
    try {
      const buf = await fs.promises.readFile(resolvedFile);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  });

  app.whenReady().then(async () => {
    const started = await startStaticServer();
    localServer = started.server;
    await createWindow(started.port);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow(started.port);
      }
    });
  });

  app.on('before-quit', () => {
    try {
      session.defaultSession.flushStorageData();
    } catch {
      // ignore
    }
  });

  app.on('will-quit', () => {
    if (localServer) {
      localServer.close();
      localServer = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
