import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for concept learning state integration tests');

const migrationName = '20260929160000_concept_learning_state';
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationsRoot = join(repositoryRoot, 'packages/database/prisma/migrations');
const admin = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
const upgradeDatabaseName = `concept_learning_upgrade_${randomBytes(8).toString('hex')}`;
const freshDatabaseName = `concept_learning_fresh_${randomBytes(8).toString('hex')}`;
const upgradeUrl = new URL(databaseUrl);
upgradeUrl.pathname = `/${upgradeDatabaseName}`;
const freshUrl = new URL(databaseUrl);
freshUrl.pathname = `/${freshDatabaseName}`;
const database = createDatabaseClient(upgradeUrl.toString());
const direct = new pg.Client({ connectionString: upgradeUrl.toString(), connectionTimeoutMillis: 5_000 });
let databasesCreated = false;

const fixture = {
  userOne: randomUUID(),
  userTwo: randomUUID(),
  category: randomUUID(),
  conceptOne: randomUUID(),
  conceptTwo: randomUUID(),
  questions: Array.from({ length: 6 }, () => randomUUID()),
  presentations: Array.from({ length: 6 }, () => randomUUID()),
  examOne: randomUUID(),
  examTwo: randomUUID(),
  examQuestions: Array.from({ length: 6 }, () => randomUUID()),
};

function migrate(databaseConnection: string) {
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    {
      env: { ...process.env, DATABASE_URL: databaseConnection },
      stdio: 'pipe',
      timeout: 120_000,
      windowsHide: true,
    },
  );
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${upgradeDatabaseName}"`);
  await admin.query(`CREATE DATABASE "${freshDatabaseName}"`);
  databasesCreated = true;

  await direct.connect();
  const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const priorMigrations = migrationDirectories.filter((name) => name < migrationName);
  for (const migration of priorMigrations) {
    await direct.query(readFileSync(join(migrationsRoot, migration, 'migration.sql'), 'utf8'));
  }

  await direct.query(
    `INSERT INTO "User" (id, "telegramUserId", "updatedAt") VALUES
      ($1, 51001, NOW()), ($2, 51002, NOW())`,
    [fixture.userOne, fixture.userTwo],
  );
  await direct.query(
    `INSERT INTO "Category" (id, slug, "nameThai", "nameEnglish", "nameRussian")
     VALUES ($1, 'learning-state', 'category', 'category', 'category')`,
    [fixture.category],
  );
  await direct.query(
    `INSERT INTO "Concept" (id, slug, "nameThai", "nameEnglish", "nameRussian") VALUES
      ($1, 'learning-one', 'one', 'one', 'one'),
      ($2, 'learning-two', 'two', 'two', 'two')`,
    [fixture.conceptOne, fixture.conceptTwo],
  );
  for (const [index, questionId] of fixture.questions.entries()) {
    await direct.query(
      `INSERT INTO "Question" (
         id, "vehicleType", "categoryId", "conceptId", "textEnglish", "sourceType", "updatedAt"
       ) VALUES ($1, 'CAR', $2, $3, $4, 'ORIGINAL', NOW())`,
      [questionId, fixture.category, fixture.conceptTwo, `Question ${index + 1}`],
    );
  }

  const presentationRows = [
    [fixture.presentations[0], fixture.userOne, fixture.questions[0], fixture.conceptOne],
    [fixture.presentations[1], fixture.userOne, fixture.questions[1], fixture.conceptOne],
    [fixture.presentations[2], fixture.userOne, fixture.questions[2], fixture.conceptOne],
    [fixture.presentations[3], fixture.userOne, fixture.questions[3], fixture.conceptTwo],
    [fixture.presentations[4], fixture.userTwo, fixture.questions[4], fixture.conceptOne],
    [fixture.presentations[5], fixture.userOne, fixture.questions[5], null],
  ] as const;
  for (const [presentationId, userId, questionId, conceptId] of presentationRows) {
    await direct.query(
      `INSERT INTO "QuestionPresentation" (id, "userId", "questionId", "conceptId", snapshot)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
      [presentationId, userId, questionId, conceptId],
    );
  }
  const practiceRows = [
    [fixture.presentations[0], true, '2026-09-29T10:01:00.000Z'],
    [fixture.presentations[1], false, '2026-09-29T10:03:00.000Z'],
    [fixture.presentations[2], true, '2026-09-29T10:02:00.000Z'],
    [fixture.presentations[3], false, '2026-09-29T10:04:00.000Z'],
    [fixture.presentations[4], true, '2026-09-29T10:05:00.000Z'],
    [fixture.presentations[5], true, '2026-09-29T10:06:00.000Z'],
  ] as const;
  for (const [presentationId, isCorrect, submittedAt] of practiceRows) {
    await direct.query(
      `INSERT INTO "AnswerAttempt" (id, "presentationId", "selectedChoiceId", "isCorrect", "submittedAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), presentationId, randomUUID(), isCorrect, submittedAt],
    );
  }

  await direct.query(
    `INSERT INTO "ExamSession" (id, "userId", "vehicleType", "passingScore", "startedAt", "expiresAt") VALUES
      ($1, $2, 'CAR', 45, '2026-09-29T09:00:00Z', '2026-09-29T11:00:00Z'),
      ($3, $4, 'CAR', 45, '2026-09-29T09:00:00Z', '2026-09-29T11:00:00Z')`,
    [fixture.examOne, fixture.userOne, fixture.examTwo, fixture.userTwo],
  );
  const examRows = [
    [fixture.examQuestions[0], fixture.examOne, 1, fixture.questions[0], fixture.conceptOne, true, '2026-09-29T10:12:00.000Z'],
    [fixture.examQuestions[1], fixture.examOne, 2, fixture.questions[1], fixture.conceptOne, false, '2026-09-29T10:13:00.000Z'],
    [fixture.examQuestions[2], fixture.examOne, 3, fixture.questions[2], fixture.conceptOne, null, null],
    [fixture.examQuestions[3], fixture.examOne, 4, fixture.questions[3], fixture.conceptTwo, true, '2026-09-29T10:14:00.000Z'],
    [fixture.examQuestions[4], fixture.examOne, 5, fixture.questions[4], null, true, '2026-09-29T10:16:00.000Z'],
    [fixture.examQuestions[5], fixture.examTwo, 1, fixture.questions[0], fixture.conceptOne, false, '2026-09-29T10:15:00.000Z'],
  ] as const;
  for (const [id, examSessionId, position, questionId, conceptId, isCorrect, answeredAt] of examRows) {
    await direct.query(
      `INSERT INTO "ExamQuestion" (
         id, "examSessionId", position, "questionId", "conceptId", snapshot,
         "selectedChoiceId", "isCorrect", "answeredAt"
       ) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, $8)`,
      [id, examSessionId, position, questionId, conceptId, answeredAt === null ? null : randomUUID(), isCorrect, answeredAt],
    );
  }

  await direct.query(readFileSync(join(migrationsRoot, migrationName, 'migration.sql'), 'utf8'));
  // The generated Prisma client models the current complete schema. Apply later additive
  // migrations after the targeted legacy backfill so typed follow-up checks remain valid.
  for (const migration of migrationDirectories.filter((name) => name > migrationName)) {
    await direct.query(readFileSync(join(migrationsRoot, migration, 'migration.sql'), 'utf8'));
  }
  migrate(freshUrl.toString());
  migrate(freshUrl.toString());
}, 150_000);

