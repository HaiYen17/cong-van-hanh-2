"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  BRAND_BUTTON_HOVER_OPTIONS,
  BRAND_BUTTON_RADIUS_OPTIONS,
  BRAND_BUTTON_SIZE_OPTIONS,
  BRAND_BUTTON_STYLE_OPTIONS,
  BRAND_GRADIENT_OPTIONS,
  BRAND_SHADOW_OPTIONS,
  BRAND_SURFACE_RADIUS_OPTIONS,
  BRAND_THEME_SETTING_KEYS,
  DEFAULT_BRAND_THEME,
  type BrandTheme,
} from "@/lib/config/brand-theme-shared";
import { getConfigDefinition } from "@/lib/config/definitions";
import {
  loadCompanySignatureSetup,
  saveCompanySignatureConfig,
} from "@/lib/config/company-signature-config";
import type {
  CompanySignatureConfigInput,
  CompanySignatureSetup,
} from "@/lib/config/company-signature-config-shared";
import {
  getGlobalConfigSnapshot,
  getModuleConfigSecret,
  isGlobalConfigSuperAdmin,
  normalizeText,
  type ModuleConfigUi,
} from "@/lib/config/global-config";
import { getModuleHeaders } from "@/lib/config/module-header";
import {
  moduleHeaderSettingKey,
  type ModuleHeaderUi,
} from "@/lib/config/module-header-shared";
import { sealConfigSecret } from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";
import {
  assertGoogleDriveResource,
  extractGoogleDriveId,
} from "@/lib/integrations/google-drive";
import {
  misaAuthenticate,
  misaCertificates,
  misaField,
  misaText,
} from "@/lib/integrations/misa-esign";

import type { ActionResult } from "./integration-actions";

const PATH = "/cau-hinh/tong";

export type ModuleConfigInput = {
  clear?: boolean;
  key: string;
  value?: string;
};

export type ModuleHeaderInput = {
  eyebrow: string;
  key: string;
  title: string;
};

export type MisaEsignConnection = {
  certificates: Array<{
    alias: string;
    label: string;
    status: string;
  }>;
  otpRequired: boolean;
};

function normalizeHexColor(value: unknown, label: string) {
  const normalized = normalizeText(value).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    throw new Error(`"${label}" phải là mã màu HEX gồm 6 ký tự, ví dụ #d4196a.`);
  }
  return normalized;
}

function normalizeOption<T extends string>(
  value: unknown,
  options: ReadonlyArray<{ value: T }>,
  fallback: T,
) {
  const normalized = normalizeText(value);
  return options.some((option) => option.value === normalized)
    ? (normalized as T)
    : fallback;
}

