-- MST pháp nhân độc lập có 10 chữ số. Nguồn Sheet cũ từng ép kiểu số
-- nên các MST bắt đầu bằng 0 đã bị rút còn 9 chữ số.
UPDATE "Company"
SET
  "taxCode" = LPAD("taxCode", 10, '0'),
  "updatedAt" = NOW()
WHERE "taxCode" ~ '^[0-9]{9}$';

UPDATE "Company"
SET
  "branchName" = 'Công ty CP Thuần Việt Global',
  "updatedAt" = NOW()
WHERE "code" = 'TVG';
