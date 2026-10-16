-- AlterTable
ALTER TABLE "RequestAttachment" ADD COLUMN "fileObjectId" TEXT;

-- CreateTable
CREATE TABLE "MigrationSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "createdById" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MigrationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SYNC',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "phase" TEXT,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsValid" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "previewToken" TEXT,
    "previewExpiresAt" TIMESTAMP(3),
    "cursor" JSONB,
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sourceConfigSnapshot" JSONB NOT NULL DEFAULT '{}',
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT,
    "internalId" TEXT,
    "fingerprint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "rowNumber" INTEGER,
    "externalId" TEXT,
    "field" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdMap" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "fingerprint" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TEXT,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "sourceDriveId" TEXT,
    "migrationState" TEXT NOT NULL DEFAULT 'NATIVE',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TEXT,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "uploadedById" TEXT,
    "sourceDriveId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileLink" (
    "id" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'ATTACHMENT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAccessGrant" (
    "id" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'READ',
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MigrationSource_key_key" ON "MigrationSource"("key");
CREATE INDEX "MigrationSource_kind_status_idx" ON "MigrationSource"("kind", "status");
CREATE INDEX "MigrationRun_sourceId_startedAt_idx" ON "MigrationRun"("sourceId", "startedAt" DESC);
CREATE INDEX "MigrationRun_status_startedAt_idx" ON "MigrationRun"("status", "startedAt" DESC);
CREATE UNIQUE INDEX "MigrationRun_previewToken_key" ON "MigrationRun"("previewToken");
CREATE UNIQUE INDEX "MigrationRecord_runId_rowNumber_key" ON "MigrationRecord"("runId", "rowNumber");
CREATE INDEX "MigrationRecord_runId_status_idx" ON "MigrationRecord"("runId", "status");
CREATE INDEX "MigrationRecord_entityType_externalId_idx" ON "MigrationRecord"("entityType", "externalId");
CREATE INDEX "MigrationIssue_runId_severity_idx" ON "MigrationIssue"("runId", "severity");
CREATE INDEX "MigrationIssue_code_createdAt_idx" ON "MigrationIssue"("code", "createdAt");
CREATE UNIQUE INDEX "ExternalIdMap_sourceId_entityType_externalId_key" ON "ExternalIdMap"("sourceId", "entityType", "externalId");
CREATE INDEX "ExternalIdMap_entityType_internalId_idx" ON "ExternalIdMap"("entityType", "internalId");
CREATE UNIQUE INDEX "FileObject_sourceDriveId_key" ON "FileObject"("sourceDriveId");
CREATE UNIQUE INDEX "FileObject_provider_bucket_objectKey_key" ON "FileObject"("provider", "bucket", "objectKey");
CREATE INDEX "FileObject_ownerId_createdAt_idx" ON "FileObject"("ownerId", "createdAt" DESC);
CREATE INDEX "FileObject_status_migrationState_idx" ON "FileObject"("status", "migrationState");
CREATE INDEX "FileObject_sha256_idx" ON "FileObject"("sha256");
CREATE UNIQUE INDEX "FileVersion_fileObjectId_versionNumber_key" ON "FileVersion"("fileObjectId", "versionNumber");
CREATE UNIQUE INDEX "FileVersion_provider_bucket_objectKey_key" ON "FileVersion"("provider", "bucket", "objectKey");
CREATE INDEX "FileVersion_sha256_idx" ON "FileVersion"("sha256");
CREATE UNIQUE INDEX "FileLink_fileObjectId_entityType_entityId_purpose_key" ON "FileLink"("fileObjectId", "entityType", "entityId", "purpose");
CREATE INDEX "FileLink_entityType_entityId_purpose_idx" ON "FileLink"("entityType", "entityId", "purpose");
CREATE UNIQUE INDEX "FileAccessGrant_fileObjectId_principalType_principalId_permission_key" ON "FileAccessGrant"("fileObjectId", "principalType", "principalId", "permission");
CREATE INDEX "FileAccessGrant_principalType_principalId_idx" ON "FileAccessGrant"("principalType", "principalId");
CREATE INDEX "RequestAttachment_fileObjectId_idx" ON "RequestAttachment"("fileObjectId");

-- AddForeignKey
ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MigrationSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MigrationIssue" ADD CONSTRAINT "MigrationIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdMap" ADD CONSTRAINT "ExternalIdMap_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MigrationSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileLink" ADD CONSTRAINT "FileLink_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileAccessGrant" ADD CONSTRAINT "FileAccessGrant_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestAttachment" ADD CONSTRAINT "RequestAttachment_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
