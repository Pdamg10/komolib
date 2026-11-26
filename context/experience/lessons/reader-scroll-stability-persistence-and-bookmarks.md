# Lesson: Reader Scroll Stability, Guaranteed Exit Persistence & On-Page Visual Bookmarks

## Context
KomoLib renders books, PDFs, comics/mangas/manhwas, and rich text across 4 reader components (`PdfReader.tsx`, `ComicMangaReader.tsx`, `EpubReader.tsx`, `TextRichReader.tsx`) orchestrated by `ReaderShell.tsx` and persisted via `LibraryContext.tsx` (IndexedDB + `localStorage` caches).

## Pitfalls
1. **Involuntary scroll jumps while reading:**
   - **Accidental tap-to-scroll in continuous modes:** Left/right edge taps (`<= 32%` / `>= 68%`) in continuous scroll (`PdfReader`, `ComicMangaReader` strip, `TextRichReader`, `EpubReader` scrolled) jumped full pages or 82–85% of viewport height whenever a reader rested a thumb or lightly tapped the screen.
   - **Virtualization height collapse & layout shift:** `LazyComicStripSlot` cleared `minHeight` to `undefined` while images were decoding (`isNear && url`), collapsing slots above the viewport to `0px` and yanking scroll position; `LazyPdfPage` resized above-viewport placeholders without compensating `scrollTop`; `PdfReader` `ResizeObserver` reacted to minor mobile URL-bar height jitter even in `fitMode === 'width'`, canceling and re-rendering all visible pages; `ComicMangaReader` recreated `wrapperStyle`, `imgStyle`, and `pagePins` on every scroll tick, breaking `React.memo`.
   - **EPUB post-load shift & DOM thrashing:** `EpubReader` applied `rendition.themes.default(...)` after `loading` completed (shifting initial CFI layout) and re-ran `clearDomMarks` + `applyAnnotationsToRoot` on every `relocated` scroll tick.
2. **Reading position lost on exit or overwritten on re-open:**
   - Debounced scroll timers (`180ms`) in `PdfReader` and `ComicMangaReader` were cleared on unmount without flushing; `ReaderShell` / `closeReader` did not synchronously flush reader state on close, Android back, `pagehide`, `beforeunload`, or `visibilitychange`.
   - `PdfReader` and `ComicMangaReader` only persisted integer `currentPage` (omitting intra-page `scrollRatio`) and allowed scroll events during initial restore to overwrite `currentPage` back to `1`.
   - `EpubReader` emitted `0%` on the first `relocated` event before `epubInstance.locations.generate(1200)` finished, overwriting saved `book.progress` to `0%`.
   - `TextRichReader` fired unthrottled IndexedDB writes on every scroll pixel and could overwrite `scrollRatio` to `0` before initial layout settled.
3. **Chosen visual bookmark (separador) invisible when searching for saved spot:**
   - Only a single top-right hanging bookmark existed in `ReaderShell`, which auto-tucked (`opacity: 0.24`, `-86%`) after 2.2s and always displayed the book's default design rather than the specific `bm.designId` saved at that spot.
   - Neither bookmarked pages (PDF/Comic/Manga), scrollable text documents (`TextRichReader`), nor bottom scrubbers/progress bars rendered the saved visual bookmarks, and `triggerJump` did not carry `bookmarkId` / `bookmarkDesignId`.

## Solution & Rules
- **Scroll anchoring & zero layout-shift rendering:**
  - Cache measured page heights per page in `PdfReader` (`pageSizesRef`) and `ComicMangaReader` (`pageHeightsRef`); never drop `minHeight` until an image actually finishes decoding; synchronously compensate `container.scrollTop += (newH - oldH)` whenever a page above the current viewport changes height.
  - Keep `LazyComicStripSlot` props memoized (`useMemo` for styles, `pinsByPage`, `bookmarksByPage`), ignore minor vertical viewport jitter in PDF continuous `width` mode, apply `EpubReader` theme rules *before* `rendition.display()`, and skip redundant EPUB mark DOM rewrites via `WeakMap<Document, string>` signature caching.
- **Safe tap controls (`ReaderSettings.tapToScroll`):**
  - Disable edge-tap scrolling in continuous scroll modes by default (`tapToScroll` defaults to `false`; toggleable in Reader Settings).
  - In paginated modes, restrict tap-to-turn to outer `<= 22%` / `>= 78%` edges with clean tap duration (`25–300ms`), drift (`<= 10px`), and `!hasOpenOverlay` guards.
- **Crash-proof position persistence & exact restore:**
  - Every reader registers a synchronous `onRegisterFlush` callback invoked on unmount, `ReaderShell` close, series-pack switch, `LibraryContext.closeReader()` (`window.__komoFlushReaderProgress`), `pagehide`, `beforeunload`, and `visibilitychange === 'hidden'`.
  - Mirror reading position updates synchronously to `localStorage` (`komolib_reading_pos_cache_v1`) in `LibraryContext.updateBook()` and reconcile on startup bootstrap whenever the cache is newer than IndexedDB.
  - Persist both `currentPage` and intra-page `scrollRatio` (`0..1`) in PDF/Comic continuous modes, suppress scroll progress writes while initial restoration settles (`isRestoringRef`), and preserve saved `book.progress` in `EpubReader` until `locations.generate()` resolves.
- **Persistent on-page & scrubber visual separadores:**
  - Render the exact chosen `bm.designId` ribbon directly on bookmarked PDF and Comic/Manga pages (`.reader-page-bookmark-ribbon`), at the exact `scrollRatio` margin in `TextRichReader` (`.reader-text-bookmark-marker`), and as bookmark pips on all bottom sliders/progress bars.
  - In `ReaderShell`, dynamically reveal the exact `bm.designId` on the hanging separador whenever the reader is positioned at a saved bookmark or jumps to one via `ReaderJumpTarget.bookmarkId`/`bookmarkDesignId`, and list saved book bookmarks with 1-tap `Ir` navigation inside the Separadores tab.
  - **React Rules-of-Hooks invariant in `ReaderShell.tsx`:** Keep EVERY hook (`useCallback`, `useMemo`, `useEffect`, `useRef`, `useState`) strictly ABOVE `if (!activeBook) return null;` — placing any hook below that guard throws React Error #310 on opening any book and causes a black screen.
- **Zero-idle PC / Desktop background discipline:**
  - Unmount heavy library views (`Sidebar`, `BookShelf`, `RightPanel`/`ChatTab`, wallpaper layer) while fullscreen `ReaderShell` (`activeBook !== null`) is open (preserving library scroll position) so scroll/page progress ticks trigger zero background re-renders.
  - Never open `EventSource` against stateless `*.workers.dev` URLs in `subscribeToSyncStream` (prevents 3s reconnect storms), never run live sync / health / AI probes on startup unless a cloud account, Drive session, or active shared space is configured, pause background Drive/sync/cover/auto-download loops while reading (`activeBookIdRef.current`), cap background cover recovery and auto-downloads to small (`<= 25 MB`) files, memoize `duplicateBooksCount` by `id+fileName+title` signature, and yield inside `electron/main.cjs` `scanDirectoryRecursive`.
