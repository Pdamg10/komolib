# Lesson: Unified Manga/Manhwa/Comic Chapter-Pack Grouping & Structured Info Card

## Context
Downloaded manga, manhwa, manhua, and comics typically arrive split across multiple PDF/CBZ/CBR packs of ~10 chapters each (e.g., `0-10`, `11-21`, `Caps 22-31`), cluttering the shelf with dozens of separate entries and making chapter order, duplicates, and available chapter counts hard to track. Standard books (`kind === 'book'`) and audiobooks (`kind === 'audiobook'`) must preserve their exact existing structure.

## Design & Invariants
1. **Virtual/Logical Grouping over Underlying `BookItem` Files:**
   - Never merge multi-GB PDFs/CBZs into a single binary blob (would OOM low-end Android WebViews and break Drive sync).
   - Keep each downloaded pack as a `BookItem` enriched with optional chapter-pack metadata (`seriesName`, `chapterStart`, `chapterEnd`, `originTag`, `seriesStatus`, `fansubs`, `genres`, `totalChaptersExpected`) in `src/types/library.ts`.
   - Because `BookItem` syncs wholesale across IndexedDB, Google Drive (`komolib-state.json`), Cloudflare Workers D1, and Express, series metadata syncs automatically between PC and APK with zero backend schema changes.
2. **Strict Visual-Only Scope (`isVisualSeriesKind`):**
   - `groupLibraryForDisplay()` in `src/utils/mangaSeriesUtils.ts` only groups `manga`, `manhwa`, and `comic` items. Books and audiobooks pass through untouched.
   - Numeric range auto-classification in `src/parsers/index.ts` (`guessContentKind`) and `src/context/LibraryContext.tsx` (`importFiles`, `importNativeFolderBooks`) only inspects `pdf`, `cbz`, `cbr`, and `images` (guarding against year ranges like `2020-2025`), never reclassifying EPUB/MOBI/DOCX/TXT/audio files.
3. **Deduplication, Ordering & Filter Integrity:**
   - `src/components/BookShelf.tsx` groups `baseFiltered` into `ShelfDisplayItem[]` **before** applying reading-status filters (`Todos`, `Sin leer`, `Leyendo`, `Finalizados`) and sorting, so finishing chapters `0-10` while reading `11-21` keeps the whole series intact under `Leyendo`.
   - Exact same `(seriesKey + chapterStart + chapterEnd)` ranges are blocked on import and deduplicated on display (keeping the highest-quality copy and surfacing a 1-click cleanup button in `src/components/MangaSeriesModal.tsx`).
4. **1-Click Telegram Card Parsing (`NFKD` Normalization):**
   - `parseTelegramSeriesCard()` normalizes mathematical Unicode bold labels (e.g., `𝐍𝐨𝐦𝐛𝐫𝐞` → `Nombre`) via `.normalize('NFKD')`, extracting `Nombre`, `Tipo`, `Género`, `Fansubs`, `Estado`, `Capítulos`, and `Sinopsis` in one click and applying them across all files in the series via `updateSeriesBooks()`.
5. **In-Reader Chapter Switching:**
   - `src/components/readers/ReaderShell.tsx` uses `getSeriesNavigationForBook()` to render previous/next chapter-pack navigation buttons on Desktop, Tablet, and Phone subtoolbar.
