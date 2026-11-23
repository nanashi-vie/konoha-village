# Bộ điều phối `konoha` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một chương trình dòng lệnh `konoha` nhận một plan đã duyệt, chạy từng việc bằng công cụ được chỉ định (Claude Code, Codex, Gemini CLI, OpenCode) trong worktree riêng, đúng thứ tự phụ thuộc, review bằng Claude model mạnh, gộp vào `feat/<tên-task>`, rồi dừng chờ người dùng duyệt gộp vào `dev`.

**Architecture:** "PM cơ học" là code thuần (đọc plan, xếp lịch, git, quyền, nhật ký), không dùng AI. Worker và "PM phán đoán" (review) là các tiến trình CLI mới, ngắn, gọi qua adapter. Toàn bộ trạng thái nằm trong file dưới `.konoha/` của repo đích, nên dừng/chạy lại được bất kỳ lúc nào.

**Tech Stack:** TypeScript, Node.js ≥ 20, không dùng thư viện chạy (runtime) nào ngoài thư viện chuẩn của Node; dev: `typescript`, `vitest`, `@types/node`. Gọi git và các CLI bằng `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-11-23-orchestrator-design.md`

## Global Constraints

- Chạy trên macOS, trong một repo git. Node ≥ 20.
- Không bao giờ truyền cờ bỏ qua quyền cho bất kỳ công cụ nào: `--dangerously-skip-permissions`, `--yolo`, `-y`, `--dangerously-bypass-approvals-and-sandbox`, `--full-auto`, `--approval-mode yolo`.
- Worker chỉ được đọc/sửa file trong worktree của mình và chạy các lệnh trong `allowCommands` của file quyền. Worker không push, không gộp, không cài gói, không gọi mạng. Chỉ chương trình được commit, gộp và cài thư viện.
- Công cụ nào không chặn được việc ghi file ra ngoài worktree (`canIsolateWrites === false`) thì không được giao việc.
- Sau mỗi lần worker chạy, chương trình kiểm tra thay đổi ngoài worktree; có thì loại kết quả và chặn việc (`outside_write`).
- Mặc định: tối đa song song `3`; review không qua thì giao lại tối đa `2` lần.
- Nhánh: nhánh tổng `feat/<slug>` tách từ `dev`; `dev` tạo từ `main` nếu chưa có. Nhánh worktree con: `wt/<slug>/task-<id>`. Chỉ gộp `feat/<slug>` vào `dev` khi người dùng chạy `konoha merge`.
- Plan phải có `**Trạng thái plan:** đã duyệt`; thiếu thì từ chối chạy.
- Thư viện chỉ được cài theo mục `## Thư viện cần thêm` của plan, một lần, trước khi worker nào bắt đầu.
- Plan cần đổi (theo review) thì dừng việc đó và hỏi người dùng; không bao giờ tự sửa file plan.
- Nhật ký: `model` là `null` khi không biết model thật, hiển thị là "không rõ". Không ghi model đoán.
- Mọi file trạng thái nằm dưới `.konoha/` của repo đích; `.konoha/` được thêm vào `.git/info/exclude`.

## Review Focus

1. **Chương trình bị tắt giữa chừng** (tắt máy, Ctrl-C): chạy lại `konoha run` phải tiếp tục. Việc đang `running` quay về `pending`, worktree của nó được dựng lại sạch; việc đã `merged` không chạy lại. → test trong Task 11.
2. **Worker treo** không thoát: bị giết sau `workerTimeoutMinutes`, việc bị chặn `timeout`, các nhánh khác vẫn chạy. → test trong Task 7.
3. **Worker thoát bình thường nhưng không sửa gì:** không gộp commit rỗng; chặn `no_changes`. → test trong Task 7.
4. **Gộp vào `feat/<slug>` bị xung đột, hoặc test sau gộp hỏng:** hủy gộp, `feat/<slug>` trở về như trước, việc bị chặn, nhánh khác vẫn chạy. → test trong Task 4 và Task 11.
5. **Công cụ chưa cài hoặc không cách ly được:** việc giao cho nó bị chặn `tool_unavailable` ngay lúc bắt đầu, không làm sập cả lượt chạy. → test trong Task 11.

---

## Định dạng plan đầu vào (phần mở rộng)

Đây là hợp đồng giữa khâu lập plan và chương trình. Task 1 parse đúng định dạng này và ghi nó vào `README.md`.

```markdown
# <Tên> Implementation Plan
**Trạng thái plan:** đã duyệt

## Thư viện cần thêm
- `npm install nodemailer@6.9.14`

### Task 1: Tạo bảng dữ liệu
**Giao cho:** codex / gpt-5-codex
**Chờ:** —
**Files:**
- Create: `src/db/schema.ts`
- Modify: `src/app.ts:10-20`
...nội dung việc...

### Task 2: Viết API
**Giao cho:** claude / sonnet
**Chờ:** 1
```

