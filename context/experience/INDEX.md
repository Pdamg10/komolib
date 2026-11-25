# Experience Index

> Searchable index of lessons, pitfalls, and reusable patterns for KomoLib.
> Format: keyword | file | summary

## By Domain

| Keywords | File | Summary |
|----------|------|---------|
| vite, env, wasm, unrar, cbr, build | lessons/vite-build-time-env-and-unrar.md | `VITE_*` vars are baked at build time and `node-unrar-js` must stay excluded from Vite `optimizeDeps`. |
| render, indexeddb, mobile, sync-url, cold-start | lessons/stale-indexeddb-sync-url-migration.md | Auto-migrate outdated `*.onrender.com` / LAN / HTTP URLs cached in IndexedDB to `SYNC_SERVER_URL` and retry Render cold starts. |
| rooms, shelves, persistence, render, progress, indexeddb, 410 | lessons/shared-room-persistence-and-progress.md | Cache shared rooms/shelves in IndexedDB, auto-restore exact `KOMO-XXXX`/`SHELF-XXXX` codes on `404` (while respecting `410` tombstones), and flush book progress before leaving/closing a room. |
| render, cold-start, cors, google-drive, oauth, refresh-token, theme, reader-settings | lessons/render-coldstart-drive-oauth-and-reader-persistence.md | Wake sleeping Render via simple `GET /api/health`, share per-email Google refresh tokens for secondary devices, cache theme/reader settings in `localStorage` for instant paint, and merge `readerSettings` via `readerSettingsUpdatedAt`. |
| cloudflare, workers, d1, electron, desktop, userdata, origin, oauth-bridge, wayland, gpu | lessons/cloudflare-workers-d1-and-electron-desktop.md | Migrate primary API to Cloudflare Workers + D1 (512 KB chunked files, 0 ms cold start) and pin Electron `userData` (`komolib`), port `41735` origin retries, storage flush, Wayland/GPU flags, and `/oauth-bridge` OAuth flow. |
| reader, responsive, phone, tablet, desktop, rooms, shelves, profile-sync | lessons/adaptive-reader-and-shared-profile-sync.md | Auto-adapt reader chrome via `ReaderViewportMode` (`phone`/`tablet`/`desktop`) and broadcast user name/avatar updates across active rooms and shelves via `PATCH /api/shared/profile`. |
| performance, electron, low-end, gpu, backdrop-filter, ai-chat, markdown, sync, lww | lessons/perf-ai-chat-and-lww-sync.md | Memoize `LibraryContext` value, strip per-card GPU blur/drop-shadow, render zero-`*` adaptive AI chat (`UserAiProfile`), and close LWW/synchronous-`stateRef` sync gaps across Drive, Cloudflare, and Express. |

## Recent Reports

| Date | File | Topic |
|------|------|-------|
| 2026-11 | reports/2026-11-v1.12-cloudflare-electron-memory-sync.md | v1.12–v1.12.1 Cloudflare Workers + D1 migration, Electron Desktop PC app, adaptive reader, live profile sync, and full AIEF memory synchronization. |
| 2026-11 | reports/2026-11-aief-adoption.md | Initial AIEF L3 activation and knowledge-base bootstrap for KomoLib. |
