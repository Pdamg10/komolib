# Workflow Index — KomoLib (AIEF L3)

Ordered engineering phase pipeline for non-trivial KomoLib tasks. Follow `docs/standards/patterns/phase-router.md` to decide which phases to run or skip based on task scope.

## Pipeline
1. **Proposal** (`workflow/phases/proposal.md`) — Problem statement, affected targets (`src/`, `electron/`, `android/`, `cloudflare/`, `server/`), acceptance criteria, and risk check.
2. **Design** (`workflow/phases/design.md`) — Interface contracts, dual-backend parity (`cloudflare/src/index.js` ↔ `server/index.js`), IndexedDB/LWW/tombstone impact, and Desktop/Android host considerations.
3. **Implement** (`workflow/phases/implement.md`) — Scoped code changes, typechecking, multi-target verification, and mandatory post-change memory sync (`context/`).
4. **Review** (`workflow/phases/review.md`) — Regression checklist across Web/Desktop/Android/API, zero broken AIEF references, and release readiness.
