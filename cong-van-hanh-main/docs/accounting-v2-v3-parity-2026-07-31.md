# Đối chiếu module Báo cáo Kế toán V2 và V3

Ngày rà soát: 2026-07-31

## Kết luận

Module V3 không thiếu cổng gọi nghiệp vụ của V2. Giao diện parity giữ đủ các tab,
trường nhập và thao tác; API Next.js đăng ký đủ 26 phương thức mà giao diện gọi;
worker V3 giữ toàn bộ endpoint V2 và bổ sung dựng báo cáo, xuất XLSX cùng healthcheck
production.

Nguyên nhân người dùng chưa vận hành được là dữ liệu runtime chưa được chuyển sang
PostgreSQL V3:

- `accounting_runtime.accounting_source_connections`: 0 kết nối;
- lần đồng bộ: 0;
- snapshot đang dùng: 0;
- lịch sử thay đổi: 0.

Worker production, PostgreSQL, schema `accounting_portal` và
`accounting_runtime` đều đang sẵn sàng.

## Đối chiếu giao diện 1-1

| Khu vực V2 | Trạng thái V3 | Ghi chú |
| --- | --- | --- |
| Tổng quan | CÓ | Lấy công ty từ Module Cấu hình, không khai báo trùng |
| Danh mục tài khoản | CÓ | Thêm/sửa, nạp Excel, đổi mã/tên đồng loạt |
| Mẫu báo cáo | CÓ | Trình dựng trực quan, công thức, định dạng, gộp ô, nạp khuôn |
| Dữ liệu đầu vào | CÓ | Giữ đủ 6 bước vận hành |
| Báo cáo hợp nhất | CÓ | Quan hệ sở hữu và quy tắc loại trừ |

Sáu bước dữ liệu đầu vào được giữ nguyên:

1. Kho dữ liệu
2. Nguồn dữ liệu
3. Kiểm tra cột
4. Cập nhật dữ liệu
5. Lịch sử điều chỉnh
6. Tạo báo cáo

Bước Cập nhật dữ liệu có đủ hai tab con:

1. Khối dữ liệu MISA
2. Bảng dữ liệu

Kiểm tra tự động cho thấy V3 giữ đủ `132/132` phần tử có mã định danh của màn V2.

## Đối chiếu API

Giao diện V2 gọi 26 phương thức và V3 đăng ký đủ 26 phương thức, không có phương
thức nào bị bỏ:

- cấu hình phiên bản và bản ghi;
- nạp danh mục tài khoản;
- đổi mã/tên tài khoản;
- nạp khuôn báo cáo;
- trình dựng báo cáo;
- kiểm tra worker/schema;
- lưu và gia hạn phiên MISA;
- đọc và kết nối danh sách khối MISA;
- chạy đồng bộ;
- lịch sử điều chỉnh;
- dựng và xuất báo cáo.

Worker V3 giữ toàn bộ 12 endpoint nghiệp vụ của worker V2 và bổ sung:

- `GET /healthz`;
- `GET /readyz`;
- `POST /report/output`;
- `POST /report/export`.

## Dữ liệu cấu hình đã có trên PostgreSQL

Phiên bản hiện tại: `CFG-20260719-133700-49B4` — Bản nháp nền tảng.

| Loại cấu hình | Số lượng |
| --- | ---: |
| Tài khoản | 1.370 |
| Nhóm tài khoản | 161 |
| Thành viên nhóm tài khoản | 1.865 |
| Nguồn dữ liệu | 3 |
| Mẫu báo cáo | 4 |
| Cột báo cáo | 20 |
| Dòng báo cáo | 211 |
| Công thức/quy tắc | 211 |
| Ánh xạ cột nguồn | 12 |
| Kiểu trình bày | 6 |

Danh sách công ty được lấy trực tiếp từ `public."Company"` và hiện có NTC, NTV,
NDL, TVD, TVG.

## Khác biệt cần xử lý

