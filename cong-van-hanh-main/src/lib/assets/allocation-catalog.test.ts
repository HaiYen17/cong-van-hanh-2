import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetCatalogItemDto,
  StationeryItemDto,
  UniformItemDto,
} from "./setup-types";
import {
  normalizeUniformSize,
  UNIFORM_SIZE_OPTIONS,
} from "./setup-types";
import {
  ALLOCATION_CATEGORY,
  buildAllocationCatalog,
} from "./allocation-catalog";

const image = (url: string) => ({
  fileId: "",
  legacyDriveId: "",
  name: "hinh-minh-hoa.png",
  url,
});

const assetItem = (
  overrides: Partial<AssetCatalogItemDto>,
): AssetCatalogItemDto => ({
  assetType: "",
  code: "",
  depreciationPeriod: "",
  descriptorGroups: [],
  functionAreas: [],
  heightCm: "",
  id: "asset",
  image: image(""),
  lengthCm: "",
  name: "Tài sản",
  note: "",
  productValue: "",
  status: "Kích hoạt",
  updatedAt: "",
  updatedBy: "",
  warrantyPeriod: "",
  widthCm: "",
  ...overrides,
});

const stationeryItem = (
  overrides: Partial<StationeryItemDto>,
): StationeryItemDto => ({
  code: "",
  color: "",
  id: "stationery",
  image: image(""),
  name: "Văn phòng phẩm",
  note: "",
  packageLabel: "",
  packageQuantity: "",
  packageUnit: "",
  status: "Kích hoạt",
  thickness: "",
  updatedAt: "",
  updatedBy: "",
  ...overrides,
});

const uniformItem = (
  overrides: Partial<UniformItemDto>,
): UniformItemDto => ({
  code: "",
  femaleSizes: [],
  id: "uniform",
  image: image(""),
  maleSizes: [],
  name: "Đồng phục",
  note: "",
  status: "Kích hoạt",
  updatedAt: "",
  updatedBy: "",
  ...overrides,
});

test("danh sách size đồng phục dùng đúng nhãn XS và S", () => {
  assert.deepEqual(UNIFORM_SIZE_OPTIONS, [
    "XS",
    "S",
    "M",
    "L",
    "XL",
    "2XL",
    "3XL",
    "4XL",
    "5XL",
  ]);
  assert.equal(normalizeUniformSize("SX"), "XS");
  assert.equal(normalizeUniformSize("X"), "S");
});

test("danh mục cấp phát lấy ảnh CCDC nhưng không tạo mô tả tài sản", () => {
  const catalog = buildAllocationCatalog({
    assets: [
      assetItem({
        id: "asset-1",
        image: image("/api/assets/files/asset-image"),
        name: "Ghế văn phòng",
      }),
    ],
    stationeryItems: [],
    uniformItems: [],
  });

  assert.deepEqual(catalog, [
    {
      category: ALLOCATION_CATEGORY.asset,
      description: "",
      id: "asset-1",
      imageUrl: "/api/assets/files/asset-image",
      name: "Ghế văn phòng",
      sizeOptions: [],
    },
  ]);
});

test("mô tả văn phòng phẩm chỉ ghép màu sắc và tính chất", () => {
  const catalog = buildAllocationCatalog({
    assets: [],
    stationeryItems: [
      stationeryItem({
        color: "Xanh dương",
        id: "stationery-1",
        name: "Bìa hồ sơ",
        thickness: "Dày",
      }),
    ],
    uniformItems: [],
  });

  assert.equal(catalog[0]?.description, "Màu sắc: Xanh dương · Tính chất: Dày");
});

test("mỗi mẫu đồng phục chỉ nhận đúng các size đã cấu hình cho mẫu đó", () => {
  const catalog = buildAllocationCatalog({
    assets: [],
    stationeryItems: [],
    uniformItems: [
      uniformItem({
        femaleSizes: ["S"],
        id: "uniform-1",
        maleSizes: ["M", "L"],
        name: "Áo polo",
      }),
      uniformItem({
        femaleSizes: ["XL"],
        id: "uniform-2",
        maleSizes: [],
        name: "Áo khoác",
      }),
    ],
  });

  assert.deepEqual(catalog[0]?.sizeOptions, [
    { group: "Nam", size: "M", value: "Nam · M" },
    { group: "Nam", size: "L", value: "Nam · L" },
    { group: "Nữ", size: "S", value: "Nữ · S" },
  ]);
  assert.deepEqual(catalog[1]?.sizeOptions, [
    { group: "Nữ", size: "XL", value: "Nữ · XL" },
  ]);
});
