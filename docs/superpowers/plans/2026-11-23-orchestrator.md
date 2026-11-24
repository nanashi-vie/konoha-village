# Bộ điều phối `konoha` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một chương trình dòng lệnh `konoha` nhận một plan đã duyệt, chạy từng việc bằng công cụ được chỉ định (dựng sẵn Claude Code và Antigravity CLI `agy`; công cụ khác, kể cả nhiều tài khoản của cùng một công cụ, thêm bằng file khai báo JSON) trong worktree riêng, đúng thứ tự phụ thuộc, review bằng Claude model mạnh, gộp vào `feat/<tên-task>`, rồi dừng chờ người dùng duyệt gộp vào `dev`.

**Architecture:** "PM cơ học" là code thuần (đọc plan, xếp lịch, git, quyền, nhật ký), không dùng AI. Worker và "PM phán đoán" (review) là các tiến trình CLI mới, ngắn, gọi qua adapter được dựng từ file khai báo công cụ (JSON). Toàn bộ trạng thái nằm trong file dưới `.konoha/` của repo đích, nên dừng/chạy lại được bất kỳ lúc nào.

**Tech Stack:** TypeScript, Node.js ≥ 20, không dùng thư viện chạy (runtime) nào ngoài thư viện chuẩn của Node; dev: `typescript`, `vitest`, `@types/node`. Gọi git và các CLI bằng `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-11-23-orchestrator-design.md` và `docs/superpowers/specs/2026-11-24-tool-adapters-design.md` (lớp adapter; nếu hai spec khác nhau về adapter thì spec 2026-11-24 thắng)

## Global Constraints

- Chạy trên macOS, trong một repo git. Node ≥ 20.
- Không bao giờ truyền cờ bỏ qua quyền cho bất kỳ công cụ nào: `--dangerously-skip-permissions`, `--yolo`, `-y`, `--dangerously-bypass-approvals-and-sandbox`, `--full-auto`, `--approval-mode yolo`.
- Worker chỉ được đọc/sửa file trong worktree của mình và chạy các lệnh trong `allowCommands` của file quyền. Worker không push, không gộp, không cài gói, không gọi mạng. Chỉ chương trình được commit, gộp và cài thư viện.
- Công cụ chỉ được giao việc khi `isAssignable`: `isolation: "trusted"` (chỉ `claude` dựng sẵn) hoặc có bản xác minh khớp băm file khai báo (`konoha tool check <tên>`, thử bắt công cụ tạo `../outside.txt`).
- Công cụ là file JSON, ưu tiên theo thứ tự: `<repo>/.konoha/tools/<tên>.json`, `~/.config/konoha/tools/<tên>.json`, rồi dựng sẵn (`claude`, `agy`). File khai báo chỉ chứa đường dẫn, không chứa khóa hay token.
- Mọi công cụ qua kiểm tra cờ cấm khi nạp file (kể cả sau `extends`) và khi dựng lệnh (kể cả giá trị model). Review luôn dùng công cụ `claude`.
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
5. **Công cụ chưa có, chưa xác minh cách ly, hoặc thiếu binary:** `runPlan` từ chối ngay, trước khi tạo nhánh, và liệt kê mọi vấn đề một lần; công cụ biến mất giữa chừng (chạy tiếp sau khi tắt) thì việc đó bị chặn `tool_unavailable`, không làm sập cả lượt. → test trong Task 11.
6. **File khai báo công cụ hỏng hoặc độc:** JSON sai, `extends` vòng hoặc trỏ vào file không có, chỗ trống lạ như `{foo}`, cờ cấm trong mẫu lệnh, hoặc tên model trùng cờ cấm (`claude / -y`): công cụ bị loại với lỗi nêu rõ tên và nguyên nhân, không bao giờ chạy. → test trong Task 6.

---

## Định dạng plan đầu vào (phần mở rộng)

Đây là hợp đồng giữa khâu lập plan và chương trình. Task 1 parse đúng định dạng này và ghi nó vào `README.md`.

```markdown
# <Tên> Implementation Plan
**Trạng thái plan:** đã duyệt

## Thư viện cần thêm
- `npm install nodemailer@6.9.14`

### Task 1: Tạo bảng dữ liệu
**Giao cho:** agy / gemini-4-hydrogen-low
**Chờ:** —
**Files:**
- Create: `src/db/schema.ts`
- Modify: `src/app.ts:10-20`
...nội dung việc...

### Task 2: Viết API
**Giao cho:** claude / sonnet
**Chờ:** 1
```

- `**Giao cho:** <tool>` hoặc `<tool> / <model>`; `<tool>` là tên một công cụ khai báo (khớp `^[a-z0-9][a-z0-9_-]*$`, ví dụ `claude`, `agy`, `claude-work`), `<model>` là chuỗi truyền nguyên cho cờ model của công cụ đó.
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
  adapters/types.ts       Adapter, WorkerJob, Invocation, FORBIDDEN_FLAGS
  adapters/definition.ts  ToolDefinition, resolveDefinition, compileTool
  adapters/load.ts        loadAdapters (repo > user > dựng sẵn)
  adapters/verify.ts      checkTool, loadVerifications, isAssignable
  adapters/builtin/       claude.json, agy.json
  worker.ts            buildBrief, runWorker, readBlockedMarker
  review.ts            buildReviewPrompt, parseVerdict, runReview
  deps.ts              installLibraries
  notify.ts            notifyUser
  orchestrator.ts      runPlan
  cli.ts               lệnh konoha
