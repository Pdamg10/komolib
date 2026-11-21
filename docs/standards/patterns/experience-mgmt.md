# Pattern: Experience Management

> Organize `context/experience/` into a three-tier searchable structure.

## Three-Tier Structure

```
context/experience/
  INDEX.md          ← searchable index (keywords → files)
  lessons/          ← individual lesson files
  reports/          ← periodic review reports
```

## Adding a Lesson

1. Create `context/experience/lessons/{topic}.md`
2. Add a row to `INDEX.md`: `| keywords | lessons/{topic}.md | one-line summary |`

## Adding a Report

1. Create `context/experience/reports/YYYY-MM.md`
2. Add a row to the Reports section of `INDEX.md`