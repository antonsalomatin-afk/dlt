CREATE TABLE "Favorite" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "presentationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Favorite_userId_questionId_key" ON "Favorite"("userId", "questionId");
CREATE INDEX "Favorite_userId_updatedAt_id_idx" ON "Favorite"("userId", "updatedAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "QuestionPresentation_id_userId_questionId_key" ON "QuestionPresentation"("id", "userId", "questionId");

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_presentationId_userId_questionId_fkey" FOREIGN KEY ("presentationId", "userId", "questionId") REFERENCES "QuestionPresentation"("id", "userId", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE;
