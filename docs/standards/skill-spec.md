# Skill Spec Standard

> Skill is the execution layer in the AIEF three-tier architecture.
> It represents an atomic, reusable capability unit.

## Standard Format

```markdown
# Skill: {Name}

## Purpose
# Single-responsibility description (one sentence)

## Input
# TypeScript interface definition

## Output
# TypeScript interface definition

## Execution Strategy
# Specific algorithm/rules (optional for complex Skills)

## Example
# Complete Input → Output example

## Constraints
# What this Skill does NOT do (optional)
```

## Naming Convention

- File: `docs/standards/skills/{verb}-{noun}.md` (e.g., `search-codebase.md`)
- One Skill per file