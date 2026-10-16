import type { ConfigDef } from "@/lib/config/definitions";
import type { BrandTheme } from "@/lib/config/brand-theme-shared";
import type { ModuleHeaderUi } from "@/lib/config/module-header-shared";

export const VTP_BASE_URLS = {
  DEV: "https://partnerdev.viettelpost.vn",
  PROD: "https://partner.viettelpost.vn",
} as const;

export const VTP_DASHBOARD_BASE_URL = "https://api.viettelpost.vn";
export const ESHOP_BACKEND_SPREADSHEET_ID =
  "1rlCZxa1JqsAfKRskbIZsLtRufLx6BckijCWLaodDm2k";
export const ESHOP_ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export type ScopeOption = {
  id: string;
  label: string;
  shortName?: string;
  value: string;
};

export type VtpAccountUi = {
  accountName: string;
  companyScope: string[];
  createdAt: string;
  dashboardTokenPreview: string;
  departmentScope: string[];
  env: "DEV" | "PROD";
  hasDashboardToken: boolean;
  hasPassword: boolean;
  hasToken: boolean;
  id: string;
  note: string;
  status: "Kích hoạt" | "Vô hiệu";
  testOrderCode: string;
  tokenNote: string;
  tokenPreview: string;
  updatedAt: string;
  username: string;
};

export type EshopAccountUi = {
  accountName: string;
  apiAppId: string;
  apiDomain: string;
  apiSecretPreview: string;
  backendSpreadsheetId: string;
  companyScope: string[];
  createdAt: string;
  departmentScope: string[];
  eshopCompanyKey: string;
  eshopCompanyName: string;
  hasApiSecret: boolean;
  hasWebBearer: boolean;
  hasWebCookie: boolean;
  id: string;
  inventorySheetName: string;
  note: string;
  orderSheetName: string;
  status: "Kích hoạt" | "Vô hiệu";
  tokenNote: string;
  updatedAt: string;
  webBaseUrl: string;
  webBearerPreview: string;
  webBranchId: string;
  webCompanyCode: string;
  webCookiePreview: string;
  webLanguage: string;
};

export type ModuleConfigUi = ConfigDef & {
  configured: boolean;
  secretConfigured: boolean;
  secretPreview: string;
  source: string;
  value: string;
};

export type GlobalConfigSnapshot = {
  brandTheme: BrandTheme;
  companies: ScopeOption[];
  departments: ScopeOption[];
  eshopAccounts: EshopAccountUi[];
  moduleConfigs: ModuleConfigUi[];
  moduleHeaders: ModuleHeaderUi[];
  tabs: { key: string; label: string }[];
  vtpAccounts: VtpAccountUi[];
};
