-- CreateEnum
CREATE TYPE "MotivationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ReactionSet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "status" "MotivationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReactionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "imageUrl" TEXT,
    "imageId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "saveResponse" BOOLEAN NOT NULL DEFAULT true,
    "status" "MotivationStatus" NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "reactionSetId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MotivationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationReaction" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationReaction_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReactionSet_key_key" ON "ReactionSet"("key");

-- CreateIndex
CREATE INDEX "MotivationEvent_status_priority_idx" ON "MotivationEvent"("status", "priority");

-- CreateIndex
CREATE INDEX "MotivationEvent_startAt_endAt_idx" ON "MotivationEvent"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "MotivationReaction_eventId_idx" ON "MotivationReaction"("eventId");

-- AddForeignKey
ALTER TABLE "MotivationEvent" ADD CONSTRAINT "MotivationEvent_reactionSetId_fkey" FOREIGN KEY ("reactionSetId") REFERENCES "ReactionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationEvent" ADD CONSTRAINT "MotivationEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationReaction" ADD CONSTRAINT "MotivationReaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MotivationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationReaction" ADD CONSTRAINT "MotivationReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
