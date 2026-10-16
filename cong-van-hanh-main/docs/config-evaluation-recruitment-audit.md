# Đối chiếu phục dựng: Cấu hình, Đánh giá nhân sự, Tuyển dụng

Cập nhật: 24/07/2026.

Tài liệu này là checklist bắt buộc trước khi sửa module. Nguồn đối chiếu là
folder GAS chỉ đọc `Hành chính`; đích triển khai là Next.js + PostgreSQL trong
`Hành chính v3`.

Quy ước:

- `CÓ`: bản v3 đã có luồng thật và dữ liệu PostgreSQL.
- `THIẾU`: chưa có route, schema hoặc nghiệp vụ tương ứng.
- `KHÁC`: đã có một phần nhưng chưa đúng UI/hành vi bản GAS.

## Tiến độ PostgreSQL/Cloud Run sau lượt phục dựng 24/07/2026

- `CÓ`: schema và migration cho cấu hình dùng chung, liên kết nhiều MNV,
  thông báo/sự kiện mở rộng, toàn bộ record đánh giá và hệ thực thể tuyển dụng.
- `CÓ`: importer XLSX idempotent; dữ liệu nguồn đã được nạp vào PostgreSQL:
  4.734 record đánh giá, 5.302 hồ sơ theo dõi, 113 campaign, 80 yêu cầu tuyển,
  87 offer, 7 phiên/phân công/phiếu chấm, 179 snapshot kết quả và 22.798 record
  cấu hình/cơ cấu/chi phí tuyển dụng.
- `CÓ`: route Cloud Run cho Setup tài sản, Setup ứng dụng, Biểu mẫu,
  Bộ nguyên tắc AI, Cấu hình đánh giá, Đánh giá nhân sự, Quản lý Ứng viên,
  Đánh giá Ứng viên và Kết quả đánh giá.
- `CÓ`: Đánh giá nhân sự và Đánh giá ứng viên đã dùng chung một bộ phân giải
  JD. Với cùng vị trí, JD không có tiền tố `[BC]` luôn được ưu tiên; `[BC]` chỉ
  là dự phòng, còn JD trong file tính điểm cũ là lớp dự phòng cuối.
- `CÓ`: luồng Offer được khóa bằng feature flag theo yêu cầu; không nạp thêm
  hoặc hiển thị dữ liệu Offer, nhưng giữ nguyên dữ liệu lịch sử để mở lại sau.
- `CÓ`: đúng 8 tab Cấu hình đánh giá và 9 view Quản lý Ứng viên; dashboard đã
  đăng ký nhóm Tuyển dụng và nối toàn bộ module mới.
- `KHÁC`: các route Setup tài sản/ứng dụng/biểu mẫu/AI hiện là console dữ liệu
  PostgreSQL có phân tab; chưa phục dựng đủ form ghi, upload Drive và worker.
- `KHÁC`: Đánh giá nhân sự/Tuyển dụng đã có dữ liệu liên kết và màn hình nghiệp
  vụ, nhưng các luồng ghi như sinh phiếu, lưu nháp/chấm, chuyển pipeline,
  phân công, công bố/thu hồi link vẫn phải làm tiếp.
- Deployment đang kiểm chứng: Cloud Run revision `cong-van-hanh-web-00007-97s`.

## 1. Toàn bộ module Cấu hình

| Module GAS | Nguồn UI/backend | Trạng thái v3 | Đối chiếu |
| --- | --- | --- | --- |
| Cấu hình | `ConfigModal.html`, `AppScripts.html`, `Code.js` | Có Công ty, nguồn nhân sự, loại văn bản, sự kiện | `KHÁC`: Công ty thiếu địa chỉ cũ/văn phòng gửi thư; Nhân sự thiếu liên kết nhiều MNV; Sự kiện thiếu một số kênh, kiểu popup, ảnh, giao việc; Loại văn bản đã đủ |
| Setup tài sản | `AssetSetupModal.html`, `AssetSetupRepository.js`, `Code.js` | Chưa có route/schema riêng | `THIẾU` |
| Setup ứng dụng | `AppSetupModal.html`, `AppSetupRepository.js`, `Code.js` | Mới có bảng tag dùng chung | `THIẾU` ứng dụng, phiên bản, file/logo/hướng dẫn |
| Cấu hình đánh giá | `EvaluationConfigModal.html`, `EvaluationRepository.js` | Chưa có route/schema | `THIẾU` |
| Cấu hình Biểu mẫu | `TemplateModule.html`, `Code.js`, `AppScripts.html` | Chưa có route/schema | `THIẾU` |
| Bộ nguyên tắc AI | `ReviewConfigModal.html`, `Code.js` | Chưa có route/schema | `THIẾU` |
| Cấu hình Báo cáo Kế toán | `AccountingConfigModal.html`, `AccountingPortalBridge.js` | Đã phục dựng và đã nạp dữ liệu | `CÓ` |

