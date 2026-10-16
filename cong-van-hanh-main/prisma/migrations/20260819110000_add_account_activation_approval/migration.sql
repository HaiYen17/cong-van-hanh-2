-- Tách việc được Admin xác minh khỏi việc tự tạo mật khẩu lần đầu.
CREATE TYPE "UserActivationStatus" AS ENUM (
    'NOT_REQUESTED',
    'PENDING',
    'APPROVED',
    'REJECTED'
);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVATION_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVATION_APPROVE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVATION_REJECT';

ALTER TABLE "User"
ADD COLUMN "activationStatus" "UserActivationStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN "activationRequestedAt" TIMESTAMP(3),
ADD COLUMN "activationReviewedAt" TIMESTAMP(3);

-- Tài khoản đã có mật khẩu tiếp tục hoạt động. Mọi tài khoản chưa có mật khẩu
-- phải gửi yêu cầu và được Admin duyệt trước khi được phép tạo mật khẩu.
UPDATE "User"
SET
    "activationStatus" = 'NOT_REQUESTED',
    "requiresPassword" = TRUE,
    "activationRequestedAt" = NULL,
    "activationReviewedAt" = NULL
WHERE "passwordHash" = '';

ALTER TABLE "User"
ALTER COLUMN "activationStatus" SET DEFAULT 'NOT_REQUESTED';

-- Thu hồi phiên cũ của các tài khoản chưa có mật khẩu để không còn đường vòng.
UPDATE "AuthSession" AS session
SET "revokedAt" = CURRENT_TIMESTAMP
FROM "User" AS account
WHERE session."userId" = account.id
  AND account."activationStatus" <> 'APPROVED'
  AND session."revokedAt" IS NULL;

CREATE INDEX "User_activationStatus_activationRequestedAt_idx"
ON "User"("activationStatus", "activationRequestedAt");
