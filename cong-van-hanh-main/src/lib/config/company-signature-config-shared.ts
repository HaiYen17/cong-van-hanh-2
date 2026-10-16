export const COMPANY_SIGNATURE_CONFIG_KEY = "esign.companyCertificateMap";
export const MAX_SIGNATURE_IMAGE_BYTES = 512 * 1024;

export type CompanySignatureConfig = {
  certAlias: string;
  bodUserIds: string[];
  /** Encrypted in storage; decrypted only by the server-side reader. */
  signatureImage?: string;
};

export type CompanySignatureConfigUi = {
  companyId: string;
  certAlias: string;
  bodUserIds: string[];
  hasImage: boolean;
};

export type CompanySignatureSetup = {
  companies: Array<{ id: string; name: string; code: string; taxCode: string }>;
  approvers: Array<{ id: string; name: string; description: string }>;
  configs: CompanySignatureConfigUi[];
};

export type CompanySignatureConfigInput = {
  companyId: string;
  certAlias: string;
  bodUserIds: string[];
  signatureImage?: string;
  clearImage?: boolean;
  remove?: boolean;
};

export function parseCompanySignatureMap(raw: string | null | undefined) {
  const result: Record<string, CompanySignatureConfig> = Object.create(null);
  if (!raw?.trim()) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Cấu hình ký số theo pháp nhân không đọc được. Vui lòng kiểm tra dữ liệu cấu hình.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Cấu hình ký số theo pháp nhân không đúng định dạng.");
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    // Compatibility with the first V3 mapping draft; an approver still must
    // be assigned through Cấu hình Tổng before this entry can be used.
    if (typeof value === "string") {
      result[key] = { certAlias: value.trim(), bodUserIds: [] };
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Có pháp nhân chứa cấu hình ký số không hợp lệ.");
    }
    const item = value as Record<string, unknown>;
    if (typeof item.certAlias !== "string" || !Array.isArray(item.bodUserIds) ||
      !item.bodUserIds.every((id) => typeof id === "string") ||
      (item.signatureImage !== undefined && typeof item.signatureImage !== "string")) {
      throw new Error("Có pháp nhân chứa cấu hình chứng thư hoặc BOD không hợp lệ.");
    }
    result[key] = {
      certAlias: item.certAlias.trim(),
      bodUserIds: [...new Set(item.bodUserIds.map((id) => id.trim()).filter(Boolean))],
      ...(item.signatureImage ? { signatureImage: item.signatureImage as string } : {}),
    };
  }
  return result;
}

export function signatureConfigForUi(companyId: string, config: CompanySignatureConfig): CompanySignatureConfigUi {
  return {
    companyId,
    certAlias: config.certAlias,
    bodUserIds: [...config.bodUserIds],
    hasImage: Boolean(config.signatureImage),
  };
}
