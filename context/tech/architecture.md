# Architecture — KomoLib

## System Topology

KomoLib is structured into five cooperating targets inside one repository:

1. **Client SPA (`src/`)** — React 19, TypeScript 5.8 (`strict: true`), Vite 6 (`base: './'`, `target: 'es2022'`, manual vendor chunks for React, Lucide icons, PDF.js, and EPUB.js/JSZip). Local-first reader, library, stationery, backup importer, Google Drive sync, and collaborative rooms UI.
2. **Desktop PC App (`electron/`)** — Electron 45 (`electron/main.cjs`, `electron/preload.cjs`) packaged via `electron-builder` for Linux (`Komolib-<version>.AppImage`) and Windows (`NSIS`).
   - Serves `dist/` from an in-process HTTP server on `127.0.0.1` (`PREFERRED_PORTS = [41735, 41736, 41737]`, retrying port `41735` up to 12 times on `EADDRINUSE` so the origin and IndexedDB/localStorage never drift across restarts).
   - Pins `userData` to lowercase `path.join(app.getPath('appData'), 'komolib')` across Linux and Windows, enables single-instance lock, flushes storage (`session.defaultSession.flushStorageData()`) on `close`/`before-quit`, and caches static assets <= 4 MB in RAM.
   - Enables Wayland/GPU acceleration switches (`ozone-platform-hint=auto`, `enable-gpu-rasterization`, `enable-zero-copy`, `WaylandWindowDecorations`, `CanvasOopRasterization`, `VaapiVideoDecoder`) and desktop identity (`komolib.desktop` on Linux, `com.komolib.reader` AppUserModelId on Windows, `electron/icon.png`).
   - Hosts `/oauth-bridge` + `POST /__komo_oauth` to receive Google Drive OAuth payloads from the system browser and forward them directly into the Electron renderer (`window.__komoGoogleAuthResult`).
3. **Android APK (`android/`)** — Capacitor 7 (`com.komolib.reader`, `versionName "1.13.0"`, `versionCode 17`, output `Komolib.apk`) wrapping `dist/`. Configured with `androidScheme: 'http'`, `cleartext: true`, and `allowMixedContent: true` for LAN + HTTPS compatibility, plus a native JavaScript bridge (`window.KomoAndroid`) for Android SAF folder scanning (`ACTION_OPEN_DOCUMENT_TREE`), zero-duplication `content://` streaming, >2 GB backup extraction (`FileChannel`/ZIP64), MediaStore Downloads saving, Share Sheet, clipboard, and native Google OAuth deep-link handoff.
4. **Primary Cloud API (`cloudflare/`)** — Cloudflare Workers + Cloudflare D1 SQLite (`cloudflare/src/index.js`, `cloudflare/schema.sql`, `cloudflare/wrangler.toml`, deployed at `https://komolib-api.komolib.workers.dev`). Zero cold-start serverless API with 8 persistent D1 tables (`google_tokens`, `rooms`, `deleted_rooms`, `shelves`, `deleted_shelves`, `sync_spaces`, `files_meta`, `file_chunks` in 512 KB chunks).
5. **Self-Hosted / LAN Sync Server (`server/index.js`)** — Node.js 22 + Express 5 + Multer 2 + CORS + SSE. Drop-in self-hosted/LAN/VPS alternative with persistent disk storage (`KOMOLIB_STORAGE_DIR`, default `server/storage/`), real-time SSE streams, and the LAN web upload inbox (`/upload`, `/send`).

## Modules

### Frontend (`src/`)
- `src/config.ts` — Normalizes build-time `VITE_SYNC_SERVER_URL` and `VITE_PUBLIC_APP_URL`; production builds default to `OFFICIAL_SYNC_SERVER_URL = 'https://komolib-api.komolib.workers.dev'`.
- `index.html` — Pre-mount bootstrap script that applies cached theme CSS variables from `localStorage` (`komolib_theme_cache_v1`) before React hydrates to eliminate startup theme flash.
- `src/db/localDb.ts` — IndexedDB (`komolib-db`, version 2) with object stores: `books`, `files`, `bookmarks`, `annotations`, `notes`, `kv`.
- `src/context/LibraryContext.tsx` — Central application state, IndexedDB persistence, `localStorage` mirrors (`komolib_theme_cache_v1`, `komolib_reader_settings_v1`, `komolib_gdrive_auth_v1`), Google Drive & API sync, live room/shelf orchestration, profile propagation, and AI chat state.
- `src/parsers/` — Client-side format detection, metadata/cover extraction, and backup migration:
  - Book/media parsers: `epubParser`, `pdfParser`, `comicParser` (`jszip` + `node-unrar-js` WASM), `mobiParser`, `textParser`, `audioCoverParser`, `coverGenerator`.
  - `externalBackupParser.ts` — Imports libraries, reading progress, bookmarks, annotations, and covers from KomoLib JSON, Moon+ Reader (`.mrpro`, `.po`, `.mrexpt`, `mrbooks.db` via `sql.js`), ReadEra, Tachiyomi/Mihon/Aniyomi, Kotatsu, KOReader (`.lua`/JSON), Goodreads/StoryGraph/Calibre CSV, and Kindle `My Clippings.txt`.
