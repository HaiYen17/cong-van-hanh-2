export type StorageProviderKey = "GCS" | "GOOGLE_DRIVE";

export type StoredObjectRef = {
  bucket?: string;
  objectKey: string;
  provider: StorageProviderKey;
};

export type UploadTarget = {
  expiresAt: Date;
  headers: Record<string, string>;
  method: "POST" | "PUT";
  object: StoredObjectRef;
  url: string;
};

export type StoredObjectStat = StoredObjectRef & {
  etag?: string;
  mimeType?: string;
  sha256?: string;
  sizeBytes?: bigint;
};

export interface ObjectStorageAdapter {
  createDownloadUrl(
    object: StoredObjectRef,
    options?: { downloadName?: string; expiresInSeconds?: number },
  ): Promise<{ expiresAt: Date; url: string }>;
  createUploadTarget(input: {
    mimeType?: string;
    object: StoredObjectRef;
    sizeBytes?: bigint;
  }): Promise<UploadTarget>;
  deleteObject(object: StoredObjectRef): Promise<void>;
  stat(object: StoredObjectRef): Promise<StoredObjectStat>;
}
