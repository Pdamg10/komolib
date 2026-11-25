# Pattern: Experience Management

> Organize `context/experience/` into a three-tier searchable structure and keep all project memory in `context/` continuously synchronized after every change.

## Three-Tier Structure

```
context/experience/
  INDEX.md          ← searchable index (keywords → files)
  lessons/          ← individual lesson files
  reports/          ← periodic review & milestone reports
```

## Mandatory Post-Change Memory Sync

After finishing **any** code, config, architecture, or workflow change:
1. **Check structural memory:** Update `context/PROJECT_PROFILE.yaml`, `context/tech/architecture.md`, `context/tech/REPO_SNAPSHOT.md`, and/or `context/business/domain-model.md` if stack, endpoints, files, entities, versions, or commands changed.
2. **Capture lessons:** If the change fixed a non-trivial bug, uncovered a pitfall, or introduced a durable invariant, create or update a lesson under `context/experience/lessons/{topic}.md` and register it in `context/experience/INDEX.md`.
3. **Log milestones:** For releases or multi-module changes, add or update a report in `context/experience/reports/` and register it in `context/experience/INDEX.md`.
4. **Validate:** Run `npm run aief:validate` to confirm zero broken references.

## Adding a Lesson

1. Create `context/experience/lessons/{topic}.md`
2. Add a row to `INDEX.md`: `| keywords | lessons/{topic}.md | one-line summary |`

## Adding a Report

1. Create `context/experience/reports/YYYY-MM-{topic}.md`
2. Add a row to the Reports section of `INDEX.md`
