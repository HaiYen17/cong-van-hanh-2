-- Tách tên kỹ thuật Hunonic khỏi tên hiển thị trên Cổng và chuẩn hóa vị trí
-- Tòa nhà → Tầng → Phòng → Khu vực cho hệ thống điện.
CREATE TABLE "ElectricalLocation" (
    "id" TEXT NOT NULL,
    "building" TEXT NOT NULL DEFAULT 'Trụ sở chính',
    "floor" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectricalLocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AirConditionerDevice"
ADD COLUMN "sourceName" TEXT,
ADD COLUMN "customName" TEXT,
ADD COLUMN "locationId" TEXT;

UPDATE "AirConditionerDevice"
SET "sourceName" = "name"
WHERE "sourceName" IS NULL;

CREATE UNIQUE INDEX "ElectricalLocation_building_floor_room_area_key"
ON "ElectricalLocation"("building", "floor", "room", "area");

CREATE INDEX "ElectricalLocation_building_floor_room_sortOrder_idx"
ON "ElectricalLocation"("building", "floor", "room", "sortOrder");

CREATE INDEX "AirConditionerDevice_locationId_sortOrder_idx"
ON "AirConditionerDevice"("locationId", "sortOrder");

ALTER TABLE "AirConditionerDevice"
ADD CONSTRAINT "AirConditionerDevice_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "ElectricalLocation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
