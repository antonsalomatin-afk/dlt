import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabaseClient } from '../packages/database/src/index.ts';
import { createApi, loginSchema, userSchema } from '../apps/api/src/index.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for integration tests');
const database = createDatabaseClient(url);
const botToken = 'synthetic-api-test-token';
let clock = new Date('2026-09-09T12:00:00Z');
const app = createApi({ database, botToken, now: () => clock });
const ids: bigint[] = [];
function nextId() { const id = BigInt(`0x${randomBytes(6).toString('hex')}`); ids.push(id); return id; }
function signed(id: bigint, firstName = 'Synthetic', username: string | null = 'test_user') {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(clock.getTime() / 1000)), user: JSON.stringify({ id: Number(id), first_name: firstName, username: username ?? undefined }) });
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  fields.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return fields.toString();
}
const login = (initData: string) => app.inject({ method: 'POST', url: '/auth/telegram', payload: { initData } });
const me = (token: string) => app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
beforeAll(async () => { await database.$connect(); });
afterAll(async () => {
  await app.close();
  try { await database.user.deleteMany({ where: { telegramUserId: { in: ids } } }); }
  finally { await database.$disconnect(); }
});

it('creates one user across concurrent first logins, stores only digests, preserves preference and refreshes profile', async () => {
  const id = nextId();
  const responses = await Promise.all(Array.from({ length: 4 }, () => login(signed(id))));
  const bodies = responses.map((response) => { expect(response.statusCode).toBe(200); return loginSchema.parse(response.json()); });
  const first = bodies[0];
  if (!first) throw new Error('No login response');
  expect(new Set(bodies.map((body) => body.token)).size).toBe(4);
  expect(new Set(bodies.map((body) => body.user.id)).size).toBe(1);
  expect(first.user).toEqual({ id: first.user.id, username: 'test_user', firstName: 'Synthetic', selectedVehicleType: null });
  expect(first.expiresAt).toBe('2026-09-10T12:00:00.000Z');
  expect(await database.user.count({ where: { telegramUserId: id } })).toBe(1);
  const sessions = await database.session.findMany({ where: { userId: first.user.id } });
  expect(sessions).toHaveLength(4);
  for (const body of bodies) {
    expect(sessions.some((session) => session.tokenHash === createHash('sha256').update(body.token).digest('hex'))).toBe(true);
    expect(JSON.stringify(sessions)).not.toContain(body.token);
    expect(userSchema.parse((await me(body.token)).json())).toEqual(first.user);
  }
  expect(Object.keys(sessions[0] ?? {}).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'tokenHash', 'userId']);
  await database.user.update({ where: { id: first.user.id }, data: { selectedVehicleType: 'MOTORCYCLE' } });
  clock = new Date('2026-09-09T12:01:00Z');
  const repeated = loginSchema.parse((await login(signed(id, 'Updated', null))).json());
  expect(repeated.user).toEqual({ ...first.user, username: null, firstName: 'Updated', selectedVehicleType: 'MOTORCYCLE' });
  expect((await database.user.findUniqueOrThrow({ where: { id: first.user.id } })).lastSeenAt).toEqual(clock);
  clock = new Date('2026-09-10T11:59:59.999Z');
  expect((await me(first.token)).statusCode).toBe(200);
  clock = new Date(first.expiresAt);
  expect((await me(first.token)).statusCode).toBe(401);
  clock = new Date('2026-09-09T12:00:00Z');
});

it('rejects invalid bodies and signatures without writes or credential leakage', async () => {
  const id = nextId();
  const data = signed(id);
  const before = await database.session.count();
  for (const payload of [{}, { initData: data, extra: true }, { initData: 1 }, { initData: 'x'.repeat(16385) }, { initData: data.replace('Synthetic', 'Forged') }, { initData: '' }]) {
    const response = await app.inject({ method: 'POST', url: '/auth/telegram', payload });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
    expect(response.body).not.toContain(botToken);
  }
  const malformed = await app.inject({ method: 'POST', url: '/auth/telegram', headers: { 'content-type': 'application/json' }, payload: '{' });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toEqual({ error: 'Bad Request' });
  expect(await database.user.count({ where: { telegramUserId: id } })).toBe(0);
  expect(await database.session.count()).toBe(before);
});

it('uses one unauthorized shape for missing, malformed, unknown, revoked and expired sessions', async () => {
  for (const authorization of [undefined, '', 'Basic abc', 'Bearer short', `Bearer ${'!'.repeat(43)}`, `Bearer ${randomBytes(32).toString('base64url')}`]) {
    const response = await app.inject({ method: 'GET', url: '/me', headers: authorization === undefined ? {} : { authorization } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
  }
  const body = loginSchema.parse((await login(signed(nextId()))).json());
  await database.session.deleteMany({ where: { userId: body.user.id } });
  expect((await me(body.token)).json()).toEqual({ error: 'Unauthorized' });
});

it('rolls back user creation and profile changes when the session database write fails', async () => {
  const existingId = nextId();
  const existingLogin = loginSchema.parse((await login(signed(existingId))).json());
  const existingUser = await database.user.findUniqueOrThrow({ where: { telegramUserId: existingId } });
  const existingSessions = await database.session.findMany({ where: { userId: existingUser.id } });
  // Fail the real session insert after the real user upsert, using its expiry constraint.
  const originalTransaction = database.$transaction.bind(database);
  const transaction = vi.spyOn(database, '$transaction');
  transaction.mockImplementation(async (fn) => originalTransaction(async (tx) => {
    const create = tx.session.create.bind(tx.session);
    vi.spyOn(tx.session, 'create').mockImplementation((args) => create({ ...args, data: { ...args.data, expiresAt: args.data.createdAt ?? clock } }));
    return fn(tx);
  }));
  const id = nextId();
  try {
    const response = await login(signed(id));
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(await database.user.count({ where: { telegramUserId: id } })).toBe(0);
    clock = new Date('2026-09-09T12:02:00Z');
    const repeated = await login(signed(existingId, 'Must roll back', null));
    expect(repeated.statusCode).toBe(500);
    expect(repeated.json()).toEqual({ error: 'Internal Server Error' });
    expect(await database.user.findUniqueOrThrow({ where: { telegramUserId: existingId } })).toEqual(existingUser);
    expect(await database.session.findMany({ where: { userId: existingUser.id } })).toEqual(existingSessions);
    expect((await me(existingLogin.token)).statusCode).toBe(200);
  } finally { transaction.mockRestore(); clock = new Date('2026-09-09T12:00:00Z'); }
});
