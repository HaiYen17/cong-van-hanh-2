export const LEGACY_INBOX_SOURCE_KEY = "google-sheet-98-inbox";
export const LEGACY_INBOX_SHEET_NAME = "98_Inbox";
export const LEGACY_INBOX_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";

export type InboxMigrationSeverity = "INFO" | "WARNING" | "ERROR";

export type InboxMigrationIssue = {
  code: string;
  field?: string;
  message: string;
  severity: InboxMigrationSeverity;
};

export type LegacyInboxSourceRow = {
  createdAt: unknown;
  creatorDepartment: string;
  creatorEmployeeCode: string;
  creatorName: string;
  errorNote: string;
  payloadRaw: string;
  requestId: string;
  rowNumber: number;
  serviceCode: string;
  status: string;
};

export type LegacyDriveFile = {
  driveFileId: string;
  legacyUrl: string;
  mimeType: string;
  name: string;
  payloadPath: string;
  sizeBytes: number | null;
};

export type LegacyRequestItem = {
  files: LegacyDriveFile[];
  itemIndex: number;
  payload: Record<string, unknown>;
  status: string;
  title: string;
};

export type LegacyLegalDossier = {
  companyName: string;
  companyShortName: string;
  condition: string;
  documentNumber: string;
  documentTypeName: string;
  documentTypeRow: number | null;
  fileStatus: string;
  generatedStorageName: string;
  itemIndex: number;
  legacyRegistryId: string;
  numberStatus: string;
  orderStatus: string;
  partnerName: string;
  revision: number | null;
  serial: number | null;
  signDate: string;
  storageCounterparty: string;
  storageIssuedDate: string;
  storageSummary: string;
  submissionOfficeKey: string;
  submissionOfficeLabel: string;
  takesNumber: boolean | null;
};

export type LegacyFollowUp = {
  blocksModules: string[];
  completedAt: string;
  reason: string;
  requestedAt: string;
  status: "PENDING" | "COMPLETED";
  type: string;
};

export type NormalizedLegacyInboxRecord = {
  completedAt: string;
  createdAt: string;
  creatorDepartment: string;
  creatorEmployeeCode: string;
  creatorName: string;
  externalId: string;
  files: LegacyDriveFile[];
  fingerprint: string;
  followUp: LegacyFollowUp | null;
  issues: InboxMigrationIssue[];
  legacyServiceCode: string;
  legacyStatus: string;
  legalDossiers: LegacyLegalDossier[];
  note: string;
  payload: Record<string, unknown>;
  priority: string;
  requestCode: string;
  requestItems: LegacyRequestItem[];
  serviceCode: string;
  serviceLabel: string;
  sourceRow: number;
  status:
    | "SUBMITTED"
    | "IN_PROGRESS"
    | "NEEDS_INFO"
    | "APPROVED"
    | "REJECTED"
    | "COMPLETED"
    | "CANCELLED";
  title: string;
  updatedAt: string;
};

export type InboxMigrationPhase = "ALL" | "FILES" | "REQUESTS";

export type InboxMigrationCounters = {
  filesCreated: number;
  filesLinked: number;
  rowsCreated: number;
  rowsFailed: number;
  rowsRead: number;
  rowsSkipped: number;
  rowsUpdated: number;
  rowsValid: number;
};

export type DriveFileMetadata = {
  createdTime?: string;
  driveFileId: string;
  legacyUrl: string;
  md5Checksum?: string;
  mimeType?: string;
  modifiedTime?: string;
  name?: string;
  parents?: string[];
  sha256Checksum?: string;
  sizeBytes?: number;
  trashed?: boolean;
  webContentLink?: string;
  webViewLink?: string;
};
