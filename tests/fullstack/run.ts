import { createHmac, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium, devices, expect, type Browser } from '@playwright/test';
import pg from 'pg';
import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { presentationResponseSchema } from '../../packages/database/src/presentation.ts';
import { answerResponseSchema } from '../../packages/database/src/answer.ts';
import { parseDatabaseUrl } from '../../tools/database/config.ts';
import { assertPortFree, cleanupAll, databaseIdentifier, startNode } from './lifecycle.ts';

const webOrigin = 'http://127.0.0.1:3100';
const apiOrigin = 'http://127.0.0.1:3101';
const children: ReturnType<typeof startNode>[] = [];
let browser: Browser | undefined;
let admin: pg.Client | undefined;
let db: ReturnType<typeof createDatabaseClient> | undefined;
let created = false;
let phase = 'configuration';
const name = `fullstack_test_${randomBytes(12).toString('hex')}`;
const identifier = databaseIdentifier(name);

try {
  parseDatabaseUrl(process.env.DATABASE_URL);
  const isolated = new URL(process.env.DATABASE_URL ?? '');
  isolated.pathname = `/${name}`;
  await assertPortFree(3100);
  await assertPortFree(3101);
  // Neither real nor synthetic server credentials reach the web child environment.
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.BOT_TOKEN;
  const botToken = `synthetic:${randomBytes(32).toString('hex')}`;
  const apiEnv = { ...env, DATABASE_URL: isolated.toString(), BOT_TOKEN: botToken, API_PORT: '3101' };
  const launch = (label: string, args: string[], environment: NodeJS.ProcessEnv, cwd?: string) => {
    const child = startNode(label, args, environment, cwd);
    children.push(child);
    return child;
  };
  phase = 'isolated database creation';
  admin = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${identifier}`);
  created = true;
  phase = 'migrations';
  await launch('Prisma migrations', ['node_modules/prisma/build/index.js', '--config', 'packages/database/prisma.config.ts', 'migrate', 'deploy'], { ...env, DATABASE_URL: isolated.toString() }).wait(60_000);
  db = createDatabaseClient(isolated.toString());
  const category = await db.category.create({ data: { slug: 'synthetic-fullstack', nameThai: 'Synthetic', nameEnglish: 'Synthetic', nameRussian: 'Synthetic' } });
  const question = await db.question.create({ data: {
    categoryId: category.id, vehicleType: 'CAR', active: true, verificationStatus: 'VERIFIED',
    textEnglish: 'Synthetic test: which action preserves a safe following distance?',
    explanationEnglish: 'Leave enough space to stop safely.', trapExplanationEnglish: 'Speeding up reduces the time available to react.',
    sourceType: 'ORIGINAL', legalCitation: 'Synthetic development citation, not legal guidance', sourceReference: 'Synthetic automated test only', reviewer: 'Test harness', reviewedAt: new Date(),
    choices: { create: (['A', 'B', 'C', 'D'] as const).map((key) => ({ key, textEnglish: key === 'A' ? 'Leave space' : `Unsafe action ${key}`, isCorrect: key === 'A' })) },
  }, include: { choices: true } });
  phase = 'web build';
  console.log('Full-stack: isolated migrations and synthetic seed ready; building web.');
  const next = createRequire(resolve('apps/web/package.json')).resolve('next/dist/bin/next');
  const webEnv = { ...env, API_ORIGIN: apiOrigin };
  await launch('Next build', [next, 'build'], webEnv, resolve('apps/web')).wait(180_000);
  phase = 'service startup';
  const api = launch('API', ['apps/api/src/main.ts'], apiEnv);
  await api.ready(`${apiOrigin}/me`, 401);
  const web = launch('Next server', [next, 'start', '--hostname', '127.0.0.1', '--port', '3100'], webEnv, resolve('apps/web'));
  await web.ready(webOrigin, 200);
  phase = 'browser authentication';
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: webOrigin });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const telegramId = Number(BigInt(`0x${randomBytes(6).toString('hex')}`)) + 1;
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: telegramId, first_name: 'Synthetic browser' }) });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  // This is the only intercepted request. All API traffic crosses real Next rewrites.
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(params.toString())},ready(){}}};` }));
  const responseFor = (path: string) => page.waitForResponse((response) => response.url() === `${webOrigin}${path}` && response.request().method() === 'POST');
  const auth = responseFor('/auth/telegram');
  await page.goto('/');
  expect((await auth).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await page.getByRole('radio', { name: 'Car', exact: true }).check();
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('status')).toContainText('Saved selection: Car');
  const user = await db.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(telegramId) } });
  expect(user.selectedVehicleType).toBe('CAR');
  expect(await db.user.count()).toBe(1);
  expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  await page.getByRole('button', { name: 'Start practice' }).click();
  let nextResponse = responseFor('/practice/next');
  await page.getByRole('button', { name: 'Get a question' }).click();
  const presentations: string[] = [];
  for (const correct of [true, false]) {
    phase = correct ? 'correct answer assertions' : 'incorrect answer assertions';
    const response = await nextResponse;
    expect(response.status()).toBe(200);
    const presented = presentationResponseSchema.parse(await response.json());
    presentations.push(presented.presentationId);
    expect(presented.question.id).toBe(question.id);
    const owned = await db.questionPresentation.findUniqueOrThrow({ where: { id: presented.presentationId } });
    expect(owned.userId).toBe(user.id);
    await expect(page.getByText(question.explanationEnglish ?? '', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Answer choices' }).getByRole('radio')).toHaveCount(4);
    const choice = question.choices.find((item) => item.key === (correct ? 'A' : 'B'));
    if (!choice) throw new Error('Missing synthetic choice');
    await page.getByRole('radio', { name: choice.textEnglish, exact: false }).check();
    const answer = responseFor('/practice/answer');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    const answerResponse = await answer;
    expect(answerResponse.status()).toBe(200);
    const scored = answerResponseSchema.parse(await answerResponse.json());
    expect(scored).toMatchObject({ presentationId: presented.presentationId, selectedChoiceId: choice.id, isCorrect: correct, explanationEnglish: question.explanationEnglish });
    await expect(page.getByRole('region', { name: 'Answer result' }).getByRole('heading', { name: correct ? 'Correct' : 'Incorrect', exact: true })).toBeVisible();
    await expect(page.getByText('Leave enough space to stop safely.', { exact: true })).toBeVisible();
    const answers = await db.answerAttempt.findMany({ where: { presentationId: presented.presentationId } });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ selectedChoiceId: choice.id, isCorrect: correct });
    await mkdir('test-results/fullstack', { recursive: true });
    await page.screenshot({ path: `test-results/fullstack/${correct ? 'correct' : 'incorrect'}-mobile.png`, fullPage: true });
    nextResponse = responseFor('/practice/next');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  }
  const continued = presentationResponseSchema.parse(await (await nextResponse).json());
  expect(presentations).not.toContain(continued.presentationId);
  expect(new Set(presentations).size).toBe(2);
  expect(await db.questionPresentation.count({ where: { userId: user.id } })).toBe(3);
  expect(await db.answerAttempt.count()).toBe(2);
  expect(await db.answerAttempt.count({ where: { presentationId: continued.presentationId } })).toBe(0);
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  console.log('Full-stack: real authentication, vehicle preference, correct/incorrect scores and continuation passed.');
} catch {
  // Never print raw errors: browser/ORM exceptions can embed auth or database values.
  console.error(`Full-stack failed during ${phase}. Check local PostgreSQL, free ports, installed Chromium and required gates.`);
  process.exitCode = 1;
} finally {
  try {
    await cleanupAll([
      async () => { await browser?.close(); },
      ...[...children].reverse().map((child) => () => child.stop()),
      async () => { await db?.$disconnect(); },
      async () => { if (created) await admin?.query(`DROP DATABASE ${identifier}`); },
      async () => { await admin?.end(); },
    ]);
    console.log('Full-stack: owned processes, clients and isolated database cleaned up.');
  } catch {
    console.error(`Full-stack cleanup failed for owned database ${name}; inspect before rerunning.`);
    process.exitCode = 1;
  }
}