### 1.1 Cấu hình / Công ty

Trường và hành vi GAS:

- Công ty, Viết tắt, Tên chi nhánh, Mã số thuế, ĐKKD, Người đại diện,
  Địa chỉ mới, Kích hoạt.
- Văn phòng Gửi thư; ưu tiên địa chỉ Mới/Cũ.
- Địa chỉ cũ gồm Tỉnh/Thành, Quận/Huyện, Phường/Xã, số nhà/đường.
- Nếu nhập một phần địa chỉ cũ thì báo lỗi; muốn ưu tiên Cũ phải có đủ địa chỉ.
- Tạo/cập nhật, làm mới, danh sách, sửa, bật/tắt.

V3 hiện tại:

- `CÓ`: dữ liệu pháp nhân cơ bản, tạo/sửa, trạng thái, audit.
- `THIẾU`: 9 trường địa chỉ cũ/văn phòng/ưu tiên, validation liên quan.
- `KHÁC`: form và danh sách chưa theo bố cục hai cột của `ConfigModal`.

### 1.2 Cấu hình / Nhân sự

Trường và hành vi GAS:

- Công ty đại diện nguồn, Link Base HRM/Google Sheet, tên sheet, dòng header.
- Đọc link rồi map 15 trường nhân sự; một trường có thể nhận nhiều cột nguồn.
- Chế độ đồng bộ; đồng bộ ngay; lịch sử kết quả.
- Liên kết tài khoản nhân sự: tối thiểu 2 MNV, một MNV quyền chính, tên/ghi chú,
  mỗi MNV chỉ thuộc một nhóm đang hoạt động.

V3 hiện tại:

- `CÓ`: nguồn nhân sự, mapping, sync thủ công/lịch.
- `THIẾU`: liên kết tài khoản nhân sự nhiều MNV.
- `KHÁC`: nguồn nhân sự đang tách route, chưa cùng tab/bố cục GAS.

### 1.3 Cấu hình / Loại văn bản

- Tên, Có lấy số, Điều kiện, Loại khai báo, Vòng lặp, STT bắt đầu, Giới hạn.
- Builder quy cách đánh số kéo-thả, token tự nhập, preview.
- Sửa, bật/tắt, xóa kèm loại hồ sơ thay thế, đồng bộ lại.

V3 hiện tại: `CÓ`.

### 1.4 Cấu hình / Sự kiện

- Loại: Thông điệp / Sự kiện / Thông báo.
- Bộ tương tác, bắt đầu/kết thúc, lưu phản hồi, ưu tiên, tiêu đề, địa điểm,
  ghi chú có toolbar định dạng.
- Kênh hiển thị: WebApp / Notifier / cả hai.
- Kiểu popup: góc phải, chính diện, warning cố định, ảnh đứng full,
  thiệp ngang full, ảnh tự do.
- Chế độ nội dung: đủ, ẩn nội dung, ẩn tiêu đề, chỉ ảnh.
- Mức độ, chính sách đóng, tự tắt, giờ nhắc, bắt buộc xác nhận, URL đích.
- Đối tượng: tất cả / công ty / phòng ban / MNV; bỏ qua tạm ẩn.
- Giao việc kèm thông báo: tên việc, đầu ra, bối cảnh, deadline/reminder/targets.
- Nhiều ảnh có sắp xếp; thumbnail riêng cho sự kiện.
- Bộ tương tác dạng cảm xúc hoặc tag; tạo/sửa/xóa.

V3 hiện tại:

- `CÓ`: loại, nội dung, thời gian, ưu tiên, reaction, mức độ, ba kiểu popup,
  đóng/tự tắt/xác nhận, URL, giờ nhắc, phạm vi nhận.
- `THIẾU`: kênh hiển thị, bốn chế độ nội dung, ba kiểu popup ảnh,
  bỏ qua tạm ẩn, giao việc, nhiều ảnh, thumbnail, upload file.
- `KHÁC`: toolbar nội dung và bộ chọn mục tiêu chưa bám hoàn toàn bản cũ.

### 1.5 Setup tài sản

Tab GAS:

1. Tùy chọn CCDC.
2. Hàng đợi.
3. CCDC/tài sản.
4. Văn phòng phẩm.
5. Đồng phục.

Nghiệp vụ:

