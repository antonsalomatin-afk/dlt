import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabaseClient, type Prisma } from '../packages/database/src/index.ts';
import { snapshotQuestion } from '../packages/database/src/presentation.ts';
import { importCandidateBatch, candidateQuestionId } from '../tools/content/candidate-import.ts';
import { readCandidateBatchFile, readBoundedJsonFile } from '../tools/content/candidates.ts';
import { canonicalJsonSha256, overlayRussianStems, parseRussianStemPack, parseRussianStemReview } from '../tools/content/russian-stems.ts';
import { russianStemsFailureMessage } from '../tools/content/russian-stems-cli.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
const databaseName = `russian_stems_test_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(databaseUrl.toString());
const directory = mkdtempSync(join(tmpdir(), 'russian-stems-integration-'));
let created = false;
const sourcePaths = ['content/imports/launch-20261016-car-candidates.json', 'content/imports/launch-20261016-motorcycle-candidates.json'];
const batches = sourcePaths.map(readCandidateBatchFile);
const packPath = 'content/imports/launch-20261021-russian-stems.json';
const pack = parseRussianStemPack(readBoundedJsonFile(packPath), batches, new Date());
// This default is deliberately synthetic QA evidence, never an independent content approval.
const reviewPath = process.env.TASK074_REVIEW_MANIFEST ?? join(directory, 'SYNTHETIC-TEST-review.json');
if (!process.env.TASK074_REVIEW_MANIFEST) writeFileSync(reviewPath, JSON.stringify({
  version: 1, packSha256: canonicalJsonSha256(pack), reviewer: 'SYNTHETIC ISOLATED TEST ONLY',
  reviewedAt: '2026-10-21T00:01:00.000Z', verdict: 'PASS',
}));
const review = parseRussianStemReview(readBoundedJsonFile(reviewPath), pack, new Date());
const inputs = { pack, review, batches };

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migration = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy',
  ], { env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, windowsHide: true, timeout: 120000, stdio: 'ignore' });
  if (migration.status !== 0 || migration.error) throw new Error('Isolated Russian stem migration failed.');
  for (const slug of new Set(batches.flatMap((batch) => batch.questions.map((question) => question.categorySlug)))) {
    await database.category.create({ data: { slug, nameThai: slug, nameEnglish: slug, nameRussian: slug } });
  }
  for (const slug of new Set(batches.flatMap((batch) => batch.questions.map((question) => question.conceptSlug)))) {
    await database.concept.create({ data: { slug, nameThai: slug, nameEnglish: slug, nameRussian: slug } });
  }
  for (const batch of batches) {
    await importCandidateBatch(database, batch);
    const source = pack.sources.find((item) => item.batchId === batch.batchId);
    if (!source) throw new Error('Missing source.');
    await database.question.updateMany({ where: { id: { in: batch.questions.map((question) => candidateQuestionId(1, batch.batchId, question.externalId)) } }, data: {
      active: true, verificationStatus: 'VERIFIED', reviewer: source.reviewer, reviewedAt: new Date(source.reviewedAt),
    } });
  }
}, 150000);

afterAll(async () => {
  try {
    await database.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  }
});

function cli(apply = false) {
  return spawnSync(process.execPath, ['tools/content/overlay-russian-stems.ts', ...(apply ? ['--apply'] : []), packPath, reviewPath, ...sourcePaths], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
}
function questions() { return database.question.findMany({ include: { choices: { orderBy: { key: 'asc' } } }, orderBy: { id: 'asc' } }); }

it('checks, applies and exactly replays all100 real stems while preserving choices, users, answers, learning and saved snapshots', async () => {
  const before = await questions();
  expect(before).toHaveLength(100);
  const user = await database.user.create({ data: { telegramUserId: 740001n, firstName: 'Synthetic Russian overlay learner' } });
  const presentations = [];
  // Force timestamp ties: createdAt alone cannot define a stable row order.
  const presentationCreatedAt = new Date('2026-10-20T00:00:00.000Z');
  for (const question of before) {
    presentations.push(await database.questionPresentation.create({ data: {
      userId: user.id, questionId: question.id, conceptId: question.conceptId,
      createdAt: presentationCreatedAt, snapshot: snapshotQuestion(question),
    } }));
  }
  const first = before[0];
  const presentation = presentations[0];
  const choice = first?.choices[0];
  if (!first?.conceptId || !presentation || !choice) throw new Error('Missing seeded content.');
  const answer = await database.answerAttempt.create({ data: { presentationId: presentation.id, selectedChoiceId: choice.id, isCorrect: choice.isCorrect } });
  const learning = await database.conceptLearningState.create({ data: {
    userId: user.id, conceptId: first.conceptId, practiceAnswered: 1, practiceCorrect: 1, lastPracticeAt: answer.submittedAt,
  } });
  const session = await database.examSession.create({ data: {
    userId: user.id, vehicleType: 'CAR', passingScore: 45, expiresAt: new Date('2026-11-01T00:00:00.000Z'),
  } });
  const examQuestion = await database.examQuestion.create({ data: {
    examSessionId: session.id, position: 1, questionId: first.id, conceptId: first.conceptId, snapshot: snapshotQuestion(first),
  } });
  const check = cli();
  expect(check.status).toBe(0);
  expect(check.stderr).toBe('');
  expect(check.stdout.trim()).toBe('Russian stems: 100 would apply, 0 applied, 0 matched.');
  expect(await questions()).toEqual(before);
  const apply = cli(true);
  expect(apply.status).toBe(0);
  expect(apply.stdout.trim()).toBe('Russian stems: 0 would apply, 100 applied, 0 matched.');
  const after = await questions();
  for (const [index, original] of before.entries()) {
    const updated = after[index];
    if (!updated) throw new Error('Missing overlaid row.');
    expect(updated).toEqual({ ...original, textRussian: expect.any(String), reviewer: review.reviewer,
      reviewedAt: new Date(review.reviewedAt), updatedAt: expect.any(Date) });
    const translation = pack.translations.find((item) => candidateQuestionId(1, item.batchId, item.externalId) === original.id);
    expect(updated.textRussian).toBe(translation?.textRussian);
  }
  expect(cli(true).stdout.trim()).toBe('Russian stems: 0 would apply, 0 applied, 100 matched.');
  expect(cli().stdout.trim()).toBe('Russian stems: 0 would apply, 0 applied, 100 matched.');
  expect(await questions()).toEqual(after); // includes updatedAt: replay makes no write
  expect(await database.questionPresentation.findMany({ orderBy: { id: 'asc' } }))
    .toEqual([...presentations].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  expect(await database.answerAttempt.findUnique({ where: { id: answer.id } })).toEqual(answer);
  expect(await database.user.findUnique({ where: { id: user.id } })).toEqual(user);
  expect(await database.conceptLearningState.findUnique({ where: { userId_conceptId: { userId: user.id, conceptId: first.conceptId } } })).toEqual(learning);
  expect(await database.examQuestion.findUnique({ where: { id: examQuestion.id } })).toEqual(examQuestion);
}, 120000);

it('aborts all100 writes on late content, choice, taxonomy, state, translation and review conflicts', async () => {
  // Reset only owned isolated fixture rows to the accepted source state.
  for (const batch of batches) {
    const source = pack.sources.find((item) => item.batchId === batch.batchId);
    if (!source) throw new Error('Missing source.');
    await database.question.updateMany({ where: { id: { in: batch.questions.map((question) => candidateQuestionId(1, batch.batchId, question.externalId)) } }, data: {
      textRussian: null, reviewer: source.reviewer, reviewedAt: new Date(source.reviewedAt),
    } });
  }
  const firstBatch = batches[0];
  const lastBatch = batches[1];
  const firstSource = firstBatch?.questions[0];
  const lastSource = lastBatch?.questions.at(-1);
  if (!firstBatch || !lastBatch || !firstSource || !lastSource) throw new Error('Missing source.');
  const firstId = candidateQuestionId(1, firstBatch.batchId, firstSource.externalId);
  const lastId = candidateQuestionId(1, lastBatch.batchId, lastSource.externalId);
  const original = await database.question.findUniqueOrThrow({ where: { id: lastId }, include: { choices: true } });
  const mutations: Prisma.QuestionUpdateInput[] = [
    { textEnglish: 'Unapproved drift' }, { textThai: 'unexpected original' },
    { sourceReference: 'internal:unexpected-source' }, { sourceDate: new Date('2026-01-01T00:00:00.000Z') },
    { imageReference: 'https://invalid.example/image.png' }, { explanationRussian: 'Неутверждённое объяснение' },
    { category: { connect: { id: (await database.question.findUniqueOrThrow({ where: { id: firstId } })).categoryId } } },
    { concept: { disconnect: true } }, { verificationStatus: 'DRAFT' }, { verificationStatus: 'REJECTED' }, { active: false },
    { textRussian: 'Посторонний перевод' }, { reviewer: null }, { reviewer: 'Conflicting reviewer' }, { reviewedAt: null },
    { reviewedAt: new Date('2026-10-21T01:30:00.000Z') },
    { textRussian: pack.translations.at(-1)?.textRussian ?? '', reviewer: review.reviewer, reviewedAt: new Date('2026-10-21T01:30:00.000Z') },
  ];
  for (const mutation of mutations) {
    await database.question.update({ where: { id: lastId }, data: mutation });
    const beforeFirst = await database.question.findUniqueOrThrow({ where: { id: firstId } });
    await expect(overlayRussianStems(database, inputs, true)).rejects.toThrow();
    expect(await database.question.findUniqueOrThrow({ where: { id: firstId } })).toEqual(beforeFirst);
    await database.question.update({ where: { id: lastId }, data: {
      textEnglish: original.textEnglish, textThai: original.textThai, sourceReference: original.sourceReference,
      sourceDate: original.sourceDate, imageReference: original.imageReference, explanationRussian: original.explanationRussian,
      categoryId: original.categoryId, conceptId: original.conceptId, verificationStatus: original.verificationStatus,
      active: original.active, textRussian: null, reviewer: original.reviewer, reviewedAt: original.reviewedAt,
    } });
  }
  const choice = original.choices[0];
  if (!choice) throw new Error('Missing choice.');
  for (const mutation of [{ textEnglish: 'Choice drift' }, { isCorrect: !choice.isCorrect }, { textRussian: 'Перевод варианта' }]) {
    await database.questionChoice.update({ where: { id: choice.id }, data: mutation });
    await expect(overlayRussianStems(database, inputs, true)).rejects.toThrow();
    expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).textRussian).toBeNull();
    await database.questionChoice.update({ where: { id: choice.id }, data: { textEnglish: choice.textEnglish, textRussian: choice.textRussian, isCorrect: choice.isCorrect } });
  }
  // A CLI failure uses fixed safe output even after earlier rows would have been updated.
  await database.question.update({ where: { id: lastId }, data: { active: false } });
  const failure = cli(true);
  expect(failure.status).not.toBe(0);
  expect(failure.stdout).toBe('');
  expect(failure.stderr.trim()).toBe(russianStemsFailureMessage);
  expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).textRussian).toBeNull();
  await database.question.update({ where: { id: lastId }, data: { active: true } });
  const presentations = await database.questionPresentation.findMany({ where: { questionId: lastId } });
  await database.questionPresentation.deleteMany({ where: { questionId: lastId } });
  await database.questionChoice.deleteMany({ where: { questionId: lastId } });
  await expect(overlayRussianStems(database, inputs, true)).rejects.toThrow();
  expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).textRussian).toBeNull();
  await database.question.delete({ where: { id: lastId } });
  await expect(overlayRussianStems(database, inputs, true)).rejects.toThrow();
  expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).textRussian).toBeNull();
  expect(presentations).toHaveLength(1);
}, 120000);
