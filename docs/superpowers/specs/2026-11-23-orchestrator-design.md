# Bộ điều phối đa công cụ — thiết kế

Ngày: 2026-11-23. Trạng thái: **đã duyệt** (2026-11-23).
Liên quan: `2026-11-23-workflow-town-design.md` (làng hiển thị — dự án 2, làm sau, đọc nhật ký của bộ điều phối này).

## 1. Ý định và lý do

Người dùng muốn một quy trình làm phần mềm kiểu Superpowers, trong đó **công cụ mạnh nhất (mặc định Claude Code, model mạnh nhất) lo phần khó**: brainstorm, spec, plan, review. Phần thực thi (chủ yếu viết code) được **giao cho các công cụ khác** như Codex CLI, Gemini CLI, OpenCode hoặc Claude Code chạy model trung bình. Người dùng **tự chọn công cụ cho từng việc**.

Ban đầu ý tưởng chỉ là "nhìn tổng thể một phiên làm việc" (dự án làng). Trong lúc bàn, người dùng nói rõ mong muốn gốc là hệ thống thật sự giao việc. Vì làng lấy dữ liệu từ bộ điều phối, bộ điều phối được làm trước.

Task có thể rất dài. Người dùng hỏi về việc chia thành một phiên "PM" giao việc cho các phiên "chi tiết", và đồng ý với cách tách được mô tả ở mục 5.

## 2. Những điều người dùng đã quyết

- **Hướng C:** các khâu cần trò chuyện (brainstorm, spec, plan) diễn ra trong Claude Code với Superpowers như hiện nay; khi plan được duyệt, plan được giao cho một **chương trình thực thi** riêng chạy phần còn lại.
- **Tự chọn công cụ ở mọi khâu**, nghiêng về Claude Code làm công cụ mạnh nhất. Ở các khâu trò chuyện, "chọn công cụ" nghĩa là người dùng mở công cụ đó (Superpowers có hỗ trợ một số công cụ khác ngoài Claude Code).
- **Điểm dừng giống Superpowers:** người dùng duyệt sau spec và sau plan. Duyệt plan bao gồm duyệt bảng "giao cho ai / chờ việc nào". Sau đó chạy tự động; mỗi việc được review; chỉ dừng hỏi khi bị kẹt.
- **Tuần tự/song song suy ra từ cột "chờ"** trong plan (xem 6.2).
- **Quyền:** cấp sẵn quyền hẹp, không hỏi giữa chừng; cần quyền vượt mức thì dừng việc đó và hỏi người dùng; không bao giờ dùng chế độ bỏ qua mọi quyền (xem 6.4).
- **PM tách làm hai** (mục 5): phần cơ học là chương trình, phần phán đoán là các phiên Claude ngắn; trạng thái nằm trong file.
- Môi trường: **Claude desktop trên macOS**.
- **Nhánh và gộp code:** mỗi task có một nhánh tổng tên `feat/<tên-task>`. Mỗi việc chạy trong worktree riêng tách từ nhánh này và được gộp lại vào đó sau khi review qua. Khi **tất cả** việc xong, chương trình dừng và chờ người dùng duyệt; người dùng duyệt thì gộp `feat/<tên-task>` vào nhánh `dev`. Repo hiện chỉ có `main`; nhánh `dev` được tạo từ `main` nếu chưa có.
- 9Router (bộ định tuyến model cục bộ) đã được nhắc đến như một khả năng; không thuộc bản đầu.

## 3. Mục tiêu, không-mục-tiêu, phản-mục-tiêu

**Mục tiêu (bản đầu)**
- Từ một plan đã duyệt, chạy hết các việc bằng các công cụ được chỉ định, đúng thứ tự phụ thuộc, song song khi được phép.
- Mỗi việc chạy cô lập, được review bởi model mạnh trước khi gộp.
- Chạy được task dài: dừng/tắt máy giữa chừng thì chạy tiếp từ file.
- Ghi một nhật ký sự kiện đủ để dự án làng hiển thị (công cụ, model, vai trò, thời điểm, kết quả).
- Dựng sẵn Claude Code (headless) và Antigravity CLI (`agy`); công cụ khác (Codex CLI, Gemini CLI, OpenCode, thêm tài khoản…) thêm bằng file khai báo JSON, không sửa code (xem `2026-11-24-tool-adapters-design.md`).

**Không-mục-tiêu (bản đầu)**
- Giao diện đồ họa (làng là dự án riêng). Bản đầu điều khiển bằng dòng lệnh và file.
- Plan nhiều tầng (plan con cho từng chặng) — chừa chỗ trong định dạng nhưng chưa làm.
- Chạy các khâu trò chuyện (brainstorm/spec/plan) một cách tự động.
- 9Router, theo dõi chi phí chi tiết, chạy trên nhiều máy, nhiều người dùng.
- Tự push lên remote hay triển khai.

