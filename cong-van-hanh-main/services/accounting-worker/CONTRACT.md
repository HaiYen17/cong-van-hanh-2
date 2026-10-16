# Hợp đồng nối RPC Kế toán

Worker trả JSON trực tiếp. API Next.js tiếp tục bọc theo hợp đồng frontend:

```json
{ "ok": true, "result": { "...": "..." } }
```

## Dựng báo cáo

`POST /report/output`

```json
{
  "versionId": "CFG-20260719-133700-49B4",
  "reportKey": "B01",
  "sourceKeys": ["MISA_SOURCE__CONNECTION"],
  "companyKeys": ["NEM_THUAN_VIET"],
  "dataSpaceKeys": ["MISA_DATA_SPACE"],
  "periodFrom": "2026-01-01",
  "periodTo": "2026-12-31"
}
```

Worker từ chối yêu cầu không có `sourceKeys` lẫn `dataSpaceKeys`; không tự trộn mọi
khối MISA. Đầu ra giữ cấu trúc cũ: `report`, `columns`, `headerRows`, `rows`,
`warnings`, `blockingIssues`, `controlChecks`, `controlStatus`, `balanceRowCount`,
`nonZeroCellCount`, `selection`.

## Sinh B09-DN và bằng chứng

`POST /disclosure/output`

Payload dùng cùng khóa phiên dữ liệu với `/report/output`; worker tự khóa
`reportKey = "B09_DN_TT99"` và bật bằng chứng. Có thể truyền
`disclosureItemKeys` để chỉ sinh một/vài khoản mục; danh sách rỗng sinh toàn bộ B09.

```json
{
  "versionId": "CFG-20260719-133700-49B4",
  "snapshotIds": ["snapshot-current"],
  "snapshotIdsByOffset": {
    "0": ["snapshot-current"],
    "-1": ["snapshot-prior"]
  },
  "sourceKeys": ["MISA_SOURCE__CONNECTION"],
  "companyKeys": ["NEM_THUAN_VIET"],
  "dataSpaceKeys": ["MISA_DATA_SPACE"],
  "periodFrom": "2026-01-01",
  "periodTo": "2026-01-31",
  "disclosureItemKeys": ["NOTE_VI_6"]
}
```

Đầu ra `accounting-disclosure-output.v1` gồm `sections`, `items`, `summary`,
`controlStatus` và `warnings`. Mỗi khoản mục chứa:

- `totals`: số được kế thừa từ dòng báo cáo chính và chi tiết chứng minh;
- `links`: đường về đúng báo cáo/dòng/cột nguồn;
- `controlChecks`: kiểm tra chi tiết có cộng về đúng số và kiểm tra chéo các báo cáo;
- `status`: `READY`, `NEEDS_REVIEW` hoặc `MANUAL_INPUT`.

`aggregationRole` phân biệt rõ `ADDITIVE`, `SUBSET_DETAIL` và `REFERENCE_ONLY`.
Dòng “Trong đó” của cấu hình cũ được tự nhận là tiểu mục để không cộng hai lần.
Nếu bằng chứng thiếu hoặc chênh, worker trả kiểm tra `FAIL`; tuyệt đối không tạo số bù.

## Hợp đồng công thức chuẩn

Một thành phần công thức (`term`) phải mô tả nghiệp vụ, không chứa số chốt của
một kỳ cụ thể:

```json
{
  "operator": "MOVEMENT",
  "sourceKey": "AMIS_SO_CHI_TIET",
  "datasetType": "GENERAL_LEDGER",
  "accountSetKey": "GIA_VON_HANG_BAN",
  "counterAccountSetKey": "HANG_TON_KHO",
  "side": "DEBIT",
  "periodBasis": "PERIOD",
  "periodSelector": "CURRENT_RANGE",
  "sign": 1,
  "excludeClosingEntries": true,
  "excludeReversals": false,
  "intercompanyMode": "EXCLUDE",
  "filters": { "branch_id": ["HCM", "HN"] }
}
```

