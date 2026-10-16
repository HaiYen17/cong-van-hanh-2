import "server-only";

import { getDb } from "@/lib/db";
import { previewDocumentNumber } from "@/lib/document-issue";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
const db = getDb();
const [rules, templates, registryPairs] = await Promise.all([
  db.documentTypeCompanyNumbering.findMany({
    include: { company: true, documentType: true },
  }),
  db.configurationRecord.findMany({ where: { recordType: "template" } }),
  db.documentRegistry.findMany({
    distinct: ["documentTypeId", "companyId"],
    select: { companyId: true, documentTypeId: true },
    where: {
      companyId: { not: null },
      documentType: { status: "ACTIVE", takesNumber: true },
      documentTypeId: { not: null },
      status: "ISSUED",
    },
  }),
]);

const invalidRules = rules.filter(
  (rule) =>
    rule.startIndex < 1 ||
    rule.company.status !== "ACTIVE" ||
    rule.documentType.status !== "ACTIVE" ||
    !rule.documentType.takesNumber,
);
if (invalidRules.length) {
  throw new Error(`Có ${invalidRules.length} quy tắc pháp nhân không hợp lệ.`);
}

let linkedTemplates = 0;
for (const template of templates) {
  const content = record(template.content);
  const documentTypeId = String(
    content["Mã loại hồ sơ đánh số"] ||
      content.numberingDocumentTypeId ||
      "",
  ).trim();
  if (!documentTypeId) continue;
  linkedTemplates += 1;
  const documentType = await db.documentType.findFirst({
    where: { id: documentTypeId, status: "ACTIVE", takesNumber: true },
  });
  if (!documentType) {
    throw new Error(`Biểu mẫu ${template.name} liên kết loại hồ sơ không hợp lệ.`);
  }
  const fields = array(content["JSON trường"] || content.fields).map(record);
  const hasDocumentNumber = fields.some(
    (field) =>
      String(field.datasetKey || "") === "system" &&
      String(field.sourceFieldKey || "") === "documentNumber" &&
      !field.isTableField,
  );
  if (!hasDocumentNumber) {
    throw new Error(`Biểu mẫu ${template.name} thiếu biến Số văn bản được cấp.`);
  }
}

let previewsChecked = 0;
for (const pair of registryPairs.slice(0, 25)) {
  if (!pair.companyId || !pair.documentTypeId) continue;
  const preview = await previewDocumentNumber(db, {
    companyId: pair.companyId,
    documentTypeId: pair.documentTypeId,
    signDate: new Date(),
  });
  if (!preview.ok) {
    throw new Error(
      `Không dựng được số dự kiến cho ${pair.documentTypeId}/${pair.companyId}: ${preview.error}`,
    );
  }
  previewsChecked += 1;
}

console.log(
  JSON.stringify(
    {
      linkedTemplates,
      ok: true,
      previewsChecked,
      rules: rules.length,
      templates: templates.length,
    },
    null,
    2,
  ),
);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
