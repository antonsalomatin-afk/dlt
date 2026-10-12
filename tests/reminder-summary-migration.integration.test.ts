import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationName = '20261013080000_reminder_summaries';
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = join(repositoryRoot, 'packages/database/prisma/migrations');
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `reminder_summary_migration_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = new pg.Client({ connectionString: isolatedUrl.toString() });
const userId = randomUUID();

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
  await database.query(`INSERT INTO "User" (id, "telegramUserId", "updatedAt") VALUES ($1, 767001, NOW())`, [userId]);
  await database.query(readFileSync(join(migrationsRoot, migrationName, 'migration.sql'), 'utf8'));
}, 120_000);

afterAll(async () => {
  await database.end();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('summary delivery migration', () => {
  it('adds daily and weekly delivery periods with one unique row per learner and period', async () => {
    const enumValues = await database.query<{ enumlabel: string }>(`
      SELECT value.enumlabel
      FROM pg_type type
      INNER JOIN pg_enum value ON value.enumtypid = type.oid
      WHERE type.typname = 'ReminderSummaryType'
      ORDER BY value.enumsortorder
    `);
    expect(enumValues.rows.map(({ enumlabel }) => enumlabel)).toEqual(['DAILY', 'WEEKLY']);
    const deliveryId = randomUUID();
    await database.query(
      `INSERT INTO "ReminderSummaryDelivery" (id, "userId", "summaryType", "periodStart", status, "updatedAt")
       VALUES ($1, $2, 'WEEKLY', DATE '2026-10-05', 'SENT', NOW())`,
      [deliveryId, userId],
    );
    await expect(database.query(
      `INSERT INTO "ReminderSummaryDelivery" (id, "userId", "summaryType", "periodStart", status, "updatedAt")
       VALUES ($1, $2, 'WEEKLY', DATE '2026-10-05', 'CLAIMED', NOW())`,
      [randomUUID(), userId],
    )).rejects.toMatchObject({ code: '23505', constraint: 'ReminderSummaryDelivery_userId_summaryType_periodStart_key' });
    expect((await database.query(
      `SELECT status::text AS status FROM "ReminderSummaryDelivery" WHERE id = $1`, [deliveryId],
    )).rows).toEqual([{ status: 'SENT' }]);
  });
});
