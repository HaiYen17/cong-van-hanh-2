# Kiểm kê Kệ/Xe

Tính năng mới ngày 05/09/2026, theo yêu cầu người dùng; không có phiên bản tương ứng trong app Apps Script. Giữ workspace Kiểm kê RFID hiện tại và đặt hai workspace trong thẻ ngoài cùng.

- Android định nghĩa mã/tên/khu vực/RFID cho Kệ hoặc Xe độc lập với Cấu hình Kho cũ. Khu vực dùng chung đúng danh sách **Khu vực kiểm kê** của kiểm kê RFID thông thường.
- Kệ có số tầng cấu hình từ 1 đến 20; dữ liệu cũ mặc định 3 tầng. Xe không có tầng và dùng vị trí nội bộ `floor = 0`, nhưng giao diện/bản in chỉ ghi **Hàng hóa trên xe**.
- Module **Cấu hình kệ** cho phép khai báo tối đa 6 nhóm SKU trên mỗi Kệ. Nhóm SKU là chuỗi chữ cái đứng đầu mã hàng: `CSTN10-5` và `CSTN12-6` cùng thuộc nhóm `CSTN`. Xe không dùng cấu hình nhóm SKU.
- API `/api/warehouse/rfid` nhận năm action `warehouseListShelves`, `warehouseDefineShelf`, `warehouseShelfInventorySubmit`, `warehouseShelfInventoryList`, `warehouseShelfInventoryGet`.
- Mọi action kệ cần API key và phiên đăng nhập đang hoạt động. Định nghĩa cần module `warehouse-config`; nộp/xem kết quả cần `warehouse-inventory`. Cả hai module đều được đọc danh sách kệ; nhóm warehouse/fullAccess giữ quyền hiện tại. Không có phân quyền theo từng kho trong hệ thống hiện tại.
- Kết quả chứa số lượng SKU đã quét và số lượng sau chỉnh theo tầng của Kệ hoặc trực tiếp trên Xe, không chứa EPC hàng hóa. Server kiểm tra SKU, khu vực, người tạo phiên và lưu cấu hình Kệ/Xe cùng người nộp tại thời điểm nhận. Mã phiên và mã thao tác bảo đảm gửi lại không nhân đôi.
- Khi kiểm kê Kệ, máy quét chỉ nhận hàng thuộc các nhóm SKU đã cấu hình cho Kệ đang chọn; RFID ngoài phạm vi được đếm riêng và tự loại khỏi kết quả. Kệ chưa cấu hình bị chặn trước bước thống kê/nộp. Server kiểm tra lại danh sách nhóm và phiên bản cấu hình khi nhận kết quả để ngăn client cũ hoặc dữ liệu đã đổi phạm vi nộp sai.
- Màn thống kê trên máy quét tìm theo SKU, nhóm SKU hoặc tên hàng. Mã được chuyển tầng hay chỉnh số lượng tự chuyển xanh; nhấn đúp một khối để xác nhận đã kiểm tra hoặc bỏ xác nhận. Khi còn mã chưa xác nhận, app cảnh báo trước khi nộp nhưng vẫn cho người dùng quyết định tiếp tục.
- Cổng `/kho-van/kiem-ke` có thẻ Kiểm kê Kệ/Xe, danh sách phân trang, chi tiết vị trí và đối chiếu trước/sau sửa.
- Người dùng có thể chọn nhiều phiên qua nhiều trang để xem trước hoặc ghép thành một báo cáo chung. Server bắt buộc các phiên cùng kho, từ 2 đến 100 phiên khi ghép và mỗi kệ chỉ có một phiên. Báo cáo đã ghép lưu snapshot số lượng sau điều chỉnh, giữ liên kết với mọi phiên nguồn và audit; dữ liệu nguồn không bị xóa hoặc sửa.
- Thẻ **Báo cáo đã ghép** cho phép mở lại từng khối và chọn lần lượt hai khối làm đầu vào/đầu ra. So sánh tính `đầu ra − đầu vào` theo hợp của Kệ/Xe, vị trí và SKU; giữ đơn vị rỗng, cấu hình tầng tại từng lần, đơn vị/SKU chỉ có ở một phía và cảnh báo khi phạm vi khác nhau. Bản in đầu/cuối kỳ và bản in so sánh đều giữ khu vực ký người lập/người xác nhận.
- Phiên kệ không lưu EPC hàng hóa, vì vậy báo cáo cộng số lượng SKU đã nộp theo kệ và không thể khử trùng một món bị đếm ở hai kệ.

