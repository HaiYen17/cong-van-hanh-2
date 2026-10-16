import fs from "node:fs";
import path from "node:path";

import {
  PORTAL_MODULE_INVENTORY,
  VISIBLE_PORTAL_MODULE_KEYS,
} from "@/lib/legacy-portal-catalog";

type BaselineItem = { href: string; key: string };

const root = process.cwd();
const baselinePath = path.join(root, "docs", "deploy-module-baseline.json");
const appRoot = path.join(root, "src", "app");
const baseline = JSON.parse(
  fs.readFileSync(baselinePath, "utf8"),
) as BaselineItem[];

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function routeHasPage(route: string) {
  let candidates = [appRoot];
  for (const segment of route.split("/").filter(Boolean)) {
    candidates = candidates.flatMap((parent) => {
      if (!fs.existsSync(parent)) return [];
      const entries = fs.readdirSync(parent, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (entry.name === segment || /^\[.+\]$/.test(entry.name)),
        )
        .map((entry) => path.join(parent, entry.name));
    });
  }
  return candidates.some((candidate) =>
    ["page.tsx", "page.ts", "page.jsx", "page.js"].some((file) =>
      fs.existsSync(path.join(candidate, file)),
    ),
  );
}

const errors: string[] = [];
const inventoryKeys = PORTAL_MODULE_INVENTORY.map((item) => item.key);
const baselineKeys = baseline.map((item) => item.key);
const duplicateInventoryKeys = duplicateValues(inventoryKeys);
const duplicateBaselineKeys = duplicateValues(baselineKeys);

if (duplicateInventoryKeys.length) {
  errors.push(`Catalog trùng key: ${duplicateInventoryKeys.join(", ")}`);
}
if (duplicateBaselineKeys.length) {
  errors.push(`Baseline trùng key: ${duplicateBaselineKeys.join(", ")}`);
}

const inventoryByKey = new Map(
  PORTAL_MODULE_INVENTORY.map((item) => [item.key, item]),
);
const baselineByKey = new Map(baseline.map((item) => [item.key, item]));

for (const expected of baseline) {
  const actual = inventoryByKey.get(expected.key);
  if (!actual) {
    errors.push(`Mất module đã chốt: ${expected.key}`);
    continue;
  }
  if (actual.href !== expected.href) {
    errors.push(
      `Route ${expected.key} đổi ngoài baseline: ${expected.href} -> ${actual.href ?? "(trống)"}`,
    );
  }
}

for (const actual of PORTAL_MODULE_INVENTORY) {
  if (!baselineByKey.has(actual.key)) {
    errors.push(
      `Module mới chưa cập nhật baseline: ${actual.key} (${actual.href ?? "chưa có route"})`,
    );
  }
  if (!actual.href) {
    errors.push(`Module chưa có route: ${actual.key}`);
  } else if (!routeHasPage(actual.href)) {
    errors.push(`Route không có page thực thi: ${actual.key} -> ${actual.href}`);
  }
}

const visibleKeys = new Set(VISIBLE_PORTAL_MODULE_KEYS);
for (const item of PORTAL_MODULE_INVENTORY) {
  if (!visibleKeys.has(item.sourceKey)) {
    errors.push(
      `Module ${item.key} dùng quyền ${item.sourceKey} nhưng quyền không nằm trong danh sách hiển thị.`,
    );
  }
}

const criticalExplicitPages = [
  "src/app/cau-hinh/hunonic/page.tsx",
  "src/app/nguoi-thuan-viet/dieu-khien-may-lanh/page.tsx",
];
for (const relativePath of criticalExplicitPages) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    errors.push(`Thiếu trang máy lạnh bắt buộc: ${relativePath}`);
  }
}

const criticalInboxPages = [
  "public/legacy/inbox-me.html",
  "public/legacy/inbox-admin.html",
];
for (const relativePath of criticalInboxPages) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, "utf8")
    : "";
  if (
    !source.includes("function getInboxDocumentList") ||
    !source.includes("getInboxDocumentList: getInboxDocumentList") ||
    !source.includes("InboxSharedUtil.getInboxDocumentList") ||
    (relativePath.endsWith("inbox-admin.html") &&
      (!source.includes("InboxSharedUtil.formatInboxDateOnly") ||
        !source.includes("var mappedDocumentTitle") ||
        !source.includes("const isAssetAllocation =") ||
        !source.includes("Danh sách nhân sự và hạng mục đăng ký") ||
        !source.includes("documentNames: InboxSharedUtil.getInboxDocumentList"))) ||
    !source.includes('class="ticketDocumentSummary"') ||
    !source.includes("const documentPreviewNames = documentNames.slice(0, 6)") ||
    !source.includes("Chờ người nhận xác nhận") ||
    !source.includes("Người nhận đã nhận") ||
    (relativePath.endsWith("inbox-me.html") &&
      (!source.includes('id="allocationReceiptPanelMe"') ||
        !source.includes('id="btnConfirmAllocationReceiptMe"') ||
        !source.includes("function confirmAllocationReceiptMe") ||
        !source.includes("confirmMyAllocationReceipt")))
  ) {
    errors.push(
      `Trang đơn hàng đã bị dựng lùi về bản cũ: ${relativePath}. Chạy LEGACY_PARITY_SCOPE=inbox npm run build:legacy-parity trước khi deploy.`,
    );
  }
}

const configTabsPath = path.join(
  root,
  "src",
  "app",
  "cau-hinh",
  "config-tabs.tsx",
);
const configTabsSource = fs.existsSync(configTabsPath)
  ? fs.readFileSync(configTabsPath, "utf8")
  : "";
if (
  !configTabsSource.includes('href: "/cau-hinh/hunonic"') ||
  !configTabsSource.includes('key: "hunonic"') ||
  !configTabsSource.includes('label: "Hunonic"')
) {
  errors.push(
    "Module Cấu hình đã mất tab Hunonic hoặc tab không còn trỏ tới /cau-hinh/hunonic.",
  );
}

if (errors.length) {
  console.error("\nCHẶN BUILD/DEPLOY: danh mục module không còn khớp baseline.\n");
  for (const error of errors) console.error(`- ${error}`);
  console.error(
    "\nChỉ cập nhật docs/deploy-module-baseline.json khi user đã xác nhận thêm, đổi hoặc bỏ module.",
  );
  process.exit(1);
}

console.log(
  `Deploy module guard: ${PORTAL_MODULE_INVENTORY.length} card, ${VISIBLE_PORTAL_MODULE_KEYS.length} quyền nguồn và toàn bộ route đều hợp lệ.`,
);
