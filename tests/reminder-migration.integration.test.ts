import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationName = '20261004060000_daily_question_reminder';
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = join(repositoryRoot, 'packages/database/prisma/migrations');
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `reminder_migration_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = new pg.Client({ connectionString: isolatedUrl.toString() });
const ids = {
  user: randomUUID(),
  newUser: randomUUID(),
  session: randomUUID(),
  category: randomUUID(),
  concept: randomUUID(),
  question: randomUUID(),
  choice: randomUUID(),
  presentation: randomUUID(),
  answer: randomUUID(),
  favorite: randomUUID(),
  report: randomUUID(),
  exam: randomUUID(),
  examQuestion: randomUUID(),
  examReport: randomUUID(),
};
let legacyStateBefore: unknown;

async function legacyState() {
  return (await database.query(`
    SELECT
      learner."telegramUserId"::text AS "telegramUserId",
      learner.username,
      learner."firstName",
      learner."selectedVehicleType"::text AS "selectedVehicleType",
      learner."updatedAt",
      learner."lastSeenAt",
      session.id AS "sessionId",
      session."tokenHash",
      session."createdAt" AS "sessionCreatedAt",
      session."expiresAt",
      presentation.id AS "presentationId",
      presentation."questionId",
      presentation."conceptId",
      presentation."dailyDate"::text AS "dailyDate",
      presentation.snapshot,
      answer.id AS "answerId",
      answer."selectedChoiceId",
      answer."isCorrect",
      answer."submittedAt",
      favorite.id AS "favoriteId",
      favorite."questionId" AS "favoriteQuestionId",
      report.id AS "reportId",
      report.details AS "reportDetails",
      state."practiceAnswered",
      state."practiceCorrect",
      state."examAnswered",
      state."examCorrect",
      state."lastPracticeAt",
      state."lastExamAt",
      exam.id AS "examId",
      exam."vehicleType"::text AS "examVehicleType",
      exam."questionCount",
      exam."passingScore",
      exam."startedAt",
      exam."expiresAt" AS "examExpiresAt",
      exam_question.id AS "examQuestionId",
      exam_question.position AS "examPosition",
      exam_question.snapshot AS "examSnapshot",
      exam_report.id AS "examReportId",
      exam_report.details AS "examReportDetails"
    FROM "User" learner
    INNER JOIN "Session" session ON session."userId" = learner.id
    INNER JOIN "QuestionPresentation" presentation ON presentation."userId" = learner.id
    INNER JOIN "AnswerAttempt" answer ON answer."presentationId" = presentation.id
    INNER JOIN "Favorite" favorite ON favorite."userId" = learner.id
    INNER JOIN "QuestionReport" report ON report."userId" = learner.id
    INNER JOIN "ConceptLearningState" state ON state."userId" = learner.id
    INNER JOIN "ExamSession" exam ON exam."userId" = learner.id
    INNER JOIN "ExamQuestion" exam_question ON exam_question."examSessionId" = exam.id
    INNER JOIN "ExamQuestionReport" exam_report ON exam_report."userId" = learner.id
    WHERE learner.id = $1
  `, [ids.user])).rows;
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await database.connect();
  const priorMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < migrationName)
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const migration of priorMigrations) {
    await database.query(readFileSync(join(migrationsRoot, migration.name, 'migration.sql'), 'utf8'));
  }
  await database.query(
    `INSERT INTO "User" (id, "telegramUserId", username, "firstName", "selectedVehicleType", "updatedAt", "lastSeenAt")
     VALUES ($1, 761001, 'legacy', 'Legacy learner', 'CAR', TIMESTAMPTZ '2026-10-03 09:00:00Z', TIMESTAMPTZ '2026-10-03 08:00:00Z')`,
    [ids.user],
  );
  await database.query(
    `INSERT INTO "Session" (id, "userId", "tokenHash", "createdAt", "expiresAt")
     VALUES ($1, $2, $3, TIMESTAMPTZ '2026-10-03 08:00:00Z', TIMESTAMPTZ '2026-10-04 08:00:00Z')`,
    [ids.session, ids.user, 'a'.repeat(64)],
  );
  await database.query(
    `INSERT INTO "Category" (id, slug, "nameThai", "nameEnglish", "nameRussian")
     VALUES ($1, 'reminder-migration', 'เตือน', 'Reminder', 'Напоминание')`,
    [ids.category],
  );
  await database.query(
    `INSERT INTO "Concept" (id, slug, "nameThai", "nameEnglish", "nameRussian")
     VALUES ($1, 'reminder-concept', 'แนวคิด', 'Concept', 'Понятие')`,
    [ids.concept],
  );
  await database.query(
    `INSERT INTO "Question" (
       id, "vehicleType", "categoryId", "conceptId", "textEnglish", "sourceType",
       "verificationStatus", active, "updatedAt"
     ) VALUES ($1, 'CAR', $2, $3, 'Legacy question', 'ORIGINAL', 'VERIFIED', TRUE, NOW())`,
    [ids.question, ids.category, ids.concept],
  );
  await database.query(
    `INSERT INTO "QuestionChoice" (id, "questionId", key, "textEnglish", "isCorrect")
     VALUES ($1, $2, 'A', 'Legacy answer', TRUE)`,
    [ids.choice, ids.question],
  );
  await database.query(
    `INSERT INTO "QuestionPresentation" (id, "userId", "questionId", "conceptId", "dailyDate", snapshot)
     VALUES ($1, $2, $3, $4, DATE '2026-10-03', '{}'::jsonb)`,
    [ids.presentation, ids.user, ids.question, ids.concept],
  );
  await database.query(
    `INSERT INTO "AnswerAttempt" (id, "presentationId", "selectedChoiceId", "isCorrect")
     VALUES ($1, $2, $3, TRUE)`,
    [ids.answer, ids.presentation, ids.choice],
  );
  await database.query(
    `INSERT INTO "Favorite" (id, "userId", "questionId", "presentationId", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [ids.favorite, ids.user, ids.question, ids.presentation],
  );
  await database.query(
    `INSERT INTO "QuestionReport" (id, "userId", "questionId", "presentationId", details)
     VALUES ($1, $2, $3, $4, 'Legacy practice report')`,
    [ids.report, ids.user, ids.question, ids.presentation],
  );
  await database.query(
    `INSERT INTO "ConceptLearningState" (
       "userId", "conceptId", "practiceAnswered", "practiceCorrect", "lastPracticeAt"
     ) VALUES ($1, $2, 1, 1, TIMESTAMPTZ '2026-10-03 08:30:00Z')`,
    [ids.user, ids.concept],
  );
  await database.query(
    `INSERT INTO "ExamSession" (
       id, "userId", "vehicleType", "questionCount", "passingScore", "startedAt", "expiresAt"
     ) VALUES ($1, $2, 'CAR', 50, 45, TIMESTAMPTZ '2026-10-03 07:00:00Z', TIMESTAMPTZ '2026-10-03 08:00:00Z')`,
    [ids.exam, ids.user],
  );
  await database.query(
    `INSERT INTO "ExamQuestion" (
       id, "examSessionId", position, "questionId", "conceptId", snapshot
     ) VALUES ($1, $2, 1, $3, $4, '{}'::jsonb)`,
    [ids.examQuestion, ids.exam, ids.question, ids.concept],
  );
  await database.query(
    `INSERT INTO "ExamQuestionReport" (
       id, "userId", "questionId", "examSessionId", "examQuestionId", details
     ) VALUES ($1, $2, $3, $4, $5, 'Legacy exam report')`,
    [ids.examReport, ids.user, ids.question, ids.exam, ids.examQuestion],
  );
  legacyStateBefore = await legacyState();
  await database.query(readFileSync(join(migrationsRoot, migrationName, 'migration.sql'), 'utf8'));
}, 120_000);

