import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { practiceCategoriesResponseSchema } from '../packages/database/src/practice-categories.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: url });
const databaseName = `practice_categories_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(url);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-09-15T12:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic', now: () => now });

const tokens = {
  car: randomBytes(32).toString('base64url'),
  motorcycle: randomBytes(32).toString('base64url'),
  noVehicle: randomBytes(32).toString('base64url'),
  empty: randomBytes(32).toString('base64url'),
};
const userIds = {
  car: randomUUID(),
  motorcycle: randomUUID(),
  noVehicle: randomUUID(),
  empty: randomUUID(),
};
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const categories = (token: string, query = '') => app.inject({
  method: 'GET',
  url: `/practice/categories${query}`,
  headers: authorization(token),
});
const session = (token: string) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(now.getTime() - 1_000),
  expiresAt: new Date(now.getTime() + 60_000),
});

type Vehicle = 'CAR' | 'MOTORCYCLE';
type QuestionState = {
  vehicleType: Vehicle;
  active?: boolean;
  verificationStatus?: 'DRAFT' | 'VERIFIED' | 'REJECTED';
};

async function createCategory(input: {
  slug: string;
  sortOrder?: number;
  nameThai?: string;
  nameEnglish?: string;
  nameRussian?: string;
  questions?: QuestionState[];
}) {
  return database.category.create({
    data: {
      id: randomUUID(),
      slug: input.slug,
      sortOrder: input.sortOrder ?? 0,
      nameThai: input.nameThai ?? `ไทย ${input.slug}`,
      nameEnglish: input.nameEnglish ?? `English ${input.slug}`,
      nameRussian: input.nameRussian ?? `Russian ${input.slug}`,
      questions: {
        create: (input.questions ?? []).map((question, index) => ({
          vehicleType: question.vehicleType,
          active: question.active ?? true,
          verificationStatus: question.verificationStatus ?? 'VERIFIED',
          textEnglish: `Question ${input.slug} ${index}`,
          sourceType: 'ORIGINAL',
        })),
      },
    },
  });
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );
  const users = [
    { id: userIds.car, token: tokens.car, selectedVehicleType: 'CAR' as const },
    { id: userIds.motorcycle, token: tokens.motorcycle, selectedVehicleType: 'MOTORCYCLE' as const },
    { id: userIds.noVehicle, token: tokens.noVehicle, selectedVehicleType: null },
    { id: userIds.empty, token: tokens.empty, selectedVehicleType: 'CAR' as const },
  ];
  for (const [index, user] of users.entries()) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: BigInt(90_000 + index),
      selectedVehicleType: user.selectedVehicleType,
      sessions: { create: session(user.token) },
    } });
  }
});

beforeEach(async () => {
  await database.question.deleteMany();
  await database.category.deleteMany();
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('GET /practice/categories', () => {
  it('authenticates before query and vehicle validation with stable no-store errors', async () => {
    const unknownToken = randomBytes(32).toString('base64url');
    for (const headers of [{}, { authorization: 'Bearer invalid' }, authorization(unknownToken)]) {
      const response = await app.inject({ method: 'GET', url: '/practice/categories?unknown=1&unknown=2', headers });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    await database.session.updateMany({ where: { userId: userIds.car }, data: { expiresAt: now } });
    const expired = await categories(tokens.car, '?unknown=true');
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ error: 'Unauthorized' });
    expect(expired.headers['cache-control']).toBe('no-store');
    await database.session.updateMany({ where: { userId: userIds.car }, data: { expiresAt: new Date(now.getTime() + 60_000) } });

    for (const query of ['?unknown=true', '?unknown=1&unknown=2']) {
      const response = await categories(tokens.noVehicle, query);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }

    const missingVehicle = await categories(tokens.noVehicle);
    expect(missingVehicle.statusCode).toBe(409);
    expect(missingVehicle.json()).toEqual({ error: 'Vehicle selection required' });
    expect(missingVehicle.headers['cache-control']).toBe('no-store');
  });

  it('returns a strict empty envelope when the saved vehicle has no eligible categories', async () => {
    await createCategory({ slug: 'motorcycle-only', questions: [{ vehicleType: 'MOTORCYCLE' }] });
    const response = await categories(tokens.empty);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ categories: [] });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('filters and counts at the exact saved-vehicle active verified boundary', async () => {
    const alpha = await createCategory({
      slug: 'alpha',
      sortOrder: 10,
      questions: [{ vehicleType: 'CAR' }],
    });
    const mixed = await createCategory({
      slug: 'mixed',
      sortOrder: 20,
      questions: [
        { vehicleType: 'CAR' },
        { vehicleType: 'CAR' },
        { vehicleType: 'CAR', active: false },
        { vehicleType: 'CAR', verificationStatus: 'DRAFT' },
        { vehicleType: 'CAR', verificationStatus: 'REJECTED' },
        { vehicleType: 'MOTORCYCLE' },
        { vehicleType: 'MOTORCYCLE', active: false },
      ],
    });
    const motorcycleOnly = await createCategory({
      slug: 'motorcycle-only',
      sortOrder: 30,
      questions: [{ vehicleType: 'MOTORCYCLE' }, { vehicleType: 'MOTORCYCLE' }],
    });
    await createCategory({
      slug: 'ineligible',
      sortOrder: 0,
      questions: [
        { vehicleType: 'CAR', active: false },
        { vehicleType: 'CAR', verificationStatus: 'DRAFT' },
      ],
    });

    const carResponse = await categories(tokens.car);
    expect(carResponse.statusCode).toBe(200);
    const carBody = practiceCategoriesResponseSchema.parse(carResponse.json());
    expect(carBody.categories).toEqual([
      {
        id: alpha.id,
        slug: 'alpha',
        nameThai: 'ไทย alpha',
        nameEnglish: 'English alpha',
        nameRussian: 'Russian alpha',
        questionCount: 1,
      },
      {
        id: mixed.id,
        slug: 'mixed',
        nameThai: 'ไทย mixed',
        nameEnglish: 'English mixed',
        nameRussian: 'Russian mixed',
        questionCount: 2,
      },
    ]);
    expect(Object.keys(carResponse.json())).toEqual(['categories']);
    for (const item of carBody.categories) {
      expect(Object.keys(item).sort()).toEqual(['id', 'nameEnglish', 'nameRussian', 'nameThai', 'questionCount', 'slug']);
    }
    expect(carResponse.body).not.toContain('sortOrder');
    expect(carResponse.body).not.toContain('questions');
    expect(carResponse.body).not.toContain('verificationStatus');
    expect(carResponse.body).not.toContain('sourceType');
    expect(carResponse.headers['cache-control']).toBe('no-store');

    const motorcycleResponse = await categories(tokens.motorcycle);
    expect(motorcycleResponse.statusCode).toBe(200);
    const motorcycleBody = practiceCategoriesResponseSchema.parse(motorcycleResponse.json());
    expect(motorcycleBody.categories.map(({ id, slug, questionCount }) => ({ id, slug, questionCount }))).toEqual([
      { id: mixed.id, slug: 'mixed', questionCount: 1 },
      { id: motorcycleOnly.id, slug: 'motorcycle-only', questionCount: 2 },
    ]);
  });

  it('orders tied sort positions by unique slug ascending', async () => {
    const created = await Promise.all([
      createCategory({ slug: 'zebra', sortOrder: 5, questions: [{ vehicleType: 'CAR' }] }),
      createCategory({ slug: 'alpha', sortOrder: 5, questions: [{ vehicleType: 'CAR' }] }),
      createCategory({ slug: 'middle', sortOrder: 4, questions: [{ vehicleType: 'CAR' }] }),
    ]);
    expect(created).toHaveLength(3);
    const response = await categories(tokens.car);
    expect(response.statusCode).toBe(200);
    expect(practiceCategoriesResponseSchema.parse(response.json()).categories.map((item) => item.slug)).toEqual([
      'middle', 'alpha', 'zebra',
    ]);
  });

  it('returns 100 categories and fails closed rather than truncating 101', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      slug: `boundary-${String(index).padStart(3, '0')}`,
      nameThai: `ไทย ${index}`,
      nameEnglish: `English ${index}`,
      nameRussian: `Russian ${index}`,
      sortOrder: index,
    }));
    await database.category.createMany({ data: rows.slice(0, 100) });
    await database.question.createMany({ data: rows.slice(0, 100).map((row, index) => ({
      categoryId: row.id,
      vehicleType: 'CAR',
      active: true,
      verificationStatus: 'VERIFIED',
      textEnglish: `Boundary question ${index}`,
      sourceType: 'ORIGINAL',
    })) });

    const hundredResponse = await categories(tokens.car);
    expect(hundredResponse.statusCode).toBe(200);
    const hundred = practiceCategoriesResponseSchema.parse(hundredResponse.json());
    expect(hundred.categories).toHaveLength(100);
    expect(hundred.categories.at(-1)?.slug).toBe('boundary-099');

    const extra = rows[100];
    if (!extra) throw new Error('Missing 101st category fixture');
    await database.category.create({ data: extra });
    await database.question.create({ data: {
      categoryId: extra.id,
      vehicleType: 'CAR',
      active: true,
      verificationStatus: 'VERIFIED',
      textEnglish: 'Boundary question 100',
      sourceType: 'ORIGINAL',
    } });
    const overflow = await categories(tokens.car);
    expect(overflow.statusCode).toBe(500);
    expect(overflow.json()).toEqual({ error: 'Internal Server Error' });
    expect(overflow.headers['cache-control']).toBe('no-store');
    expect(overflow.body).not.toContain('limit');
  });

  it('fails the whole response with a sanitized error for malformed persisted category data', async () => {
    const malformed = await createCategory({
      slug: 'malformed',
      nameEnglish: ' Malformed',
      questions: [{ vehicleType: 'CAR' }],
    });
    const response = await categories(tokens.car);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(malformed.nameEnglish);
  });
});
