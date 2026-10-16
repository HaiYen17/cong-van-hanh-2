# B09-DN — Bản đồ nghiệp vụ thuyết minh (Phase 2)

## Mục tiêu

Phase 2 biến khuôn Excel B09-DN thành cấu hình nghiệp vụ có thể kiểm tra, nhưng không lấy các số mẫu trong workbook làm số vận hành. Mỗi khoản mục lưu riêng:

- nguồn dữ liệu cần dùng;
- kỳ trình bày;
- chiều chi tiết cần bung;
- nguyên tắc tính và đối chiếu;
- mức tự động hóa;
- dòng báo cáo chính phải cộng khớp;
- nội dung kế toán bắt buộc xác nhận.

Nguyên tắc kiến trúc: thuyết minh **kế thừa công thức của dòng báo cáo chính**, không tạo một bộ công thức tài khoản song song. B09 chỉ bung chi tiết và cộng ngược về dòng nguồn. Vì vậy khi công thức báo cáo chính thay đổi, thuyết minh không bị lệch riêng.

## Kết quả đối chiếu file B09 thực tế

- 10 phần bố cục, 55 khoản mục nghiệp vụ.
- 13 khoản có thể tự động lấy số.
- 36 khoản hệ thống chuẩn bị số/chi tiết, kế toán duyệt.
- 6 phần chính sách, giải trình hoặc chữ ký phải được người có trách nhiệm nhập/duyệt.
- 62 đường liên kết với cấu hình báo cáo hiện hành; 62/62 tìm thấy đúng dòng đích.
- 1 trường hợp tiểu mục hợp lệ: VI.6 là Chi phí tài chính; dòng 24 “Chi phí đi vay” có thể dùng mã chi tiết VI.6.1 mà không bị coi là mâu thuẫn.

## Thứ tự ưu tiên nguồn

1. Dòng báo cáo chính và công thức tài khoản đã được phê duyệt.
2. Bảng cân đối tài khoản để xác nhận số dư đầu kỳ/cuối kỳ.
3. Sổ nhật ký chung để bung phát sinh, đối tượng, hợp đồng và luồng tăng/giảm.
4. Danh mục/hồ sơ công ty để lấy phân loại, tài sản, đối tượng, kỳ và đơn vị tiền tệ.
5. Bảng phụ trợ chuyên biệt (thuế, tài sản cố định, công nợ, dự phòng...).
6. Nội dung kế toán nhập tay có nguồn chứng minh và lịch sử duyệt.

Không dùng số trong Excel mẫu làm công thức, không dùng `item_id` MISA làm khóa nghiệp vụ lâu dài. Khóa ổn định là mã B09 như `V.7`, `VI.6`, `VII.3`.

## Bản đồ sang Báo cáo tình hình tài chính

| B09 | Nội dung | Dòng báo cáo phải cộng khớp |
|---|---|---|
| V.1 | Tiền và tương đương tiền | 110 |
| V.2 | Đầu tư tài chính | 120, 260 |
| V.3 | Phải thu khách hàng | 131, 211 |
| V.4 | Phải thu khác | 135, 215 |
| V.5 | Tài sản thiếu chờ xử lý | 137 |
| V.6 | Nợ xấu/dự phòng khó đòi | 136, 216 |
| V.7 | Hàng tồn kho | 140 |
| V.8 | Tài sản dở dang dài hạn | 250 |
| V.9 | TSCĐ hữu hình | 221 |
| V.10 | TSCĐ vô hình | 227 |
| V.11 | TSCĐ thuê tài chính | 224 |
| V.12 | Tài sản sinh học | 150, 230 |
| V.13 | Bất động sản đầu tư | 240 |
| V.14 | Chi phí chờ phân bổ | 161, 271 |
| V.15 | Tài sản khác | 165, 274 |
| V.16 | Vay và nợ thuê tài chính | 321, 339 |
| V.17 | Phải trả người bán | 311, 331 |
| V.18 | Phải trả cổ tức, lợi nhuận | 313 |
| V.19 | Thuế phải nộp | 314, 333 |
| V.20 | Chi phí phải trả | 316, 334 |
| V.21 | Phải trả khác | 320, 338 |
| V.22 | Doanh thu chờ phân bổ | 319, 337 |
| V.23 | Trái phiếu chuyển đổi | 340 |
| V.24 | Cổ phiếu ưu đãi phân loại là nợ | 341 |
| V.25 | Dự phòng phải trả | 322, 343 |
| V.26 | Thuế thu nhập hoãn lại | 272, 342 |
| V.27 | Vốn chủ sở hữu | 400 |
| V.28 | Chênh lệch đánh giá lại tài sản | 416 |
| V.29 | Chênh lệch tỷ giá | 417 |
| V.30–V.32 | Ngoài bảng, tài sản bị hạn chế, giải trình khác | Trình bày độc lập; phải có chứng từ/nguồn duyệt |

