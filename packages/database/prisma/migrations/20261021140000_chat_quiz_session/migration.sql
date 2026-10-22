CREATE TABLE "ChatQuizSession" (
  "userId" UUID NOT NULL,
  "presentationId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "language" "PreferredLanguage" NOT NULL,
  "deliveryState" TEXT NOT NULL,
  "claimedAt" TIMESTAMPTZ(3) NOT NULL,
  "pollId" TEXT,
  "messageId" INTEGER,
  CONSTRAINT "ChatQuizSession_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "ChatQuizSession_delivery_valid" CHECK (
    ("deliveryState" IN ('SENDING', 'UNCERTAIN') AND "pollId" IS NULL AND "messageId" IS NULL)
    OR ("deliveryState" IN ('BOUND', 'ANSWERING') AND length("pollId") BETWEEN 1 AND 256 AND "messageId" > 0 AND "pollId" IS NOT NULL AND "messageId" IS NOT NULL)
  ),
  CONSTRAINT "ChatQuizSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatQuizSession_owned_presentation_fkey" FOREIGN KEY ("presentationId", "userId", "questionId") REFERENCES "QuestionPresentation"("id", "userId", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatQuizSession_presentationId_key" ON "ChatQuizSession"("presentationId");
CREATE UNIQUE INDEX "ChatQuizSession_pollId_key" ON "ChatQuizSession"("pollId");
CREATE UNIQUE INDEX "ChatQuizSession_presentationId_userId_questionId_key" ON "ChatQuizSession"("presentationId", "userId", "questionId");
