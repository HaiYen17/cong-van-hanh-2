# Đối chiếu module 1:1 hiện tại

Ngày kiểm tra: 2026-07-26  
Nguồn chuẩn: `C:\Users\minht\OneDrive\Desktop\Hành chính` (GAS, chỉ đọc)  
Đích: `C:\Users\minht\OneDrive\Desktop\Hành chính v3` (Next.js + PostgreSQL)

## Đợt dựng lại Kế toán, Tuyển dụng và C&B

Phần đánh giá cũ bên dưới được giữ để theo dõi lịch sử, nhưng không còn được dùng làm
bằng chứng “1:1” cho ba nhóm này. Sau phản hồi của người dùng, UI viết lại bằng React
đã được thay bằng chính cấu trúc HTML/CSS/JS của sáu modal GAS gốc:

- `AccountingConfigModal.html`: 132 ID, 26 RPC.
- `CandidateManagementModal.html`: 77 ID, 29 RPC.
- `CandidateAssessmentModal.html`: 34 ID, 5 RPC.
- `CandidateResultsModal.html`: 13 ID, 4 RPC.
- `EvaluationConfigModal.html`: 198 ID, 17 RPC.
- `EvaluationModal.html`: 23 ID, 4 RPC.

Kết quả đối soát ngày 2026-07-26:

- Giữ đủ 477/477 ID của sáu màn nguồn và parse thành công toàn bộ script inline.
- Đã có adapter PostgreSQL cho 85/85 lời gọi RPC tĩnh của sáu màn.
- Sáu màn trên Cloud Run không có chuỗi mojibake/font lỗi và không tràn ngang ở viewport
  desktop dùng để kiểm thử.
- Offer/Nhận việc vẫn khóa cả UI lẫn backend theo yêu cầu.
- JD tiếp tục ưu tiên bản mới không có `[BC]`; chỉ fallback sang `[BC]` khi vị trí không có
  JD mới.
- Trạng thái trung thực hiện tại: **UI NGUỒN 1:1 + ĐỦ CONTRACT RPC**. Vẫn cần người dùng
  đăng nhập và chạy regression với dữ liệu vận hành thật để xác nhận từng thao tác ghi,
  file, queue và quyền trên production trước khi gọi là 1:1 end-to-end.

## Cách xếp trạng thái

- `ĐẠT PHẠM VI`: đã có UI nghiệp vụ, backend PostgreSQL, dữ liệu và luồng chính; các phần
  bị loại khỏi phạm vi phải là phần người dùng đã chốt.
- `CÒN GAP`: có route và luồng thật nhưng còn trường, popup, file, queue, dữ liệu hoặc chi
  tiết UI chưa đủ để xác nhận 1:1.
- `CONSOLE`: mới đọc dữ liệu nhập trong `ConfigurationRecord`; chưa phải module nghiệp vụ.
- `CHƯA LÀM`: chưa có route hoặc chỉ là placeholder.
- `KHÓA CHỦ ĐỘNG`: người dùng đã yêu cầu không phục dựng ở thời điểm hiện tại.

## 31 module đang công bố trên dashboard GAS