**Phản-mục-tiêu**
- Công cụ con có quyền rộng hơn mức cần (đặc biệt chế độ bỏ qua quyền).
- Tự sửa plan đã duyệt mà không hỏi người dùng.
- Trạng thái chỉ nằm trong bộ nhớ của một phiên AI (mất là mất hết).
- Nhật ký ghi thông tin đoán thay vì thông tin thật (ví dụ model không rõ thì ghi "không rõ").

## 4. Các hướng đã xem xét

- **A. Skill mở rộng Superpowers chạy hoàn toàn trong Claude Code.** Nhanh nhất, nhưng cả quá trình nằm trong một cuộc chat: task dài tốn ngữ cảnh, dễ đứt, nhật ký phân tán.
- **B. Chương trình độc lập làm mọi khâu,** kể cả brainstorm. Linh hoạt nhất về công cụ, nhưng khâu trò chuyện chạy ngầm rất gượng và phải làm lại những gì Superpowers đã có.
- **C. Kết hợp** (được chọn): trò chuyện ở Claude Code, thực thi ở chương trình riêng. Giữ cách làm việc người dùng quen, phần dễ hỏng nhất (nhiều việc song song, dài) nằm trong chương trình được thiết kế riêng, và có một nguồn nhật ký rõ ràng.

## 5. Kiến trúc tổng thể

```
[Claude Code + Superpowers]  brainstorm → spec (duyệt) → plan (duyệt)
              │  plan.md + spec.md đã duyệt
              ▼
[Chương trình thực thi]  = PM cơ học
   • đọc plan, xếp lịch theo cột "chờ", giới hạn số việc song song
   • tạo worktree, cấp quyền hẹp, gọi công cụ được chỉ định  → phiên worker (mới, ngắn)
   • gọi Claude Code model mạnh để review / phán đoán       → phiên PM phán đoán (mới, ngắn)
   • gộp code sau khi review qua
   • ghi trạng thái vào file plan và nhật ký sự kiện
              │  nhật ký sự kiện
              ▼
[Làng hiển thị]  (dự án 2)
```

- **PM cơ học** không dùng AI, nên không bị giới hạn ngữ cảnh.
- **PM phán đoán:** mỗi lần cần review hoặc quyết định khi việc hỏng, gọi một phiên Claude mới, chỉ đưa spec, plan, trạng thái hiện tại và kết quả cần xem; xong thì đóng.
- **Worker:** mỗi việc là một phiên mới của công cụ được chỉ định, chỉ nhận mô tả việc, đoạn spec liên quan, các file liên quan.
- **Trạng thái nằm trong file.** Chương trình dừng/khởi động lại thì đọc file và chạy tiếp.

## 6. Các phần chính

### 6.1 Điểm bàn giao: plan đã duyệt
Plan do Superpowers (writing-plans) viết được mở rộng thêm cho mỗi việc: **giao cho** (công cụ + model nếu có) và **chờ** (danh sách việc phải xong trước). Claude đề xuất cả hai khi viết plan; người dùng sửa trong lúc duyệt plan. Cần một cách rõ ràng để đánh dấu plan "đã duyệt" và khởi động chương trình thực thi (ví dụ một lệnh người dùng chạy, hoặc Claude chạy hộ khi người dùng duyệt).

Ví dụ:
```
Việc 1  Tạo bảng dữ liệu   giao cho: agy            chờ: —
Việc 2  Viết API           giao cho: claude-sonnet  chờ: 1
Việc 3  Làm giao diện      giao cho: agy           chờ: 1
Việc 4  Test tích hợp      giao cho: claude-opus    chờ: 2, 3
```

### 6.2 Xếp lịch
- Luật duy nhất: việc nào đã đủ điều kiện (mọi việc trong "chờ" đã xong và gộp) thì chạy.
- Giới hạn số việc chạy cùng lúc (mặc định 3, chỉnh được).
- Hai việc sửa cùng file thì bắt buộc tuần tự dù về logic độc lập. Cách biết "sửa cùng file" (khai báo trong plan, hay phát hiện) do người dựng chọn.
- Một việc hỏng: chỉ các việc phụ thuộc vào nó dừng; nhánh khác chạy tiếp.

### 6.3 Thực thi một việc
1. Tạo worktree riêng từ trạng thái đã gộp mới nhất.
2. Dựng "bản giao việc" cho worker: mô tả việc, đoạn spec liên quan, file liên quan, cách kiểm tra.
3. Gọi công cụ được chỉ định ở chế độ không tương tác, với cấu hình quyền hẹp.
4. Thu kết quả (diff, kết quả test, đầu ra của công cụ).
5. Gọi phiên PM phán đoán để review theo spec và plan.
6. Review qua → gộp vào `feat/<tên-task>`, chạy test. Không qua → giao lại cho worker kèm nhận xét (giới hạn số lần, mặc định 2), quá giới hạn thì dừng việc đó và hỏi người dùng.

