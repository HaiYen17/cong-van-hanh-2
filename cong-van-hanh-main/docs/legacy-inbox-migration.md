# Khôi phục lịch sử Người Thuần Việt từ `98_Inbox`

Importer này đọc tab `98_Inbox` của cổng GAS cũ, ghi lịch sử có cấu trúc vào
PostgreSQL và đăng ký file cũ trong `FileObject`. Google Sheet/Drive luôn là
nguồn chỉ đọc; importer không xóa, move, trash hay đổi quyền file cũ.

## Mapping chính

| Nguồn cũ | Đích V3 |
|---|---|
| Một dòng `98_Inbox` | `Request` + `RequestEvent` |
| Mảng `payload` / `rows` / `items` | `RequestItem` |
| Dòng Đóng dấu hoặc Lưu trữ | `LegalDossier`; có số thì liên kết `DocumentRegistry` |
| `followUp` | `FollowUpRequirement` |
| `files`, `resultFiles`, `outputFiles`, `fulfillmentFiles`, file URL/ID | `FileObject` + `FileVersion` + `FileLink` + `RequestAttachment` |
| Mã nguồn bất biến | `ExternalIdMap` với `98_Inbox:<Mã đơn DV>` |
| Mỗi lượt chạy/dòng/lỗi | `MigrationSource`, `MigrationRun`, `MigrationRecord`, `MigrationIssue` |

Raw JSON cũ được giữ nguyên tại `Request.payload._legacy98Inbox`, bao gồm text
JSON nguồn, số dòng, trạng thái/mã dịch vụ cũ và thông tin người tạo.

## Quy tắc an toàn

- Luôn chạy `preview` trước `apply`.
- `apply`, `resume` và `copy-files` bắt buộc có
  `--confirm-apply=98_Inbox`.
- Người tạo chỉ được resolve bằng `Employee.employeeCode -> User`.
  Không tìm thấy thì dòng lỗi; tuyệt đối không gán tài khoản người đang chạy.
- Batch từ 50 đến 100 dòng, có cursor và `MigrationRecord` để resume.
- Chạy lại cùng fingerprint sẽ `SKIPPED`, không tạo trùng.
- Nếu bản V3 đã sửa sau `legacy updatedAt`, importer giữ bản V3 và ghi warning.
- File phase đầu chỉ tạo metadata `LINKED_DRIVE`. Folder Drive không bị nhận nhầm
  thành file.
- Phase copy dùng đường dẫn
  `legacy/{sourceKey}/{driveFileId}/v1/{originalName}`, tính SHA256 và giữ
  `sourceDriveId`; không xóa file Drive sau khi copy.

## Credential cần có

- `DATABASE_URL` trỏ tới PostgreSQL/Cloud SQL đã chạy migration.
- Application Default Credentials hoặc service account có:
  - `spreadsheets.readonly`
  - `drive.readonly`
- Spreadsheet nguồn đã chia sẻ cho service account chạy Cloud Run.
- Khi copy file: `LEGACY_MIGRATION_BUCKET` (fallback
  `ACCOUNTING_EXPORT_BUCKET`) và quyền ghi GCS.

## Lệnh vận hành

Xem trước:

```powershell
npx tsx scripts/import-legacy-inbox.ts --mode=preview --batch-size=100
```

Kết quả trả `previewToken`, `runId`, số dòng hợp lệ/lỗi. Xem chi tiết:

```powershell
npx tsx scripts/import-legacy-inbox.ts --mode=status --run-id=<RUN_ID>
```

Áp dụng đúng snapshot đã preview:

```powershell
npx tsx scripts/import-legacy-inbox.ts --mode=apply --preview-token=<PREVIEW_TOKEN> --phase=ALL --confirm-apply=98_Inbox
```

Tiếp tục lượt bị gián đoạn:

```powershell
npx tsx scripts/import-legacy-inbox.ts --mode=resume --run-id=<RUN_ID> --phase=ALL --confirm-apply=98_Inbox
```

Sau khi sửa MNV/User hoặc file lỗi, thử lại record `FAILED`:

```powershell
npx tsx scripts/import-legacy-inbox.ts --mode=resume --run-id=<RUN_ID> --retry-failed --confirm-apply=98_Inbox
```

Copy dần file đã liên kết sang GCS (ví dụ 50 file/lượt, 4 file song song):

```powershell
npx tsx scripts/import-legacy-inbox.ts --mode=copy-files --limit=50 --concurrency=4 --confirm-apply=98_Inbox
```

Mỗi file có timeout tải Drive 120 giây và timeout streaming tổng 300 giây.
`--concurrency` bị giới hạn từ 1 đến 8; production nên dùng 4 để cân bằng
Drive API, Cloud SQL và GCS.

Có thể chạy riêng `--phase=REQUESTS` rồi `--phase=FILES`. Phase `FILES` yêu cầu
Request đã có `ExternalIdMap`.

## Tiêu chí đối soát

- Tổng `MigrationRun.rowsRead` bằng số dòng có dữ liệu của `98_Inbox`.
- Không có hai `ExternalIdMap` cùng source/entity/external ID.
- Số `Request` map nguồn bằng số dòng hợp lệ.
- `MigrationIssue` phải giải trình mọi dòng/file không nhập được.
- `FileObject.sourceDriveId` duy nhất; một file dùng chung được link tới nhiều
  Request nhưng không tạo metadata trùng.
- Sau copy, `FileObject.migrationState=MIGRATED`, có SHA256 và vẫn còn
  `sourceDriveId`.
