import "server-only";

import { resolveSessionAccess } from "@/lib/auth/session-access";
import { getDb } from "@/lib/db";
import { openConfigSecret, sealConfigSecret } from "@/lib/config/secret-vault";
import {
  COMPANY_SIGNATURE_CONFIG_KEY,
  MAX_SIGNATURE_IMAGE_BYTES,
  parseCompanySignatureMap,
  signatureConfigForUi,
  type CompanySignatureConfig,
  type CompanySignatureConfigInput,
  type CompanySignatureSetup,
} from "./company-signature-config-shared";

export async function readCompanySignatureConfig(companyId: string): Promise<CompanySignatureConfig | null> {
  const stored = await getDb().systemSetting.findUnique({
    where: { key: COMPANY_SIGNATURE_CONFIG_KEY }, select: { value: true },
  });
  const config = parseCompanySignatureMap(stored?.value)[companyId];
  if (!config) return null;
  return {
    certAlias: config.certAlias,
    bodUserIds: [...config.bodUserIds],
    ...(config.signatureImage ? { signatureImage: openConfigSecret(config.signatureImage) } : {}),
  };
}

/** Routing data for BOD queues. Never reads/decrypts signature artwork. */
export async function readCompanySignatureRouting() {
  const stored = await getDb().systemSetting.findUnique({
    where: { key: COMPANY_SIGNATURE_CONFIG_KEY }, select: { value: true },
  });
  return Object.fromEntries(Object.entries(parseCompanySignatureMap(stored?.value)).map(
    ([companyId, value]) => [companyId, { certAlias: value.certAlias, bodUserIds: [...value.bodUserIds] }],
  ));
}

async function eligibleApprovers() {
  const users = await getDb().user.findMany({
    where: { status: "ACTIVE", activationStatus: "APPROVED", archivedAt: null },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: {
      id: true, displayName: true, email: true,
      employee: { select: { company: { select: { shortName: true, legalName: true } } } },
      userRoles: { where: { role: { status: "ACTIVE", archivedAt: null } }, select: { role: { select: {
        key: true,
        rolePermissions: { select: { permission: { select: { key: true } } } },
        roleModules: { select: { appModule: { select: { key: true, isActive: true } } } },
        roleModuleGroups: { select: { moduleGroup: { select: {
          key: true, isActive: true, modules: { select: { key: true, isActive: true } },
        } } } },
      } } } },
    },
  });
  return users.filter((user) => {
    const access = resolveSessionAccess(user.userRoles.map(({ role }) => role));
    return access.fullAccess || access.roleKeys.includes("bod") ||
      access.permissions.some((key) => key === "approvals.approve" || key === "admin_requests.approve");
  }).map((user) => ({
    id: user.id,
    name: user.displayName,
    description: [user.email, user.employee?.company?.shortName || user.employee?.company?.legalName].filter(Boolean).join(" · "),
  }));
}

/** Called only after the Cấu hình Tổng server action has authorized the actor. */
export async function loadCompanySignatureSetup(): Promise<CompanySignatureSetup> {
  const [companies, approvers, stored] = await Promise.all([
    getDb().company.findMany({
      where: { status: "ACTIVE", archivedAt: null }, orderBy: { legalName: "asc" },
      select: { id: true, legalName: true, code: true, taxCode: true },
    }),
    eligibleApprovers(),
    getDb().systemSetting.findUnique({ where: { key: COMPANY_SIGNATURE_CONFIG_KEY }, select: { value: true } }),
  ]);
  const configs = parseCompanySignatureMap(stored?.value);
  return {
    companies: companies.map((company) => ({ id: company.id, name: company.legalName, code: company.code, taxCode: company.taxCode || "" })),
    approvers,
    configs: companies.flatMap((company) => configs[company.id] ? [signatureConfigForUi(company.id, configs[company.id])] : []),
  };
}

export function normalizeSignaturePng(value: string) {
  const base64 = value.trim().replace(/^data:image\/png;base64,/i, "");
  if (!base64 || base64.length > Math.ceil(MAX_SIGNATURE_IMAGE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Ảnh chữ ký phải là PNG, dung lượng tối đa 512 KB.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 33 || bytes.length > MAX_SIGNATURE_IMAGE_BYTES ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) {
    throw new Error("Tệp ảnh chữ ký không phải ảnh PNG hợp lệ.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error("Ảnh chữ ký phải có kích thước từ 1 đến 4096 pixel mỗi chiều.");
  }
  return bytes.toString("base64");
}

export async function saveCompanySignatureConfig(actorId: string, input: CompanySignatureConfigInput) {
  const companyId = typeof input.companyId === "string" ? input.companyId.trim() : "";
  const company = await getDb().company.findFirst({
    where: { id: companyId, status: "ACTIVE", archivedAt: null }, select: { id: true, legalName: true },
  });
  if (!company) throw new Error("Vui lòng chọn một pháp nhân đang hoạt động.");
  const certAlias = typeof input.certAlias === "string" ? input.certAlias.trim() : "";
  const bodUserIds = Array.isArray(input.bodUserIds) ? [...new Set(input.bodUserIds.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean))] : [];
  if (!input.remove) {
    if (!certAlias || certAlias.length > 500 || /[\u0000-\u001f]/.test(certAlias)) {
      throw new Error("Vui lòng nhập mã chứng thư (certAlias) hợp lệ của pháp nhân.");
    }
    if (!bodUserIds.length || bodUserIds.length > 50) throw new Error("Vui lòng chọn từ 1 đến 50 người BOD duyệt hồ sơ.");
    const eligibleIds = new Set((await eligibleApprovers()).map((user) => user.id));
    if (bodUserIds.some((id) => !eligibleIds.has(id))) throw new Error("Có người được chọn đã ngừng hoạt động hoặc chưa có quyền BOD/duyệt hồ sơ. Vui lòng tải lại danh sách.");
  }
  const signatureImage = !input.remove && input.signatureImage ? sealConfigSecret(normalizeSignaturePng(input.signatureImage)) : null;
  await getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('esign-company-signature-config'))`;
    const stored = await tx.systemSetting.findUnique({ where: { key: COMPANY_SIGNATURE_CONFIG_KEY }, select: { value: true } });
    const configs = parseCompanySignatureMap(stored?.value);
    if (input.remove) delete configs[companyId];
    else {
      const previous = configs[companyId];
      const nextImage = input.clearImage ? undefined : signatureImage || previous?.signatureImage;
      configs[companyId] = {
        certAlias, bodUserIds,
        ...(nextImage ? { signatureImage: nextImage } : {}),
      };
    }
    await tx.systemSetting.upsert({
      where: { key: COMPANY_SIGNATURE_CONFIG_KEY },
      create: { key: COMPANY_SIGNATURE_CONFIG_KEY, value: JSON.stringify(configs), updatedById: actorId },
      update: { value: JSON.stringify(configs), updatedById: actorId },
    });
    await tx.auditLog.create({ data: {
      action: "UPDATE", actorId, targetId: companyId, targetType: "CompanySignatureConfig",
      summary: `${input.remove ? "Ngừng cấu hình" : "Cập nhật cấu hình"} ký số cho ${company.legalName}.`,
      metadata: {
        companyId, operation: input.remove ? "remove" : "save", approverCount: input.remove ? 0 : bodUserIds.length,
        certificateConfigured: !input.remove && Boolean(certAlias),
        imageChanged: Boolean(signatureImage || input.clearImage),
      },
    } });
  });
  return company.legalName;
}