Một dòng có thể có nhiều `terms`; kết quả
là tổng các thành phần. Nhờ đó một dòng có thể ghép số nguồn, điều chỉnh có lịch sử,
dòng trong cùng báo cáo và dòng của báo cáo khác mà không đóng đinh theo tháng/năm.

- `BALANCE`: dùng số dư của Bảng cân đối tài khoản.
- `MOVEMENT`: ưu tiên Sổ chi tiết khi có nguồn chi tiết hoặc tài khoản đối ứng;
  nếu không thì dùng phát sinh tổng hợp của Bảng cân đối tài khoản.
- `CASH_MOVEMENT`: bắt buộc Sổ chi tiết có tài khoản Nợ/Có và số tiền; không được
  lặp tổng phát sinh của nhóm tiền cho nhiều dòng lưu chuyển tiền.
- `DELTA_BALANCE`: chênh lệch cuối kỳ - đầu kỳ; dấu trình bày do `sign` quy định.
- `CROSS_REPORT`: bắt buộc `targetReportKey` + `targetRowCode`, có thể thêm
  `targetColumnKey`.
- `MANUAL_ADJUSTMENT`: chỉ lấy từ nguồn điều chỉnh có lịch sử phê duyệt; tuyệt đối
  không nhận `manualValue` nằm trong phiên bản cấu hình và không ghi đè số nguồn.
- `LINE_REFERENCE`: lấy một dòng khác trong cùng báo cáo bằng `targetRowCode`.

Chiều số liệu được khai báo rõ, không suy đoán từ tên tài khoản:

- `DEBIT` / `CREDIT`: lấy riêng cột Nợ hoặc Có.
- `DEBIT_BALANCE`: Nợ trừ Có, dùng cho tài sản và tự thể hiện tài khoản điều chỉnh âm.
- `CREDIT_BALANCE`: Có trừ Nợ, dùng cho nợ phải trả và vốn chủ sở hữu.
- `NET`: Nợ trừ Có theo quy ước cũ.

Mặc định cột báo cáo quyết định `valueBasis`. Đặt `useColumnBasis: false` cho thành phần
có cơ sở kỳ cố định, ví dụ tiền đầu kỳ luôn dùng `periodBasis: OPENING`. Riêng
`DELTA_BALANCE` luôn dùng chênh lệch cuối kỳ - đầu kỳ, không bị cột YTD/PERIOD ghi đè.

Mỗi thành phần có thể khai báo điều kiện nghiệp vụ có cấu trúc. `logic` nhận `ALL`
hoặc `ANY`; `conditions` nhận `field`, `operator`, `value`. Các toán tử được hỗ trợ:
`EQUALS_ANY`, `NOT_EQUALS_ANY`, `CONTAINS_ANY`, `NOT_CONTAINS_ANY`, `STARTS_WITH_ANY`,
`IS_EMPTY`, `NOT_EMPTY`. Trường ảo `search_text` ghép nội dung hạch toán, diễn giải,
tên khoản mục chi phí và số chứng từ; so khớp không phân biệt hoa/thường hay dấu tiếng
Việt. Điều kiện phải mô tả nghiệp vụ, không dùng tên một cá nhân/nhà cung cấp cụ thể.

```json
{
  "logic": "ANY",
  "conditions": [
    { "field": "cash_flow_code", "operator": "EQUALS_ANY", "value": ["14"] },
    { "field": "search_text", "operator": "CONTAINS_ANY", "value": ["lãi vay", "trả lãi"] }
  ]
}
```

`sourceKey` được so với cả khóa kết nối thật và `base_source_key`, vì mỗi công ty/
khối MISA có một khóa kết nối riêng. Với sổ chi tiết, worker dùng các trường chuẩn
`debit_account`, `credit_account`, `amount`, `entry_type`, `is_closing_entry`,
`is_reversal`, `intercompany_partner` và các trường trong `filters`. Tên cột nguồn
khác chuẩn phải được khai báo bằng `SOURCE_FIELD_MAPPING`.

