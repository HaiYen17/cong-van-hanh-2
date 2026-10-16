# Bản đồ Google Sheet/Drive sang PostgreSQL

## Nguyên tắc lưu trữ

PostgreSQL lưu dữ liệu có cấu trúc, quan hệ, trạng thái, quyền, lịch sử và
metadata file. PDF, Word, Excel, ảnh, file cài đặt và file dung lượng lớn được
lưu trong object storage.

Với hạ tầng Cloud SQL hiện tại, đích ưu tiên là Google Cloud Storage. Trong thời
gian chuyển đổi, Drive vẫn có thể là một adapter tương thích.

Metadata file tối thiểu:

`bucket`, `objectKey`, `originalName`, `mimeType`, `sizeBytes`, `sha256`,
`version`, `ownerId`, `acl`, `sourceDriveId`, `migrationState`, `createdAt`.

## Sheet nền tảng

| Nguồn hiện tại | Dữ liệu | Đích PostgreSQL |
|---|---|---|
| `01_Thông tin nhân viên` | Danh bạ, nhân sự, pháp nhân | `Company`, `Employee`, `User`, staging và bảng định danh nhân sự |
| `02_Thông tin chức năng` | Công ty, loại văn bản, cấu hình chức năng | `Company`, `DocumentType`, `ServiceDefinition`, `AppModule` |
| `99_Phân quyền hệ thống`, `99_Cấu hình quyền` | Vai trò, gán quyền, mật khẩu | `Role`, `Permission`, `UserRole`, `RoleModuleGroup`, `RoleAppModule` |
| `97_Cấu hình tổng` | Tích hợp và cấu hình module | `SystemSetting`, `IntegrationAccount`; secret đưa vào Secret Manager hoặc mã hóa |
| `08_Bộ Tag`, `09_Cấu hình nền`, `PhanHoiSuKien` | Tag, reaction, thông báo, rule dùng chung | Các bảng chuyên biệt; không tiếp tục gom mọi JSON vào một bảng |
| `25_NCC Khach hang` | Nhà cung cấp, khách hàng | `Partner`, `PartnerContact`, `PartnerAddress` |

## Nghiệp vụ hành chính

| Nguồn hiện tại | Đích PostgreSQL |
|---|---|
| `98_Inbox`, `00_Tổng hợp Dự án` | `Request`, `RequestItem`, `RequestEvent`, `WorkflowDefinition`, `RequestAttachment` |
| `03_Biểu mẫu`, `05_Biểu mẫu lịch sử` | `Template`, `TemplateVersion`, `TemplateField`, `FileObject` |
| `06_Chỉ mục hồ sơ`, `07_Sổ văn bản` | `LegalDossier`, `DocumentRegistry`, `FileObject`, `FileLink` |
| `10_Setup tài sản`, `11_Danh mục tài sản` | `AssetCatalog`, `AssetItem`, `AssetEvent` |
| `12_Văn phòng phẩm`, `13_Đồng phục` | `StationeryItem`, `UniformItem`, catalog và biến thể |
| `15_Nhac viec` | `Task`, `TaskAssignment`, `TaskEvent`, `TaskFeedback` |
| `16_Chat Thu ky Meo` | `ChatThread`, `ChatParticipant`, `ChatMessage` |
| `18_Gửi thư` | `MailOrder`, `MailTrackingEvent` |
| `26_Cấu hình báo cáo KT`, `27_Audit báo cáo KT` | `AccountingSource`, `AccountingMapping`, `AccountingReportConfig`, version, audit, job và output |
| `AI_ReviewHopDong` | `AIReviewJob`, `AIReviewVersion`, `AIReviewRule`, `AIReviewResult` |

## File/folder cần chuyển khỏi Drive

- Hình dashboard và thông báo.
- File biểu mẫu và lịch sử phiên bản.
- Ảnh tài sản, CCDC, văn phòng phẩm và đồng phục.
- Kho ứng dụng, logo, file cài đặt và hướng dẫn.
- Hồ sơ pháp lý, file đóng dấu, cấp giấy và trích lục.
- File phản hồi Nhắc việc.
- File tuyển dụng, đánh giá và công bố kết quả.
- File AI Review, cache text và kết quả.
- File đối soát, kế toán import/export và snapshot báo cáo.
- Eshop raw orders, inventory snapshot, báo cáo Kho/Xưởng.

## Bảng hạ tầng còn thiếu trong V3

| Nhóm | Bảng đề xuất |
|---|---|
| Import | `MigrationSource`, `MigrationRun`, `MigrationIssue`, `ExternalIdMap` |
| File | `FileObject`, `FileVersion`, `FileLink`, `FileAccessGrant` |
| Queue | `Job`, `JobAttempt`, `JobEvent`, `OutboxEvent` |
| Audit | Mở rộng `AuditLog` với before/after JSON, request/correlation ID |
| Notification | `Notification`, `NotificationTarget`, `NotificationReceipt` |
| Workflow | `WorkflowDefinition`, `WorkflowStep`, `RequestItem`, `Approval` |

Các bảng Import và File trong bảng trên đã được thêm vào schema/migration local.
Queue, notification và workflow mở rộng vẫn là chặng tiếp theo.

## Kiểm soát chất lượng import

Mỗi lần import phải lưu nguồn, thời điểm, số dòng đọc, số dòng hợp lệ, số dòng
bị loại, số bản ghi tạo/cập nhật, khóa trùng và checksum. Lỗi dữ liệu phải vào
`MigrationIssue`, không được bỏ qua âm thầm.

Khóa ưu tiên:

- Nhân sự: mã nhân viên; với nguồn không ổn định dùng tên + điện thoại/thông tin định danh.
- Công ty: mã pháp nhân và mã số thuế.
- Đối tác: mã đối tác/mã số thuế; fallback theo tên chuẩn hóa + điện thoại.
- Hồ sơ/yêu cầu: ID nguồn bất biến và `ExternalIdMap`.
- File: `sourceDriveId` trong giai đoạn chuyển, `sha256` để phát hiện trùng nội dung.