tests/  (một file test cho mỗi file nguồn, cùng tên) + tests/helpers/tmpRepo.ts + tests/helpers/fakeTool.ts + tests/fixtures/fake-tool.mjs
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
  export interface PlanTask { id: number; name: string; tool: string; model: string | null;
    waitsOn: number[]; files: string[]; body: string }
  export interface Plan { path: string; slug: string; title: string; approved: boolean;
    libraries: string[]; tasks: PlanTask[] }
  export function parsePlan(markdown: string, path: string): Plan;
  ```

- [ ] **Step 1: Khung dự án.** `package.json` với `"type": "module"`, `"bin": {"konoha": "dist/cli.js"}`, scripts `build` (`tsc && cp -R src/adapters/builtin dist/adapters/`), `test` (`vitest run`), `engines.node` `>=20`; devDependencies `typescript`, `vitest`, `@types/node`. `tsconfig` target ES2022, module NodeNext, strict. Chạy `npm install`.
- [ ] **Step 2: Viết test lỗi** trong `tests/plan/parse.test.ts`, dùng đúng ví dụ ở mục "Định dạng plan đầu vào":
  - `parses approved flag`: `approved === true`; plan không có dòng trạng thái → `false`; `**Trạng thái plan:** nháp` → `false`.
  - `parses slug from filename`: path `docs/superpowers/plans/2026-11-23-gui-email.md` → `slug === 'gui-email'`.
  - `parses libraries`: `libraries` bằng `['npm install nodemailer@6.9.14']` (bỏ dấu backtick).
  - `parses tasks`: 2 việc; task 1 `{id:1, name:'Tạo bảng dữ liệu', tool:'agy', model:'gemini-4-hydrogen-low', waitsOn:[], files:['src/db/schema.ts','src/app.ts']}`; task 2 `{tool:'claude', model:'sonnet', waitsOn:[1]}`.
  - `tool without model`: `**Giao cho:** agy` → `model === null`.
  - `body is task text`: `body` của task 1 chứa `...nội dung việc...` và không chứa `### Task 2`.
- [ ] **Step 3: Chạy** `npx vitest run tests/plan/parse.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 4: Cài đặt `parsePlan`.** Tách việc theo heading `### Task <n>: <tên>`; đọc các dòng `**Giao cho:**`, `**Chờ:**`; files từ các dòng `- Create|Modify|Test: \`...\`` (bỏ hậu tố `:<dòng>`). Thiếu `**Giao cho:**` thì `tool = ''` (validate sẽ bắt).
- [ ] **Step 5: Chạy lại test** — Expected: PASS.
- [ ] **Step 6: README.** Ghi định dạng plan đầu vào (copy mục trên) và các lệnh ở Task 12.
- [ ] **Step 7: Commit** `feat: khung dự án và parse plan`.

### Task 2: Kiểm tra plan + cấu hình + file quyền

**Chờ:** 1

**Files:**
- Create: `src/plan/validate.ts`, `src/config.ts`
- Test: `tests/plan/validate.test.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `Plan` (Task 1).
- Produces:
  ```ts
  export function validatePlan(plan: Plan, knownTools: string[]): string[];   // [] = hợp lệ; knownTools = tên các công cụ đã nạp (Task 6)
  export interface Config { maxParallel: number; maxReviewRetries: number; workerTimeoutMinutes: number;
    testCommand: string; setupCommand: string | null; reviewModel: string;
    baseBranch: string; integrationBranch: string }
  export const DEFAULT_CONFIG: Omit<Config, 'testCommand'>;
  export interface Policy { allowCommands: string[] }
  export function loadConfig(repoRoot: string): Config;  // .konoha/config.json
  export function loadPolicy(repoRoot: string, config: Config): Policy; // .konoha/permissions.json
  ```

- [ ] **Step 1: Viết test lỗi `validate.test.ts`** (gọi `validatePlan(plan, ['claude','agy'])`), mỗi test kiểm tra mảng lỗi chứa chuỗi tiếng Việt cụ thể:
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
    | 'run_needs_user' | 'run_merged_to_dev' | 'tool_overridden';
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
- Produces: `export function nextRunnable(plan: Plan, state: RunState, maxParallel: number, toolLimits?: Record<string, number>): number[];`
  Luật: việc `pending` có mọi việc trong `waitsOn` là `merged`; không trùng file với việc đang `running` hoặc với việc khác vừa được chọn trong cùng lần gọi; tổng số `running` + được chọn ≤ `maxParallel`; với mỗi công cụ có trong `toolLimits`, số việc `running` + được chọn của công cụ đó ≤ giới hạn của nó (hạn mức tính theo tài khoản); chọn theo id tăng dần.

- [ ] **Step 1: Viết test lỗi**, dùng plan 4 việc ở mục "Định dạng" (1; 2 chờ 1; 3 chờ 1; 4 chờ 2,3; việc 2 và 3 giao cho `claude`):
  - lúc đầu → `[1]`.
  - 1 merged → `[2, 3]`.
  - 1 merged, `maxParallel 1` → `[2]`.
  - 2 và 3 cùng có file `src/app.ts` → `[2]`; 2 running → `[]`.
  - 1 merged, 2 blocked, 3 merged → `[]` (4 không bao giờ chạy khi 2 bị chặn).
  - mọi việc merged → `[]`.
  - 1 merged, `toolLimits {claude: 1}` → `[2]`; khi 2 đang `running` → `[]`; `toolLimits {}` → `[2, 3]`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt `nextRunnable`.**
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: xếp lịch theo phụ thuộc`.

### Task 6: Định nghĩa công cụ, nạp file khai báo, công cụ `claude`

**Chờ:** 2, 4

**Files:**
- Create: `src/adapters/types.ts`, `src/adapters/definition.ts`, `src/adapters/load.ts`, `src/adapters/builtin/claude.json`
- Test: `tests/adapters/definition.test.ts`, `tests/adapters/load.test.ts`, `tests/adapters/claude.test.ts`, `tests/adapters/forbidden.test.ts`

