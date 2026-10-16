# B09-DN — Bộ sinh số và kiểm tra (Phase 3)

## Mục tiêu đã triển khai

Phase 3 không tạo thêm một bộ công thức tài khoản độc lập cho B09. Mỗi khoản thuyết
minh lấy số từ đúng dòng của các báo cáo tài chính đã được cấu hình, đồng thời kế
thừa bằng chứng tài khoản/bút toán của dòng đó. Nhờ vậy sửa công thức báo cáo chính
thì B09 thay đổi theo, không phát sinh hai nguồn sự thật.

Luồng người dùng:

1. Mở **Mẫu thuyết minh B09** trong tab Mẫu báo cáo.
2. Chọn các phiên PostgreSQL cùng kỳ; hệ thống tự tìm đúng kỳ năm trước theo từng
   nguồn, công ty, khối dữ liệu và loại dữ liệu.
3. Chọn **Sinh khoản đang chọn** hoặc **Sinh toàn bộ B09**.
4. Xem số, đường truy nguồn, chi tiết chứng minh và trạng thái cộng khớp ngay trong
   khoản mục đang xem.

## Ba vai trò của dòng nguồn

- `ADDITIVE`: được cộng vào giá trị của khoản thuyết minh.
- `SUBSET_DETAIL`: chỉ bung chi tiết, không cộng thêm vào dòng cha. Ví dụ
  “Trong đó: Chi phí lãi vay” nằm trong “Chi phí tài chính”.
- `REFERENCE_ONLY`: dùng để đối chiếu, không cộng. Ví dụ số cuối kỳ của hai phương
  pháp lập Báo cáo lưu chuyển tiền tệ.

Engine vẫn nhận đúng bản đồ B09 đã lưu từ Phase 2: khi một liên kết cũ chưa có
`aggregationRole`, nhãn bắt đầu bằng “Trong đó” được nhận là `SUBSET_DETAIL`.

## Trạng thái kế toán

- `READY`: khoản tự động, đủ dòng nguồn, báo cáo nguồn sẵn sàng và mọi kiểm tra đạt.
- `NEEDS_REVIEW`: khoản hỗ trợ, thiếu dòng, báo cáo nguồn còn cảnh báo hoặc bằng
  chứng chưa cộng khớp.
- `MANUAL_INPUT`: khoản thuyết minh cần thông tin ngoài sổ/báo cáo chính và phải
  nhập hoặc duyệt có kiểm soát ở phase kế tiếp.

Mọi chênh lệch được trả về `controlChecks` và `warnings`. Không có “phiếu cân”,
“phần còn lại” hoặc số bù do máy tự tạo.

## Phạm vi chiến lược hiện tại

Phase 3 đã chạy thật cho các khoản kế thừa trực tiếp dòng báo cáo và các đường đối
chiếu chéo. Các bảng biến động tài sản, thuế, công nợ theo tuổi nợ, giao dịch bên
liên quan và giao dịch phi tiền tệ vẫn mang trạng thái `NEEDS_REVIEW`/`MANUAL_INPUT`
cho đến khi triển khai bộ bảng phụ trợ và luồng nhập có kiểm soát; hệ thống không
đoán số để lấp các bảng này.

## Kiểm thử khóa nghiệp vụ

- Dòng “Trong đó” hiển thị nhưng không cộng trùng.
- Hai cột Nợ/Có không bị gộp dù có cùng nghĩa kỳ.
- Hai báo cáo dòng tiền được ghép theo loại kỳ dù khóa cột khác nhau.
- Thiếu bằng chứng làm kiểm tra thất bại và không sinh số bù.

