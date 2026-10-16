"use server";

import { randomUUID } from "node:crypto";

import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { effectiveSealDeclarationModes } from "@/lib/document-declaration";

import {
  submitRequestAction,
  type RequestActionState,
} from "../actions";
import type {
  SealDeclarationMode,
  SealPartnerInput,
  SealPartnerOption,
} from "./types";

const SERVICE_CODE = "document-seal";
const PARTNER_KEY_PREFIX = "document-seal.partner.";
const ALLOWED_OFFICES = new Set(["q12", "thanh-cong"]);
const ALLOWED_STAMPS = new Set([
  "Đóng chính",
  "Giáp lai",
  "Dấu treo",
  "Sao y",
  "Ký điện tử",
  "Ký số",
]);
const ALLOWED_MODES = new Set<SealDeclarationMode>([
  "partner",
  "period",
  "detail",
]);

type JsonObject = Record<string, unknown>;

function objectOf(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function normalizedText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedIdentifier(value: unknown) {
  return normalizedText(value).replace(/\s+/g, "");
}

function normalizedUpper(value: unknown) {
  const text = normalizedText(value);
  return text ? text.toLocaleUpperCase("vi-VN") : "";
}

function hasSealAccess(session: Awaited<ReturnType<typeof requireCurrentSession>>) {
  return session.fullAccess || session.modules.includes(SERVICE_CODE);
}

function parseModes(value: unknown): SealDeclarationMode[] {
  if (!Array.isArray(value)) return ["partner", "period", "detail"];
  const modes = value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const item = objectOf(entry);
      return String(item.key ?? item.value ?? item.type ?? "");
    })
    .filter((entry): entry is SealDeclarationMode =>
      ALLOWED_MODES.has(entry as SealDeclarationMode),
    );
  return modes.length ? [...new Set(modes)] : ["partner", "period", "detail"];
}

function needsCustomText(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    const item = objectOf(entry);
    return [
      item.type,
      item.tokenKey,
      item.key,
      item.value,
    ].some((candidate) => normalizedText(candidate).toUpperCase() === "CUSTOM_TEXT");
  });
}