- Cấu hình folder tổng/folder ảnh cho ba danh mục.
- Worker Python loại nền; test, lưu, xóa; hàng đợi retry/progress.
- Gemini phân tích hóa đơn; chọn hóa đơn, sinh nháp tài sản.
- Danh mục tùy chọn: loại CCDC, công năng/khu vực, đặc điểm/hình dạng,
  cụm từ đệm, chất liệu, màu sắc.
- Tài sản: nhiều bộ mô tả, kích thước, giá trị, bảo hành, khấu hao, ảnh.
- VPP: tên, màu, dày/mỏng, đóng gói, đơn vị, ảnh.
- Đồng phục: tên, size Nam/Nữ, ảnh.
- Lưu, sửa, xóa có xác nhận, refresh, empty state, mobile.

V3 hiện tại: `THIẾU`.

### 1.6 Setup ứng dụng

Tab GAS:

1. Kho & tag.
2. Tạo ứng dụng.
3. Danh sách.

Nghiệp vụ:

- Folder kho ứng dụng; bộ tag.
- Tên ứng dụng, loại tải mặc định (download/copy command), chức năng.
- Logo bắt buộc; hướng dẫn có toolbar; nhiều ảnh hướng dẫn.
- Nhiều phiên bản, mỗi phiên bản chứa file tải hoặc lệnh.
- Upload Drive trực tiếp, tạo/sửa/xóa, danh sách/history.

V3 hiện tại: `THIẾU` trừ bảng tag.

### 1.7 Cấu hình Biểu mẫu

- Nạp link hoặc file Word/Excel; quét placeholder.
- Danh sách trường scalar/table; thứ tự; input type; dataset binding;
  linkage công ty; công thức; token formula.
- Lưu định nghĩa, lịch sử phiên bản, tìm kiếm.
- Workspace nhập liệu theo mẫu; live preview/PDF draft; tạo file đầu ra.

V3 hiện tại: `THIẾU`.

### 1.8 Bộ nguyên tắc AI

Tab GAS:

1. Nạp nhanh.
2. Nhóm nguyên tắc.
3. Nguyên tắc rà soát.

Nghiệp vụ:

- Tải Excel mẫu, sao chép prompt ChatGPT, nạp file đã điền.
- Nhóm: tên, trạng thái, thứ tự, mô tả.
- Nguyên tắc: nhóm, tên, mức xanh/cam/đỏ, trạng thái, phạm vi,
  pháp nhân, loại hồ sơ, nội dung kiểm tra, hướng xử lý.
- Bộ lọc; xem/copy prompt cuối cùng gửi AI.

V3 hiện tại: `THIẾU`.

## 2. Đánh giá nhân sự

### 2.1 Cấu hình đánh giá

Tab GAS:

1. Tổng quan.
2. Cấp bậc.
3. Nguồn.
4. Tiêu chí.
5. Workflow.
6. Loại đánh giá.
7. Kỳ & phân bổ.
8. Theo dõi.

Các thực thể phải giữ:

- Cấp bậc.
- Nguồn đánh giá, mục nguồn, Folder JD, tài liệu JD, phiên bản JD,
  nhóm công việc, hoạt động, quy tắc phân loại, job phân loại.
- Nhóm điểm, tiêu chí, bộ tiêu chí, dòng bộ tiêu chí.
- Workflow và bước workflow.
- Loại đánh giá, nội dung, câu hỏi kết luận, role weight/completion mode.
- Loại kỳ; kỳ; thành viên; readiness; job sinh phiếu.
- Phiếu đánh giá; điểm tiêu chí; giá trị kết luận; kết quả cuối.

Validation/hành vi đặc biệt:

- Tổng tỷ trọng bộ tiêu chí và phần nội dung phải đúng 100%.
- Workflow giữ thứ tự, tuần tự/song song, đúng vai trò bắt buộc.
- Đồng bộ JD theo lịch, phát hiện file cũ, dọn trùng, parse Docs/DOCX.
- Phân loại JD chạy nền; sinh phiếu chạy hàng đợi.
- Nhắc người còn thiếu lượt chấm; trả phiếu; chốt; in PDF.

V3 hiện tại: `THIẾU` toàn bộ.

### 2.2 Phiếu Đánh giá nhân sự

- Danh sách phiếu được giao; lọc theo loại/kỳ/trạng thái.
- Nội dung phiếu theo snapshot cấu hình và role của người chấm.
- Điểm, nhận xét/bằng chứng, câu hỏi ngoài điểm số, nhận xét chung.
- Lưu nháp, gửi đánh giá, khóa sau gửi; trả về/chốt theo quyền.

V3 hiện tại: `THIẾU`.

## 3. Tuyển dụng

### 3.1 Quản lý Ứng viên

Điều hướng GAS:

