-- Một mã số thuế có thể được dùng cho nhiều tên thương mại/pháp nhân hiển thị
-- trong cấu hình cũ (hiện tại Nệm Thuần Việt và Night Dream dùng chung MST).
DROP INDEX IF EXISTS "Company_taxCode_key";
CREATE INDEX IF NOT EXISTS "Company_taxCode_idx" ON "Company"("taxCode");

UPDATE "Company"
SET
  "shortName" = 'NTV',
  "branchName" = 'Công ty Cổ phần Nệm Thuần Việt',
  "taxCode" = '315308944',
  "businessRegistration" = 'Lần 06 19/09/2024',
  "representative" = 'Phạm Văn Bình',
  "address" = '562 Đường 3 Tháng 2, Phường Diên Hồng, Thành phố Hồ Chí Minh, Việt Nam',
  "updatedAt" = NOW()
WHERE "code" = 'NTV';

UPDATE "Company"
SET
  "shortName" = 'NDL',
  "branchName" = 'Công ty TNHH Night Dream',
  "taxCode" = '315308944',
  "businessRegistration" = 'Lần 08 11/11/2025',
  "representative" = 'Phạm Văn Bình',
  "address" = '562 Đường 3 Tháng 2, Phường Diên Hồng, Thành phố Hồ Chí Minh, Việt Nam',
  "updatedAt" = NOW()
WHERE "code" = 'NDL';

UPDATE "Company"
SET
  "shortName" = 'TVD',
  "branchName" = 'Công ty TNHH Thuần Việt Digital',
  "taxCode" = '318733601',
  "businessRegistration" = 'Lần đầu 28/10/2024',
  "representative" = 'Trịnh Ngọc Khánh Hưng',
  "address" = 'H76-H77 Dương Thị Giang, Phường Đông Hưng Thuận, Thành phố Hồ Chí Minh, Việt Nam',
  "updatedAt" = NOW()
WHERE "code" = 'TVD';

UPDATE "Company"
SET
  "shortName" = 'NTC',
  "branchName" = 'Công ty Cổ phần Sản xuất và Thương mại Nệm Thành Công',
  "taxCode" = '1102015078',
  "businessRegistration" = 'Lần 03 25/07/2025',
  "representative" = 'Phạm Văn Bình',
  "address" = 'Đườg số 8, Cụm Công nghiệp Hoàng Gia, Ấp mới 2, Xã Mỹ Hạnh, Tỉnh Tây Ninh, Việt Nam',
  "updatedAt" = NOW()
WHERE "code" = 'NTC';

UPDATE "Company"
SET
  "shortName" = 'TVG',
  "branchName" = 'Công ty CP Thuần Việt Global',
  "taxCode" = '318692955',
  "businessRegistration" = 'Lần 01 06/04/2026',
  "representative" = 'Nguyễn Thiện Vũ',
  "address" = 'H76-H77 Dương Thị Giang, Phường Đông Hưng Thuận, TP HCM',
  "updatedAt" = NOW()
WHERE "code" = 'TVG';
