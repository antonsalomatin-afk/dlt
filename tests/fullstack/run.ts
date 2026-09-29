import { createHmac, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium, devices, expect, type Browser } from '@playwright/test';
import pg from 'pg';
import { createDatabaseClient } from '../../packages/database/src/index.ts';
import { answerResponseSchema } from '../../packages/database/src/answer.ts';
import {
  examAnswerResponseSchema,
  examCompleteResponseSchema,
  examReviewResponseSchema,
  examStartResponseSchema,
} from '../../packages/database/src/exam.ts';
import { examHistoryResponseSchema } from '../../packages/database/src/exam-history.ts';
import { parsePresentationSnapshot, presentationResponseSchema } from '../../packages/database/src/presentation.ts';
import { parseDatabaseUrl } from '../../tools/database/config.ts';
import { assertPortFree, cleanupAll, databaseIdentifier, startNode } from './lifecycle.ts';

const webOrigin = 'http://127.0.0.1:3100';
const apiOrigin = 'http://127.0.0.1:3101';
const wrongPositions = new Set([10, 20, 30, 40, 50]);
const hiddenExamKeys = [
  'correctChoiceId',
  'isCorrect',
  'explanationThai',
  'explanationEnglish',
  'explanationRussian',
  'trapExplanationThai',
  'trapExplanationEnglish',
  'trapExplanationRussian',
  'score',
  'passed',
] as const;
const children: ReturnType<typeof startNode>[] = [];
let browser: Browser | undefined;
let admin: pg.Client | undefined;
let db: ReturnType<typeof createDatabaseClient> | undefined;
let created = false;
let phase = 'configuration';
const name = `fullstack_test_${randomBytes(12).toString('hex')}`;
const identifier = databaseIdentifier(name);

