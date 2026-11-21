# AI Adapter Configurations — KomoLib (AIEF L3)

Tool-specific entry points that connect AI assistants to the single source of truth in `AGENTS.md`.

## Active Adapters
- **Antigravity / Claude Code / Codex / OpenCode:** Native support via root `AGENTS.md`.
- **Cursor:** Active at `.cursor/rules/aief.mdc`.
- **GitHub Copilot:** Active at `.github/copilot-instructions.md`.

## Validation
Run `npm run aief:doctor` and `npm run aief:validate` after editing AIEF files to confirm all references remain consistent.
