CREATE TABLE "ConfigurationRecord" (
    "id" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "code" TEXT,
    "parentCode" TEXT,
    "name" TEXT,
    "status" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigurationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConfigurationRecord_recordType_sourceSheet_sourceRow_key"
ON "ConfigurationRecord"("recordType", "sourceSheet", "sourceRow");

CREATE INDEX "ConfigurationRecord_recordType_status_idx"
ON "ConfigurationRecord"("recordType", "status");

CREATE INDEX "ConfigurationRecord_recordType_code_idx"
ON "ConfigurationRecord"("recordType", "code");
