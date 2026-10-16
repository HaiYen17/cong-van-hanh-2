UPDATE "AirConditionerDevice"
SET
  "name" = CASE "externalId"
    WHEN 'demo-reception' THEN 'Máy lạnh Lễ tân (mẫu)'
    WHEN 'demo-meeting-room' THEN 'Máy lạnh Phòng họp (mẫu)'
    WHEN 'demo-records-room' THEN 'Máy lạnh Kho hồ sơ (mẫu)'
    ELSE "name"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "externalId" IN ('demo-reception', 'demo-meeting-room', 'demo-records-room');
