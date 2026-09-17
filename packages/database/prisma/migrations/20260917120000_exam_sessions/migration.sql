CREATE TABLE "ExamSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "questionCount" INTEGER NOT NULL DEFAULT 50,
    "passingScore" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "score" INTEGER,
    "passed" BOOLEAN,

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExamSession_questionCount_fixed50" CHECK ("questionCount" = 50),
    CONSTRAINT "ExamSession_passingScore_range" CHECK ("passingScore" BETWEEN 1 AND "questionCount"),
    CONSTRAINT "ExamSession_expiry_after_start" CHECK ("expiresAt" > "startedAt"),
    CONSTRAINT "ExamSession_completion_tuple" CHECK (
        ("completedAt" IS NULL AND "score" IS NULL AND "passed" IS NULL)
        OR
        ("completedAt" IS NOT NULL AND "score" IS NOT NULL AND "passed" IS NOT NULL)
    ),
    CONSTRAINT "ExamSession_completion_score_range" CHECK (
        "score" IS NULL OR "score" BETWEEN 0 AND "questionCount"
    ),
    CONSTRAINT "ExamSession_completion_pass_matches_score" CHECK (
        "passed" IS NULL OR "passed" = ("score" >= "passingScore")
    ),
    CONSTRAINT "ExamSession_completion_not_before_start" CHECK (
        "completedAt" IS NULL OR "completedAt" >= "startedAt"
    )
);

CREATE TABLE "ExamQuestion" (
    "id" UUID NOT NULL,
    "examSessionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "questionId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "selectedChoiceId" UUID,
    "isCorrect" BOOLEAN,
    "answeredAt" TIMESTAMPTZ(3),

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExamQuestion_position_range" CHECK ("position" BETWEEN 1 AND 50),
    CONSTRAINT "ExamQuestion_answer_tuple" CHECK (
        ("selectedChoiceId" IS NULL AND "isCorrect" IS NULL AND "answeredAt" IS NULL)
        OR
        ("selectedChoiceId" IS NOT NULL AND "isCorrect" IS NOT NULL AND "answeredAt" IS NOT NULL)
    )
);

CREATE INDEX "ExamSession_userId_startedAt_id_idx" ON "ExamSession"("userId", "startedAt" DESC, "id" DESC);

CREATE UNIQUE INDEX "ExamQuestion_examSessionId_position_key" ON "ExamQuestion"("examSessionId", "position");

CREATE UNIQUE INDEX "ExamQuestion_examSessionId_questionId_key" ON "ExamQuestion"("examSessionId", "questionId");

CREATE INDEX "ExamQuestion_questionId_idx" ON "ExamQuestion"("questionId");

ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