**Interfaces:**
- Consumes: `Policy` (Task 2).
- Produces:
  ```ts
  // types.ts
  export interface WorkerJob { worktree: string; prompt: string; model: string | null; policy: Policy; mode: 'work' | 'review' }
  export interface Invocation { cmd: string; args: string[]; env: Record<string, string> }
  export interface Adapter { tool: string; binary: string; isolation: 'trusted' | 'verify'; hash: string;
    maxParallel: number | null; hasMode(mode: 'work' | 'review'): boolean;
    build(job: WorkerJob): Invocation;            // ném lỗi nếu công cụ không có mode đó
    actualModel(stdout: string): string | null }  // null khi không đọc được model thật
  export const FORBIDDEN_FLAGS: string[];         // đúng danh sách ở Global Constraints

  // definition.ts
  export interface ModeDef { args: string[] }
  export interface ToolDefinition { extends?: string; binary?: string; env?: Record<string, string>;
    maxParallel?: number; isolation?: 'trusted' | 'verify';           // mặc định 'verify'
    modelFlag?: string[]; commandRule?: string; modelFrom?: { path: string[]; firstKey?: boolean };
    modes?: { work?: ModeDef; review?: ModeDef } }
  export function resolveDefinition(name: string, sources: Record<string, ToolDefinition>): ToolDefinition;
  export function compileTool(name: string, def: ToolDefinition, homeDir?: string): Adapter;  // def đã resolve

  // load.ts
  export interface LoadResult { adapters: Map<string, Adapter>; errors: { tool: string; message: string }[];
    sources: Record<string, 'builtin' | 'user' | 'repo'>; overridden: { tool: string; by: 'user' | 'repo' }[] }
  export function loadAdapters(repoRoot: string, homeDir?: string): LoadResult;  // homeDir mặc định os.homedir()
  ```
- Luật của file khai báo:
  - `resolveDefinition`: `extends` trỏ tới tên khác trong `sources`; trường đơn giản của con thắng cha; `env` gộp theo khóa (con thắng); `modes.work` / `modes.review` của con thay nguyên khối của cha. Vòng `extends` ném lỗi chứa `Vòng extends`; cha không có ném lỗi chứa `không tìm thấy`.
  - Chỗ trống trong `args` và `env`: `{prompt}`, `{worktree}` thay vào chuỗi chứa nó; một phần tử đúng bằng `{modelFlag}` được thay bằng các phần tử của `modelFlag` (với `{model}` điền sẵn) hoặc bị bỏ khi `job.model` là `null`; `{allowCommands}` trong một chuỗi được thay bằng `commandRule` áp cho từng lệnh trong `policy.allowCommands` (`{cmd}` là lệnh), nối bằng `,`, và khi không có lệnh nào thì bỏ luôn dấu `,` đứng trước nó. `{model}` chỉ hợp lệ trong `modelFlag`. Chỗ trống lạ (ví dụ `{foo}`) làm `compileTool` ném lỗi chứa chỗ trống đó. Giá trị `env` bắt đầu bằng `~/` được mở rộng theo `homeDir`.
  - `compileTool` ném lỗi khi thiếu `binary` hoặc `modes.work`, hoặc khi `args`/`modelFlag` có phần tử thuộc `FORBIDDEN_FLAGS`. `build()` kiểm lại mọi phần tử của `args` cuối cùng **trừ phần tử đến từ `{prompt}`** (kể cả giá trị model) và ném lỗi nếu trùng `FORBIDDEN_FLAGS`.
  - `hash` = SHA-256 (hex) của JSON chuẩn hóa (khóa sắp xếp) của `{name, def đã resolve}`.
  - `actualModel`: parse stdout là JSON, đi theo `modelFrom.path`; `firstKey` thì lấy khóa đầu tiên của object tại đó; không đọc được hoặc không có `modelFrom` thì `null`.
  - Nạp file: `<repo>/.konoha/tools/*.json` (nguồn `repo`) > `<homeDir>/.config/konoha/tools/*.json` (`user`) > `src/adapters/builtin/*.json` (`builtin`, đọc qua `new URL('./builtin/', import.meta.url)`); tên công cụ = tên file bỏ `.json`. File trùng tên với nguồn thấp hơn thì thay thế và ghi vào `overridden`. File lỗi (JSON sai, lỗi `resolveDefinition`/`compileTool`) vào `errors` và không có trong `adapters`.
- `builtin/claude.json` (đúng nguyên văn):
  ```json
  {"binary":"claude","isolation":"trusted","modelFlag":["--model","{model}"],"commandRule":"Bash({cmd}:*)",
   "modelFrom":{"path":["modelUsage"],"firstKey":true},
   "modes":{
     "work":{"args":["-p","{prompt}","--output-format","json","--permission-mode","acceptEdits","--allowedTools","Read,Edit,Write,Glob,Grep,{allowCommands}","{modelFlag}"]},
     "review":{"args":["-p","{prompt}","--output-format","json","--permission-mode","default","--allowedTools","Read,Glob,Grep,Bash(git diff:*),Bash(git log:*)","{modelFlag}"]}}}
  ```

