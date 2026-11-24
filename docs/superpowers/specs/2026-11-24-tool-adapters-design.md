# Adapter công cụ khai báo bằng file — thiết kế

Ngày: 2026-11-24. Trạng thái: **đã duyệt** (2026-11-24).
Sửa đổi lớp adapter của `2026-11-23-orchestrator-design.md` (mục 3, 6.4) và `docs/superpowers/plans/2026-11-23-orchestrator.md` (Task 1, 6, 8).

## 1. Ý định và lý do

Spec và plan cũ cứng 4 công cụ (`'claude' | 'codex' | 'gemini' | 'opencode'`), mỗi công cụ một file code. Người dùng định **publish dự án cho cộng đồng**, nên người dùng khác phải tự thêm công cụ và model của họ mà không sửa code của dự án. Hiện người dùng chỉ có model Claude và Gemini; Gemini dùng qua Antigravity (`agy`), chưa cài.

## 2. Những điều người dùng đã quyết

- Công cụ được **khai báo bằng file cấu hình** (cách A), không phải plugin code. Cửa cho plugin code (cách C) để mở, không làm bây giờ.
- Bản đầu chỉ dựng sẵn **hai công cụ: `claude` và `agy`** (Antigravity CLI), vì chỉ hai cái này thử được.
- Sau này sẽ tích hợp **9Router**; bản đầu không làm.
- **Mở cửa cho nhiều tài khoản:** một người dùng có thể có nhiều tài khoản Claude, Gemini, Codex… và chọn tài khoản nào cho việc nào. (Người dùng nói "mở cửa", chưa yêu cầu giao diện quản lý tài khoản riêng.)

## 3. Mục tiêu, không-mục-tiêu, phản-mục-tiêu

**Mục tiêu**
- Thêm một công cụ mới chỉ bằng cách thêm một file, không đụng code.
- `claude` và `agy` dùng đúng cơ chế này (không có đường riêng cho hàng dựng sẵn).
- Mọi công cụ, dựng sẵn hay do người dùng thêm, đều qua cùng các cổng an toàn.

**Không-mục-tiêu (bản đầu)**
- Plugin bằng code, kho chia sẻ công cụ, tự dò công cụ cài trên máy.
- Tích hợp 9Router.
- Dùng công cụ ngoài Claude để review (review vẫn luôn là Claude).
- Dựng sẵn Codex, Gemini CLI, OpenCode (chỉ có file ví dụ trong README, ghi rõ "chưa thử").

**Phản-mục-tiêu:** không được có đường nào để một file khai báo làm lỏng an toàn: không qua được kiểm tra cờ cấm, hoặc được giao việc khi chưa xác minh cách ly ghi file. Linh hoạt mà mất điều này là thất bại, dù chạy được.

## 4. Các hướng đã xem xét

| Hướng | Được | Mất |
|-------|------|-----|
| **A. File khai báo** (đã chọn) | Người dùng khác chỉ viết một file; chương trình kiểm soát mọi lệnh sinh ra nên giữ được quyền hẹp | Công cụ có đầu ra lạ có thể khai báo chưa đủ |
| B. Plugin code | Linh hoạt nhất | Người dùng phải viết TypeScript; code lạ chạy với quyền của họ; khó bảo đảm cờ cấm |
| C. Lai | Đủ cả hai | Làm hai thứ cùng lúc khi chưa cần |

Chọn A, giữ khả năng thêm C sau: file khai báo được biên dịch thành đúng giao diện `Adapter` đang có, nên plugin code sau này chỉ là một nguồn khác tạo ra `Adapter`.

## 5. Thiết kế

