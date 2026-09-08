import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, Prisma, VehicleType } from '../packages/database/src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for real PostgreSQL integration tests.');
const database = createDatabaseClient(databaseUrl);
const telegramUserId = BigInt(`0x${randomBytes(7).toString('hex')}`) + 4294967296n;
let ownedId: string | undefined;

beforeAll(async () => { await database.$connect(); });
afterAll(async () => {
  try {
    // Delete only the exact row successfully created by this test run.
    if (ownedId) await database.user.delete({ where: { id: ownedId } });
  } finally { await database.$disconnect(); }
});

describe('User persistence in PostgreSQL', () => {
  it('persists bigint identity, nullable onboarding fields, profile and timestamps; enforces uniqueness', async () => {
    const user = await database.user.create({ data: { telegramUserId } });
    ownedId = user.id;
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.telegramUserId).toBe(telegramUserId);
    expect(user.username).toBeNull();
    expect(user.firstName).toBeNull();
    expect(user.selectedVehicleType).toBeNull();
    expect(user.lastSeenAt).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);

    const lastSeenAt = new Date('2026-09-07T08:00:00.000Z');
    await database.user.update({ where: { id: user.id }, data: {
      username: 'integration_user', firstName: 'Integration',
      selectedVehicleType: VehicleType.MOTORCYCLE, lastSeenAt,
    } });
    const loaded = await database.user.findUniqueOrThrow({ where: { telegramUserId } });
    expect(loaded).toMatchObject({ id: user.id, telegramUserId, username: 'integration_user',
      firstName: 'Integration', selectedVehicleType: 'MOTORCYCLE', lastSeenAt, createdAt: user.createdAt });
    expect(loaded.updatedAt.getTime()).toBeGreaterThanOrEqual(user.updatedAt.getTime());

    await expect(database.user.create({ data: { telegramUserId } })).rejects.toMatchObject({
      constructor: Prisma.PrismaClientKnownRequestError, code: 'P2002',
    });
    expect(await database.user.count({ where: { telegramUserId } })).toBe(1);
  });
});
