# Repo Snapshot — KomoLib

Snapshot maintained under AIEF L3 (updated for v1.12.1).

## Tech Stack
- **Language:** TypeScript 5.8 (frontend, `strict: true`), JavaScript ESM (`cloudflare/`, `server/`), CommonJS (`electron/`)
- **Frontend Framework:** React 19 + Vite 6 + Lucide icons
- **Local Storage:** IndexedDB (`idb`) + `localStorage` fast-paint caches + Android SAF zero-duplication URIs
- **Readers & Parsers:** `epubjs`, `pdfjs-dist`, `jszip`, `node-unrar-js` (WASM), `marked`, `sql.js` (SQLite backup parsing)
- **Desktop Packaging:** Electron 45 + `electron-builder` 26 (Linux AppImage + Windows NSIS)
- **Mobile Wrapper:** Capacitor 7 (`android/`, `com.komolib.reader`, `versionName 1.12.1`, `versionCode 14`)
- **Primary Cloud Backend:** Cloudflare Workers + D1 SQLite (`cloudflare/`, Wrangler 4)
- **Self-Hosted / LAN Backend:** Node.js 22 + Express 5 + Multer 2 + CORS + SSE (`server/`)
- **Package Manager:** npm

## Repo Layout (Top Level)
- `AGENTS.md` — AIEF root entry point & mandatory memory-sync rules
- `README.md` — Project overview, architecture, build & deployment guide
- `src/` — Frontend React application (`components/`, `context/`, `data/`, `db/`, `parsers/`, `services/`, `styles/`, `types/`, `utils/`)
- `electron/` — Desktop PC Electron shell (`main.cjs`, `preload.cjs`, `icon.png`)
- `cloudflare/` — Production Cloudflare Workers + D1 Cloud API (`cloudflare/src/index.js`, `cloudflare/schema.sql`, `cloudflare/wrangler.toml`, `cloudflare/README.md`)
- `server/` — Standalone Express sync, rooms, shelves, LAN inbox & Gemini proxy API (`index.js`)
- `android/` — Capacitor Android project (`app/build.gradle`, native `KomoAndroid` bridge)
- `public/` — PWA manifest, app icon, and built-in visual bookmarks (`public/bookmarks/*.webp`)
- `release/` — Local Desktop AppImage/installer build outputs (gitignored)
- `context/` — AIEF structured knowledge base (`PROJECT_PROFILE.yaml`, `business/`, `tech/`, `experience/`)
- `workflow/` — AIEF phase playbooks (`proposal`, `design`, `implement`, `review`)
- `docs/standards/` — AIEF specifications & L3 cross-cutting patterns
- `scripts/aief.mjs` — AIEF reference validator & health CLI
- `.ai-adapters/` — AI tool adapter docs (`.cursor/rules/aief.mdc`, `.github/copilot-instructions.md`)
- `.github/workflows/build-apk.yml` — CI workflow for client build & Android Debug APK (`Komolib.apk`)

## Modules / Services
- **Frontend SPA (`src/`)**: Local-first reader, auto-adaptive phone/tablet/desktop reader chrome, library UI, parsers & external backup importer, IndexedDB persistence, Google Drive & API sync client
- **Desktop Shell (`electron/`)**: Local static origin server (`127.0.0.1:41735`), OAuth system-browser bridge, Wayland/GPU acceleration, RAM asset cache, pinned `userData`
- **Cloud API (`cloudflare/`)**: Serverless 0 ms cold-start API with D1 persistence for Google OAuth tokens, Buddy Read rooms (`KOMO-XXXX`), Shared Shelves (`SHELF-XXXX`), sync spaces, chunked files, profile broadcast, and Gemini AI
- **Self-Hosted API (`server/index.js`)**: Express + disk storage alternative with SSE streams and LAN web upload inbox (`/upload`, `/send`)
- **Android Packaging (`android/`)**: Capacitor native shell synced from `dist/` with native SAF/backup/OAuth bridge

## Infra & CI
- **CI:** GitHub Actions (`.github/workflows/build-apk.yml` — Node 22 + Java 21 Temurin → `Komolib-apk` artifact containing `Komolib.apk`)
- **Client Targets:** Desktop PC App (`electron/`, Linux AppImage & Windows NSIS) + Android APK (`android/`, Capacitor 7)
- **Primary API Hosting:** Cloudflare Workers + D1 (`https://komolib-api.komolib.workers.dev`)
- **Optional Self-Hosted API:** Persistent Node.js host (LAN / VPS / Render / Railway / Fly.io) with volume at `KOMOLIB_STORAGE_DIR`

## Commands
- **Dev (Web):** `npm run dev`
- **Dev (Desktop):** `npm run desktop` / `npm run desktop:run`
- **Build Desktop:** `npm run desktop:build:linux` / `npm run desktop:build:win`
- **Dev (Express API):** `npm run dev:server`
- **Cloudflare API:** `cd cloudflare && npm run dev` / `npm run db:init` / `npm run deploy`
- **Build & Typecheck:** `npm run build`
- **Android Sync:** `npm run cap:sync`
- **Android Debug APK:** `JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./android/gradlew -p android assembleDebug`
- **AIEF Doctor:** `npm run aief:doctor`
- **AIEF Validate Refs:** `npm run aief:validate`
