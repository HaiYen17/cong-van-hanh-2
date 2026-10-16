# Hợp đồng API ứng dụng Kho vận

Phiên bản contract: `2026-07-28`

Base URL production:

```text
https://thuanvietgroup.biz.vn
```

OpenAPI JSON:

```text
GET /api/warehouse/openapi
```

## Quy ước chung

- Gửi `Content-Type: application/json` với các API POST.
- App mới luôn gửi khóa ứng dụng bằng `X-API-Key: <WAREHOUSE_API_KEY>`.
- Sau đăng nhập, gửi thêm `Authorization: Bearer <ACCESS_TOKEN>` ở các action Kho vận.
- APK cũ được tiếp tục gửi API key trong body hoặc Bearer để tương thích; app mới không nên dùng cách cũ.
- Tất cả thời gian là ISO 8601 và phải có múi giờ, ví dụ `2026-07-28T16:30:00+07:00`.
- EPC/RFID phải viết hoa, bỏ khoảng trắng trước khi gửi.
- `sessionId` là khóa chống ghi trùng. Khi retry vì mất mạng/timeout phải gửi lại đúng `sessionId` cũ.
- Không retry lỗi HTTP `400`, `401`, `409`, `413`. Chỉ retry lỗi mạng, timeout hoặc HTTP `5xx`.
- Kích thước body tối đa `2 MB`; mỗi action tối đa `10.000` RFID unique. Với Android nên chia lô tối đa `100` RFID.

## 0. Đăng nhập ứng dụng và lấy thông tin nhân sự

### Bước 1 — lấy danh sách nhân sự

```http
GET /api/mobile/auth/employees
X-API-Key: <WAREHOUSE_API_KEY>
```

API chỉ trả `employeeId`, mã/tên nhân viên, phòng ban, chức danh, công ty và hai cờ `requiresPassword`, `hasPassword`; tuyệt đối không trả mật khẩu hay passwordHash.

### Bước 2 — đăng nhập

```http
POST /api/mobile/auth/login
X-API-Key: <WAREHOUSE_API_KEY>
Content-Type: application/json
```

```json
{
  "employeeCode": "2411301",
  "password": "<MẬT_KHẨU_NGƯỜI_DÙNG>",
  "deviceId": "CHAINWAY_C72_01",
  "deviceName": "Máy RFID Kho chính"
}
```

Có thể gửi `employeeId` thay cho `employeeCode`. Nếu response HTTP `428` với `code = PASSWORD_SETUP_REQUIRED`, app hiện form tạo mật khẩu rồi gửi lại:

```json
{
  "employeeCode": "2411301",
  "newPassword": "<MẬT_KHẨU_MỚI>",
  "confirmPassword": "<NHẬP_LẠI_MẬT_KHẨU>",
  "deviceId": "CHAINWAY_C72_01"
}
```

Response thành công trả `accessToken`, `expiresAt` (8 giờ) và `profile`. App lưu token trong Android Keystore/EncryptedSharedPreferences, không ghi ra log hoặc file JSON thường.

### Bước 3 — đọc lại phiên hiện tại

```http
GET /api/mobile/auth/me
X-API-Key: <WAREHOUSE_API_KEY>
Authorization: Bearer <ACCESS_TOKEN>
```

`profile.displayName` và `profile.employeeCode` là nguồn danh tính chuẩn. Khi app gửi action Kho vận bằng cả hai header, backend tự ghi đè `operator` theo phiên đăng nhập nên client không thể giả tên người thao tác.

### Đăng xuất

```http
POST /api/mobile/auth/logout
X-API-Key: <WAREHOUSE_API_KEY>
Authorization: Bearer <ACCESS_TOKEN>
```

Token bị thu hồi ngay. HTTP `401`/`INVALID_SESSION` yêu cầu quay về màn đăng nhập.

## 1. Cấu hình Kho — tra Barcode/SKU

### API ưu tiên cho đồng bộ/tra cứu

```http
GET /api/warehouse/catalog?barcode=8938500000012
X-API-Key: <WAREHOUSE_API_KEY>
```

Query hỗ trợ:

