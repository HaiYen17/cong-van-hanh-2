# Đối chiếu 1:1 đánh giá ứng viên

Ngày kiểm tra: 2026-08-04.

Nguồn đối chiếu chính:

- `Kết quả Ứng viên/sovan_eval.html`, `hexaco_radar.html`, `TechScoreModal.html`.
- `Kết quả Ứng viên/SoVan.js`, `TechEval.js`, `radar_api.js`.
- `Hành chính/CandidateAssessmentModal.html`, `CandidateRecruitmentRepository.js`, `RecruitmentHrRepository.js`, `RecruitmentLegacyBridge.js`.
- V3: `public/legacy/recruitment-assessment.html`, `src/lib/recruitment/runtime.ts`, schema và dữ liệu PostgreSQL.

## Luồng theo vòng

| Nội dung | Bản gốc | V3 trước khi sửa | Trạng thái |
|---|---|---|---|
| Sơ vấn | JD nhanh → Văn hóa → Kết luận; không HEXACO | Chỉ sinh JD nhanh, bỏ Văn hóa | THIẾU |
| Vòng 1 | HEXACO → JD → Văn hóa → Kết luận | Khung thứ tự có, dữ liệu HEXACO/Văn hóa sai contract | KHÁC |
| Vòng 2 | Như V1, có so sánh Sơ vấn/V1 và cảnh báo lệch | Chỉ so điểm tổng phiếu PostgreSQL | THIẾU |
| Admin Sơ vấn | Được chọn mọi hồ sơ không cần phân công | Queue chỉ có phiếu/phân công | THIẾU |

## JD và bộ tiêu chí

| Nội dung | Bản gốc | V3 trước khi sửa | Trạng thái |
|---|---|---|---|
| JD mới → `[BC]` → JD cũ | Có fallback | Resolver V3 đã có | CÓ |
| Nhóm JD và từng đầu việc | Có | Adapter có | CÓ |
| Nhấp đúp thước hỗ trợ | A/B/C, công thức 0–10 | UI legacy V3 đã có | CÓ |
| Gạt JD → tiêu chí | JD mặc định, giữ riêng Văn hóa | UI có; taxonomy DB chưa khớp resolver | THIẾU DỮ LIỆU |

## Giá trị văn hóa

| Nội dung | Bản gốc | V3 trước khi sửa | Trạng thái |
|---|---|---|---|
| 5 giá trị GT1–GT5 | Tên chuẩn của công ty | 5 tên chung chung hard-code | KHÁC |
| 14 thẻ hành vi | Có mã, nhãn, thứ tự | Adapter trả `chips: []` | THIẾU |
| Trạng thái thẻ | 0 → 1 → 2 → 3 → 0, có màu | UI đã có, không có data | THIẾU DỮ LIỆU |
| Điểm giá trị | Slider/number 0–10 | Backend chỉ nhận 0–3 và quy đổi sai | LỖI |
| Ghi chú/minh chứng | Có | UI có | CÓ |
| Lưu state thẻ | JSON trong từng item | Cột `meta` có thể lưu nhưng adapter chưa cấp data | THIẾU |

Nguồn GT chuẩn:

1. GT1 — Làm chủ tương lai: Tập trung vào giải pháp; Chủ động với lời cam kết; Nhận trách nhiệm.
2. GT2 — Thắng không kiêu – Bại không nản: Kiên cường; Không kiêu ngạo.
3. GT3 — Chân thành là gốc rễ của mối quan hệ tốt đẹp: Nói ra; Không xuyên tạc; Tôn trọng sự thật.
4. GT4 — Thấu hiểu – Chia sẻ – Cùng nhau phát triển: Đặt mình vào vị trí người khác; Vì lợi ích chung; Hướng tới sự hài lòng.
5. GT5 — Cầu thị – Học hỏi – Để tiến lên: Lắng nghe; Học để hành; Sáng tạo đổi mới.

## HEXACO

| Nội dung | Bản gốc | V3 trước khi sửa | Trạng thái |
|---|---|---|---|
| 6 trục | H, S, X, A, C, O | Payload thô; React cũn chưa mount dùng nhầm E | KHÁC |
| Tỷ lệ phần trăm | Theo ngưỡng trong cấu hình | Chưa chuẩn hóa | THIẾU |
| Nhóm nổi trội/cần lưu ý | Tên nhóm, phân tích, chi tiết, rủi ro, nhu cầu, vai trò | 48 profile đã có trong PostgreSQL nhưng runtime không dùng | THIẾU |
| Radar GT tự đánh giá | 5 trục GT1–GT5 | Payload có điểm nhưng chưa render | THIẾU |

## Lịch sử và dữ liệu cũ

| Nội dung | Bản gốc | V3 trước khi sửa | Trạng thái |
|---|---|---|---|
| Phiên bản PostgreSQL mới | Khóa sau nộp, chấm lại tạo bản mới | Có | CÓ |
| JD/GT cũ | `techEval`, `gtEval` | Đã import vào snapshot nhưng adapter trả `legacySaved: {}` | THIẾU |
| History JD/GT cũ | Hai history riêng, có vòng/người/thời gian/lý do | Snapshot có nhưng runtime bỏ qua | THIẾU |
| So sánh V2 | So V1 theo từng dòng, badge chênh lệch; cảnh báo >2 | Chỉ có cảnh báo điểm tổng | THIẾU |

