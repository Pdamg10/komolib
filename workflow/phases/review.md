# Review Phase — KomoLib

Final verification gate before finishing a task or cutting a release.

## Acceptance Checklist
- [ ] **Build passes:** `npm run build` succeeds with zero TypeScript or Vite bundling errors.
- [ ] **No dead code or secrets:** `git status` and `git diff` contain no `.env`, `server/storage/`, `release/` artifacts, broken stubs, or accidental duplicates.
- [ ] **Cross-target safety:**
  - Desktop Electron (`electron/main.cjs`): `userData` pinned to lowercase `komolib`, `PREFERRED_PORTS` intact, `flushStorageData()` preserved.
  - Cloud & LAN APIs: `cloudflare/src/index.js` and `server/index.js` remain contract-compatible.
  - Reader UI: verified against `phone`, `tablet`, and `desktop` viewport breakpoints when reader components changed.
- [ ] **Memory synchronized:** `context/` reflects all architectural, version, command, or lesson changes, and both `npm run aief:validate` and `npm run aief:doctor` pass with 0 warnings/errors.