- [ ] **Step 1: Kiểm tra CLI thật.** Chạy `claude --help` — Expected: có `-p`, `--output-format`, `--permission-mode`, `--allowedTools`, `--model`. Thiếu cờ nào thì ghi vào README mục "Ghi chú tương thích" và dừng hỏi người dùng.
- [ ] **Step 2: Viết test lỗi `definition.test.ts`:**
  - `placeholders`: `{prompt}` và `{worktree}` được thay; `{modelFlag}` cho `model 'm1'` → `--model`, `m1` đúng chỗ, và với `model null` → không có `--model`; `{allowCommands}` với `['npm test','npm run lint']` → `Read,Bash(npm test:*),Bash(npm run lint:*)` từ chuỗi `Read,{allowCommands}`, và với `[]` → `Read` (không dấu `,` thừa).
  - `unknown placeholder`: `{foo}` → `compileTool` ném lỗi chứa `{foo}`.
  - `forbidden`: mẫu có `--yolo` → `compileTool` ném lỗi chứa `--yolo`; model `'-y'` → `build()` ném lỗi; prompt bằng `'-y'` thì **không** ném.
  - `resolveDefinition`: con ghi đè `env` một khóa và giữ khóa còn lại của cha; `modes.work` của con thay nguyên khối; vòng `a→b→a` → lỗi chứa `Vòng extends`; cha không có → lỗi chứa `không tìm thấy`.
  - `hash`: cùng định nghĩa → cùng băm (kể cả khác thứ tự khóa); đổi một giá trị `env` → băm khác; đổi tên công cụ → băm khác.
  - `home`: `env` `{"X":"~/acc"}` với `homeDir '/h'` → `build().env.X === '/h/acc'`.
  - `actualModel` theo `modelFrom`; `actualModel('rác') === null`; không có `modelFrom` → `null`.
- [ ] **Step 3: Viết test lỗi** (tmp repo từ `makeRepo` và thư mục home tạm):
  - `load.test.ts`: chỉ có dựng sẵn → `adapters` có `claude`, `sources.claude === 'builtin'`; `<home>/.config/konoha/tools/claude-work.json` = `{"extends":"claude","env":{"CLAUDE_CONFIG_DIR":"~/.claude-work"},"maxParallel":2}` → `claude-work` có `maxParallel 2`, `isolation 'trusted'`, `build(...).env.CLAUDE_CONFIG_DIR === '<home>/.claude-work'`, `sources['claude-work'] === 'user'`; file cùng tên trong repo đè file user → `overridden` chứa `{tool, by:'repo'}`; JSON sai → `errors` có phần tử `tool` đúng tên và `message` không rỗng, công cụ đó không có trong `adapters`.
  - `claude.test.ts`: args của `work` chứa `-p` ngay trước prompt, `--permission-mode acceptEdits`, `Bash(npm test:*)` khi `allowCommands = ['npm test']`, `--model sonnet` khi model là `sonnet`, không có `--model` khi `null`; args của `review` chứa `--permission-mode default` và không chứa `Edit`/`Write`; `actualModel('{"modelUsage":{"claude-opus-4":{}}}') === 'claude-opus-4'`; `hasMode('review') === true`.
  - `forbidden.test.ts`: với mọi adapter của `loadAdapters` (bỏ qua mode không có), `build().args` không chứa phần tử nào của `FORBIDDEN_FLAGS`.
- [ ] **Step 4: Chạy** `npx vitest run tests/adapters` — Expected: FAIL.
- [ ] **Step 5: Cài đặt** `types.ts`, `definition.ts`, `load.ts`, `builtin/claude.json` theo mục Interfaces.
- [ ] **Step 6: Chạy test** — Expected: PASS.
- [ ] **Step 7: Commit** `feat: công cụ khai báo bằng file và công cụ claude`.

### Task 7: Chạy worker + kiểm tra ghi ra ngoài

**Chờ:** 4, 6

**Files:**
- Create: `src/worker.ts`, `tests/fixtures/fake-tool.mjs`, `tests/helpers/fakeTool.ts`
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `WorkerJob`, `Invocation` (Task 6); `dirtySnapshot`, `commitAll` (Task 4); `BlockKind` (Task 3).
- Produces:
  ```ts
  export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
  export function runInvocation(inv: Invocation, cwd: string, timeoutMs: number): Promise<RunResult>; // stdin đóng; spawn detached; quá giờ thì giết cả nhóm tiến trình
  export const BLOCKED_MARKER = '.konoha-blocked.json';  // {"kind":"needs_permission"|"needs_library"|"plan_change","detail":string}
  export function buildBrief(plan: Plan, task: PlanTask, specPath: string, reviewNotes: string | null): string;
  export interface WorkerResult { outcome: 'changed' | 'no_changes' | 'blocked' | 'timeout' | 'error' | 'outside_write';
    block: { kind: BlockKind; detail: string } | null; stdout: string; model: string | null; testOutput: string }
  export function runWorker(opts: { adapter: Adapter; job: WorkerJob; guardPaths: string[];
    timeoutMs: number; testCommand: string; commitMessage: string }): Promise<WorkerResult>;
  // tests/helpers/fakeTool.ts
  export function fakeAdapter(name: string, mode: string, opts?: { review?: boolean; isolation?: 'trusted' | 'verify';
    maxParallel?: number; extraEnv?: Record<string, string> }): Adapter;  // qua compileTool; binary = process.execPath chạy tests/fixtures/fake-tool.mjs; isolation mặc định 'trusted'
  ```
