import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { fixtureId, importFixtures, validateFixtures } from '../tools/content/fixtures.ts';
import { parseDatabaseUrl } from '../tools/database/config.ts';

parseDatabaseUrl(process.env.DATABASE_URL);
const url = new URL(process.env.DATABASE_URL ?? '');
const admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
const name = `fixture_test_${randomUUID().replaceAll('-', '')}`;
url.pathname = `/${name}`;
const database = createDatabaseClient(url.toString());
let created = false;
const input: unknown = JSON.parse(readFileSync(new URL('../content/fixtures/development.json', import.meta.url), 'utf8'));
const fixtures = validateFixtures(input);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true, timeout: 120000, stdio: 'ignore',
  });
  if (migration.status !== 0 || migration.error) throw new Error('Isolated fixture test migration failed.');
}, 150000);
afterAll(async () => {
  try {
    await database.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
  } finally { await admin.end(); }
});

it('imports atomically, repeats with stable IDs, and preserves unrelated data on malformed input and collisions', async () => {
  const unrelatedCategory = await database.category.create({ data: { slug: 'unrelated', nameThai: 'อื่น', nameEnglish: 'Other', nameRussian: 'Другое' } });
  const last = fixtures.questions.at(-1);
  if (!last) throw new Error('Missing fixture');
  const collisionId = fixtureId(`question:${last.id}`);
  await database.question.create({ data: { id: collisionId, categoryId: unrelatedCategory.id, vehicleType: 'CAR', textEnglish: 'Preserve nonfixture', sourceType: 'ORIGINAL' } });
  await expect(importFixtures(database, fixtures)).rejects.toThrow('Fixture question collision');
  expect(await database.question.count()).toBe(1);
  expect(await database.category.count()).toBe(1);
  expect((await database.question.findUniqueOrThrow({ where: { id: collisionId } })).textEnglish).toBe('Preserve nonfixture');
  await database.question.delete({ where: { id: collisionId } });
  const firstConcept = fixtures.concepts[0];
  if (!firstConcept) throw new Error('Missing concept fixture');
  const conceptCollision = await database.concept.create({ data: {
    id: fixtureId(`concept:${firstConcept.key}`), slug: `fixture-${firstConcept.key}`,
    nameThai: firstConcept.nameThai, nameEnglish: 'Renamed elsewhere', nameRussian: firstConcept.nameRussian,
  } });
  await expect(importFixtures(database, fixtures)).rejects.toThrow('Fixture concept collision');
  expect(await database.question.count()).toBe(0);
  expect(await database.concept.count()).toBe(1);
  expect((await database.concept.findUniqueOrThrow({ where: { id: conceptCollision.id } })).nameEnglish).toBe('Renamed elsewhere');
  await database.concept.delete({ where: { id: conceptCollision.id } });
  const unrelated = await database.question.create({ data: { categoryId: unrelatedCategory.id, vehicleType: 'CAR', textEnglish: 'Keep me', sourceType: 'ORIGINAL' } });
  await expect(importFixtures(database, { ...fixtures, questions: [] })).rejects.toThrow('Invalid development fixtures');
  expect(await database.question.count()).toBe(1);
  await importFixtures(database, fixtures);
  const firstIds = await database.questionChoice.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  await importFixtures(database, fixtures);
  expect(await database.question.count()).toBe(26);
  expect(await database.questionChoice.count()).toBe(100);
  expect(await database.questionChoice.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).toEqual(firstIds);
  expect(await database.question.count({ where: { sourceType: 'FIXTURE', active: false, verificationStatus: 'DRAFT' } })).toBe(25);
  expect(await database.concept.count()).toBe(fixtures.concepts.length);
  for (const concept of fixtures.concepts) {
    const row = await database.concept.findUniqueOrThrow({ where: { id: fixtureId(`concept:${concept.key}`) }, include: { questions: { select: { id: true } } } });
    expect(row.slug).toBe(`fixture-${concept.key}`);
    expect(row.nameEnglish).toBe(concept.nameEnglish);
    expect(row.questions.map(({ id }) => id).sort()).toEqual(
      fixtures.questions.filter((question) => question.concept === concept.key).map((question) => fixtureId(`question:${question.id}`)).sort(),
    );
  }
  expect(await database.question.count({ where: { sourceType: 'FIXTURE', conceptId: null } })).toBe(0);
  expect((await database.question.findUniqueOrThrow({ where: { id: unrelated.id } })).textEnglish).toBe('Keep me');
}, 60000);
