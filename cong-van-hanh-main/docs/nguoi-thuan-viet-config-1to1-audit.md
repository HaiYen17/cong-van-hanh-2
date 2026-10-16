# Đối chiếu phục dựng 1:1 — Người Thuần Việt và Cấu hình

Ngày đối chiếu: 2026-07-24  
Nguồn chuẩn: dự án GAS `C:\Users\minht\OneDrive\Desktop\Hành chính`  
Đích: Next.js + PostgreSQL `C:\Users\minht\OneDrive\Desktop\Hành chính v3`

## Người Thuần Việt

| Nhóm | Module GAS | Trạng thái trước đợt phục dựng | Sai khác cần xử lý |
|---|---|---|---|
| Quản lý đơn | Đơn hàng của tôi | CÓ MỘT PHẦN | Đang dùng màn Thực thi chung; thiếu dock trạng thái, tìm kiếm, chi tiết, JSON/file và badge theo module cũ |
| Hồ sơ pháp lý | Thông tin | THIẾU | Chưa có route; cần 2 tab Văn bản/Nhân sự, tra cứu hồ sơ lấy số, hồ sơ không lấy số, hồ sơ nhân sự và JD dùng chung |
| Hồ sơ pháp lý | Review hồ sơ | THIẾU | Chưa có route/UI nghiệp vụ; dữ liệu nền mới chỉ có record import |
| Hồ sơ pháp lý | Đóng dấu và cấp số văn bản | CÓ | Đã có route riêng; tiếp tục giữ engine cấp số PostgreSQL |
| Hồ sơ pháp lý | Trích lục / Lưu trữ hồ sơ | CÓ | Đã có route riêng và Request PostgreSQL |
| Hồ sơ pháp lý | Cấp Giấy Ủy quyền / Giới thiệu | CÓ | Đã có route riêng và Request PostgreSQL |
| Cấp phát và Sửa chữa | Đề xuất Cấp phát | KHÁC | Chỉ có form Request chung; thiếu form 2 panel, danh mục, giỏ nhiều dòng và người được gán |
| Cấp phát và Sửa chữa | Yêu cầu sửa chữa | KHÁC | Chỉ có form Request chung; thiếu giỏ nhiều dòng, file ảnh, mã CCDC và cờ khẩn cấp đúng UI cũ |
| Hành chính | Đăng ký công tác | THIẾU | GAS nguồn hiện chỉ hiển thị màn “đang được dựng lại”; phải phản chiếu đúng trạng thái này |
| Hành chính | Đánh giá nhân sự | CÓ | Đã phục dựng trước đợt này; JD đã dùng chính sách mới → `[BC]` → scoring cũ |
| Hành chính | Gửi thư | CÓ | Đã có route, tài khoản Viettel Post và lịch sử PostgreSQL |
| Hành chính | Yêu cầu hỗ trợ | KHÁC | Chỉ có form Request chung; thiếu segmented loại hỗ trợ, giỏ nhiều dòng, tổng giờ và cờ khẩn |
| Hành chính | Bản đồ định vị | THIẾU | Chưa có route/card trong seed mới |
| Tiện ích | Giao việc | THIẾU | Chưa có route/UI công việc kế hoạch, lặp lại, đầu ra, người thực hiện, phản hồi và duyệt |
| Tiện ích | Công cụ hỗ trợ | THIẾU | Chưa có route/UI kho ứng dụng, lọc chức năng, chọn tải, hướng dẫn và bản lưu tạm |
| Tiện ích dùng chung | Biểu mẫu | KHÁC | Card người dùng chưa có route; cấu hình biểu mẫu mới chỉ là trang record import |

## Cấu hình

Nguồn GAS `ConfigModal.html` có đúng 4 tab nghiệp vụ:

1. `Công ty`
2. `Nhân sự`
3. `Loại văn bản`
4. `Sự kiện`

