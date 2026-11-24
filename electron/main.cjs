const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// GPU & Wayland hardware-acceleration tuning for smooth 60-144 FPS on Linux (Wayland/X11) & Windows
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch(
  'enable-features',
  'WaylandWindowDecorations,CanvasOopRasterization,VaapiVideoDecoder'
);

app.setName('Komolib');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.komolib.reader');
}
if (process.platform === 'linux' && typeof app.setDesktopName === 'function') {
  app.setDesktopName('komolib.desktop');
}

const DIST_DIR = path.join(__dirname, '..', 'dist');
const PREFERRED_PORT = 41735;

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

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          resolve({ server, port: addr.port });
        });
      } else {
        reject(err);
      }
    });

    server.listen(PREFERRED_PORT, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
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
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
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

  app.on('window-all-closed', () => {
    if (localServer) {
      localServer.close();
      localServer = null;
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