function normalizeBrandTheme(input: BrandTheme): BrandTheme {
  const headerTitle = normalizeText(input.headerTitle);
  const headerSubtitle = normalizeText(input.headerSubtitle);
  if (!headerTitle) throw new Error("Vui lòng nhập tên hiển thị trên header.");
  if (headerTitle.length > 60) {
    throw new Error("Tên hiển thị trên header không được quá 60 ký tự.");
  }
  if (!headerSubtitle) throw new Error("Vui lòng nhập dòng mô tả trên header.");
  if (headerSubtitle.length > 120) {
    throw new Error("Dòng mô tả trên header không được quá 120 ký tự.");
  }
  return {
    brand: normalizeHexColor(input.brand, "Màu thương hiệu chính"),
    brandLight: normalizeHexColor(input.brandLight, "Màu thương hiệu sáng"),
    brandSoft: normalizeHexColor(input.brandSoft, "Màu nền thương hiệu nhạt"),
    brandStrong: normalizeHexColor(input.brandStrong, "Màu thương hiệu đậm"),
    borderColor: normalizeHexColor(input.borderColor, "Màu viền"),
    buttonHoverMode: normalizeOption(
      input.buttonHoverMode,
      BRAND_BUTTON_HOVER_OPTIONS,
      DEFAULT_BRAND_THEME.buttonHoverMode,
    ),
    buttonRadius: normalizeOption(
      input.buttonRadius,
      BRAND_BUTTON_RADIUS_OPTIONS,
      DEFAULT_BRAND_THEME.buttonRadius,
    ),
    buttonSize: normalizeOption(
      input.buttonSize,
      BRAND_BUTTON_SIZE_OPTIONS,
      DEFAULT_BRAND_THEME.buttonSize,
    ),
    buttonStyle: normalizeOption(
      input.buttonStyle,
      BRAND_BUTTON_STYLE_OPTIONS,
      DEFAULT_BRAND_THEME.buttonStyle,
    ),
    buttonTextColor: normalizeHexColor(
      input.buttonTextColor,
      "Màu chữ trên nút chính",
    ),
    cardRadius: normalizeOption(
      input.cardRadius,
      BRAND_SURFACE_RADIUS_OPTIONS,
      DEFAULT_BRAND_THEME.cardRadius,
    ),
    controlRadius: normalizeOption(
      input.controlRadius,
      BRAND_SURFACE_RADIUS_OPTIONS,
      DEFAULT_BRAND_THEME.controlRadius,
    ),
    gradientMode: normalizeOption(
      input.gradientMode,
      BRAND_GRADIENT_OPTIONS,
      DEFAULT_BRAND_THEME.gradientMode,
    ),
    headerSubtitle,
    headerSubtitleColor: normalizeHexColor(
      input.headerSubtitleColor,
      "Màu chữ phụ header",
    ),
    headerTitle,
    headerTitleColor: normalizeHexColor(
      input.headerTitleColor,
      "Màu chữ chính header",
    ),
    mutedTextColor: normalizeHexColor(input.mutedTextColor, "Màu chữ phụ"),
    pageBackground: normalizeHexColor(input.pageBackground, "Màu nền trang"),
    shadowMode: normalizeOption(
      input.shadowMode,
      BRAND_SHADOW_OPTIONS,
      DEFAULT_BRAND_THEME.shadowMode,
    ),
    surfaceColor: normalizeHexColor(input.surfaceColor, "Màu bề mặt card"),
    textColor: normalizeHexColor(input.textColor, "Màu chữ nội dung"),
  };
}

export async function saveBrandThemeAction(
  input: BrandTheme,
): Promise<ActionResult<{ brandTheme: BrandTheme }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const brandTheme = normalizeBrandTheme(input);
    const values: Array<[string, string]> = [
      [BRAND_THEME_SETTING_KEYS.brand, brandTheme.brand],
      [BRAND_THEME_SETTING_KEYS.brandLight, brandTheme.brandLight],
      [BRAND_THEME_SETTING_KEYS.brandSoft, brandTheme.brandSoft],
      [BRAND_THEME_SETTING_KEYS.brandStrong, brandTheme.brandStrong],
      [BRAND_THEME_SETTING_KEYS.borderColor, brandTheme.borderColor],
      [BRAND_THEME_SETTING_KEYS.buttonHoverMode, brandTheme.buttonHoverMode],
      [BRAND_THEME_SETTING_KEYS.buttonRadius, brandTheme.buttonRadius],
      [BRAND_THEME_SETTING_KEYS.buttonSize, brandTheme.buttonSize],
      [BRAND_THEME_SETTING_KEYS.buttonStyle, brandTheme.buttonStyle],
      [BRAND_THEME_SETTING_KEYS.buttonTextColor, brandTheme.buttonTextColor],
      [BRAND_THEME_SETTING_KEYS.cardRadius, brandTheme.cardRadius],
      [BRAND_THEME_SETTING_KEYS.controlRadius, brandTheme.controlRadius],
      [BRAND_THEME_SETTING_KEYS.gradientMode, brandTheme.gradientMode],
      [BRAND_THEME_SETTING_KEYS.headerSubtitle, brandTheme.headerSubtitle],
      [
        BRAND_THEME_SETTING_KEYS.headerSubtitleColor,
        brandTheme.headerSubtitleColor,
      ],
      [BRAND_THEME_SETTING_KEYS.headerTitle, brandTheme.headerTitle],
      [BRAND_THEME_SETTING_KEYS.headerTitleColor, brandTheme.headerTitleColor],
      [BRAND_THEME_SETTING_KEYS.mutedTextColor, brandTheme.mutedTextColor],
      [BRAND_THEME_SETTING_KEYS.pageBackground, brandTheme.pageBackground],
      [BRAND_THEME_SETTING_KEYS.shadowMode, brandTheme.shadowMode],
      [BRAND_THEME_SETTING_KEYS.surfaceColor, brandTheme.surfaceColor],
      [BRAND_THEME_SETTING_KEYS.textColor, brandTheme.textColor],
    ];

    await getDb().$transaction(async (tx) => {
      for (const [key, value] of values) {
        await tx.systemSetting.upsert({
          create: { key, updatedById: session.userId, value },
          update: { updatedById: session.userId, value },
          where: { key },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: { brandTheme },
          summary: "Cập nhật màu sắc và nội dung thương hiệu toàn Cổng.",
          targetId: "brand-theme",
          targetType: "SystemSetting",
        },
      });
    });

    revalidatePath(PATH);
    revalidatePath("/", "layout");
    return {
      data: { brandTheme },
      message: "Đã áp dụng cấu hình thương hiệu cho toàn bộ Cổng vận hành.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình thương hiệu.",
      ok: false,
    };
  }
}

