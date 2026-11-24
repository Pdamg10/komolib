# Architecture — KomoLib

## System Topology

KomoLib is split into three cooperating targets inside one repository:

1. **Client App (`src/`)** — React 19, TypeScript 5.8 (`strict: true`), Vite 6 (`base: './'`, `target: 'es2022'`). Packaged for Desktop PC and Android APK.
2. **Sync & Collaboration Server (`server/index.js`)** — Node.js 22 + Express 5 + Multer 2 + CORS. Deployed independently on a persistent Node host (Render / Railway / Fly.io / VPS) with disk storage (`KOMOLIB_STORAGE_DIR`, default `server/storage/`).
3. **Android APK (`android/`)** — Capacitor 7 (`com.komolib.reader`) wrapping `dist/`. Configured with `androidScheme: 'http'`, `cleartext: true`, and `allowMixedContent: true` to support LAN sync servers alongside HTTPS hosts.

## Modules

### Frontend (`src/`)
- `src/config.ts` — Normalizes build-time `VITE_SYNC_SERVER_URL` and `VITE_PUBLIC_APP_URL`.
- `src/db/localDb.ts` — IndexedDB (`komolib-db`, version 2) with object stores: `books`, `files`, `bookmarks`, `annotations`, `notes`, `kv`.
- `src/context/LibraryContext.tsx` — Central application state, IndexedDB persistence, live SSE sync, room/shelf orchestration, and AI chat state.
- `src/parsers/` — Client-side format detection, metadata/cover extraction, and parsing (`epubParser`, `pdfParser`, `comicParser` with `jszip` & `node-unrar-js` WASM, `mobiParser`, `textParser`, `audioCoverParser`, `coverGenerator`).
- `src/components/readers/` — Multi-format reader suite (`ReaderShell`, `EpubReader`, `PdfReader`, `ComicMangaReader`, `TextRichReader`, `readerThemes.ts`) plus `AudioPlayerBar`.
- `src/services/syncService.ts` — Sync API client, `fetchApi` + `parseJsonResponse` SPA-fallback guard, SSE subscription, binary upload/download, and deterministic space ID derivation.
- `src/services/sharedReadingService.ts` — Buddy Read (`KOMO-XXXX`) and Shared Shelf (`SHELF-XXXX`) API client.
- `src/utils/` — Folder import grouping, inline SVG QR code generator (`qrCodeSvg.ts`), reader marks engine (`readerMarks.ts`), reading statistics (`readingStats.ts`), wallpaper theming.

### Backend (`server/index.js`)
- **Health & Network:** `GET /api/health`, `GET /api/network-info`
- **Personal Sync (space-scoped):** `GET /api/sync/state`, `PUT /api/sync/state`, `GET /api/sync/stream` (SSE)
- **Book Binaries:** `POST /api/books/upload`, `GET /api/books/:id/file`, `DELETE /api/books/:id`
- **Shared Rooms (`KOMO-XXXX`):** `GET/POST /api/rooms`, `GET/DELETE /api/rooms/:code`, `POST /api/rooms/:code/join`, `PATCH /api/rooms/:code/progress`, `POST /api/rooms/:code/comments`, `GET /api/rooms/:code/file`, `GET /api/rooms/:code/stream` (SSE), `POST /api/rooms/:code/leave`
- **Shared Shelves (`SHELF-XXXX`):** `GET/POST /api/shelves`, `GET/DELETE /api/shelves/:code`, `POST /api/shelves/:code/join`, `POST /api/shelves/:code/books`, `GET/DELETE /api/shelves/:code/books/:bookId(/file)`, `POST /api/shelves/:code/leave`, `GET /api/shelves/:code/stream` (SSE)
- **LAN Upload Inbox:** `GET /upload`, `GET /send`, `GET /api/inbox`, `POST /api/inbox/upload`, `GET/DELETE /api/inbox/:id(/file)`
- **AI Assistant Proxy:** `POST /api/ai/chat` (Gemini API via `GEMINI_API_KEY` & `GEMINI_MODEL`)

## Boundaries
- **Frontend ↔ Server:** Strictly HTTP/JSON + multipart binary uploads + Server-Sent Events (SSE). Never import `server/` code from `src/`.
- **Persistence:** Client binary blobs live in IndexedDB `files` store; server files live under `KOMOLIB_STORAGE_DIR/{spaces,files,inbox}` and JSON state files (`state.json`, `rooms.json`, `shelves.json`, `inbox.json`).
- **Environment:** `server/index.js` loads `.env` from repo root and `server/.env` without external `dotenv` dependency. Frontend only sees `VITE_*` variables compiled at build time.

## Risks & Technical Debt
- **Monolithic hot files:** `src/context/LibraryContext.tsx` (~3.2k lines) and `server/index.js` (~1.8k lines) concentrate many concerns; extract cohesive modules carefully before adding large features.
- **Unexpected HTML responses / Render cold starts:** Always keep `fetchApi`/`parseJsonResponse` in place so 503/HTML proxy responses never throw cryptic JSON parse errors.
- **Ephemeral cloud disks:** Hosting `server/` without a mounted volume for `KOMOLIB_STORAGE_DIR` wipes uploaded books and room state on restart.
- **No automated test suite yet:** Verification currently relies on `npm run build` (`tsc -b && vite build`), manual smoke tests, and CI APK builds (`.github/workflows/build-apk.yml`).
