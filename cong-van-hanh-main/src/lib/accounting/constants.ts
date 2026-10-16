import type {
  AccountingGroups,
  AccountingRecordType,
} from "@/lib/accounting/types";

export const ACCOUNTING_SCHEMA = "accounting_portal";

export const RECORD_GROUPS = {
  COMPANY: "companies",
  ACCOUNT: "accounts",
  ACCOUNT_SET: "accountSets",
  ACCOUNT_SET_MEMBER: "accountSetMembers",
  DATA_SOURCE: "dataSources",
  SOURCE_FIELD_MAPPING: "sourceFieldMappings",
  REPORT: "reports",
  REPORT_COLUMN: "reportColumns",
  REPORT_ROW: "reportRows",
  RULE: "rules",
  STYLE: "styles",
  DISCLOSURE_TEMPLATE: "disclosureTemplates",
  DISCLOSURE_SECTION: "disclosureSections",
  DISCLOSURE_ITEM: "disclosureItems",
  DISCLOSURE_LINK: "disclosureLinks",
  OWNERSHIP: "ownerships",
  ELIMINATION_RULE: "eliminationRules",
} as const satisfies Record<AccountingRecordType, keyof AccountingGroups>;

export const ACCOUNTING_RECORD_TYPES = Object.freeze({
  VERSION: "CONFIG_VERSION",
  COMPANY: "COMPANY",
  ACCOUNT: "ACCOUNT",
  ACCOUNT_SET: "ACCOUNT_SET",
  ACCOUNT_SET_MEMBER: "ACCOUNT_SET_MEMBER",
  DATA_SOURCE: "DATA_SOURCE",
  SOURCE_FIELD_MAPPING: "SOURCE_FIELD_MAPPING",
  REPORT: "REPORT",
  REPORT_COLUMN: "REPORT_COLUMN",
  REPORT_ROW: "REPORT_ROW",
  RULE: "RULE",
  STYLE: "STYLE",
  DISCLOSURE_TEMPLATE: "DISCLOSURE_TEMPLATE",
  DISCLOSURE_SECTION: "DISCLOSURE_SECTION",
  DISCLOSURE_ITEM: "DISCLOSURE_ITEM",
  DISCLOSURE_LINK: "DISCLOSURE_LINK",
  OWNERSHIP: "OWNERSHIP",
  ELIMINATION_RULE: "ELIMINATION_RULE",
});

export const ROW_TYPES = [
  "TITLE",
  "SECTION",
  "LABEL",
  "DATA",
  "FORMULA",
  "CROSS_REPORT",
  "MANUAL_ADJUSTMENT",
  "SUBTOTAL",
  "TOTAL",
  "NOTE",
  "SPACER",
] as const;

export const COLUMN_TYPES = [
  "LABEL",
  "ROW_CODE",
  "NOTE_REFERENCE",
  "CURRENT_PERIOD",
  "PREVIOUS_PERIOD",
  "BUDGET",
  "VARIANCE",
  "COMPANY",
  "CONSOLIDATED",
] as const;

export const OPERATORS = [
  "BALANCE",
  "MOVEMENT",
  "MOVEMENT_DETAIL",
  "PROFIT_LOSS_ACTIVITY",
  "DELTA_BALANCE",
  "CASH_MOVEMENT",
  "LINE_REFERENCE",
  "SUM_LINES",
  "SUBTRACT_LINES",
  "LINE_EXPRESSION",
  "CROSS_REPORT",
  "MANUAL_ADJUSTMENT",
] as const;

export const SOURCE_TYPES = [
  "EXCEL",
  "AMIS_OPEN_API",
  "AMIS_SESSION",
  "MANUAL",
] as const;

export const MATCH_TYPES = ["EXACT", "PREFIX", "MIXED"] as const;
export const MAPPING_ROLES = ["INCLUDE", "EXCLUDE", "COUNTER"] as const;

export const VERSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Đang soạn",
  PUBLISHED: "Đang phát hành",
  ARCHIVED: "Đã lưu trữ",
};
