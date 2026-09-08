-- CreateEnum
CREATE TYPE "ChoiceKey" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('FIXTURE', 'ORIGINAL', 'OFFICIAL', 'THIRD_PARTY');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameThai" TEXT NOT NULL,
    "nameEnglish" TEXT NOT NULL,
    "nameRussian" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nameThai" TEXT NOT NULL,
    "nameEnglish" TEXT NOT NULL,
    "nameRussian" TEXT NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "categoryId" UUID NOT NULL,
    "conceptId" UUID,
    "textThai" TEXT,
    "textExamEnglish" TEXT,
    "textEnglish" TEXT NOT NULL,
    "textRussian" TEXT,
    "explanationThai" TEXT,
    "explanationEnglish" TEXT,
    "explanationRussian" TEXT,
    "trapExplanationThai" TEXT,
    "trapExplanationEnglish" TEXT,
    "trapExplanationRussian" TEXT,
    "imageReference" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "sourceReference" TEXT,
    "sourceDate" DATE,
    "legalCitation" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewer" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionChoice" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "key" "ChoiceKey" NOT NULL,
    "textThai" TEXT,
    "textEnglish" TEXT NOT NULL,
    "textRussian" TEXT,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuestionChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Concept_slug_key" ON "Concept"("slug");

-- CreateIndex
CREATE INDEX "Question_vehicleType_categoryId_active_verificationStatus_idx" ON "Question"("vehicleType", "categoryId", "active", "verificationStatus");

-- CreateIndex
CREATE INDEX "Question_conceptId_idx" ON "Question"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionChoice_questionId_key_key" ON "QuestionChoice"("questionId", "key");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionChoice" ADD CONSTRAINT "QuestionChoice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
