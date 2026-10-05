import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi, userSchema } from '../apps/api/src/index.ts';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { languagePreferenceResponseSchema } from '../packages/database/src/language.ts';

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL required');
const admin = new pg.Client({ connectionString: sourceUrl });
const databaseName = `language_test_${randomBytes(8).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${databaseName}`;
const database = createDatabaseClient(isolatedUrl.toString());
const now = new Date('2026-10-05T06:00:00.000Z');
const app = createApi({ database, botToken: 'synthetic-language-token', now: () => now });
const tokens = {
  owner: randomBytes(32).toString('base64url'),
  other: randomBytes(32).toString('base64url'),
  expired: randomBytes(32).toString('base64url'),
  revoked: randomBytes(32).toString('base64url'),
};
const userIds = {
  owner: randomUUID(), other: randomUUID(), expired: randomUUID(), revoked: randomUUID(),
};
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const session = (token: string, expiresAt = new Date(now.getTime() + 60_000)) => ({
  tokenHash: createHash('sha256').update(token).digest('hex'),
  createdAt: new Date(now.getTime() - 1_000),
  expiresAt,
});
const getPreference = (token: string, query = '') => app.inject({
  method: 'GET', url: `/me/language${query}`, headers: authorization(token),
});
const patchPreference = (token: string, preferredLanguage: 'ENGLISH' | 'RUSSIAN' | 'THAI', query = '') => app.inject({
  method: 'PATCH',
  url: `/me/language${query}`,
  headers: { ...authorization(token), 'content-type': 'application/json' },
  payload: JSON.stringify({ preferredLanguage }),
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
    { id: userIds.owner, telegramUserId: 763101n, token: tokens.owner, selectedVehicleType: 'CAR' as const },
    { id: userIds.other, telegramUserId: 763102n, token: tokens.other, selectedVehicleType: 'MOTORCYCLE' as const },
    { id: userIds.expired, telegramUserId: 763103n, token: tokens.expired, selectedVehicleType: null, expiresAt: now },
    { id: userIds.revoked, telegramUserId: 763104n, token: tokens.revoked, selectedVehicleType: null },
  ];
  for (const user of users) {
    await database.user.create({ data: {
      id: user.id,
      telegramUserId: user.telegramUserId,
      username: `language_${user.telegramUserId.toString()}`,
      firstName: 'Language learner',
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

describe('GET and PATCH /me/language', () => {
  it('returns an exact English default while accepted user, reminder and progress DTOs stay unchanged', async () => {
    const response = await getPreference(tokens.owner);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(languagePreferenceResponseSchema.parse(response.json())).toEqual({ preferredLanguage: 'ENGLISH' });
    expect(Object.keys(response.json())).toEqual(['preferredLanguage']);

    const me = await app.inject({ method: 'GET', url: '/me', headers: authorization(tokens.owner) });
    expect(userSchema.parse(me.json())).toEqual({
      id: userIds.owner, username: 'language_763101', firstName: 'Language learner', selectedVehicleType: 'CAR',
    });
    expect(me.json()).not.toHaveProperty('preferredLanguage');
    expect((await app.inject({ method: 'GET', url: '/me/reminders', headers: authorization(tokens.owner) })).json())
      .toEqual({ dailyQuestionReminderEnabled: false });
    expect((await app.inject({ method: 'GET', url: '/me/progress', headers: authorization(tokens.owner) })).json())
      .toEqual({ answered: 0, correct: 0, incorrect: 0, accuracyPercent: null });
  });

  it('persists every supported value, repeats idempotently and isolates the other learner', async () => {
    for (const preferredLanguage of ['RUSSIAN', 'RUSSIAN', 'THAI', 'ENGLISH', 'ENGLISH'] as const) {
      const response = await patchPreference(tokens.owner, preferredLanguage);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ preferredLanguage });
      expect(Object.keys(response.json())).toEqual(['preferredLanguage']);
      expect((await getPreference(tokens.owner)).json()).toEqual({ preferredLanguage });
      expect((await getPreference(tokens.other)).json()).toEqual({ preferredLanguage: 'ENGLISH' });
    }
  });

  it('returns each concurrent write and leaves one ordinary last-committed value', async () => {
    const [russian, thai] = await Promise.all([
      patchPreference(tokens.owner, 'RUSSIAN'),
      patchPreference(tokens.owner, 'THAI'),
    ]);
    expect(russian.statusCode).toBe(200);
    expect(thai.statusCode).toBe(200);
    expect(russian.json()).toEqual({ preferredLanguage: 'RUSSIAN' });
    expect(thai.json()).toEqual({ preferredLanguage: 'THAI' });
    const persisted = await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { preferredLanguage: true },
    });
    expect((await getPreference(tokens.owner)).json()).toEqual(persisted);
  });

  it('authenticates before query, media-type and duplicate-key JSON validation', async () => {
    const before = await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { preferredLanguage: true },
    });
    const unknown = randomBytes(32).toString('base64url');
    for (const headers of [
      { 'content-type': 'application/json' },
      { ...authorization('invalid'), 'content-type': 'application/json' },
      { ...authorization(unknown), 'content-type': 'application/json' },
      { ...authorization(tokens.expired), 'content-type': 'application/json' },
      { ...authorization(tokens.revoked), 'content-type': 'application/json' },
    ]) {
      const response = await app.inject({ method: 'PATCH', url: '/me/language?target=other', headers, payload: '{' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const unsupportedWithoutAuth = await app.inject({
      method: 'PATCH', url: '/me/language', headers: { 'content-type': 'application/xml' }, payload: '<language>THAI</language>',
    });
    expect(unsupportedWithoutAuth.statusCode).toBe(401);

    for (const method of ['GET', 'PATCH'] as const) {
      const response = await app.inject({
        method,
        url: '/me/language?target=other&target=owner',
        headers: { ...authorization(tokens.owner), ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'PATCH' ? { payload: JSON.stringify({ preferredLanguage: 'THAI' }) } : {}),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    const duplicate = await app.inject({
      method: 'PATCH', url: '/me/language',
      headers: { ...authorization(tokens.owner), 'content-type': 'application/json' },
      payload: '{"preferredLanguage":"RUSSIAN","preferredLanguage":"THAI"}',
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json()).toEqual({ error: 'Bad Request' });
    expect(await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { preferredLanguage: true },
    })).toEqual(before);
  });

  it('rejects invalid bodies, GET bodies and unsupported media without mutation', async () => {
    await patchPreference(tokens.owner, 'ENGLISH');
    for (const payload of [
      '{}', 'null', '[]',
      '{"preferredLanguage":null}',
      '{"preferredLanguage":1}',
      '{"preferredLanguage":"english"}',
      '{"preferredLanguage":"FRENCH"}',
      '{"preferredLanguage":"THAI","userId":"550e8400-e29b-41d4-a716-446655440000"}',
      '{',
    ]) {
      const response = await app.inject({
        method: 'PATCH', url: '/me/language',
        headers: { ...authorization(tokens.owner), 'content-type': 'application/json' }, payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Bad Request' });
    }
    const getWithBody = await app.inject({
      method: 'GET', url: '/me/language',
      headers: { ...authorization(tokens.owner), 'content-type': 'application/json' }, payload: '{}',
    });
    expect(getWithBody.statusCode).toBe(400);
    for (const contentType of ['text/plain', 'application/xml', 'application/json-patch+json']) {
      const response = await app.inject({
        method: 'PATCH', url: '/me/language',
        headers: { ...authorization(tokens.owner), 'content-type': contentType }, payload: '{}',
      });
      expect(response.statusCode).toBe(415);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect((await getPreference(tokens.owner)).json()).toEqual({ preferredLanguage: 'ENGLISH' });
  });

  it('accepts normal JSON charset and derives ownership only from the authenticated session', async () => {
    const response = await app.inject({
      method: 'PATCH', url: '/me/language',
      headers: { ...authorization(tokens.owner), 'content-type': 'application/json; charset=utf-8' },
      payload: JSON.stringify({ preferredLanguage: 'THAI' }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ preferredLanguage: 'THAI' });
    expect((await getPreference(tokens.other)).json()).toEqual({ preferredLanguage: 'ENGLISH' });
  });

  it('sanitizes injected database failures and leaves persisted state unchanged', async () => {
    await patchPreference(tokens.owner, 'RUSSIAN');
    const update = vi.spyOn(database.user, 'update').mockRejectedValueOnce(new Error('secret language update failure'));
    const failedPatch = await patchPreference(tokens.owner, 'THAI');
    update.mockRestore();
    expect(failedPatch.statusCode).toBe(500);
    expect(failedPatch.json()).toEqual({ error: 'Internal Server Error' });
    expect(failedPatch.body).not.toContain('secret language update failure');
    expect((await getPreference(tokens.owner)).json()).toEqual({ preferredLanguage: 'RUSSIAN' });

    const find = vi.spyOn(database.user, 'findUniqueOrThrow').mockRejectedValueOnce(new Error('secret language read failure'));
    const failedGet = await getPreference(tokens.owner);
    find.mockRestore();
    expect(failedGet.statusCode).toBe(500);
    expect(failedGet.json()).toEqual({ error: 'Internal Server Error' });
    expect(failedGet.body).not.toContain('secret language read failure');
    expect((await database.user.findUniqueOrThrow({
      where: { id: userIds.owner }, select: { preferredLanguage: true },
    })).preferredLanguage).toBe('RUSSIAN');
  });
});