- `**Giao cho:** <tool>` hoặc `<tool> / <model>`; tool ∈ `claude | codex | gemini | opencode`.
- `**Chờ:**` là `—`, `-` hoặc danh sách số cách bằng dấu phẩy.
- Slug lấy từ tên file plan, bỏ tiền tố ngày: `2026-11-23-gui-email.md` → `gui-email`.

## Cấu trúc file

```
package.json, tsconfig.json, vitest.config.ts, README.md
src/
  plan/parse.ts        parsePlan
  plan/validate.ts     validatePlan
  config.ts            loadConfig, loadPolicy, mặc định
  state/store.ts       RunState, loadState, saveState
  state/events.ts      KonohaEvent, appendEvent
  scheduler.ts         nextRunnable
  git.ts               thao tác git
  adapters/types.ts    Adapter, WorkerJob, FORBIDDEN_FLAGS
  adapters/claude.ts   adapters/codex.ts   adapters/gemini.ts   adapters/opencode.ts
  adapters/index.ts    getAdapter
  worker.ts            buildBrief, runWorker, readBlockedMarker
  review.ts            buildReviewPrompt, parseVerdict, runReview
  deps.ts              installLibraries
  notify.ts            notifyUser
  orchestrator.ts      runPlan
  cli.ts               lệnh konoha
tests/  (một file test cho mỗi file nguồn, cùng tên) + tests/helpers/tmpRepo.ts + tests/fixtures/fake-tool.mjs
```

---

### Task 1: Khung dự án + parse plan

**Chờ:** —

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `src/plan/parse.ts`
- Test: `tests/plan/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ToolName = 'claude' | 'codex' | 'gemini' | 'opencode';
  export interface PlanTask { id: number; name: string; tool: string; model: string | null;
    waitsOn: number[]; files: string[]; body: string }
  export interface Plan { path: string; slug: string; title: string; approved: boolean;
    libraries: string[]; tasks: PlanTask[] }
  export function parsePlan(markdown: string, path: string): Plan;
  ```

- [ ] **Step 1: Khung dự án.** `package.json` với `"type": "module"`, `"bin": {"konoha": "dist/cli.js"}`, scripts `build` (`tsc`), `test` (`vitest run`), `engines.node` `>=20`; devDependencies `typescript`, `vitest`, `@types/node`. `tsconfig` target ES2022, module NodeNext, strict. Chạy `npm install`.
- [ ] **Step 2: Viết test lỗi** trong `tests/plan/parse.test.ts`, dùng đúng ví dụ ở mục "Định dạng plan đầu vào":
  - `parses approved flag`: `approved === true`; plan không có dòng trạng thái → `false`; `**Trạng thái plan:** nháp` → `false`.
  - `parses slug from filename`: path `docs/superpowers/plans/2026-11-23-gui-email.md` → `slug === 'gui-email'`.
  - `parses libraries`: `libraries` bằng `['npm install nodemailer@6.9.14']` (bỏ dấu backtick).
  - `parses tasks`: 2 việc; task 1 `{id:1, name:'Tạo bảng dữ liệu', tool:'codex', model:'gpt-5-codex', waitsOn:[], files:['src/db/schema.ts','src/app.ts']}`; task 2 `{tool:'claude', model:'sonnet', waitsOn:[1]}`.
  - `tool without model`: `**Giao cho:** gemini` → `model === null`.
  - `body is task text`: `body` của task 1 chứa `...nội dung việc...` và không chứa `### Task 2`.
- [ ] **Step 3: Chạy** `npx vitest run tests/plan/parse.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 4: Cài đặt `parsePlan`.** Tách việc theo heading `### Task <n>: <tên>`; đọc các dòng `**Giao cho:**`, `**Chờ:**`; files từ các dòng `- Create|Modify|Test: \`...\`` (bỏ hậu tố `:<dòng>`). Thiếu `**Giao cho:**` thì `tool = ''` (validate sẽ bắt).
- [ ] **Step 5: Chạy lại test** — Expected: PASS.
- [ ] **Step 6: README.** Ghi định dạng plan đầu vào (copy mục trên) và ba lệnh ở Task 12.
- [ ] **Step 7: Commit** `feat: khung dự án và parse plan`.

### Task 2: Kiểm tra plan + cấu hình + file quyền

**Chờ:** 1

