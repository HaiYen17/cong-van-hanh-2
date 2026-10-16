# Đối chiếu 1:1 C&B / Đánh giá nhân sự

Cập nhật: 28/07/2026.

Nguồn chuẩn chỉ đọc:

- `Hành chính/EvaluationModal.html`
- `Hành chính/EvaluationConfigModal.html`
- `Hành chính/EvaluationRepository.js`

Đích chạy: Next.js + PostgreSQL trong `Hành chính v3`.

## Kết quả kiểm kê giao diện

| Phạm vi | Nguồn GAS | Trang parity | Kết quả |
| --- | ---: | ---: | --- |
| Hàm Đánh giá nhân sự | 87 | 87 | `CÓ` |
| ID control Đánh giá nhân sự | 23 | 23 | `CÓ` |
| Action Đánh giá nhân sự | 8 | 8 | `CÓ` |
| Hàm Cấu hình/giám sát C&B | 430 | 430 | `CÓ` |
| ID control Cấu hình/giám sát C&B | 198 | 198 | `CÓ` |
| Action Cấu hình/giám sát C&B | 42 | 42 | `CÓ` |

Trang parity được dựng trực tiếp từ nguồn GAS bằng
`scripts/build-legacy-parity-pages.mjs`, không viết lại bố cục rút gọn.

## Ma trận chức năng CÓ / THIẾU / KHÁC

| Nhóm | Trạng thái trước sửa | Trạng thái sau sửa |
| --- | --- | --- |
| 8 tab Tổng quan, Cấp bậc, Nguồn, Tiêu chí, Workflow, Loại đánh giá, Kỳ & phân bổ, Theo dõi | `CÓ` UI | `CÓ` |
| Danh sách kỳ và phiếu theo kỳ | `KHÁC`: kỳ có dữ liệu nhưng lọc ra 0 phiếu | `CÓ` |
| Tiến độ từng vai trò Bản thân/Cấp trên/Đồng nghiệp/HR | `THIẾU` do đứt quan hệ ID | `CÓ` |
| Biểu đồ radar tổng hợp, Thực thi, Quản lý, Hoạt động | `THIẾU` do không nối được phiếu với dòng điểm | `CÓ` |
| Biểu đồ xếp hạng đầu công việc từ điểm thấp đến cao | `THIẾU` | `CÓ`: hiển thị toàn bộ đầu việc JD theo thứ tự cần ưu tiên cải thiện đến điểm mạnh |
| Xem bài làm, điểm, nhận xét và câu trả lời theo vai trò | `THIẾU` do không nối được dữ liệu chi tiết | `CÓ` |
| Nút Xem, Trả lại, Chốt kết quả, Xóa phiếu, In PDF | `KHÁC`: có mã UI nhưng không có phiếu để thao tác | `CÓ` |
| Đồng bộ nguồn JD, chuẩn hóa JD cũ, phân loại JD | `KHÁC`: ID UI không trùng khóa PostgreSQL | `CÓ` qua lớp phân giải ID |
| Chọn JD dùng chung với Tuyển dụng | `KHÁC`: bộ chọn đúng nhưng luồng sinh phiếu chưa dùng đầy đủ | `CÓ`: ưu tiên JD mới, chỉ dùng `[BC]` khi không có bản mới |
| Phân bổ đầu việc JD vào phiếu | `THIẾU`: bỏ qua section động, tần suất, quy tắc và trọng số | `CÓ`: nhóm việc, đầu việc, tiêu chí và trọng số được sinh đúng theo cấu hình loại đánh giá |
| Rà soát kỳ, phân bổ nhân sự, sinh phiếu | `KHÁC`: ID kỳ lịch sử và ID PostgreSQL trộn lẫn | `CÓ` |
| Phiếu nhân sự: lọc kỳ/loại/trạng thái, mở phiếu | `KHÁC`: mở được phiếu nhưng thiếu dòng điểm | `CÓ` |
| Tự phản ánh, điểm/nhận xét, câu hỏi kết luận | `THIẾU` dữ liệu liên kết | `CÓ` |
| Lưu nháp, gửi đánh giá, khóa sau gửi | `KHÁC`: payload dùng ID lịch sử nhưng backend chỉ nhận ID PostgreSQL | `CÓ` |
| PDF kết quả từ màn nhân sự và màn C&B | `KHÁC`: URL dùng ID lịch sử nên trả 404 | `CÓ` |

