import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimReminderDelivery, markReminderDeliveryFailed, markReminderDeliverySent } from '../packages/database/src/reminder-delivery.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { claimSummaryDelivery, markSummaryDeliveryFailed, markSummaryDeliverySent, summaryPeriodForTick } from '../packages/database/src/summary.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL required');
const database = createDatabaseClient(databaseUrl);
const userId = randomUUID();
const localDate = '2026-10-12';

beforeAll(async () => {
  await database.user.create({
    data: { id: userId, telegramUserId: BigInt(`76${Math.floor(Math.random() * 1_000_000)}`), dailyQuestionReminderEnabled: true },
  });
});

afterAll(async () => {
  await database.user.delete({ where: { id: userId } });
  await database.$disconnect();
});

describe('daily reminder delivery ledger', () => {
  it('claims one delivery under concurrent ticks and permits one retry after failure', async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimReminderDelivery(
      database, userId, localDate, new Date('2026-10-12T04:00:00.000Z'),
    )));
    expect(claims.filter(({ claimed }) => claimed)).toHaveLength(1);
    const first = claims.find(({ claimed }) => claimed);
    if (!first) throw new Error('No delivery claim was created');
    expect((await database.dailyReminderDelivery.count({ where: { userId, localDate: new Date(`${localDate}T00:00:00.000Z`) } }))).toBe(1);

    expect(await markReminderDeliveryFailed(database, first.deliveryId, new Date('2026-10-12T04:00:02.000Z'))).toBe(true);
    const retries = await Promise.all(Array.from({ length: 8 }, () => claimReminderDelivery(
      database, userId, localDate, new Date('2026-10-12T04:00:03.000Z'),
    )));
    expect(retries.filter(({ claimed }) => claimed)).toHaveLength(1);
    const retried = retries.find(({ claimed }) => claimed);
    if (!retried) throw new Error('No retry claim was created');
    expect(await markReminderDeliverySent(database, retried.deliveryId, new Date('2026-10-12T04:00:04.000Z'))).toBe(true);
    expect((await database.dailyReminderDelivery.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate: new Date(`${localDate}T00:00:00.000Z`) } },
      select: { status: true, attempts: true },
    }))).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('claims one weekly summary under concurrency and retries only failed delivery', async () => {
    const period = summaryPeriodForTick(new Date('2026-10-12T04:00:00.000Z')).weekly;
    if (!period) throw new Error('Expected Monday weekly period');
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimSummaryDelivery(
      database, userId, period, new Date('2026-10-12T04:00:00.000Z'),
    )));
    expect(claims.filter(({ claimed }) => claimed)).toHaveLength(1);
    const first = claims.find(({ claimed }) => claimed);
    if (!first) throw new Error('No weekly summary claim was created');
    expect(await markSummaryDeliveryFailed(database, first.deliveryId, new Date('2026-10-12T04:00:02.000Z'))).toBe(true);
    const retries = await Promise.all(Array.from({ length: 8 }, () => claimSummaryDelivery(
      database, userId, period, new Date('2026-10-12T04:00:03.000Z'),
    )));
    expect(retries.filter(({ claimed }) => claimed)).toHaveLength(1);
    const retried = retries.find(({ claimed }) => claimed);
    if (!retried) throw new Error('No weekly summary retry claim was created');
    expect(await markSummaryDeliverySent(database, retried.deliveryId, new Date('2026-10-12T04:00:04.000Z'))).toBe(true);
    expect((await database.reminderSummaryDelivery.findUniqueOrThrow({
      where: { userId_summaryType_periodStart: { userId, summaryType: 'WEEKLY', periodStart: period.periodStart } },
      select: { status: true, attempts: true },
    }))).toMatchObject({ status: 'SENT', attempts: 2 });
  });
});