function isValidDate(value: unknown) {
  const text = normalizedText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function isValidPeriod(value: unknown) {
  const match = normalizedText(value).match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  return Boolean(match);
}

async function validateSealPayload(payload: JsonObject) {
  const officeKey = normalizedText(
    payload.submissionOfficeKey ?? payload.officeKey,
  );
  if (!ALLOWED_OFFICES.has(officeKey)) {
    return "Vui lòng chọn khu vực nộp hồ sơ.";
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return "Đơn chưa có hồ sơ nào để nộp.";
  if (items.length > 500) return "Mỗi đơn được phép tối đa 500 hồ sơ.";

  const companyIds = new Set<string>();
  const documentTypeIds = new Set<string>();
  for (const raw of items) {
    const item = objectOf(raw);
    const companyId = normalizedText(item.companyId);
    const secondaryCompanyId = normalizedText(item.secondaryCompanyId);
    const documentTypeId = normalizedText(item.documentTypeId);
    if (companyId) companyIds.add(companyId);
    if (secondaryCompanyId) companyIds.add(secondaryCompanyId);
    if (documentTypeId) documentTypeIds.add(documentTypeId);
  }

  const db = getDb();
  const [companies, documentTypes] = await Promise.all([
    db.company.findMany({
      select: { id: true },
      where: { id: { in: [...companyIds] }, status: "ACTIVE" },
    }),
    db.documentType.findMany({
      select: {
        declarationTypes: true,
        formatTokens: true,
        id: true,
        name: true,
        status: true,
      },
      where: { id: { in: [...documentTypeIds] }, status: "ACTIVE" },
    }),
  ]);
  const validCompanies = new Set(companies.map((item) => item.id));
  const typesById = new Map(documentTypes.map((item) => [item.id, item]));

  for (let index = 0; index < items.length; index += 1) {
    const item = objectOf(items[index]);
    const line = index + 1;
    const companyId = normalizedText(item.companyId);
    const secondaryCompanyId = normalizedText(item.secondaryCompanyId);
    const documentTypeId = normalizedText(item.documentTypeId);
    const typeLabel = normalizedText(
      item.typeLabel ?? item.documentTypeName ?? item.loai,
    );
    const partnerMode = normalizedText(item.partnerMode) as SealDeclarationMode;
    const partner = normalizedText(
      item.partner ?? item.partnerName ?? item.detail,
    );
    const quantity = Number(item.quantity ?? item.qty);
    const stamps = Array.isArray(item.sealTypes)
      ? item.sealTypes
      : Array.isArray(item.stamps)
        ? item.stamps
        : [];

    if (!companyId || !validCompanies.has(companyId)) {
      return `Hồ sơ dòng ${line} chưa có pháp nhân ký hợp lệ.`;
    }
    if (
      secondaryCompanyId &&
      (!validCompanies.has(secondaryCompanyId) || secondaryCompanyId === companyId)
    ) {
      return `Hồ sơ dòng ${line} có pháp nhân chuyển giao không hợp lệ.`;
    }
    if (!typeLabel) return `Hồ sơ dòng ${line} chưa có loại hồ sơ.`;
    if (!isValidDate(item.signDate ?? item.date)) {
      return `Hồ sơ dòng ${line} có ngày ký không hợp lệ.`;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
      return `Hồ sơ dòng ${line} có số lượng không hợp lệ.`;
    }
    if (
      !stamps.length ||
      stamps.some((stamp) => !ALLOWED_STAMPS.has(normalizedText(stamp)))
    ) {
      return `Hồ sơ dòng ${line} cần ít nhất một loại dấu hợp lệ.`;
    }
    if (
      stamps.some((stamp) => ["Ký điện tử", "Ký số"].includes(normalizedText(stamp))) &&
      !normalizedText(item.signatureClientFileName)
    ) {
      return `Hồ sơ dòng ${line} cần nạp PDF và vẽ vùng ký số.`;
    }
    if (!ALLOWED_MODES.has(partnerMode)) {
      return `Hồ sơ dòng ${line} chưa có loại khai báo hợp lệ.`;
    }
    if (!partner) {
      return `Hồ sơ dòng ${line} chưa có nội dung khai báo.`;
    }
    if (partnerMode === "period" && !isValidPeriod(partner)) {
      return `Hồ sơ dòng ${line} cần nhập thời gian đúng định dạng MM/YYYY.`;
    }
    if (
      partnerMode === "detail" &&
      normalizedText(partner).replace(/^Về việc\s*/i, "").length < 2
    ) {
      return `Hồ sơ dòng ${line} chưa có nội dung chi tiết.`;
    }

    if (documentTypeId) {
      const documentType = typesById.get(documentTypeId);
      if (!documentType) {
        return `Hồ sơ dòng ${line} có loại văn bản không còn hoạt động.`;
      }
      const allowedModes = effectiveSealDeclarationModes(
        documentType.name,
        parseModes(documentType.declarationTypes),
      );
      if (!allowedModes.includes(partnerMode)) {
        return `Loại văn bản ở dòng ${line} không hỗ trợ cách khai báo đã chọn.`;
      }
      if (
        needsCustomText(documentType.formatTokens) &&
        !normalizedText(item.customNumberingText ?? item.partnerAbbr)
      ) {
        return `Hồ sơ dòng ${line} cần tên viết tắt để cấp số.`;
      }
    } else if (!normalizedText(item.otherType ?? typeLabel)) {
      return `Hồ sơ dòng ${line} cần nhập tên loại hồ sơ khác.`;
    }

    const rowOffice = normalizedText(
      item.submissionOfficeKey ?? item.officeKey ?? officeKey,
    );
    if (rowOffice !== officeKey) {
      return `Hồ sơ dòng ${line} có khu vực nộp không đồng nhất.`;
    }
  }

  return "";
}

export async function submitSealRequestAction(
  state: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireCurrentSession();
  if (!hasSealAccess(session)) {
    return { error: "Tài khoản chưa được cấp quyền Đóng dấu và Ký số." };
  }

  let payload: JsonObject = {};
  try {
    payload = objectOf(JSON.parse(String(formData.get("payload") || "{}")));
  } catch {
    return { error: "Dữ liệu đơn đóng dấu không hợp lệ." };
  }

  const payloadError = await validateSealPayload(payload);
  if (payloadError) return { error: payloadError };

  formData.set("serviceCode", SERVICE_CODE);
  return submitRequestAction(state, formData);
}

export type SaveSealPartnerResult = {
  error?: string;
  item?: SealPartnerOption;
  success?: string;
};

export async function saveSealPartnerAction(
  input: SealPartnerInput,
): Promise<SaveSealPartnerResult> {
  const session = await requireCurrentSession();
  if (!hasSealAccess(session)) {
    return { error: "Tài khoản chưa được cấp quyền lưu đối tác." };
  }

  const type = input.type === "person" ? "person" : "business";
  const name = normalizedUpper(input.name);
  const taxId = normalizedIdentifier(input.taxId);
  const issuedDate = type === "person" ? normalizedText(input.issuedDate) : "";
  const issuedPlace = type === "person" ? normalizedText(input.issuedPlace) : "";
  const address = normalizedText(input.address);
  const shortName =
    type === "business" ? normalizedUpper(input.shortName) : "";

  if (!name) {
    return {
      error:
        type === "person"
          ? "Vui lòng nhập Tên khách hàng."
          : "Vui lòng nhập Tên công ty.",
    };
  }
  if (!taxId) {
    return {
      error:
        type === "person"
          ? "Vui lòng nhập CCCD."
          : "Vui lòng nhập Mã số thuế.",
    };
  }

  const db = getDb();
  const settings = await db.systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { startsWith: PARTNER_KEY_PREFIX } },
  });
  const duplicate = settings
    .map((setting) => {
      try {
        return objectOf(JSON.parse(setting.value || "{}"));
      } catch {
        return {};
      }
    })
    .find(
      (partner) =>
        normalizedIdentifier(partner.taxId).toLocaleLowerCase("vi-VN") ===
        taxId.toLocaleLowerCase("vi-VN"),
    );
  if (duplicate) {
    return {
      error: `${type === "person" ? "CCCD" : "Mã số thuế"} ${taxId} đã tồn tại trong danh sách Đối tác.`,
    };
  }

  const id = randomUUID();
  const item: SealPartnerOption = {
    address,
    employeeCode: "",
    id,
    issuedDate,
    issuedPlace,
    label: name,
    name,
    searchText: [name, taxId, shortName, address, issuedPlace].join(" "),
    shortName,
    sourceLabel:
      type === "person" ? "Đối tác - Cá nhân" : "Đối tác - Doanh nghiệp",
    sourceType: "customer",
    taxId,
    type,
  };
  try {
    await db.$transaction([
      db.systemSetting.create({
        data: {
          key: `${PARTNER_KEY_PREFIX}${id}`,
          updatedById: session.userId,
          value: JSON.stringify(item),
        },
      }),
      db.auditLog.create({
        data: {
          action: "CREATE",
          actorId: session.userId,
          metadata: { partnerType: type, taxId },
          summary: `Tạo đối tác đóng dấu ${name}.`,
          targetId: id,
          targetType: "SealPartner",
        },
      }),
    ]);
  } catch {
    return { error: "Không lưu được đối tác. Vui lòng thử lại." };
  }

  return { item, success: "Đã lưu và chọn đối tác mới." };
}
