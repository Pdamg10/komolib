# Lesson: Self-Heal Stale Sync Server URLs in Mobile/Tablet IndexedDB

## Context
KomoLib stores `syncConfig.serverUrl` in IndexedDB (`komolib-db`) so users can pair with LAN or cloud servers. Hosted Netlify builds inject the production API URL via `VITE_SYNC_SERVER_URL`.

## Pitfall
If a Netlify deployment ever shipped with a typoed/placeholder Render URL (e.g. `https://komolib-api-ab12.onrender.com` instead of `https://komolib-api.onrender.com`), or a mobile device previously saved an HTTP LAN IP (`http://192.168.x.x:4123`), the stale URL stayed persisted in IndexedDB even after `VITE_SYNC_SERVER_URL` was corrected and redeployed on Netlify. Desktop browsers that already had the valid URL in IndexedDB appeared to work while mobile/tablet browsers kept failing with `Failed to fetch`.

## Solution & Rule
- Normalize all server URLs with `normalizeServerUrl()` in `src/config.ts` (strip quotes, trailing `/api`, and trailing slashes).
- In `src/context/LibraryContext.tsx`, automatically migrate `syncConfig.serverUrl` to `SYNC_SERVER_URL` when the cached value is empty, `localhost`, a private LAN IP or `http://` URL on an HTTPS page, `trycloudflare.com`, `netlify.app`, or an outdated `*.onrender.com` subdomain.
- Retry `checkServerHealth` and idempotent `GET` requests briefly on `*.onrender.com` to absorb Render Free cold starts on mobile browsers.
- Never silently fall back to `*.netlify.app` as the sync API origin.
