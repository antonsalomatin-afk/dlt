CREATE TABLE "GroupQuizScope" (
  "telegramChatId" BIGINT NOT NULL,
  "threadId" INTEGER NOT NULL DEFAULT 0,
  "currentRoundId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GroupQuizScope_pkey" PRIMARY KEY ("telegramChatId", "threadId"),
  CONSTRAINT "GroupQuizScope_bounds" CHECK ("telegramChatId" BETWEEN -4503599627370495 AND -1 AND "threadId" >= 0)
);
CREATE TABLE "GroupQuizRound" (
  "id" UUID NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "threadId" INTEGER NOT NULL,
  "initiatorId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "conceptId" UUID,
  "snapshot" JSONB NOT NULL,
  "vehicleType" "VehicleType" NOT NULL,
  "language" "PreferredLanguage" NOT NULL DEFAULT 'ENGLISH',
  "deliveryState" TEXT NOT NULL,
  "claimedAt" TIMESTAMPTZ(3) NOT NULL,
  "pollId" TEXT,
  "messageId" INTEGER,
  "controlMessageId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(3),
  CONSTRAINT "GroupQuizRound_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupQuizRound_delivery_valid" CHECK (
    "deliveryState" IN ('SENDING','BOUND','UNCERTAIN','CLOSED')
    AND ("deliveryState" <> 'BOUND' OR ("pollId" IS NOT NULL AND "messageId" IS NOT NULL))
    AND ("pollId" IS NULL OR length("pollId") BETWEEN 1 AND 256)
    AND ("messageId" IS NULL OR "messageId" > 0)
    AND ("controlMessageId" IS NULL OR "controlMessageId" > 0)
    AND (("deliveryState" = 'CLOSED' AND "closedAt" IS NOT NULL) OR ("deliveryState" <> 'CLOSED' AND "closedAt" IS NULL))
  ),
  CONSTRAINT "GroupQuizRound_scope_fkey" FOREIGN KEY ("telegramChatId","threadId") REFERENCES "GroupQuizScope"("telegramChatId","threadId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupQuizRound_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupQuizRound_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupQuizRound_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupQuizScope_currentRoundId_key" ON "GroupQuizScope"("currentRoundId");
CREATE UNIQUE INDEX "GroupQuizRound_pollId_key" ON "GroupQuizRound"("pollId");
CREATE UNIQUE INDEX "GroupQuizRound_id_telegramChatId_threadId_key" ON "GroupQuizRound"("id","telegramChatId","threadId");
CREATE UNIQUE INDEX "GroupQuizRound_id_questionId_key" ON "GroupQuizRound"("id","questionId");
CREATE INDEX "GroupQuizRound_telegramChatId_threadId_createdAt_idx" ON "GroupQuizRound"("telegramChatId","threadId","createdAt");
ALTER TABLE "GroupQuizScope" ADD CONSTRAINT "GroupQuizScope_currentRound_fkey" FOREIGN KEY ("currentRoundId","telegramChatId","threadId") REFERENCES "GroupQuizRound"("id","telegramChatId","threadId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "GroupQuizVote" (
  "roundId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "presentationId" UUID NOT NULL,
  CONSTRAINT "GroupQuizVote_pkey" PRIMARY KEY ("roundId","userId"),
  CONSTRAINT "GroupQuizVote_round_question_fkey" FOREIGN KEY ("roundId","questionId") REFERENCES "GroupQuizRound"("id","questionId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupQuizVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupQuizVote_owned_presentation_fkey" FOREIGN KEY ("presentationId","userId","questionId") REFERENCES "QuestionPresentation"("id","userId","questionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupQuizVote_presentationId_key" ON "GroupQuizVote"("presentationId");

CREATE UNIQUE INDEX "GroupQuizScope_currentRoundId_telegramChatId_threadId_key" ON "GroupQuizScope"("currentRoundId","telegramChatId","threadId");
CREATE UNIQUE INDEX "GroupQuizVote_presentationId_userId_questionId_key" ON "GroupQuizVote"("presentationId","userId","questionId");