## Database

Migration `20260905003000_add_shelf_inventory` tạo các bảng riêng, registry EPC chung và trigger cho mọi đường ghi/xóa RFID sản phẩm. Registry PRODUCT dùng ID bản ghi RFID, bảo toàn nghiệp vụ đổi SKU. EPC cũ giữ nguyên định dạng; khóa registry được chuẩn hóa để tránh trùng với kệ. Nếu dữ liệu cũ trùng sau chuẩn hóa, migration dừng atomically.

Migration cộng thêm `20260905033000_add_shelf_inventory_reports` tạo `rfid_shelf_inventory_reports` và `rfid_shelf_inventory_report_sessions`. Bảng đầu lưu snapshot bất biến cùng tổng hợp; bảng sau liên kết báo cáo với phiên và kệ nguồn, chặn cùng một kệ xuất hiện hai lần trong một báo cáo và dùng `ON DELETE RESTRICT` để bảo toàn truy vết.

Migration `20260905070000_add_shelf_vehicle_types` thêm loại `SHELF/VEHICLE`, số tầng vào định nghĩa và snapshot phiên, đồng thời mở vị trí dòng từ `0` đến `20`. Dữ liệu hiện hữu được giữ là Kệ 3 tầng.

Migration `20260907120000_add_shelf_sku_configuration` tạo cấu hình tối đa 6 nhóm SKU cho từng Kệ, bảng audit thay đổi, phiên bản khóa lạc quan và snapshot `configuration_version` trên phiên kiểm kê. Migration cũng đăng ký module `warehouse-shelf-config` cùng quyền đọc/quản lý; dữ liệu Kệ/Xe và phiên cũ được giữ nguyên.

`node scripts/migrate-shelf-module.mjs` kiểm tra trước; thêm `--apply` để chạy migration nền. Với cấu hình SKU, dùng `node scripts/migrate-shelf-sku-config.mjs` rồi thêm `--apply` sau khi preflight đạt. Cả hai script ghi checksum vào `_prisma_migrations` trong cùng transaction và không tự chạy migration khác đang chờ. Khi chạy Cloud SQL bằng tài khoản owner đã cấu hình ở `.env`, bọc lệnh bằng `node scripts/run-shelf-cloud-qa.mjs --owner-migration <script> [--apply]`; wrapper xác nhận đúng instance/database và cấp quyền bảng/sequence mới cho tài khoản runtime.

## Kiểm tra và deploy

1. `npm run check:deploy-modules` và `npm run test:warehouse`.
2. `node --test scripts/qa-shelf-core.test.mjs` và `node scripts/qa-shelf-registry.mjs` dùng PostgreSQL PGlite trong bộ nhớ, không ghi dữ liệu thật.
3. Build mới từ source hiện hành bằng `infra/gcp/cloudbuild.web.yaml`; prebuild chạy toàn bộ guard.
4. Áp migration đã kiểm tra, deploy image mới, xác minh traffic 100%.
5. `node scripts/run-shelf-cloud-qa.mjs scripts/qa-shelf-production.ts` kiểm tra Services/full quyền, routes trọng yếu, API, auth. Phiên QA được thu hồi trong finally; không ghi dữ liệu nghiệp vụ. Chạy thêm `node scripts/run-shelf-cloud-qa.mjs scripts/qa-permission-production.ts` theo AGENTS.md. Wrapper lấy đúng secret của Cloud Run trong bộ nhớ, dùng transport base64 để giữ nguyên byte trên Windows; không sửa `.env` hoặc ghi secret ra log/file.
6. Nếu thiếu module/lỗi route, chuyển traffic về revision trước. Giữ migration cộng thêm để dữ liệu kệ đã nhận không mất.

## Kết quả triển khai 05/09/2026

Cloud Build `00aedc4e-5750-4aa7-b205-7556569804de` thành công. Revision `cong-van-hanh-web-shelf-inventory-0905-1` nhận 100% traffic. Migration và quyền runtime đã áp dụng; Services đủ 46 module, các route trọng yếu cùng API kệ đều qua smoke test ở URL thử và tên miền chính. Kiểm tra quyền Nhân viên production (18 module, năm route) đạt và đã thu hồi phiên QA.

