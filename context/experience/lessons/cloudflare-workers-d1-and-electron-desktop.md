# Lesson: Cloudflare Workers + D1 Migration & Electron Desktop Session Stability

## Context
In v1.12–v1.12.1, KomoLib migrated its primary production Cloud API from Render Free to **Cloudflare Workers + D1** (`cloudflare/src/index.js`, `cloudflare/schema.sql`, `https://komolib-api.komolib.workers.dev`) and introduced a dedicated **Electron 45 Desktop PC App** (`electron/main.cjs`, `electron/preload.cjs`) for Linux (`AppImage`) and Windows (`NSIS`).

## Pitfalls
1. **Desktop IndexedDB/localStorage data loss on repackage or quick restart:**
   - Linux filesystems are case-sensitive (`~/.config/komolib` vs `~/.config/Komolib`). Changing `app.setName` or `productName` without pinning `userData` caused Electron to open a brand-new empty profile.
   - Falling back to `server.listen(0)` when port `41735` was briefly occupied (`EADDRINUSE`) changed the HTTP origin (`http://127.0.0.1:<random>`), isolating IndexedDB/localStorage from the user's real library.
   - Closing the window without flushing Chromium storage could drop pending IndexedDB/localStorage writes.
2. **Desktop Google Drive OAuth inside Electron:** Google blocks OAuth inside embedded Electron WebViews; auth must open in the user's system browser and hand the token back safely.
3. **Desktop Linux Wayland/GPU & icon integration:** Without explicit Chromium GPU/Wayland switches, RAM asset caching, and `komolib.desktop` / `AppUserModelId` binding, scrolling felt sluggish and taskbars showed a generic icon.
4. **Cloudflare D1 binary size limits:** D1 rows cannot store large whole eBook/comic blobs in a single statement.

## Solution & Rules
- **Pin `userData` and origin in `electron/main.cjs`:**
  - Always pin `app.setPath('userData', path.join(app.getPath('appData'), 'komolib'))` before `app.setName('Komolib')`.
  - Keep `PREFERRED_PORTS = [41735, 41736, 41737]` and retry port `41735` (up to 12 × 220 ms) on `EADDRINUSE` instead of binding to random port `0`.
  - Call `session.defaultSession.flushStorageData()` on `win.on('close')` and `app.on('before-quit')`, and keep `app.requestSingleInstanceLock()`.
- **System-browser OAuth bridge:** Serve `/oauth-bridge` and `POST /__komo_oauth` on Electron's local HTTP server to forward Google Drive auth into `window.__komoGoogleAuthResult` and refocus `mainWindow`.
- **Desktop performance & icon:** Keep Wayland/GPU switches (`ozone-platform-hint=auto`, `enable-gpu-rasterization`, `enable-zero-copy`, `WaylandWindowDecorations`, `CanvasOopRasterization`, `VaapiVideoDecoder`), in-memory `staticCache` (<= 4 MB assets), `app.setDesktopName('komolib.desktop')`, `app.setAppUserModelId('com.komolib.reader')`, and `electron/icon.png`.
- **Cloudflare D1 chunking & parity:** Store shared book binaries in `files_meta` + 512 KB chunks in `file_chunks`, persist `google_tokens` and `deleted_rooms`/`deleted_shelves` in D1, and maintain API contract parity between `cloudflare/src/index.js` and `server/index.js`.