Những dòng tiền không thể xác định chắc chắn chỉ bằng cặp tài khoản phải khai báo
`conditionKey` và `conditionRequirement: "REQUIRED"` (hoặc
`classificationPolicy: "REQUIRE_CASH_FLOW_CODE_OR_APPROVED_ADJUSTMENT"`). Khi bút
toán phù hợp cặp tài khoản nhưng thiếu mã dòng tiền, worker không tự gán số: dòng đó
loại bút toán chưa phân loại, ghi `blockingIssues`, tạo kiểm tra thất bại và đặt
`controlStatus: "NEEDS_REVIEW"`. Kế toán chỉ được bổ sung qua mã nguồn hợp lệ hoặc
`MANUAL_ADJUSTMENT` đã duyệt có lịch sử; không tạo số bù từ chênh lệch báo cáo.

Riêng nguồn MISA `GENERAL_LEDGER`, worker chuẩn hóa trực tiếp các cột
`account_number`, `corresponding_account_number`, `debit_amount`, `credit_amount` thành
`debit_account`, `credit_account`, `amount`. MISA trả hai dòng đối xứng cho cùng một định
khoản; PostgreSQL giữ cả hai dòng nguồn để kiểm toán nhưng chỉ dòng Nợ được đưa vào bảng
định khoản chuẩn và bảng tổng hợp tháng. Snapshot bị từ chối nếu hai vế không phủ nhau hoặc
tổng Nợ khác tổng Có.

Một snapshot Nhật ký chung cả năm có thể phục vụ báo cáo tháng nằm trong khoảng của nó.
Khi kỳ chọn là trọn tháng/trọn năm, worker đọc bảng tổng hợp tháng cho các công thức thông
thường. Nếu một thành phần dùng `search_text`, diễn giải hoặc số chứng từ, worker tự nạp
thêm định khoản chi tiết và chỉ thành phần đó đọc dòng chi tiết; các thành phần khác vẫn dùng
bảng tháng để không cộng trùng và không làm chậm toàn báo cáo. Kỳ lẻ ngày đọc định khoản
chi tiết.

Kỳ cột dùng `periodSelector` thay vì suy đoán từ nhãn:

- `CURRENT_RANGE`: đúng khoảng người dùng chọn.
- `SAME_RANGE_PRIOR_YEAR`: cùng khoảng của năm trước.
- `OPENING_OF_CURRENT_RANGE`: số dư đầu kỳ của chính snapshot hiện tại.
- `END_OF_PRIOR_YEAR`: dùng số đầu kỳ hiện tại khi hai kỳ đã nối và đối chiếu.

Các kiểm tra phát hành tối thiểu: tổng tài sản bằng tổng nguồn vốn; lợi nhuận sau
thuế nối sang dòng lợi nhuận kỳ này của vốn chủ sở hữu; tiền cuối kỳ LCTT bằng tiền
trên báo cáo tình hình tài chính; số đầu tháng 01 bằng số cuối năm trước.

## Xuất Excel

`POST /report/export` nhận payload giống `/report/output`, thêm:

```json
{ "format": "XLSX", "fileName": "Bảng cân đối kế toán" }
```

Kết quả gồm `base64`, `mimeType`, `fileName`, `sha256`, `byteSize`, `rowCount`.
Next.js giải mã và trả file tải về hoặc lưu Cloud Storage; không chuyển base64 vào
state/bảng PostgreSQL.

## Mã lỗi

- `400`: payload/cấu hình/công thức không hợp lệ.
- `401`: sai worker secret hoặc phiên MISA hết hạn.
- `403`: tài khoản MISA không còn quyền khối dữ liệu.
- `404`: nguồn/phiên bản/mẫu không tồn tại.
- `409`: schema chưa sẵn sàng hoặc trạng thái không thể tiếp tục.
- `413`: số dòng/kích thước file vượt giới hạn.
- `502`: MISA lỗi hoặc trả dữ liệu không hợp lệ.
- `503`: thiếu secret/database hoặc PostgreSQL chưa sẵn sàng.
