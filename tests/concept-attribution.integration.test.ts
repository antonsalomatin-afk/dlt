import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for concept attribution integration tests');

const migrationName = '20260929120000_attempt_concept_attribution';
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationsRoot = join(repositoryRoot, 'packages/database/prisma/migrations');
const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const databaseName = `concept_attribution_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
let databaseCreated = false;

const fixture = {
  userId: randomUUID(),
  categoryId: randomUUID(),
  originalConceptId: randomUUID(),
  replacementConceptId: randomUUID(),
  groupedQuestionId: randomUUID(),
  ungroupedQuestionId: randomUUID(),
  groupedPresentationId: randomUUID(),
  ungroupedPresentationId: randomUUID(),
  examSessionId: randomUUID(),
  groupedExamQuestionId: randomUUID(),
  ungroupedExamQuestionId: randomUUID(),
};

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;

  const upgrade = new pg.Client({ connectionString: isolatedUrl.toString(), connectionTimeoutMillis: 5_000 });
  await upgrade.connect();
  try {
    const priorMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== migrationName)
      .map((entry) => entry.name)
      .sort();
    for (const migration of priorMigrations) {
      await upgrade.query(readFileSync(join(migrationsRoot, migration, 'migration.sql'), 'utf8'));
    }

    await upgrade.query(
      `INSERT INTO "User" (id, "telegramUserId", "updatedAt") VALUES ($1, $2, NOW())`,
      [fixture.userId, '40001'],
    );
    await upgrade.query(
      `INSERT INTO "Category" (id, slug, "nameThai", "nameEnglish", "nameRussian")
       VALUES ($1, $2, 'category', 'category', 'category')`,
      [fixture.categoryId, fixture.categoryId],
    );
    await upgrade.query(
      `INSERT INTO "Concept" (id, slug, "nameThai", "nameEnglish", "nameRussian")
       VALUES
         ($1, 'historical-original', 'original', 'original', 'original'),
         ($2, 'historical-replacement', 'replacement', 'replacement', 'replacement')`,
      [fixture.originalConceptId, fixture.replacementConceptId],
    );
    await upgrade.query(
      `INSERT INTO "Question" (
         id, "vehicleType", "categoryId", "conceptId", "textEnglish", "sourceType", "updatedAt"
       ) VALUES
         ($1, 'CAR', $3, $4, 'Grouped before migration', 'ORIGINAL', NOW()),
         ($2, 'CAR', $3, NULL, 'Ungrouped before migration', 'ORIGINAL', NOW())`,
      [fixture.groupedQuestionId, fixture.ungroupedQuestionId, fixture.categoryId, fixture.originalConceptId],
    );
    await upgrade.query(
      `INSERT INTO "QuestionPresentation" (id, "userId", "questionId", snapshot)
       VALUES ($1, $3, $4, '{}'::jsonb), ($2, $3, $5, '{}'::jsonb)`,
      [
        fixture.groupedPresentationId,
        fixture.ungroupedPresentationId,
        fixture.userId,
        fixture.groupedQuestionId,
        fixture.ungroupedQuestionId,
      ],
    );
    await upgrade.query(
      `INSERT INTO "ExamSession" (
         id, "userId", "vehicleType", "passingScore", "startedAt", "expiresAt"
       ) VALUES ($1, $2, 'CAR', 45, '2026-09-29T10:00:00Z', '2026-09-29T11:00:00Z')`,
      [fixture.examSessionId, fixture.userId],
    );
    await upgrade.query(
      `INSERT INTO "ExamQuestion" (id, "examSessionId", position, "questionId", snapshot)
       VALUES
         ($1, $3, 1, $4, '{}'::jsonb),
         ($2, $3, 2, $5, '{}'::jsonb)`,
      [
        fixture.groupedExamQuestionId,
        fixture.ungroupedExamQuestionId,
        fixture.examSessionId,
        fixture.groupedQuestionId,
        fixture.ungroupedQuestionId,
      ],
    );

    await upgrade.query(readFileSync(join(migrationsRoot, migrationName, 'migration.sql'), 'utf8'));
  } finally {
    await upgrade.end();
  }
}, 150_000);

afterAll(async () => {
  try {
    await database.$disconnect();
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});

describe('historical concept attribution migration', () => {
  it('backfills grouped rows, retains null, and exposes typed optional relations', async () => {
    const presentations = await database.questionPresentation.findMany({
      orderBy: { id: 'asc' },
      include: { concept: true },
    });
    const exams = await database.examQuestion.findMany({
      orderBy: { position: 'asc' },
      include: { concept: true },
    });

    const groupedPresentation = presentations.find(({ id }) => id === fixture.groupedPresentationId);
    const ungroupedPresentation = presentations.find(({ id }) => id === fixture.ungroupedPresentationId);
    expect(groupedPresentation).toMatchObject({
      conceptId: fixture.originalConceptId,
      concept: { id: fixture.originalConceptId },
    });
    expect(ungroupedPresentation).toMatchObject({ conceptId: null, concept: null });
    expect(exams[0]).toMatchObject({
      id: fixture.groupedExamQuestionId,
      conceptId: fixture.originalConceptId,
      concept: { id: fixture.originalConceptId },
    });
    expect(exams[1]).toMatchObject({ id: fixture.ungroupedExamQuestionId, conceptId: null, concept: null });
  });

  it('keeps attribution stable after source regrouping and restricts referenced concept deletion', async () => {
    await database.question.update({
      where: { id: fixture.groupedQuestionId },
      data: { conceptId: fixture.replacementConceptId },
    });
    await database.question.update({
      where: { id: fixture.ungroupedQuestionId },
      data: { conceptId: fixture.replacementConceptId },
    });

    expect((await database.questionPresentation.findUniqueOrThrow({
      where: { id: fixture.groupedPresentationId },
    })).conceptId).toBe(fixture.originalConceptId);
    expect((await database.questionPresentation.findUniqueOrThrow({
      where: { id: fixture.ungroupedPresentationId },
    })).conceptId).toBeNull();
    expect((await database.examQuestion.findUniqueOrThrow({
      where: { id: fixture.groupedExamQuestionId },
    })).conceptId).toBe(fixture.originalConceptId);
    expect((await database.examQuestion.findUniqueOrThrow({
      where: { id: fixture.ungroupedExamQuestionId },
    })).conceptId).toBeNull();

    await expect(database.concept.delete({
      where: { id: fixture.originalConceptId },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('creates nullable columns, restrictive foreign keys, and aggregation indexes', async () => {
    const columns = await database.$queryRaw<Array<{ table_name: string; is_nullable: string }>>`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'conceptId'
        AND table_name IN ('QuestionPresentation', 'ExamQuestion')
      ORDER BY table_name
    `;
    expect(columns).toEqual([
      { table_name: 'ExamQuestion', is_nullable: 'YES' },
      { table_name: 'QuestionPresentation', is_nullable: 'YES' },
    ]);

    const foreignKeys = await database.$queryRaw<Array<{ conname: string; confdeltype: string }>>`
      SELECT conname, confdeltype::text AS confdeltype
      FROM pg_constraint
      WHERE conname IN ('QuestionPresentation_conceptId_fkey', 'ExamQuestion_conceptId_fkey')
      ORDER BY conname
    `;
    expect(foreignKeys).toEqual([
      { conname: 'ExamQuestion_conceptId_fkey', confdeltype: 'r' },
      { conname: 'QuestionPresentation_conceptId_fkey', confdeltype: 'r' },
    ]);

    const indexes = await database.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('QuestionPresentation_userId_conceptId_idx', 'ExamQuestion_conceptId_idx')
      ORDER BY indexname
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      'ExamQuestion_conceptId_idx',
      'QuestionPresentation_userId_conceptId_idx',
    ]);
  });
});
