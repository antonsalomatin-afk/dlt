ALTER TABLE "QuestionPresentation" ADD COLUMN "dailyDate" DATE;

CREATE UNIQUE INDEX "QuestionPresentation_userId_dailyDate_key"
  ON "QuestionPresentation"("userId", "dailyDate");
