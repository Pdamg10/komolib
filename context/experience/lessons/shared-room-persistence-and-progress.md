# Lesson: Persist Shared Rooms Locally, Auto-Restore After Ephemeral Server Restarts, and Preserve Progress on Room Exit

## Context
KomoLib Buddy Read rooms (`KOMO-XXXX`) and Shared Shelves (`SHELF-XXXX`) are hosted on the Express API (`server/index.js`), which on Render Free runs on an ephemeral disk that wipes `rooms.json` and `shelves.json` when spinning down after idle periods. Previously, the frontend only persisted `joinedRoomCodes` (`string[]`) in IndexedDB without caching the full `SharedRoom` objects.

## Pitfalls
1. **Rooms vanished on app restart / Render cold start / ephemeral disk wipe:** `sharedRooms` started as `[]` on boot and `refreshSharedRooms()` overwrote state with `[]` if the server was offline, cold-starting, or returned `404` after a Render restart.
2. **Reading progress race on room exit/deletion:** Leaving or closing a room did not flush live reader position (`livePos`) or reconcile `room.participants[deviceId]` progress back into IndexedDB + urgent cloud sync, nor did it cancel debounced `roomProgressTimersRef` timers (which could fire `PATCH /api/rooms/:code/progress` after leaving). Rejoining a room also sent `progress: 0` because `existingBook` lookup relied on `s.sharedRooms` instead of `room.bookId`.

## Solution & Rules
- Persist `cachedSharedRooms`, `cachedSharedShelves`, `selectedRoomCode`, `selectedShelfCode`, `closedRoomCodes`, and `closedShelfCodes` in IndexedDB (`kv`) and hydrate them before `setReady(true)`. Always `await` persistence when creating/joining rooms or shelves.
- Distinguish explicit deletion (`410 Gone` via `deleted_rooms.json` / `deleted_shelves.json` tombstones) from ephemeral disk wipes (`404 Not Found`). On `404` for a locally cached active room/shelf, auto-restore it under the exact same code via `PUT /api/rooms/:code/restore` (and `PUT /api/shelves/:code/restore`), never wiping local state on network errors.
- Always cancel pending `roomProgressTimersRef` timers and run `preserveRoomBookProgress(room, liveSnapshot)` (awaiting `dbPutBook` + calling `scheduleAutoSync(true, 'books')`) before leaving, closing, or removing any room.
- Keep `livePos` in a ref (`livePosRef`) inside `ReaderShell` so the room SSE `useEffect` never reconnects on every page turn.
