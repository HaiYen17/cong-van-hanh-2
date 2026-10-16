-- CreateTable
CREATE TABLE "DocumentRegistry" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "documentTypeId" TEXT,
    "documentTypeName" TEXT NOT NULL,
    "companyId" TEXT,
    "companyShort" TEXT NOT NULL,
    "condition" TEXT,
    "partnerName" TEXT,
    "partnerAbbr" TEXT,
    "signDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sealTypes" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRegistry_companyId_createdAt_idx" ON "DocumentRegistry"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentRegistry_documentTypeId_createdAt_idx" ON "DocumentRegistry"("documentTypeId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentRegistry_status_createdAt_idx" ON "DocumentRegistry"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRegistry_poolKey_serial_key" ON "DocumentRegistry"("poolKey", "serial");

-- AddForeignKey
ALTER TABLE "DocumentRegistry" ADD CONSTRAINT "DocumentRegistry_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRegistry" ADD CONSTRAINT "DocumentRegistry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
