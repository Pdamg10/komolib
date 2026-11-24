# KomoLib — AI Engineering Guide (AIEF L3)

This is the repository-level entry point for AI-assisted engineering on **KomoLib**.

## Language & Communication
- Communicate with the user in **Spanish** by default.
- Keep code, filenames, CLI commands, types, and technical identifiers in **English**.

## Project Overview
- **One-liner:** Universal multi-format digital library & reader (Desktop PC App + Capacitor Android APK + Node.js live sync & shared reading server).
- **Core value:** Local-first reading experience (eBooks, PDF with text highlighting, Manga/Manhwa/Comics, Audiobooks) with warm customizable stationery, Google Drive & real-time PC ↔ APK sync via SSE, and spoiler-protected Buddy Read rooms (`KOMO-XXXX`) & mutual shelves (`SHELF-XXXX`).

## Quick Commands
- **Dev (Client):** `npm run dev` (Vite on `http://localhost:5173`)
- **Dev (Sync/Rooms API):** `npm run dev:server` (or `cd server && npm start`, Express on `http://0.0.0.0:4123`)
- **Typecheck & Build:** `npm run build` (`tsc -b && vite build`)
- **Sync Android Capacitor:** `npm run cap:sync`
- **Build Android Debug APK:** `JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./android/gradlew -p android assembleDebug`
- **AIEF Health Check:** `npm run aief:doctor`
- **AIEF Ref Validation:** `npm run aief:validate`

## Engineering Invariants & Guardrails
1. **Client + Persistent API architecture:** The React/Vite frontend (`dist/`) runs as a local-first Desktop PC app and Android APK (Capacitor); `server/` is a persistent Node.js API (Render/Railway/VPS) requiring disk (`KOMOLIB_STORAGE_DIR`) and long-lived SSE connections.
2. **API calls must use `fetchApi` / `parseJsonResponse`:** All frontend requests to the sync/rooms API go through helpers in `src/services/syncService.ts` so unexpected HTML proxy/503 responses produce actionable errors instead of `Unexpected token '<'` and Render cold starts wake cleanly.
3. **Local-first storage:** IndexedDB (`komolib-db` v2 in `src/db/localDb.ts`) is the primary client store; remote sync merges state with deletion tombstones (`deleted*Ids`).
4. **Build-time env vars:** `VITE_SYNC_SERVER_URL` and `VITE_PUBLIC_APP_URL` are baked into the bundle at `vite build` time.
5. **Secrets & runtime storage:** Never commit `.env` or `server/storage/`.
6. **WASM compatibility:** Keep `node-unrar-js` in `vite.config.ts` `optimizeDeps.exclude` so offline CBR/RAR extraction works in dev & production builds.

## Auto-Behavior (AIEF L3)
- **Phase Routing:** Follow `docs/standards/patterns/phase-router.md` and `workflow/INDEX.md` (`proposal → design → implement → review`, applying skip conditions for small/non-architectural changes).
- **Selective Context Loading:** Follow `docs/standards/patterns/context-loading.md`:
  - Domain entities / reading formats / shared rooms → `context/business/domain-model.md`
  - Architecture / sync / API / build / Capacitor → `context/tech/architecture.md` & `context/tech/REPO_SNAPSHOT.md`
  - Any non-trivial implementation or bug fix → search `context/experience/INDEX.md` first.
- **Compounding Experience:** Follow `docs/standards/patterns/experience-mgmt.md` — record newly discovered pitfalls or durable patterns under `context/experience/lessons/` and index them in `context/experience/INDEX.md`.

## Context & Workflow Entries
- Context Index: `context/INDEX.md`
- Project Profile: `context/PROJECT_PROFILE.yaml`
- Workflow Index: `workflow/INDEX.md`
- Standards & Patterns: `docs/standards/patterns/phase-router.md`, `docs/standards/patterns/context-loading.md`, `docs/standards/patterns/experience-mgmt.md`
- Tool Adapters: `.ai-adapters/README.md`
