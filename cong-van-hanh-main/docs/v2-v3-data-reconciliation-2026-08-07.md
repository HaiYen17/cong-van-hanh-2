# Đối soát dữ liệu V2 → V3 ngày 07/08/2026

## Phạm vi và nguyên tắc

- Nguồn chính: Google Sheet `Hành chính ver 2`, ID `1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg`.
- Nguồn tuyển dụng: các workbook Theo dõi tuyển dụng, Kết quả ứng viên và Chấm điểm đang được V3 đồng bộ.
- Đích: PostgreSQL của `Hành chính v3`.
- Google Sheets chỉ được đọc. Mọi dữ liệu mới được ghi vào PostgreSQL V3.
- Dữ liệu V3 phát sinh riêng được giữ nguyên. Các importer bù lịch sử chỉ thêm phần còn thiếu và có `ExternalIdMap`/`MigrationRun` để chạy lặp không tạo trùng.
- Không sao chép mật khẩu hoặc secret từ V2. File cũ vẫn nằm trên Drive; V3 lưu metadata và liên kết theo Drive ID.

## Kết quả đối soát khóa nghiệp vụ

| Nhóm dữ liệu | Khóa nguồn phân biệt | Đã khớp | Còn thiếu |
| --- | --- | ---: | ---: |
| Nhân sự | Mã nhân sự | 237/237 | 0 |
| Công ty | Tên rút gọn | 5/5 | 0 |
| Loại văn bản | Tên loại văn bản | 36/36 | 0 |
| Định nghĩa biểu mẫu | Mã biểu mẫu | 1/1 | 0 |
| Lịch sử biểu mẫu | Mã lịch sử | 5/5 | 0 |
| Hồ sơ pháp lý | Registry ID | 235/235 | 0 |
| Sổ văn bản | Số văn bản | 320/320 | 0 |
| Bộ tag/bộ tương tác | Tag ID hoặc Bộ tương tác ID | 5/5 | 0 |
| Bản tin/Thông báo | Tiêu đề + loại nội dung | 26/26 | 0 |
| Đánh giá nhân sự/JD | Legacy Evaluation ID | 4.760/4.760 | 0 |
| Setup tài sản | Record ID | 16/16 | 0 |
| Danh mục tài sản | Asset ID | 2/2 | 0 |
| Danh mục SKU kho | Mã SKU | 1.361/1.361 | 0 |
| Nhắc việc | Task ID | 19/19 | 0 |
| Chat Thư ký Mèo | Message ID | 5/5 | 0 |
| RFID hiện hành | EPC | 33/33 | 0 |
| Phiên kiểm kê RFID | Record ID | 1/1 | 0 |
| Gửi thư | Record ID | 20/20 | 0 |
| Phiên Định nghĩa RFID | Session ID | 12/12 | 0 |
| Đối tác đóng dấu/cấp giấy | Mã định danh nguồn ổn định | 50/50 | 0 |
| Cấu hình báo cáo kế toán | Record ID | 3.864/3.864 | 0 |
| Audit báo cáo kế toán | Audit ID | 3.865/3.865 | 0 |
| Cấu hình tổng | Record ID | 28/28 | 0 |
| Inbox/Đơn hàng | Mã đơn dịch vụ | 576/576 | 0 |
| Vai trò V2 | Mã quyền | 2/2 | 0 |
| Gán quyền V2 | Mã nhân sự | 7/7 | 0 |
| AI Review hợp đồng | ID | 4/4 | 0 |
| ORDER tuyển dụng | Mã order | 80/80 | 0 |

Nguồn tuyển dụng đang có đồng bộ riêng. Lần chạy gần nhất đọc 5.394 dòng Theo dõi tuyển dụng và 88 dòng Kết quả ứng viên; toàn bộ đều được nhận diện là đã có, không có lỗi.

## Dữ liệu được nhập bù trong đợt này

