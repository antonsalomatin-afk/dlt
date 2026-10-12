import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationName = '20261012080000_daily_reminder_delivery';
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = join(repositoryRoot, 'packages/database/prisma/migrations');
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `reminder_delivery_migration_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = new pg.Client({ connectionString: isolatedUrl.toString() });
const userId = randomUUID();
const deliveryId = randomUUID();

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await database.connect();
  const priorMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < migrationName)
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const migration of priorMigrations) {
    await database.query(readFileSync(join(migrationsRoot, migration.name, 'migration.sql'), 'utf8'));
  }
  await database.query(
    `INSERT INTO "User" (id, "telegramUserId", "dailyQuestionReminderEnabled", "preferredLanguage", "updatedAt")
     VALUES ($1, 766001, TRUE, 'THAI', NOW())`,
    [userId],
  );
  await database.query(readFileSync(join(migrationsRoot, migrationName, 'migration.sql'), 'utf8'));
}, 120_000);

afterAll(async () => {
  await database.end();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('daily reminder delivery migration', () => {
  it('adds exact status values and preserves enabled language preferences', async () => {
    const enumValues = await database.query<{ enumlabel: string }>(`
      SELECT value.enumlabel
      FROM pg_type type
      INNER JOIN pg_enum value ON value.enumtypid = type.oid
      WHERE type.typname = 'DailyReminderDeliveryStatus'
      ORDER BY value.enumsortorder
    `);
    expect(enumValues.rows.map(({ enumlabel }) => enumlabel)).toEqual(['CLAIMED', 'SENT', 'FAILED']);
    expect((await database.query(
      `SELECT "dailyQuestionReminderEnabled", "preferredLanguage"::text AS "preferredLanguage" FROM "User" WHERE id = $1`,
      [userId],
    )).rows).toEqual([{ dailyQuestionReminderEnabled: true, preferredLanguage: 'THAI' }]);
  });

  it('enforces one user and ICT date while allowing failed delivery state', async () => {
    await database.query(
      `INSERT INTO "DailyReminderDelivery" (id, "userId", "localDate", status, attempts, "updatedAt")
       VALUES ($1, $2, DATE '2026-10-12', 'FAILED', 1, NOW())`,
      [deliveryId, userId],
    );
    await expect(database.query(
      `INSERT INTO "DailyReminderDelivery" (id, "userId", "localDate", status, "updatedAt")
       VALUES ($1, $2, DATE '2026-10-12', 'CLAIMED', NOW())`,
      [randomUUID(), userId],
    )).rejects.toMatchObject({ code: '23505', constraint: 'DailyReminderDelivery_userId_localDate_key' });
    expect((await database.query(
      `SELECT status::text AS status, attempts FROM "DailyReminderDelivery" WHERE id = $1`, [deliveryId],
    )).rows).toEqual([{ status: 'FAILED', attempts: 1 }]);
  });
});
