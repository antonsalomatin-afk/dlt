CREATE TABLE "QuestionReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "presentationId" UUID NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionReport_presentationId_key" ON "QuestionReport"("presentationId");
CREATE UNIQUE INDEX "QuestionReport_presentationId_userId_questionId_key" ON "QuestionReport"("presentationId", "userId", "questionId");
CREATE INDEX "QuestionReport_questionId_createdAt_id_idx" ON "QuestionReport"("questionId", "createdAt" DESC, "id" DESC);
CREATE INDEX "QuestionReport_userId_createdAt_id_idx" ON "QuestionReport"("userId", "createdAt" DESC, "id" DESC);

ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_presentationId_userId_questionId_fkey" FOREIGN KEY ("presentationId", "userId", "questionId") REFERENCES "QuestionPresentation"("id", "userId", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE;