VII.1 là một **tập con** của dòng 110 (tiền bị hạn chế sử dụng), chỉ dùng để kiểm tra và trình bày, không được cộng thêm lần nữa vào tiền.

## Bản đồ sang Báo cáo kết quả hoạt động kinh doanh

| B09 | Nội dung | Dòng báo cáo phải cộng khớp |
|---|---|---|
| VI.1 | Doanh thu bán hàng và cung cấp dịch vụ | 01 |
| VI.2 | Các khoản giảm trừ doanh thu | 02 |
| VI.3 | Giá vốn hàng bán | 11 |
| VI.4 | Lãi/lỗ bán, thanh lý bất động sản đầu tư | 21 |
| VI.5 | Doanh thu hoạt động tài chính | 22 |
| VI.6 | Chi phí tài chính | 23; tiểu mục chi phí đi vay đối chiếu dòng 24 |
| VI.7 | Thu nhập khác | 31 |
| VI.8 | Chi phí khác | 32 |
| VI.9 | Chi phí bán hàng và quản lý doanh nghiệp | 25, 26 |
| VI.10 | Chi phí sản xuất kinh doanh theo yếu tố | Phân tích chéo từ sổ; không cộng trực tiếp vào một dòng KQKD |
| VI.11 | Chi phí thuế TNDN | 51, 52 |

## Bản đồ sang Báo cáo lưu chuyển tiền tệ

| B09 | Nội dung | Cách đối chiếu |
|---|---|---|
| VII.1 | Tiền bị hạn chế sử dụng | Là tập con của tiền dòng 110 trên BCTHTC |
| VII.2 | Giao dịch không bằng tiền | Quét sổ, loại khỏi dòng tiền kỳ này, kế toán xác nhận ảnh hưởng tương lai |
| VII.3 | Tiền đi vay thực thu | Khớp dòng 33 ở cả LCTT trực tiếp và gián tiếp |
| VII.4 | Tiền thực trả gốc vay | Khớp dòng 34 ở cả LCTT trực tiếp và gián tiếp; không trộn lãi vay/nợ thuê tài chính |
| VII.5 | Mua/thanh lý công ty con | Lập cầu nối giá mua, tiền trả/nhận, tiền kèm theo và tài sản/nợ tiếp nhận |

## Các phần không được tự động hóa mù

- I–II: hệ thống lấy hồ sơ và kỳ dữ liệu, kế toán xác nhận thay đổi trong năm.
- III–IV: chính sách/chế độ kế toán phải dùng nội dung đã được phê duyệt theo phiên bản.
- VIII: thông tin trọng yếu khác phải có nguồn và người duyệt.
- IX: người ký, thẩm quyền, ngày ký và trạng thái khóa báo cáo.
- V.26, VI.11: thuế hoãn lại/thuế TNDN cần bảng tính thuế chuyên biệt, không suy trực tiếp chỉ từ số dư tài khoản.
- Các roll-forward tài sản, vốn, dự phòng và vay nợ phải kiểm tra công thức: đầu kỳ + tăng - giảm ± điều chỉnh = cuối kỳ.

## Ranh giới Phase 2 và bước sinh số tiếp theo

Phase 2 đã hoàn thành cấu trúc lưu PostgreSQL, nhận diện workbook, bản đồ nguồn, kỳ, chiều chi tiết, liên kết báo cáo và giao diện rà soát. Bộ sinh số kế thừa dòng báo cáo, bằng chứng và kiểm tra cộng ngược đã được triển khai trong Phase 3; xem `accounting-disclosure-phase3-engine.md`. Các chiến lược bảng phụ trợ như `ASSET_ROLL_FORWARD`, `TAX_RECONCILIATION`, `NON_CASH_TRANSACTION_SCAN` tiếp tục giữ trạng thái cần kế toán duyệt cho đến khi có luồng dữ liệu chi tiết tương ứng.