**Files:**
- Create: `src/plan/validate.ts`, `src/config.ts`
- Test: `tests/plan/validate.test.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `Plan`, `ToolName` (Task 1).
- Produces:
  ```ts
  export function validatePlan(plan: Plan): string[];   // [] = hợp lệ
  export interface Config { maxParallel: number; maxReviewRetries: number; workerTimeoutMinutes: number;
    testCommand: string; setupCommand: string | null; reviewModel: string;
    baseBranch: string; integrationBranch: string }
  export const DEFAULT_CONFIG: Omit<Config, 'testCommand'>;
  export interface Policy { allowCommands: string[] }
  export function loadConfig(repoRoot: string): Config;  // .konoha/config.json
  export function loadPolicy(repoRoot: string, config: Config): Policy; // .konoha/permissions.json
  ```

- [ ] **Step 1: Viết test lỗi `validate.test.ts`**, mỗi test kiểm tra mảng lỗi chứa chuỗi tiếng Việt cụ thể:
  - plan chưa duyệt → chứa `Plan chưa được duyệt`.
  - task chờ task không tồn tại (`waitsOn:[9]`) → chứa `Task 2 chờ task 9 không tồn tại`.
  - vòng phụ thuộc 1→2→1 → chứa `Vòng phụ thuộc: 1 → 2 → 1`.
  - tool lạ `cursor` → chứa `Task 1: công cụ "cursor" không được hỗ trợ`.
  - thiếu `Giao cho` → chứa `Task 1: thiếu "Giao cho"`.
  - id trùng → chứa `Task 1 bị trùng`.
  - plan hợp lệ → `[]`.
- [ ] **Step 2: Viết test lỗi `config.test.ts`**: không có file → ném lỗi chứa `testCommand`; chỉ có `{"testCommand":"npm test"}` → các giá trị mặc định `maxParallel 3`, `maxReviewRetries 2`, `workerTimeoutMinutes 30`, `reviewModel 'opus'`, `baseBranch 'main'`, `integrationBranch 'dev'`, `setupCommand null`; không có `permissions.json` → `allowCommands` bằng `[testCommand]`.
- [ ] **Step 3: Chạy** cả hai file test — Expected: FAIL.
- [ ] **Step 4: Cài đặt** `validatePlan` (tìm vòng bằng DFS, trả về đường vòng đầu tiên tìm được), `loadConfig`, `loadPolicy`.
- [ ] **Step 5: Chạy test** — Expected: PASS.
- [ ] **Step 6: Commit** `feat: kiểm tra plan và cấu hình`.

### Task 3: Trạng thái chạy + nhật ký sự kiện

**Chờ:** 1

**Files:**
- Create: `src/state/store.ts`, `src/state/events.ts`
- Test: `tests/state/store.test.ts`, `tests/state/events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TaskStatus = 'pending' | 'running' | 'merged' | 'blocked';
  export type BlockKind = 'needs_permission' | 'needs_library' | 'plan_change' | 'review_limit'
    | 'merge_conflict' | 'tests_failed_after_merge' | 'tool_unavailable' | 'outside_write'
    | 'timeout' | 'no_changes' | 'worker_error';
  export interface TaskState { status: TaskStatus; attempts: number; block: { kind: BlockKind; detail: string } | null }
  export type RunStatus = 'running' | 'awaiting_merge' | 'needs_user' | 'merged_to_dev';
  export interface RunState { slug: string; planPath: string; status: RunStatus; librariesInstalled: boolean;
    tasks: Record<number, TaskState> }
  export function runDir(repoRoot: string, slug: string): string;  // <repo>/.konoha/runs/<slug>
  export function initState(plan: Plan): RunState;
  export function loadState(repoRoot: string, slug: string): RunState | null;
  export function saveState(repoRoot: string, state: RunState): void;   // ghi file tạm rồi rename
  export function recoverInterrupted(state: RunState): number[];       // running → pending, trả id đã đổi

  export type EventType = 'run_started' | 'libraries_installed' | 'task_started' | 'worker_finished'
    | 'review_passed' | 'review_failed' | 'task_merged' | 'task_blocked' | 'run_awaiting_merge'
    | 'run_needs_user' | 'run_merged_to_dev';
  export interface KonohaEvent { ts: string; run: string; type: EventType; taskId: number | null;
    role: 'program' | 'worker' | 'judge'; tool: string | null; modelRequested: string | null;
    model: string | null; summary: string }
  export function appendEvent(repoRoot: string, e: Omit<KonohaEvent, 'ts'>): void; // events.jsonl, 1 dòng JSON
  export function readEvents(repoRoot: string, slug: string): KonohaEvent[];
  ```

- [ ] **Step 1: Viết test lỗi:** `initState` cho mọi task `pending`, `attempts 0`; `saveState` rồi `loadState` trả lại y hệt; `loadState` khi chưa có → `null`; `recoverInterrupted` đổi `running` → `pending`, giữ nguyên `merged`/`blocked`, trả `[id]`; `appendEvent` hai lần → `readEvents` có 2 phần tử, `ts` là ISO string, file có đúng 2 dòng.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt.** `saveState` ghi `state.json.tmp` rồi `fs.renameSync` để không bao giờ để lại file hỏng.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: trạng thái chạy và nhật ký sự kiện`.

### Task 4: Thao tác git

**Chờ:** 1