Hiện trạng PostgreSQL khi audit: 7 scorecard trắng, 0 score item; snapshot có 84 HEXACO, 84 candidate-result, 7 assessment và 4 Sơ vấn. Dữ liệu cũ phải được phục hồi qua adapter hoặc materialize thành phiên bản, không được bỏ qua.

## Thứ tự triển khai

1. Nguồn GT PostgreSQL + 5 GT/14 chip + thang điểm 0–10 cho cả ba vòng.
2. Parse snapshot và khôi phục JD/GT/lịch sử cũ.
3. Chuẩn hóa HEXACO và nối 48 profile tính cách.
4. Selector/lịch sử riêng JD–GT, so sánh từng dòng và cảnh báo lệch.
5. Sửa resolver bộ tiêu chí theo taxonomy PostgreSQL thực tế.
6. Tối ưu queue và cho Admin mở Sơ vấn trực tiếp từ hồ sơ chưa phân công.

## Kết quả sau khi khôi phục

- Sơ vấn giữ luồng nhanh theo nhóm JD, có 5 Giá trị văn hóa và Admin HR được mở hồ sơ chưa phân công.
- Vòng 1 và Vòng 2 cùng nằm trên một trang theo thứ tự HEXACO → JD → Giá trị văn hóa → Kết luận; có đối chiếu từng dòng với vòng trước.
- JD là chế độ mặc định. Khi gạt sang tiêu chí, hệ thống ưu tiên cấu hình tuyển dụng đã gán; nếu chưa gán thì kế thừa bộ tiêu chí và trọng số đang được áp dụng thật trong Đánh giá nhân sự.
- Dữ liệu cũ `techEval`, `gtEval` và lịch sử được dựng lại thành các phiên bản chỉ đọc; thao tác chấm lại tạo phiên bản PostgreSQL mới và không ghi đè bản cũ.
- HEXACO dùng đúng 6 trục H/S/X/A/C/O, bảng tên nhóm, phân tích, rủi ro, nhu cầu, vai trò và hồ sơ 5 Giá trị cốt lõi của ứng viên.
- Báo cáo kết quả cho phép chọn phiên bản riêng của từng vòng, hiển thị thẻ Văn hóa, HEXACO và dữ liệu chấm cũ thật.
- Bản in có layout A4 riêng: bỏ sidebar/modal, mở toàn bộ phiếu khi in, dàn một cột toàn chiều rộng, giữ màu và tránh cắt đôi dòng/chip/card.
- Danh sách chỉ tải dữ liệu nhẹ; chi tiết phiếu, lịch sử và báo cáo được tải khi người dùng chọn hồ sơ, có cache ngắn hạn cho lần quay lại.

## Kiểm tra bắt buộc đã qua

- `npx tsc --noEmit`.
- ESLint cho runtime và bộ chuyển đổi tuyển dụng.
- 38 khối script trong 12 trang legacy V3 parse thành công.
- 4 bài kiểm tra nghiệp vụ: 5 GT/14 thẻ, HEXACO, lịch sử JD–Văn hóa và điểm trung bình trọng số.
- `next build` production hoàn tất 36/36 trang.

## Kiểm tra dữ liệu thật và triển khai 2026-08-05

- Kiểm tra runtime bằng tài khoản Admin HR trên PostgreSQL: danh sách chấm tải 1,4–1,5 giây; trung tâm kết quả 0,6–0,9 giây; có 89 ứng viên đã có dữ liệu kết quả.
- Hồ sơ Phan Hồng Quân trả đúng JD 4 nhóm/7 đầu việc, bộ dùng chung 3 tiêu chí, 5 Giá trị văn hóa/14 thẻ, HEXACO đủ 6 trục và tên hai nhóm tính cách.
- Phát hiện và sửa hai lỗi mở phiếu: khóa vòng chuẩn `round2` từng bị đọc thành Vòng 1; `scorecardId` rỗng từng có thể khớp nhầm phiếu rỗng đầu tiên của ứng viên khác.
- Sau sửa, Vòng 2 của hồ sơ kiểm thử đọc đúng phiên bản cũ V1 = 4,67 và V2 = 3,67; khối so sánh nhận cả phiếu Vòng 1 PostgreSQL và phiên bản Vòng 1 cũ.
- Dữ liệu draft rỗng phát sinh riêng trong QA đã được kiểm tra điều kiện và dọn khỏi PostgreSQL.
- Cloud Build `3070c847-7374-4636-857c-f9b12a63bd74` thành công; image `sha256:26f9911ae34f4dd73b7e066b90164cef2e12e1f46ff6eacb37ba9afcab3a308c`.
- Cloud Run revision `cong-van-hanh-web-00122-h2p` đang Ready và nhận 100% traffic; `/login` trả HTTP 200.