- `src/components/readers/` — Multi-format reader suite with auto-adaptive `ReaderViewportMode` (`phone` <= 640px, `tablet` <= 1024px, `desktop` > 1024px): `ReaderShell`, `EpubReader`, `PdfReader` (with text selection/highlighting + pin mode), `ComicMangaReader`, `TextRichReader`, `readerThemes.ts`, plus `AudioPlayerBar`.
- `src/services/syncService.ts` — Sync API client, `fetchApi` + `parseJsonResponse` guard, Render cold-start wake-up compatibility, SSE subscription, binary upload/download, and deterministic `deriveEmailSpaceId` derivation.
- `src/services/googleDriveService.ts` — Google Drive OAuth flow (Web, Desktop `/oauth-bridge`, Android native), token refresh deduplication, and `Komolib/Libros` file/state sync.
- `src/services/sharedReadingService.ts` — Buddy Read (`KOMO-XXXX`), Shared Shelf (`SHELF-XXXX`), auto-restore (`PUT .../restore`), kick moderation, and live cross-room/shelf profile sync (`PATCH /api/shared/profile`).
- `src/utils/` — `nativeBridge.ts` (`KomoAndroid` & `KomoDesktop` bridges), `aiAssistantUtils.ts` (zero-`*` reply sanitizer, clean block parser, reader taste summary, incremental per-user `UserAiProfile` learning), `mangaSeriesUtils.ts` (Manga/Manhwa/Comic chapter-pack detection, deduplication, ascending sorting, gap detection, Telegram card `NFKD` parser, and reader prev/next navigation), `fileFolderImport.ts`, `bookMetadata.ts`, `bookExcerpt.ts`, `coverHelpers.ts`, `qrCodeSvg.ts`, `readerMarks.ts`, `readingStats.ts`, `wallpaperTheme.ts`.

### Cloud API (`cloudflare/src/index.js`) & Self-Hosted API (`server/index.js`)
- **Health & Network:** `GET /api/health`, `GET /api/network-info`
- **Google Drive OAuth & Token Vault:** `GET /api/google/status`, `GET /api/google/start`, `GET /api/google/callback`, `POST /api/google/refresh` (persists per-email `refresh_token` in D1 `google_tokens` or `google_tokens.json`)
- **Personal Sync (space-scoped):** `GET /api/sync/state`, `PUT /api/sync/state`, `GET /api/sync/stream` (SSE on Express)
- **Book Binaries:** `POST /api/books/upload`, `GET /api/books/:id/file`, `DELETE /api/books/:id` (+ `POST /api/books/:id/request-upload` on Express)
- **Shared Rooms (`KOMO-XXXX`):** `GET/POST /api/rooms`, `GET/DELETE /api/rooms/:code`, `PUT /api/rooms/:code/restore`, `POST /api/rooms/:code/join`, `PATCH /api/rooms/:code/progress`, `POST /api/rooms/:code/comments`, `GET /api/rooms/:code/file`, `POST /api/rooms/:code/leave`, `POST /api/rooms/:code/kick`, `GET /api/rooms/:code/stream`
- **Shared Shelves (`SHELF-XXXX`):** `GET/POST /api/shelves`, `GET/DELETE /api/shelves/:code`, `PUT /api/shelves/:code/restore`, `POST /api/shelves/:code/join`, `POST /api/shelves/:code/books`, `GET/DELETE /api/shelves/:code/books/:bookId(/file)`, `POST /api/shelves/:code/leave`, `POST /api/shelves/:code/kick`, `GET /api/shelves/:code/stream`
- **Shared Profile Broadcast:** `PATCH /api/shared/profile` (propagates name/avatar updates across all rooms & shelves)
- **AI Assistant Proxy:** `POST /api/ai/chat`, `POST /api/ai/identify-book` (Gemini API via `GEMINI_API_KEY` & `GEMINI_MODEL`)
- **LAN Upload Inbox (`server/index.js` only):** `GET /upload`, `GET /send`, `GET /api/inbox`, `POST /api/inbox/upload`, `GET/DELETE /api/inbox/:id(/file)`

## Boundaries
- **Frontend ↔ Backends:** Strictly HTTP/JSON + multipart binary uploads + polling/SSE. Never import `cloudflare/`, `server/`, or `electron/` code from `src/`.
- **Renderer ↔ Native Hosts:** All Desktop/Android host capabilities pass strictly through `src/utils/nativeBridge.ts` (`window.KomoDesktop` / `window.KomoAndroid`).
- **Persistence:** Client blobs live in IndexedDB `files` store (or streamed on-demand via Android SAF `nativeFileUri`); Cloudflare API persists JSON & 512 KB binary chunks in D1 SQLite; Express server persists under `KOMOLIB_STORAGE_DIR/{spaces,files,inbox}` and JSON state files.
- **Environment:** `cloudflare/` uses `wrangler.toml` vars + Wrangler secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`). `server/index.js` loads `.env` from repo root and `server/.env` without `dotenv`. Frontend only sees `VITE_*` variables baked at build time.

## Risks & Technical Debt
- **Monolithic hot files:** `src/context/LibraryContext.tsx` (~7.5k lines), `server/index.js` (~2.9k lines), `src/parsers/externalBackupParser.ts` (~2.5k lines), and `cloudflare/src/index.js` (~1.6k lines) concentrate many concerns; extract cohesive modules carefully before major expansions.
- **Dual-backend parity:** Because `cloudflare/src/index.js` and `server/index.js` share the same frontend contract, API changes must be mirrored across both implementations.
- **Unexpected HTML responses / Legacy Render cold starts:** Always keep `fetchApi`/`parseJsonResponse` in place so proxy HTML/503 responses never throw cryptic JSON parse errors and legacy Render hosts still wake cleanly.
- **Desktop origin & `userData` sensitivity:** Changing `electron/main.cjs` `userData` casing or falling back to ephemeral port `0` splits IndexedDB/localStorage and looks like data loss to Desktop users.
- **No automated test suite yet:** Verification currently relies on `npm run build` (`tsc -b && vite build`), `npm run aief:validate`, manual smoke tests, and CI APK builds (`.github/workflows/build-apk.yml`).
