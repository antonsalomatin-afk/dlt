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
  candidateContentMatches,
  candidateQuestionId,
  importCandidateBatch,
  mapCandidateQuestion,
} from '../tools/content/candidate-import.ts';
import {
  applyCandidateReview,
  parseCandidateReviewManifest,
} from '../tools/content/candidate-review.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';
import { importFixtures, validateFixtures } from '../tools/content/fixtures.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
const databaseName = `candidate_review_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/review-candidates.ts', import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'thaidlt-review-integration-'));
let created = false;

const fixtureInput: unknown = JSON.parse(readFileSync(
  new URL('../content/fixtures/development.json', import.meta.url),
  'utf8',
));
const fixtures = validateFixtures(fixtureInput);
const exampleInput: unknown = JSON.parse(readFileSync(
  new URL('../content/imports/example-candidate-batch.json', import.meta.url),
  'utf8',
));
const example = parseCandidateBatch(exampleInput);
const commandClock = new Date('2026-10-01T00:00:00.000Z');

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migration = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js',
    '--config',
    'packages/database/prisma.config.ts',
    'migrate',
    'deploy',
  ], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    windowsHide: true,
    timeout: 120_000,
    stdio: 'ignore',
  });
  if (migration.status !== 0 || migration.error) throw new Error('Isolated candidate review migration failed.');
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

function candidateQuestion(externalId: string, textEnglish: string) {
  const base = example.questions[0];
  if (!base) throw new Error('Missing example candidate.');
  return {
    ...base,
    externalId,
    categorySlug: 'review-safe-driving',
    conceptSlug: 'review-space-management',
    textEnglish,
  };
}

function batch(batchId: string, questions: ReturnType<typeof candidateQuestion>[]) {
  return parseCandidateBatch({
    batchId,
    version: 1,
    createdAt: '2026-09-30T00:00:00.000Z',
    questions,
  });
}

function manifest(
  candidateBatch: ReturnType<typeof batch>,
  reviewer: string,
  decisions: Array<{ externalId: string; status: 'VERIFIED' | 'REJECTED' }>,
  reviewedAt = '2026-09-30T01:00:00.000Z',
) {
  return parseCandidateReviewManifest({
    version: 1,
    batchId: candidateBatch.batchId,
    reviewer,
    reviewedAt,
    decisions,
  }, candidateBatch, commandClock);
}

function runCli(candidatePath: string, reviewPath: string) {
  return spawnSync(process.execPath, [cliPath, '--', candidatePath, reviewPath], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
  });
}

it('applies immutable review decisions atomically, replays exactly and fails closed on every drift', async () => {
  await importFixtures(database, fixtures);
  const fixtureQuestionsBefore = await database.question.count({ where: { sourceType: 'FIXTURE' } });
  const fixtureChoicesBefore = await database.questionChoice.count({ where: { question: { sourceType: 'FIXTURE' } } });
  const category = await database.category.create({ data: {
    slug: 'review-safe-driving',
    nameThai: 'หมวดตรวจสอบสังเคราะห์',
    nameEnglish: 'Synthetic review category',
    nameRussian: 'Синтетическая категория проверки',
  } });
  const alternateCategory = await database.category.create({ data: {
    slug: 'review-alternate-category',
    nameThai: 'หมวดสำรอง',
    nameEnglish: 'Alternate category',
    nameRussian: 'Другая категория',
  } });
  const concept = await database.concept.create({ data: {
    slug: 'review-space-management',
    nameThai: 'แนวคิดตรวจสอบสังเคราะห์',
    nameEnglish: 'Synthetic review concept',
    nameRussian: 'Синтетическая концепция проверки',
  } });
  const alternateConcept = await database.concept.create({ data: {
    slug: 'review-alternate-concept',
    nameThai: 'แนวคิดสำรอง',
    nameEnglish: 'Alternate concept',
    nameRussian: 'Другая концепция',
  } });
  const unrelated = await database.question.create({ data: {
    categoryId: category.id,
    conceptId: concept.id,
    vehicleType: 'CAR',
    textEnglish: 'Unrelated review row must remain unchanged.',
    sourceType: 'ORIGINAL',
    sourceReference: 'internal:unrelated/review-preserved',
  } });

  const first = candidateQuestion('review-verified-01', 'First synthetic question for review.');
  const secondBase = candidateQuestion('review-rejected-02', 'Second multilingual synthetic question for review.');
  const second = {
    ...secondBase,
    vehicleType: 'MOTORCYCLE' as const,
    source: {
      type: 'OFFICIAL' as const,
      reference: 'public-record:synthetic-review-reference',
      sourceDate: '2026-09-29',
      legalCitation: 'Synthetic review citation only.',
    },
    textThai: 'คำถามสังเคราะห์สำหรับการตรวจสอบ',
    textRussian: 'Синтетический вопрос для проверки решения.',
    choices: secondBase.choices.map((choice, index) => ({
      ...choice,
      textThai: `ตัวเลือกตรวจสอบ ${index + 1}`,
      textEnglish: `Review option ${index + 1}`,
      textRussian: `Вариант проверки ${index + 1}`,
    })),
  };
  const reviewedBatch = batch('review-mixed-batch', [first, second]);
  await importCandidateBatch(database, reviewedBatch);
  const review = manifest(reviewedBatch, 'Human Reviewer 49', [
    { externalId: first.externalId, status: 'VERIFIED' },
    { externalId: second.externalId, status: 'REJECTED' },
  ]);
  expect(await applyCandidateReview(database, reviewedBatch, review)).toEqual({
    batchId: reviewedBatch.batchId,
    appliedVerified: 1,
    appliedRejected: 1,
    matchedVerified: 0,
    matchedRejected: 0,
    state: 'inactive',
  });

  const firstId = candidateQuestionId(1, reviewedBatch.batchId, first.externalId);
  const secondId = candidateQuestionId(1, reviewedBatch.batchId, second.externalId);
  const storedFirst = await database.question.findUniqueOrThrow({ where: { id: firstId }, include: { choices: true } });
  const storedSecond = await database.question.findUniqueOrThrow({ where: { id: secondId }, include: { choices: true } });
  expect(storedFirst).toMatchObject({ verificationStatus: 'VERIFIED', reviewer: review.reviewer, active: false });
  expect(storedSecond).toMatchObject({ verificationStatus: 'REJECTED', reviewer: review.reviewer, active: false });
  expect(storedFirst.reviewedAt?.toISOString()).toBe(review.reviewedAt);
  expect(storedSecond.reviewedAt?.toISOString()).toBe(review.reviewedAt);
  expect(candidateContentMatches(storedFirst, mapCandidateQuestion(reviewedBatch, first, category.id, concept.id))).toBe(true);
  expect(candidateContentMatches(storedSecond, mapCandidateQuestion(reviewedBatch, second, category.id, concept.id))).toBe(true);

  expect(await applyCandidateReview(database, reviewedBatch, review)).toEqual({
    batchId: reviewedBatch.batchId,
    appliedVerified: 0,
    appliedRejected: 0,
    matchedVerified: 1,
    matchedRejected: 1,
    state: 'inactive',
  });
  expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).updatedAt).toEqual(storedFirst.updatedAt);

  for (const conflicting of [
    manifest(reviewedBatch, 'Another Reviewer', review.decisions),
    manifest(reviewedBatch, review.reviewer, [
      { externalId: first.externalId, status: 'REJECTED' },
      { externalId: second.externalId, status: 'REJECTED' },
    ]),
    manifest(reviewedBatch, review.reviewer, review.decisions, '2026-09-30T02:00:00.000Z'),
  ]) {
    await expect(applyCandidateReview(database, reviewedBatch, conflicting)).rejects.toThrow('conflicting final review decision');
  }

  await database.question.update({ where: { id: firstId }, data: { textEnglish: 'Drifted content.' } });
  await expect(applyCandidateReview(database, reviewedBatch, review)).rejects.toThrow('does not match imported content');
  await database.question.update({ where: { id: firstId }, data: { textEnglish: first.textEnglish } });
  const firstChoice = storedFirst.choices[0];
  if (!firstChoice) throw new Error('Missing reviewed choice.');
  await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: 'Drifted choice.' } });
  await expect(applyCandidateReview(database, reviewedBatch, review)).rejects.toThrow('does not match imported content');
  await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: firstChoice.textEnglish } });
  await database.question.update({ where: { id: firstId }, data: { categoryId: alternateCategory.id, conceptId: alternateConcept.id } });
  await expect(applyCandidateReview(database, reviewedBatch, review)).rejects.toThrow('does not match imported content');
  await database.question.update({ where: { id: firstId }, data: { categoryId: category.id, conceptId: concept.id } });
  await database.question.update({ where: { id: firstId }, data: { active: true } });
  await expect(applyCandidateReview(database, reviewedBatch, review)).rejects.toThrow('does not match imported content');
  await database.question.update({ where: { id: firstId }, data: { active: false } });

  const unimported = candidateQuestion('review-unimported-03', 'Synthetic candidate that was never imported.');
  const suppliedWithMissing = batch(reviewedBatch.batchId, [first, second, unimported]);
  const missingManifest = manifest(suppliedWithMissing, 'Missing Candidate Reviewer', [
    { externalId: unimported.externalId, status: 'VERIFIED' },
  ]);
  await expect(applyCandidateReview(database, suppliedWithMissing, missingManifest)).rejects.toThrow('does not match imported content');

  const rollbackFirst = candidateQuestion('rollback-first-01', 'First transactional review question.');
  const rollbackSecond = candidateQuestion('rollback-second-02', 'Second transactional review question.');
  const rollbackBatch = batch('review-rollback-batch', [rollbackFirst, rollbackSecond]);
  await importCandidateBatch(database, rollbackBatch);
  const rollbackReview = manifest(rollbackBatch, 'Rollback Reviewer', [
    { externalId: rollbackFirst.externalId, status: 'VERIFIED' },
    { externalId: rollbackSecond.externalId, status: 'REJECTED' },
  ]);
  const rollbackFirstId = candidateQuestionId(1, rollbackBatch.batchId, rollbackFirst.externalId);
  await database.question.update({ where: { id: rollbackFirstId }, data: { reviewer: 'Invalid draft reviewer' } });
  await expect(applyCandidateReview(database, rollbackBatch, manifest(rollbackBatch, 'Rollback Reviewer', [
    { externalId: rollbackFirst.externalId, status: 'VERIFIED' },
  ]))).rejects.toThrow('Draft candidate contains conflicting review state');
  await database.question.update({ where: { id: rollbackFirstId }, data: { reviewer: null } });
  const rollbackSecondId = candidateQuestionId(1, rollbackBatch.batchId, rollbackSecond.externalId);
  const rollbackChoice = await database.questionChoice.findFirstOrThrow({ where: { questionId: rollbackSecondId, key: 'A' } });
  await database.questionChoice.update({ where: { id: rollbackChoice.id }, data: { textEnglish: 'Force rollback after first update.' } });
  await expect(applyCandidateReview(database, rollbackBatch, rollbackReview)).rejects.toThrow('does not match imported content');
  expect(await database.question.findUniqueOrThrow({
    where: { id: rollbackFirstId },
  })).toMatchObject({ verificationStatus: 'DRAFT', reviewer: null, reviewedAt: null, active: false });

  const cliQuestion = candidateQuestion('review-cli-01', 'Synthetic candidate reviewed through the CLI.');
  const cliBatch = batch('review-cli-batch', [cliQuestion]);
  await importCandidateBatch(database, cliBatch);
  const cliReview = manifest(cliBatch, 'CLI Human Reviewer', [{ externalId: cliQuestion.externalId, status: 'VERIFIED' }]);
  const cliBatchPath = join(temporaryDirectory, 'cli-batch.json');
  const cliReviewPath = join(temporaryDirectory, 'cli-review.json');
  writeFileSync(cliBatchPath, JSON.stringify(cliBatch));
  writeFileSync(cliReviewPath, JSON.stringify(cliReview));
  const cliResult = runCli(cliBatchPath, cliReviewPath);
  expect(cliResult.status).toBe(0);
  expect(cliResult.stderr).toBe('');
  expect(cliResult.stdout.trim()).toBe('Reviewed batch review-cli-batch: 1 VERIFIED applied, 0 REJECTED applied, 0 VERIFIED matched and 0 REJECTED matched; all inactive.');
  const cliId = candidateQuestionId(1, cliBatch.batchId, cliQuestion.externalId);
  expect(await database.question.findUniqueOrThrow({ where: { id: cliId } })).toMatchObject({
    verificationStatus: 'VERIFIED', reviewer: cliReview.reviewer, active: false,
  });

  const conflictingCliReview = manifest(cliBatch, 'Private Reviewer Must Not Print', [{ externalId: cliQuestion.externalId, status: 'REJECTED' }]);
  writeFileSync(cliReviewPath, JSON.stringify(conflictingCliReview));
  const cliFailure = runCli(cliBatchPath, cliReviewPath);
  expect(cliFailure.status).not.toBe(0);
  expect(cliFailure.stdout).toBe('');
  expect(cliFailure.stderr.trim()).toBe('Candidate review failed. No review decisions were applied.');
  expect(cliFailure.stderr).not.toContain(conflictingCliReview.reviewer);
  expect(cliFailure.stderr).not.toContain(cliQuestion.textEnglish);
  expect(cliFailure.stderr).not.toContain(databaseUrl.password);

  expect((await database.question.findUniqueOrThrow({ where: { id: unrelated.id } })).textEnglish).toBe('Unrelated review row must remain unchanged.');
  expect(await database.question.count({ where: { sourceType: 'FIXTURE' } })).toBe(fixtureQuestionsBefore);
  expect(await database.questionChoice.count({ where: { question: { sourceType: 'FIXTURE' } } })).toBe(fixtureChoicesBefore);
}, 120_000);