| Trường | Ý nghĩa |
|---|---|
| `barcode` | Khớp chính xác Barcode |
| `sku` | Khớp chính xác SKU |
| `query` | Tìm gần đúng theo Barcode, SKU hoặc tên hàng |
| `updatedAfter` | Đồng bộ gia tăng sau mốc ISO 8601 |
| `page` | Trang, mặc định `1` |
| `limit` | Số dòng, mặc định `100`, tối đa `500` |

App có thể dùng chung endpoint POST:

```json
{
  "action": "warehouseCatalogLookup",
  "barcode": "8938500000012",
  "page": 1,
  "limit": 100
}
```

Khi quét Barcode ở màn Định nghĩa RFID, app phải lấy `products[0].sku` và `products[0].name`. Không tự coi Barcode là SKU nếu API trả về rỗng.

## 1B. Tìm kiếm hàng hóa/RFID

Màn Tìm kiếm giữ nguyên cơ chế chọn hàng rồi chọn một EPC mục tiêu để dò bằng cường độ sóng. Không lọc theo Pháp nhân.

```http
POST /api/warehouse/rfid
X-API-Key: <WAREHOUSE_API_KEY>
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "action": "warehouseRfidSearch",
  "query": "NTV-GOI-001",
  "limit": 100
}
```

`query` nhận tên hàng, SKU, Barcode hoặc EPC. Backend chỉ trả RFID đang `issuanceStatus = ACTIVE`. App nhóm `options[]` theo SKU, cho người dùng chọn một `rfid`, rồi mới bật chế độ dò gần/xa hiện có. Nếu `truncated = true`, yêu cầu người dùng nhập từ khóa cụ thể hơn; không tự tải hàng nghìn EPC vào một màn hình.

## 2. Thông tin kho — Định nghĩa/Phát hành RFID

Endpoint:

```http
POST /api/warehouse/rfid
```

### Phát hành/Kích hoạt

```json
{
  "action": "warehouseDefineRfidBatch",
  "sessionId": "android-def-20260728-163000-001",
  "sku": "NTV-GOI-001",
  "barcode": "8938500000012",
  "rfids": [
    "E28069150000502011223344",
    "E28069150000502011223345"
  ],
  "issuanceStatus": "ACTIVE",
  "expectedQty": 2,
  "operator": "Nguyễn Minh Thông",
  "deviceName": "CHAINWAY_C72_01",
  "createdAt": "2026-07-28T16:30:00+07:00",
  "scanPower": 5,
  "scanRangeHint": "duoi_20_cm",
  "source": "Android/RFID"
}
```

`sku` hoặc `barcode` là bắt buộc khi `issuanceStatus = ACTIVE`. Backend dùng danh mục Cấu hình Kho để lấy tên SKU. Nếu RFID đã gắn SKU khác, backend trả lỗi cho riêng EPC đó và không tự đổi SKU.

### Hủy RFID

```json
{
  "action": "warehouseDefineRfidBatch",
  "sessionId": "android-cancel-20260728-170000-001",
  "rfids": ["E28069150000502011223344"],
  "issuanceStatus": "CANCELLED",
  "cancelledBy": "Nguyễn Minh Thông",
  "cancelledAt": "2026-07-28T17:00:00+07:00",
  "deviceName": "CHAINWAY_C72_01",
  "source": "Android/RFID"
}
```

Backend cũng nhận alias `activationStatus`, `usageStatus`, `rfidStatus`; app mới nên dùng duy nhất `issuanceStatus` với hai giá trị `ACTIVE` hoặc `CANCELLED`.

Phản hồi thành công chỉ được xác nhận khi `ok = true` và `errorCount = 0`. `createdCount` là số mã đã thay đổi, `skippedCount` là số mã đã đúng trạng thái, `errors` là lỗi theo EPC.

## 2B. Định nghĩa và kiểm kê Kệ/Xe

Các action dùng chung endpoint `POST /api/warehouse/rfid` và yêu cầu cả API key lẫn Bearer token. `warehouse` là **Khu vực kiểm kê**, dùng cùng danh sách với kiểm kê RFID thông thường.

Định nghĩa Kệ 5 tầng:

