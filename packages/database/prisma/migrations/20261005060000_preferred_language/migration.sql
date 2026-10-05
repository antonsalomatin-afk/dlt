CREATE TYPE "PreferredLanguage" AS ENUM ('ENGLISH', 'RUSSIAN', 'THAI');

ALTER TABLE "User"
  ADD COLUMN "preferredLanguage" "PreferredLanguage" NOT NULL DEFAULT 'ENGLISH';
