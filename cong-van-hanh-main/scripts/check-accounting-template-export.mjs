import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checks = [
  {
    file: "src/app/cau-hinh/bao-cao-ke-toan/accounting-config-frame.tsx",
    markers: ["/legacy/accounting-config.html"],
  },
  {
    file: "public/legacy/accounting-config.html",
    markers: [
      "accountingBuilderExportTemplateTop",
      "accountingBuilderExportTemplate",
      'data-accounting-open-file-import',
      'data-accounting-sync-mode="file"',
      'data-accounting-sync-pane="file"',
      "previewAccountingDataFileImport",
      "importAccountingDataFile",
      "accountingFormulaExportDialog",
      "data-accounting-enable-presentation-formula",
      "builderCellUsesFormulaDialog",
      "data-accounting-preview-formula-cell",
      "downloadAccountingExport",
      "parsedUrl.pathname.indexOf('/api/accounting/files/') === 0",
      "fetch(requestUrl, { credentials: 'same-origin', redirect: 'error' })",
      "URL.createObjectURL(blob)",
      'reason === "close-control"',
      "Công thức kèm số liệu chứng minh",
      "Xuất công thức",
      "exportAccountingConfiguredReportTemplate",
    ],
    forbiddenMarkers: [
      "link.href = url; link.download = result.fileName",
      '<option value="MANUAL_ADJUSTMENT"',
      ">Điều chỉnh đã duyệt</option>",
    ],
  },
  {
    file: "src/lib/accounting/rpc.ts",
    markers: ["case \"exportAccountingConfiguredReportTemplate\""],
  },
  {
    file: "src/lib/accounting/export-storage.ts",
    markers: ["return `/api/accounting/files/${encodeURIComponent(fileId)}`;"],
    forbiddenMarkers: ["process.env.APP_URL"],
  },
  {
    file: "src/lib/accounting/import-export.ts",
    markers: [
      "export async function exportAccountingConfiguredReportTemplate",
      "Nguồn số liệu đã dùng",
      "Báo cáo & chứng minh",
      "Công thức dễ hiểu",
      "Số liệu chứng minh",
      "Phép tính bằng số",
      "Đường đi của từng số",
      "hệ thống không tự tạo số bù",
    ],
  },
  {
    file: "services/accounting-worker/report_engine.py",
    markers: [
      "include_evidence",
      '"evidence"',
      "_term_evidence_components",
      "decompose_linear_expression",
      "Hệ thống không tự tạo số bù",
    ],
    optionalWhenAbsent: true,
  },
];

const failures = [];
for (const check of checks) {
  const absolutePath = path.join(root, check.file);
  if (!fs.existsSync(absolutePath)) {
    if (check.optionalWhenAbsent) continue;
    failures.push(`${check.file}: không tồn tại`);
    continue;
  }
  const source = fs.readFileSync(absolutePath, "utf8");
  for (const marker of check.markers) {
    if (!source.includes(marker)) failures.push(`${check.file}: thiếu ${marker}`);
  }
  for (const marker of check.forbiddenMarkers || []) {
    if (source.includes(marker)) failures.push(`${check.file}: còn luồng điều hướng nguy hiểm ${marker}`);
  }
}

if (failures.length) {
  console.error("Không được build: chức năng xuất mẫu hoặc nạp Excel của Báo cáo Kế toán đang bị thiếu hoặc bị ghi đè.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Chức năng xuất mẫu và nạp Excel Báo cáo Kế toán còn đầy đủ trên giao diện V3 đang phục vụ.");
