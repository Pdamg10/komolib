# Lesson: Low-End/Desktop GPU Perf, Zero-Asterisk Adaptive AI Chat & Complete LWW Sync

## Context
KomoLib targets low-end Android phones alongside Electron Desktop PCs (`electron/main.cjs`), runs a Gemini-backed chat assistant across Cloudflare Workers (`cloudflare/src/index.js`) and Express (`server/index.js`), and syncs rich user state across devices via Google Drive (`src/services/googleDriveService.ts`) or Cloud API.

## Pitfalls
1. **Desktop & low-end UI lag:**
   - Creating an un-memoized `LibraryContext.Provider` value object (`value={{ ... }}`) on every render forced all consumers to re-render on every keystroke, toast, or background poll.
   - Repeating `backdrop-filter: blur(...)` on `.book-format-pill` and `filter: drop-shadow(...)` on `.book-ribbon` spawned dozens of GPU filter/compositor layers per visible grid screen; Electron `--enable-zero-copy` / `--ignore-gpu-blocklist` also caused compositing stutter on older integrated GPUs.
   - Calling `setBookmarks`/`setAnnotations`/`setNotes`/`setChatSessions` inside `applyRemotePayload` even when remote state was identical caused periodic micro-stutters on background sync polls.
2. **Noisy `*` Markdown in AI Chat & non-adaptive responses:**
   - `ChatTab.tsx` rendered `{msg.text}` as raw plain text while `cloudflare/src/index.js` omitted `thinkingConfig: { thinkingBudget: 0 }`, `notes`, `annotations`, `activeBook`, and format rules — causing slow responses filled with literal `*` and `**`.
3. **Sync overwrites & lost mutations:**
   - `categories`, `collections`, and `customStationery` lacked LWW timestamps (`categoriesUpdatedAt`, `collectionsUpdatedAt`, `customStationeryUpdatedAt`), so a fresh device could overwrite customized categories/collections/stationery with defaults, and deleted stationery items resurrected via additive merging.
   - Mutations (`addCategory`, `deleteCategory`, `addBookmark`, `addAnnotation`, `persistStationery`, `addNote`, `appendMessages`, `deleteChatSession`) did not update `stateRef.current` synchronously before `scheduleAutoSync()`, risking stale snapshots on fast syncs.

## Solution & Rules
- **Render & GPU discipline:** Always keep `LibraryContext.Provider` value memoized with `useMemo`, keep `BookShelf`, `RightPanel`, and `ChatTab` memoized (with O(1) `booksById` map and memoized `parseCleanAiBlocks`), NEVER put live `backdrop-filter: blur(...)` on `.app-shell.has-wallpaper` (use static pre-blurred `.app-wallpaper-bg` layer behind the shell so mouse hovers in AI Chat never re-blur the full viewport), isolate `.right-panel` with `contain: layout style paint` + static `::before` doodle layer, avoid `backdrop-filter` / `filter: drop-shadow` on per-card repeating book elements, keep `contain: layout style` (never `contain: paint`) on cards/rows, keep `spellcheck: false` in `electron/main.cjs`, and skip `setState` in `applyRemotePayload` when data is unchanged.
- **Universal mobile tap-to-turn paging:** All 4 readers (`EpubReader`, `PdfReader`, `ComicMangaReader`, `TextRichReader`) support clean left-edge (`<= 32–35%` → prev) and right-edge (`>= 65–68%` → next) touch tap paging while preserving center-tap safety, text selection, links, pin mode, zoom panning, and swipe gestures without double-firing.
- **Clean adaptive AI chat (`src/utils/aiAssistantUtils.ts`):** Enforce zero-`*` formatting in both backend prompts (`cloudflare/src/index.js`, `server/index.js`) and client rendering (`sanitizeAiReplyText` + `parseCleanAiBlocks` in `ChatTab.tsx`), keep `thinkingBudget: 0` in Cloudflare Workers, and persist/sync `UserAiProfile` (`aiProfile` + `aiProfileUpdatedAt`) trained from natural messages and 1-tap feedback pills.
- **Full LWW & synchronous `stateRef` sync:** Always update `stateRef.current.*` synchronously before calling `scheduleAutoSync(..., scope)`, and maintain LWW timestamps (`categoriesUpdatedAt`, `collectionsUpdatedAt`, `customStationeryUpdatedAt`, `aiProfileUpdatedAt`) with full parity across `googleDriveService.ts`, `cloudflare/src/index.js`, and `server/index.js`.
