---
name: konoha-plan
description: Use after writing an implementation plan that will be executed by the konoha orchestrator
---

# Định dạng plan cho konoha

Dùng **sau** `superpowers:writing-plans`, khi plan sẽ được `konoha run` thực thi. Không sửa skill của Superpowers; chỉ bổ sung các phần dưới đây vào plan đã viết.

## Việc cần làm

1. **Mỗi task** có hai dòng ngay dưới tiêu đề `### Task N: <tên>`:
   - `**Giao cho:** <công cụ>` hoặc `<công cụ> / <model>`. Chỉ dùng tên có trong `konoha tool list`.
     Gợi ý: việc khó hoặc kiến trúc → `claude / opus`; code rõ ràng → `agy / <model>` hoặc `claude / sonnet`. Người dùng sẽ sửa khi duyệt.
   - `**Chờ:** —` hoặc danh sách số task cách bằng dấu phẩy (ví dụ `2, 3`).
2. Liệt kê file mỗi task ở mục `**Files:**` (`- Create|Modify|Test: \`đường/dẫn\``) để bộ điều phối tránh cho hai việc cùng sửa một file chạy song song.
3. Thêm mục `## Thư viện cần thêm` gồm lệnh cài chính xác kèm phiên bản (ví dụ `- \`npm install nodemailer@6.9.14\``), hoặc `- (không có)`.
4. Ghi `**Trạng thái plan:** nháp` ở đầu plan. **Chỉ người dùng** được đổi thành `đã duyệt`, rồi tự chạy `konoha run <plan>`. Không bao giờ tự đổi và không tự chạy.

## Plan ví dụ

```markdown
# Gửi email Implementation Plan
**Trạng thái plan:** nháp
**Spec:** `docs/superpowers/specs/2026-11-24-gui-email-design.md`

## Thư viện cần thêm
- `npm install nodemailer@6.9.14`

### Task 1: Tạo bảng dữ liệu
**Giao cho:** agy / gemini-4-hydrogen-low
**Chờ:** —
**Files:**
- Create: `src/db/schema.ts`
- Modify: `src/app.ts:10-20`

Tạo bảng `emails` theo spec, kèm test.

### Task 2: Viết API gửi email
**Giao cho:** claude / sonnet
**Chờ:** 1
**Files:**
- Create: `src/api/send.ts`
- Test: `tests/api/send.test.ts`

Viết API `POST /send` dùng bảng ở Task 1.
```
