import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationName = '20261003060000_daily_practice';
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = join(repositoryRoot, 'packages/database/prisma/migrations');
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `daily_practice_migration_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = new pg.Client({ connectionString: isolatedUrl.toString() });
const ids = {
  firstUser: randomUUID(),
  secondUser: randomUUID(),
  category: randomUUID(),
  question: randomUUID(),
  presentation: randomUUID(),
  answer: randomUUID(),
  favorite: randomUUID(),
  report: randomUUID(),
  choiceA: randomUUID(),
};

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
    `INSERT INTO "User" (id, "telegramUserId", "updatedAt")
     VALUES ($1, 710001, NOW()), ($2, 710002, NOW())`,
    [ids.firstUser, ids.secondUser],
  );
  await database.query(
    `INSERT INTO "Category" (id, slug, "nameThai", "nameEnglish", "nameRussian")
     VALUES ($1, 'daily-migration', 'รายวัน', 'Daily migration', 'Ежедневная миграция')`,
    [ids.category],
  );
  await database.query(
    `INSERT INTO "Question" (
      id, "vehicleType", "categoryId", "textEnglish", "sourceType", "verificationStatus", active, "updatedAt"
    ) VALUES ($1, 'CAR', $2, 'Legacy wording', 'ORIGINAL', 'VERIFIED', TRUE, NOW())`,
    [ids.question, ids.category],
  );
  const choiceIds = [ids.choiceA, randomUUID(), randomUUID(), randomUUID()];
  for (const [index, key] of (['A', 'B', 'C', 'D'] as const).entries()) {
    await database.query(
      `INSERT INTO "QuestionChoice" (id, "questionId", key, "textEnglish", "isCorrect")
       VALUES ($1, $2, $3, $4, $5)`,
      [choiceIds[index], ids.question, key, `Legacy choice ${key}`, key === 'A'],
    );
  }
  await database.query(
    `INSERT INTO "QuestionPresentation" (id, "userId", "questionId", snapshot)
     VALUES ($1, $2, $3, '{}'::jsonb)`,
    [ids.presentation, ids.firstUser, ids.question],
  );
  await database.query(
    `INSERT INTO "AnswerAttempt" (id, "presentationId", "selectedChoiceId", "isCorrect")
     VALUES ($1, $2, $3, TRUE)`,
    [ids.answer, ids.presentation, ids.choiceA],
  );
  await database.query(
    `INSERT INTO "Favorite" (id, "userId", "questionId", "presentationId", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [ids.favorite, ids.firstUser, ids.question, ids.presentation],
  );
  await database.query(
    `INSERT INTO "QuestionReport" (id, "userId", "questionId", "presentationId", details)
     VALUES ($1, $2, $3, $4, 'Legacy allegation')`,
    [ids.report, ids.firstUser, ids.question, ids.presentation],
  );
  await database.query(readFileSync(join(migrationsRoot, migrationName, 'migration.sql'), 'utf8'));
}, 120_000);

afterAll(async () => {
  await database.end();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('daily practice additive migration', () => {
  it('preserves legacy rows and relations while enforcing one non-null learner/day assignment', async () => {
    const columns = await database.query<{ data_type: string; is_nullable: string }>(`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'QuestionPresentation'
        AND column_name = 'dailyDate'
    `);
    expect(columns.rows).toEqual([{ data_type: 'date', is_nullable: 'YES' }]);
    const indexes = await database.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'QuestionPresentation'
        AND indexname = 'QuestionPresentation_userId_dailyDate_key'
    `);
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).toContain('UNIQUE INDEX');
    expect(indexes.rows[0]?.indexdef).toContain('("userId", "dailyDate")');

    const legacy = await database.query<{
      dailyDate: string | null;
      answerId: string;
      favoriteId: string;
      reportId: string;
    }>(`
      SELECT
        presentation."dailyDate"::text AS "dailyDate",
        answer.id AS "answerId",
        favorite.id AS "favoriteId",
        report.id AS "reportId"
      FROM "QuestionPresentation" AS presentation
      INNER JOIN "AnswerAttempt" AS answer ON answer."presentationId" = presentation.id
      INNER JOIN "Favorite" AS favorite ON favorite."presentationId" = presentation.id
      INNER JOIN "QuestionReport" AS report ON report."presentationId" = presentation.id
      WHERE presentation.id = $1
    `, [ids.presentation]);
    expect(legacy.rows).toEqual([{
      dailyDate: null,
      answerId: ids.answer,
      favoriteId: ids.favorite,
      reportId: ids.report,
    }]);

    const ordinaryIds = [randomUUID(), randomUUID()];
    for (const id of ordinaryIds) {
      await database.query(
        `INSERT INTO "QuestionPresentation" (id, "userId", "questionId", snapshot)
         VALUES ($1, $2, $3, '{}'::jsonb)`,
        [id, ids.firstUser, ids.question],
      );
    }
    expect((await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "QuestionPresentation"
       WHERE "userId" = $1 AND "dailyDate" IS NULL`,
      [ids.firstUser],
    )).rows).toEqual([{ count: '3' }]);

    await database.query(
      `UPDATE "QuestionPresentation" SET "dailyDate" = DATE '2026-10-03' WHERE id = $1`,
      [ids.presentation],
    );
    await expect(database.query(
      `UPDATE "QuestionPresentation" SET "dailyDate" = DATE '2026-10-03' WHERE id = $1`,
      [ordinaryIds[0]],
    )).rejects.toMatchObject({ code: '23505', constraint: 'QuestionPresentation_userId_dailyDate_key' });
    const otherDailyId = randomUUID();
    await database.query(
      `INSERT INTO "QuestionPresentation" (id, "userId", "questionId", "dailyDate", snapshot)
       VALUES ($1, $2, $3, DATE '2026-10-03', '{}'::jsonb)`,
      [otherDailyId, ids.secondUser, ids.question],
    );

    await expect(database.query(
      `DELETE FROM "QuestionPresentation" WHERE id = $1`, [ids.presentation],
    )).rejects.toMatchObject({ code: '23001' });
    expect((await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "QuestionPresentation" WHERE id = $1`, [ids.presentation],
    )).rows).toEqual([{ count: '1' }]);
    await database.query(`DELETE FROM "QuestionReport" WHERE id = $1`, [ids.report]);
    await database.query(`DELETE FROM "Favorite" WHERE id = $1`, [ids.favorite]);
    await database.query(`DELETE FROM "QuestionPresentation" WHERE id = $1`, [ids.presentation]);
    expect((await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "AnswerAttempt" WHERE id = $1`, [ids.answer],
    )).rows).toEqual([{ count: '0' }]);
  });
});
