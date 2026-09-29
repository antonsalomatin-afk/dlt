CREATE TABLE "ConceptLearningState" (
    "userId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "practiceAnswered" INTEGER NOT NULL DEFAULT 0,
    "practiceCorrect" INTEGER NOT NULL DEFAULT 0,
    "examAnswered" INTEGER NOT NULL DEFAULT 0,
    "examCorrect" INTEGER NOT NULL DEFAULT 0,
    "lastPracticeAt" TIMESTAMPTZ(3),
    "lastExamAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConceptLearningState_pkey" PRIMARY KEY ("userId", "conceptId"),
    CONSTRAINT "ConceptLearningState_practice_counts_valid" CHECK (
        "practiceAnswered" >= 0
        AND "practiceCorrect" >= 0
        AND "practiceCorrect" <= "practiceAnswered"
    ),
    CONSTRAINT "ConceptLearningState_exam_counts_valid" CHECK (
        "examAnswered" >= 0
        AND "examCorrect" >= 0
        AND "examCorrect" <= "examAnswered"
    ),
    CONSTRAINT "ConceptLearningState_practice_timestamp_pair" CHECK (
        ("practiceAnswered" = 0 AND "lastPracticeAt" IS NULL)
        OR ("practiceAnswered" > 0 AND "lastPracticeAt" IS NOT NULL)
    ),
    CONSTRAINT "ConceptLearningState_exam_timestamp_pair" CHECK (
        ("examAnswered" = 0 AND "lastExamAt" IS NULL)
        OR ("examAnswered" > 0 AND "lastExamAt" IS NOT NULL)
    )
);

WITH practice AS (
    SELECT
        presentation."userId",
        presentation."conceptId",
        COUNT(*)::INTEGER AS answered,
        COUNT(*) FILTER (WHERE attempt."isCorrect")::INTEGER AS correct,
        MAX(attempt."submittedAt") AS "lastAt"
    FROM "AnswerAttempt" AS attempt
    INNER JOIN "QuestionPresentation" AS presentation
        ON presentation.id = attempt."presentationId"
    WHERE presentation."conceptId" IS NOT NULL
    GROUP BY presentation."userId", presentation."conceptId"
),
exam AS (
    SELECT
        session."userId",
        question."conceptId",
        COUNT(*)::INTEGER AS answered,
        COUNT(*) FILTER (WHERE question."isCorrect")::INTEGER AS correct,
        MAX(question."answeredAt") AS "lastAt"
    FROM "ExamQuestion" AS question
    INNER JOIN "ExamSession" AS session
        ON session.id = question."examSessionId"
    WHERE question."conceptId" IS NOT NULL
      AND question."answeredAt" IS NOT NULL
    GROUP BY session."userId", question."conceptId"
)
INSERT INTO "ConceptLearningState" (
    "userId",
    "conceptId",
    "practiceAnswered",
    "practiceCorrect",
    "examAnswered",
    "examCorrect",
    "lastPracticeAt",
    "lastExamAt"
)
SELECT
    COALESCE(practice."userId", exam."userId"),
    COALESCE(practice."conceptId", exam."conceptId"),
    COALESCE(practice.answered, 0),
    COALESCE(practice.correct, 0),
    COALESCE(exam.answered, 0),
    COALESCE(exam.correct, 0),
    practice."lastAt",
    exam."lastAt"
FROM practice
FULL OUTER JOIN exam
    ON exam."userId" = practice."userId"
   AND exam."conceptId" = practice."conceptId";

CREATE INDEX "ConceptLearningState_conceptId_idx" ON "ConceptLearningState"("conceptId");

ALTER TABLE "ConceptLearningState" ADD CONSTRAINT "ConceptLearningState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConceptLearningState" ADD CONSTRAINT "ConceptLearningState_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
