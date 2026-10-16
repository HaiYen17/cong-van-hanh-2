-- CreateTable
CREATE TABLE "ViettelPostAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "env" TEXT NOT NULL DEFAULT 'PROD',
    "username" TEXT NOT NULL,
    "password" TEXT,
    "token" TEXT,
    "dashboardToken" TEXT,
    "testOrderCode" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tokenNote" TEXT,
    "companyId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViettelPostAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EshopAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyKey" TEXT,
    "webBaseUrl" TEXT,
    "webCompanyCode" TEXT,
    "apiDomain" TEXT,
    "apiAppId" TEXT,
    "apiSecret" TEXT,
    "webBearer" TEXT,
    "webCookie" TEXT,
    "branchId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'vi-VN',
    "backendSpreadsheetId" TEXT,
    "orderSheetName" TEXT,
    "inventorySheetName" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tokenNote" TEXT,
    "companyId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EshopAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViettelPostAccount_status_idx" ON "ViettelPostAccount"("status");

-- CreateIndex
CREATE INDEX "EshopAccount_status_idx" ON "EshopAccount"("status");

-- AddForeignKey
ALTER TABLE "ViettelPostAccount" ADD CONSTRAINT "ViettelPostAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EshopAccount" ADD CONSTRAINT "EshopAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
