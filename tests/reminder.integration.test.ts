import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi, userSchema } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { reminderPreferenceResponseSchema } from '../packages/database/src/reminder.ts';

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `reminder_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-10-04T05:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic-reminder-token', now: () => now });
const tokens = {
  owner: randomBytes(32).toString('base64url'),
  other: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
  revoked: randomBytes(32).toString('base64url'),
};
const userIds = {
  owner: randomUUID(),
  other: randomUUID(),
  expired: randomUUID(),
  revoked: randomUUID(),
};
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const session = (token: string, expiresAt = new Date(now.getTime() + 60_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(now.getTime() - 1_000),
  expiresAt,
});
const getPreference = (token: string, query = '') => app.inject({
  method: 'GET', url: `/me/reminders${query}`, headers: authorization(token),
});
const patchPreference = (token: string, dailyQuestionReminderEnabled: boolean, query = '') => app.inject({
  method: 'PATCH',
  url: `/me/reminders${query}`,
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify({ dailyQuestionReminderEnabled }),
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', windowsHide: true },
  );
  const users = [
    { id: userIds.owner, telegramUserId: 761101n, token: tokens.owner, selectedVehicleType: 'CAR' as const },
    { id: userIds.other, telegramUserId: 761102n, token: tokens.other, selectedVehicleType: 'MOTORCYCLE' as const },
    { id: userIds.expired, telegramUserId: 761103n, token: tokens.expired, selectedVehicleType: null, expiresAt: now },
    { id: userIds.revoked, telegramUserId: 761104n, token: tokens.revoked, selectedVehicleType: null },
  ];
  for (const user of users) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: user.telegramUserId,
      username: `reminder_${user.telegramUserId.toString()}`,
      firstName: 'Reminder learner',
      selectedVehicleType: user.selectedVehicleType,
      sessions: { create: session(user.token, user.expiresAt) },
    } });
  }
  await database.session.deleteMany({ where: { userId: userIds.revoked } });
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.$disconnect();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
});

describe('GET and PATCH /me/reminders', () => {
  it('returns the exact default-off preference without changing accepted user or progress DTOs', async () => {
    const response = await getPreference(tokens.owner);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(reminderPreferenceResponseSchema.parse(response.json())).toEqual({ dailyQuestionReminderEnabled: false });
    expect(Object.keys(response.json())).toEqual(['dailyQuestionReminderEnabled']);

    const me = await app.inject({ method: 'GET', url: '/me', headers: authorization(tokens.owner) });
    expect(me.statusCode).toBe(200);
    expect(userSchema.parse(me.json())).toEqual({
      id: userIds.owner,
      username: 'reminder_761101',
      firstName: 'Reminder learner',
      selectedVehicleType: 'CAR',
    });
    expect(me.json()).not.toHaveProperty('dailyQuestionReminderEnabled');
    const progress = await app.inject({ method: 'GET', url: '/me/progress', headers: authorization(tokens.owner) });
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toEqual({ answered: 0, correct: 0, incorrect: 0, accuracyPercent: null });
  });

  it('enables, repeats, disables and isolates preferences using exact private responses', async () => {
    for (const value of [true, true, false, false]) {
      const response = await patchPreference(tokens.owner, value);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ dailyQuestionReminderEnabled: value });
      expect(Object.keys(response.json())).toEqual(['dailyQuestionReminderEnabled']);
      expect((await getPreference(tokens.owner)).json()).toEqual({ dailyQuestionReminderEnabled: value });
      expect((await getPreference(tokens.other)).json()).toEqual({ dailyQuestionReminderEnabled: false });
    }
  });

  it('returns each concurrent value written and leaves one last-committed boolean', async () => {
    const [enabled, disabled] = await Promise.all([
      patchPreference(tokens.owner, true),
      patchPreference(tokens.owner, false),
    ]);
    expect(enabled.statusCode).toBe(200);
    expect(disabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ dailyQuestionReminderEnabled: true });
    expect(disabled.json()).toEqual({ dailyQuestionReminderEnabled: false });
    const persisted = await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { dailyQuestionReminderEnabled: true },
    });
    expect((await getPreference(tokens.owner)).json()).toEqual(persisted);
  });

  it('authenticates before query, media-type and duplicate-key JSON validation', async () => {
    const unknown = randomBytes(32).toString('base64url');
    for (const headers of [
      { 'content-type': 'application/json' },
      { ...authorization('invalid'), 'content-type': 'application/json' },
      { ...authorization(unknown), 'content-type': 'application/json' },
      { ...authorization(tokens.expired), 'content-type': 'application/json' },
      { ...authorization(tokens.revoked), 'content-type': 'application/json' },
    ]) {
      const response = await app.inject({
        method: 'PATCH', url: '/me/reminders?target=other', headers, payload: '{',
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const unsupportedWithoutAuth = await app.inject({
      method: 'PATCH', url: '/me/reminders', headers: { 'content-type': 'application/xml' }, payload: '<enabled>true</enabled>',
    });
    expect(unsupportedWithoutAuth.statusCode).toBe(401);
    expect(unsupportedWithoutAuth.json()).toEqual({ error: 'Unauthorized' });

    for (const method of ['GET', 'PATCH'] as const) {
      const response = await app.inject({
        method,
        url: '/me/reminders?target=other&target=owner',
        headers: { ...authorization(tokens.owner), ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'PATCH' ? { payload: JSON.stringify({ dailyQuestionReminderEnabled: true }) } : {}),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    const duplicate = await app.inject({
      method: 'PATCH', url: '/me/reminders',
      headers: { ...authorization(tokens.owner), 'content-type': 'application/json' },
      payload: '{"dailyQuestionReminderEnabled":true,"dailyQuestionReminderEnabled":false}',
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json()).toEqual({ error: 'Bad Request' });
  });

  it('strictly rejects invalid bodies, GET bodies and unsupported media without mutation', async () => {
    await patchPreference(tokens.owner, false);
    const before = await database.user.findUniqueOrThrow({ where: { id: userIds.owner } });
    for (const payload of [
      '{}',
      'null',
      '[]',
      '{"dailyQuestionReminderEnabled":null}',
      '{"dailyQuestionReminderEnabled":1}',
      '{"dailyQuestionReminderEnabled":"true"}',
      '{"dailyQuestionReminderEnabled":true,"userId":"550e8400-e29b-41d4-a716-446655440000"}',
      '{',
    ]) {
      const response = await app.inject({
        method: 'PATCH', url: '/me/reminders',
        headers: { ...authorization(tokens.owner), 'content-type': 'application/json' }, payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    const getWithBody = await app.inject({
      method: 'GET', url: '/me/reminders',
      headers: { ...authorization(tokens.owner), 'content-type': 'application/json' }, payload: '{}',
    });
    expect(getWithBody.statusCode).toBe(400);
    expect(getWithBody.json()).toEqual({ error: 'Bad Request' });
    for (const contentType of ['text/plain', 'application/xml', 'application/json-patch+json']) {
      const response = await app.inject({
        method: 'PATCH', url: '/me/reminders',
        headers: { ...authorization(tokens.owner), 'content-type': contentType }, payload: '{}',
      });
      expect(response.statusCode).toBe(415);
      expect(response.json()).toEqual({ error: 'Bad Request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await database.user.findUniqueOrThrow({ where: { id: userIds.owner } })).toEqual(before);
  });

  it('accepts a normal JSON charset and never accepts a target identity', async () => {
    const response = await app.inject({
      method: 'PATCH', url: '/me/reminders',
      headers: { ...authorization(tokens.owner), 'content-type': 'application/json; charset=utf-8' },
      payload: JSON.stringify({ dailyQuestionReminderEnabled: true }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ dailyQuestionReminderEnabled: true });
    expect((await getPreference(tokens.other)).json()).toEqual({ dailyQuestionReminderEnabled: false });
  });

  it('sanitizes injected database failures and keeps the preference unchanged', async () => {
    await patchPreference(tokens.owner, false);
    const update = vi.spyOn(database.user, 'update').mockRejectedValueOnce(new Error('secret update failure'));
    const failedPatch = await patchPreference(tokens.owner, true);
    update.mockRestore();
    expect(failedPatch.statusCode).toBe(500);
    expect(failedPatch.json()).toEqual({ error: 'Internal Server Error' });
    expect(failedPatch.body).not.toContain('secret update failure');
    expect((await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { dailyQuestionReminderEnabled: true },
    })).dailyQuestionReminderEnabled).toBe(false);

    const find = vi.spyOn(database.user, 'findUniqueOrThrow').mockRejectedValueOnce(new Error('secret read failure'));
    const failedGet = await getPreference(tokens.owner);
    find.mockRestore();
    expect(failedGet.statusCode).toBe(500);
    expect(failedGet.json()).toEqual({ error: 'Internal Server Error' });
    expect(failedGet.body).not.toContain('secret read failure');
    expect((await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { dailyQuestionReminderEnabled: true },
    })).dailyQuestionReminderEnabled).toBe(false);
  });
});