Image digest: `sha256:625bfc5709eef98306467bd0193ed26605ff9133d55f4322cb905c2fdb95d94b`. Revision rollback: `cong-van-hanh-web-eval-conclusion-font-0903-1`.

### Báo cáo nhiều kệ

Build `17483cc7-f12e-4eac-93fc-098768997e96`, image `sha256:8eb3c8aa5690eea0c6d1f04eda3acdaff126eec3607503ad8abda5380ade23c3`, revision `cong-van-hanh-web-shelf-report-0905-1`. Revision nhận 100% traffic sau khi đạt smoke test ở URL thử. Kiểm tra lại trên tên miền chính đạt: 46 module/fullAccess, API kệ, quyền Nhân viên 18 module và Chrome thật hydrate thẻ kệ, thanh chọn, nút **Tạo báo cáo toàn kho**. Các phiên QA đều được thu hồi và không tạo dữ liệu nghiệp vụ.

### Ghép phiên và so sánh hai kiểm kê

Build `be6fc267-3f6b-4128-b555-a0b4bfad8826`, image `sha256:a7fd8d21edb36e55f5ec1bfde722e58443216b9eec03289a6b24d1507071fc57`, revision `cong-van-hanh-web-shelf-compare-0905-1`. Revision nhận 100% traffic sau khi URL thử và tên miền chính đạt full-access smoke, 46 module guard, API kệ, runtime CRUD cho bảng báo cáo, Chrome thật và quyền Nhân viên 18 module.

QA nghiệp vụ production đã tạo dữ liệu tạm cho hai kệ/hai lần kiểm, ghép thành hai snapshot, kiểm tra bốn liên kết nguồn, xác minh snapshot không đổi khi phiên nguồn bị sửa thử và so sánh đúng tổng `21 → 41`, chênh lệch `+20`. Fixture, liên kết, audit và báo cáo QA được dọn trong `finally`; kiểm tra sau dọn không còn dữ liệu QA.

### Kệ/Xe và số tầng tùy chỉnh

Build `b64b5e05-558a-4839-a08f-39fe45debd9c`, image `sha256:79323b50b28c7ec24de2ed563d15679ce8c1579277049fd2fc7bdca88e004daa`, revision `cong-van-hanh-web-shelf-vehicle-0905-1`. Migration `20260905070000_add_shelf_vehicle_types` được áp dụng và ghi checksum atomically; revision nhận 100% traffic sau khi qua smoke test tại URL riêng.

QA production xác minh 46 module/fullAccess, quyền Nhân viên 18 module, Chrome hydrate màn Kệ/Xe, OpenAPI schema v2 và runtime database. Luồng HTTP thật đã tạo tạm Kệ 5 tầng và Xe không tầng, nộp/đọc lại đúng vị trí tầng 5 và `floor = 0`; QA báo cáo xác minh ghép, snapshot bất biến và so sánh. Toàn bộ Kệ/Xe, phiên, registry, operation và phiên đăng nhập QA đã được dọn trong `finally`.

### Cấu hình tối đa 6 nhóm SKU theo Kệ

Build `44d0489f-689d-4dd3-a20d-66e60f7a7caf`, image `sha256:83845365ea9b7d9c13bd0810cfc797f451b19a13bfd082f674ebb49406e1b5ff`, revision `cong-van-hanh-web-shelf-sku-0907-1`. Migration `20260907120000_add_shelf_sku_configuration` được áp dụng và ghi checksum atomically; revision nhận 100% traffic sau khi URL riêng đạt QA.

QA production trên tên miền chính xác minh 47 module/fullAccess, route **Cấu hình kệ**, OpenAPI, quyền runtime và quyền Nhân viên 18 module. Luồng HTTP thật đã thay nhóm SKU, chặn nộp bằng phiên bản cấu hình cũ, nộp đúng Kệ 5 tầng và xác nhận Xe không bị lọc. Chrome thật kiểm tra Kệ đủ 6/6 nhóm vẫn xóa được một nhóm, thêm nhóm thứ 7 thay thế và lưu phiên bản mới. Mọi Kệ, cấu hình, audit, registry, operation và phiên đăng nhập QA đều được dọn trong `finally`.