### 5.1 File khai báo công cụ
- Định dạng JSON (không thêm thư viện). Tên công cụ = tên file. Giá trị cột "giao cho" trong plan là tên này (kiểu `string`, bỏ `ToolName`).
- Nơi đặt, theo thứ tự ưu tiên: `.konoha/tools/<tên>.json` trong repo đích (dùng chung cho dự án), rồi `~/.config/konoha/tools/<tên>.json` (của riêng người dùng, nơi đặt file tài khoản cá nhân), rồi hàng dựng sẵn trong chương trình (`claude`, `agy`). File trùng tên với file ở mức thấp hơn thì thay thế, chương trình ghi cảnh báo vào nhật ký.
- Nội dung một file:
  - `binary`: lệnh để gọi.
  - Với mỗi chế độ `work` (và `review`, tùy chọn): mẫu `args` có chỗ trống `{prompt}`, `{model}`, `{worktree}`, và chỗ mở rộng `allowCommands` theo định dạng riêng của công cụ (ví dụ `Bash(npm test:*)` cho Claude).
  - `env`: biến môi trường thêm, cũng dùng được chỗ trống.
  - Cờ model chỉ thêm khi việc có chỉ định model.
  - Cách đọc model thật từ đầu ra; không đọc được thì `null`.
  - `isolation`: lời khai về việc chặn ghi ngoài worktree.
  - `extends` (tùy chọn): kế thừa file khác, chỉ ghi phần thay đổi (xem 5.5).
  - `maxParallel` (tùy chọn): số việc song song tối đa cho riêng công cụ/tài khoản này, nằm trong giới hạn chung.
- Chương trình biên dịch file thành `Adapter` (giao diện hiện có: `build`, `actualModel`, `canIsolateWrites`).

### 5.2 Ba cổng an toàn (áp cho mọi công cụ như nhau)
1. **Cờ cấm:** khi nạp file và khi dựng lệnh, `FORBIDDEN_FLAGS` (danh sách ở Global Constraints của plan) có mặt thì từ chối công cụ.
2. **Cách ly đã xác minh:** `konoha tool check <tên>` chạy công cụ trong repo tạm với yêu cầu tạo `../outside.txt`. Không tạo được thì ghi một bản xác minh (tên, băm của file khai báo, ngày). Công cụ chỉ được giao việc khi có bản xác minh khớp băm hiện tại; sửa file khai báo thì phải xác minh lại. `claude` dựng sẵn được tin sẵn (Claude Code ở `acceptEdits` chỉ sửa trong thư mục làm việc); `agy` phải qua `tool check`.
3. **Kiểm sau khi chạy:** như đã quyết ở 6.4 của spec cũ, chương trình vẫn so sánh thay đổi ngoài worktree sau mỗi lần chạy worker, có thì loại kết quả.

### 5.3 Kiểm trước khi chạy
Khi bắt đầu từ plan đã duyệt, chương trình kiểm mọi công cụ được nhắc trong plan: file tồn tại, qua cổng 1, có bản xác minh (cổng 2), binary có trên máy. Thiếu cái nào thì báo cả danh sách và không bắt đầu, thay vì chặn từng việc giữa chừng. (Kiểm lúc chạy ở Task 9 của plan vẫn giữ làm lớp phòng thủ thứ hai.)

### 5.4 Chừa chỗ cho 9Router
Vì file khai báo có `env` và chỗ trống, sau này một công cụ có thể được trỏ qua 9Router bằng cách đổi biến môi trường hoặc thêm một file khai báo mới, không cần đổi lõi. Không hứa gì thêm ở bản đầu.

### 5.5 Nhiều tài khoản
Không thêm khái niệm mới: **một tài khoản là một file khai báo**, kế thừa file gốc và chỉ đổi `env` trỏ tới thư mục cấu hình/đăng nhập của tài khoản đó. Ví dụ `~/.config/konoha/tools/claude-work.json`: `{"extends": "claude", "env": {"CLAUDE_CONFIG_DIR": "~/.claude-work"}}`. Trong plan, cột "giao cho" ghi `claude-work` như mọi tên công cụ khác.
- Mỗi tài khoản được xác minh riêng (băm tính trên file đã kế thừa và `env`).
- Hạn mức là của từng tài khoản, nên `maxParallel` đặt được theo từng file.
- File tài khoản **không chứa khóa hay token**, chỉ chứa đường dẫn thư mục cấu hình; đặt ở `~/.config/konoha/tools/` để không bị commit nhầm vào repo.
- Cách mỗi công cụ chọn tài khoản (biến môi trường, thư mục cấu hình…) khác nhau và phải kiểm khi dựng; công cụ nào không tách được tài khoản bằng `env` thì chưa hỗ trợ nhiều tài khoản.
- Không làm ở bản đầu: tự chuyển tài khoản khi hết hạn mức, cân bằng tải giữa tài khoản.

