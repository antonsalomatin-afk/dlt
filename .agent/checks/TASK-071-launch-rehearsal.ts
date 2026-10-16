// Run from the repository root with DATABASE_URL already supplied in the environment.
// Every content lifecycle change below is an isolated TEST, never content approval.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createApi } from '../../apps/api/src/index.ts';
import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { examStartResponseSchema } from '../../packages/database/src/exam.ts';
import { activateCandidates, parseCandidateActivationManifest } from '../../tools/content/candidate-activation.ts';
import { importCandidateBatch } from '../../tools/content/candidate-import.ts';
import { applyCandidateReview, parseCandidateReviewManifest } from '../../tools/content/candidate-review.ts';
import { readCandidateBatchFile } from '../../tools/content/candidates.ts';
import { parseDatabaseUrl } from '../../tools/database/config.ts';

const batches = [
  readCandidateBatchFile('content/imports/launch-20261016-car-candidates.json'),
  readCandidateBatchFile('content/imports/launch-20261016-motorcycle-candidates.json'),
];
const sql = readFileSync('content/sources/launch-20261016-taxonomy.sql', 'utf8');
const name = `launch_content_test_${randomBytes(12).toString('hex')}`;
assert.match(name, /^launch_content_test_[a-f0-9]{24}$/u);
let admin: pg.Client | undefined;
let isolated: pg.Client | undefined;
let database: ReturnType<typeof createDatabaseClient> | undefined;
let app: ReturnType<typeof createApi> | undefined;
let created = false;
let phase = 'configuration';
let cleanupFailed = false;

