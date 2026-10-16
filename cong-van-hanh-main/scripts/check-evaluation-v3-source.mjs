import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(
  projectRoot,
  "scripts",
  "v3-parity",
  "evaluation-config.html",
);
const outputPath = path.join(
  projectRoot,
  "public",
  "legacy",
  "evaluation-config.html",
);

for (const filePath of [sourcePath, outputPath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Thiếu file cấu hình CnB V3: ${filePath}`);
  }
}

const source = fs.readFileSync(sourcePath);
const output = fs.readFileSync(outputPath);
if (!source.equals(output)) {
  throw new Error(
    "evaluation-config.html không khớp nguồn V3. Chạy npm run build:legacy-parity trước khi build/deploy.",
  );
}

const sourceText = source.toString("utf8");

function extractFunction(name) {
  const match = sourceText.match(
    new RegExp(`  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`),
  );
  if (!match) {
    throw new Error(`Không tìm thấy hàm ${name} trong nguồn Cấu hình đánh giá.`);
  }
  return match[0].trim();
}

const scoreFunctionSource = [
  extractFunction("monitorScoreInputMeta"),
  extractFunction("monitorScoreValueForRole"),
  extractFunction("monitorScorePercentForRole"),
].join("\n");
const scoreHelpers = new Function(
  "normalizeKey",
  "monitorRolePrefix",
  `${scoreFunctionSource}\nreturn { monitorScoreInputMeta, monitorScorePercentForRole };`,
)((value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim(),
  (role) => (role === "self" ? "employee" : role),
);

const scoreScaleCases = [
  {
    expectedMax: 5,
    expectedPercent: 100,
    method: "scale_5",
    score: 5,
  },
  {
    expectedMax: 10,
    expectedPercent: 100,
    method: "scale_10",
    score: 10,
  },
  {
    expectedMax: 100,
    expectedPercent: 100,
    method: "percent",
    score: 100,
  },
];

for (const testCase of scoreScaleCases) {
  const score = {
    managerScore: testCase.score,
    scoringMethod: testCase.method,
  };
  const meta = scoreHelpers.monitorScoreInputMeta(score);
  const percent = scoreHelpers.monitorScorePercentForRole(score, "manager");
  if (meta.max !== testCase.expectedMax || percent !== testCase.expectedPercent) {
    throw new Error(
      `Sai chuẩn hóa biểu đồ ${testCase.method}: max=${meta.max}, percent=${percent}.`,
    );
  }
}

console.log(
  "Nguồn V3 và public/legacy/evaluation-config.html đang đồng bộ; chuẩn hóa thang điểm biểu đồ đạt yêu cầu.",
);