| Nhóm | Module | Hiện trạng V3 | Khoảng trống còn lại |
|---|---|---|---|
| Super Admin | Cấp quyền | CÒN GAP | Có đủ gán quyền, thiết lập quyền, action-level access và xác nhận mật khẩu Super Admin; còn cần chốt pixel/UI và audit thao tác hàng loạt với modal GAS. |
| Super Admin | Cấu hình Tổng | CÒN GAP | Đã có Viettel Post, Eshop, Kho KTS/RFID, AI, Folder lưu trữ, secret mã hóa và test kết nối; còn cần đối chiếu nốt từng control/popup với modal GAS. |
| Notifier | Trực chat Thư ký Mèo | CHƯA LÀM | Chưa có route, thread/message PostgreSQL và kênh realtime/Notifier. |
| Quản lý | Quản lý đơn hàng | CÒN GAP | Có dữ liệu thật, lọc, trạng thái và lịch sử; còn thiếu một số thao tác queue/badge/chi tiết JSON-file giống Inbox Admin. |
| Thực thi | Đối soát | ĐẠT PHẠM VI | Đã có run, nguồn, chi tiết, lỗi, output, lịch sử và PostgreSQL; tiếp tục regression khi thêm nguồn đối soát mới. |
| Thực thi | Hiệu đính hồ sơ | ĐẠT PHẠM VI | Đã có hiệu đính, tên lưu trữ, file GCS, lịch sử, migration hồ sơ cũ và kiểm soát trùng. |
| Cấu hình | Cấu hình | CÒN GAP | Đã đúng 4 tab Công ty/Nhân sự/Loại văn bản/Sự kiện; Công ty còn địa chỉ cũ/văn phòng/ưu tiên, Sự kiện còn kênh, content mode, ảnh, task liên kết và upload. |
| Cấu hình | Setup tài sản | CÒN GAP | Đã dùng trực tiếp UI nguồn 5 tab, đủ CRUD/xóa mềm PostgreSQL, 15 tùy chọn + 2 tài sản cũ, upload ảnh GCS, VPP, Đồng phục, queue worker và Gemini đọc hóa đơn. Adapter đã phủ đủ 18 RPC động/tĩnh của modal; còn kiểm thử end-to-end worker/Gemini bằng credential production và nối regression với Cấp phát/Sửa chữa. |
| Cấu hình | Setup ứng dụng | CÒN GAP | Đã thay console bằng UI nguồn, CRUD 12 ứng dụng/5 tag, logo, hướng dẫn, nhiều phiên bản, file tải trực tiếp GCS và metadata PostgreSQL. Còn regression thao tác ghi thật sau đăng nhập production và nhập đủ file cũ chưa nằm trong GCS. |
| Cấu hình | Cấu hình đánh giá | ĐẠT PHẠM VI | Đã có 8 tab, runtime PostgreSQL, JD dùng chung, cấu hình kỳ/workflow/tiêu chí và dữ liệu lịch sử. |
| Cấu hình | Cấu hình Biểu mẫu | CONSOLE | Mới có danh sách record nhập; thiếu nạp link/Word/Excel, quét placeholder, field builder, version và preview. |
| Cấu hình | Bộ nguyên tắc AI | CONSOLE | Mới đọc 41 rule và 4 lịch sử; thiếu Nạp nhanh, Nhóm nguyên tắc, CRUD rule, bộ lọc và prompt preview/copy. |
| Cấu hình | Cấu hình Báo cáo Kế toán | CÒN GAP | UI 5 tab đã bám modal cũ, có API/worker/import-export; worker/schema vận hành vẫn có trạng thái chưa sẵn sàng nên chưa thể chốt 1:1 end-to-end. |
| Tuyển dụng | Quản lý Ứng viên | ĐẠT PHẠM VI | Đã có 8 view đang dùng, import XLS/CSV, campaign, journey, lịch, intake, chất lượng, công cụ và tiêu chí; Offer/Nhận việc khóa theo yêu cầu. |
| Tuyển dụng | Đánh giá Ứng viên | ĐẠT PHẠM VI | Đã có queue, CV/JD mới ưu tiên, HEXACO, văn hóa, điểm/nhận xét, draft/complete/revision và khóa phiếu. |
| Tuyển dụng | Xem kết quả đánh giá | ĐẠT PHẠM VI | Đã có tổng hợp vòng, phiếu, lịch sử, PDF/công bố token, cập nhật và thu hồi. |
| Người Thuần Việt | Đơn hàng của tôi | CÒN GAP | Có route riêng, tìm/lọc, trạng thái, chi tiết và file; còn cần đối chiếu badge/dock và toàn bộ thao tác nhỏ của Inbox Me. |
| Người Thuần Việt | Thông tin | CÒN GAP | Đã có 2 tab Văn bản/Nhân sự, tra cứu và JD; còn cần chốt toàn bộ dữ liệu hồ sơ nhân sự cũ và hành vi mở tài liệu. |
| Người Thuần Việt | Review hồ sơ | ĐẠT PHẠM VI | Đã có file GCS, 41 rule, AI request/history và hiển thị phát hiện cũ; cần API key Gemini để chạy AI thật ở môi trường hiện tại. |
| Người Thuần Việt | Đóng dấu và cấp số văn bản | CÒN GAP | Có form chuyên biệt, request, cấp số PostgreSQL và file; cần đối chiếu nốt popup/preview/in giấy với modal GAS. |
| Người Thuần Việt | Trích lục/Lưu trữ hồ sơ | CÒN GAP | Có form chuyên biệt, lịch sử và Request PostgreSQL; còn các chi tiết preview/file và trạng thái nhỏ. |
| Người Thuần Việt | Cấp Giấy Ủy quyền/Giới thiệu | CÒN GAP | Có form chuyên biệt, tìm nhân sự và cấp số; còn đối chiếu nốt template/in giấy và popup. |
| Người Thuần Việt | Đề xuất Cấp phát | CÒN GAP | Có giỏ nhiều dòng và người nhận; bị chặn bởi danh mục Setup tài sản chưa hoàn chỉnh và chưa có toàn bộ ảnh/biến thể cũ. |
| Người Thuần Việt | Yêu cầu sửa chữa | CÒN GAP | Có giỏ nhiều dòng, mã CCDC, ảnh/ghi chú/khẩn; bị chặn bởi danh mục và file nền tảng Setup tài sản. |
| Người Thuần Việt | Đăng ký công tác | CHƯA LÀM | Route hiện chỉ phản chiếu placeholder “đang được dựng lại” của nguồn GAS. |
| Người Thuần Việt | Đánh giá nhân sự | ĐẠT PHẠM VI | Đã có phiếu được giao, lọc, chấm, bằng chứng/nhận xét, draft/submit/lock và JD mới → `[BC]` → scoring cũ. |
| Người Thuần Việt | Gửi thư | CÒN GAP | Có tài khoản Viettel Post, form, tạo đơn và lịch sử PostgreSQL; cần chốt nốt đối chiếu địa chỉ, popup và tracking chi tiết. |
| Người Thuần Việt | Yêu cầu hỗ trợ | CÒN GAP | Có loại hỗ trợ, giỏ nhiều dòng, tổng giờ và cờ khẩn; còn cần đối chiếu file/lịch sử nhỏ với modal GAS. |
| Người Thuần Việt | Bản đồ định vị | CÒN GAP | UI/TTL/tự làm mới đã có; môi trường chưa có `location.config` và `location.presence` từ Notifier nên chưa có dữ liệu vận hành thật. |
| Người Thuần Việt | Giao việc | CÒN GAP | Có CRUD kế hoạch, đầu ra, người thực hiện, phản hồi và duyệt; còn lịch lặp/nhắc việc, file và notification đầy đủ. |
| Người Thuần Việt | Công cụ hỗ trợ | CÒN GAP | Đã dùng UI nguồn, tìm/lọc/chọn nhiều, xem hướng dẫn, quản lý draft và tạo ZIP riêng tư từ GCS. Không còn bị chặn bởi Setup ứng dụng; còn regression tải file thật sau đăng nhập và chuyển nốt các file Drive cũ vào GCS. |

