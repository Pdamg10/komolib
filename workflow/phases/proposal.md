# Proposal Phase — KomoLib

Use this phase for new features, architectural changes, or cross-target migrations. Skip for small, clearly scoped fixes (see `docs/standards/patterns/phase-router.md`).

## Checklist
1. **Problem & Goal:** State clearly what user pain or technical gap is being solved and what "done" looks like.
2. **Context Pre-Load:** Consult `context/business/domain-model.md`, `context/tech/architecture.md`, and `context/experience/INDEX.md` before proposing changes.
3. **Affected Targets:** Identify which of the 5 pieces are touched:
   - `src/` (React/Vite client SPA)
   - `electron/` (Desktop PC App — Linux AppImage / Windows NSIS)
   - `android/` (Capacitor Android APK & `KomoAndroid` bridge)
   - `cloudflare/` (Primary Cloudflare Workers + D1 API)
   - `server/` (Optional LAN / self-hosted Express API)
4. **Invariants Impact:** Confirm no regressions to local-first IndexedDB persistence, Desktop `userData`/port `41735` origin stability, Google Drive OAuth, `node-unrar-js` WASM loading, or `fetchApi`/`parseJsonResponse` safety.
