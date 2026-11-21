# Domain Model — KomoLib

Source of truth: `src/types/library.ts`, `src/db/localDb.ts`, `src/parsers/index.ts`, `src/services/sharedReadingService.ts`.

## Core Entities
- **`BookItem`**: Primary catalog item with metadata (`title`, `author`, `description`, `format`, `kind`, `categories`, `tags`, `seriesName`, `seriesOrder`), visual styling (`coverDataUrl`, `spineColor`, `ribbonColor`, `activeBookmarkDesignId`), reading progress (`progress`, `currentPage`, `currentCfi`, `currentChapter`, `scrollRatio`, `audioTime`, `readingStatus`, `rating`, `review`), and sync metadata (`hasLocalFile`, `hasRemoteFile`, `remoteFileName`, `addedAt`, `lastReadAt`, `updatedAt`).
- **Binary File Store (`files` store in IndexedDB)**: Stores `{ id, blob, extraImages? }` keyed by `BookItem.id`. Image-folder manga/manhwa bundles store page blobs in `extraImages`.
- **Reading Marks**:
  - `BookmarkItem` & `BookmarkDesign`: Visual bookmarks clipped inside a book (builtin presets in `public/bookmarks/*.webp` + user-uploaded compressed designs).
  - `BookAnnotation`: Reader marks across 6 tools (`highlighter`, `pencil`, `pen`, `postit`, `sticker`, `emoji`) anchored by `cfi`, `page`, `chapterHref`, `scrollRatio`, and `progress`.
  - `NoteItem` & `CustomStationeryKit`: Notebook notes and custom swatches/stickers/emojis.
- **Organization & Preferences**: `CategoryItem`, `CollectionCard`, `ThemeConfig`, `ReaderSettings`, `UserProfile`, `SyncConfig`, `ActiveReadingSession`.
- **Collaborative Reading**:
  - `SharedRoom` (`KOMO-XXXX`): Buddy Read session bound to a single book with live participant progress, optional shared marks, and spoiler-protected comments (locked until the reader reaches the comment's progress percentage).
  - `SharedShelf` (`SHELF-XXXX`): Mutual bookshelf where participants upload, download, and manage shared books in real time.
- **Transfer Inbox (`InboxItem`)**: Files uploaded via the server's `/upload` or `/send` LAN web portal awaiting import into a client library.

## Supported Formats & Content Kinds
- **ContentKind:** `book`, `manga`, `manhwa`, `comic`, `audiobook`.
- **BookFormat (13):** `epub`, `pdf`, `cbz`, `cbr`, `images`, `txt`, `md`, `html`, `fb2`, `mobi`, `azw3`, `docx`, `audio`.
- **ComicReadMode (5):** `manhwa-strip` (seamless vertical), `manga-rtl`, `manga-rtl-double`, `comic-ltr`, `comic-ltr-double`.

## Key Relationships & Business Rules
1. **Local-first ownership:** Clients can import, read, annotate, and organize books completely offline in IndexedDB (`komolib-db` v2).
2. **Deterministic cloud vault ID (`spaceId`):** `deriveEmailSpaceId(email, pin)` computes `acct_<prefix>_<hex>` deterministically using dual 32-bit FNV-1a/cyrb hashes so it behaves identically on HTTP LAN, HTTPS web, and Capacitor APK without WebCrypto HTTPS restrictions.
3. **Tombstone-safe sync:** Deletions of books, bookmarks, annotations, notes, and custom bookmark designs propagate via `deleted*Ids` arrays in `RemoteSyncPayload` to avoid resurrecting deleted items across devices.
4. **Access separation:** `KOMOLIB_TOKEN` protects private personal library sync and uploads, while invited guests can join specific `KOMO-XXXX` rooms or `SHELF-XXXX` shelves without knowing the owner's token.
5. **Cover extraction & palette fallback:** `src/parsers/index.ts` extracts embedded covers when available and derives `spineColor`/`ribbonColor` from the cover palette, falling back to `generateCozyCover`.
