// Run from the repository root with DATABASE_URL already supplied in the environment.
// Uses the actual owner-approved manifests, but all writes occur ONLY in a new owned test database.
// Manifest authorization is real; this disposable rehearsal is not production execution.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createApi } from '../../apps/api/src/index.ts';
import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { examStartResponseSchema } from '../../packages/database/src/exam.ts';
import { activateCandidates } from '../../tools/content/candidate-activation.ts';
import { importCandidateBatch } from '../../tools/content/candidate-import.ts';
import { applyCandidateReview } from '../../tools/content/candidate-review.ts';
import { inspectCandidateBatch } from '../../tools/content/candidate-status.ts';
import { validateApprovedRelease } from './TASK-071-release-validation.ts';
import { parseDatabaseUrl } from '../../tools/database/config.ts';

const releases = validateApprovedRelease();
const batches = releases.map(({ batch }) => batch);
const sql = readFileSync('content/sources/launch-20261016-taxonomy.sql', 'utf8');
const name = `launch_release_test_${randomBytes(12).toString('hex')}`;
assert.match(name, /^launch_release_test_[a-f0-9]{24}$/u);
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
  const unrelatedUser = await database.user.create({ data: { telegramUserId: BigInt(9_099_999), firstName: 'Owned rehearsal sentinel' } });
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
  phase = 'actual manifest review and exact inactive replay';
  for (const { batch, review } of releases) {
    const applied = await applyCandidateReview(database, batch, review);
    assert.equal(applied.appliedVerified, 50);
    assert.equal(applied.appliedRejected, 0);
    assert.equal(applied.matchedVerified, 0);
    const replay = await applyCandidateReview(database, batch, review);
    assert.equal(replay.appliedVerified, 0);
    assert.equal(replay.matchedVerified, 50);
    const status = await inspectCandidateBatch(database, batch);
    assert.deepEqual(status.summary, {
      total: 50, missing: 0, drifted: 0, exact: 50, draftInactive: 0,
      verifiedInactive: 50, verifiedActive: 0, rejectedInactive: 0, invalidLifecycle: 0,
    });
  }
  assert.equal(await database.question.count({ where: { verificationStatus: 'VERIFIED', active: false } }), 100);
  assert.equal(await database.question.count({ where: { active: true } }), 0);
  console.log('PASS actual review manifests/replay: 50 exact inactive VERIFIED per vehicle; no early activation.');
  phase = 'actual manifest activation and exact active replay';
  for (const { batch, review, activation } of releases) {
    const applied = await activateCandidates(database, batch, review, activation);
    assert.deepEqual(applied, { batchId: batch.batchId, applied: 50, matched: 0 });
    assert.deepEqual(await activateCandidates(database, batch, review, activation), { batchId: batch.batchId, applied: 0, matched: 50 });
    assert.deepEqual((await inspectCandidateBatch(database, batch)).summary, {
      total: 50, missing: 0, drifted: 0, exact: 50, draftInactive: 0,
      verifiedInactive: 0, verifiedActive: 50, rejectedInactive: 0, invalidLifecycle: 0,
    });
  }
  console.log('PASS actual activation manifests/replay/status: 50 exact active VERIFIED per vehicle; no drift or invalid lifecycle.');
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
  assert.deepEqual(await database.user.findUnique({ where: { id: unrelatedUser.id } }), unrelatedUser);
  assert.deepEqual(await database.category.findUnique({ where: { id: sentinel.id } }), sentinel);
  console.log('PASS unrelated user/taxonomy preserved. Actual approved manifests used only in the owned disposable database; production execution remains separate.');
} catch {
  console.error(`Release rehearsal failed during ${phase}. No production database was used.`);
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
    console.error(`Release rehearsal cleanup failed. Inspect only owned local database ${name}.`);
    process.exitCode = 1;
  } else if (created) console.log('PASS owned isolated database removed.');
}
