CREATE TABLE "AnswerAttempt" (
    "id" UUID NOT NULL,
    "presentationId" UUID NOT NULL,
    "selectedChoiceId" UUID NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnswerAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnswerAttempt_presentationId_key" ON "AnswerAttempt"("presentationId");
ALTER TABLE "AnswerAttempt" ADD CONSTRAINT "AnswerAttempt_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "QuestionPresentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
