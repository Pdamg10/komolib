# Lesson: Vite Build-Time Env Vars & `node-unrar-js` WASM Exclusion

## Context
KomoLib bundles `node-unrar-js` (WASM) for offline CBR/RAR comic extraction and reads `VITE_SYNC_SERVER_URL` / `VITE_PUBLIC_APP_URL` via `import.meta.env`.

## Pitfalls
1. Changing `VITE_*` environment variables in Netlify without triggering a fresh build (**Clear cache and deploy site**) has no effect because Vite inlines `import.meta.env.VITE_*` at build time.
2. Allowing Vite's dependency pre-bundler (`optimizeDeps`) to process `node-unrar-js` breaks its `.wasm` asset resolution at runtime.

## Solution & Rule
- Keep `optimizeDeps: { exclude: ['node-unrar-js'] }` and `base: './'` in `vite.config.ts` (the relative base is also required for Capacitor Android).
- Rebuild (`npm run build` / `npm run cap:sync`) whenever `VITE_*` variables change.
