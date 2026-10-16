CREATE TABLE "DigitalSignatureWorkflow" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD',
  "originalFileId" TEXT,
  "originalSha256" TEXT,
  "placements" JSONB NOT NULL DEFAULT '[]',
  "summary" JSONB,
  "summaryModel" TEXT,
  "approvedSnapshotHash" TEXT,
  "bodApprovedById" TEXT,
  "bodApprovedAt" TIMESTAMP(3),
  "adminSignedById" TEXT,
  "signedAt" TIMESTAMP(3),
  "outputFileId" TEXT,
  "completedPlacements" INTEGER NOT NULL DEFAULT 0,
  "runtime" JSONB NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "error" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DigitalSignatureWorkflow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignatureWorkflow_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DigitalSignatureWorkflow_requestId_key" ON "DigitalSignatureWorkflow"("requestId");
CREATE INDEX "DigitalSignatureWorkflow_state_nextAttemptAt_idx" ON "DigitalSignatureWorkflow"("state", "nextAttemptAt");
CREATE INDEX "DigitalSignatureWorkflow_companyId_state_idx" ON "DigitalSignatureWorkflow"("companyId", "state");