| Mục | Phân loại | Trạng thái |
| --- | --- | --- |
| Kết nối MISA, lần đồng bộ và snapshot V2 chưa được chuyển | THIẾU DỮ LIỆU | Phải khởi tạo lại khối đầu tiên rồi chạy snapshot |
| Luồng “chỉ dán Bearer” cần một kết nối mẫu đã tồn tại | KHÁC TRẠNG THÁI | Khối đầu tiên dùng cấu hình kỹ thuật một lần; các khối sau chỉ cần Bearer |
| Xuất Google Sheet | THIẾU SO VỚI V2 | V3 hiện xuất Excel và PDF trên Cloud Storage |
| Ô URL/secret worker vẫn hiện trong UI parity | KHÁC GIAO DIỆN | Production thực tế lấy từ Secret Manager, người dùng không cần nhập |
| Công thức chọn riêng từng nguồn/bảng trong một thành phần | GIỚI HẠN CHUNG | V2 và V3 hiện cùng cộng các snapshot đã chọn trước khi chạy công thức |

## Kiểm thử ngày 2026-07-31

- `npm run test:accounting`: 11/11 đạt;
- worker `pytest`: 10/10 đạt;
- `npm run check:legacy-scripts`: parse thành công 38 script block trong 12 trang;
- gọi trực tiếp worker production: database kết nối, hai schema sẵn sàng, không có
  cảnh báo cấu hình;
- mở module bằng tài khoản Nguyễn Minh Thông: tải được bản nháp, 5 công ty và toàn
  bộ số lượng cấu hình nêu trên.

## Điều kiện để hoàn tất nạp lại

Khối đầu tiên cần một Bearer MISA còn hạn. Phần X-MISA-Context và nội dung yêu cầu
mẫu đã được chuẩn bị từ dữ liệu người dùng cung cấp trước đó. Sau khi lưu khối
`KETOAN_2026 BCTC demo`, hệ thống sẽ:

1. đọc danh sách khối MISA mà tài khoản có quyền;
2. kết nối lại đúng DatabaseId để nhận context/token hiện hành;
3. tạo snapshot theo trang;
4. chỉ kích hoạt snapshot sau khi đủ trang, đủ dòng và qua kiểm tra;
5. tạo lịch sử thêm/sửa/xóa so với snapshot trước;
6. dùng snapshot PostgreSQL để dựng báo cáo mà không chờ tải lại MISA.

## Kết quả khởi tạo lại runtime production

Trạng thái `0` kết nối, `0` lần đồng bộ, `0` snapshot ở đầu tài liệu là hiện trạng trước
khi khởi tạo lại. Ngày 2026-07-31 đã chạy thành công luồng thực tế:

- công ty: `NTV`;
- khối dữ liệu: `KETOAN_2026 BCTC demo`;
- bảng dữ liệu: Bảng cân đối tài khoản AMIS thời gian thực;
- kỳ: `2026-01-01` đến `2026-12-31`;
- lần đồng bộ: `0555db28-51ac-4856-a4e7-cc6a0e50349b`;
- snapshot: `e76c03dc-9085-4ce8-8096-d4ad73698cb3`, phiên bản 1;
- kết quả: 2/2 trang, 108 dòng, hoàn tất trong 4 giây;
- bản xem trước: 108 dòng nguồn, 536 ô có số, 0 cảnh báo;
- đã tạo thành công cả file Excel và PDF riêng tư trên Cloud Storage.

Mã truy cập MISA không được ghi vào tài liệu này. Phiên kết nối được mã hóa trong
PostgreSQL và giao diện chỉ hiển thị thời gian còn lại.

Bước `5. Lịch sử điều chỉnh` trên V3 đã được bổ sung khối `Nhật ký đồng bộ` để
hiển thị ngay lần lấy dữ liệu đầu tiên. Phần danh sách dòng thêm/sửa/xóa vẫn tách
riêng ở bên dưới và bắt đầu phát sinh khi có snapshot mới để so với mốc gốc.

Revision production: `cong-van-hanh-web-00096-674`, nhận 100% traffic.
