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

Sẽ được ghi đầy đủ ở Task 12 (`run`, `status`, `retry`, `merge`, `tool list`, `tool check`).
