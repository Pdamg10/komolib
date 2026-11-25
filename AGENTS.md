# KomoLib — AI Engineering Guide (AIEF L3)

This is the repository-level entry point for AI-assisted engineering on **KomoLib** (v1.12.x).

## Language & Communication
- Communicate with the user in **Spanish** by default.
- Keep code, filenames, CLI commands, types, and technical identifiers in **English**.

## Project Overview
- **One-liner:** Universal multi-format digital library & reader (Electron Desktop PC App + Capacitor Android APK + Cloudflare Workers/D1 Cloud API + optional Node.js LAN/self-hosted server).
- **Core value:** Local-first reading experience (eBooks, PDF with text highlighting & pin mode, Manga/Manhwa/Comics, Audiobooks) with warm customizable stationery, external backup migration (Moon+ Reader, ReadEra, Tachiyomi/Mihon, KOReader, Goodreads/Calibre, Kindle), Google Drive personal vault sync, real-time PC ↔ APK sync, AI assistant (Gemini), and spoiler-protected Buddy Read rooms (`KOMO-XXXX`) & mutual shelves (`SHELF-XXXX`).

## Quick Commands
- **Dev (Client Web):** `npm run dev` (Vite on `http://localhost:5173`)
- **Dev (Desktop Electron):** `npm run desktop` (`npm run build && electron .`) or `npm run desktop:run`
- **Build Desktop Packages:** `npm run desktop:build:linux` (`release/Komolib-<version>.AppImage`) / `npm run desktop:build:win` (NSIS)
- **Cloud API (Cloudflare Workers + D1):** `cd cloudflare && npm run dev` / `npm run db:init` / `npm run deploy`
- **Self-Hosted/LAN API (Express):** `npm run dev:server` (or `cd server && npm start`, Express on `http://0.0.0.0:4123`)
- **Typecheck & Build:** `npm run build` (`tsc -b && vite build`)
- **Sync Android Capacitor:** `npm run cap:sync`
- **Build Android Debug APK:** `JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./android/gradlew -p android assembleDebug` → `android/app/build/outputs/apk/debug/Komolib.apk`
- **AIEF Health Check:** `npm run aief:doctor`
- **AIEF Ref Validation:** `npm run aief:validate`

## Engineering Invariants & Guardrails
1. **Multi-target local-first architecture:** The React/Vite frontend (`src/` → `dist/`) runs inside **Electron Desktop (`electron/`)** and **Android APK (`android/`, Capacitor 7)**. Cloud features (Google Drive OAuth token vault, Buddy Read rooms, Shared Shelves, sync state, Gemini AI) run primarily on **Cloudflare Workers + D1 (`cloudflare/`)** (`https://komolib-api.komolib.workers.dev`, 0 ms cold start) with **Node.js Express (`server/`)** as a self-hosted / LAN / VPS alternative.
2. **API parity & safe JSON parsing:** Changes to shared endpoints (rooms, shelves, Google OAuth, profile sync, AI) must stay compatible across `cloudflare/src/index.js` and `server/index.js`. All frontend requests must go through `fetchApi` / `parseJsonResponse` in `src/services/syncService.ts` so unexpected HTML/503 responses never throw `Unexpected token '<'`.
3. **Local-first storage & Desktop origin stability:** IndexedDB (`komolib-db` v2 in `src/db/localDb.ts`) is the primary client store; remote sync merges state with deletion tombstones (`deleted*Ids`) and LWW timestamps (`readerSettingsUpdatedAt`). In `electron/main.cjs`, never break the pinned lowercase `appData/komolib` `userData` path or `127.0.0.1:41735` origin stability (otherwise Desktop IndexedDB/localStorage splits into an empty profile).
4. **Build-time env vars:** `VITE_SYNC_SERVER_URL` and `VITE_PUBLIC_APP_URL` are baked into the bundle at `vite build` time (defaulting in production to `OFFICIAL_SYNC_SERVER_URL` in `src/config.ts`).
5. **Secrets & runtime storage:** Never commit `.env`, `server/storage/`, or `release/` build artifacts.
6. **WASM compatibility:** Keep `node-unrar-js` in `vite.config.ts` `optimizeDeps.exclude` and `base: './'` so offline CBR/RAR extraction and Capacitor/Electron relative asset loading work in dev & production.
7. **Mandatory Post-Change Memory Sync (NON-NEGOTIABLE):** After completing **every** code, architecture, config, or workflow change, you MUST update the project memory under `context/` before finishing the task:
   - Update `context/PROJECT_PROFILE.yaml`, `context/tech/architecture.md`, `context/tech/REPO_SNAPSHOT.md`, and/or `context/business/domain-model.md` whenever stack, modules, endpoints, entities, versions, or commands change.
   - Add or update a lesson in `context/experience/lessons/` and index it in `context/experience/INDEX.md` whenever a bug, pitfall, invariant, or durable pattern is discovered or changed.
   - Record significant releases or multi-file milestones in `context/experience/reports/` and index them in `context/experience/INDEX.md`.
   - Run `npm run aief:validate` after updating memory files to guarantee zero broken references.

## Auto-Behavior (AIEF L3)
- **Phase Routing:** Follow `docs/standards/patterns/phase-router.md` and `workflow/INDEX.md` (`proposal → design → implement → review`, applying skip conditions for small/non-architectural changes).
- **Selective Context Loading:** Follow `docs/standards/patterns/context-loading.md`:
  - Domain entities / reading formats / external backups / shared rooms → `context/business/domain-model.md`
  - Architecture / Electron / Cloudflare D1 / Express / sync / Capacitor → `context/tech/architecture.md` & `context/tech/REPO_SNAPSHOT.md`
  - Any non-trivial implementation or bug fix → search `context/experience/INDEX.md` first.
- **Compounding Experience:** Follow `docs/standards/patterns/experience-mgmt.md` — always keep `context/` synchronized after every change so memory never drifts from the codebase.

## Context & Workflow Entries
- Context Index: `context/INDEX.md`
- Project Profile: `context/PROJECT_PROFILE.yaml`
- Workflow Index: `workflow/INDEX.md`
- Standards & Patterns: `docs/standards/patterns/phase-router.md`, `docs/standards/patterns/context-loading.md`, `docs/standards/patterns/experience-mgmt.md`
- Tool Adapters: `.ai-adapters/README.md`
