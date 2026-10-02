CREATE UNIQUE INDEX "ExamSession_id_userId_key" ON "ExamSession"("id", "userId");
CREATE UNIQUE INDEX "ExamQuestion_id_examSessionId_questionId_key" ON "ExamQuestion"("id", "examSessionId", "questionId");

CREATE TABLE "ExamQuestionReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "examSessionId" UUID NOT NULL,
    "examQuestionId" UUID NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamQuestionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamQuestionReport_examQuestionId_key" ON "ExamQuestionReport"("examQuestionId");
CREATE UNIQUE INDEX "ExamQuestionReport_examQuestionId_examSessionId_questionId_key" ON "ExamQuestionReport"("examQuestionId", "examSessionId", "questionId");
CREATE INDEX "ExamQuestionReport_questionId_createdAt_id_idx" ON "ExamQuestionReport"("questionId", "createdAt" DESC, "id" DESC);
CREATE INDEX "ExamQuestionReport_userId_createdAt_id_idx" ON "ExamQuestionReport"("userId", "createdAt" DESC, "id" DESC);

ALTER TABLE "ExamQuestionReport" ADD CONSTRAINT "ExamQuestionReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamQuestionReport" ADD CONSTRAINT "ExamQuestionReport_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamQuestionReport" ADD CONSTRAINT "ExamQuestionReport_examSessionId_userId_fkey" FOREIGN KEY ("examSessionId", "userId") REFERENCES "ExamSession"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamQuestionReport" ADD CONSTRAINT "ExamQuestionReport_examQuestionId_examSessionId_questionId_fkey" FOREIGN KEY ("examQuestionId", "examSessionId", "questionId") REFERENCES "ExamQuestion"("id", "examSessionId", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE;