**Files:**
- Create: `src/git.ts`, `tests/helpers/tmpRepo.ts`
- Test: `tests/git.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function git(cwd: string, args: string[]): string;              // execFileSync, ném lỗi kèm stderr
  export function ensureBranches(repoRoot: string, base: string, integration: string, feat: string): void;
  export function ensureExcluded(repoRoot: string, pattern: string): void; // .git/info/exclude
  export function integrationWorktree(repoRoot: string, slug: string): string; // tạo nếu chưa có, checkout feat/<slug>
  export function createTaskWorktree(repoRoot: string, slug: string, taskId: number): string; // xóa cũ nếu có, tạo mới từ feat/<slug>
  export function removeTaskWorktree(repoRoot: string, slug: string, taskId: number): void;
  export function commitAll(worktree: string, message: string, exclude: string[]): boolean; // false = không có gì để commit
  export function mergeTaskBranch(integrationWt: string, taskBranch: string): 'merged' | 'conflict'; // conflict → merge --abort
  export function undoLastMerge(integrationWt: string): void;           // reset --hard HEAD~1
  export function dirtySnapshot(paths: string[]): Record<string, string>; // git status --porcelain mỗi path
  export function mergeFeatIntoDev(repoRoot: string, feat: string, integration: string): 'merged' | 'conflict';
  ```
  Đường dẫn worktree: `<repo>/.konoha/worktrees/<slug>/_integration` và `<repo>/.konoha/worktrees/<slug>/task-<id>`.
- `tests/helpers/tmpRepo.ts`: `makeRepo(): string` tạo repo tạm với một commit trên `main`.

- [ ] **Step 1: Viết test lỗi:**
  - `ensureBranches creates dev from main and feat from dev`: sau khi gọi, `git branch --list` có `dev` và `feat/x`; gọi lần hai không lỗi.
  - `task worktree branches from feat`: `createTaskWorktree` → thư mục tồn tại, nhánh `wt/x/task-1`; gọi lại khi đã có file bẩn → worktree sạch.
  - `commitAll returns false when nothing changed`; tạo file → `true`; file `.konoha-blocked.json` không vào commit.
  - `merge conflict aborts and leaves feat unchanged`: hai worktree sửa cùng một dòng; gộp cái thứ nhất `'merged'`, cái thứ hai `'conflict'`; `git rev-parse HEAD` của integration bằng sau lần gộp thứ nhất, `git status --porcelain` rỗng.
  - `undoLastMerge restores previous head`.
  - `dirtySnapshot detects change in main checkout`: snapshot trước/sau khi ghi file vào repo gốc khác nhau.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt.** Gộp bằng `git merge --no-ff`.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: thao tác git và worktree`.

### Task 5: Bộ xếp lịch

**Chờ:** 1, 3

**Files:**
- Create: `src/scheduler.ts`
- Test: `tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `Plan` (Task 1), `RunState` (Task 3).
- Produces: `export function nextRunnable(plan: Plan, state: RunState, maxParallel: number): number[];`
  Luật: việc `pending` có mọi việc trong `waitsOn` là `merged`; không trùng file với việc đang `running` hoặc với việc khác vừa được chọn trong cùng lần gọi; tổng số `running` + được chọn ≤ `maxParallel`; chọn theo id tăng dần.

- [ ] **Step 1: Viết test lỗi**, dùng plan 4 việc ở mục "Định dạng" (1; 2 chờ 1; 3 chờ 1; 4 chờ 2,3):
  - lúc đầu → `[1]`.
  - 1 merged → `[2, 3]`.
  - 1 merged, `maxParallel 1` → `[2]`.
  - 2 và 3 cùng có file `src/app.ts` → `[2]`; 2 running → `[]`.
  - 1 merged, 2 blocked, 3 merged → `[]` (4 không bao giờ chạy khi 2 bị chặn).
  - mọi việc merged → `[]`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt `nextRunnable`.**
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: xếp lịch theo phụ thuộc`.

### Task 6: Giao diện adapter + adapter Claude

**Chờ:** 2

**Files:**
- Create: `src/adapters/types.ts`, `src/adapters/claude.ts`, `src/adapters/index.ts`
- Test: `tests/adapters/claude.test.ts`, `tests/adapters/forbidden.test.ts`

**Interfaces:**
- Consumes: `Policy` (Task 2).
- Produces:
  ```ts
  export interface WorkerJob { worktree: string; prompt: string; model: string | null; policy: Policy;
    mode: 'work' | 'review' }
  export interface Invocation { cmd: string; args: string[]; env: Record<string, string> }
  export interface Adapter { tool: ToolName; binary: string; canIsolateWrites: boolean;
    build(job: WorkerJob): Invocation;
    actualModel(stdout: string): string | null }   // null khi không đọc được model thật
  export const FORBIDDEN_FLAGS: string[];          // đúng danh sách ở Global Constraints
  export function getAdapter(tool: string): Adapter | null;
  ```
- Claude, `mode: 'work'`: `claude -p <prompt> --output-format json --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep,<Bash(cmd:*) cho mỗi allowCommand>"`, thêm `--model <model>` nếu có. `mode: 'review'`: `--permission-mode default --allowedTools "Read,Glob,Grep,Bash(git diff:*),Bash(git log:*)"`. `canIsolateWrites: true` (Claude Code chỉ sửa trong thư mục làm việc). `actualModel`: đọc khóa đầu tiên của `modelUsage` trong JSON đầu ra; không có thì `null`.

