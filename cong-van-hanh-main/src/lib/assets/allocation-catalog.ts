import type {
  AssetCatalogItemDto,
  StationeryItemDto,
  UniformItemDto,
} from "./setup-types";

export const ALLOCATION_CATEGORY = {
  asset: "CCDC/tài sản",
  stationery: "Văn phòng phẩm",
  uniform: "Đồng phục",
} as const;

export type AllocationCategory =
  (typeof ALLOCATION_CATEGORY)[keyof typeof ALLOCATION_CATEGORY];

export type AllocationSizeOption = {
  group: "Nam" | "Nữ";
  size: string;
  value: string;
};

export type AllocationCatalogItem = {
  category: AllocationCategory;
  description: string;
  id: string;
  imageUrl: string;
  name: string;
  sizeOptions: AllocationSizeOption[];
};

type AllocationCatalogSource = {
  assets: AssetCatalogItemDto[];
  stationeryItems: StationeryItemDto[];
  uniformItems: UniformItemDto[];
};

function stationeryDescription(item: StationeryItemDto) {
  return [
    item.color ? `Màu sắc: ${item.color}` : "",
    item.thickness ? `Tính chất: ${item.thickness}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function uniformSizeOptions(item: UniformItemDto): AllocationSizeOption[] {
  return [
    ...item.maleSizes.map((size) => ({
      group: "Nam" as const,
      size,
      value: `Nam · ${size}`,
    })),
    ...item.femaleSizes.map((size) => ({
      group: "Nữ" as const,
      size,
      value: `Nữ · ${size}`,
    })),
  ];
}

export function buildAllocationCatalog(
  source: AllocationCatalogSource,
): AllocationCatalogItem[] {
  return [
    ...source.assets.map((item) => ({
      category: ALLOCATION_CATEGORY.asset,
      description: "",
      id: item.id,
      imageUrl: item.image.url,
      name: item.name,
      sizeOptions: [],
    })),
    ...source.stationeryItems.map((item) => ({
      category: ALLOCATION_CATEGORY.stationery,
      description: stationeryDescription(item),
      id: item.id,
      imageUrl: item.image.url,
      name: item.name,
      sizeOptions: [],
    })),
    ...source.uniformItems.map((item) => ({
      category: ALLOCATION_CATEGORY.uniform,
      description: "",
      id: item.id,
      imageUrl: item.image.url,
      name: item.name,
      sizeOptions: uniformSizeOptions(item),
    })),
  ];
}
