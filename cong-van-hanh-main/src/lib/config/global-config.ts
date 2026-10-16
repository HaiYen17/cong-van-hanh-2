import type { AppSession } from "@/lib/auth/session";
import { cache } from "react";
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
import {
  configSections,
  moduleConfigDefinitions,
} from "@/lib/config/definitions";
import { getModuleHeaders } from "@/lib/config/module-header";
import {
  ESHOP_BACKEND_SPREADSHEET_ID,
  ESHOP_ZERO_GUID,
  type GlobalConfigSnapshot,
  type ModuleConfigUi,
} from "@/lib/config/global-config-shared";
import {
  hasConfigSecret,
  openConfigSecret,
  previewConfigSecret,
} from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";

export {
  ESHOP_BACKEND_SPREADSHEET_ID,
  ESHOP_ZERO_GUID,
  VTP_BASE_URLS,
  VTP_DASHBOARD_BASE_URL,
} from "@/lib/config/global-config-shared";
export type {
  EshopAccountUi,
  GlobalConfigSnapshot,
  ModuleConfigUi,
  ScopeOption,
  VtpAccountUi,
} from "@/lib/config/global-config-shared";

export function isGlobalConfigSuperAdmin(session: AppSession) {
  return session.fullAccess && session.roles.includes("super-admin");
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of value) {
    const text = normalizeText(item);
    const key = text.toLocaleLowerCase("vi");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    values.push(text);
  }
  return values;
}

export function normalizeVtpUsername(value: unknown) {
  const text = normalizeText(value).replace(/\s+/g, "");
  if (/^\+?84[35789]\d{8}$/.test(text)) return `0${text.replace(/^\+?84/, "")}`;
  if (/^[35789]\d{8}$/.test(text)) return `0${text}`;
  return text;
}

export function statusForUi(value: unknown): "Kích hoạt" | "Vô hiệu" {
  return normalizeText(value).toUpperCase() === "INACTIVE"
    ? "Vô hiệu"
    : "Kích hoạt";
}

export function statusForDb(value: unknown) {
  const normalized = normalizeText(value).toLocaleLowerCase("vi");
  return normalized.includes("vô hiệu") || normalized === "inactive"
    ? "INACTIVE"
    : "ACTIVE";
}

function dateText(value: Date) {
  return value.toISOString();
}

