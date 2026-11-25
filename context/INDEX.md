# Context Index

Navigation entry for long-term KomoLib project context (AIEF L3). Load only what is relevant to the current task, and **always update affected memory files after completing every change**.

## Project Profile
- `context/PROJECT_PROFILE.yaml` — Machine-readable version, stack, targets (`src/`, `electron/`, `android/`, `cloudflare/`, `server/`), commands, and adapters.

## Business & Domain (`context/business/`)
- `context/business/domain-model.md` — Core entities (`BookItem`, annotations, bookmarks, external backup imports, shared rooms/shelves, Google Drive auth), supported formats, and business rules.

## Technical Context (`context/tech/`)
- `context/tech/REPO_SNAPSHOT.md` — Repository layout, detected stack, modules, CI, and commands.
- `context/tech/architecture.md` — Frontend, Electron Desktop, Android Capacitor, Cloudflare Workers + D1, and Express API architecture, IndexedDB schema, endpoints, sync model, boundaries, and risks.

## Experience & Lessons (`context/experience/`)
- `context/experience/INDEX.md` — Searchable index of lessons learned, pitfalls, and milestone reports.

## Workflow & Standards
- `workflow/INDEX.md` — Engineering phase pipeline (`proposal → design → implement → review`).
- `docs/standards/patterns/phase-router.md` — Task-type phase routing rules.
- `docs/standards/patterns/context-loading.md` — Selective context loading strategy.
- `docs/standards/patterns/experience-mgmt.md` — 3-tier experience management & mandatory post-change memory sync guide.
- `docs/standards/skill-spec.md` — Skill specification.
- `docs/standards/command-spec.md` — Command specification.
- `docs/standards/agent-spec.md` — Agent specification.
- `.ai-adapters/README.md` — Active AI tool adapters.
