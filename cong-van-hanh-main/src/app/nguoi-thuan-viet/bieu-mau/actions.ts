"use server";

import { GoogleAuth } from "google-auth-library";
import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import { canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export type TemplateOutputState = {
  error?: string;
  outputUrl?: string;
  success?: string;
};

type TemplateField = {
  bindingMode?: string;
  datasetKey?: string;
  fieldId?: string;
  isTableField?: boolean;
  placeholder?: string;
  rawToken?: string;
  sourceFieldKey?: string;
  tableKey?: string;
};

const templateDriveAuth = new GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
  ],
});

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonObject(value: string) {
  if (!value) return {};
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeRequestCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `YC-${stamp}-${random}`;
}

function safeOutputName(templateName: string, displayName: string) {
  const date = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  return `${templateName} - ${displayName} - ${date}`.slice(0, 180);
}

function companyField(
  company: {
    address: string | null;
    businessRegistration: string | null;
    code: string;
    legalName: string;
    representative: string | null;
    shortName: string | null;
    taxCode: string | null;
  } | null,
  key: string,
) {
  if (!company) return "";
  const normalized = key.toLocaleLowerCase("vi");
  if (normalized.includes("địa chỉ")) return company.address || "";
  if (normalized.includes("người đại diện") || normalized.includes("giám đốc")) {
    return company.representative || "";
  }
  if (normalized.includes("mã số thuế")) return company.taxCode || "";
  if (normalized.includes("đkkd")) return company.businessRegistration || "";
  if (normalized.includes("mã công ty")) return company.code;
  return company.shortName || company.legalName;
}

function systemField(key: string) {
  const now = new Date();
  if (key === "currentDate") return String(now.getDate()).padStart(2, "0");
  if (key === "currentMonth") return String(now.getMonth() + 1).padStart(2, "0");
  if (key === "currentYear") return String(now.getFullYear());
  return new Intl.DateTimeFormat("vi-VN").format(now);
}