## 6. Ảnh hưởng đến tài liệu và plan hiện có (sẽ sửa sau khi duyệt)

- Spec orchestrator, mục 3: "ít nhất 4 công cụ" → "Claude Code và Antigravity CLI dựng sẵn; công cụ khác qua file khai báo". Mục 6.4: "bộ chuyển đổi" → file khai báo công cụ.
- Plan Task 1: bỏ `ToolName`. Task 6: giao diện adapter + nạp/biên dịch file khai báo + file `claude`. Task 8: thay bằng file `agy`, lệnh `konoha tool check`, README có ví dụ Codex/Gemini/OpenCode (chưa thử). Task 7 và 9: adapter giả cho test được tạo từ file khai báo thay vì `registerAdapter`.

## 7. Ràng buộc và rủi ro

- **Đã kiểm trên máy người dùng (agy 1.5.16, 2026-11-24):**
  - Có `-p/--print`, `--output-format json|stream-json`, `--model`, `--mode accept-edits|auto|plan`, `--sandbox`, `--settings`, `--print-timeout`, và `--dangerously-skip-permissions` (cờ cấm, không dùng).
  - `agy models` liệt kê model, ví dụ `gemini-4-hydrogen-low`, `gemini-4-carbon-high`, các `gemini-pro-orchestrator*`; tên model truyền thẳng cho `--model`.
  - Chạy `agy -p ... --output-format json --mode accept-edits` từ tiến trình con (stdin đóng, stdout/stderr là pipe) trả đúng một JSON `{"status":"SUCCESS","response":...,"usage":...}`: lỗi mất đầu ra ở [issue #76](https://github.com/google-antigravity/antigravity-cli/issues/76) và treo ở [issue #318](https://github.com/google-antigravity/antigravity-cli/issues/318) **không tái hiện** trên bản này.
  - JSON đầu ra **không có tên model thật** → `actualModel` của `agy` là `null`; nhật ký ghi model được yêu cầu và đánh dấu "không xác nhận".
- Chưa kiểm: `--mode accept-edits` trong `-p` có chạy được lệnh test (`allowCommands`) mà không bị hỏi hay không, `--sandbox` có chặn ghi ngoài worktree không, và `agy` có `--settings`/cơ chế nào để chỉ cho phép đúng các lệnh. Phải thử khi dựng (`tool check`).
- Nếu `agy` chỉ chạy được không tương tác khi bật chế độ bỏ qua quyền, nó **không được giao việc** (vi phạm cờ cấm) và bản đầu chỉ còn `claude`; dừng và báo người dùng.
- Đăng nhập là việc làm tay một lần cho mỗi tài khoản; chương trình không quản lý tài khoản (máy này `agy` đã đăng nhập).

## 8. Các quyết định do Claude tự chọn (người dùng chưa xác nhận)

- JSON thay vì TOML/YAML (không cần thư viện, hợp "không có thư viện chạy ngoài Node").
- File người dùng trùng tên hàng dựng sẵn thì thay thế, kèm cảnh báo.
- Bản xác minh gắn với băm file khai báo, không gắn với phiên bản binary.
- `claude` được tin sẵn; `agy` bắt buộc qua `tool check`.
- Kiểm toàn bộ công cụ trong plan trước khi bắt đầu.
- Review vẫn cố định là Claude.
- Tài khoản = file khai báo kế thừa (`extends` + `env`), đặt ở `~/.config/konoha/tools/`; không thêm khái niệm "profile" riêng.
- `maxParallel` theo từng công cụ/tài khoản là tùy chọn.

## 9. Để lại cho người dựng

- Cú pháp chính xác của chỗ trống và phần mở rộng `allowCommands`; cách khai báo "đọc model từ đầu ra".
- Cờ quyền/cách ly thật của `agy` (xem phần "Chưa kiểm" ở mục 7) và cách mỗi công cụ chọn tài khoản qua `env`.
- Nơi lưu bản xác minh và định dạng lệnh `konoha tool check`.
