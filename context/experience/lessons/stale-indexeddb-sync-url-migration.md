# Lesson: Self-Heal Stale Sync Server URLs in IndexedDB

## Context
KomoLib stores `syncConfig.serverUrl` in IndexedDB (`komolib-db`) so users can pair with LAN or cloud servers. Production builds (Desktop PC / Android APK) inject the API URL via `VITE_SYNC_SERVER_URL` (falling back to `OFFICIAL_SYNC_SERVER_URL`).

## Pitfall
If a device previously saved an outdated Render subdomain (e.g. `https://komolib-api-ab12.onrender.com`), a temporary Cloudflare tunnel, or a stale LAN IP (`http://192.168.x.x:4123`), the stale URL stayed persisted in IndexedDB even after updating the build.

## Solution & Rule
- Normalize all server URLs with `normalizeServerUrl()` in `src/config.ts` (strip quotes, trailing `/api`, and trailing slashes).
- In `src/context/LibraryContext.tsx`, automatically migrate `syncConfig.serverUrl` to `SYNC_SERVER_URL` when the cached value is empty, `localhost`, a private LAN IP or `http://` URL on an HTTPS page, `trycloudflare.com`, or an outdated `*.onrender.com` subdomain.
- Wake sleeping `*.onrender.com` instances cleanly via `GET /api/health` inside `fetchApi`.
