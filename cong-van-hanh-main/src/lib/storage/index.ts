export type {
  ObjectStorageAdapter,
  StoredObjectRef,
  StoredObjectStat,
  StorageProviderKey,
  UploadTarget,
} from "@/lib/storage/contracts";
export { StorageNotConfiguredError } from "@/lib/storage/errors";
export {
  fileMetadataDto,
  linkFileToEntity,
  registerFileMetadata,
} from "@/lib/storage/metadata";
export {
  assertConfiguredObject,
  createUnconfiguredStorageAdapter,
} from "@/lib/storage/unconfigured";
