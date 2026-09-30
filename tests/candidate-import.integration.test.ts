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
  mapCandidateQuestion,
} from '../tools/content/candidate-import.ts';
import { parseCandidateBatch } from '../tools/content/candidates.ts';
import { importFixtures, validateFixtures } from '../tools/content/fixtures.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
const databaseName = `candidate_import_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const cliPath = fileURLToPath(new URL('../tools/content/import-candidates.ts', import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'thaidlt-candidate-integration-'));
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
  if (migration.status !== 0 || migration.error) throw new Error('Isolated candidate import migration failed.');
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
    categorySlug: 'candidate-safe-driving',
    conceptSlug: 'candidate-space-management',
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

function runCli(path: string) {
  return spawnSync(process.execPath, [cliPath, '--', path], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    timeout: 30_000,
  });
}

it('imports immutable inactive candidates atomically and rejects every collision without harming unrelated data', async () => {
  await importFixtures(database, fixtures);
  const fixtureQuestionsBefore = await database.question.count({ where: { sourceType: 'FIXTURE' } });
  const fixtureChoicesBefore = await database.questionChoice.count({ where: { question: { sourceType: 'FIXTURE' } } });
  const category = await database.category.create({ data: {
    slug: 'candidate-safe-driving',
    nameThai: 'หมวดสังเคราะห์',
    nameEnglish: 'Synthetic candidate category',
    nameRussian: 'Синтетическая категория',
  } });
  const concept = await database.concept.create({ data: {
    slug: 'candidate-space-management',
    nameThai: 'แนวคิดสังเคราะห์',
    nameEnglish: 'Synthetic candidate concept',
    nameRussian: 'Синтетическая концепция',
  } });
  const unrelated = await database.question.create({ data: {
    categoryId: category.id,
    conceptId: concept.id,
    vehicleType: 'CAR',
    textEnglish: 'Unrelated row must remain unchanged.',
    sourceType: 'ORIGINAL',
    sourceReference: 'internal:unrelated/preserved',
  } });

  const original = candidateQuestion('integration-original-01', 'What belongs in the first synthetic candidate?');
  const citedBase = candidateQuestion('integration-cited-02', 'What belongs in the second multilingual synthetic candidate?');
  const cited = {
    ...citedBase,
    vehicleType: 'MOTORCYCLE' as const,
    source: {
      type: 'THIRD_PARTY' as const,
      reference: 'public-record:synthetic-integration-reference',
      sourceDate: '2026-09-29',
      legalCitation: 'Synthetic citation for persistence testing only.',
    },
    textThai: 'คำถามสังเคราะห์สำหรับการทดสอบ',
    textExamEnglish: 'Synthetic exam-style candidate wording.',
    textRussian: 'Синтетический вопрос для проверки.',
    explanationThai: 'คำอธิบายสังเคราะห์',
    explanationRussian: 'Синтетическое объяснение.',
    trapExplanationThai: 'คำอธิบายกับดักสังเคราะห์',
    trapExplanationRussian: 'Синтетическое объяснение ловушки.',
    choices: citedBase.choices.map((choice, index) => ({
      ...choice,
      textThai: `ตัวเลือกสังเคราะห์ ${index + 1}`,
      textEnglish: `Persisted synthetic option ${index + 1}`,
      textRussian: `Синтетический вариант ${index + 1}`,
    })),
  };
  const mixedBatch = batch('integration-mixed-batch', [original, cited]);
  expect(await importCandidateBatch(database, mixedBatch)).toEqual({
    batchId: 'integration-mixed-batch',
    newQuestions: 2,
    newChoices: 8,
    matchedQuestions: 0,
    matchedChoices: 0,
    state: 'inactive DRAFT',
  });

  const citedId = candidateQuestionId(1, mixedBatch.batchId, cited.externalId);
  const storedCited = await database.question.findUniqueOrThrow({ where: { id: citedId }, include: { choices: { orderBy: { key: 'asc' } } } });
  expect(storedCited).toMatchObject({
    vehicleType: 'MOTORCYCLE',
    categoryId: category.id,
    conceptId: concept.id,
    textThai: cited.textThai,
    textExamEnglish: cited.textExamEnglish,
    textEnglish: cited.textEnglish,
    textRussian: cited.textRussian,
    explanationThai: cited.explanationThai,
    explanationEnglish: cited.explanationEnglish,
    explanationRussian: cited.explanationRussian,
    trapExplanationThai: cited.trapExplanationThai,
    trapExplanationEnglish: cited.trapExplanationEnglish,
    trapExplanationRussian: cited.trapExplanationRussian,
    imageReference: null,
    sourceType: 'THIRD_PARTY',
    sourceReference: cited.source.reference,
    legalCitation: cited.source.legalCitation,
    verificationStatus: 'DRAFT',
    reviewer: null,
    reviewedAt: null,
    active: false,
  });
  expect(storedCited.sourceDate?.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  expect(storedCited.choices.map(({ key }) => key)).toEqual(['A', 'B', 'C', 'D']);
  expect(storedCited.choices.filter(({ isCorrect }) => isCorrect).map(({ key }) => key)).toEqual(['A']);
  expect(await importCandidateBatch(database, mixedBatch)).toEqual({
    batchId: 'integration-mixed-batch',
    newQuestions: 0,
    newChoices: 0,
    matchedQuestions: 2,
    matchedChoices: 8,
    state: 'inactive DRAFT',
  });

  const originalId = candidateQuestionId(1, mixedBatch.batchId, original.externalId);
  const changedBatch = batch(mixedBatch.batchId, [{ ...original, textEnglish: 'Changed immutable wording.' }, cited]);
  await expect(importCandidateBatch(database, changedBatch)).rejects.toThrow('Candidate identity collision');
  expect((await database.question.findUniqueOrThrow({ where: { id: originalId } })).textEnglish).toBe(original.textEnglish);

  await database.question.update({ where: { id: originalId }, data: { active: true } });
  await expect(importCandidateBatch(database, mixedBatch)).rejects.toThrow('Candidate identity collision');
  await database.question.update({ where: { id: originalId }, data: { active: false, verificationStatus: 'VERIFIED', reviewer: 'reviewer', reviewedAt: new Date() } });
  await expect(importCandidateBatch(database, mixedBatch)).rejects.toThrow('Candidate identity collision');
  await database.question.update({ where: { id: originalId }, data: { verificationStatus: 'DRAFT', reviewer: null, reviewedAt: null } });

  const mappedOriginal = mapCandidateQuestion(mixedBatch, original, category.id, concept.id);
  const firstChoice = mappedOriginal.choices[0];
  if (!firstChoice) throw new Error('Missing mapped choice.');
  await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: 'Changed immutable choice.' } });
  await expect(importCandidateBatch(database, mixedBatch)).rejects.toThrow('Candidate identity collision');
  await database.questionChoice.update({ where: { id: firstChoice.id }, data: { textEnglish: firstChoice.textEnglish } });
  await database.questionChoice.delete({ where: { id: firstChoice.id } });
  await expect(importCandidateBatch(database, mixedBatch)).rejects.toThrow('Candidate identity collision');
  await database.questionChoice.create({ data: firstChoice });

  for (const [suffix, taxonomyChange] of [
    ['missing-category', { categorySlug: 'missing-category' }],
    ['missing-concept', { conceptSlug: 'missing-concept' }],
  ] as const) {
    const candidate = { ...candidateQuestion(`taxonomy-${suffix}`, `Synthetic ${suffix} question.`), ...taxonomyChange };
    const taxonomyBatch = batch(`taxonomy-${suffix}-batch`, [candidate]);
    await expect(importCandidateBatch(database, taxonomyBatch)).rejects.toThrow('Candidate taxonomy reference is missing');
    expect(await database.question.findUnique({
      where: { id: candidateQuestionId(1, taxonomyBatch.batchId, candidate.externalId) },
    })).toBeNull();
  }

  const collisionCandidate = candidateQuestion('occupied-question-01', 'Synthetic question whose identity is occupied.');
  const collisionBatch = batch('occupied-question-batch', [collisionCandidate]);
  const occupiedId = candidateQuestionId(1, collisionBatch.batchId, collisionCandidate.externalId);
  await database.question.create({ data: {
    id: occupiedId,
    categoryId: category.id,
    conceptId: concept.id,
    vehicleType: 'CAR',
    textEnglish: 'Unrelated occupant.',
    sourceType: 'ORIGINAL',
  } });
  await expect(importCandidateBatch(database, collisionBatch)).rejects.toThrow('Candidate identity collision');
  expect((await database.question.findUniqueOrThrow({ where: { id: occupiedId } })).textEnglish).toBe('Unrelated occupant.');

  const choiceCollisionCandidate = candidateQuestion('occupied-choice-01', 'Synthetic candidate with an occupied choice identity.');
  const choiceCollisionBatch = batch('occupied-choice-batch', [choiceCollisionCandidate]);
  const choiceCollisionQuestionId = candidateQuestionId(1, choiceCollisionBatch.batchId, choiceCollisionCandidate.externalId);
  await database.questionChoice.create({ data: {
    id: candidateChoiceId(choiceCollisionQuestionId, 'A'),
    questionId: unrelated.id,
    key: 'A',
    textEnglish: 'Unrelated choice occupant.',
    isCorrect: false,
  } });
  await expect(importCandidateBatch(database, choiceCollisionBatch)).rejects.toThrow('Candidate choice identity collision');
  expect(await database.question.findUnique({ where: { id: choiceCollisionQuestionId } })).toBeNull();

  const atomicFirst = candidateQuestion('atomic-first-01', 'First synthetic all-or-nothing question.');
  const atomicSecond = candidateQuestion('atomic-second-02', 'Second synthetic all-or-nothing question.');
  const atomicBatch = batch('atomic-collision-batch', [atomicFirst, atomicSecond]);
  const atomicSecondId = candidateQuestionId(1, atomicBatch.batchId, atomicSecond.externalId);
  await database.question.create({ data: {
    id: atomicSecondId,
    categoryId: category.id,
    conceptId: concept.id,
    vehicleType: 'CAR',
    textEnglish: 'Occupy the second identity.',
    sourceType: 'ORIGINAL',
  } });
  await expect(importCandidateBatch(database, atomicBatch)).rejects.toThrow('Candidate identity collision');
  expect(await database.question.findUnique({
    where: { id: candidateQuestionId(1, atomicBatch.batchId, atomicFirst.externalId) },
  })).toBeNull();

  const cliCandidate = candidateQuestion('cli-success-01', 'Synthetic candidate imported through the CLI.');
  const cliBatch = batch('cli-success-batch', [cliCandidate]);
  const cliFile = join(temporaryDirectory, 'cli-success.json');
  writeFileSync(cliFile, JSON.stringify(cliBatch));
  const cliResult = runCli(cliFile);
  expect(cliResult.status).toBe(0);
  expect(cliResult.stderr).toBe('');
  expect(cliResult.stdout.trim()).toBe('Imported batch cli-success-batch: 1 new questions, 4 new choices, 0 matched questions and 0 matched choices; all inactive DRAFT.');
  expect(await database.question.findUnique({
    where: { id: candidateQuestionId(1, cliBatch.batchId, cliCandidate.externalId) },
  })).toMatchObject({ active: false, verificationStatus: 'DRAFT' });

  const cliFailureCandidate = { ...candidateQuestion('cli-failure-01', 'Source wording must never appear in CLI failure.'), conceptSlug: 'missing-cli-concept' };
  const cliFailureBatch = batch('cli-failure-batch', [cliFailureCandidate]);
  const cliFailureFile = join(temporaryDirectory, 'cli-failure.json');
  writeFileSync(cliFailureFile, JSON.stringify(cliFailureBatch));
  const cliFailure = runCli(cliFailureFile);
  expect(cliFailure.status).not.toBe(0);
  expect(cliFailure.stdout).toBe('');
  expect(cliFailure.stderr.trim()).toBe('Candidate import failed. No candidate content was imported.');
  expect(cliFailure.stderr).not.toContain('Source wording');
  expect(cliFailure.stderr).not.toContain(databaseUrl.password);
  expect(await database.question.findUnique({
    where: { id: candidateQuestionId(1, cliFailureBatch.batchId, cliFailureCandidate.externalId) },
  })).toBeNull();

  expect((await database.question.findUniqueOrThrow({ where: { id: unrelated.id } })).textEnglish).toBe('Unrelated row must remain unchanged.');
  expect(await database.question.count({ where: { sourceType: 'FIXTURE' } })).toBe(fixtureQuestionsBefore);
  expect(await database.questionChoice.count({ where: { question: { sourceType: 'FIXTURE' } } })).toBe(fixtureChoicesBefore);
}, 120_000);
