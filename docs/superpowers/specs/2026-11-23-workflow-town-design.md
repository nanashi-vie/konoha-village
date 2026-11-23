# Workflow Town — thiết kế

Ngày: 2026-11-23. Trạng thái: bản nháp, **tạm gác** — làm sau bộ điều phối.

> **Cập nhật 2026-11-23:** Người dùng quyết định xây bộ điều phối đa công cụ trước (xem `2026-11-23-orchestrator-design.md`). Làng sẽ đọc **nhật ký sự kiện của bộ điều phối** cho phần thực thi, và chỉ đọc transcript Claude Code cho các khâu trò chuyện (brainstorm/spec/plan). Giao diện đã chốt: **isometric 2D**, workflow là trục, agent và huy hiệu model là lớp chú thích, hai chủ đề (làng Naruto, sân Old Trafford) là lớp vỏ có thể thay. Thiết kế này sẽ được viết lại khi tới lượt.

## 1. Ý định và lý do

Người dùng muốn **nhìn được hình dạng tổng thể của một phiên/task** làm việc với AI theo quy trình kiểu Superpowers (brainstorm → spec → plan → code → review → test → xong). Mục đích là **tự theo dõi** (không phải để trình bày hay dạy người khác). Người dùng nói rõ họ không đang gặp một nỗi đau cụ thể nào với terminal; họ chỉ muốn có một bức tranh tổng thể.

Hình mẫu cảm hứng là video "thị trấn solomi" (mini AI marketing agent team): thị trấn 3D màu pastel, mỗi agent có bong bóng nói đang làm gì, bấm vào agent thấy bảng thông tin và skill, có bảng "Nhật ký thật" liệt kê việc theo ngày/agent, có các nút đổi chế độ xem (dừng xoay, tên, bong bóng, toàn cảnh, tổng quan, tự chạy), có "bước duyệt" để người thật chặn lại, và một agent điều phối đứng giữa lâu đài. Điều đáng học nhất: thị trấn nhìn vào **việc có thật**, không phải hoạt hình trang trí.

Nguyên tắc về model mà người dùng đặt ra: model mạnh nhất làm việc khó và quan trọng nhất; model trung bình làm việc code. Visualization phải cho thấy điều này.

## 2. Những điều người dùng đã quyết

- Mục đích: tự theo dõi, xem tổng thể một phiên/task.
- **Workflow là trục chính.** Thị trấn là bản đồ các chặng của một task; mỗi chặng là một khu/tòa nhà; task đi qua các khu theo thứ tự.
- **Agent là nhân vật đứng trong chặng** mà nó đang làm. Mỗi agent mang **huy hiệu model** (mạnh / trung bình).
- **Cả chế độ xem trực tiếp và xem lại** đều cần có.
- **Giai đoạn 2:** sau khi giai đoạn 1 xong, thêm một tab (hoặc tương tự) để nhìn theo kiểu **agent team**.
- Người dùng đã có ý tưởng riêng về giao diện (UI) và chưa chia sẻ chi tiết.
- Môi trường: người dùng dùng **Claude desktop trên macOS**. Vị trí và định dạng transcript của môi trường này người dựng cần kiểm tra trên máy người dùng.
- Ý tưởng giao diện: hai chủ đề, (1) làng trong anime Naruto, (2) sân Old Trafford. Người dùng gửi ảnh tham khảo: ảnh 3D dựng sẵn của làng, ảnh minh họa làng, ảnh chụp sân. Chủ đề được coi là **lớp vỏ có thể thay**; chưa chốt chủ đề nào làm trước và chưa chốt 2D hay 3D.
- Cách lấy dữ liệu: Claude đề xuất đọc file ghi lại phiên (transcript) có sẵn; người dùng không phản đối. Xem là hướng mặc định, chưa phải lựa chọn được xác nhận bằng lời.

## 3. Mục tiêu, không-mục-tiêu, phản-mục-tiêu

**Mục tiêu (giai đoạn 1)**
- Trong một cái liếc, thấy task đang ở chặng nào / đã đi qua những chặng nào.
- Thấy agent nào làm ở chặng nào và model nào đứng sau nó.
- Cùng một giao diện dùng được cho phiên đang chạy và phiên đã xong.

