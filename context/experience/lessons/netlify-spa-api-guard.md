# Lesson: Guard Against Netlify SPA HTML Fallbacks on API Calls

## Context
KomoLib deploys the frontend SPA on Netlify (`netlify.toml` rewrites `/*` to `/index.html` with HTTP 200), while the Express API (`server/index.js`) is hosted separately.

## Pitfall
If `VITE_SYNC_SERVER_URL` is unset, misconfigured, or points at the Netlify origin, `fetch()` to `/api/...` returns HTTP `200 OK` with `index.html`. Calling `res.json()` directly throws the cryptic error `Unexpected token '<', "<!doctype "... is not valid JSON`.

## Solution & Rule
- Always use `fetchApi` and `parseJsonResponse` from `src/services/syncService.ts` (and `resolveServerUrl`) for API requests.
- Validate that `VITE_SYNC_SERVER_URL` is an HTTPS base URL without trailing `/` or `/api`.
- Verify any deployed backend by checking `GET <base>/api/health` returns JSON.
