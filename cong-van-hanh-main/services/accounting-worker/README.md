# Accounting Worker V3

Service FastAPI chạy độc lập trên Cloud Run cho module **Cấu hình Báo cáo Kế toán**.
Worker không chứa dữ liệu demo và không đọc Google Sheet. Dữ liệu vận hành, snapshot,
lịch sử thay đổi và đầu ra báo cáo đều đọc/ghi PostgreSQL.

## Phạm vi đã có

- Mã hóa Bearer/cookie MISA bằng Fernet trước khi ghi PostgreSQL.
- Có mẫu kỹ thuật hệ thống độc lập với khối dữ liệu; kế toán có thể tạo khối MISA
  đầu tiên chỉ bằng Công ty + Bearer, kể cả sau khi đã dọn sạch dữ liệu Test/Demo.
- Mỗi lần kết nối một khối MISA, worker tự tạo đồng thời hai bảng vận hành:
  `TRIAL_BALANCE` (Bảng cân đối tài khoản) và `GENERAL_LEDGER` (Sổ nhật ký chung).
- Tách kết nối theo công ty + khối dữ liệu MISA (`TenantId`, `DatabaseId`,
  `WorkingBook`, môi trường).
- Đồng bộ theo trang, có checkpoint, retry giãn cách, khóa cạnh tranh và tiếp tục sau lỗi;
  phản hồi MISA tạm thời không có thông báo không làm mất snapshot tốt đang dùng.
- Snapshot bất biến; chỉ kích hoạt snapshot khi đủ số dòng và qua kiểm tra cân đối.
- Lưu đầy đủ Sổ Nhật ký chung trong PostgreSQL, đồng thời tách dòng định khoản chuẩn
  khỏi hai dòng đối xứng mà MISA trả về để không cộng đôi.
- Tổng hợp Nhật ký chung theo tháng, cặp tài khoản và chiều phân tích để báo cáo tháng/năm
  không phải quét lại toàn bộ chứng từ.
- Kiểm soát tự động tổng Nợ = tổng Có, độ phủ cặp đối xứng và ngày hạch toán trước khi
  kích hoạt snapshot Nhật ký chung.
- Lịch sử thêm/sửa/xóa, review và xuất CSV.
- Truy vấn số dư từ snapshot đang kích hoạt.
- Dựng báo cáo thật từ `accounting_portal.config_records`, gồm danh mục tài khoản,
  INCLUDE/EXCLUDE, kỳ trước, công thức dòng, style và cảnh báo.
- Xuất XLSX thật từ cùng kết quả dựng báo cáo.

## Endpoint

Tất cả endpoint nghiệp vụ yêu cầu một trong hai header:

```text
Authorization: Bearer <ACCOUNTING_WORKER_SECRET>
X-Accounting-Worker-Secret: <ACCOUNTING_WORKER_SECRET>
```

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/healthz` | Liveness tối thiểu, không tiết lộ cấu hình |
| GET | `/readyz` | Readiness PostgreSQL + hai schema |
| GET | `/health` | Trạng thái chi tiết có xác thực |
| POST | `/schema/initialize` | Khởi tạo/nâng cấp idempotent `accounting_runtime` |
| POST | `/sessions/misa` | Lưu phiên MISA đầu tiên |
| POST | `/sessions/misa/bearer` | Gia hạn Bearer |
| POST | `/sessions/misa/spaces` | Liệt kê khối MISA có quyền |
| POST | `/sessions/misa/spaces/connect` | Kết nối khối và tự tạo Bảng cân đối tài khoản + Sổ nhật ký chung |
| POST | `/jobs/start` | Tạo lần đồng bộ/snapshot |
| POST | `/jobs/continue` | Chạy một lát đồng bộ |
| POST | `/control/bootstrap` | Nguồn, tiến độ, snapshot, thay đổi |
| POST | `/data-spaces/test-cleanup/preview` | Đếm trước toàn bộ dữ liệu của khối Test/Demo |
| POST | `/data-spaces/test-cleanup/delete` | Xóa khối thử trong một transaction có câu xác nhận |
| POST | `/changes/review` | Review lịch sử thay đổi |
| POST | `/changes/export` | Xuất lịch sử CSV |
| POST | `/journal/entries` | Tra cứu định khoản Nhật ký chung đã chuẩn hóa |
| POST | `/report/balances` | Đọc dòng số dư đã kích hoạt |
| POST | `/report/output` | Dựng báo cáo hoàn chỉnh |
| POST | `/disclosure/output` | Sinh B09-DN, truy nguồn và kiểm tra cộng khớp |
| POST | `/report/export` | Xuất XLSX |

`/schema/initialize` chỉ quản lý schema vận hành `accounting_runtime`. Schema cấu hình
`accounting_portal` thuộc migration chính của Next.js và phải được deploy trước.

## Chạy local

```powershell
cd "C:\Users\minht\OneDrive\Desktop\Hành chính v3\services\accounting-worker"
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Nạp biến môi trường bằng công cụ quản lý secret/local của máy rồi chạy:

```powershell
.\.venv\Scripts\python -m uvicorn worker:app --host 0.0.0.0 --port 8092
```

Khởi tạo runtime schema một lần:

```powershell
$headers = @{ Authorization = "Bearer $env:ACCOUNTING_WORKER_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8092/schema/initialize" -Headers $headers -ContentType "application/json" -Body "{}"
```

## Test

```powershell
.\.venv\Scripts\python -m pytest -q
```

Test không gọi MISA thật và không sửa database thật. Chúng kiểm tra hợp đồng HTTP,
SSRF guard, công thức, INCLUDE/EXCLUDE, kỳ trước và file XLSX.

## Cloud Run

Production phải dùng:

- Cloud SQL PostgreSQL và Cloud SQL connection của Cloud Run;
- Secret Manager cho `ACCOUNTING_DATABASE_URL`, `ACCOUNTING_WORKER_SECRET` và
  `ACCOUNTING_CREDENTIAL_KEY`;
- service account riêng, chỉ có quyền cần thiết;
- `ACCOUNTING_ENVIRONMENT=production`;
- nhóm `ACCOUNTING_MISA_BOOTSTRAP_*` để lưu một khối neo kỹ thuật đang hoạt động
  theo công ty (`TenantId`, `TenantCode`, `DatabaseId`, `BranchId`). MISA cần ngữ
  cảnh này trước khi trả danh sách dữ liệu, nhưng Kế toán vẫn chỉ dán Bearer;
- nếu vận hành nhiều công ty, dùng `ACCOUNTING_MISA_BOOTSTRAP_CONTEXTS` dạng JSON
  theo `companyKey`; các công ty đã có nguồn trong PostgreSQL sẽ tự dùng nguồn đó;
- Cloud Tasks hoặc Cloud Scheduler gọi `/jobs/continue`.

`ACCOUNTING_AUTORUN=false` là mặc định phù hợp Cloud Run request-based CPU. Chỉ bật
autorun nếu Cloud Run được cấu hình CPU luôn hoạt động; nếu không background thread
có thể bị treo ngoài thời gian xử lý request.

Ví dụ build/deploy (thay toàn bộ placeholder):

```powershell
gcloud builds submit --tag "REGION-docker.pkg.dev/PROJECT/REPOSITORY/accounting-worker:TAG"
gcloud run deploy accounting-worker `
  --image "REGION-docker.pkg.dev/PROJECT/REPOSITORY/accounting-worker:TAG" `
  --region "REGION" `
  --service-account "SERVICE_ACCOUNT" `
  --add-cloudsql-instances "PROJECT:REGION:INSTANCE" `
  --set-env-vars "ACCOUNTING_ENVIRONMENT=production,ACCOUNTING_AUTORUN=false" `
  --set-secrets "ACCOUNTING_DATABASE_URL=ACCOUNTING_DATABASE_URL:latest,ACCOUNTING_WORKER_SECRET=ACCOUNTING_WORKER_SECRET:latest,ACCOUNTING_CREDENTIAL_KEY=ACCOUNTING_CREDENTIAL_KEY:latest" `
  --no-allow-unauthenticated
```

Cloud Run IAM bảo vệ lớp ngoài; `ACCOUNTING_WORKER_SECRET` vẫn là lớp xác thực hợp
đồng giữa Next.js và worker. Không ghi Bearer/cookie MISA vào log, Google Sheet,
biến frontend hoặc lịch sử RPC.

## Vai trò của hai nguồn kế toán

- `TRIAL_BALANCE` là nguồn khóa số dư đầu kỳ/cuối kỳ và kiểm tra cân đối tài sản - nguồn vốn.
- `GENERAL_LEDGER` là nguồn phát sinh trung tâm cho kết quả kinh doanh, lưu chuyển tiền tệ,
  phân tích tài khoản đối ứng và loại trừ nội bộ.
- Nhật ký gốc, định khoản chuẩn và bảng tổng hợp tháng đều nằm trong PostgreSQL. Không ghi đè
  số nguồn khi có điều chỉnh; điều chỉnh và loại trừ hợp nhất phải nằm ở lớp riêng có lịch sử.

## Phần cổng Next.js phải nối

Cổng V3 cần ánh xạ các RPC hiện đang báo `501` sang endpoint worker:

- `getAccountingDataRuntime` → `/health` + `/control/bootstrap`
- `testAccountingDataWorker` → `/health`
- `initializeAccountingDataSchema` → `/schema/initialize`
- các RPC MISA/sync/change → endpoint cùng tên trong bảng trên
- `generateAccountingReportOutput` → `/report/output`
- `exportAccountingReportOutput` → `/report/export`

URL và secret worker phải nằm ở biến môi trường/Secret Manager của server Next.js,
không lưu lại qua form và không trả secret về trình duyệt.
