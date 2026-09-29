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
  const unrelatedConcept = await database.concept.create({ data: {
    slug: 'unrelated-concept', nameThai: 'แนวคิดอื่น', nameEnglish: 'Other concept', nameRussian: 'Другая концепция',
  } });
  const last = fixtures.questions.at(-1);
  const firstConcept = fixtures.concepts[0];
  if (!last || !firstConcept) throw new Error('Missing fixture');
  const collisionId = fixtureId(`question:${last.id}`);
  await database.question.create({ data: { id: collisionId, categoryId: unrelatedCategory.id, vehicleType: 'CAR', textEnglish: 'Preserve nonfixture', sourceType: 'ORIGINAL' } });
  await expect(importFixtures(database, fixtures)).rejects.toThrow('Fixture question collision');
  expect(await database.question.count()).toBe(1);
  expect(await database.category.count()).toBe(1);
  expect(await database.concept.count()).toBe(1);
  expect((await database.question.findUniqueOrThrow({ where: { id: collisionId } })).textEnglish).toBe('Preserve nonfixture');
  await database.question.delete({ where: { id: collisionId } });
  const unrelated = await database.question.create({ data: { categoryId: unrelatedCategory.id, vehicleType: 'CAR', textEnglish: 'Keep me', sourceType: 'ORIGINAL' } });
  await expect(importFixtures(database, { ...fixtures, questions: [] })).rejects.toThrow('Invalid development fixtures');
  expect(await database.question.count()).toBe(1);

  const expectedConceptId = fixtureId(`concept:${firstConcept.key}`);
  const expectedConceptSlug = `fixture-${firstConcept.key}`;
  await database.concept.create({ data: {
    id: expectedConceptId, slug: expectedConceptSlug,
    nameThai: firstConcept.nameThai, nameEnglish: 'Conflicting name', nameRussian: firstConcept.nameRussian,
  } });
  await expect(importFixtures(database, fixtures)).rejects.toThrow('Fixture concept collision');
  expect(await database.category.count()).toBe(1);
  expect(await database.question.count()).toBe(1);
  await database.concept.delete({ where: { id: expectedConceptId } });

  const slugCollision = await database.concept.create({ data: {
    slug: expectedConceptSlug, nameThai: firstConcept.nameThai,
    nameEnglish: firstConcept.nameEnglish, nameRussian: firstConcept.nameRussian,
  } });
  await expect(importFixtures(database, fixtures)).rejects.toThrow('Fixture concept collision');
  expect(await database.category.count()).toBe(1);
  await database.concept.delete({ where: { id: slugCollision.id } });

  expect(await importFixtures(database, fixtures)).toEqual({ categories: 5, concepts: 10, questions: 25, choices: 100 });
  const firstConceptIds = await database.concept.findMany({
    where: { slug: { startsWith: 'fixture-' } }, select: { id: true }, orderBy: { id: 'asc' },
  });
  const firstQuestionRelations = await database.question.findMany({
    where: { sourceType: 'FIXTURE' }, select: { id: true, conceptId: true }, orderBy: { id: 'asc' },
  });
  const firstChoiceIds = await database.questionChoice.findMany({ select: { id: true }, orderBy: { id: 'asc' } });

  const upgrade = firstQuestionRelations[0];
  if (!upgrade) throw new Error('Missing imported fixture');
  await database.question.update({ where: { id: upgrade.id }, data: { conceptId: null } });
  await importFixtures(database, fixtures);
  expect((await database.question.findUniqueOrThrow({ where: { id: upgrade.id } })).conceptId).toBe(upgrade.conceptId);
  expect(await database.concept.findMany({
    where: { slug: { startsWith: 'fixture-' } }, select: { id: true }, orderBy: { id: 'asc' },
  })).toEqual(firstConceptIds);
  expect(await database.question.findMany({
    where: { sourceType: 'FIXTURE' }, select: { id: true, conceptId: true }, orderBy: { id: 'asc' },
  })).toEqual(firstQuestionRelations);
  expect(await database.question.count()).toBe(26);
  expect(await database.concept.count()).toBe(11);
  expect(await database.questionChoice.count()).toBe(100);
  expect(await database.questionChoice.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).toEqual(firstChoiceIds);
  expect(await database.question.count({ where: { sourceType: 'FIXTURE', active: false, verificationStatus: 'DRAFT' } })).toBe(25);
  expect(await database.question.count({ where: { sourceType: 'FIXTURE', conceptId: null } })).toBe(0);
  for (const concept of fixtures.concepts) {
    expect(await database.concept.findUnique({ where: { id: fixtureId(`concept:${concept.key}`) } })).toMatchObject({
      slug: `fixture-${concept.key}`, nameThai: concept.nameThai,
      nameEnglish: concept.nameEnglish, nameRussian: concept.nameRussian,
    });
  }

  const first = fixtures.questions[0];
  if (!first) throw new Error('Missing fixture');
  const firstId = fixtureId(`question:${first.id}`);
  const conflictingConcept = fixtures.concepts.find(({ key }) => key !== last.concept);
  if (!conflictingConcept) throw new Error('Missing conflicting concept');
  await database.question.update({ where: { id: firstId }, data: { textEnglish: 'Preserve transaction state' } });
  await database.question.update({
    where: { id: fixtureId(`question:${last.id}`) }, data: { conceptId: fixtureId(`concept:${conflictingConcept.key}`) },
  });
  await expect(importFixtures(database, fixtures)).rejects.toThrow('Fixture question collision');
  expect((await database.question.findUniqueOrThrow({ where: { id: firstId } })).textEnglish).toBe('Preserve transaction state');
  await database.question.update({
    where: { id: fixtureId(`question:${last.id}`) }, data: { conceptId: fixtureId(`concept:${last.concept}`) },
  });
  await importFixtures(database, fixtures);

  expect((await database.concept.findUniqueOrThrow({ where: { id: unrelatedConcept.id } })).nameEnglish).toBe('Other concept');
  expect((await database.question.findUniqueOrThrow({ where: { id: unrelated.id } })).textEnglish).toBe('Keep me');
}, 60000);
