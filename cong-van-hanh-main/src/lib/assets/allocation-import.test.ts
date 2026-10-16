import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOCATION_CATEGORY,
  type AllocationCatalogItem,
} from "./allocation-catalog";
import {
  ALLOCATION_IMPORT_HEADERS,
  parseAllocationImport,
  type AllocationImportEmployee,
} from "./allocation-import";

const employees: AllocationImportEmployee[] = [
  {
    employeeCode: "NV001",
    fullName: "Nguyễn Văn An",
    id: "employee-1",
    label: "Nguyễn Văn An · NV001 · Hành chính",
  },
  {
    employeeCode: "NV002",
    fullName: "Trần Thị Bình",
    id: "employee-2",
    label: "Trần Thị Bình · NV002 · Kinh doanh",
  },
];

const catalog: AllocationCatalogItem[] = [
  {
    category: ALLOCATION_CATEGORY.asset,
    description: "",
    id: "asset-1",
    imageUrl: "",
    name: "Ghế văn phòng",
    sizeOptions: [],
  },
  {
    category: ALLOCATION_CATEGORY.stationery,
    description: "Màu sắc: Xanh · Tính chất: Dày",
    id: "stationery-1",
    imageUrl: "",
    name: "Bìa hồ sơ",
    sizeOptions: [],
  },
  {
    category: ALLOCATION_CATEGORY.uniform,
    description: "",
    id: "uniform-1",
    imageUrl: "",
    name: "Áo polo",
    sizeOptions: [
      { group: "Nam", size: "M", value: "Nam · M" },
      { group: "Nữ", size: "M", value: "Nữ · M" },
      { group: "Nữ", size: "S", value: "Nữ · S" },
    ],
  },
];

test("nạp danh sách hợp lệ bằng mã nhân viên hoặc họ tên", () => {
  const result = parseAllocationImport(
    [
      [...ALLOCATION_IMPORT_HEADERS],
      ["NV001", "Nguyễn Văn An", "Tài sản", "Ghế văn phòng", "", 2],
      ["", "Tran Thi Binh", "VPP", "Bìa hồ sơ", "nội dung bị bỏ qua", 3],
      ["NV002", "", "Đồng phục", "Áo polo", "Nữ_S", 1],
    ],
    catalog,
    employees,
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items[0], {
    assignee: employees[0].label,
    assigneeId: "employee-1",
    category: ALLOCATION_CATEGORY.asset,
    description: "",
    itemName: "Ghế văn phòng",
    quantity: "2",
  });
  assert.equal(result.items[1]?.description, catalog[1].description);
  assert.equal(result.items[2]?.description, "Nữ · S");
});

test("tìm được hàng tiêu đề sau phần ghi chú đầu file", () => {
  const result = parseAllocationImport(
    [
      ["MẪU NẠP DANH SÁCH CẤP PHÁT"],
      ["Giữ nguyên tiêu đề"],
      [],
      [...ALLOCATION_IMPORT_HEADERS],
      ["NV001", "", "CCDC/tài sản", "Ghế văn phòng", "", 1],
    ],
    catalog,
    employees,
  );

  assert.equal(result.headerRow, 4);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.errors, []);
});

test("báo lỗi theo đúng dòng và không tự đoán size đồng phục bị trùng giới tính", () => {
  const result = parseAllocationImport(
    [
      [...ALLOCATION_IMPORT_HEADERS],
      ["NV999", "", "Đồng phục", "Áo polo", "M", 0],
    ],
    catalog,
    employees,
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.errors[0]?.row, 2);
  assert.match(result.errors[0]?.message || "", /Không tìm thấy mã nhân viên/);
  assert.match(result.errors[0]?.message || "", /cả Nam và Nữ/);
  assert.match(result.errors[0]?.message || "", /Nam_M/);
  assert.match(result.errors[0]?.message || "", /Số lượng phải/);
});

test("báo thiếu hàng tiêu đề bắt buộc", () => {
  const result = parseAllocationImport(
    [["Nhân viên", "Mặt hàng"], ["NV001", "Ghế văn phòng"]],
    catalog,
    employees,
  );

  assert.equal(result.headerRow, null);
  assert.equal(result.items.length, 0);
  assert.match(result.errors[0]?.message || "", /Không tìm thấy hàng tiêu đề/);
});