- `buildBrief` gồm: tên và nội dung việc, đường dẫn spec, đường dẫn plan, danh sách files, các luật cho worker bằng tiếng Việt (chỉ sửa trong thư mục hiện tại; không cài gói, không gọi mạng, không chạy git; cần quyền / thư viện / đổi plan thì ghi `BLOCKED_MARKER` rồi dừng), và nhận xét review nếu có.
- Thứ tự trong `runWorker`: chụp `dirtySnapshot(guardPaths)` → `runInvocation` (cwd = worktree) → chụp lại, khác thì `outside_write` → `timedOut` thì `timeout` → có `BLOCKED_MARKER` thì `blocked` → mã thoát khác 0 và không có thay đổi thì `error` → `commitAll` (loại trừ marker), `false` thì `no_changes` → chạy `testCommand` trong worktree, lưu đầu ra vào `testOutput` (test hỏng vẫn là `changed`; review sẽ quyết) → `changed`. `model` = `adapter.actualModel(stdout)`.
- `fake-tool.mjs` (argv[2] là prompt): mode lấy từ đoạn `FAKE_MODE=<mode>` trong prompt nếu có, không thì từ biến môi trường `FAKE_MODE`; mode ∈ `write | none | hang | block | outside | crash | escape`. `write` tạo `inside.txt` (nội dung `ok`) trong cwd; `escape` tạo `inside.txt` và `../outside.txt`; `outside` ghi vào thư mục `FAKE_OUTSIDE_DIR`; `block` ghi `BLOCKED_MARKER` với `needs_library`; `hang` không bao giờ thoát; `crash` thoát mã 1; `none` không làm gì.

- [ ] **Step 1: Viết test lỗi** (adapter giả từ `fakeAdapter`, repo từ `makeRepo`):
  - `write` → `outcome 'changed'`, nhánh worktree có thêm 1 commit.
  - `none` → `'no_changes'`, không có commit mới.
  - `hang` với `timeoutMs 500` → `'timeout'` trong vòng 3 giây, tiến trình đã bị giết.
  - `block` → `'blocked'`, `block.kind === 'needs_library'`, marker không nằm trong commit nào.
  - `outside` (ghi vào repo gốc, có trong `guardPaths`) → `'outside_write'`.
  - `crash` (thoát mã 1, không sửa gì) → `'error'`.
  - `runInvocation`: `write` trả `code 0` và `stdout` đúng; `hang` với `500ms` → `timedOut === true`.
  - `buildBrief` chứa tên việc, đường dẫn spec, chuỗi `BLOCKED_MARKER`, và chứa nhận xét khi truyền `reviewNotes`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `runInvocation` bằng `spawn` (`detached: true`, `process.kill(-pid)`), `buildBrief`, `runWorker`, `fake-tool.mjs`, `fakeAdapter`.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: chạy worker có kiểm soát`.

### Task 8: Công cụ `agy` + xác minh cách ly

**Chờ:** 6, 7

**Files:**
- Create: `src/adapters/builtin/agy.json`, `src/adapters/verify.ts`
- Modify: `README.md` (mục "Ghi chú tương thích")
- Test: `tests/adapters/verify.test.ts`, `tests/adapters/agy.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `Invocation` (Task 6); `runInvocation`, `fakeAdapter`, `fake-tool.mjs` (Task 7); `Policy` (Task 2).
- Produces:
  ```ts
  export interface Verification { tool: string; hash: string; date: string }
  export function loadVerifications(homeDir?: string): Record<string, Verification>;   // ~/.config/konoha/verified.json; chưa có file thì {}
  export function recordVerification(v: Verification, homeDir?: string): void;        // ghi file tạm rồi rename
  export function isAssignable(a: Adapter, verifications: Record<string, Verification>): boolean; // isolation 'trusted' hoặc verifications[a.tool]?.hash === a.hash
  export function checkTool(a: Adapter, policy: Policy, timeoutMs?: number): Promise<{ ok: boolean; detail: string }>;
  ```
- `checkTool`: tạo repo tạm (`git init`) có thư mục worktree con, chạy `a.build({mode:'work', prompt, model:null, policy, worktree})` qua `runInvocation` với prompt "Tạo file inside.txt chứa chữ ok trong thư mục hiện tại. Sau đó tạo file ../outside.txt chứa chữ ok." (`FAKE_MODE` không bị ghi đè bởi prompt này). `ok` khi `inside.txt` có **và** `../outside.txt` không có; không thì `detail` nói rõ: chứa `outside.txt` nếu công cụ ghi ra ngoài, chứa `inside.txt` nếu công cụ không tạo được file trong thư mục. Luôn xóa thư mục tạm.
- `builtin/agy.json`: `binary: "agy"`, `isolation: "verify"`, `modelFlag: ["--model","{model}"]`, không có `modelFrom` (JSON đầu ra của `agy` không có tên model → `actualModel` là `null`), chỉ có `modes.work`. Args khởi đầu: `["-p","{prompt}","--output-format","json","--mode","accept-edits","{modelFlag}"]`, chốt lại ở Step 2.

- [ ] **Step 1: Đọc cờ thật của `agy`.** `agy --help` (đã biết có `-p`, `--output-format`, `--model`, `--mode accept-edits|auto|plan`, `--sandbox`, `--settings`, `--print-timeout`; bản đã thử: 1.5.16). Tìm cách **giới hạn lệnh chạy được theo `allowCommands`** (đọc `https://antigravity.google/docs/cli`, mục settings/permissions; thử `--settings '<json>'`) mà không dùng `--dangerously-skip-permissions`. Ghi kết quả vào README "Ghi chú tương thích". Nếu không có cách nào giới hạn lệnh: **dừng và hỏi người dùng**, không nới lỏng im lặng.
- [ ] **Step 2: Thử cách ly thật** trong repo tạm, với từng tổ hợp (`--mode accept-edits`; `--mode accept-edits --sandbox`): chạy `agy -p "<prompt như checkTool>" --output-format json …` từ tiến trình con. Chọn tổ hợp nhẹ nhất tạo `inside.txt` mà không tạo `../outside.txt` và chạy được một lệnh trong `allowCommands` mà không bị hỏi; ghi tổ hợp, phiên bản đã thử và ngày vào README; đặt args chốt vào `agy.json`. Không tổ hợp nào đạt → dừng và hỏi người dùng (bản đầu chỉ còn `claude`).
- [ ] **Step 3: Viết test lỗi `verify.test.ts`** (adapter từ `fakeAdapter(..., {isolation: 'verify'})`, home tạm):
  - `checkTool` với mode `write` → `ok === true`; `escape` → `ok === false`, `detail` chứa `outside.txt`; `none` → `ok === false`, `detail` chứa `inside.txt`; `crash` → `ok === false`; không để lại thư mục tạm nào.
  - `recordVerification` rồi `loadVerifications` trả lại đúng; chưa có file → `{}`.
  - `isAssignable`: adapter `verify` không có bản ghi → `false`; có bản ghi khớp `hash` → `true`; bản ghi `hash` khác → `false`; adapter `trusted` → `true`.
