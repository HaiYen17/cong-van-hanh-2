-- AlterTable
ALTER TABLE "MotivationEvent" ADD COLUMN     "autoDismissMs" INTEGER,
ADD COLUMN     "closePolicy" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "displayMode" TEXT NOT NULL DEFAULT 'toast',
ADD COLUMN     "level" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "location" TEXT,
ADD COLUMN     "reminderTimes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "requireAck" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetCompanies" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "targetDepartments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "targetEmployees" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "targetScope" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "targetUrl" TEXT;
