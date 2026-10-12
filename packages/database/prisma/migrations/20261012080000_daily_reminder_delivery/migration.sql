CREATE TYPE "DailyReminderDeliveryStatus" AS ENUM ('CLAIMED', 'SENT', 'FAILED');

CREATE TABLE "DailyReminderDelivery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "localDate" DATE NOT NULL,
    "status" "DailyReminderDeliveryStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyReminderDelivery_userId_localDate_key"
  ON "DailyReminderDelivery"("userId", "localDate");
CREATE INDEX "DailyReminderDelivery_localDate_status_idx"
  ON "DailyReminderDelivery"("localDate", "status");

ALTER TABLE "DailyReminderDelivery"
  ADD CONSTRAINT "DailyReminderDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
