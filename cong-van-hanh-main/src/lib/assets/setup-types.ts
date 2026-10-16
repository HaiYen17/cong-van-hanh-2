export const ASSET_OPTION_KINDS = [
  { key: "assetType", label: "Loại CCDC" },
  { key: "functionArea", label: "Công năng/ Khu vực bố trí" },
  { key: "shape", label: "Đặc điểm/ hình dạng" },
  { key: "fillerPhrase", label: "Cụm từ đệm" },
  { key: "material", label: "Chất liệu" },
  { key: "color", label: "Màu sắc" },
] as const;

export type AssetOptionKind = (typeof ASSET_OPTION_KINDS)[number]["key"];

export const UNIFORM_SIZE_OPTIONS = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
] as const;

export type UniformSize = (typeof UNIFORM_SIZE_OPTIONS)[number];

export function normalizeUniformSize(value: unknown): UniformSize | "" {
  const key = String(value ?? "").trim().toUpperCase();
  const compatibleKey = key === "SX" ? "XS" : key === "X" ? "S" : key;
  return UNIFORM_SIZE_OPTIONS.find((size) => size === compatibleKey) ?? "";
}

export type AssetColor = {
  colorHex: string;
  name: string;
};

export type AssetDescriptorGroup = {
  colors: AssetColor[];
  fillerPhrases: string[];
  materials: string[];
  shapes: string[];
};

export type AssetOptionDto = {
  colorHex: string;
  id: string;
  kind: AssetOptionKind;
  kindLabel: string;
  name: string;
  status: string;
  updatedAt: string;
  updatedBy: string;
};

export type AssetImageDto = {
  fileId: string;
  legacyDriveId: string;
  name: string;
  url: string;
};

export type AssetCatalogItemDto = {
  assetType: string;
  code: string;
  depreciationPeriod: string;
  descriptorGroups: AssetDescriptorGroup[];
  functionAreas: string[];
  heightCm: string;
  id: string;
  image: AssetImageDto;
  lengthCm: string;
  name: string;
  note: string;
  productValue: string;
  status: string;
  updatedAt: string;
  updatedBy: string;
  warrantyPeriod: string;
  widthCm: string;
};

export type StationeryItemDto = {
  code: string;
  color: string;
  id: string;
  image: AssetImageDto;
  name: string;
  note: string;
  packageLabel: string;
  packageQuantity: string;
  packageUnit: string;
  status: string;
  thickness: string;
  updatedAt: string;
  updatedBy: string;
};

export type UniformItemDto = {
  code: string;
  femaleSizes: string[];
  id: string;
  image: AssetImageDto;
  maleSizes: string[];
  name: string;
  note: string;
  status: string;
  updatedAt: string;
  updatedBy: string;
};

export type AssetBackgroundJobStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed";

export type AssetBackgroundJobDto = {
  attempts: number;
  completedAt: string;
  createdAt: string;
  id: string;
  itemName: string;
  itemType: "asset" | "stationery" | "uniform";
  message: string;
  originalImage: AssetImageDto;
  processedImage: AssetImageDto;
  progress: number;
  startedAt: string;
  status: AssetBackgroundJobStatus;
  updatedAt: string;
};

export type AssetSetupEnvironmentDto = {
  geminiConfigured: boolean;
  geminiModel: string;
  gcsConfigured: boolean;
  imageFolderConfigured: boolean;
  rootFolderConfigured: boolean;
  stationeryFolderConfigured: boolean;
  uniformFolderConfigured: boolean;
  workerConfigured: boolean;
};

export type AssetSetupSnapshot = {
  assets: AssetCatalogItemDto[];
  backgroundJobs: AssetBackgroundJobDto[];
  environment: AssetSetupEnvironmentDto;
  optionKinds: typeof ASSET_OPTION_KINDS;
  options: AssetOptionDto[];
  stationeryItems: StationeryItemDto[];
  uniformItems: UniformItemDto[];
  uniformSizeOptions: readonly string[];
};

export type AssetDraftInput = {
  assetNameOverride: string;
  assetType: string;
  depreciationPeriod: string;
  descriptorGroups: AssetDescriptorGroup[];
  functionAreas: string[];
  heightCm: string;
  lengthCm: string;
  note: string;
  productValue: string;
  warrantyPeriod: string;
  widthCm: string;
};

export type StationeryDraftInput = {
  color: string;
  name: string;
  note: string;
  packageQuantity: string;
  packageUnit: string;
  thickness: string;
};

export type UniformDraftInput = {
  femaleSizes: string[];
  maleSizes: string[];
  name: string;
  note: string;
};

export type AssetInvoiceSuggestion = AssetDraftInput & {
  amount: string;
  generatedName: string;
  invoiceItemName: string;
  lowSignificance: boolean;
  quantity: string;
  sourceLines: string[];
  unit: string;
  unitPrice: string;
};

export type AssetSetupActionResult<T = undefined> = {
  data?: T;
  message: string;
  ok: boolean;
};
