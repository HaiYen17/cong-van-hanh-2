# Đối soát 1:1 — Đơn hàng của tôi / Quản lý đơn hàng

Ngày đối soát: 2026-07-26

## Nguồn chuẩn

- `Hành chính/InboxShared.html`
- `Hành chính/inboxMe.html`
- `Hành chính/inboxAdmin.html`
- `Hành chính/inboxMe_api.js`
- `Hành chính/inboxAdmings.js`
- `Hành chính/V2_INBOX_DOCUMENT_NAME_DEFINITIONS.md`
- `Hành chính/V2_INBOX_TEST_MATRIX.md`
- workflow và SLA trong `Hành chính/Code.js`

Hai trang PostgreSQL dùng trực tiếp HTML/CSS/JS của các nguồn trên; chỉ thay lớp gọi
`google.script.run` bằng `/api/inbox/rpc`.

## Ma trận chức năng

| Khu vực | Chức năng | Trạng thái |
| --- | --- | --- |
| Đơn của tôi | 5 ô thống kê Nhận / Xử lý / Bổ sung / Xong / Trễ | Có |
| Đơn của tôi | Tìm kiếm, tải lại, lọc theo ô thống kê | Có |
| Đơn của tôi | Gom đơn theo dịch vụ, mở/thu gọn từng nhóm | Có |
| Đơn của tôi | Thẻ đơn, trạng thái, hạn xử lý, phòng ban, khẩn cấp | Có |
| Đơn của tôi | Modal chi tiết khi bấm từng đơn | Có |
| Đơn của tôi | Chi tiết payload, tag, file, JSON | Có |
| Đơn của tôi | Hủy đơn đang xử lý | Có |
| Đơn của tôi | Xin lại dấu trên cùng mã đơn đã hoàn thành | Có |
| Đơn của tôi | In Giấy Ủy quyền/Giới thiệu | Có |
| Đơn của tôi | Xem/in phiếu nguyên vật liệu Xưởng | Có |
| Quản lý đơn | 5 ô thống kê và bộ lọc văn phòng Q12/Thành Công | Có |
| Quản lý đơn | Tìm kiếm, tải lại, gom nhóm dịch vụ | Có |
| Quản lý đơn | Hàng đợi thao tác, toast, thông báo trình duyệt | Có |
| Quản lý đơn | Modal chi tiết đầy đủ khi bấm từng đơn | Có |
| Quản lý đơn | Tiếp nhận / Xử lý / Bổ sung / Hoàn thành / Hủy | Có |
| Quản lý đơn | Bước nghiệp vụ riêng theo từng dịch vụ | Có |
| Quản lý đơn | Sửa tên hồ sơ và tên từng mục | Có |
| Quản lý đơn | Sửa chi tiết mục Đóng dấu | Có |
| Quản lý đơn | Trích lục: trả file / hoàn thành mục / mở lại | Có |
| Quản lý đơn | Xem trước cấp số, cấp số và hoàn thành | Có |
| Quản lý đơn | In Giấy Ủy quyền/Giới thiệu và phiếu Xưởng | Có |
| Chung | Phân quyền người nộp/Admin và audit thao tác | Có |
| Chung | Desktop và mobile, không tràn ngang modal | Có |
| Chung | Dữ liệu và lịch sử lấy từ PostgreSQL | Có |

## Kiểm thử tự động

Chạy:

```powershell
npm run test:inbox
```

Kiểm thử đọc dữ liệu thật, không sửa đơn:

- bootstrap Admin;
- bootstrap lịch sử của một người dùng;
- cấu trúc ticket bắt buộc;
- xem trước cấp số của đơn Đóng dấu đang chờ;
- dựng dữ liệu in Giấy Ủy quyền/Giới thiệu;
- dựng bản in nguyên vật liệu Xưởng.

Kết quả tại thời điểm đối soát:

- 509 đơn Admin;
- 57 đơn lịch sử cho hồ sơ kiểm thử;
- bản xem trước cấp số có dữ liệu;
- bản in Giấy Ủy quyền và bản in Xưởng dựng thành công.