try {
  parseDatabaseUrl(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL ?? '');
  admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  phase = 'isolated database creation';
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  phase = 'isolated migrations';
  const migrated = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js', '--config',
    'packages/database/prisma.config.ts', 'migrate', 'deploy',
  ], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore', windowsHide: true, timeout: 120_000 });
  assert.equal(migrated.status, 0);
  isolated = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await isolated.connect();
  database = createDatabaseClient(url.toString());
  phase = 'additive taxonomy and replay';
  const sentinel = await database.category.create({ data: {
    slug: 'rehearsal-unrelated', nameEnglish: 'Unrelated sentinel',
    nameThai: 'Unrelated sentinel', nameRussian: 'Unrelated sentinel', sortOrder: 9876,
  } });
  await isolated.query(sql);
  const firstTaxonomy = {
    categories: await database.category.findMany({ orderBy: { slug: 'asc' } }),
    concepts: await database.concept.findMany({ orderBy: { slug: 'asc' } }),
  };
  await isolated.query(sql);
  assert.deepEqual(await database.category.findMany({ orderBy: { slug: 'asc' } }), firstTaxonomy.categories);
  assert.deepEqual(await database.concept.findMany({ orderBy: { slug: 'asc' } }), firstTaxonomy.concepts);
  assert.deepEqual(await database.category.findUnique({ where: { id: sentinel.id } }), sentinel);
  phase = 'draft import and immutable replay';
  for (const [index, batch] of batches.entries()) {
    assert.equal(batch.questions.length, 50);
    assert.ok(batch.questions.every((q) => q.vehicleType === (index === 0 ? 'CAR' : 'MOTORCYCLE')));
    const first = await importCandidateBatch(database, batch);
    assert.equal(first.newQuestions, 50);
    assert.equal(first.newChoices, 200);
    const replay = await importCandidateBatch(database, batch);
    assert.equal(replay.newQuestions, 0);
    assert.equal(replay.matchedQuestions, 50);
    assert.equal(replay.matchedChoices, 200);
  }
  assert.equal(await database.question.count(), 100);
  assert.equal(await database.question.count({ where: { active: false, verificationStatus: 'DRAFT', reviewer: null, reviewedAt: null } }), 100);
  assert.equal(await database.question.count({ where: { active: true } }), 0);
  console.log('PASS additive taxonomy/replay; 100 inactive DRAFT questions and 400 choices; unrelated taxonomy preserved.');
  phase = 'TEST-ONLY review and activation simulation';
  const clock = new Date();
  for (const batch of batches) {
    const review = parseCandidateReviewManifest({
      version: 1, batchId: batch.batchId,
      reviewer: 'ISOLATED TEST SIMULATION - NOT CONTENT APPROVAL',
      reviewedAt: clock.toISOString(),
      decisions: batch.questions.map((q) => ({ externalId: q.externalId, status: 'VERIFIED' })),
    }, batch, clock);
    const activation = parseCandidateActivationManifest({
      version: 1, batchId: batch.batchId,
      activatedBy: 'ISOLATED TEST SIMULATION - NOT PUBLICATION',
      activatedAt: clock.toISOString(), externalIds: batch.questions.map((q) => q.externalId),
    }, batch, review, clock);
    assert.equal((await applyCandidateReview(database, batch, review)).appliedVerified, 50);
    assert.equal((await activateCandidates(database, batch, review, activation)).applied, 50);
    assert.equal((await activateCandidates(database, batch, review, activation)).matched, 50);
  }
  phase = 'real API exam construction for each vehicle';
  app = createApi({ database, botToken: 'isolated-rehearsal-placeholder' });
  for (const [index, vehicleType] of (['CAR', 'MOTORCYCLE'] as const).entries()) {
    assert.equal(await database.question.count({ where: { vehicleType, active: true, verificationStatus: 'VERIFIED' } }), 50);
    const user = await database.user.create({ data: { telegramUserId: BigInt(9_100_000 + index), selectedVehicleType: vehicleType } });
    const token = randomBytes(32).toString('base64url');
    await database.session.create({ data: {
      userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    } });
    const response: { statusCode: number; body: string; json(): unknown } = await app.inject({ method: 'POST', url: '/exam/start', headers: { authorization: `Bearer ${token}` }, payload: {} });
    assert.equal(response.statusCode, 200);
    const exam = examStartResponseSchema.parse(response.json());
    assert.equal(exam.vehicleType, vehicleType);
    assert.equal(exam.questions.length, 50);
    assert.equal(new Set(exam.questions.map((q) => q.question.id)).size, 50);
    for (const key of ['correctChoiceId', 'isCorrect', 'explanationEnglish']) assert.ok(!response.body.includes(`"${key}"`));
    console.log(`PASS isolated ${vehicleType} exam: 50 distinct questions; correctness hidden before submission.`);
  }
  phase = 'taxonomy conflict rollback';
  const changed = firstTaxonomy.categories.find((row) => row.id !== sentinel.id);
  assert.ok(changed);
  await database.category.update({ where: { id: changed.id }, data: { nameEnglish: 'DELIBERATE TEST CONFLICT' } });
  const beforeConflict = await database.category.findMany({ orderBy: { slug: 'asc' } });
  await assert.rejects(isolated.query(sql));
  await isolated.query('ROLLBACK');
  assert.deepEqual(await database.category.findMany({ orderBy: { slug: 'asc' } }), beforeConflict);
  console.log('PASS conflicting taxonomy refused with all existing rows preserved.');
  console.log('All lifecycle transitions occurred in one disposable local database. No real review/activation manifests were written.');
} catch {
  console.error(`Launch rehearsal failed during ${phase}. No production database was used.`);
  process.exitCode = 1;
} finally {
  for (const close of [
    async () => { await app?.close(); },
    async () => { await database?.$disconnect(); },
    async () => { await isolated?.end(); },
    async () => { if (created) await admin?.query(`DROP DATABASE "${name}"`); },
    async () => { await admin?.end(); },
  ]) {
    try { await close(); } catch { cleanupFailed = true; }
  }
  if (cleanupFailed) {
    console.error(`Launch rehearsal cleanup failed. Inspect only owned local database ${name}.`);
    process.exitCode = 1;
  } else if (created) console.log('PASS owned isolated database removed.');
}
