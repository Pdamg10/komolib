# Repo Snapshot — KomoLib

Snapshot maintained under AIEF L3.

## Tech Stack
- **Language:** TypeScript 5.8 (frontend, `strict: true`), JavaScript ESM (Node.js server)
- **Frontend Framework:** React 19 + Vite 6
- **Local Storage:** IndexedDB (`idb`)
- **Readers & Parsers:** `epubjs`, `pdfjs-dist`, `jszip`, `node-unrar-js` (WASM), `marked`
- **Backend:** Node.js 22 + Express 5 + Multer 2 + CORS + SSE
- **Mobile Wrapper:** Capacitor 7 (`android/`, `com.komolib.reader`)
- **Package Manager:** npm

## Repo Layout (Top Level)
- `AGENTS.md` — AIEF root entry point for AI assistants
- `src/` — Frontend React application (`components/`, `context/`, `data/`, `db/`, `parsers/`, `services/`, `styles/`, `types/`, `utils/`)
- `server/` — Standalone Express sync, rooms, shelves, inbox & Gemini proxy API
- `android/` — Capacitor Android project
- `public/` — PWA manifest, app icon, and built-in visual bookmarks (`public/bookmarks/*.webp`)
- `context/` — AIEF structured knowledge base (`PROJECT_PROFILE.yaml`, `business/`, `tech/`, `experience/`)
- `workflow/` — AIEF phase playbooks (`proposal`, `design`, `implement`, `review`)
- `docs/standards/` — AIEF specifications & L3 cross-cutting patterns
- `scripts/aief.mjs` — AIEF reference validator & health CLI
- `.ai-adapters/` — AI tool adapter docs (`.cursor/rules/aief.mdc`, `.github/copilot-instructions.md`)
- `.github/workflows/build-apk.yml` — CI workflow for client build & Android Debug APK

## Modules / Services
- **Frontend SPA (`src/`)**: Local-first reader, library UI, parsers, IndexedDB persistence, SSE sync client
- **Sync & Collaboration API (`server/index.js`)**: Multi-space sync, Buddy Read rooms (`KOMO-XXXX`), Shared Shelves (`SHELF-XXXX`), LAN inbox, Gemini chat proxy
- **Android Packaging (`android/`)**: Capacitor native shell synced from `dist/`

## Infra & CI
- **CI:** GitHub Actions (`.github/workflows/build-apk.yml` — Node 22 + Java 21 Temurin → `app-debug.apk` artifact)
- **Client Targets:** Desktop PC App + Android APK (`android/`, Capacitor 7)
- **API Hosting:** Persistent Node.js host (Render / Railway / Fly.io / VPS) with volume at `KOMOLIB_STORAGE_DIR`

## Commands
- **Dev (Web):** `npm run dev`
- **Dev (API):** `npm run dev:server`
- **Build & Typecheck:** `npm run build`
- **Android Sync:** `npm run cap:sync`
- **AIEF Doctor:** `npm run aief:doctor`
- **AIEF Validate Refs:** `npm run aief:validate`
