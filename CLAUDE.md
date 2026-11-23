# Project guidelines

## Git commits
- Follow Conventional Commits: `<type>(<scope>): <description>`
  (types: feat, fix, docs, refactor, test, chore, ci, build, perf, style).
- Write the entire commit message (subject and body) in English, even if the conversation is in Vietnamese.
- Imperative mood, lowercase after the colon, no trailing period, subject <= 72 chars.

## Project index

Konoha Village: a multi-tool orchestrator (`konoha`) plus a visual "village" that shows its progress.
The repo currently holds design docs only; no source code yet. Docs are written in Vietnamese.

### Layout
- `CLAUDE.md`: project guidelines and this index. Keep the index in sync when files are added, moved or removed.
- `LICENSE`: project license.
- `.claude/settings.json`: Claude Code project settings (commit/PR attribution disabled).
- `docs/superpowers/specs/`: approved or draft designs, named `YYYY-MM-DD-<topic>-design.md`.
- `docs/superpowers/plans/`: implementation plans, named `YYYY-MM-DD-<topic>.md`.

### Docs
| File | What it is | Status |
|------|-----------|--------|
| `docs/superpowers/specs/2026-11-23-orchestrator-design.md` | Design of the `konoha` orchestrator: takes an approved plan, runs each task with a chosen tool (Claude Code, Codex, Gemini CLI, OpenCode) in its own worktree, reviews with the strongest model, merges into `feat/<task>`, waits for approval before merging to `dev` | Approved (project 1, built first) |
| `docs/superpowers/plans/2026-11-23-orchestrator.md` | Implementation plan for the orchestrator (TypeScript, Node >= 20, vitest, no runtime deps) | Ready to execute |
| `docs/superpowers/specs/2026-11-23-workflow-town-design.md` | Design of the visual village (isometric 2D, Naruto village / Old Trafford themes) that reads the orchestrator's event log | Draft, on hold until the orchestrator is done (project 2) |

### Key relationships
- The village reads the orchestrator's event log, so the orchestrator comes first.
- Orchestrator state lives in `.konoha/` of the target repo, not in this repo.
- Workers never use permission-bypass flags; see Global Constraints in the plan.