- [ ] **Step 1: Kiểm tra CLI thật.** Chạy `claude --help` — Expected: có `-p`, `--output-format`, `--permission-mode`, `--allowedTools`, `--model`. Thiếu cờ nào thì ghi vào README mục "Ghi chú tương thích" và dừng hỏi người dùng.
- [ ] **Step 2: Viết test lỗi `claude.test.ts`:** args của `work` chứa `-p` ngay trước prompt, `--permission-mode acceptEdits`, `Bash(npm test:*)` khi `allowCommands = ['npm test']`, `--model sonnet` khi model là `sonnet`, không có `--model` khi model `null`; args của `review` chứa `--permission-mode default` và không chứa `Edit`/`Write`; `actualModel('{"modelUsage":{"claude-opus-4":{}}}') === 'claude-opus-4'`; `actualModel('rác') === null`.
- [ ] **Step 3: Viết test lỗi `forbidden.test.ts`:** với mọi adapter `getAdapter` trả về (lặp qua 4 tên, bỏ qua `null`), mọi mode, `build().args` không chứa phần tử nào của `FORBIDDEN_FLAGS`. `getAdapter('cursor') === null`.
- [ ] **Step 4: Chạy** — Expected: FAIL.
- [ ] **Step 5: Cài đặt.**
- [ ] **Step 6: Chạy test** — Expected: PASS.
- [ ] **Step 7: Commit** `feat: adapter Claude`.

### Task 7: Chạy worker + kiểm tra ghi ra ngoài

**Chờ:** 4, 6

**Files:**
- Create: `src/worker.ts`, `tests/fixtures/fake-tool.mjs`
- Modify: `src/adapters/index.ts` (cho phép đăng ký adapter giả khi test)
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `WorkerJob`, `getAdapter` (Task 6); `dirtySnapshot`, `commitAll` (Task 4); `BlockKind` (Task 3).
- Produces:
  ```ts
  export const BLOCKED_MARKER = '.konoha-blocked.json';  // {"kind":"needs_permission"|"needs_library"|"plan_change","detail":string}
  export function buildBrief(plan: Plan, task: PlanTask, specPath: string, reviewNotes: string | null): string;
  export interface WorkerResult { outcome: 'changed' | 'no_changes' | 'blocked' | 'timeout' | 'error' | 'outside_write';
    block: { kind: BlockKind; detail: string } | null; stdout: string; model: string | null; testOutput: string }
  export function runWorker(opts: { adapter: Adapter; job: WorkerJob; guardPaths: string[];
    timeoutMs: number; testCommand: string; commitMessage: string }): Promise<WorkerResult>;
  export function registerAdapter(a: Adapter): void;    // chỉ dùng trong test
  ```
- `buildBrief` gồm: tên và nội dung việc, đường dẫn spec, đường dẫn plan, danh sách files, các luật cho worker bằng tiếng Việt (chỉ sửa trong thư mục hiện tại; không cài gói, không gọi mạng, không chạy git; cần quyền / thư viện / đổi plan thì ghi `BLOCKED_MARKER` rồi dừng), và nhận xét review nếu có.
- Thứ tự trong `runWorker`: chụp `dirtySnapshot(guardPaths)` → chạy tiến trình (cwd = worktree, giết khi quá `timeoutMs`) → chụp lại, khác thì `outside_write` → có `BLOCKED_MARKER` thì `blocked` → `commitAll` (loại trừ marker), `false` thì `no_changes` → chạy `testCommand` trong worktree, lưu đầu ra vào `testOutput` (test hỏng vẫn là `changed`; review sẽ quyết) → `changed`.
- `fake-tool.mjs`: đọc biến môi trường `FAKE_MODE` ∈ `write | none | hang | block | outside | crash` và làm đúng việc đó trong cwd (`outside` ghi vào thư mục cha `FAKE_OUTSIDE_DIR`).

