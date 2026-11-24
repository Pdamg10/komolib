# Lesson: Render Cold-Start CORS Wake-Up, Secondary-Device Drive OAuth & Reader Settings LWW

## Context
KomoLib runs as a local-first Web PWA and Capacitor Android APK (`http://localhost`) backed by a Render Free Node.js API (`server/index.js`) and user-owned Google Drive storage.

## Pitfalls
1. **Render cold-start preflight failures:** `POST /api/google/refresh` with `Content-Type: application/json` triggers a CORS `OPTIONS` preflight. While Render Free spins up (30–55 s), its edge proxy returns `502/503` without CORS headers, throwing `TypeError: Failed to fetch`. Short retry windows (~15 s) and background Drive pollers surfacing transient network errors caused noisy technical alerts in the UI.
2. **Secondary device losing Google Drive session after 1 hour:** Google OAuth only returns a `refresh_token` when `prompt=consent` is sent (or on first authorization). Secondary devices signing in without re-consent received `refreshToken: ''` and expired after ~55 minutes.
3. **Reader settings & startup theme flashing/resetting:** Loading theme only from async IndexedDB caused a visible Komo Cream flash on startup; `updateReaderSettings` lacked its own `readerSettingsUpdatedAt` LWW timestamp, so background sync overwrote newly chosen paper themes and bookmark preferences with older remote values.

## Solution & Rules
- Wake `*.onrender.com` via single-flight `GET /api/health` (simple CORS request, no preflight) up to 55 s inside `fetchApi`, deduplicate concurrent `/api/google/refresh` calls, and defer `isTransientNetworkError` silently in background sync loops.
- Persist per-email Google `refresh_token` in `server/index.js` (`google_tokens.json`), reuse it for secondary devices without forcing extra consent prompts, and accept `{ refreshToken, email }` in `POST /api/google/refresh`.
- Mirror lightweight theme (`komolib_theme_cache_v1`), `readerSettings` (`komolib_reader_settings_v1`), and `googleDriveAuth` (`komolib_gdrive_auth_v1`) to `localStorage`, apply theme CSS vars in `index.html` before React mounts, and merge `readerSettings` using `readerSettingsUpdatedAt` LWW timestamps across client, Drive, and server.
