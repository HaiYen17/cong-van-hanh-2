# Lộ trình phục dựng module 1:1

## Mục tiêu

Phục dựng dần toàn bộ WebApp `Hành chính` sang `Hành chính v3`, giữ đúng UI,
trường dữ liệu, hành vi và phân quyền của bản Google Apps Script. PostgreSQL là
nguồn dữ liệu nghiệp vụ chính; Google Sheet chỉ còn là nguồn nhập/đối chiếu trong
giai đoạn chuyển đổi.

## Hiện trạng V3

- Catalog đã đăng ký khoảng 48 module nhưng dashboard mới có route cho khoảng 14 module.
- PostgreSQL hiện có 26 model và nền cho người dùng, công ty, RBAC, yêu cầu,
  số văn bản, gửi thư, cấu hình và bản tin.
- Đối chiếu 31 module đang hiện trên GAS: 13 module có một phần, 12 module mới
  có card, 6 module chưa có; chưa module nào được xác nhận hoàn tất 1:1.
- Các lát cắt có thể tái sử dụng tốt nhất là engine cấp số văn bản, workflow
  Request và gửi thư ViettelPost.

## Tiến độ nền tảng

Đã hoàn thành ở mức code/migration local ngày 24/07/2026:

- Auth không còn cấp toàn quyền cho mọi tài khoản; Super Admin bắt buộc mật khẩu.
- Có staging import gồm source, run, row, issue, checksum và external ID map.
- Đồng bộ nhân sự ghi rõ số thêm/cập nhật/bỏ qua/lỗi; không còn nuốt lỗi từng dòng.
- Có metadata file, version, link, ACL và adapter storage không giả thành công.
- Có file picker dùng chung bám primitive GAS cũ, responsive và không lộ native input.
- Build tự kiểm tra UTF-8/mojibake; font tiếp tục dùng Be Vietnam Pro và Montserrat.

Migration nền đã được áp thành công vào Cloud SQL dev ngày 24/07/2026 và đã
smoke-test trong transaction có rollback. Database hiện có 234 nhân sự nhưng
chưa có bản ghi `PersonnelSource`, nên chưa thể chạy đồng bộ Google Sheet thật
cho đến khi cấu hình ít nhất một nguồn.

## Thứ tự nền tảng bắt buộc

| Chặng | Nền tảng | Kết quả cần đạt |
|---:|---|---|
| 1 | Dữ liệu lõi | Company, Employee, User, Partner và DocumentType có khóa ổn định, staging import và báo cáo chống trùng |
| 2 | Auth, RBAC, catalog, audit | Đăng nhập đúng quy tắc cũ; chỉ Super Admin có toàn quyền; quyền theo group/module/action; không thể xóa Super Admin cuối cùng |
| 3 | Cấu hình tổng và secrets | Chuẩn hóa tài khoản tích hợp; secret không lưu dạng rõ trong bảng cấu hình thường |
| 4 | File storage dùng chung | FileObject, FileVersion, ACL, upload/download, checksum, signed URL và ánh xạ Drive cũ |
| 5 | Job queue và outbox | Tác vụ chậm chạy nền, retry, progress, event và thông báo kết thúc |
| 6 | Biểu mẫu và tài liệu | Template, version, field mapping, file mẫu và sổ văn bản dùng chung |
| 7 | Inbox/Request workflow | Đơn của tôi, quản lý đơn, item, queue, duyệt, file đính kèm, lịch sử và thông báo |
| 8 | Danh mục dùng chung | Tài sản, VPP, đồng phục, kho ứng dụng, tag, đối tác/khách hàng |

`Cấu hình Báo cáo Kế toán` được đưa vào ngay sau chặng 8 vì module này cần sẵn
Company, RBAC, audit, file storage, cấu hình tích hợp và job queue. Pilot hiện
có sẽ được dùng làm chuẩn UI, không dựng lại một bản giản lược.

## Nhóm phục dựng sau nền tảng

### Nhóm A — tiếp tục trước

- Cấp quyền và cấu hình tổng.
- Cấu hình loại văn bản, đóng dấu/cấp số.
- Trích lục/lưu trữ hồ sơ và cấp giấy ủy quyền/giới thiệu.
- Gửi thư ViettelPost.
- Đơn hàng của tôi và Quản lý đơn hàng.

### Nhóm B — cần file và danh mục

- Cấu hình Biểu mẫu.
- Setup tài sản.
- Setup ứng dụng và Công cụ hỗ trợ.
- Đề xuất cấp phát và Yêu cầu sửa chữa.
- Thông tin pháp lý, Review hồ sơ và Đối soát.

### Nhóm C — cần queue/worker và dữ liệu lớn

- Cấu hình Báo cáo Kế toán.
- Bộ nguyên tắc AI và AI Review.
- Giao việc/Nhắc việc và Trực chat Thư ký Mèo.
- Tuyển dụng và các module đánh giá.
- Kho, RFID, Eshop và Xưởng.

## Quy tắc hoàn thành một module

Một module chỉ được đánh dấu hoàn tất khi:

1. Đã đối chiếu toàn bộ tab, trường, nút, popup, bộ lọc và empty state với GAS.
2. Có schema PostgreSQL và migration rõ ràng; không đọc toàn Sheet ở mỗi request.
3. Có kiểm tra quyền trong service/Server Action, không chỉ ẩn nút ở giao diện.
4. File dùng primitive storage chung; tác vụ chậm dùng queue chung.
5. Có audit, thông báo tiến trình/kết quả và kiểm tra mobile.
6. Import đối chiếu được số dòng, khóa trùng và lỗi dữ liệu.
7. Đã chạy lint/build và kiểm thử luồng chính trước khi chuyển nguồn đọc.

## Cách chuyển đổi an toàn

Mỗi module đi theo năm bước:

1. Import snapshot vào bảng staging.
2. Chuẩn hóa, chống trùng và đối chiếu count/checksum.
3. Bật dual-write Sheet + PostgreSQL trong thời gian quan sát.
4. Chuyển read sang PostgreSQL bằng feature flag.
5. Chỉ ngắt Sheet sau khi báo cáo đối chiếu không còn sai lệch.

`Inbox Admin` được giữ nguyên trong giai đoạn dựng nền và chỉ chuyển khi
Request/File/Queue/Notification đã hoàn chỉnh.
