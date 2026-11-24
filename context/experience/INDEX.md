# Experience Index

> Searchable index of lessons, pitfalls, and reusable patterns for KomoLib.
> Format: keyword | file | summary

## By Domain

| Keywords | File | Summary |
|----------|------|---------|
| netlify, spa, json, fetch, api, unexpected-token | lessons/netlify-spa-api-guard.md | Route all sync/room API requests through `fetchApi`/`parseJsonResponse` to catch Netlify SPA HTML fallbacks cleanly. |
| vite, env, wasm, unrar, cbr, build | lessons/vite-build-time-env-and-unrar.md | `VITE_*` vars are baked at build time and `node-unrar-js` must stay excluded from Vite `optimizeDeps`. |
| render, netlify, indexeddb, mobile, sync-url, cold-start | lessons/stale-indexeddb-sync-url-migration.md | Auto-migrate outdated `*.onrender.com` / LAN / HTTP URLs cached in IndexedDB to `SYNC_SERVER_URL` and retry Render cold starts. |
| rooms, shelves, persistence, render, progress, indexeddb, 410 | lessons/shared-room-persistence-and-progress.md | Cache shared rooms/shelves in IndexedDB, auto-restore exact `KOMO-XXXX`/`SHELF-XXXX` codes on `404` (while respecting `410` tombstones), and flush book progress before leaving/closing a room. |
| render, cold-start, cors, google-drive, oauth, refresh-token, theme, reader-settings | lessons/render-coldstart-drive-oauth-and-reader-persistence.md | Wake sleeping Render via simple `GET /api/health`, share per-email Google refresh tokens for secondary devices, cache theme/reader settings in `localStorage` for instant paint, and merge `readerSettings` via `readerSettingsUpdatedAt`. |

## Recent Reports

| Date | File | Topic |
|------|------|-------|
| 2026-11 | reports/2026-11-aief-adoption.md | Initial AIEF L3 activation and knowledge-base bootstrap for KomoLib. |