| Nguồn | Kết quả | Migration run |
| --- | --- | --- |
| Đánh giá nhân sự/JD | Thêm 26 bản ghi thiếu, giữ nguyên 4.734 bản ghi đã có | importer đánh giá chế độ `insert-missing-only` |
| Bản tin/Thông báo | Thêm 2 sự kiện thiếu, giữ nguyên 24 bản ghi đã có | importer motivation chế độ missing-only |
| 18_Gửi thư | Thêm 20 lịch sử gửi thư; không gọi lại API ViettelPost | `cmsidv8te0001gkstij6xdrw2` |
| 07_Sổ văn bản | Thêm 33 số còn thiếu, giữ nguyên 287 số đã có; không đụng pool đang dùng | `cmsiecmmq0001dostjm9utu83` |
| 25_NCC Khach hang | Thêm 17 đối tác thiếu, giữ nguyên 33 đối tác đã có | `cmsiez62i0001swstnw4fdrw2` |
| 20_RFID Log / definition | Thêm 12 phiên và 42 sự kiện phát hành, liên kết 33 tag hiện có | `cmsif3mna0001l0stwpikii6v` |
| 15_Nhac viec | Thêm 19 yêu cầu lịch sử và 20 liên kết file Drive | `cmsifh2cu00019kstvuvreg1r` |
| 16_Chat Thu ky Meo | Lưu trữ 5 tin cũ, không kích hoạt lại Module chat | `cmsifox7j0001akstieb5c27u` |
| 98_Inbox | Đối soát 576/576, liên kết metadata file và bổ sung 3 định danh người dùng còn thiếu | `cmside583000008stkc2afhr3` |

Tất cả các run hoàn tất có `rowsFailed = 0`. Những issue của các lần thử cũ vẫn được giữ làm lịch sử audit; run hoàn tất mới nhất của từng nguồn không còn issue lỗi.

## Nguồn chỉ kiểm tra, không nhập lại

- `15_Báo cáo kho`: 1.512 dòng là snapshot báo cáo, không được trộn vào tồn kho thực.
- `20_RFID Log` chế độ `packing`: 27 dòng/3 phiên không nhập vì chức năng Lên đơn/Eshop đã được loại khỏi hướng app RFID.
- `20_RFID Log` chế độ `inventory`: 135 dòng thuộc một phiên đã được đại diện bởi `17_Lịch chạy dữ liệu`; không nhân đôi.
- Các sheet `ĐG_JD_*`: bảng dẫn xuất để kiểm tra chéo, không phải nguồn chính. JD mới không có tiền tố `[BC]` vẫn được ưu tiên; JD `[BC]` chỉ fallback.
- `OFFER`: loại khỏi migration theo quyết định đã chốt; code Offer tiếp tục khóa.
- Dữ liệu V3 có thêm ngoài V2 (ví dụ nhân sự, SKU, cấu hình, phiên RFID) được giữ nguyên.

## Công cụ đối soát và chạy lặp

Audit toàn bộ là thao tác chỉ đọc:

```powershell
$sa = 'cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com'
$scope = 'https://www.googleapis.com/auth/spreadsheets.readonly'
$tokenOutput = cmd /c "gcloud.cmd auth print-access-token --impersonate-service-account=$sa --scopes=$scope 2>nul"
$env:GOOGLE_ACCESS_TOKEN = ($tokenOutput | Out-String).Trim()
node --env-file=.env --import tsx scripts/audit-v2-v3-migration.ts
```

Mỗi importer phải chạy `preview` trước. Chỉ chạy `apply` khi preview báo có bản ghi thiếu:

```powershell
node --env-file=.env --import tsx scripts/import-v2-document-registry.ts --mode=preview
node --env-file=.env --import tsx scripts/import-seal-partners.ts --mode=preview
node --env-file=.env --import tsx scripts/import-v2-rfid-definition-history.ts --mode=preview
node --env-file=.env --import tsx scripts/import-v2-todo-history.ts --mode=preview
node --env-file=.env --import tsx scripts/import-v2-chat-history.ts --mode=preview
```

Các khóa xác nhận khi thực sự cần ghi:

```powershell
node --env-file=.env --import tsx scripts/import-v2-document-registry.ts --mode=apply --confirm-apply=07_So_van_ban
node --env-file=.env --import tsx scripts/import-seal-partners.ts --mode=apply --confirm-apply=25_NCC_Khach_hang
node --env-file=.env --import tsx scripts/import-v2-rfid-definition-history.ts --mode=apply --confirm-apply=20_RFID_definition
node --env-file=.env --import tsx scripts/import-v2-todo-history.ts --mode=apply --confirm-apply=15_Nhac_viec
node --env-file=.env --import tsx scripts/import-v2-chat-history.ts --mode=apply --confirm-apply=16_Chat_history
```

## Kiểm thử hoàn tất

- `npm run check:encoding`: đạt, toàn bộ text UTF-8 hợp lệ.
- `npx tsc --noEmit --pretty false`: đạt.
- `node --check prisma/import-evaluation-recruitment.mjs`: đạt.
- Chạy lại preview 5 importer mới: toàn bộ báo `missing = 0`, chứng minh có thể chạy lặp mà không tạo trùng.
- Audit cuối: mọi nguồn có khóa nghiệp vụ trực tiếp đều báo `missingInV3 = 0`.

