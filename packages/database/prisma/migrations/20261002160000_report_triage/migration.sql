CREATE TYPE "ReportTriageDecision" AS ENUM ('ACTION_REQUIRED', 'NO_ACTION_REQUIRED');

ALTER TABLE "QuestionReport"
  ADD COLUMN "triageDecision" "ReportTriageDecision",
  ADD COLUMN "triagedBy" TEXT,
  ADD COLUMN "triagedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "QuestionReport_triage_tuple_check" CHECK (
    ("triageDecision" IS NULL AND "triagedBy" IS NULL AND "triagedAt" IS NULL)
    OR
    ("triageDecision" IS NOT NULL AND "triagedBy" IS NOT NULL AND "triagedAt" IS NOT NULL)
  );

ALTER TABLE "ExamQuestionReport"
  ADD COLUMN "triageDecision" "ReportTriageDecision",
  ADD COLUMN "triagedBy" TEXT,
  ADD COLUMN "triagedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "ExamQuestionReport_triage_tuple_check" CHECK (
    ("triageDecision" IS NULL AND "triagedBy" IS NULL AND "triagedAt" IS NULL)
    OR
    ("triageDecision" IS NOT NULL AND "triagedBy" IS NOT NULL AND "triagedAt" IS NOT NULL)
  );

CREATE INDEX "QuestionReport_triageDecision_triagedAt_id_idx"
  ON "QuestionReport"("triageDecision", "triagedAt" DESC, "id" DESC);

CREATE INDEX "ExamQuestionReport_triageDecision_triagedAt_id_idx"
  ON "ExamQuestionReport"("triageDecision", "triagedAt" DESC, "id" DESC);
