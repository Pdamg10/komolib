# Implement Phase — KomoLib

Execute the scoped changes cleanly while honoring all guardrails in `AGENTS.md`.

## Execution Steps
1. **Implement with strict types:** Keep `src/` clean under TypeScript `strict: true` (`tsconfig.app.json`) with zero unused locals/parameters and no duplicated helpers.
2. **Keep backends & native bridges aligned:** Mirror shared API changes across `cloudflare/src/index.js` and `server/index.js`, and verify `electron/main.cjs` preserves pinned `userData` (`komolib`) and `127.0.0.1:41735` origin stability.
3. **Verify build & syntax:**
   - Frontend: `npm run build` (`tsc -b && vite build`)
   - JS runtimes (when modified): `node --check electron/main.cjs electron/preload.cjs cloudflare/src/index.js server/index.js`
   - Android sync (when shipping APK): `npm run cap:sync`
4. **Mandatory Post-Change Memory Sync:** Update affected files under `context/` (`PROJECT_PROFILE.yaml`, `tech/architecture.md`, `tech/REPO_SNAPSHOT.md`, `business/domain-model.md`, `experience/lessons/` + `experience/INDEX.md`, `experience/reports/`) and run `npm run aief:validate`.