export async function resetBrandThemeAction(): Promise<
  ActionResult<{ brandTheme: BrandTheme }>
> {
  try {
    const session = await requireGlobalConfigAdmin();
    const keys = Object.values(BRAND_THEME_SETTING_KEYS);
    await getDb().$transaction(async (tx) => {
      await tx.systemSetting.deleteMany({ where: { key: { in: keys } } });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: { operation: "reset-default-brand-theme" },
          summary: "Khôi phục cấu hình thương hiệu mặc định của Cổng.",
          targetId: "brand-theme",
          targetType: "SystemSetting",
        },
      });
    });
    revalidatePath(PATH);
    revalidatePath("/", "layout");
    return {
      data: { brandTheme: DEFAULT_BRAND_THEME },
      message: "Đã khôi phục bộ màu và nội dung header mặc định.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không khôi phục được cấu hình thương hiệu mặc định.",
      ok: false,
    };
  }
}

function normalizeModuleHeaderInput(input: ModuleHeaderInput) {
  const eyebrow = normalizeText(input.eyebrow);
  const title = normalizeText(input.title);
  if (!title) throw new Error("Vui lòng nhập tiêu đề Module.");
  if (title.length > 80) {
    throw new Error("Tiêu đề Module không được quá 80 ký tự.");
  }
  if (!eyebrow) throw new Error("Vui lòng nhập dòng nhóm Module.");
  if (eyebrow.length > 120) {
    throw new Error("Dòng nhóm Module không được quá 120 ký tự.");
  }
  return { eyebrow, title };
}

