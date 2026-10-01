import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import {
  candidateChoiceId,
  candidateQuestionId,
  importCandidateBatch,
} from '../tools/content/candidate-import.ts';
import { inspectCandidateBatch } from '../tools/content/candidate-status.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';
import { importFixtures, validateFixtures } from '../tools/content/fixtures.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
const databaseName = `candidate_status_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/status-candidates.ts', import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'thaidlt-status-integration-'));
let created = false;

const fixtureInput: unknown = JSON.parse(readFileSync(new URL('../content/fixtures/development.json', import.meta.url), 'utf8'));
const fixtures = validateFixtures(fixtureInput);
const exampleInput: unknown = JSON.parse(readFileSync(new URL('../content/imports/example-candidate-batch.json', import.meta.url), 'utf8'));
const example = parseCandidateBatch(exampleInput);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migration = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy',
  ], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    windowsHide: true,
    timeout: 120_000,
    stdio: 'ignore',
  });
  if (migration.status !== 0 || migration.error) throw new Error('Isolated candidate status migration failed.');
}, 150_000);

afterAll(async () => {
  try {
    await database.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function candidateQuestion(externalId: string) {
  const base = example.questions[0];
  if (!base) throw new Error('Missing example candidate.');
  return {
    ...base,
    externalId,
    categorySlug: 'status-safe-driving',
    conceptSlug: 'status-space-management',
    textEnglish: `Synthetic status wording for ${externalId}.`,
  };
}

function batch(questions: ReturnType<typeof candidateQuestion>[]) {
  return parseCandidateBatch({
    batchId: 'candidate-status-batch',
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    questions,
  });
}

function runCli(path: string) {
  return spawnSync(process.execPath, [cliPath, '--', path], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
  });
}

it('reports every candidate lifecycle and drift class deterministically without database writes', async () => {
  await importFixtures(database, fixtures);
  const category = await database.category.create({ data: {
    slug: 'status-safe-driving', nameThai: 'หมวดสถานะสังเคราะห์',
    nameEnglish: 'Synthetic status category', nameRussian: 'Синтетическая категория статуса',
  } });
  const alternateCategory = await database.category.create({ data: {
    slug: 'status-alternate-category', nameThai: 'หมวดสถานะสำรอง',
    nameEnglish: 'Alternate status category', nameRussian: 'Другая категория статуса',
  } });
  const concept = await database.concept.create({ data: {
    slug: 'status-space-management', nameThai: 'แนวคิดสถานะสังเคราะห์',
    nameEnglish: 'Synthetic status concept', nameRussian: 'Синтетическая концепция статуса',
  } });
  const alternateConcept = await database.concept.create({ data: {
    slug: 'status-alternate-concept', nameThai: 'แนวคิดสถานะสำรอง',
    nameEnglish: 'Alternate status concept', nameRussian: 'Другая концепция статуса',
  } });
  const unrelated = await database.question.create({ data: {
    categoryId: category.id,
    conceptId: concept.id,
    vehicleType: 'CAR',
    textEnglish: 'Unrelated row must remain unchanged by status inspection.',
    sourceType: 'ORIGINAL',
  } });

  const externalIds = [
    'status-draft-inactive',
    'status-verified-inactive',
    'status-verified-active',
    'status-rejected-inactive',
    'status-invalid-draft-metadata',
    'status-invalid-final-metadata',
    'status-invalid-rejected-active',
    'status-invalid-draft-active',
    'status-drifted-content',
    'status-drifted-choice',
    'status-drifted-taxonomy',
    'status-drifted-choice-identity',
    'status-taxonomy-absent',
    'status-missing-taxonomy-absent',
  ];
  const allQuestions = externalIds.map(candidateQuestion);
  const persistedBatch = batch(allQuestions.slice(0, -1));
  await importCandidateBatch(database, persistedBatch);
  const statusBatch = batch(allQuestions.map((question) => (
    ['status-taxonomy-absent', 'status-missing-taxonomy-absent'].includes(question.externalId)
      ? { ...question, categorySlug: 'status-category-does-not-exist' }
      : question
  )));
  const id = (externalId: string) => candidateQuestionId(1, statusBatch.batchId, externalId);
  const reviewedAt = new Date('2026-10-01T01:00:00.000Z');

  await database.question.update({ where: { id: id('status-verified-inactive') }, data: {
    verificationStatus: 'VERIFIED', reviewer: 'Private Verified Reviewer', reviewedAt,
  } });
  await database.question.update({ where: { id: id('status-verified-active') }, data: {
    verificationStatus: 'VERIFIED', reviewer: 'Private Active Reviewer', reviewedAt, active: true,
  } });
  await database.question.update({ where: { id: id('status-rejected-inactive') }, data: {
    verificationStatus: 'REJECTED', reviewer: 'Private Rejection Reviewer', reviewedAt,
  } });
  await database.question.update({ where: { id: id('status-invalid-draft-metadata') }, data: {
    reviewer: 'Private Unexpected Draft Reviewer', reviewedAt,
  } });
  await database.question.update({ where: { id: id('status-invalid-final-metadata') }, data: {
    verificationStatus: 'VERIFIED', reviewer: null, reviewedAt,
  } });
  await database.question.update({ where: { id: id('status-invalid-rejected-active') }, data: {
    verificationStatus: 'REJECTED', reviewer: 'Private Active Rejection Reviewer', reviewedAt, active: true,
  } });
  await database.question.update({ where: { id: id('status-invalid-draft-active') }, data: { active: true } });
  await database.question.update({ where: { id: id('status-drifted-content') }, data: {
    textEnglish: 'Private drifted question wording must not appear.',
  } });
  await database.questionChoice.update({
    where: { id: candidateChoiceId(id('status-drifted-choice'), 'A') },
    data: { textEnglish: 'Private drifted choice wording must not appear.' },
  });
  await database.question.update({ where: { id: id('status-drifted-taxonomy') }, data: {
    categoryId: alternateCategory.id, conceptId: alternateConcept.id,
  } });
  await database.questionChoice.update({
    where: { id: candidateChoiceId(id('status-drifted-choice-identity'), 'A') },
    data: { id: randomUUID() },
  });

  const countsBefore = {
    questions: await database.question.count(),
    choices: await database.questionChoice.count(),
    fixtures: await database.question.count({ where: { sourceType: 'FIXTURE' } }),
  };
  const timestampsBefore = new Map((await database.question.findMany({
    where: { id: { in: persistedBatch.questions.map(({ externalId }) => id(externalId)) } },
    select: { id: true, updatedAt: true },
  })).map(({ id: questionId, updatedAt }) => [questionId, updatedAt.getTime()]));

  const expected = {
    version: 1 as const,
    batchId: statusBatch.batchId,
    summary: {
      total: 14,
      missing: 1,
      drifted: 5,
      exact: 8,
      draftInactive: 1,
      verifiedInactive: 1,
      verifiedActive: 1,
      rejectedInactive: 1,
      invalidLifecycle: 4,
    },
    questions: [
      { externalId: 'status-draft-inactive', state: 'EXACT', verificationStatus: 'DRAFT', active: false, reviewerAssigned: false, reviewedAtPresent: false },
      { externalId: 'status-verified-inactive', state: 'EXACT', verificationStatus: 'VERIFIED', active: false, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'status-verified-active', state: 'EXACT', verificationStatus: 'VERIFIED', active: true, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'status-rejected-inactive', state: 'EXACT', verificationStatus: 'REJECTED', active: false, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'status-invalid-draft-metadata', state: 'EXACT', verificationStatus: 'DRAFT', active: false, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'status-invalid-final-metadata', state: 'EXACT', verificationStatus: 'VERIFIED', active: false, reviewerAssigned: false, reviewedAtPresent: true },
      { externalId: 'status-invalid-rejected-active', state: 'EXACT', verificationStatus: 'REJECTED', active: true, reviewerAssigned: true, reviewedAtPresent: true },
      { externalId: 'status-invalid-draft-active', state: 'EXACT', verificationStatus: 'DRAFT', active: true, reviewerAssigned: false, reviewedAtPresent: false },
      { externalId: 'status-drifted-content', state: 'DRIFTED' },
      { externalId: 'status-drifted-choice', state: 'DRIFTED' },
      { externalId: 'status-drifted-taxonomy', state: 'DRIFTED' },
      { externalId: 'status-drifted-choice-identity', state: 'DRIFTED' },
      { externalId: 'status-taxonomy-absent', state: 'DRIFTED' },
      { externalId: 'status-missing-taxonomy-absent', state: 'MISSING' },
    ],
  };

  expect(await inspectCandidateBatch(database, statusBatch)).toEqual(expected);
  expect(await inspectCandidateBatch(database, statusBatch)).toEqual(expected);

  const batchPath = join(temporaryDirectory, 'candidate-status-batch.json');
  writeFileSync(batchPath, JSON.stringify(statusBatch));
  const cliResult = runCli(batchPath);
  expect(cliResult.status).toBe(0);
  expect(cliResult.stderr).toBe('');
  expect(cliResult.stdout).toBe(`${JSON.stringify(expected)}\n`);
  expect(cliResult.stdout).not.toContain('Private');
  expect(cliResult.stdout).not.toContain('Synthetic status wording');
  expect(cliResult.stdout).not.toContain(databaseUrl.password);

  expect({
    questions: await database.question.count(),
    choices: await database.questionChoice.count(),
    fixtures: await database.question.count({ where: { sourceType: 'FIXTURE' } }),
  }).toEqual(countsBefore);
  const timestampsAfter = new Map((await database.question.findMany({
    where: { id: { in: persistedBatch.questions.map(({ externalId }) => id(externalId)) } },
    select: { id: true, updatedAt: true },
  })).map(({ id: questionId, updatedAt }) => [questionId, updatedAt.getTime()]));
  expect(timestampsAfter).toEqual(timestampsBefore);
  expect(await database.question.findUniqueOrThrow({ where: { id: unrelated.id } })).toMatchObject({
    textEnglish: 'Unrelated row must remain unchanged by status inspection.',
    verificationStatus: 'DRAFT',
    active: false,
  });
}, 120_000);
