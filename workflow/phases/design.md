# Design Phase — KomoLib

Use this phase for architectural changes, refactors, or changes spanning > 2 files. Skip for isolated bug fixes or pure docs/config updates.

## Design Guidelines
1. **Data & Persistence Model:**
   - Verify any schema changes to `src/types/library.ts` or IndexedDB (`src/db/localDb.ts`) remain backward-compatible with existing local libraries.
   - Preserve deletion tombstones (`deleted*Ids`, `410 Gone` for rooms/shelves) and LWW timestamps (`readerSettingsUpdatedAt`, `updatedAt`).
2. **API Contract & Dual-Backend Parity:**
   - Any endpoint added or modified in `cloudflare/src/index.js` (with D1 tables in `cloudflare/schema.sql`) must stay contract-compatible with `server/index.js` and `src/services/syncService.ts` / `src/services/sharedReadingService.ts`.
3. **Host Boundaries:**
   - Route Desktop/Android native capabilities exclusively through `src/utils/nativeBridge.ts` (`window.KomoDesktop` / `window.KomoAndroid`).
   - Respect `ReaderViewportMode` (`phone` / `tablet` / `desktop`) for any reader UI change.
4. **Modularity:** Avoid expanding monolithic hot files (`src/context/LibraryContext.tsx`, `server/index.js`, `cloudflare/src/index.js`) unnecessarily; extract focused utilities when introducing reusable logic.