- [ ] **Step 4: Viết test lỗi `agy.test.ts`** (adapter `agy` từ `loadAdapters`): `-p` ngay trước prompt, `--output-format json`, `--model gemini-4-hydrogen-low` khi model đó được chỉ định và không có `--model` khi `null`, các cờ chế độ/cách ly đúng như đã chốt ở Step 2, `hasMode('review') === false` và `build({mode:'review',...})` ném lỗi, `isolation === 'verify'`, `actualModel('{"status":"SUCCESS","response":"OK"}') === null`, và args không chứa cờ nào của `FORBIDDEN_FLAGS`.
- [ ] **Step 5: Chạy** `npx vitest run tests/adapters` — Expected: FAIL.
- [ ] **Step 6: Cài đặt** `verify.ts` và `agy.json`.
- [ ] **Step 7: Chạy toàn bộ test adapter** — Expected: PASS.
- [ ] **Step 8: Commit** `feat: công cụ agy và xác minh cách ly`.

### Task 9: Review (PM phán đoán)

**Chờ:** 6, 7

**Files:**
- Create: `src/review.ts`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: `Adapter` (Task 6; truyền adapter `claude`, dùng `mode: 'review'`), `runInvocation` (Task 7), `Plan`, `PlanTask`.
- Produces:
  ```ts
  export interface Verdict { verdict: 'pass' | 'fail'; notes: string; planChange: string | null }
  export function buildReviewPrompt(plan: Plan, task: PlanTask, specPath: string, diff: string, testOutput: string): string;
  export function parseVerdict(stdout: string): Verdict;
  export function runReview(opts: { adapter: Adapter; worktree: string; plan: Plan; task: PlanTask; specPath: string;
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
- [ ] **Step 3: Cài đặt** `buildReviewPrompt`, `parseVerdict`, `runReview` (gọi `runInvocation` với `adapter.build({mode: 'review', model: reviewModel, ...})`; không commit, không chạy test; `model` lấy từ `adapter.actualModel`).
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

**Chờ:** 2, 3, 5, 6, 7, 8, 9, 10

**Files:**
- Create: `src/orchestrator.ts`
- Test: `tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: mọi thứ ở trên.
- Produces:
  ```ts
  export interface RunDeps { review?: typeof runReview; notify?: typeof notifyUser; which?: (bin: string) => boolean;
    adapters?: Map<string, Adapter>; verifications?: Record<string, Verification>; home?: string }
  export function preflightTools(plan: Plan, adapters: Map<string, Adapter>, verifications: Record<string, Verification>,
    which: (bin: string) => boolean, loadErrors: { tool: string; message: string }[]): string[];  // [] = ổn
  export function runPlan(repoRoot: string, planPath: string, deps?: RunDeps): Promise<RunState>;
  export function retryTask(repoRoot: string, slug: string, taskId: number): void; // blocked → pending, attempts 0
  export function mergeToDev(repoRoot: string, slug: string): 'merged' | 'conflict' | 'not_ready';
  ```
- `preflightTools` chỉ xét các công cụ có trong plan, cộng `claude` (cho review); mỗi công cụ báo một lần bằng đúng các câu:
  - `File công cụ "<tên>" lỗi: <message>` (từ `loadErrors`);
  - `Công cụ "<tên>" chưa xác minh cách ly: chạy konoha tool check <tên>` (không `isAssignable`);
  - `Công cụ "<tên>": không tìm thấy lệnh "<binary>" trên máy` (`!which(binary)`);
  - `Review cần công cụ "claude" có chế độ review` (không có `claude` hoặc `!hasMode('review')`).
  Công cụ không có trong `adapters` thì để `validatePlan` báo.
- Thứ tự trong `runPlan`:
  1. Parse; `adapters`/`verifications`/lỗi nạp lấy từ `deps` hoặc `loadAdapters(repoRoot, home)` + `loadVerifications(home)`; `validatePlan(plan, [...adapters.keys()])` cộng `preflightTools`; có lỗi thì ném **một** lỗi liệt kê tất cả, trước khi tạo nhánh hay thư mục nào.
  2. `loadState` hoặc `initState`; `recoverInterrupted`.
  3. `ensureExcluded('.konoha/')`, `ensureBranches`, `integrationWorktree`; chưa `librariesInstalled` thì `installLibraries` rồi đặt cờ. Ghi sự kiện `run_started`, rồi một `tool_overridden` cho mỗi phần tử `overridden` (summary chứa tên công cụ).
  4. Vòng lặp: lấy `nextRunnable(plan, state, config.maxParallel, toolLimits)` với `toolLimits` = `maxParallel` của các adapter có giá trị; với mỗi việc: kiểm tra lại (lớp phòng thủ thứ hai: adapter không còn, `!which(binary)`, hoặc `!isAssignable` → chặn `tool_unavailable` với detail nói rõ lý do); còn lại `createTaskWorktree`, chạy `setupCommand` nếu có (do chương trình chạy), đặt `running`, `runWorker` → kết quả khác `changed` thì chặn với kind tương ứng (`error` → `worker_error`); `changed` → `runReview` với `adapters.get('claude')` → `pass`: `mergeTaskBranch`, conflict → `merge_conflict`; gộp được thì chạy `testCommand` trong integration, hỏng → `undoLastMerge` + `tests_failed_after_merge`; qua → `merged`, xóa worktree. `fail` có `planChange` → `plan_change`; `fail` khác → nếu `attempts < maxReviewRetries` thì chạy lại worker trong cùng worktree với `reviewNotes`, ngược lại `review_limit`.
  5. Các việc chạy song song bằng `Promise`; `saveState` và `appendEvent` sau mỗi lần đổi trạng thái (`role`, `tool`, `modelRequested`, `model` điền đúng; review có `role: 'judge'`).
  6. Hết việc chạy được và không còn việc đang chạy: mọi việc `merged` → `awaiting_merge`, `notify` "Xong, chờ bạn duyệt gộp vào dev"; ngược lại → `needs_user`, `notify` liệt kê việc bị chặn và lý do.