export async function generateTemplateOutputAction(
  _state: TemplateOutputState,
  formData: FormData,
): Promise<TemplateOutputState> {
  const session = await requireCurrentSession();
  if (
    !canAny(session, [
      "my_requests.create",
      "admin_requests.create",
      "support_requests.create",
    ])
  ) {
    return { error: "Ông chưa có quyền tạo biểu mẫu." };
  }

  const templateId = text(formData, "templateId");
  const companyId = text(formData, "companyId");
  const note = text(formData, "note");
  const manualValues = jsonObject(text(formData, "values"));
  const tableRows = jsonObject(text(formData, "tableRows"));
  if (!templateId) return { error: "Chọn biểu mẫu cần tạo." };

  const db = getDb();
  const [template, actor, company] = await Promise.all([
    db.configurationRecord.findFirst({
      where: {
        recordType: "template",
        OR: [{ id: templateId }, { code: templateId }],
      },
    }),
    db.user.findUnique({
      include: { employee: true },
      where: { id: session.userId },
    }),
    companyId
      ? db.company.findUnique({ where: { id: companyId } })
      : Promise.resolve(null),
  ]);
  if (!template) return { error: "Không tìm thấy cấu hình biểu mẫu." };

  const content = objectValue(template.content);
  const workingFileId = String(
    content["File làm việc ID"] || content["File gốc ID"] || "",
  ).trim();
  if (!workingFileId) {
    return { error: "Biểu mẫu chưa có file Google Docs làm việc." };
  }

  const fields = jsonArray(content["JSON trường"])
    .map((value) => objectValue(value) as TemplateField)
    .filter((field) => field.fieldId && field.rawToken);
  if (!fields.length) {
    return { error: "Biểu mẫu chưa có danh sách trường để trộn dữ liệu." };
  }

  const replacements = new Map<string, string>();
  for (const field of fields) {
    const fieldId = String(field.fieldId);
    let value = String(manualValues[fieldId] || "");
    if (field.isTableField && field.tableKey) {
      const rows = tableRows[field.tableKey];
      value = Array.isArray(rows)
        ? rows
            .map((row) => String(objectValue(row)[fieldId] || ""))
            .filter(Boolean)
            .join("\n")
        : value;
    } else if (!value && field.datasetKey === "company") {
      value = companyField(company, String(field.sourceFieldKey || ""));
    } else if (!value && field.datasetKey === "employee") {
      const sourceKey = String(field.sourceFieldKey || "").toLocaleLowerCase("vi");
      value = sourceKey.includes("khu vực") || sourceKey.includes("phòng ban")
        ? actor?.employee?.department || actor?.employee?.title || ""
        : actor?.employee?.fullName || actor?.displayName || session.displayName;
    } else if (!value && field.datasetKey === "system") {
      value = systemField(String(field.sourceFieldKey || ""));
    }
    replacements.set(String(field.rawToken), value);
  }

  const client = await templateDriveAuth.getClient();
  let outputFileId = "";
  try {
    const metadata = await client.request<{ parents?: string[] }>({
      params: { fields: "parents", supportsAllDrives: true },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(workingFileId)}`,
    });
    const copied = await client.request<{ id?: string }>({
      data: {
        name: safeOutputName(
          template.name || "Biểu mẫu",
          actor?.displayName || session.displayName,
        ),
        ...(metadata.data.parents?.length
          ? { parents: metadata.data.parents }
          : {}),
      },
      method: "POST",
      params: { fields: "id", supportsAllDrives: true },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(workingFileId)}/copy`,
    });
    outputFileId = copied.data.id || "";
    if (!outputFileId) throw new Error("Google Drive không trả ID file đầu ra.");

    await client.request({
      data: {
        requests: [...replacements.entries()].map(([find, replaceText]) => ({
          replaceAllText: {
            containsText: { matchCase: true, text: find },
            replaceText,
          },
        })),
      },
      method: "POST",
      url: `https://docs.googleapis.com/v1/documents/${encodeURIComponent(outputFileId)}:batchUpdate`,
    });

    await client.request({
      data: {
        role: "reader",
        type: "anyone",
      },
      method: "POST",
      params: { supportsAllDrives: true },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(outputFileId)}/permissions`,
    });
  } catch (error) {
    if (outputFileId) {
      await client
        .request({
          method: "DELETE",
          params: { supportsAllDrives: true },
          url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(outputFileId)}`,
        })
        .catch(() => undefined);
    }
    const serviceAccount =
      process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT ||
      "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";
    return {
      error:
        error instanceof Error && error.message.includes("403")
          ? `File biểu mẫu chưa cho phép ${serviceAccount} tạo bản sao.`
          : "Không tạo được file đầu ra từ Google Docs.",
    };
  }

  const outputUrl = `https://docs.google.com/document/d/${encodeURIComponent(outputFileId)}/edit`;
  const requestCode = makeRequestCode();
  await db.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: {
        code: requestCode,
        companyId: companyId || undefined,
        createdById: session.userId,
        note: note || null,
        payload: {
          companyId,
          outputFileId,
          outputUrl,
          tableRows,
          templateId,
          templateName: template.name || "",
          values: manualValues,
        } as Prisma.InputJsonValue,
        serviceCode: "template-output",
        status: "COMPLETED",
        title: `Biểu mẫu · ${template.name || "Không tên"}`,
        completedAt: new Date(),
      },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        note: "Đã tạo file Google Docs đầu ra.",
        requestId: request.id,
        toStatus: "COMPLETED",
        type: "COMPLETED",
      },
    });
    await tx.auditLog.create({
      data: {
        action: "CREATE",
        actorId: session.userId,
        metadata: { outputFileId, templateId },
        summary: `Generated template output ${requestCode}.`,
        targetId: request.id,
        targetType: "Request",
      },
    });
  });

  revalidatePath("/nguoi-thuan-viet/bieu-mau");
  revalidatePath("/nguoi-thuan-viet/don-hang");
  return {
    outputUrl,
    success: `Đã tạo ${template.name || "biểu mẫu"} và lưu vào Đơn hàng của tôi.`,
  };
}