| Tab | Trạng thái trước đợt phục dựng | Sai khác cần xử lý |
|---|---|---|
| Công ty | CÓ NHƯNG KHÁC UI | Form và PostgreSQL đã có, nhưng đang trộn cùng nhân viên/tài khoản/vai trò; thiếu bố cục form trái + danh sách phải như modal gốc |
| Nhân sự | CÓ MỘT PHẦN | Có nguồn đồng bộ và liên kết định danh ở các màn rời; cần gom đúng tab, hiển thị mapping nguồn, danh sách nguồn và tài khoản liên kết |
| Loại văn bản | CÓ | Có engine PostgreSQL và route riêng; cần đưa về đúng nhịp tab/bố cục của Cấu hình gốc |
| Sự kiện | CÓ MỘT PHẦN | Có thông điệp/thông báo và bộ tương tác; cần gom đúng tab, bộ lọc, target, kênh, popup, reminder và liên kết giao việc |

Các card cấu hình độc lập (`Cấu hình Tổng`, `Setup tài sản`, `Setup ứng dụng`, `Cấu hình đánh giá`, `Cấu hình Biểu mẫu`, `Bộ nguyên tắc AI`, `Cấu hình Báo cáo Kế toán`) không được trộn thành tab của `Cấu hình`; chúng vẫn là module riêng đúng dashboard GAS.

## Quy tắc dữ liệu

- Mọi yêu cầu người dùng ghi vào `Request`, `RequestEvent`, `RequestAttachment`.
- Dữ liệu nền/cấu hình đã nhập giữ `ConfigurationRecord` cho đến khi model chuyên biệt được hoàn tất; UI không được chỉ hiển thị record thô.
- Tệp dùng `FileObject` / `FileVersion` / `FileLink`; metadata và URL gắn vào request.
- Quyền kiểm tra ở server theo module/permission hiện có.
- Offer tiếp tục khóa và không được mở lại.
- JD dùng chung cho đánh giá nhân sự và tuyển dụng: ưu tiên JD mới không có `[BC]`; chỉ dùng `[BC]` khi không có JD mới; cuối cùng mới dùng scoring JD cũ.

## Kết quả phục dựng ngày 2026-07-24

- Dashboard Người Thuần Việt đã đủ các nhóm/module nguồn và dùng route nghiệp vụ riêng.
- Đơn hàng của tôi, Thông tin, Review hồ sơ, Cấp phát, Sửa chữa, Yêu cầu hỗ trợ, Bản đồ định vị, Giao việc, Công cụ hỗ trợ và Biểu mẫu đã có UI nghiệp vụ thay cho form Request chung.
- Review hồ sơ đã nối FileObject/GCS, 41 Bộ nguyên tắc AI, Gemini và kết quả lưu trong Request PostgreSQL.
- Bản đồ định vị đã phục dựng TTL 5 phút, văn phòng/Nơi khác và nhịp tự làm mới 20 giây. Hệ thống hiện hiển thị trạng thái tắt vì PostgreSQL chưa có `location.config` từ ScriptProperties cũ.
- Biểu mẫu đã đọc đúng `JSON trường`, tự điền Công ty/Nhân sự/Ngày, hỗ trợ bảng nhiều dòng, tạo bản sao Google Docs và lưu lịch sử Request.
- Cấu hình đã trở về đúng 4 tab Công ty, Nhân sự, Loại văn bản, Sự kiện; các module cấu hình độc lập không còn bị trộn vào đây.
- Seed quyền và importer đã giữ `templates`, thêm `location-map`, đồng bộ quyền AHC/Super Admin.
- Build Next.js, kiểm tra UTF-8, ESLint vùng thay đổi và kiểm tra trực quan desktop đều đạt.
- Cloud Run revision `cong-van-hanh-web-00014-6rz` đang nhận 100% traffic.

### Điều kiện vận hành còn thiếu dữ liệu bí mật/ngoại hệ thống

- `ai.reviewGeminiApiKey` hiện chưa có giá trị; yêu cầu Review vẫn được lưu an toàn và ghi rõ AI chưa chạy cho đến khi key được cấu hình.
- File Google Docs nguồn của từng biểu mẫu phải cấp quyền tạo bản sao cho service account Cloud Run; action đã có thông báo cụ thể nếu tệp chưa được chia sẻ.
- Dữ liệu Bản đồ chỉ xuất hiện khi cấu hình/vân tay mạng/nhịp presence của Notifier được ghi sang hai SystemSetting `location.config` và `location.presence`.
