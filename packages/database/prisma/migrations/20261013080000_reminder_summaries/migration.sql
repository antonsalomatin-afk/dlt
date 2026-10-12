CREATE TYPE "ReminderSummaryType" AS ENUM ('DAILY', 'WEEKLY');

CREATE TABLE "ReminderSummaryDelivery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "summaryType" "ReminderSummaryType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "status" "DailyReminderDeliveryStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReminderSummaryDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReminderSummaryDelivery_userId_summaryType_periodStart_key"
  ON "ReminderSummaryDelivery"("userId", "summaryType", "periodStart");
CREATE INDEX "ReminderSummaryDelivery_periodStart_summaryType_status_idx"
  ON "ReminderSummaryDelivery"("periodStart", "summaryType", "status");

ALTER TABLE "ReminderSummaryDelivery"
  ADD CONSTRAINT "ReminderSummaryDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