- [ ] **Step 1: Viết test lỗi** (adapter giả gọi `node tests/fixtures/fake-tool.mjs`, repo từ `makeRepo`):
  - `write` → `outcome 'changed'`, nhánh worktree có thêm 1 commit.
  - `none` → `'no_changes'`, không có commit mới.
  - `hang` với `timeoutMs 500` → `'timeout'` trong vòng 3 giây, tiến trình đã bị giết.
  - `block` → `'blocked'`, `block.kind === 'needs_library'`, marker không nằm trong commit nào.
  - `outside` (ghi vào repo gốc, có trong `guardPaths`) → `'outside_write'`.
  - `crash` (thoát mã 1, không sửa gì) → `'error'`.
  - `buildBrief` chứa tên việc, đường dẫn spec, chuỗi `BLOCKED_MARKER`, và chứa nhận xét khi truyền `reviewNotes`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `buildBrief`, `runWorker` bằng `spawn`, giết theo nhóm tiến trình (`detached: true`, `process.kill(-pid)`).
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: chạy worker có kiểm soát`.

### Task 8: Adapter Codex, Gemini, OpenCode

**Chờ:** 6

**Files:**
- Create: `src/adapters/codex.ts`, `src/adapters/gemini.ts`, `src/adapters/opencode.ts`
- Modify: `src/adapters/index.ts`
- Test: `tests/adapters/codex.test.ts`, `tests/adapters/gemini.test.ts`, `tests/adapters/opencode.test.ts`

**Interfaces:**
- Consumes/Produces: `Adapter` (Task 6). Không có adapter nào hỗ trợ `mode: 'review'` (review luôn là Claude); `build` với `review` ném lỗi.
- Codex: `codex exec --cd <worktree> --sandbox workspace-write --json [--model <m>] <prompt>`; `canIsolateWrites: true` (sandbox workspace-write chặn ghi ngoài thư mục và chặn mạng theo mặc định).
- Gemini: `gemini -p <prompt> --sandbox --approval-mode auto_edit --allowed-tools <run_shell_command(cmd) cho mỗi allowCommand> [--model <m>]`, env `SEATBELT_PROFILE=permissive-open`; `canIsolateWrites: true` (seatbelt chặn ghi ngoài thư mục dự án).
- OpenCode: `opencode run [--model <provider/model>] <prompt>`, env `OPENCODE_CONFIG_CONTENT` = JSON cấu hình quyền `{"permission":{"edit":"allow","bash":{"*":"deny",<cmd>:"allow"},"webfetch":"deny","external_directory":"deny"}}`; **`canIsolateWrites: false`** cho tới khi Step 2 xác nhận.
- `actualModel` cả ba trả `null` trừ khi Step 1 xác nhận đầu ra có trường model ổn định.

- [ ] **Step 1: Kiểm tra CLI thật.** `codex exec --help`, `gemini --help`, `opencode run --help`. Expected: có đủ các cờ ở trên. Cờ nào khác tên thì dùng tên thật và ghi vào README "Ghi chú tương thích"; công cụ nào không có cách chặn ghi ngoài thư mục thì để `canIsolateWrites: false`.
- [ ] **Step 2: Kiểm tra cách ly của OpenCode** trong repo tạm: chạy adapter với prompt "tạo file ../outside.txt". Expected: file không được tạo. Tạo được thì giữ `canIsolateWrites: false`; không tạo được thì đổi thành `true` và ghi lại phiên bản đã thử vào README.
- [ ] **Step 3: Viết test lỗi** cho từng adapter: args/env khớp đúng như trên với `model` có và `null`, `allowCommands = ['npm test']`; `build` với `review` ném lỗi; `canIsolateWrites` đúng giá trị đã chốt. `forbidden.test.ts` (Task 6) giờ phủ cả ba.
- [ ] **Step 4: Chạy** — Expected: FAIL.
- [ ] **Step 5: Cài đặt.**
- [ ] **Step 6: Chạy toàn bộ test adapter** — Expected: PASS.
- [ ] **Step 7: Commit** `feat: adapter Codex, Gemini, OpenCode`.

### Task 9: Review (PM phán đoán)

**Chờ:** 6, 7

**Files:**
- Create: `src/review.ts`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: claude adapter (`mode: 'review'`), `Plan`, `PlanTask`, `WorkerResult`.
- Produces:
  ```ts
  export interface Verdict { verdict: 'pass' | 'fail'; notes: string; planChange: string | null }
  export function buildReviewPrompt(plan: Plan, task: PlanTask, specPath: string, diff: string, testOutput: string): string;
  export function parseVerdict(stdout: string): Verdict;
  export function runReview(opts: { worktree: string; plan: Plan; task: PlanTask; specPath: string;
    featBranch: string; testOutput: string; reviewModel: string; policy: Policy; timeoutMs: number })
    : Promise<{ verdict: Verdict; model: string | null }>;
  ```
- Prompt yêu cầu trả lời **chỉ** một khối JSON `{"verdict":"pass"|"fail","notes":"...","planChange":null|"..."}`; tiêu chí: đúng việc trong plan, đúng spec, test qua, không làm thừa. `diff` = `git diff <featBranch>...HEAD` trong worktree.

- [ ] **Step 1: Viết test lỗi** cho `parseVerdict` trên `stdout` dạng JSON của `claude --output-format json` (trường `result` chứa văn bản):
  - `result` là `{"verdict":"pass","notes":"ok","planChange":null}` → pass.
  - JSON nằm trong khối ```json …``` kèm chữ xung quanh → vẫn đọc được.
  - `planChange: "tách task 2"` → giữ nguyên.
  - `result` không phải JSON, hoặc `verdict` lạ → `{verdict:'fail', notes:'Review trả về sai định dạng', planChange:null}`.
  - `buildReviewPrompt` chứa tên việc, đường dẫn spec, diff, test output.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `buildReviewPrompt`, `parseVerdict`, `runReview` (gọi tiến trình như `runWorker` nhưng không commit, không chạy test).
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: review bằng Claude model mạnh`.

### Task 10: Cài thư viện theo plan + báo người dùng

**Chờ:** 4

