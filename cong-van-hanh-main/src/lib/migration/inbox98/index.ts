export {
  copyLinkedDriveFileToGcs,
  copyLinkedDriveFilesToGcs,
} from "./file-copy";
export { LegacyGoogleSource } from "./google-source";
export {
  buildDriveExternalId,
  buildInboxDossierExternalId,
  buildInboxExternalId,
  buildInboxItemExternalId,
  buildLegacyGcsObjectKey,
  decideIdempotentWrite,
  extractGoogleDriveId,
  extractLegacyDriveFiles,
  inboxMigrationFingerprint,
  mapLegacyServiceCode,
  mapLegacyStatus,
  normalizeLegacyInboxRow,
  normalizeLegacyKey,
  parseLegacyDate,
  stableJson,
} from "./mapping";
export {
  applyLegacyInboxMigration,
  getLegacyInboxMigrationRun,
  previewLegacyInboxMigration,
  resumeLegacyInboxMigration,
} from "./runner";
export type {
  ApplyInboxMigrationOptions,
  PreviewInboxMigrationOptions,
  ResumeInboxMigrationOptions,
} from "./runner";
export type {
  DriveFileMetadata,
  InboxMigrationCounters,
  InboxMigrationIssue,
  InboxMigrationPhase,
  InboxMigrationSeverity,
  LegacyDriveFile,
  LegacyFollowUp,
  LegacyInboxSourceRow,
  LegacyLegalDossier,
  LegacyRequestItem,
  NormalizedLegacyInboxRecord,
} from "./types";
export {
  LEGACY_INBOX_SHEET_NAME,
  LEGACY_INBOX_SOURCE_KEY,
  LEGACY_INBOX_SPREADSHEET_ID,
} from "./types";