**Không-mục-tiêu (giai đoạn 1)**
- Tab agent team (là giai đoạn 2, nhưng dữ liệu phải đủ để làm sau mà không dựng lại).
- Điều khiển hay can thiệp vào phiên (chỉ đọc, không gửi lệnh).
- Hook của Claude Code, cổng duyệt, thông báo.
- Theo dõi chi phí/token chi tiết.
- Nhiều người dùng, đăng nhập, triển khai lên mạng.
- Quy trình khác ngoài kiểu Superpowers.

**Phản-mục-tiêu (dù chạy được vẫn là thất bại)**
- Đẹp nhưng không giúp thấy hình dạng của task.
- Dữ liệu giả hoặc mô phỏng: mọi thứ hiện ra phải suy ra từ phiên thật. (Đề xuất của Claude dựa trên điểm mạnh của video mẫu.)

## 4. Ràng buộc

- Chạy cục bộ trên máy người dùng.
- Dữ liệu duy nhất là các file transcript mà Claude Code đã tự ghi.
- Các subagent của Superpowers sinh ra theo từng việc rồi biến mất, không phải đội cố định. Đây là lý do workflow (không phải agent) làm trục.

## 5. Các hướng tiếp cận đã xem xét

Ba cách lấy dòng sự kiện (cùng một dòng sự kiện phục vụ cả xem trực tiếp lẫn xem lại: trực tiếp là đọc đuôi, xem lại là phát từ đầu):

- **A. Hook của Claude Code.** Dữ liệu có cấu trúc, độ trễ thấp, phát hiện được lúc cần duyệt; nhưng phải cài trước và các phiên cũ không có dữ liệu.
- **B. Đọc transcript có sẵn.** Không cần cài, phát lại được ngay các phiên cũ, gần trực tiếp nhờ theo dõi file đang ghi; nhưng phải tự suy chặng từ dữ liệu thô.
- **C. Kết hợp B + hook sau.**

**Chọn: B trước.** Người dùng có dữ liệu thật ngay để làm giao diện, hai chế độ dùng chung một đường đọc, và hook có thể thêm sau mà không phải làm lại. (Người dùng không phản đối khi được đề xuất.)

## 6. Các quyết định do Claude tự chọn (người dùng chưa xác nhận)

- Ứng dụng web chạy cục bộ: một chương trình nền đọc transcript, một trang web hiển thị.
- Cảnh 3D dựng bằng Three.js (video mẫu là 3D).
- Chặng được suy ra từ **skill Superpowers được gọi** (brainstorming → thiết kế; writing-plans → kế hoạch; subagent-driven-development / executing-plans → code; requesting-code-review → review; verification → kiểm tra...). Bảng ánh xạ chi tiết do người dựng hoàn thiện.
- Model của từng agent đọc từ transcript của subagent tương ứng. **Cần kiểm tra thực tế** là transcript có đủ thông tin này không.
- Đơn vị hiển thị cấp cao nhất là **một phiên** (session), không phải "task" trải qua nhiều phiên. Ứng dụng cho chọn phiên; mặc định theo phiên đang hoạt động gần nhất.
- Nếu transcript thiếu thông tin (ví dụ không biết model của subagent), huy hiệu hiện **"không rõ"**. Không bao giờ đoán hay bịa; phản-mục-tiêu "không dữ liệu giả" thắng mục tiêu "luôn có huy hiệu model".
- Phiên không dùng skill Superpowers nào vẫn hiển thị, các chặng ghi là **"chưa phân loại"**, không bỏ qua phiên.
- Chỉ đọc, không ghi gì vào phiên.
- Mọi thứ trên màn hình có thể bấm để xem sự kiện gốc (để tin được, giống bảng "Nhật ký thật" của video).

## 7. Để lại cho người dựng

- Cấu trúc file transcript, cách tìm phiên, cách nhận biết subagent và model.
- Bảng ánh xạ skill → chặng và cách xử lý phiên không theo đúng quy trình.
- Cách hiển thị vòng lặp (review → sửa → review lại) và các chặng bị bỏ qua.
- Định nghĩa "xong" của một task.
- Chi tiết giao diện: người dùng đã có ý tưởng riêng, nên người dựng cần hỏi người dùng trước khi chốt giao diện.
- Dữ liệu sự kiện phải mang đủ thông tin (vai trò agent, model, thời điểm) để tab giai đoạn 2 đọc lại được.