**Files:**
- Create: `src/deps.ts`, `src/notify.ts`
- Test: `tests/deps.test.ts`, `tests/notify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function installLibraries(integrationWt: string, commands: string[]): void; // chạy lần lượt qua shell, rồi commitAll "chore: thêm thư viện theo plan"; lệnh hỏng thì ném lỗi chứa lệnh đó
  export function notifyUser(title: string, message: string, run?: (cmd: string, args: string[]) => void): void; // osascript display notification; luôn in ra stdout
  ```

- [ ] **Step 1: Viết test lỗi:** `installLibraries` với `['echo a > lib.txt']` → integration có commit mới chứa `lib.txt`; mảng rỗng → không có commit mới; lệnh `false` → ném lỗi chứa `false`. `notifyUser` với `run` giả → được gọi với `osascript` và args chứa tiêu đề; chuỗi có dấu `"` được thoát đúng.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: cài thư viện theo plan và thông báo`.

### Task 11: Vòng điều phối

**Chờ:** 2, 3, 5, 7, 9, 10

**Files:**
- Create: `src/orchestrator.ts`
- Test: `tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: mọi thứ ở trên.
- Produces:
  ```ts
  export interface RunDeps { review?: typeof runReview; notify?: typeof notifyUser; which?: (bin: string) => boolean }
  export function runPlan(repoRoot: string, planPath: string, deps?: RunDeps): Promise<RunState>;
  export function retryTask(repoRoot: string, slug: string, taskId: number): void; // blocked → pending, attempts 0
  export function mergeToDev(repoRoot: string, slug: string): 'merged' | 'conflict' | 'not_ready';
  ```
- Thứ tự trong `runPlan`:
  1. Parse + `validatePlan`; có lỗi thì ném lỗi liệt kê tất cả.
  2. `loadState` hoặc `initState`; `recoverInterrupted`.
  3. `ensureExcluded('.konoha/')`, `ensureBranches`, `integrationWorktree`; chưa `librariesInstalled` thì `installLibraries` rồi đặt cờ.
  4. Vòng lặp: lấy `nextRunnable`; với mỗi việc: kiểm tra trước (`getAdapter` null, `!which(binary)`, hoặc `!canIsolateWrites` → chặn `tool_unavailable` với detail nói rõ lý do); còn lại `createTaskWorktree`, chạy `setupCommand` nếu có (do chương trình chạy), đặt `running`, `runWorker` → kết quả khác `changed` thì chặn với kind tương ứng (`error` → `worker_error`); `changed` → `runReview` → `pass`: `mergeTaskBranch`, conflict → `merge_conflict`; gộp được thì chạy `testCommand` trong integration, hỏng → `undoLastMerge` + `tests_failed_after_merge`; qua → `merged`, xóa worktree. `fail` có `planChange` → `plan_change`; `fail` khác → nếu `attempts < maxReviewRetries` thì chạy lại worker trong cùng worktree với `reviewNotes`, ngược lại `review_limit`.
  5. Các việc chạy song song bằng `Promise`; `saveState` và `appendEvent` sau mỗi lần đổi trạng thái (`role`, `tool`, `modelRequested`, `model` điền đúng; review có `role: 'judge'`).
  6. Hết việc chạy được và không còn việc đang chạy: mọi việc `merged` → `awaiting_merge`, `notify` "Xong, chờ bạn duyệt gộp vào dev"; ngược lại → `needs_user`, `notify` liệt kê việc bị chặn và lý do.
- `guardPaths` cho `runWorker` = repo gốc + integration worktree + worktree của các việc khác đang chạy.

