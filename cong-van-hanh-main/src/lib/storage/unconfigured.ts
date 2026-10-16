import type {
  ObjectStorageAdapter,
  StoredObjectRef,
} from "@/lib/storage/contracts";
import { StorageNotConfiguredError } from "@/lib/storage/errors";

export function createUnconfiguredStorageAdapter(
  provider: string,
): ObjectStorageAdapter {
  const fail = () => {
    throw new StorageNotConfiguredError(provider);
  };

  return {
    createDownloadUrl: fail,
    createUploadTarget: fail,
    deleteObject: fail,
    stat: fail,
  };
}

export function assertConfiguredObject(object: StoredObjectRef) {
  if (!object.objectKey.trim()) {
    throw new Error("Thiếu object key của file.");
  }

  if (object.provider === "GCS" && !object.bucket?.trim()) {
    throw new Error("File GCS phải có bucket.");
  }
}