```json
{
  "action": "warehouseDefineShelf",
  "shelfId": "unit-a1",
  "operationId": "unit-a1-v1",
  "code": "A1",
  "name": "Kệ A1",
  "warehouse": "Kho tổng",
  "entityType": "SHELF",
  "floorCount": 5,
  "epc": "E28069150000502011223344",
  "version": 0
}
```

Định nghĩa Xe dùng `entityType = VEHICLE` và `floorCount = 0`. Khi nộp kết quả, app gửi `schemaVersion = 2`, `type` trùng loại đã định nghĩa và chỉ gửi số lượng SKU. Kệ dùng `floor` từ `1..floorCount`; Xe dùng `floor = 0` trên wire/database và giao diện hiển thị **Hàng hóa trên xe**.

Response `warehouseListShelves` trả thêm `skuGroups`, `skuConfigurationVersion` và `skuConfiguredAt`. Với Kệ, `skuGroups` có tối đa 6 phần tử, mỗi phần tử là nhóm chữ cái đầu mã SKU. Ví dụ `CSTN10-5` và `CSTN12-6` đều có nhóm `CSTN`. Xe luôn bỏ qua bộ lọc này. App không cho chuẩn bị/nộp Kệ chưa có cấu hình; sau khi chọn Kệ, chỉ giữ hàng có nhóm SKU thuộc `skuGroups` và đếm các lần đọc ngoài phạm vi vào `excludedOutOfScopeCount`.

```json
{
  "action": "warehouseShelfInventorySubmit",
  "schemaVersion": 2,
  "type": "VEHICLE",
  "floorCount": 0,
  "sessionId": "vehicle-inventory-001",
  "operatorId": "employee-id",
  "shelfId": "vehicle-01",
  "shelfName": "Xe giao hàng 01",
  "shelfCode": "XE-01",
  "warehouse": "Kho tổng",
  "createdAt": "2026-09-05T10:00:00+07:00",
  "submittedAt": "2026-09-05T10:15:00+07:00",
  "deviceName": "CHAINWAY_C72_01",
  "scanned": [{ "sku": "NTV-GOI-001", "name": "Gối", "quantity": 4 }],
  "lines": [{ "floor": 0, "sku": "NTV-GOI-001", "name": "Gối", "quantity": 4 }],
  "excludedReadCount": 0,
  "excludedOutOfScopeCount": 0,
  "skuConfigurationVersion": 0,
  "reviewedSkus": ["NTV-GOI-001"]
}
```

Với Kệ, `skuConfigurationVersion` phải là phiên bản vừa nhận từ danh sách Kệ và mọi SKU trong `scanned`/`lines` phải thuộc cấu hình hiện hành. Server trả lỗi nếu cấu hình đã thay đổi hoặc có SKU ngoài phạm vi. `reviewedSkus` ghi các khối đã được người kiểm kê chuyển tầng, chỉnh số lượng hoặc nhấn đúp xác nhận; đây là dữ liệu audit, không thay đổi cách cộng số lượng. Xe gửi `skuConfigurationVersion = 0` và không bị lọc theo nhóm SKU.

Danh sách/chi tiết dùng `warehouseListShelves`, `warehouseShelfInventoryList`, `warehouseShelfInventoryGet`. Server vẫn nhận payload Kệ `schemaVersion = 1` cũ với mặc định 3 tầng; OpenAPI công bố contract mới phiên bản 2.

## 3. Kiểm kê Kho — gửi phiên quét

Endpoint:

```http
POST /api/warehouse/rfid
```

JSON tối thiểu:

```json
{
  "action": "warehouseInventoryScan",
  "sessionId": "inventory-20260728-180000-001",
  "rfids": [
    "E28069150000502011223344",
    "E28069150000502011223345"
  ],
  "operator": "Nguyễn Minh Thông",
  "deviceName": "CHAINWAY_C72_01",
  "date": "2026-07-28",
  "source": "Android/RFID"
}
```

JSON đầy đủ có thể gửi thêm `tags`, `area`, `shelf`, `inventoryType` (`START`, `END` hoặc rỗng) và `totalReadCount`. Không cần Eshop hay pháp nhân.

Backend tự:

1. Loại RFID trùng trong cùng phiên.
2. Cộng dồn các batch có cùng `sessionId`; app Android có thể gửi tuần tự tối đa 100 EPC/request và phải giữ nguyên `sessionId` cho toàn lượt quét.
3. Chuyển EPC thành SKU/tên hàng từ Thông tin kho.
4. Đếm `physicalQuantity` theo SKU.
5. Trả RFID chưa định nghĩa trong `unknownRfids`.

Việc gửi lại cùng batch là idempotent: EPC đã có không được tính thêm lần nữa. Response của mỗi request chỉ mô tả batch vừa nhận để app ghép tiến trình; phiên hiển thị trên web/PostgreSQL là kết quả cộng dồn của toàn bộ EPC cùng `sessionId`.

App coi phiên được nhận khi HTTP `200` và `ok = true`. Lưu `sessionId` cho màn lịch sử và retry.

## Mã HTTP

| HTTP | Ý nghĩa |
|---|---|
| `200` | Request đã được xử lý; vẫn phải kiểm tra `ok` và `errorCount` |
| `400` | JSON/action/trường dữ liệu không hợp lệ |
| `401` | Sai hoặc thiếu API key |
| `409` | Phiên kiểm kê đã xác nhận, không được ghi lại |
| `413` | JSON lớn hơn 2 MB |
| `503` | Backend chưa cấu hình API key hoặc dịch vụ phụ thuộc chưa sẵn sàng |

## File mẫu

- `docs/warehouse-api-samples/00-employees-response.json`
- `docs/warehouse-api-samples/00-login-request.json`
- `docs/warehouse-api-samples/00-login-response.json`
- `docs/warehouse-api-samples/01-catalog-lookup-request.json`
- `docs/warehouse-api-samples/01-catalog-lookup-response.json`
- `docs/warehouse-api-samples/02-rfid-definition-active-request.json`
- `docs/warehouse-api-samples/02-rfid-definition-response.json`
- `docs/warehouse-api-samples/03-rfid-cancel-request.json`
- `docs/warehouse-api-samples/04-inventory-request.json`
- `docs/warehouse-api-samples/04-inventory-response.json`

## Đối chiếu kết nối máy quét cũ

Luồng Android cũ dùng `OkHttp` gửi `POST` với `Content-Type: application/json; charset=utf-8` tới Google Apps Script WebApp. API key được đặt trực tiếp trong JSON dưới trường `apiKey`. Backend cũ cũng chấp nhận các alias `token`, `secret` hoặc `authorization`, sau đó so với cấu hình bí mật `warehouseKts.androidApiKey` (fallback tương thích ngược: `warehouseKts.apiKey`).

Hai action kho cũ được bộ định tuyến `doPost` nhận là:

- `warehouseDefineRfidBatch`: định nghĩa/phát hành hoặc hủy RFID.
- `warehouseInventoryScan`: gửi phiên kiểm kê.

App mới có thêm `warehouseCatalogLookup` và `warehouseRfidSearch` để lấy trang SKU và tìm EPC đang kích hoạt mà không phụ thuộc Pháp nhân.

Endpoint GAS còn xuất hiện trong `MainActivity.kt` là:

```text
https://script.google.com/macros/s/AKfycbwlJvjq36scGVaKZHY0xsilmmnMg4POYA-yfVTAtt5D_XvSgEVBvm6UdghSxG6SnIk/exec
```

Endpoint này vẫn phục vụ một số action đóng gói cũ nên không được thay toàn cục. Riêng `RfidMappingService` đã dùng endpoint Cloud Run mới:

```text
https://thuanvietgroup.biz.vn/api/warehouse/rfid
```

Trong dự án Android, secret đầu vào dùng tên `androidRfidApiKey` trong `local.properties` (hoặc biến môi trường `ANDROID_RFID_API_KEY`) và được build thành `BuildConfig.ANDROID_RFID_API_KEY`. Không hard-code hoặc commit giá trị thật vào Git.

App mới nên gửi key bằng header `X-API-Key`, đăng nhập để nhận access token rồi gửi thêm `Authorization: Bearer <access-token>`. Cách đặt `apiKey` trong body vẫn được giữ để APK cũ hoạt động, nhưng không nên dùng cho bản app mới.

Giá trị thật được Super Admin copy tại **Cấu hình Tổng → Kho KTS/RFID → Android RFID API key**. API và tài liệu không trả key bí mật ra ngoài.