1. Việc hôm nay.
2. Hành trình ứng viên.
3. Nhu cầu tuyển.
4. Lịch & phân công.
5. Offer & nhận việc.
6. Tiếp nhận hồ sơ.
7. Kiểm tra dữ liệu.
8. Công cụ vận hành.
9. Tiêu chí chấm.

Nghiệp vụ:

- Dashboard việc ưu tiên, lịch gần nhất, phiếu thiếu.
- Pipeline 8 bước: sàng lọc CV, sơ vấn, bài đánh giá, V1, V2, Offer,
  nhận việc, đóng.
- Campaign theo công ty/cơ cấu/vị trí/nguồn/ngày; thêm nguồn/cập nhật.
- Intake CSV/Excel/manual vào Work Flow; mapping nguồn; promote/xóa.
- Chất lượng dữ liệu: trùng SĐT, mã ứng viên lỗi, thiếu liên hệ/vị trí/CV.
- Hồ sơ chi tiết: gọi, mở CV, chuyển bước, deadline, owner, lịch sử,
  điều chuyển nhu cầu.
- Lịch/phân công theo vai trò văn hóa/chuyên môn/cân bằng/quyết định.
- Offer: tạo tài liệu, theo dõi nhận việc.
- Tiêu chí chấm: nhóm, tiêu chí, bộ 100%, publish, map theo vòng/phạm vi.

V3 hiện tại: `THIẾU`.

### 3.2 Đánh giá Ứng viên

- Queue theo người được phân công.
- Sơ vấn/V1/V2; gọi ứng viên; mở CV.
- JD: nhóm công việc, năng lực chuyên môn, level 0-5 + bonus, điểm 0-10.
- HEXACO: radar, nhóm nổi trội/rủi ro.
- Giá trị văn hóa: chip trạng thái 0-3, điểm, ghi chú.
- Kết luận: đạt/cân nhắc/không đạt, nhận xét tổng hợp.
- Lưu nháp, hoàn tất, revision; phiếu đã nộp bị khóa.

V3 hiện tại: `THIẾU`.

### 3.3 Xem kết quả đánh giá

- Tổng hợp đủ ba vòng; version theo vòng; phiếu từng người.
- HEXACO; lịch sử xử lý; in báo cáo.
- Công bố có token, trạng thái/lời nhắn/điểm mạnh/gợi ý phát triển,
  tùy chọn hiện điểm, hạn xem; cập nhật hoặc thu hồi link.

V3 hiện tại: `THIẾU`.

## 4. Nguồn dữ liệu đã xác minh

### Spreadsheet Hành chính chính

- `09_Cấu hình nền`: 92 cột; chứa thông điệp, ứng dụng, review và
  toàn bộ `Evaluation Record Type`.
- `10_Setup tài sản`, `11_Danh mục tài sản`, `12_Văn phòng phẩm`,
  `13_Đồng phục`.
- `03_Biểu mẫu`, `05_Biểu mẫu lịch sử`.
- `AI_ReviewHopDong`.
- `ĐG_JD_Tài liệu`, `ĐG_JD_Nhóm công việc`, `ĐG_JD_Hoạt động`.

### Spreadsheet Tuyển dụng

ID `1HM3rVU_tajRsqaPnRVrIZJhRx_W7JlKlkCw7MumloKc`:

- Base, MasterSheet, Định nghĩa Nguồn, Chi phí, Work Flow, ORDER TD.
- CFG_OrgUnits, CFG_OrgAliases.
- Theo dõi Tuyển dụng.
- Audit_Available_Order, Audit_OrgChange, Audit_CandidateAction.
- OFFER, OFFER chuyển, REF_STATUS, Nháp.

### Spreadsheet kết quả/Portal tuyển dụng

ID `1Tfu17uZKxWCh0un7wB4QdJTM_VBfTTolBE5GmFLLtFI`:

- Kết quả Ứng viên.
- Portal_HanhTrinh, Portal_PhongVan, Portal_PhanCong, Portal_PhieuCham,
  Portal_DiemCham, Portal_NhatKy, Portal_CongBo, Portal_DanhGia.
- SoVan_Logs, HEXACO_Logs.

### Nguồn chưa đọc được

- Scoring cũ `1hx2CsL5ebZZSWkH4n_RVNulGYWtsVG57ZmMX8ELmT_g`: 403.
- Offer generator cũ `1Yai8tDO_TTZ034rAGdTBKFL7Pkr9RzbObPnRbFw6LcY`: 403.

Hai nguồn này không chặn schema và UI lõi. Khi được chia sẻ, importer sẽ nối
thêm dữ liệu lịch sử/Offer mà không thay đổi hợp đồng UI.