function storedHex(value: unknown, fallback: string) {
  const normalized = normalizeText(value).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function storedOption<T extends string>(
  value: unknown,
  options: ReadonlyArray<{ value: T }>,
  fallback: T,
) {
  const normalized = normalizeText(value);
  return options.some((option) => option.value === normalized)
    ? (normalized as T)
    : fallback;
}

export const getBrandTheme = cache(async (): Promise<BrandTheme> => {
  const rows = await getDb().systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { in: Object.values(BRAND_THEME_SETTING_KEYS) } },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    brand: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.brand),
      DEFAULT_BRAND_THEME.brand,
    ),
    brandLight: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.brandLight),
      DEFAULT_BRAND_THEME.brandLight,
    ),
    brandSoft: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.brandSoft),
      DEFAULT_BRAND_THEME.brandSoft,
    ),
    brandStrong: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.brandStrong),
      DEFAULT_BRAND_THEME.brandStrong,
    ),
    borderColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.borderColor),
      DEFAULT_BRAND_THEME.borderColor,
    ),
    buttonHoverMode: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.buttonHoverMode),
      BRAND_BUTTON_HOVER_OPTIONS,
      DEFAULT_BRAND_THEME.buttonHoverMode,
    ),
    buttonRadius: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.buttonRadius),
      BRAND_BUTTON_RADIUS_OPTIONS,
      DEFAULT_BRAND_THEME.buttonRadius,
    ),
    buttonSize: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.buttonSize),
      BRAND_BUTTON_SIZE_OPTIONS,
      DEFAULT_BRAND_THEME.buttonSize,
    ),
    buttonStyle: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.buttonStyle),
      BRAND_BUTTON_STYLE_OPTIONS,
      DEFAULT_BRAND_THEME.buttonStyle,
    ),
    buttonTextColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.buttonTextColor),
      DEFAULT_BRAND_THEME.buttonTextColor,
    ),
    cardRadius: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.cardRadius),
      BRAND_SURFACE_RADIUS_OPTIONS,
      DEFAULT_BRAND_THEME.cardRadius,
    ),
    controlRadius: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.controlRadius),
      BRAND_SURFACE_RADIUS_OPTIONS,
      DEFAULT_BRAND_THEME.controlRadius,
    ),
    gradientMode: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.gradientMode),
      BRAND_GRADIENT_OPTIONS,
      DEFAULT_BRAND_THEME.gradientMode,
    ),
    headerSubtitle:
      normalizeText(values.get(BRAND_THEME_SETTING_KEYS.headerSubtitle)) ||
      DEFAULT_BRAND_THEME.headerSubtitle,
    headerSubtitleColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.headerSubtitleColor),
      DEFAULT_BRAND_THEME.headerSubtitleColor,
    ),
    headerTitle:
      normalizeText(values.get(BRAND_THEME_SETTING_KEYS.headerTitle)) ||
      DEFAULT_BRAND_THEME.headerTitle,
    headerTitleColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.headerTitleColor),
      DEFAULT_BRAND_THEME.headerTitleColor,
    ),
    mutedTextColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.mutedTextColor),
      DEFAULT_BRAND_THEME.mutedTextColor,
    ),
    pageBackground: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.pageBackground),
      DEFAULT_BRAND_THEME.pageBackground,
    ),
    shadowMode: storedOption(
      values.get(BRAND_THEME_SETTING_KEYS.shadowMode),
      BRAND_SHADOW_OPTIONS,
      DEFAULT_BRAND_THEME.shadowMode,
    ),
    surfaceColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.surfaceColor),
      DEFAULT_BRAND_THEME.surfaceColor,
    ),
    textColor: storedHex(
      values.get(BRAND_THEME_SETTING_KEYS.textColor),
      DEFAULT_BRAND_THEME.textColor,
    ),
  };
});

async function getModuleConfigUi(): Promise<ModuleConfigUi[]> {
  const db = getDb();
  const keys = moduleConfigDefinitions.flatMap((definition) => [
    definition.key,
    ...(definition.fallbackKeys ?? []),
  ]);
  const rows = await db.systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { in: [...new Set(keys)] } },
  });
  const rowMap = new Map(rows.map((row) => [row.key, row.value]));

  return moduleConfigDefinitions.map((definition) => {
    const ownValue = normalizeText(rowMap.get(definition.key));
    let effectiveValue = ownValue;
    let source = ownValue ? "Cấu hình Tổng" : "";

    if (!effectiveValue) {
      for (const fallbackKey of definition.fallbackKeys ?? []) {
        const fallbackValue = normalizeText(rowMap.get(fallbackKey));
        if (fallbackValue) {
          effectiveValue = fallbackValue;
          source = "Cấu hình dùng chung";
          break;
        }
      }
    }

    if (!effectiveValue && definition.fallbackValue) {
      effectiveValue = definition.fallbackValue;
      source = "Mặc định";
    }

    const isSecret = definition.type === "secret";
    return {
      ...definition,
      configured: Boolean(effectiveValue),
      secretConfigured: isSecret && hasConfigSecret(effectiveValue),
      secretPreview: isSecret
        ? definition.key.startsWith("esign.")
          ? effectiveValue ? "bí mật" : ""
          : previewConfigSecret(effectiveValue)
        : "",
      source,
      value: isSecret ? "" : effectiveValue,
    };
  });
}