## Nguyên nhân gốc và cách khôi phục

Importer giữ đúng ID lịch sử trong JSON để bảo toàn quan hệ giữa kỳ, phiếu,
workflow, tiêu chí và kết quả. Lớp API cũ lại ghi đè `id` đó bằng khóa bản ghi
PostgreSQL. Do các khóa ngoại trong dữ liệu vẫn là ID lịch sử, UI không thể nối
các collection với nhau và ẩn toàn bộ khối phụ thuộc dữ liệu.

Lớp `record-identity.ts` giờ:

1. Trả ID lịch sử cho giao diện GAS 1:1.
2. Giữ `databaseId` để truy vết khóa PostgreSQL.
3. Chuẩn hóa tham chiếu mới đang dùng khóa PostgreSQL về ID lịch sử khi trả UI.
4. Cho backend nhận cả ID lịch sử, mã record và ID PostgreSQL ở các thao tác ghi.

## Dữ liệu đã kiểm chứng trong PostgreSQL

- 3 kỳ đánh giá.
- 4 phân bổ nhân sự.
- 4 phiếu đánh giá.
- 121 dòng điểm tiêu chí sau khi bổ sung 29 dòng JD cho phiếu C&B còn thiếu.
- 5 câu hỏi kết luận và 5 giá trị trả lời.
- 2 bước workflow.
- 1 kết quả lịch sử đang inactive.

QA tự động xác nhận kỳ `3` nối được 2 phiếu. Phiếu C&B của Lê Anh Thư hiện có
32 dòng điểm: giữ nguyên 3 dòng đã nhập, phân bổ lại phần này về 50%, đồng thời
bổ sung 29 dòng JD thuộc 10 đầu công việc với tổng trọng số 50%. JD áp dụng là
`30042026_JD_NhanVienCB.docx` từ nguồn mới; không dùng bản `[BC]`.

## Big update Nhóm công việc

| Hạng mục | Trước cập nhật | Sau cập nhật |
| --- | --- | --- |
| Nút X của C&B/Tuyển dụng | `KHÁC`: phụ thuộc `history.back()`, có thể không đóng | `CÓ`: luôn về trang Services `/` |
| Tiến độ Bản thân + Quản lý | `KHÁC`: chỉ đếm trạng thái `submitted`, phiếu đủ 30/30 nhưng nháp vẫn hiện 1/2 | `CÓ`: tiến độ đếm vai trò đã điền đủ; trạng thái nháp/chờ gửi vẫn hiển thị riêng |
| Wizard Tiêu chí | 3 bước | 4 bước: Nhóm đánh giá → Nhóm công việc → Tiêu chí → Bộ tiêu chí |
| Danh mục Nhóm công việc | `THIẾU` | `CÓ`: thêm/sửa/ngưng dùng trên PostgreSQL |
| Gán đầu việc JD | Hai nút cứng Tất cả Thực thi/Tất cả Quản lý | Một bộ chọn `Gán tất cả`, nhận mọi Nhóm công việc đang hoạt động |
| Đánh giá tiêu chuẩn | Hai ô cứng Thực thi/Quản lý đặt trước Phân loại công việc | Bảng `Nhóm công việc | Bộ tiêu chí` đặt sau Phân loại công việc, chỉ hiện nhóm đã gán trong JD |
| Sinh phiếu | Dựa vào `activityType` cứng | Ưu tiên mapping Nhóm công việc tùy biến; fallback Thực thi/Quản lý cho dữ liệu cũ |
| Lưu phân loại | Chỉ lưu metadata trên JD | Lưu đồng thời mapping, từng đầu việc, tần suất, tỷ trọng nhóm/việc vào PostgreSQL |

Hai Nhóm công việc `Thực thi` và `Quản lý` đã được seed thành dữ liệu tương thích. Đây không còn là giới hạn của hệ thống; Admin có thể tạo thêm nhóm tùy biến mà không sửa code.
