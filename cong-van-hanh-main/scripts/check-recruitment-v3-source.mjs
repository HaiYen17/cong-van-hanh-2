import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const pages = [
  "recruitment-management.html",
  "recruitment-assessment.html",
  "recruitment-results.html",
];

for (const page of pages) {
  const sourcePath = path.join(projectRoot, "scripts", "v3-parity", page);
  const outputPath = path.join(projectRoot, "public", "legacy", page);
  for (const filePath of [sourcePath, outputPath]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Thiếu file Tuyển dụng V3: ${filePath}`);
    }
  }
  if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(outputPath))) {
    throw new Error(
      `${page} không khớp nguồn V3. Chạy npm run build:legacy-parity trước khi build/deploy.`,
    );
  }
}

console.log("Ba trang Tuyển dụng đang khớp nguồn V3 được bảo vệ.");