export async function getGlobalConfigSnapshot(): Promise<GlobalConfigSnapshot> {
  const db = getDb();
  const [
    brandTheme,
    companies,
    employees,
    vtpAccounts,
    eshopAccounts,
    moduleConfigs,
    moduleHeaders,
  ] =
    await Promise.all([
      getBrandTheme(),
      db.company.findMany({
        orderBy: [{ legalName: "asc" }],
        select: { id: true, legalName: true, shortName: true },
        where: { status: "ACTIVE" },
      }),
      db.employee.findMany({
        distinct: ["department"],
        orderBy: { department: "asc" },
        select: { department: true },
        where: { archivedAt: null, status: "ACTIVE" },
      }),
      db.viettelPostAccount.findMany({
        include: { company: { select: { legalName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.eshopAccount.findMany({
        include: { company: { select: { legalName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      getModuleConfigUi(),
      getModuleHeaders(),
    ]);

  return {
    brandTheme,
    companies: companies.map((company) => ({
      id: company.id,
      label:
        company.shortName &&
        company.shortName.toLocaleLowerCase("vi") !==
          company.legalName.toLocaleLowerCase("vi")
          ? `${company.legalName} (${company.shortName})`
          : company.legalName,
      shortName: company.shortName ?? "",
      value: company.legalName,
    })),
    departments: employees
      .map((employee) => normalizeText(employee.department))
      .filter(Boolean)
      .map((department) => ({
        id: department,
        label: department,
        value: department,
      })),
    eshopAccounts: eshopAccounts.map((account) => {
      const companyScope = normalizeStringList(account.companyScope);
      if (!companyScope.length && account.company?.legalName) {
        companyScope.push(account.company.legalName);
      }
      return {
        accountName: account.name,
        apiAppId: account.apiAppId ?? "",
        apiDomain: account.apiDomain ?? "",
        apiSecretPreview: previewConfigSecret(account.apiSecret),
        backendSpreadsheetId:
          account.backendSpreadsheetId ?? ESHOP_BACKEND_SPREADSHEET_ID,
        companyScope,
        createdAt: dateText(account.createdAt),
        departmentScope: normalizeStringList(account.departmentScope),
        eshopCompanyKey: account.companyKey ?? "",
        eshopCompanyName:
          account.companyName ?? account.company?.legalName ?? "",
        hasApiSecret: hasConfigSecret(account.apiSecret),
        hasWebBearer: hasConfigSecret(account.webBearer),
        hasWebCookie: hasConfigSecret(account.webCookie),
        id: account.id,
        inventorySheetName: account.inventorySheetName ?? "",
        note: account.note ?? "",
        orderSheetName: account.orderSheetName ?? "",
        status: statusForUi(account.status),
        tokenNote: account.tokenNote ?? "",
        updatedAt: dateText(account.updatedAt),
        webBaseUrl: account.webBaseUrl ?? "",
        webBearerPreview: previewConfigSecret(account.webBearer),
        webBranchId: account.branchId ?? ESHOP_ZERO_GUID,
        webCompanyCode: account.webCompanyCode ?? "",
        webCookiePreview: previewConfigSecret(account.webCookie),
        webLanguage: account.language || "vi-VN",
      };
    }),
    moduleConfigs,
    moduleHeaders,
    tabs: configSections.map((section) => ({
      key: section.key,
      label: section.title,
    })),
    vtpAccounts: vtpAccounts.map((account) => {
      const companyScope = normalizeStringList(account.companyScope);
      if (!companyScope.length && account.company?.legalName) {
        companyScope.push(account.company.legalName);
      }
      return {
        accountName: account.name,
        companyScope,
        createdAt: dateText(account.createdAt),
        dashboardTokenPreview: previewConfigSecret(account.dashboardToken),
        departmentScope: normalizeStringList(account.departmentScope),
        env: account.env === "DEV" ? "DEV" : "PROD",
        hasDashboardToken: hasConfigSecret(account.dashboardToken),
        hasPassword: hasConfigSecret(account.password),
        hasToken: hasConfigSecret(account.token),
        id: account.id,
        note: account.note ?? "",
        status: statusForUi(account.status),
        testOrderCode: account.testOrderCode ?? "",
        tokenNote: account.tokenNote ?? "",
        tokenPreview: previewConfigSecret(account.token),
        updatedAt: dateText(account.updatedAt),
        username: account.username,
      };
    }),
  };
}

export async function getModuleConfigSecret(key: string) {
  const definition = moduleConfigDefinitions.find((item) => item.key === key);
  if (!definition || definition.type !== "secret") return "";
  const db = getDb();
  const keys = [key, ...(definition.fallbackKeys ?? [])];
  const rows = await db.systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { in: keys } },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  for (const candidate of keys) {
    const value = normalizeText(map.get(candidate));
    if (value) return openConfigSecret(value);
  }
  return "";
}