afterAll(async () => {
  try {
    await database.$disconnect();
    await direct.end();
    if (databasesCreated) {
      await admin.query(`DROP DATABASE "${upgradeDatabaseName}"`);
      await admin.query(`DROP DATABASE "${freshDatabaseName}"`);
    }
  } finally {
    await admin.end();
  }
});

describe('ConceptLearningState migration', () => {
  it('backfills exact separate facts from persisted attribution and merges both channels', async () => {
    const rows = await database.conceptLearningState.findMany({
      orderBy: [{ userId: 'asc' }, { conceptId: 'asc' }],
    });
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: fixture.userOne,
        conceptId: fixture.conceptOne,
        practiceAnswered: 3,
        practiceCorrect: 2,
        examAnswered: 2,
        examCorrect: 1,
        lastPracticeAt: new Date('2026-09-29T10:03:00.000Z'),
        lastExamAt: new Date('2026-09-29T10:13:00.000Z'),
      }),
      expect.objectContaining({
        userId: fixture.userOne,
        conceptId: fixture.conceptTwo,
        practiceAnswered: 1,
        practiceCorrect: 0,
        examAnswered: 1,
        examCorrect: 1,
        lastPracticeAt: new Date('2026-09-29T10:04:00.000Z'),
        lastExamAt: new Date('2026-09-29T10:14:00.000Z'),
      }),
      expect.objectContaining({
        userId: fixture.userTwo,
        conceptId: fixture.conceptOne,
        practiceAnswered: 1,
        practiceCorrect: 1,
        examAnswered: 1,
        examCorrect: 0,
        lastPracticeAt: new Date('2026-09-29T10:05:00.000Z'),
        lastExamAt: new Date('2026-09-29T10:15:00.000Z'),
      }),
    ]));
  });

  it('installs named arithmetic, timestamp, ownership and administration constraints', async () => {
    const checks = await database.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conname LIKE 'ConceptLearningState_%'
        AND contype = 'c'
      ORDER BY conname
    `;
    expect(checks.map(({ conname }) => conname)).toEqual([
      'ConceptLearningState_exam_counts_valid',
      'ConceptLearningState_exam_timestamp_pair',
      'ConceptLearningState_practice_counts_valid',
      'ConceptLearningState_practice_timestamp_pair',
    ]);
    const foreignKeys = await database.$queryRaw<Array<{ conname: string; confdeltype: string }>>`
      SELECT conname, confdeltype::text AS confdeltype
      FROM pg_constraint
      WHERE conname IN ('ConceptLearningState_userId_fkey', 'ConceptLearningState_conceptId_fkey')
      ORDER BY conname
    `;
    expect(foreignKeys).toEqual([
      { conname: 'ConceptLearningState_conceptId_fkey', confdeltype: 'r' },
      { conname: 'ConceptLearningState_userId_fkey', confdeltype: 'c' },
    ]);
    const indexes = await database.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('ConceptLearningState_pkey', 'ConceptLearningState_conceptId_idx')
      ORDER BY indexname
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      'ConceptLearningState_conceptId_idx',
      'ConceptLearningState_pkey',
    ]);
  });

  it('enforces count arithmetic and timestamp pairing', async () => {
    const isolatedUser = await database.user.create({ data: { telegramUserId: 51999n } });
    const isolatedConcept = await database.concept.create({ data: {
      slug: 'constraint-concept',
      nameThai: 'constraint',
      nameEnglish: 'constraint',
      nameRussian: 'constraint',
    } });
    await expect(direct.query(
      `INSERT INTO "ConceptLearningState" ("userId", "conceptId", "practiceAnswered", "practiceCorrect")
       VALUES ($1, $2, -1, 0)`,
      [isolatedUser.id, isolatedConcept.id],
    )).rejects.toMatchObject({ constraint: 'ConceptLearningState_practice_counts_valid' });
    await expect(direct.query(
      `INSERT INTO "ConceptLearningState" ("userId", "conceptId", "examAnswered", "examCorrect", "lastExamAt")
       VALUES ($1, $2, 1, 2, NOW())`,
      [isolatedUser.id, isolatedConcept.id],
    )).rejects.toMatchObject({ constraint: 'ConceptLearningState_exam_counts_valid' });
    await expect(direct.query(
      `INSERT INTO "ConceptLearningState" ("userId", "conceptId", "practiceAnswered", "practiceCorrect")
       VALUES ($1, $2, 1, 0)`,
      [isolatedUser.id, isolatedConcept.id],
    )).rejects.toMatchObject({ constraint: 'ConceptLearningState_practice_timestamp_pair' });
    await expect(direct.query(
      `INSERT INTO "ConceptLearningState" ("userId", "conceptId", "lastExamAt")
       VALUES ($1, $2, NOW())`,
      [isolatedUser.id, isolatedConcept.id],
    )).rejects.toMatchObject({ constraint: 'ConceptLearningState_exam_timestamp_pair' });
    await database.user.delete({ where: { id: isolatedUser.id } });
    await database.concept.delete({ where: { id: isolatedConcept.id } });
  });

  it('cascades learner deletion and restricts referenced concept deletion', async () => {
    const user = await database.user.create({ data: { telegramUserId: 52000n } });
    const concept = await database.concept.create({ data: {
      slug: 'deletion-concept',
      nameThai: 'deletion',
      nameEnglish: 'deletion',
      nameRussian: 'deletion',
    } });
    await database.conceptLearningState.create({ data: {
      userId: user.id,
      conceptId: concept.id,
      practiceAnswered: 1,
      practiceCorrect: 1,
      lastPracticeAt: new Date('2026-09-29T11:00:00.000Z'),
    } });
    await expect(database.concept.delete({ where: { id: concept.id } })).rejects.toMatchObject({ code: 'P2003' });
    await database.user.delete({ where: { id: user.id } });
    expect(await database.conceptLearningState.count({ where: { conceptId: concept.id } })).toBe(0);
    await database.concept.delete({ where: { id: concept.id } });
  });

  it('deploys the complete fresh migration chain repeat-safely', async () => {
    const fresh = new pg.Client({ connectionString: freshUrl.toString(), connectionTimeoutMillis: 5_000 });
    await fresh.connect();
    try {
      const migration = await fresh.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
        [migrationName],
      );
      expect(migration.rows).toEqual([{ count: '1' }]);
      const table = await fresh.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ConceptLearningState'`,
      );
      expect(table.rows).toEqual([{ table_name: 'ConceptLearningState' }]);
    } finally {
      await fresh.end();
    }
  });
});
