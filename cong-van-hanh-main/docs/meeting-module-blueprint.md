# Lịch họp và booking phòng — Blueprint V3

## Quyết định phạm vi

Module này là nghiệp vụ mới, không có module GAS cũ tương ứng để đối chiếu 1-1.
Implementation chỉ nằm trong V3 (Next.js + PostgreSQL).

### Cấu hình

| Hạng mục | MVP | Giai đoạn sau |
|---|---|---|
| Danh mục phòng | Mã, tên, vị trí, tầng, sức chứa, tiện ích, giờ mở/đóng, buffer, thời lượng tối đa, trạng thái | Đồng bộ Google Resource Calendar |
| Chính sách | Chặn trùng phòng, cảnh báo trùng người, timezone, Recall/Gemini, retention | Lịch lặp, quy tắc duyệt theo loại họp |
| Tích hợp | Google Calendar/Meet, Recall, Gemini | Bot Google đã đăng nhập, Teams/Zoom |
| Vận hành | Trạng thái đồng bộ, bot, transcript, biên bản, lỗi gần nhất | Dashboard chi phí/SLA nâng cao |

### Thực thi

| Vai trò | Quyền mặc định |
|---|---|
| Nhân viên | Xem lịch của mình, xem busy-only của người khác, tạo/sửa/hủy họp do mình tổ chức |
| Người tham gia | Xem chi tiết cuộc họp mình được mời, phản hồi tham gia |
| Chủ trì | Quản lý cuộc họp, sửa/duyệt biên bản, xác nhận todo |
| Admin Hành chính | Quản lý phòng, chính sách và theo dõi lỗi vận hành |
| Super Admin | Quản lý secret và toàn bộ quyền/module |

## Trạng thái và quy tắc

- Phòng họp là tài nguyên chặn cứng. Khoảng bị khóa gồm thời gian họp cộng buffer đã chốt lúc booking.
- Người tham gia trùng lịch chỉ tạo cảnh báo; user phải xác nhận `allowAttendeeConflict` để đặt đè.
- Người không tham gia chỉ thấy khoảng bận, không thấy tên/nội dung/link họp.
- Không hard-delete cuộc họp. Hủy bằng trạng thái `CANCELLED`, lý do, người hủy và thời gian.
- Google Calendar/Recall lỗi không làm mất booking PostgreSQL; hệ thống giữ trạng thái lỗi để retry.
- Todo chỉ được đẩy sang Giao việc sau khi chủ trì duyệt biên bản.

## Lưu trữ

- Audio/video nằm ở Recall trong thời hạn ngắn; PostgreSQL chỉ giữ metadata.
- Transcript thô có `expiresAt` và được purge theo chính sách.
- Biên bản đã duyệt, quyết định và todo được giữ lâu dài.
- Mọi thay đổi quan trọng ghi `AuditLog`.

## Tiêu chí hoàn thành MVP

1. Hai booking đồng thời không thể chiếm cùng một phòng trong khoảng giao nhau.
2. Người dùng xem được lịch tuần của mình và busy-only của người được quan tâm.
3. Calendar event có người tham dự và Google Meet được tạo đồng bộ/idempotent.
4. Recall bot được lên lịch, webhook được xác thực và trạng thái hiển thị rõ.
5. Transcript tạo được biên bản/todo dự thảo bằng Gemini.
6. Chỉ chủ trì hoặc Super Admin duyệt biên bản; todo đã duyệt xuất hiện trong Giao việc.
7. Hủy họp cập nhật PostgreSQL, Calendar và Recall; lịch sử không bị xóa.