afterAll(async () => {
  await database.end();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('daily-question reminder additive migration', () => {
  it('adds one non-null default-off boolean for legacy and new users', async () => {
    const columns = await database.query<{ column_default: string; is_nullable: string; data_type: string }>(`
      SELECT column_default, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'dailyQuestionReminderEnabled'
    `);
    expect(columns.rows).toEqual([{ column_default: 'false', is_nullable: 'NO', data_type: 'boolean' }]);
    expect((await database.query(
      `SELECT "dailyQuestionReminderEnabled" FROM "User" WHERE id = $1`, [ids.user],
    )).rows).toEqual([{ dailyQuestionReminderEnabled: false }]);

    await database.query(
      `INSERT INTO "User" (id, "telegramUserId", "updatedAt") VALUES ($1, 761002, NOW())`,
      [ids.newUser],
    );
    expect((await database.query(
      `SELECT "dailyQuestionReminderEnabled" FROM "User" WHERE id = $1`, [ids.newUser],
    )).rows).toEqual([{ dailyQuestionReminderEnabled: false }]);
    await expect(database.query(
      `UPDATE "User" SET "dailyQuestionReminderEnabled" = NULL WHERE id = $1`, [ids.newUser],
    )).rejects.toMatchObject({ code: '23502' });
  });

  it('preserves identity and every established owned relation while the preference changes', async () => {
    expect(await legacyState()).toEqual(legacyStateBefore);
    await database.query(
      `UPDATE "User" SET "dailyQuestionReminderEnabled" = TRUE WHERE id = $1`, [ids.user],
    );
    expect(await legacyState()).toEqual(legacyStateBefore);
    await database.query(
      `UPDATE "User" SET "dailyQuestionReminderEnabled" = FALSE WHERE id = $1`, [ids.user],
    );
    expect(await legacyState()).toEqual(legacyStateBefore);
  });
});
