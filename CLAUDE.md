# Project guidelines

## Git commits
- Follow Conventional Commits: `<type>(<scope>): <description>`
  (types: feat, fix, docs, refactor, test, chore, ci, build, perf, style).
- Write the entire commit message (subject and body) in English, even if the conversation is in Vietnamese.
- Imperative mood, lowercase after the colon, no trailing period, subject <= 72 chars.

## Project index

Konoha Village: a multi-tool orchestrator (`konoha`) plus a visual "village" that shows its progress.
The orchestrator (project 1) is implemented in `src/`; the village (project 2) has design docs only. Docs are written in Vietnamese.

### Layout
- `CLAUDE.md`: project guidelines and this index. Keep the index in sync when files are added, moved or removed.
- `LICENSE`: project license.
- `package.json`, `tsconfig.json`, `vitest.config.ts`: TypeScript/Node >= 20 project; `npm test`, `npm run build`.
- `README.md`: plan input format, commands, how to add tools.
- `src/`: orchestrator source (plan, state, scheduler, git, adapters, worker, review, orchestrator, cli). Built-in tool definitions in `src/adapters/builtin/`.
- `tests/`: vitest tests, one file per source file, helpers in `tests/helpers/`, fake tool in `tests/fixtures/`.
- `skills/konoha-plan/`: add-on skill that tells the planner how to format plans for `konoha`.
- `.claude/settings.json`: Claude Code project settings (commit/PR attribution disabled).
- `docs/superpowers/specs/`: approved or draft designs, named `YYYY-MM-DD-<topic>-design.md`.
- `docs/superpowers/plans/`: implementation plans, named `YYYY-MM-DD-<topic>.md`.

### Docs
| File | What it is | Status |
|------|-----------|--------|
| `docs/superpowers/specs/2026-11-23-orchestrator-design.md` | Design of the `konoha` orchestrator: takes an approved plan, runs each task with a chosen tool (Claude Code, Codex, Gemini CLI, OpenCode) in its own worktree, reviews with the strongest model, merges into `feat/<task>`, waits for approval before merging to `dev` | Approved (project 1, built first) |
| `docs/superpowers/specs/2026-11-24-tool-adapters-design.md` | Adapter layer revision: tools are JSON definition files (repo, `~/.config/konoha/tools/`, built-in), built-ins are `claude` and `agy`, accounts are definitions that `extends` another, isolation must be verified by `konoha tool check` | Approved (overrides the adapter parts of the orchestrator design) |
| `docs/superpowers/plans/2026-11-23-orchestrator.md` | Implementation plan for the orchestrator (TypeScript, Node >= 20, vitest, no runtime deps); updated for declarative tool adapters | Implemented |
| `docs/superpowers/specs/2026-11-23-workflow-town-design.md` | Design of the visual village (isometric 2D, Naruto village / Old Trafford themes) that reads the orchestrator's event log | Draft, on hold until the orchestrator is done (project 2) |

### Key relationships
- The village reads the orchestrator's event log, so the orchestrator comes first.
- Orchestrator state lives in `.konoha/` of the target repo, not in this repo.
- Workers never use permission-bypass flags; see Global Constraints in the plan.