export async function saveModuleHeaderAction(
  input: ModuleHeaderInput,
): Promise<ActionResult<{ moduleHeaders: ModuleHeaderUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const definition = (await getModuleHeaders()).find(
      (item) => item.key === input.key,
    );
    if (!definition) throw new Error("Module không tồn tại trong danh mục hiện hành.");
    const content = normalizeModuleHeaderInput(input);
    const settingKey = moduleHeaderSettingKey(input.key);

    await getDb().$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        create: {
          key: settingKey,
          updatedById: session.userId,
          value: JSON.stringify(content),
        },
        update: {
          updatedById: session.userId,
          value: JSON.stringify(content),
        },
        where: { key: settingKey },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: { ...content, moduleKey: input.key },
          summary: `Cập nhật tiêu đề Module ${definition.defaultTitle}.`,
          targetId: input.key,
          targetType: "ModuleHeader",
        },
      });
    });

    revalidatePath(PATH);
    if (definition.href) revalidatePath(definition.href);
    return {
      data: { moduleHeaders: await getModuleHeaders() },
      message: `Đã áp dụng tiêu đề mới cho Module “${content.title}”.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không lưu được tiêu đề Module.",
      ok: false,
    };
  }
}

export async function resetModuleHeaderAction(
  moduleKey: string,
): Promise<ActionResult<{ moduleHeaders: ModuleHeaderUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const definition = (await getModuleHeaders()).find(
      (item) => item.key === moduleKey,
    );
    if (!definition) throw new Error("Module không tồn tại trong danh mục hiện hành.");

    await getDb().$transaction(async (tx) => {
      await tx.systemSetting.deleteMany({
        where: { key: moduleHeaderSettingKey(moduleKey) },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: { moduleKey, operation: "reset-module-header" },
          summary: `Khôi phục tiêu đề mặc định của Module ${definition.defaultTitle}.`,
          targetId: moduleKey,
          targetType: "ModuleHeader",
        },
      });
    });

    revalidatePath(PATH);
    if (definition.href) revalidatePath(definition.href);
    return {
      data: { moduleHeaders: await getModuleHeaders() },
      message: `Đã khôi phục tiêu đề mặc định của Module “${definition.defaultTitle}”.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không khôi phục được tiêu đề Module.",
      ok: false,
    };
  }
}

export async function refreshGlobalConfigAction(): Promise<
  ActionResult<{ snapshot: Awaited<ReturnType<typeof getGlobalConfigSnapshot>> }>
> {
  try {
    await requireGlobalConfigAdmin();
    return {
      data: { snapshot: await getGlobalConfigSnapshot() },
      message: "Đã tải lại Cấu hình Tổng từ PostgreSQL.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không tải lại được Cấu hình Tổng.",
      ok: false,
    };
  }
}

async function requireGlobalConfigAdmin() {
  const session = await requireCurrentSession();
  if (!isGlobalConfigSuperAdmin(session)) {
    throw new Error("Chỉ Super Admin được thao tác Cấu hình Tổng.");
  }
  return session;
}

function validateHttpsUrl(value: string, label: string) {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${label}" phải là URL hợp lệ.`);
  }
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error(`"${label}" phải dùng HTTPS trên production.`);
  }
  return url.toString().replace(/\/$/, "");
}

export async function loadCompanySignatureSetupAction(): Promise<ActionResult<CompanySignatureSetup>> {
  try {
    await requireGlobalConfigAdmin();
    return { ok: true, data: await loadCompanySignatureSetup(), message: "Đã tải cấu hình ký số theo pháp nhân." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Không tải được cấu hình ký số." };
  }
}

export async function authenticateMisaEsignAction(input: {
  action: "test" | "otp" | "resend";
  code?: string;
  otpType?: 0 | 1;
}): Promise<ActionResult<MisaEsignConnection>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const auth = await misaAuthenticate(
      input.action,
      normalizeText(input.code),
      input.otpType === 1 ? 1 : 0,
    );
    let certificates: MisaEsignConnection["certificates"] = [];
    if (!auth.otpRequired && input.action !== "resend") {
      const response = await misaCertificates();
      certificates = response.certificates.map((certificate) => {
        const alias = misaText(misaField(certificate, "keyAlias"));
        const subject =
          misaText(misaField(certificate, "commonName")) ||
          misaText(misaField(certificate, "subject")) ||
          misaText(misaField(certificate, "organization"));
        return {
          alias,
          label: subject || alias || "Chứng thư chưa có tên",
          status: misaText(misaField(certificate, "keyStatus")) || "UNKNOWN",
        };
      }).filter((certificate) => Boolean(certificate.alias));
    }
    await getDb().auditLog.create({
      data: {
        action: "SYNC",
        actorId: session.userId,
        metadata: {
          certificateCount: certificates.length,
          operation: input.action,
          otpRequired: auth.otpRequired,
        },
        summary: "Kiểm tra kết nối MISA eSign trong Cấu hình Tổng.",
        targetId: "misa-esign",
        targetType: "Integration",
      },
    });
    return {
      data: { certificates, otpRequired: auth.otpRequired },
      message: auth.message,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không kiểm tra được kết nối MISA eSign.",
      ok: false,
    };
  }
}