- [ ] **Step 1: Viết test lỗi** (adapter giả ở Task 7 đăng ký dưới tên `codex`; `review` giả trả `pass` trừ khi test cấu hình khác; `which` giả trả `true`):
  - `happy path`: plan 4 việc ở mục "Định dạng" → trạng thái cuối `awaiting_merge`, `feat/<slug>` có 4 lần gộp, `dev` chưa đổi, `notify` được gọi một lần.
  - `parallel`: ghi lại thời điểm bắt đầu/kết thúc; việc 2 và 3 chồng thời gian nhau; việc 4 bắt đầu sau khi cả hai kết thúc.
  - `blocked branch continues`: việc 2 `FAKE_MODE=block` → 2 `blocked/needs_library`, 3 `merged`, 4 `pending`, run `needs_user`.
  - `review retry then limit`: review luôn `fail` → worker chạy đúng 3 lần (1 + 2), việc bị chặn `review_limit`.
  - `plan change`: review trả `planChange` → `plan_change`, file plan không đổi (so nội dung trước/sau).
  - `merge conflict`: việc 2 và 3 sửa cùng dòng của file không khai báo trong `Files` → một việc `merged`, việc kia `merge_conflict`, `git status` của integration sạch.
  - `tool unavailable`: `which` trả `false` cho `gemini` → việc giao cho gemini bị chặn `tool_unavailable`, các việc khác vẫn chạy; tương tự với adapter có `canIsolateWrites: false`.
  - `resume after crash`: chạy với việc 1 xong, sửa `state.json` để việc 2 là `running`, gọi lại `runPlan` → việc 1 không chạy lại (đếm số lần gọi tool), việc 2 chạy lại, kết thúc `awaiting_merge`.
  - `not approved`: plan nháp → ném lỗi chứa `Plan chưa được duyệt`, không tạo nhánh nào.
  - `events`: lượt chạy happy path có ít nhất các loại `run_started`, `task_started`, `review_passed`, `task_merged`, `run_awaiting_merge`; mọi sự kiện có `run === slug`.
  - `mergeToDev`: khi `awaiting_merge` → `'merged'` và `dev` chứa các commit của `feat/<slug>`, status `merged_to_dev`; khi `needs_user` → `'not_ready'`.
  - `retryTask`: việc `blocked` → `pending`, `attempts 0`, `block null`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `runPlan`, `retryTask`, `mergeToDev`. Việc ghi `state.json` được tuần tự hóa qua một hàng đợi trong tiến trình để các việc song song không ghi đè lẫn nhau.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: vòng điều phối`.

### Task 12: Lệnh `konoha`

**Chờ:** 11

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `runPlan`, `retryTask`, `mergeToDev`, `loadState`, `readEvents`.
- Produces lệnh (dùng `node:util` `parseArgs`, chạy trong repo đích):
  - `konoha run <plan.md>` — chạy hoặc chạy tiếp.
  - `konoha status <plan.md>` — in bảng: id, tên, công cụ/model, trạng thái, lý do bị chặn; dòng đầu là trạng thái lượt chạy.
  - `konoha retry <plan.md> <taskId>` — sau khi người dùng đã xử lý (cấp quyền, cài thư viện, sửa plan), đưa việc về `pending`.
  - `konoha merge <plan.md>` — gộp `feat/<slug>` vào `dev` (chỉ khi `awaiting_merge`).
  Mã thoát: `0` thành công, `1` lỗi plan/cấu hình, `2` cần người dùng (`needs_user`, `not_ready`, `conflict`).

- [ ] **Step 1: Viết test lỗi** gọi `main(argv)` trực tiếp: không có lệnh → in hướng dẫn, mã `1`; `status` trên plan chưa chạy → in `Chưa chạy`; `status` sau khi chặn một việc → dòng của việc đó chứa `needs_library`; `merge` khi chưa xong → mã `2`; `retry` với id không tồn tại → mã `1`, thông báo chứa `Không có task`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `export async function main(argv: string[]): Promise<number>` và dòng shebang `#!/usr/bin/env node` gọi nó.
- [ ] **Step 4: Chạy toàn bộ** `npm run build && npm test` — Expected: build không lỗi, mọi test PASS.
- [ ] **Step 5: Thử thật trên máy (thủ công).** Trong một repo thử, tạo `.konoha/config.json` `{"testCommand":"npm test"}` và một plan 2 việc (1 giao `claude / sonnet`, 2 giao `codex`, 2 chờ 1). Chạy `konoha run`. Expected: `konoha status` cuối cùng là `awaiting_merge` (hoặc `needs_user` với lý do rõ ràng), `.konoha/runs/<slug>/events.jsonl` có sự kiện của cả hai công cụ.
- [ ] **Step 6: Commit** `feat: lệnh konoha`.

### Task 13: Add-on cho khâu lập plan

**Chờ:** 1

**Files:**
- Create: `skills/konoha-plan/SKILL.md`, `tests/skill-example.test.ts`

**Interfaces:**
- Consumes: `parsePlan` (Task 1), `validatePlan` (Task 2).
- Produces: một skill độc lập (không sửa skill của Superpowers), dùng **sau** `superpowers:writing-plans`. Skill hướng dẫn công cụ đang lập plan:
  - thêm `**Giao cho:**` và `**Chờ:**` cho mọi task (đề xuất công cụ: việc khó/kiến trúc → `claude / opus`, code rõ ràng → công cụ người dùng hay dùng hoặc `claude / sonnet`; người dùng sửa khi duyệt);
  - thêm mục `## Thư viện cần thêm` với lệnh cài chính xác kèm phiên bản, hoặc ghi `- (không có)`;
  - ghi `**Trạng thái plan:** nháp`; **chỉ người dùng** đổi thành `đã duyệt`, rồi chạy `konoha run <plan>`.
  - Skill có một plan ví dụ hoàn chỉnh trong khối ```markdown.

- [ ] **Step 1: Viết test lỗi** `tests/skill-example.test.ts`: đọc `skills/konoha-plan/SKILL.md`, lấy khối ```markdown đầu tiên, đổi `nháp` thành `đã duyệt`, `validatePlan(parsePlan(...))` trả `[]`; trước khi đổi thì chứa `Plan chưa được duyệt`.
- [ ] **Step 2: Chạy** — Expected: FAIL (file chưa có).
- [ ] **Step 3: Viết `SKILL.md`** (frontmatter `name: konoha-plan`, `description: Use after writing an implementation plan that will be executed by the konoha orchestrator`), nội dung tiếng Việt như trên.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: skill định dạng plan cho konoha`.
