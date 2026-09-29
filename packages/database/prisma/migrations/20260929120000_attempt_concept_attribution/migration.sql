ALTER TABLE "QuestionPresentation" ADD COLUMN "conceptId" UUID;

ALTER TABLE "ExamQuestion" ADD COLUMN "conceptId" UUID;

UPDATE "QuestionPresentation" AS presentation
SET "conceptId" = question."conceptId"
FROM "Question" AS question
WHERE presentation."questionId" = question.id
  AND question."conceptId" IS NOT NULL;

UPDATE "ExamQuestion" AS exam_question
SET "conceptId" = question."conceptId"
FROM "Question" AS question
WHERE exam_question."questionId" = question.id
  AND question."conceptId" IS NOT NULL;

CREATE INDEX "QuestionPresentation_userId_conceptId_idx" ON "QuestionPresentation"("userId", "conceptId");

CREATE INDEX "ExamQuestion_conceptId_idx" ON "ExamQuestion"("conceptId");

ALTER TABLE "QuestionPresentation" ADD CONSTRAINT "QuestionPresentation_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