export async function saveCompanySignatureConfigAction(input: CompanySignatureConfigInput): Promise<ActionResult<CompanySignatureSetup>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const companyName = await saveCompanySignatureConfig(session.userId, input);
    revalidatePath(PATH);
    revalidatePath("/thuc-thi/dong-dau");
    revalidatePath("/thuc-thi/ky-so-phe-duyet");
    return {
      ok: true,
      data: await loadCompanySignatureSetup(),
      message: input.remove ? `Đã ngừng cấu hình ký số cho ${companyName}.` : `Đã lưu chứng thư và BOD duyệt hồ sơ của ${companyName}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Không lưu được cấu hình ký số theo pháp nhân." };
  }
}

export async function saveModuleConfigAction(
  input: ModuleConfigInput,
): Promise<ActionResult<{ moduleConfigs: ModuleConfigUi[] }>> {
  try {
    const session = await requireGlobalConfigAdmin();
    const definition = getConfigDefinition(input.key);
    if (!definition) {
      throw new Error(`Cấu hình Tổng chưa hỗ trợ key: ${input.key}`);
    }

    const db = getDb();
    const rawValue = normalizeText(input.value);
    let value: string | null;
    if (definition.type === "secret") {
      if (input.clear) value = null;
      else if (rawValue) value = sealConfigSecret(rawValue);
      else {
        const existing = await db.systemSetting.findUnique({
          select: { value: true },
          where: { key: definition.key },
        });
        value = existing?.value ?? null;
      }
    } else if (definition.type === "folder" && rawValue) {
      value = await assertGoogleDriveResource(rawValue, "folder");
    } else if (definition.type === "spreadsheet" && rawValue) {
      value = await assertGoogleDriveResource(rawValue, "spreadsheet");
    } else if (definition.type === "url") {
      value = validateHttpsUrl(rawValue, definition.label) || null;
    } else {
      value = rawValue || null;
    }

    if (
      !definition.optional &&
      !value &&
      !definition.fallbackValue &&
      definition.type !== "secret"
    ) {
      throw new Error(`Vui lòng nhập giá trị cho "${definition.label}".`);
    }

    await db.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        create: {
          key: definition.key,
          updatedById: session.userId,
          value,
        },
        update: { updatedById: session.userId, value },
        where: { key: definition.key },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            cleared: Boolean(input.clear),
            secret: definition.type === "secret",
            value:
              definition.type === "secret"
                ? undefined
                : definition.type === "folder" ||
                    definition.type === "spreadsheet"
                  ? extractGoogleDriveId(value ?? "")
                  : value,
          },
          summary: `Cập nhật Cấu hình Tổng: ${definition.label}.`,
          targetId: definition.key,
          targetType: "SystemSetting",
        },
      });
    });

    revalidatePath(PATH);
    return {
      data: {
        moduleConfigs: (await getGlobalConfigSnapshot()).moduleConfigs,
      },
      message: `Đã lưu "${definition.label}".`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình chung.",
      ok: false,
    };
  }
}

export async function copyRfidSecretAction(): Promise<
  ActionResult<{ value: string }>
> {
  try {
    const session = await requireGlobalConfigAdmin();
    const value = await getModuleConfigSecret("warehouseKts.androidApiKey");
    if (!value) throw new Error("Chưa có Android RFID API key đã lưu.");
    await getDb().auditLog.create({
      data: {
        action: "SYNC",
        actorId: session.userId,
        metadata: { operation: "copy-secret" },
        summary: "Super Admin đã lấy Android RFID API key để copy.",
        targetId: "warehouseKts.androidApiKey",
        targetType: "SystemSetting",
      },
    });
    return {
      data: { value },
      message: "Đã lấy Android RFID API key đã lưu.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không copy được Android RFID API key.",
      ok: false,
    };
  }
}