- `guardPaths` cho `runWorker` = repo gốc + integration worktree + worktree của các việc khác đang chạy.

- [ ] **Step 1: Viết test lỗi** (`deps.adapters` = `{fake: fakeAdapter('fake','write'), claude: fakeAdapter('claude','write',{review:true})}`; plan thử giao việc cho `fake` và nhét `FAKE_MODE=<mode>` vào thân việc khi cần đổi mode; `review` giả trả `pass` trừ khi test cấu hình khác; `which` giả trả `true`):
  - `happy path`: plan 4 việc ở mục "Định dạng" → trạng thái cuối `awaiting_merge`, `feat/<slug>` có 4 lần gộp, `dev` chưa đổi, `notify` được gọi một lần.
  - `parallel`: ghi lại thời điểm bắt đầu/kết thúc; việc 2 và 3 chồng thời gian nhau; việc 4 bắt đầu sau khi cả hai kết thúc.
  - `tool maxParallel`: `fake` có `maxParallel 1` → việc 2 và 3 không chồng thời gian nhau.
  - `blocked branch continues`: việc 2 có `FAKE_MODE=block` → 2 `blocked/needs_library`, 3 `merged`, 4 `pending`, run `needs_user`.
  - `review retry then limit`: review luôn `fail` → worker chạy đúng 3 lần (1 + 2), việc bị chặn `review_limit`.
  - `plan change`: review trả `planChange` → `plan_change`, file plan không đổi (so nội dung trước/sau).
  - `merge conflict`: việc 2 và 3 sửa cùng dòng của file không khai báo trong `Files` → một việc `merged`, việc kia `merge_conflict`, `git status` của integration sạch.
  - `preflight`: plan có công cụ `ghost` (không có), một adapter `verify` chưa có bản xác minh, và một adapter có binary mà `which` trả `false` → `runPlan` ném **một** lỗi chứa cả ba nguyên nhân (`không được hỗ trợ`, `chưa xác minh cách ly`, `không tìm thấy lệnh`) và `git branch --list` không có `dev` hay `feat/<slug>` mới.
  - `tool disappears mid-run`: `which` giả trả `true` ở lần gọi đầu cho mỗi binary rồi `false` → các việc bị chặn `tool_unavailable`, `runPlan` vẫn kết thúc `needs_user`, không ném lỗi.
  - `resume after crash`: chạy với việc 1 xong, sửa `state.json` để việc 2 là `running`, gọi lại `runPlan` → việc 1 không chạy lại (đếm số lần gọi tool), việc 2 chạy lại, kết thúc `awaiting_merge`.
  - `not approved`: plan nháp → ném lỗi chứa `Plan chưa được duyệt`, không tạo nhánh nào.
  - `events`: lượt chạy happy path có ít nhất các loại `run_started`, `task_started`, `review_passed`, `task_merged`, `run_awaiting_merge`; mọi sự kiện có `run === slug`.
  - `tool_overridden`: không truyền `adapters`, repo có `.konoha/tools/claude.json` (công cụ giả, `isolation: "trusted"`, có mode `review`) đè bản dựng sẵn → `events` có sự kiện `tool_overridden` với summary chứa `claude`.
  - `mergeToDev`: khi `awaiting_merge` → `'merged'` và `dev` chứa các commit của `feat/<slug>`, status `merged_to_dev`; khi `needs_user` → `'not_ready'`.
  - `retryTask`: việc `blocked` → `pending`, `attempts 0`, `block null`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `preflightTools`, `runPlan`, `retryTask`, `mergeToDev`. Việc ghi `state.json` được tuần tự hóa qua một hàng đợi trong tiến trình để các việc song song không ghi đè lẫn nhau.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: vòng điều phối`.

### Task 12: Lệnh `konoha`

**Chờ:** 11

**Files:**
- Create: `src/cli.ts`
- Modify: `README.md` (mục "Thêm công cụ")
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `runPlan`, `retryTask`, `mergeToDev`, `loadState`, `readEvents`, `loadAdapters`, `loadVerifications`, `recordVerification`, `checkTool`, `isAssignable`, `loadPolicy`.
- Produces lệnh (dùng `node:util` `parseArgs`, chạy trong repo đích):
  - `konoha run <plan.md>` — chạy hoặc chạy tiếp.
  - `konoha status <plan.md>` — in bảng: id, tên, công cụ/model, trạng thái, lý do bị chặn; dòng đầu là trạng thái lượt chạy.
  - `konoha retry <plan.md> <taskId>` — sau khi người dùng đã xử lý (cấp quyền, cài thư viện, sửa plan), đưa việc về `pending`.
  - `konoha merge <plan.md>` — gộp `feat/<slug>` vào `dev` (chỉ khi `awaiting_merge`).
  - `konoha tool list` — mỗi công cụ một dòng: tên, nguồn (`dựng sẵn`/`user`/`repo`), `có lệnh`/`thiếu lệnh`, và `tin sẵn`/`đã xác minh`/`chưa xác minh`; công cụ lỗi nạp in thêm dòng `LỖI <tên>: <message>`.
  - `konoha tool check <tên>` — chạy `checkTool`; qua thì `recordVerification` (băm hiện tại, ngày hôm nay) và in `Đã xác minh <tên>`; không qua thì in `detail`.
  Mã thoát: `0` thành công, `1` lỗi plan/cấu hình/tên công cụ không có, `2` cần người dùng (`needs_user`, `not_ready`, `conflict`, xác minh không qua).
  `export async function main(argv: string[], opts?: { cwd?: string; home?: string }): Promise<number>`.

- [ ] **Step 1: Viết test lỗi** gọi `main(argv, {cwd, home})` trực tiếp (home tạm):
  - không có lệnh → in hướng dẫn, mã `1`; `status` trên plan chưa chạy → in `Chưa chạy`; `status` sau khi chặn một việc → dòng của việc đó chứa `needs_library`; `merge` khi chưa xong → mã `2`; `retry` với id không tồn tại → mã `1`, thông báo chứa `Không có task`.
  - `tool list` trên repo trống → có dòng `claude` chứa `tin sẵn` và dòng `agy` chứa `chưa xác minh`.
  - `tool check ghost` → mã `1`, chứa `Không có công cụ`.
  - công cụ thử `.konoha/tools/fake.json` (`binary` = `process.execPath`, `isolation "verify"`, `env {"FAKE_MODE":"write"}`, `modes.work.args` = `[<đường dẫn tuyệt đối tới tests/fixtures/fake-tool.mjs>, "{prompt}"]`): `tool check fake` → mã `0`, `<home>/.config/konoha/verified.json` có băm của `fake`, `tool list` sau đó có dòng `fake` chứa `đã xác minh`; đổi `FAKE_MODE` thành `escape` → `tool list` lại có `chưa xác minh`, và `tool check fake` → mã `2`, in chứa `outside.txt`.
- [ ] **Step 2: Chạy** — Expected: FAIL.
- [ ] **Step 3: Cài đặt** `main` và dòng shebang `#!/usr/bin/env node` gọi nó (`main(process.argv.slice(2))`).
- [ ] **Step 4: Chạy toàn bộ** `npm run build && npm test` — Expected: build không lỗi (có `dist/adapters/builtin/claude.json`), mọi test PASS.
- [ ] **Step 5: README "Thêm công cụ".** Giải thích định dạng file khai báo (các trường ở Task 6), ba nơi đặt file, cách làm một tài khoản (ví dụ `~/.config/konoha/tools/claude-work.json` với `extends` và `env`), và `konoha tool check`. Thêm ví dụ cho Codex, Gemini CLI, OpenCode, đánh dấu rõ "chưa thử trên máy thật, phải qua `tool check`". Ghi rằng chương trình chưa tự chuyển tài khoản khi hết hạn mức.
- [ ] **Step 6: Thử thật trên máy (thủ công).** Trong một repo thử, tạo `.konoha/config.json` `{"testCommand":"npm test"}`. Chạy `konoha tool list` rồi `konoha tool check agy` — Expected: qua, hoặc không qua với `detail` rõ ràng (khi đó dừng và báo người dùng). Tạo plan 2 việc (1 giao `claude / sonnet`, 2 giao `agy / gemini-4-hydrogen-low`, 2 chờ 1) và chạy `konoha run`. Expected: `konoha status` cuối cùng là `awaiting_merge` (hoặc `needs_user` với lý do rõ ràng), `.konoha/runs/<slug>/events.jsonl` có sự kiện của cả hai công cụ, `model` của sự kiện `agy` là `null`.
- [ ] **Step 7: Commit** `feat: lệnh konoha`.

