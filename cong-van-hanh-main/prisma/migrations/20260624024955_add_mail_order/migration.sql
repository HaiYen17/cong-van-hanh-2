-- CreateTable
CREATE TABLE "MailOrder" (
    "id" TEXT NOT NULL,
    "vtpAccountId" TEXT,
    "companyId" TEXT,
    "orderNumber" TEXT,
    "trackingCode" TEXT,
    "service" TEXT,
    "serviceName" TEXT,
    "senderName" TEXT NOT NULL,
    "senderPhone" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "senderProvince" INTEGER,
    "senderDistrict" INTEGER,
    "senderWard" INTEGER,
    "receiverName" TEXT NOT NULL,
    "receiverPhone" TEXT NOT NULL,
    "receiverAddress" TEXT NOT NULL,
    "receiverProvince" INTEGER,
    "receiverDistrict" INTEGER,
    "receiverWard" INTEGER,
    "productType" TEXT NOT NULL DEFAULT 'TH',
    "productName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "weight" INTEGER NOT NULL DEFAULT 50,
    "productPrice" INTEGER NOT NULL DEFAULT 0,
    "moneyCollection" INTEGER NOT NULL DEFAULT 0,
    "orderPayment" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "fee" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Đang theo dõi',
    "vtpStatus" TEXT,
    "rawResponse" JSONB,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailOrder_status_createdAt_idx" ON "MailOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "MailOrder" ADD CONSTRAINT "MailOrder_vtpAccountId_fkey" FOREIGN KEY ("vtpAccountId") REFERENCES "ViettelPostAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
