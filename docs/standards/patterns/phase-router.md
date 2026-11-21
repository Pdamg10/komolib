# Pattern: Phase Router

> Automatically route tasks to the correct workflow phase based on task type.

## Task Type Recognition

| Task Type | Signals | Phase Path |
|-----------|---------|------------|
| New feature | "add", "implement", "feat" | proposal → design → implement → review |
| Bug fix | "fix", "resolve", "bug" | implement → review |
| Refactor | "refactor", "optimize" | design → implement → review |
| Docs | "document", "explain" | implement → review |
| Query | "show", "list", "explain" | direct answer (no phases) |

## Skip Conditions

| Phase | Skip When |
|-------|-----------|
| proposal | Change is clearly scoped and small |
| design | Non-architectural change; ≤ 2 files affected |
| review | Pure docs or config change |

## How to Use

Reference this pattern in your `AGENTS.md` under the auto-behavior section.
The AI assistant will apply the routing logic automatically.