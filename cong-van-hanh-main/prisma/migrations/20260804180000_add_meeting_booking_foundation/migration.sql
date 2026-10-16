-- CreateEnum
CREATE TYPE "MeetingRoomStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingAttendeeRole" AS ENUM ('ORGANIZER', 'REQUIRED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "MeetingResponseStatus" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "MeetingBotStatus" AS ENUM ('SCHEDULED', 'JOINING', 'WAITING_ROOM', 'IN_CALL', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingMinutesStatus" AS ENUM ('PENDING', 'PROCESSING', 'DRAFT', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "MeetingActionItemStatus" AS ENUM ('DRAFT', 'APPROVED', 'SYNCED', 'CANCELLED');

-- CreateTable
CREATE TABLE "MeetingRoom" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "floor" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "amenities" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "googleCalendarId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "openTime" TEXT NOT NULL DEFAULT '08:00',
    "closeTime" TEXT NOT NULL DEFAULT '18:00',
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 480,
    "color" TEXT NOT NULL DEFAULT '#0f766e',
    "status" "MeetingRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "MeetingRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "blockedStartsAt" TIMESTAMP(3) NOT NULL,
    "blockedEndsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "locationText" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'HYBRID',
    "visibility" TEXT NOT NULL DEFAULT 'PARTICIPANTS',
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "allowAttendeeConflict" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recallEnabled" BOOLEAN NOT NULL DEFAULT true,
    "roomId" TEXT,
    "organizerId" TEXT NOT NULL,
    "googleCalendarEventId" TEXT,
    "googleCalendarHtmlLink" TEXT,
    "googleMeetUrl" TEXT,
    "googleMeetCode" TEXT,
    "calendarSyncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "calendarLastSyncedAt" TIMESTAMP(3),
    "calendarError" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RECALL',
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "meetingId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "MeetingAttendeeRole" NOT NULL DEFAULT 'REQUIRED',
    "responseStatus" "MeetingResponseStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingInterest" (
    "observerUserId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingInterest_pkey" PRIMARY KEY ("observerUserId", "employeeId")
);

-- CreateTable
CREATE TABLE "MeetingBotRun" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RECALL',
    "providerBotId" TEXT,
    "status" "MeetingBotStatus" NOT NULL DEFAULT 'SCHEDULED',
    "joinAt" TIMESTAMP(3) NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "statusSubCode" TEXT,
    "statusMessage" TEXT,
    "recordingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "transcriptStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "webhookLastReceivedAt" TIMESTAMP(3),
    "rawMetadata" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeetingBotRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTranscript" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RECALL',
    "providerTranscriptId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL DEFAULT 'vi',
    "contentText" TEXT,
    "segments" JSONB NOT NULL DEFAULT '[]',
    "speakerMap" JSONB NOT NULL DEFAULT '{}',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "receivedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeetingTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "status" "MeetingMinutesStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "openQuestions" JSONB NOT NULL DEFAULT '[]',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "generatedByModel" TEXT,
    "promptVersion" TEXT,
    "sourceTranscriptChecksum" TEXT,
    "generatedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMinutesVersion" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "content" JSONB NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingMinutesVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "minutesId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MeetingActionItemStatus" NOT NULL DEFAULT 'DRAFT',
    "assigneeEmployeeId" TEXT,
    "assigneeUserId" TEXT,
    "assigneeNameSnapshot" TEXT,
    "dueAt" TIMESTAMP(3),
    "sourceTimestampSeconds" INTEGER,
    "sourceText" TEXT,
    "confidence" DECIMAL(5,4),
    "approvedAt" TIMESTAMP(3),
    "todoRequestId" TEXT,
    "todoOutputId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRoom_code_key" ON "MeetingRoom"("code");
CREATE INDEX "MeetingRoom_status_sortOrder_idx" ON "MeetingRoom"("status", "sortOrder");
CREATE INDEX "MeetingRoom_googleCalendarId_idx" ON "MeetingRoom"("googleCalendarId");
CREATE UNIQUE INDEX "Meeting_code_key" ON "Meeting"("code");
CREATE UNIQUE INDEX "Meeting_googleCalendarEventId_key" ON "Meeting"("googleCalendarEventId");
CREATE INDEX "Meeting_roomId_startsAt_endsAt_idx" ON "Meeting"("roomId", "startsAt", "endsAt");
CREATE INDEX "Meeting_organizerId_startsAt_idx" ON "Meeting"("organizerId", "startsAt" DESC);
CREATE INDEX "Meeting_status_startsAt_idx" ON "Meeting"("status", "startsAt");
CREATE UNIQUE INDEX "MeetingWebhookEvent_providerEventId_key" ON "MeetingWebhookEvent"("providerEventId");
CREATE INDEX "MeetingWebhookEvent_provider_eventType_createdAt_idx" ON "MeetingWebhookEvent"("provider", "eventType", "createdAt" DESC);
CREATE INDEX "MeetingWebhookEvent_meetingId_createdAt_idx" ON "MeetingWebhookEvent"("meetingId", "createdAt" DESC);
CREATE INDEX "MeetingAttendee_employeeId_meetingId_idx" ON "MeetingAttendee"("employeeId", "meetingId");
CREATE INDEX "MeetingAttendee_userId_meetingId_idx" ON "MeetingAttendee"("userId", "meetingId");
CREATE INDEX "MeetingAttendee_email_meetingId_idx" ON "MeetingAttendee"("email", "meetingId");
CREATE UNIQUE INDEX "MeetingAttendee_meetingId_email_key" ON "MeetingAttendee"("meetingId", "email");
CREATE INDEX "MeetingInterest_employeeId_idx" ON "MeetingInterest"("employeeId");
CREATE UNIQUE INDEX "MeetingBotRun_providerBotId_key" ON "MeetingBotRun"("providerBotId");
CREATE INDEX "MeetingBotRun_meetingId_createdAt_idx" ON "MeetingBotRun"("meetingId", "createdAt" DESC);
CREATE INDEX "MeetingBotRun_status_joinAt_idx" ON "MeetingBotRun"("status", "joinAt");
CREATE UNIQUE INDEX "MeetingTranscript_meetingId_key" ON "MeetingTranscript"("meetingId");
CREATE INDEX "MeetingTranscript_status_expiresAt_idx" ON "MeetingTranscript"("status", "expiresAt");
CREATE INDEX "MeetingTranscript_provider_providerTranscriptId_idx" ON "MeetingTranscript"("provider", "providerTranscriptId");
CREATE UNIQUE INDEX "MeetingMinutes_meetingId_key" ON "MeetingMinutes"("meetingId");
CREATE INDEX "MeetingMinutes_status_updatedAt_idx" ON "MeetingMinutes"("status", "updatedAt" DESC);
CREATE INDEX "MeetingMinutesVersion_editedById_createdAt_idx" ON "MeetingMinutesVersion"("editedById", "createdAt" DESC);
CREATE UNIQUE INDEX "MeetingMinutesVersion_minutesId_version_key" ON "MeetingMinutesVersion"("minutesId", "version");
CREATE INDEX "MeetingActionItem_meetingId_status_sortOrder_idx" ON "MeetingActionItem"("meetingId", "status", "sortOrder");
CREATE INDEX "MeetingActionItem_assigneeEmployeeId_status_idx" ON "MeetingActionItem"("assigneeEmployeeId", "status");
CREATE INDEX "MeetingActionItem_assigneeUserId_status_idx" ON "MeetingActionItem"("assigneeUserId", "status");
CREATE INDEX "MeetingActionItem_todoRequestId_idx" ON "MeetingActionItem"("todoRequestId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "MeetingRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingWebhookEvent" ADD CONSTRAINT "MeetingWebhookEvent_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingInterest" ADD CONSTRAINT "MeetingInterest_observerUserId_fkey" FOREIGN KEY ("observerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingInterest" ADD CONSTRAINT "MeetingInterest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingBotRun" ADD CONSTRAINT "MeetingBotRun_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingTranscript" ADD CONSTRAINT "MeetingTranscript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutesVersion" ADD CONSTRAINT "MeetingMinutesVersion_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutesVersion" ADD CONSTRAINT "MeetingMinutesVersion_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_assigneeEmployeeId_fkey" FOREIGN KEY ("assigneeEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_todoRequestId_fkey" FOREIGN KEY ("todoRequestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-level protection against concurrent bookings of the same room.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Meeting"
ADD CONSTRAINT "Meeting_room_blocked_range_excl"
EXCLUDE USING gist (
  "roomId" WITH =,
  tsrange("blockedStartsAt", "blockedEndsAt", '[)') WITH &&
)
WHERE (
  "roomId" IS NOT NULL
  AND "status" IN ('SCHEDULED'::"MeetingStatus", 'IN_PROGRESS'::"MeetingStatus")
);