function expectNoEarlyExamResult(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const key of hiddenExamKeys) expect(serialized).not.toContain(`"${key}"`);
}

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
  const client = createDatabaseClient(isolated.toString());
  db = client;
  const category = await client.category.create({
    data: {
      slug: 'synthetic-fullstack',
      nameThai: 'หมวดหมู่สังเคราะห์',
      nameEnglish: 'Synthetic full-stack',
      nameRussian: 'Синтетическая категория',
    },
  });
  const seededQuestions = await client.$transaction(Array.from({ length: 50 }, (_, index) => {
    const number = index + 1;
    return client.question.create({
      data: {
        categoryId: category.id,
        vehicleType: 'CAR',
        active: true,
        verificationStatus: 'VERIFIED',
        textThai: `คำถามทดสอบสังเคราะห์ ${number}: เลือกตัวเลือกที่ปลอดภัย`,
        textExamEnglish: `Synthetic formal exam wording ${number}`,
        textEnglish: `Synthetic exam question ${number}: choose the safe option.`,
        textRussian: `Синтетический вопрос ${number}: выберите безопасный вариант.`,
        explanationThai: `คำอธิบายสังเคราะห์ ${number}: ตัวเลือก A ปลอดภัย`,
        explanationEnglish: `Synthetic explanation ${number}: choice A is safe.`,
        explanationRussian: `Синтетическое объяснение ${number}: вариант A безопасен.`,
        trapExplanationThai: `ข้อควรระวังสังเคราะห์ ${number}: ตัวเลือกอื่นไม่ปลอดภัย`,
        trapExplanationEnglish: `Synthetic trap ${number}: the other choices are unsafe.`,
        trapExplanationRussian: `Синтетическая ловушка ${number}: остальные варианты небезопасны.`,
        sourceType: 'ORIGINAL',
        sourceReference: `Synthetic automated test question ${number}`,
        reviewer: 'Test harness',
        reviewedAt: new Date(),
        choices: {
          create: (['A', 'B', 'C', 'D'] as const).map((key) => ({
            key,
            textThai: `ตัวเลือกสังเคราะห์ ${key} สำหรับข้อ ${number}`,
            textEnglish: `Synthetic choice ${key} for question ${number}`,
            textRussian: `Синтетический вариант ${key} для вопроса ${number}`,
            isCorrect: key === 'A',
          })),
        },
      },
      include: { choices: true },
    });
  }));
  expect(await client.question.count()).toBe(50);
  expect(await client.questionChoice.count()).toBe(200);
  const seededById = new Map(seededQuestions.map((question) => [question.id, question]));
  phase = 'web build';
  console.log('Full-stack: isolated migrations and 50-question synthetic seed ready; building web.');
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
  const responseFor = (path: string, method: 'GET' | 'POST' = 'POST') => page.waitForResponse(
    (response) => response.url() === `${webOrigin}${path}` && response.request().method() === method,
  );
  const auth = responseFor('/auth/telegram');
  await page.goto('/');
  expect((await auth).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await page.getByRole('radio', { name: 'Car', exact: true }).check();
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('status')).toContainText('Saved selection: Car');
  const user = await client.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(telegramId) } });
  expect(user.selectedVehicleType).toBe('CAR');
  expect(await client.user.count()).toBe(1);
  expect(await client.session.count({ where: { userId: user.id } })).toBe(1);

  phase = 'practice regression assertions';
  await page.getByRole('button', { name: 'Start practice' }).click();
  let nextResponse = responseFor('/practice/next');
  await page.getByRole('button', { name: 'Get a question' }).click();
  const presentations: string[] = [];
  for (const correct of [true, false]) {
    const response = await nextResponse;
    expect(response.status()).toBe(200);
    const presented = presentationResponseSchema.parse(await response.json());
    presentations.push(presented.presentationId);
    const seeded = seededById.get(presented.question.id);
    if (!seeded) throw new Error('Practice returned a non-synthetic question');
    const owned = await client.questionPresentation.findUniqueOrThrow({ where: { id: presented.presentationId } });
    expect(owned.userId).toBe(user.id);
    await expect(page.getByText(seeded.explanationEnglish ?? '', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Answer choices' }).getByRole('radio')).toHaveCount(4);
    const choice = seeded.choices.find((item) => item.key === (correct ? 'A' : 'B'));
    if (!choice) throw new Error('Missing synthetic practice choice');
    await page.getByRole('radio', { name: choice.textEnglish, exact: false }).check();
    const answer = responseFor('/practice/answer');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    const answerResponse = await answer;
    expect(answerResponse.status()).toBe(200);
    const scored = answerResponseSchema.parse(await answerResponse.json());
    expect(scored).toMatchObject({
      presentationId: presented.presentationId,
      selectedChoiceId: choice.id,
      isCorrect: correct,
      explanationEnglish: seeded.explanationEnglish,
    });
    await expect(page.getByRole('region', { name: 'Answer result' }).getByRole('heading', { name: correct ? 'Correct' : 'Incorrect', exact: true })).toBeVisible();
    await expect(page.getByText(seeded.explanationEnglish ?? '', { exact: true })).toBeVisible();
    const answers = await client.answerAttempt.findMany({ where: { presentationId: presented.presentationId } });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ selectedChoiceId: choice.id, isCorrect: correct });
    nextResponse = responseFor('/practice/next');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  }
  const continued = presentationResponseSchema.parse(await (await nextResponse).json());
  expect(presentations).not.toContain(continued.presentationId);
  expect(new Set(presentations).size).toBe(2);
  expect(await client.questionPresentation.count({ where: { userId: user.id } })).toBe(3);
  expect(await client.answerAttempt.count()).toBe(2);
  expect(await client.answerAttempt.count({ where: { presentationId: continued.presentationId } })).toBe(0);
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();

  phase = 'mock exam start assertions';
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await expect(page.getByText('50', { exact: true })).toBeVisible();
  await expect(page.getByText('60 minutes', { exact: true })).toBeVisible();
  await expect(page.getByText('45 / 50', { exact: true })).toBeVisible();
  const startResponse = responseFor('/exam/start');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  const startHttpResponse = await startResponse;
  expect(startHttpResponse.status()).toBe(200);
  const startPayload: unknown = await startHttpResponse.json();
  expectNoEarlyExamResult(startPayload);
  const started = examStartResponseSchema.parse(startPayload);
  expect(started).toMatchObject({ vehicleType: 'CAR', questionCount: 50, passingScore: 45 });
  expect(started.questions.map(({ position }) => position)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  expect(new Set(started.questions.map(({ question }) => question.id)).size).toBe(50);
  await expect(page.getByRole('heading', { name: 'Question 1 of 50' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^\d{2}:\d{2}$/u);
  await expect(page.getByLabel('Exam progress')).toContainText('0 answered');
  await expect(page.getByLabel('Exam progress')).toContainText('50 remaining');
  await expect(page.getByRole('navigation', { name: 'Question navigator' }).getByRole('button')).toHaveCount(50);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });

  phase = 'mock exam answer assertions';
  let completionResponse: ReturnType<typeof responseFor> | undefined;
  for (const examQuestion of started.questions) {
    const seeded = seededById.get(examQuestion.question.id);
    if (!seeded) throw new Error('Exam returned a non-synthetic question');
    expect(examQuestion.question.textEnglish).toBe(seeded.textEnglish);
    await expect(page.getByRole('heading', { name: `Question ${examQuestion.position} of 50` })).toBeVisible();
    await expect(page.getByRole('heading', { name: seeded.textEnglish, exact: true })).toBeVisible();
    await expect(page.getByText(seeded.explanationEnglish ?? '', { exact: true })).toHaveCount(0);
    await expect(page.getByText(seeded.trapExplanationEnglish ?? '', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Correct answer', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Incorrect', { exact: true })).toHaveCount(0);
    const selectedKey = wrongPositions.has(examQuestion.position) ? 'B' : 'A';
    const choice = seeded.choices.find((item) => item.key === selectedKey);
    if (!choice) throw new Error('Missing synthetic exam choice');
    await page.getByRole('radio', { name: choice.textEnglish, exact: false }).check();
    const answerResponse = responseFor('/exam/answer');
    if (examQuestion.position === 50) completionResponse = responseFor('/exam/complete');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    const answerHttpResponse = await answerResponse;
    expect(answerHttpResponse.status()).toBe(200);
    const answerPayload: unknown = await answerHttpResponse.json();
    expectNoEarlyExamResult(answerPayload);
    const saved = examAnswerResponseSchema.parse(answerPayload);
    expect(saved).toMatchObject({
      examId: started.examId,
      examQuestionId: examQuestion.examQuestionId,
      selectedChoiceId: choice.id,
      answeredCount: examQuestion.position,
      remainingCount: 50 - examQuestion.position,
    });
    if (examQuestion.position < 50) {
      await expect(page.getByRole('heading', { name: `Question ${examQuestion.position + 1} of 50` })).toBeVisible();
      await expect(page.getByLabel('Exam progress')).toContainText(`${examQuestion.position} answered`);
      await expect(page.getByLabel('Exam progress')).toContainText(`${50 - examQuestion.position} remaining`);
      if (examQuestion.position % 10 === 0) {
        await page.getByRole('button', { name: `Question ${examQuestion.position}, answered` }).click();
        await expect(page.getByRole('radio', { name: choice.textEnglish, exact: false })).toBeChecked();
        await expect(page.getByRole('radio', { name: choice.textEnglish, exact: false })).toBeDisabled();
        await expect(page.getByText('Answer saved. This question is read-only.')).toBeVisible();
        await page.getByRole('button', { name: `Question ${examQuestion.position + 1}, unanswered` }).click();
      }
    }
  }
  if (!completionResponse) throw new Error('Final exam answer did not schedule completion');
  const completionHttpResponse = await completionResponse;
  expect(completionHttpResponse.status()).toBe(200);
  const completion = examCompleteResponseSchema.parse(await completionHttpResponse.json());
  expect(completion).toEqual(expect.objectContaining({
    examId: started.examId,
    questionCount: 50,
    answeredCount: 50,
    unansweredCount: 0,
    score: 45,
    passingScore: 45,
    passed: true,
  }));
  await expect(page.locator('.exam-result')).toContainText('Passed');
  await expect(page.locator('.exam-result')).toContainText('45 / 50');
  await expect(page.locator('.exam-result')).toContainText('Answered50');
  await expect(page.locator('.exam-result')).toContainText('Unanswered0');
  await mkdir('test-results/fullstack', { recursive: true });
  await page.screenshot({ path: 'test-results/fullstack/mock-exam-result-mobile.png', fullPage: true });

  phase = 'mock exam review assertions';
  const reviewResponse = responseFor(`/exam/${started.examId}/review`, 'GET');
  await page.getByRole('button', { name: 'Review exam mistakes' }).click();
  const reviewHttpResponse = await reviewResponse;
  expect(reviewHttpResponse.status()).toBe(200);
  const review = examReviewResponseSchema.parse(await reviewHttpResponse.json());
  expect(review).toMatchObject({ examId: started.examId, questionCount: 50, score: 45, passingScore: 45, passed: true });
  expect(review.mistakes.map(({ position }) => position)).toEqual([...wrongPositions]);
  await expect(page.locator('.exam-mistake-card')).toHaveCount(5);
  for (const [index, mistake] of review.mistakes.entries()) {
    const startedQuestion = started.questions[mistake.position - 1];
    if (!startedQuestion) throw new Error('Review returned an invalid mistake position');
    const seeded = seededById.get(startedQuestion.question.id);
    if (!seeded) throw new Error('Review returned a non-synthetic question');
    const correct = seeded.choices.find(({ key }) => key === 'A');
    const selected = seeded.choices.find(({ key }) => key === 'B');
    if (!correct || !selected) throw new Error('Review choices are incomplete');
    expect(mistake).toMatchObject({
      examQuestionId: startedQuestion.examQuestionId,
      position: startedQuestion.position,
      selectedChoiceId: selected.id,
      correctChoiceId: correct.id,
      question: startedQuestion.question,
      explanationEnglish: seeded.explanationEnglish,
      trapExplanationEnglish: seeded.trapExplanationEnglish,
    });
    const card = page.locator('.exam-mistake-card').nth(index);
    await expect(card).toContainText(`Question ${mistake.position}`);
    await expect(card.getByRole('heading', { name: seeded.textEnglish, exact: true })).toBeVisible();
    await expect(card.locator('.history-choices li.selected')).toContainText(`B. ${selected.textEnglish}`);
    await expect(card.locator('.history-choices li.selected')).toContainText('Your answer');
    await expect(card.locator('.history-choices li.correct')).toContainText(`A. ${correct.textEnglish}`);
    await expect(card.locator('.history-choices li.correct')).toContainText('Correct answer');
    await expect(card.getByText(seeded.explanationEnglish ?? '', { exact: true })).toBeVisible();
    await expect(card.getByText(seeded.trapExplanationEnglish ?? '', { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/fullstack/mock-exam-review-mobile.png', fullPage: true });

  phase = 'mock exam history assertions';
  const historyResponse = responseFor('/exam/history?limit=10', 'GET');
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  const historyHttpResponse = await historyResponse;
  expect(historyHttpResponse.status()).toBe(200);
  const history = examHistoryResponseSchema.parse(await historyHttpResponse.json());
  expect(history).toEqual({
    items: [expect.objectContaining({
      examId: started.examId,
      vehicleType: 'CAR',
      questionCount: 50,
      answeredCount: 50,
      unansweredCount: 0,
      score: 45,
      passingScore: 45,
      passed: true,
    })],
    nextCursor: null,
  });
  const historyEntry = page.locator('.exam-history-entry');
  await expect(historyEntry).toHaveCount(1);
  await expect(historyEntry).toContainText('Passed');
  await expect(historyEntry).toContainText('45 / 50');
  await expect(historyEntry).toContainText('Answered50');
  await expect(historyEntry).toContainText('Unanswered0');
  await expect(historyEntry).toContainText('Car');
  await page.screenshot({ path: 'test-results/fullstack/mock-exam-history-mobile.png', fullPage: true });

  phase = 'mock exam database assertions';
  const sessions = await client.examSession.findMany({
    where: { userId: user.id },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
  expect(sessions).toHaveLength(1);
  const session = sessions[0];
  if (!session) throw new Error('Owned exam session is missing');
  expect(session).toMatchObject({
    id: started.examId,
    userId: user.id,
    vehicleType: 'CAR',
    questionCount: 50,
    passingScore: 45,
    score: 45,
    passed: true,
  });
  expect(session.completedAt).not.toBeNull();
  expect(session.questions).toHaveLength(50);
  expect(session.questions.map(({ position }) => position)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  expect(new Set(session.questions.map(({ id }) => id)).size).toBe(50);
  expect(new Set(session.questions.map(({ questionId }) => questionId)).size).toBe(50);
  expect(session.questions.filter(({ isCorrect }) => isCorrect === true)).toHaveLength(45);
  expect(session.questions.filter(({ isCorrect }) => isCorrect === false)).toHaveLength(5);
  for (const examQuestion of session.questions) {
    const startedQuestion = started.questions[examQuestion.position - 1];
    const seeded = seededById.get(examQuestion.questionId);
    if (!startedQuestion || !seeded) throw new Error('Persisted exam question is outside the synthetic seed');
    const snapshot = parsePresentationSnapshot(examQuestion.snapshot);
    const expectedKey = wrongPositions.has(examQuestion.position) ? 'B' : 'A';
    const expectedChoice = seeded.choices.find(({ key }) => key === expectedKey);
    const correctChoice = seeded.choices.find(({ key }) => key === 'A');
    if (!expectedChoice || !correctChoice) throw new Error('Persisted exam choices are incomplete');
    expect(examQuestion.id).toBe(startedQuestion.examQuestionId);
    expect(examQuestion.questionId).toBe(startedQuestion.question.id);
    expect(snapshot.question).toEqual(startedQuestion.question);
    expect(snapshot).toMatchObject({
      correctChoiceId: correctChoice.id,
      explanationEnglish: seeded.explanationEnglish,
      trapExplanationEnglish: seeded.trapExplanationEnglish,
    });
    expect(examQuestion.selectedChoiceId).toBe(expectedChoice.id);
    expect(examQuestion.isCorrect).toBe(expectedKey === 'A');
    expect(examQuestion.answeredAt).not.toBeNull();
    expect(examQuestion.answeredAt?.getTime()).toBeGreaterThanOrEqual(session.startedAt.getTime());
    expect(examQuestion.answeredAt?.getTime()).toBeLessThanOrEqual(session.completedAt?.getTime() ?? 0);
  }
  expect(review.mistakes.map(({ examQuestionId }) => examQuestionId)).toEqual(
    session.questions.filter(({ isCorrect }) => isCorrect === false).map(({ id }) => id),
  );
  console.log('Full-stack: practice regression, 50-answer mock exam, review, history and database invariants passed.');
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