Phần `Offer` và `Nhận việc` là `KHÓA CHỦ ĐỘNG`, không tính là lỗi thiếu của bản 1:1.

## Catalog V3 active nhưng chưa có route

> Cập nhật 2026-08-05: tám card Phân Xưởng trong danh sách lịch sử bên dưới đã
> được khôi phục trên V3 tại `/phan-xuong/*`, dùng Prisma/PostgreSQL và giao diện
> parity từ archive chỉ đọc. Xem `workshop-parity-audit-2026-08-05.md`.

Ngoài 31 module dashboard GAS, PostgreSQL đang có 54 card active. Có 18 card không có route:

- V3-native chưa có màn: `Lịch sử hệ thống`, `Tổng quan BOD`, `Phê duyệt BOD`,
  `Lịch sử BOD`.
- Kho: `Cấu hình Kho`, `Lịch dữ liệu Kho`, `Kiểm kê Kho`, `Phản chiếu đơn hàng`,
  `Nhật ký quét`, `Báo cáo Kho`.
- Xưởng: `Cấu hình Xưởng`, `Đặt hàng Xưởng`, `Kế hoạch Xưởng`, `Phân bổ thủ công`,
  `Duyệt KH Xưởng`, `Đề xuất Xưởng`, `Báo cáo Xưởng`, `Kiểm kê Xưởng`.

Các card Kho/Xưởng có backend GAS cũ nhưng chưa thuộc 31 card trong registry dashboard chính.
Khi phục dựng toàn cổng, chúng vẫn phải được đưa vào backlog sau nhóm Hành chính nền tảng.

## Thứ tự tiếp tục

1. Setup tài sản.
2. Setup ứng dụng → Công cụ hỗ trợ.
3. Cấu hình Biểu mẫu → Biểu mẫu người dùng.
4. Bộ nguyên tắc AI → hoàn thiện AI Review.
5. Cấu hình 4 tab còn thiếu chi tiết.
6. Đăng ký công tác.
7. Inbox Admin/Inbox Me và các luồng pháp lý còn gap nhỏ.
8. Thư ký Mèo.
9. Kho và Xưởng.

Lý do chọn Setup tài sản trước: đây là module nền dùng chung trực tiếp cho Đề xuất cấp
phát, Yêu cầu sửa chữa, ảnh CCDC, Văn phòng phẩm và Đồng phục; hoàn thành một module sẽ
gỡ đồng thời nhiều khoảng trống phía người dùng.

## Cập nhật triển khai trong ngày

- `Setup tài sản` đã được thay từ console đọc thô sang route nghiệp vụ riêng
  `/cau-hinh/setup-tai-san`.
- `Setup tài sản`, `Setup ứng dụng` và `Công cụ hỗ trợ` đã được chuyển sang chính HTML/CSS/JS nguồn
  thay vì giao diện React rút gọn. Các RPC cũ được ánh xạ sang PostgreSQL/GCS, giữ nguyên tên hàm để
  không làm mất hành vi của modal.
- Đối soát đọc thật tại PostgreSQL: 12 ứng dụng, 5 tag, 15 tùy chọn tài sản, 2 tài sản, 1 tác vụ
  xử lý nền; VPP và Đồng phục hiện chưa có bản ghi nên UI hiển thị đúng empty state.
- Revision Cloud Run `cong-van-hanh-web-00020-75k` đang nhận 100% traffic.
- GCS, URL worker và folder VPP/Đồng phục đã có cấu hình. Worker secret là tùy chọn và
  hiện chưa có; Gemini model đã có nhưng API key Gemini chưa được lưu nên nút phân tích
  hóa đơn sẽ tự khóa và báo đúng trạng thái.
- Lượt tiếp theo: nối regression danh mục mới vào Cấp phát/Sửa chữa, sau đó chuyển sang
  `Setup ứng dụng`.
