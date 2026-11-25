# Lesson: Auto-Adaptive Phone/Tablet/Desktop Reader Chrome & Live Shared Profile Sync

## Context
KomoLib runs on phones (Android APK), tablets, and desktop monitors (Electron / browser), and allows users to participate simultaneously in multiple Buddy Read rooms (`KOMO-XXXX`) and Shared Shelves (`SHELF-XXXX`).

## Pitfalls
1. **Reader toolbar overlap across form factors:** A single desktop-oriented header crowded tablet widths and overlapped controls on narrow phone screens or after orientation changes.
2. **Stale user name/avatar inside active rooms and shelves:** Editing `UserProfile` (display name, avatar photo, emoji, or color) updated local UI immediately, but existing `SharedRoom.participants` and `SharedShelf.members` records kept the old snapshot until a user manually rejoined.

## Solution & Rules
- **Viewport-driven reader layout (`ReaderShell.tsx`):** Compute `ReaderViewportMode` (`'phone'` <= 640px, `'tablet'` 641–1024px, `'desktop'` > 1024px) dynamically on resize/orientation change, expose `data-reader-viewport={viewportMode}` on the reader root, and pass `viewportMode` into `EpubReader`, `PdfReader`, and `ComicMangaReader` so bars, drawers, and compact icons adapt with zero overlap.
- **Broadcast profile changes via `PATCH /api/shared/profile`:** Whenever the user edits their profile, call `syncSharedProfile()` (`src/services/sharedReadingService.ts`) to update participant/member records across all rooms and shelves in both `cloudflare/src/index.js` and `server/index.js`.
