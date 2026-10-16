CREATE TABLE "AirConditionerDevice" (
  "id" TEXT NOT NULL,
  "externalId" TEXT,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "rootType" TEXT,
  "online" BOOLEAN NOT NULL DEFAULT TRUE,
  "powerOn" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "capabilities" JSONB NOT NULL DEFAULT '{"power":true,"temperature":false,"mode":false}',
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "lastSeenAt" TIMESTAMP(3),
  "lastCommandAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "AirConditionerDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AirConditionerCommand" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "actorId" TEXT,
  "actorName" TEXT,
  "response" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AirConditionerCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirConditionerDevice_externalId_key" ON "AirConditionerDevice"("externalId");
CREATE INDEX "AirConditionerDevice_status_sortOrder_idx" ON "AirConditionerDevice"("status", "sortOrder");
CREATE INDEX "AirConditionerDevice_online_updatedAt_idx" ON "AirConditionerDevice"("online", "updatedAt" DESC);
CREATE UNIQUE INDEX "AirConditionerCommand_requestId_key" ON "AirConditionerCommand"("requestId");
CREATE INDEX "AirConditionerCommand_deviceId_createdAt_idx" ON "AirConditionerCommand"("deviceId", "createdAt" DESC);
CREATE INDEX "AirConditionerCommand_actorId_createdAt_idx" ON "AirConditionerCommand"("actorId", "createdAt" DESC);
CREATE INDEX "AirConditionerCommand_status_createdAt_idx" ON "AirConditionerCommand"("status", "createdAt" DESC);

ALTER TABLE "AirConditionerCommand"
  ADD CONSTRAINT "AirConditionerCommand_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "AirConditionerDevice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "AppModule" (
  "id", "key", "label", "description", "icon", "groupId",
  "sortOrder", "isActive", "createdAt", "updatedAt"
)
SELECT
  'air-conditioner-control-module', 'air-conditioner-control',
  'Điều khiển máy lạnh', 'Theo dõi và bật/tắt máy lạnh nội bộ.',
  'snowflake', "id", 30, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ModuleGroup"
WHERE "key" = 'tien-ich'
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "groupId" = EXCLUDED."groupId",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Permission" (
  "id", "key", "module", "action", "description", "appModuleId", "createdAt"
)
SELECT
  'air-conditioner-control-read-permission', 'air_conditioner_control.read',
  'air_conditioner_control', 'read', 'Xem module Điều khiển máy lạnh.',
  "id", CURRENT_TIMESTAMP
FROM "AppModule"
WHERE "key" = 'air-conditioner-control'
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description",
  "appModuleId" = EXCLUDED."appModuleId";

INSERT INTO "AirConditionerDevice" (
  "id", "externalId", "name", "location", "rootType", "online", "powerOn",
  "sortOrder", "lastSeenAt", "createdAt", "updatedAt"
) VALUES
  ('air-device-reception', 'demo-reception', 'Máy lạnh Lễ tân', 'Khu vực Lễ tân', 'switch', TRUE, TRUE, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('air-device-meeting-room', 'demo-meeting-room', 'Máy lạnh Phòng họp', 'Phòng họp', 'switch', TRUE, FALSE, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('air-device-records-room', 'demo-records-room', 'Máy lạnh Kho hồ sơ', 'Kho hồ sơ', 'switch', FALSE, FALSE, 30, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("externalId") DO NOTHING;
