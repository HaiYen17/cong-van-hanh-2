import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOCATION_CATEGORY,
  type AllocationCatalogItem,
} from "./allocation-catalog";
import { validateAllocationRequestPayload } from "./allocation-request-validation";

const catalog: AllocationCatalogItem[] = [
  {
    category: ALLOCATION_CATEGORY.stationery,
    description: "Màu sắc: Xanh",
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
    sizeOptions: [{ group: "Nam", size: "M", value: "Nam · M" }],
  },
];

test("backend chuẩn hóa mô tả và số lượng trước khi lưu PostgreSQL", () => {
  const result = validateAllocationRequestPayload(
    {
      items: [
        {
          assignee: "Nguyễn Văn An",
          category: "van phong pham",
          description: "không dùng nội dung từ client",
          itemName: "Bia ho so",
          quantity: 2,
        },
      ],
      submittedFrom: "nguoi-thuan-viet",
    },
    catalog,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const items = result.payload.items as Array<Record<string, unknown>>;
  assert.equal(result.payload.itemCount, 1);
  assert.equal(items[0]?.description, "Màu sắc: Xanh");
  assert.equal(items[0]?.quantity, "2");
  assert.equal(items[0]?.itemName, "Bìa hồ sơ");
});

test("backend từ chối size đồng phục không có trong Setup tài sản", () => {
  const result = validateAllocationRequestPayload(
    {
      items: [
        {
          category: "Đồng phục",
          description: "Nữ · M",
          itemName: "Áo polo",
          quantity: 1,
        },
      ],
    },
    catalog,
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /Mục 1/);
  assert.match(result.error, /size/);
});

test("backend từ chối payload rỗng hoặc số lượng không hợp lệ", () => {
  assert.deepEqual(validateAllocationRequestPayload({}, catalog), {
    error: "Danh sách cấp phát chưa có mục nào.",
    ok: false,
  });

  const result = validateAllocationRequestPayload(
    {
      items: [
        {
          category: "Văn phòng phẩm",
          itemName: "Bìa hồ sơ",
          quantity: 1.5,
        },
      ],
    },
    catalog,
  );
  assert.equal(result.ok, false);
});
