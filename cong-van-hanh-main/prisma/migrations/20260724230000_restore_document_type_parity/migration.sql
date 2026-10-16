ALTER TABLE "DocumentType"
ADD COLUMN "declarationTypes" JSONB NOT NULL DEFAULT '["partner","period","detail"]',
ADD COLUMN "legacySheetRow" INTEGER;

CREATE UNIQUE INDEX "DocumentType_legacySheetRow_key"
ON "DocumentType"("legacySheetRow");
