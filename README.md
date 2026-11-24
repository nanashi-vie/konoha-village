# konoha

Bộ điều phối nhận một plan đã duyệt, chạy từng việc bằng công cụ được chỉ định (Claude Code, Antigravity CLI `agy`, hoặc công cụ khai báo thêm) trong worktree riêng, review, gộp vào `feat/<slug>`, rồi chờ người dùng duyệt gộp vào `dev`.

## Định dạng plan đầu vào

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

## Lệnh

Chạy trong repo đích (cần `.konoha/config.json` với `testCommand`).

| Lệnh | Việc |
|------|------|
| `konoha run <plan.md>` | chạy hoặc chạy tiếp |
| `konoha status <plan.md>` | bảng việc, trạng thái, lý do bị chặn |
| `konoha retry <plan.md> <id>` | đưa việc bị chặn về `pending` sau khi bạn đã xử lý |
| `konoha merge <plan.md>` | gộp `feat/<slug>` vào `dev` (chỉ khi `awaiting_merge`) |
| `konoha tool list` | liệt kê công cụ, nguồn, có lệnh hay không, đã xác minh chưa |
| `konoha tool check <tên>` | xác minh công cụ không ghi được ra ngoài worktree |

Mã thoát: `0` thành công, `1` lỗi plan/cấu hình/tên công cụ, `2` cần người dùng.

## Thêm công cụ

Mỗi công cụ là một file JSON, tên file là tên công cụ. Nơi đặt, ưu tiên từ cao xuống thấp:
`<repo>/.konoha/tools/<tên>.json` > `~/.config/konoha/tools/<tên>.json` > dựng sẵn (`claude`, `agy`). File trùng tên thay thế file ở mức thấp hơn (có sự kiện `tool_overridden`).

Các trường:
- `binary` (bắt buộc), `env` (chỗ trống `{prompt}`, `{worktree}`; `~/` được mở rộng), `maxParallel`.
- `isolation`: `"trusted"` hoặc `"verify"` (mặc định). `trusted` chỉ được giữ khi file giống hệt `claude` dựng sẵn ngoại trừ `env`/`maxParallel`; file nào khác sẽ tự bị hạ về `verify`. `verify` chỉ được giao việc sau `konoha tool check <tên>`; sửa file thì phải xác minh lại.
- `modelFlag` (ví dụ `["--model","{model}"]`), `commandRule` (ví dụ `Bash({cmd}:*)`; `{cmdEscaped}` là lệnh đã thoát JSON), `modelFrom` (`{"path":[...],"firstKey":true}` để đọc model thật từ JSON đầu ra).
- `modes.work.args` (bắt buộc) và `modes.review.args`: chỗ trống `{prompt}`, `{worktree}`, `{allowCommands}`, và phần tử riêng `{modelFlag}`.
- `extends`: kế thừa file khác, chỉ ghi phần thay đổi.

Cờ bỏ qua quyền (`--dangerously-skip-permissions`, `--yolo`, `-y`, `--full-auto`, …) bị từ chối khi nạp file và khi dựng lệnh.

### Nhiều tài khoản

Một tài khoản là một file kế thừa công cụ gốc và đổi `env`. `~/.config/konoha/tools/claude-work.json`:

```json
{"extends": "claude", "env": {"CLAUDE_CONFIG_DIR": "~/.claude-work"}, "maxParallel": 2}
```

Trong plan ghi `**Giao cho:** claude-work / sonnet`. Mỗi tài khoản được xác minh riêng. File không chứa khóa hay token. Chương trình chưa tự chuyển tài khoản khi hết hạn mức.

### Ví dụ công cụ khác (chưa thử trên máy thật, phải qua `konoha tool check`)

```json
{"binary":"codex","modelFlag":["--model","{model}"],
 "modes":{"work":{"args":["exec","{prompt}","{modelFlag}"]}}}
```
```json
{"binary":"gemini","modelFlag":["--model","{model}"],
 "modes":{"work":{"args":["-p","{prompt}","{modelFlag}"]}}}
```
```json
{"binary":"opencode","modelFlag":["--model","{model}"],
 "modes":{"work":{"args":["run","{prompt}","{modelFlag}"]}}}
```
Các ví dụ trên chỉ là điểm xuất phát: bạn phải tự kiểm cờ quyền thật của từng công cụ để nó chỉ sửa trong worktree và chỉ chạy `{allowCommands}`.

## Ghi chú tương thích

### agy (Antigravity CLI), thử ngày 2026-11-24, bản 1.5.16
- Dùng `-p <prompt> --output-format json --mode accept-edits --settings '<json>'`, không dùng `--sandbox`.
- `--mode accept-edits` tự duyệt sửa file trong thư mục làm việc; ghi ra ngoài bị từ chối (thử thật: `inside.txt` có, `../outside.txt` không có, `denied_actions` ghi `write_file`). `konoha tool check agy` vẫn phải qua cho từng máy.
- Giới hạn lệnh: `--settings '{"permissions":{"allow":["command(<lệnh>)"]}}'`. Quy tắc khớp theo tiền tố từng từ (`command(npm test)` cho phép `npm test` kèm tham số). Thử thật: lệnh được liệt kê chạy không bị hỏi, lệnh khác (`whoami`) bị từ chối. Dạng `command(x *)` và `command(x:*)` không hoạt động.
- Lệnh trong `allowCommands` được thoát JSON bằng `{cmdEscaped}` trong `commandRule`, nên chứa `"` hay `\` vẫn an toàn.
- JSON đầu ra không có tên model thật, nên `model` trong nhật ký là `null` ("không rõ").
- `agy` không có chế độ review; review luôn dùng `claude`.

### claude
- Đã kiểm `claude --help` có `-p`, `--output-format`, `--permission-mode`, `--allowedTools`, `--model`.

## Lưu ý khi chạy

- Đừng sửa file trong repo gốc (checkout chính) khi `konoha run` đang chạy: bộ canh gác coi đó là worker ghi ra ngoài và chặn việc (`outside_write`).
- Chỉ một `konoha run` cho mỗi plan tại một thời điểm (khóa pid trong `.konoha/runs/<slug>/lock`). Ctrl-C giết các worker đang chạy; chạy lại để tiếp tục.
- Sửa file khai báo công cụ (kể cả `agy.json` dựng sẵn), hoặc đổi danh sách lệnh được phép (`testCommand` / `permissions.json`), thì phải chạy lại `konoha tool check <tên>`: bản xác minh gắn với cả hai.
- Việc đang chạy và việc khác ghi vào worktree của nhau chưa được phát hiện (hạn chế đã biết).
