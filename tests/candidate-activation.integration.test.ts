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
  activateCandidates,
  parseCandidateActivationManifest,
} from '../tools/content/candidate-activation.ts';
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
const databaseName = `candidate_activation_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/activate-candidates.ts', import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'thaidlt-activation-integration-'));
let created = false;

const fixtureInput: unknown = JSON.parse(readFileSync(new URL('../content/fixtures/development.json', import.meta.url), 'utf8'));
const fixtures = validateFixtures(fixtureInput);
const exampleInput: unknown = JSON.parse(readFileSync(new URL('../content/imports/example-candidate-batch.json', import.meta.url), 'utf8'));
const example = parseCandidateBatch(exampleInput);
const commandClock = new Date('2026-10-01T00:00:00.000Z');

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
  if (migration.status !== 0 || migration.error) throw new Error('Isolated candidate activation migration failed.');
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
    categorySlug: 'activation-safe-driving',
    conceptSlug: 'activation-space-management',
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

function review(
  candidateBatch: ReturnType<typeof batch>,
  reviewer: string,
  decisions: Array<{ externalId: string; status: 'VERIFIED' | 'REJECTED' }>,
) {
  return parseCandidateReviewManifest({
    version: 1,
    batchId: candidateBatch.batchId,
    reviewer,
    reviewedAt: '2026-09-30T01:00:00.000Z',
    decisions,
  }, candidateBatch, commandClock);
}

function activation(
  candidateBatch: ReturnType<typeof batch>,
  candidateReview: ReturnType<typeof review>,
  activatedBy: string,
  externalIds: string[],
) {
  return parseCandidateActivationManifest({
    version: 1,
    batchId: candidateBatch.batchId,
    activatedBy,
    activatedAt: '2026-09-30T02:00:00.000Z',
    externalIds,
  }, candidateBatch, candidateReview, commandClock);
}

function runCli(batchPath: string, reviewPath: string, activationPath: string) {
  return spawnSync(process.execPath, [cliPath, '--', batchPath, reviewPath, activationPath], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
  });
}

it('activates only exact VERIFIED candidates transactionally and preserves the complete review chain', async () => {
  await importFixtures(database, fixtures);
  const fixtureQuestionsBefore = await database.question.count({ where: { sourceType: 'FIXTURE' } });
  const fixtureChoicesBefore = await database.questionChoice.count({ where: { question: { sourceType: 'FIXTURE' } } });
  const category = await database.category.create({ data: {
    slug: 'activation-safe-driving', nameThai: 'หมวดเปิดใช้งานสังเคราะห์',
    nameEnglish: 'Synthetic activation category', nameRussian: 'Синтетическая категория активации',
  } });
  const alternateCategory = await database.category.create({ data: {
    slug: 'activation-alternate-category', nameThai: 'หมวดสำรอง',
    nameEnglish: 'Alternate activation category', nameRussian: 'Другая категория активации',
  } });
  const concept = await database.concept.create({ data: {
    slug: 'activation-space-management', nameThai: 'แนวคิดเปิดใช้งานสังเคราะห์',
    nameEnglish: 'Synthetic activation concept', nameRussian: 'Синтетическая концепция активации',
  } });
  const unrelated = await database.question.create({ data: {
    categoryId: category.id, conceptId: concept.id, vehicleType: 'CAR',
    textEnglish: 'Unrelated activation row remains unchanged.', sourceType: 'ORIGINAL',
  } });

  const first = candidateQuestion('activate-first-01', 'First exact candidate to activate.');
  const second = candidateQuestion('activate-second-02', 'Second exact candidate to activate.');
  const rejected = candidateQuestion('activate-rejected-03', 'Rejected candidate must remain inactive.');
  const mainBatch = batch('activation-main-batch', [first, second, rejected]);
  await importCandidateBatch(database, mainBatch);
  const mainReview = review(mainBatch, 'Activation Review Human', [
    { externalId: first.externalId, status: 'VERIFIED' },
    { externalId: second.externalId, status: 'VERIFIED' },
    { externalId: rejected.externalId, status: 'REJECTED' },
  ]);
  await applyCandidateReview(database, mainBatch, mainReview);
  const mainActivation = activation(mainBatch, mainReview, 'Activation Operator', [first.externalId, second.externalId]);
  expect(await activateCandidates(database, mainBatch, mainReview, mainActivation)).toEqual({
    batchId: mainBatch.batchId, applied: 2, matched: 0,
  });

  const firstId = candidateQuestionId(1, mainBatch.batchId, first.externalId);
  const secondId = candidateQuestionId(1, mainBatch.batchId, second.externalId);
  const rejectedId = candidateQuestionId(1, mainBatch.batchId, rejected.externalId);
  const storedFirst = await database.question.findUniqueOrThrow({ where: { id: firstId }, include: { choices: true } });
  expect(storedFirst).toMatchObject({
    active: true, verificationStatus: 'VERIFIED', reviewer: mainReview.reviewer,
  });
  expect(storedFirst.reviewedAt?.toISOString()).toBe(mainReview.reviewedAt);
  expect(candidateContentMatches(storedFirst, mapCandidateQuestion(mainBatch, first, category.id, concept.id))).toBe(true);
  expect(await database.question.findUniqueOrThrow({ where: { id: secondId } })).toMatchObject({ active: true, verificationStatus: 'VERIFIED' });
  expect(await database.question.findUniqueOrThrow({ where: { id: rejectedId } })).toMatchObject({ active: false, verificationStatus: 'REJECTED' });

  const replayUpdatedAt = storedFirst.updatedAt;
  expect(await activateCandidates(database, mainBatch, mainReview, mainActivation)).toEqual({
    batchId: mainBatch.batchId, applied: 0, matched: 2,
  });
  expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).updatedAt).toEqual(replayUpdatedAt);

  const forgedRejectedReview = review(mainBatch, 'Forged Chain Reviewer', [
    { externalId: rejected.externalId, status: 'VERIFIED' },
  ]);
  await expect(activateCandidates(
    database,
    mainBatch,
    forgedRejectedReview,
    activation(mainBatch, forgedRejectedReview, 'Operator', [rejected.externalId]),
  )).rejects.toThrow('does not match the verified review chain');

  const differentReview = review(mainBatch, 'Different Review Human', [
    { externalId: first.externalId, status: 'VERIFIED' },
  ]);
  await expect(activateCandidates(
    database,
    mainBatch,
    differentReview,
    activation(mainBatch, differentReview, 'Operator', [first.externalId]),
  )).rejects.toThrow('does not match the verified review chain');

  const draftQuestion = candidateQuestion('activate-draft-01', 'DRAFT candidate cannot activate.');
  const draftBatch = batch('activation-draft-batch', [draftQuestion]);
  await importCandidateBatch(database, draftBatch);
  const draftReview = review(draftBatch, 'Unapplied Review Human', [{ externalId: draftQuestion.externalId, status: 'VERIFIED' }]);
  await expect(activateCandidates(
    database,
    draftBatch,
    draftReview,
    activation(draftBatch, draftReview, 'Operator', [draftQuestion.externalId]),
  )).rejects.toThrow('does not match the verified review chain');

  const missingQuestion = candidateQuestion('activate-missing-01', 'Missing candidate cannot activate.');
  const missingBatch = batch('activation-missing-batch', [missingQuestion]);
  const missingReview = review(missingBatch, 'Missing Review Human', [{ externalId: missingQuestion.externalId, status: 'VERIFIED' }]);
  await expect(activateCandidates(
    database,
    missingBatch,
    missingReview,
    activation(missingBatch, missingReview, 'Operator', [missingQuestion.externalId]),
  )).rejects.toThrow('does not match the verified review chain');

  await database.question.update({ where: { id: firstId }, data: { textEnglish: 'Drifted active content.' } });
  await expect(activateCandidates(database, mainBatch, mainReview, mainActivation)).rejects.toThrow('does not match the verified review chain');
  await database.question.update({ where: { id: firstId }, data: { textEnglish: first.textEnglish } });
  const firstChoice = storedFirst.choices[0];
  if (!firstChoice) throw new Error('Missing active choice.');
  await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: 'Drifted active choice.' } });
  await expect(activateCandidates(database, mainBatch, mainReview, mainActivation)).rejects.toThrow('does not match the verified review chain');
  await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: firstChoice.textEnglish } });
  await database.question.update({ where: { id: firstId }, data: { categoryId: alternateCategory.id } });
  await expect(activateCandidates(database, mainBatch, mainReview, mainActivation)).rejects.toThrow('does not match the verified review chain');
  await database.question.update({ where: { id: firstId }, data: { categoryId: category.id } });

  const rollbackFirst = candidateQuestion('activation-rollback-first', 'First rollback activation candidate.');
  const rollbackSecond = candidateQuestion('activation-rollback-second', 'Second rollback activation candidate.');
  const rollbackBatch = batch('activation-rollback-batch', [rollbackFirst, rollbackSecond]);
  await importCandidateBatch(database, rollbackBatch);
  const rollbackReview = review(rollbackBatch, 'Rollback Review Human', [
    { externalId: rollbackFirst.externalId, status: 'VERIFIED' },
    { externalId: rollbackSecond.externalId, status: 'VERIFIED' },
  ]);
  await applyCandidateReview(database, rollbackBatch, rollbackReview);
  const rollbackActivation = activation(rollbackBatch, rollbackReview, 'Rollback Operator', [
    rollbackFirst.externalId, rollbackSecond.externalId,
  ]);
  const rollbackSecondId = candidateQuestionId(1, rollbackBatch.batchId, rollbackSecond.externalId);
  await database.question.update({ where: { id: rollbackSecondId }, data: { textEnglish: 'Force activation rollback.' } });
  await expect(activateCandidates(database, rollbackBatch, rollbackReview, rollbackActivation))
    .rejects.toThrow('does not match the verified review chain');
  expect(await database.question.findUniqueOrThrow({
    where: { id: candidateQuestionId(1, rollbackBatch.batchId, rollbackFirst.externalId) },
  })).toMatchObject({ active: false, verificationStatus: 'VERIFIED' });

  const cliQuestion = candidateQuestion('activation-cli-01', 'Candidate activated through the CLI.');
  const cliBatch = batch('activation-cli-batch', [cliQuestion]);
  await importCandidateBatch(database, cliBatch);
  const cliReview = review(cliBatch, 'CLI Review Human', [{ externalId: cliQuestion.externalId, status: 'VERIFIED' }]);
  await applyCandidateReview(database, cliBatch, cliReview);
  const cliActivation = activation(cliBatch, cliReview, 'Private Operator Must Not Print', [cliQuestion.externalId]);
  const cliBatchPath = join(temporaryDirectory, 'cli-batch.json');
  const cliReviewPath = join(temporaryDirectory, 'cli-review.json');
  const cliActivationPath = join(temporaryDirectory, 'cli-activation.json');
  writeFileSync(cliBatchPath, JSON.stringify(cliBatch));
  writeFileSync(cliReviewPath, JSON.stringify(cliReview));
  writeFileSync(cliActivationPath, JSON.stringify(cliActivation));
  const cliResult = runCli(cliBatchPath, cliReviewPath, cliActivationPath);
  expect(cliResult.status).toBe(0);
  expect(cliResult.stderr).toBe('');
  expect(cliResult.stdout.trim()).toBe('Activated batch activation-cli-batch: 1 applied and 0 matched.');
  expect(await database.question.findUniqueOrThrow({
    where: { id: candidateQuestionId(1, cliBatch.batchId, cliQuestion.externalId) },
  })).toMatchObject({ active: true, verificationStatus: 'VERIFIED', reviewer: cliReview.reviewer });

  await database.question.update({
    where: { id: candidateQuestionId(1, cliBatch.batchId, cliQuestion.externalId) },
    data: { textEnglish: 'Private drifted wording must not print.' },
  });
  const cliFailure = runCli(cliBatchPath, cliReviewPath, cliActivationPath);
  expect(cliFailure.status).not.toBe(0);
  expect(cliFailure.stdout).toBe('');
  expect(cliFailure.stderr.trim()).toBe('Candidate activation failed. No candidates were activated.');
  expect(cliFailure.stderr).not.toContain(cliActivation.activatedBy);
  expect(cliFailure.stderr).not.toContain(cliReview.reviewer);
  expect(cliFailure.stderr).not.toContain('Private drifted wording');
  expect(cliFailure.stderr).not.toContain(databaseUrl.password);

  expect((await database.question.findUniqueOrThrow({ where: { id: unrelated.id } })).textEnglish)
    .toBe('Unrelated activation row remains unchanged.');
  expect(await database.question.count({ where: { sourceType: 'FIXTURE' } })).toBe(fixtureQuestionsBefore);
  expect(await database.questionChoice.count({ where: { question: { sourceType: 'FIXTURE' } } })).toBe(fixtureChoicesBefore);
}, 120_000);