### 6.4 Quyền
- Một file quy định quyền chung; mỗi công cụ có **file khai báo** (JSON) mô tả cách dịch quyền đó sang cờ dòng lệnh/cấu hình của công cụ. Chương trình biên dịch file khai báo thành adapter và áp cùng các cổng an toàn cho mọi công cụ (xem `2026-11-24-tool-adapters-design.md`). Cờ/cấu hình cụ thể của từng công cụ cần kiểm tra khi dựng.
- Mặc định worker chỉ được: đọc/sửa file trong worktree của mình, chạy lệnh build/test của dự án.
- Không bao giờ giao cho worker: push, gộp vào nhánh chính, xóa ngoài worktree, cài gói, gọi mạng ra ngoài, triển khai.
- Worker cần quyền vượt mức → việc đó chuyển sang trạng thái "cần quyền: …", dừng riêng việc đó, hỏi người dùng.
- Không dùng chế độ bỏ qua mọi quyền của bất kỳ công cụ nào.
- **Khi công cụ không áp được đúng quy định (người dùng đã quyết):** dùng mức gần nhất công cụ hỗ trợ; sau khi worker chạy xong, chương trình tự kiểm tra có thay đổi nào ngoài worktree không, có thì loại kết quả và báo người dùng. Ngưỡng tối thiểu: công cụ nào không chặn được việc ghi file ra ngoài worktree thì không được giao việc; điều này được bảo đảm bằng `konoha tool check <tên>` (xác minh cách ly theo băm file khai báo), chỉ `claude` dựng sẵn được tin sẵn. Lớp cách ly cấp hệ điều hành để dành cho sau nếu cần.

### 6.4b Thư viện mới (người dùng đã quyết)
- Khi viết plan, Claude liệt kê các thư viện/gói cần thêm; người dùng duyệt danh sách này cùng plan.
- Sau khi plan được duyệt, chương trình cài một lần, trước khi worker nào bắt đầu (đồng thời tránh hai worker song song cùng sửa file khai báo thư viện).
- Worker cần thư viện ngoài danh sách → dừng riêng việc đó, trạng thái "cần quyền: thêm thư viện X", hỏi người dùng.

### 6.5 Thay đổi plan giữa chừng
Nếu PM phán đoán cho rằng plan cần đổi (thêm/bỏ/đổi việc), chương trình dừng nhánh liên quan và hỏi người dùng. Không tự sửa plan đã duyệt.

### 6.6 Nhật ký sự kiện
Một file nối tiếp, mỗi dòng một sự kiện, tối thiểu có: thời điểm, id việc, loại sự kiện (bắt đầu, xong, hỏng, review qua/không qua, gộp, cần quyền, chờ người dùng…), vai trò (worker / PM phán đoán / chương trình), công cụ, model (hoặc "không rõ"), tóm tắt. Đây là hợp đồng dữ liệu với dự án làng, kể cả tab agent team sau này.

### 6.7 Hỏi người dùng
Khi cần người dùng (cần quyền, review hỏng quá giới hạn, plan cần đổi), chương trình phải làm cho người dùng biết. Cách báo ở bản đầu do người dựng chọn (ví dụ thông báo macOS + trạng thái trong dòng lệnh); làng sẽ hiện thành "cổng sáng đèn" sau.

## 7. Ràng buộc

- Chạy cục bộ trên macOS, trong một repo git.
- Các công cụ con phải được cài và đăng nhập sẵn trên máy; chương trình không quản lý tài khoản hay khóa API.
- Cần Claude Code dạng dòng lệnh để chương trình gọi được (app desktop có thể chưa đủ) — cần kiểm tra trên máy người dùng.
- Chi phí và hạn mức của từng công cụ là của người dùng; giới hạn song song là cách kiểm soát chính ở bản đầu.

## 8. Các quyết định do Claude tự chọn (người dùng chưa xác nhận)

- Giới hạn song song mặc định 3; giới hạn giao lại sau review không qua mặc định 2.
- Bản đầu là chương trình dòng lệnh, không có giao diện riêng.
- Review dùng Claude Code với model mạnh nhất, theo tinh thần review của Superpowers.
- Plan nhiều tầng để sau; định dạng plan chừa chỗ.
- Phần mở rộng plan (cột "giao cho"/"chờ", dấu "đã duyệt") **không phụ thuộc công cụ**: nằm trong chính file plan, và chương trình được khởi động bằng một lệnh dòng lệnh. Nhờ vậy plan viết ở Claude Code, Codex hay Gemini đều dùng được. Phần mở rộng là một **add-on riêng**, không sửa hay fork skill của Superpowers, để cập nhật Superpowers không làm hỏng nó.

## 9. Để lại cho người dựng

- Tên nhánh của từng worktree con (miễn không đụng tên `feat/<tên-task>`, ví dụ git không cho có cả `feat/x` và `feat/x/1`).

- Ngôn ngữ và cách đóng gói chương trình.
- Định dạng file plan mở rộng và file trạng thái (miễn là người đọc được và người dùng sửa được khi duyệt).
- Cách gọi không tương tác và cấu hình quyền cụ thể của từng công cụ.
- Cách phát hiện hai việc đụng cùng file.
- Cách khởi động chương trình từ điểm duyệt plan.
- Cách báo người dùng khi cần can thiệp ở bản đầu.
