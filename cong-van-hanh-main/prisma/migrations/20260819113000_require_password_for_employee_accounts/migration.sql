-- Mọi tài khoản nhân sự đều phải xác thực bằng mật khẩu sau khi được kích hoạt.
-- Thu hồi trước các phiên có thể đã được tạo khi cờ yêu cầu mật khẩu còn tắt.
UPDATE "AuthSession" AS session
SET "revokedAt" = CURRENT_TIMESTAMP
FROM "User" AS account
WHERE session."userId" = account.id
  AND account."employeeId" IS NOT NULL
  AND account."requiresPassword" = FALSE
  AND session."revokedAt" IS NULL;

UPDATE "User"
SET "requiresPassword" = TRUE
WHERE "employeeId" IS NOT NULL
  AND "requiresPassword" = FALSE;