### Task 13: Add-on cho khâu lập plan

**Chờ:** 1

**Files:**
- Create: `skills/konoha-plan/SKILL.md`, `tests/skill-example.test.ts`

**Interfaces:**
- Consumes: `parsePlan` (Task 1), `validatePlan` (Task 2).
- Produces: một skill độc lập (không sửa skill của Superpowers), dùng **sau** `superpowers:writing-plans`. Skill hướng dẫn công cụ đang lập plan:
  - thêm `**Giao cho:**` và `**Chờ:**` cho mọi task (đề xuất công cụ: việc khó/kiến trúc → `claude / opus`, code rõ ràng → `agy / <model>` hoặc `claude / sonnet`; chỉ dùng tên có trong `konoha tool list`; người dùng sửa khi duyệt);
  - thêm mục `## Thư viện cần thêm` với lệnh cài chính xác kèm phiên bản, hoặc ghi `- (không có)`;
  - ghi `**Trạng thái plan:** nháp`; **chỉ người dùng** đổi thành `đã duyệt`, rồi chạy `konoha run <plan>`.
  - Skill có một plan ví dụ hoàn chỉnh trong khối ```markdown.

- [ ] **Step 1: Viết test lỗi** `tests/skill-example.test.ts`: đọc `skills/konoha-plan/SKILL.md`, lấy khối ```markdown đầu tiên, đổi `nháp` thành `đã duyệt`, `validatePlan(parsePlan(...), ['claude','agy'])` trả `[]`; trước khi đổi thì chứa `Plan chưa được duyệt`.
- [ ] **Step 2: Chạy** — Expected: FAIL (file chưa có).
- [ ] **Step 3: Viết `SKILL.md`** (frontmatter `name: konoha-plan`, `description: Use after writing an implementation plan that will be executed by the konoha orchestrator`), nội dung tiếng Việt như trên.
- [ ] **Step 4: Chạy test** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: skill định dạng plan cho konoha`.
