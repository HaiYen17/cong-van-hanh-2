CREATE TABLE "WorkbenchLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Bàn làm việc của tôi',
    "columns" INTEGER NOT NULL DEFAULT 16,
    "rows" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchLayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkbenchWidget" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "widgetKey" TEXT NOT NULL,
    "title" TEXT,
    "color" TEXT NOT NULL DEFAULT 'teal',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchWidget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkbenchLayout_userId_key" ON "WorkbenchLayout"("userId");
CREATE INDEX "WorkbenchWidget_layoutId_sortOrder_idx" ON "WorkbenchWidget"("layoutId", "sortOrder");
CREATE INDEX "WorkbenchWidget_widgetKey_idx" ON "WorkbenchWidget"("widgetKey");

ALTER TABLE "WorkbenchLayout"
ADD CONSTRAINT "WorkbenchLayout_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkbenchWidget"
ADD CONSTRAINT "WorkbenchWidget_layoutId_fkey"
FOREIGN KEY ("layoutId") REFERENCES "WorkbenchLayout"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
