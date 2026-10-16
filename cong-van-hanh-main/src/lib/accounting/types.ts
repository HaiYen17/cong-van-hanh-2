import type { PoolClient } from "pg";

export type JsonObject = Record<string, unknown>;

export type AccountingRecordType =
  | "COMPANY"
  | "ACCOUNT"
  | "ACCOUNT_SET"
  | "ACCOUNT_SET_MEMBER"
  | "DATA_SOURCE"
  | "SOURCE_FIELD_MAPPING"
  | "REPORT"
  | "REPORT_COLUMN"
  | "REPORT_ROW"
  | "RULE"
  | "STYLE"
  | "DISCLOSURE_TEMPLATE"
  | "DISCLOSURE_SECTION"
  | "DISCLOSURE_ITEM"
  | "DISCLOSURE_LINK"
  | "OWNERSHIP"
  | "ELIMINATION_RULE";

export type AccountingRecord = {
  companyKey: string;
  createdAt: string;
  createdBy: string;
  displayCode: string;
  displayName: string;
  entityKey: string;
  isDeleted: false;
  parentKey: string;
  payload: JsonObject;
  recordId: string;
  recordType: AccountingRecordType;
  sortOrder: number;
  status: string;
  updatedAt: string;
  updatedBy: string;
  validFrom: string;
  validTo: string;
  versionId: string;
};

export type AccountingVersion = {
  createdAt: string;
  createdBy: string;
  displayName: string;
  entityKey: string;
  payload: {
    note: string;
    statusCode: string;
    versionName: string;
  };
  recordId: string;
  recordType: "CONFIG_VERSION";
  sourceVersionId: string;
  status: string;
  updatedAt: string;
  updatedBy: string;
  versionId: string;
};

export type AccountingGroups = {
  companies: AccountingRecord[];
  accounts: AccountingRecord[];
  accountSets: AccountingRecord[];
  accountSetMembers: AccountingRecord[];
  dataSources: AccountingRecord[];
  sourceFieldMappings: AccountingRecord[];
  reports: AccountingRecord[];
  reportColumns: AccountingRecord[];
  reportRows: AccountingRecord[];
  rules: AccountingRecord[];
  styles: AccountingRecord[];
  disclosureTemplates: AccountingRecord[];
  disclosureSections: AccountingRecord[];
  disclosureItems: AccountingRecord[];
  disclosureLinks: AccountingRecord[];
  ownerships: AccountingRecord[];
  eliminationRules: AccountingRecord[];
};

export type RecordInput = {
  payload: JsonObject;
  recordId: string;
  recordType: AccountingRecordType;
};

export type ValidationIssue = {
  entityKey: string;
  field: string;
  message: string;
  recordId: string;
  recordType: string;
  severity: "ERROR" | "WARNING" | "INFO";
};

export type TransactionClient = PoolClient;

export class AccountingRpcError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AccountingRpcError";
  }
}
