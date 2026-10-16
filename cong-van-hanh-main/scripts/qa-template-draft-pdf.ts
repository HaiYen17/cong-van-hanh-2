import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Storage } from "@google-cloud/storage";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  deleteTemplateDraftPreview,
  generateTemplateDraftPreview,
  getTemplateFormDefinition,
  getTemplateWorkspaceSnapshot,
} from "@/lib/templates/runtime";

function sampleValue(inputType: string, label: string) {
  if (inputType === "date") return new Date().toISOString().slice(0, 10);
  if (inputType === "number") return "1";
  if (inputType === "checkbox") return "Có";
  return `Dữ liệu kiểm tra ${label}`;
}

async function main() {
  const db = getDb();
  const user = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { employeeId: { not: null }, status: "ACTIVE" },
  });
  if (!user) throw new Error("Không tìm thấy tài khoản đang hoạt động để QA.");

  const session: AppSession = {
    displayName: user.displayName,
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: ["super-admin"],
    userId: user.id,
  };
  const snapshot = await getTemplateWorkspaceSnapshot(session);
  const template = snapshot.templates[0];
  if (!template) throw new Error("Không có biểu mẫu đang hoạt động để QA.");

  const initialDefinition = (
    await getTemplateFormDefinition(session, {
      templateId: template.templateId,
    })
  ).formDefinition;
  const companyId =
    initialDefinition.resolvedCompanyId ||
    initialDefinition.companyOptions[0]?.value ||
    "";
  const definition = companyId
    ? (
        await getTemplateFormDefinition(session, {
          context: { companyId },
          templateId: template.templateId,
        })
      ).formDefinition
    : initialDefinition;

  const scalarValues = Object.fromEntries(
    definition.scalarFields.map((field) => {
      const lookup = definition.lookupRecords[field.datasetKey]?.[0];
      const value =
        field.value ||
        (field.bindingMode === "scalar-selector" ? lookup?.key : "") ||
        sampleValue(field.manualInputType, field.manualLabel || field.placeholder);
      return [field.fieldId, value];
    }),
  );
  const tableRows = Object.fromEntries(
    definition.tableGroups.map((group) => [
      group.key,
      [
        Object.fromEntries(
          group.columns.map((field) => {
            const lookup = definition.lookupRecords[field.datasetKey]?.[0];
            const value =
              field.value ||
              (field.bindingMode === "table-selector" ? lookup?.key : "") ||
              sampleValue(
                field.manualInputType,
                field.manualLabel || field.placeholder,
              );
            return [field.fieldId, value];
          }),
        ),
      ],
    ]),
  );

  const draft = await generateTemplateDraftPreview(session, {
    companyId,
    context: { companyId },
    scalarValues,
    tableRows,
    templateId: template.templateId,
  });
  try {
    const file = await db.fileObject.findUnique({
      where: { id: draft.outputFileId },
    });
    if (!file?.bucket || !file.objectKey) {
      throw new Error("Không tìm thấy metadata GCS của PDF nháp.");
    }
    const [buffer] = await new Storage()
      .bucket(file.bucket)
      .file(file.objectKey)
      .download();
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("Kết quả QA không phải file PDF hợp lệ.");
    }
    const outputDirectory = path.resolve("tmp", "pdfs");
    const outputPath = path.join(outputDirectory, "template-draft-qa.pdf");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, buffer);
    console.log(
      JSON.stringify(
        {
          bytes: buffer.length,
          outputPath,
          templateId: template.templateId,
          templateName: template.templateName,
        },
        null,
        2,
      ),
    );
  } finally {
    await deleteTemplateDraftPreview(session, {
      draftFileId: draft.outputFileId,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
