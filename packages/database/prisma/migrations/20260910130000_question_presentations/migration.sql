CREATE TABLE "QuestionPresentation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    CONSTRAINT "QuestionPresentation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuestionPresentation_userId_idx" ON "QuestionPresentation"("userId");
CREATE INDEX "QuestionPresentation_questionId_idx" ON "QuestionPresentation"("questionId");
ALTER TABLE "QuestionPresentation" ADD CONSTRAINT "QuestionPresentation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionPresentation" ADD CONSTRAINT "QuestionPresentation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
