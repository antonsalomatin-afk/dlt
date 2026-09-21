import { expect, test, type Page } from '@playwright/test';

const token = 'h'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const uuid = (group: number, item: number) => `c50e8400-e29b-41d4-a716-${String(group).padStart(6, '0')}${String(item).padStart(6, '0')}`;
const startedAt = (hoursAgo: number) => new Date(Date.UTC(2026, 8, 20, 12 - hoursAgo)).toISOString();
const expiresAfter = (value: string) => new Date(Date.parse(value) + 3_600_000).toISOString();
const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
function examItem(index: number, status: 'COMPLETED' | 'IN_PROGRESS' | 'EXPIRED', overrides: Record<string, unknown> = {}) {
  const started = startedAt(index);
  const completed = status === 'COMPLETED';
  return {
    examId: uuid(1, index), vehicleType: 'CAR', status, questionCount: 50, passingScore: 45, answeredCount: completed ? 50 : 7,
    startedAt: started, expiresAt: expiresAfter(started), completedAt: completed ? expiresAfter(started) : null,
    score: completed ? 46 : null, passed: completed ? true : null, ...overrides,
  };
}
const questions = Array.from({ length: 50 }, (_, index) => ({
  examQuestionId: uuid(2, index + 1), position: index + 1,
  question: {
    id: uuid(3, index + 1), textThai: null, textExamEnglish: null, textEnglish: `Reviewed question ${index + 1}`, textRussian: index === 0 ? 'Вопрос обзора 1' : null,
    choices: ['A', 'B', 'C', 'D'].map((key, choiceIndex) => ({ id: uuid(10 + index, choiceIndex + 1), key, textThai: null, textEnglish: `Choice ${key} of ${index + 1}`, textRussian: null })),
  },
}));
function reviewPayload(examId: string) {
  const started = startedAt(1);
  return {
    examId, vehicleType: 'CAR', questionCount: 50, answeredCount: 48, unansweredCount: 2, score: 46, passingScore: 45, passed: true,
    startedAt: started, expiresAt: expiresAfter(started), completedAt: expiresAfter(started),
    questions: questions.map((item, index) => ({
      examQuestionId: item.examQuestionId, position: item.position, question: item.question,
      selectedChoiceId: index >= 48 ? null : uuid(10 + index, index < 46 ? 1 : 2), correctChoiceId: uuid(10 + index, 1),
      isCorrect: index >= 48 ? null : index < 46, answeredAt: index >= 48 ? null : started,
      explanationThai: null, explanationEnglish: `Rule ${index + 1}`, explanationRussian: null,
      trapExplanationThai: null, trapExplanationEnglish: `Trap ${index + 1}`, trapExplanationRussian: null,
    })),
  };
}
const metric = (page: Page, label: string) => page.locator('.progress-metric').getByText(label, { exact: true }).locator('..');

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"exam-history-test",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle } } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openFromSetup(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await authenticate(page, vehicle);
  await page.getByRole('button', { name: 'Exams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Exam history' })).toBeVisible();
}

test('loads exams with one exact request, renders statuses and results, and opens a review', async ({ page }) => {
  let requests = 0;
  await page.route('**/exam/history**', (route) => {
    requests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(new URL(route.request().url()).search).toBe('?limit=10');
    return route.fulfill({ json: { items: [examItem(1, 'IN_PROGRESS'), examItem(2, 'COMPLETED', { score: 40, passed: false }), examItem(3, 'EXPIRED'), examItem(4, 'COMPLETED')], nextCursor: null } });
  });
  let reviews = 0;
  await page.route(`**/exam/${uuid(1, 4)}/result`, (route) => {
    reviews++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    return route.fulfill({ json: reviewPayload(uuid(1, 4)) });
  });
  await openFromSetup(page, null);
  const items = page.getByRole('list', { name: 'Mock exams' }).getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('In progress');
  await expect(items.nth(0)).toContainText('Answered 7 / 50');
  await expect(items.nth(1)).toContainText('Not passed');
  await expect(items.nth(1)).toContainText('Score 40 / 50');
  await expect(items.nth(2)).toContainText('Expired');
  await expect(items.nth(3)).toContainText('Passed');
  await expect(items.nth(0).getByRole('button', { name: 'Review exam' })).toHaveCount(0);
  await expect(items.nth(2).getByRole('button', { name: 'Review exam' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect(requests).toBe(1);

  await items.nth(3).getByRole('button', { name: 'Review exam' }).click();
  await expect(page.getByRole('heading', { name: 'Exam review' })).toBeVisible();
  await expect(metric(page, 'Score')).toContainText('46 / 50');
  await expect(metric(page, 'Result')).toContainText('Passed');
  await expect(metric(page, 'Unanswered')).toContainText('2');
  const rows = page.locator('.history-entry');
  await expect(rows).toHaveCount(50);
  await expect(rows.nth(0)).toContainText('Correct');
  await expect(rows.nth(46)).toContainText('Incorrect');
  await expect(rows.nth(49)).toContainText('Unanswered');
  await rows.nth(46).locator('summary').click();
  await expect(rows.nth(46).getByText('Your answer')).toBeVisible();
  await expect(rows.nth(46).getByText('Correct answer')).toBeVisible();
  await expect(rows.nth(46)).toContainText('Rule 47');
  await rows.nth(49).locator('summary').click();
  await expect(rows.nth(49).getByText('Your answer')).toHaveCount(0);
  await expect(rows.nth(49).getByText('Correct answer')).toBeVisible();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(rows.nth(0)).toContainText('Вопрос обзора 1');
  expect(reviews).toBe(1);
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  await expect(page.getByRole('heading', { name: 'Exam history' })).toBeVisible();
  await expect(items).toHaveCount(4);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('pages with the exact cursor, retries a failed page with the same cursor, and shows the empty state', async ({ page }) => {
  const cursor = encodeCursor({ v: 1, startedAt: startedAt(1), examId: uuid(1, 1) });
  let requests = 0;
  await page.route('**/exam/history**', (route) => {
    requests++;
    const search = new URL(route.request().url()).search;
    if (requests === 1) { expect(search).toBe('?limit=10'); return route.fulfill({ json: { items: [examItem(1, 'COMPLETED')], nextCursor: cursor } }); }
    expect(search).toBe(`?limit=10&cursor=${encodeURIComponent(cursor)}`);
    if (requests === 2) return route.abort();
    return route.fulfill({ json: { items: [examItem(2, 'COMPLETED')], nextCursor: null } });
  });
  await openFromSetup(page);
  const items = page.getByRole('list', { name: 'Mock exams' }).getByRole('listitem');
  await expect(items).toHaveCount(1);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your exams');
  await expect(items).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry exams' }).click();
  await expect(items).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect(requests).toBe(3);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.unroute('**/exam/history**');
  await page.route('**/exam/history**', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.getByRole('button', { name: 'Exams', exact: true }).click();
  await expect(page.getByText('No mock exams yet')).toBeVisible();
});

const invalidPages = {
  duplicate: { items: [examItem(1, 'COMPLETED'), examItem(1, 'COMPLETED')], nextCursor: null },
  tuple: { items: [examItem(1, 'IN_PROGRESS', { score: 3 })], nextCursor: null },
  pass: { items: [examItem(1, 'COMPLETED', { score: 44, passed: true })], nextCursor: null },
  cursor: { items: [examItem(1, 'COMPLETED')], nextCursor: 'not-a-cursor!' },
  unknown: { items: [{ ...examItem(1, 'COMPLETED'), questions: [] }], nextCursor: null },
} as const;

for (const [name, invalid] of Object.entries(invalidPages)) {
  test(`rejects a ${name} history page and permits retry`, async ({ page }) => {
    let requests = 0;
    await page.route('**/exam/history**', (route) => { requests++; return route.fulfill({ json: requests === 1 ? invalid : { items: [examItem(1, 'COMPLETED')], nextCursor: null } }); });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your exams');
    await expect(page.getByRole('list', { name: 'Mock exams' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry exams' }).click();
    await expect(page.getByRole('list', { name: 'Mock exams' }).getByRole('listitem')).toHaveCount(1);
  });
}

for (const failure of ['transport', 'http', 'malformed', 'identity', 'not-completed'] as const) {
  test(`shows retry guidance for a ${failure} review failure`, async ({ page }) => {
    let reviews = 0;
    await page.route('**/exam/history**', (route) => route.fulfill({ json: { items: [examItem(1, 'COMPLETED')], nextCursor: null } }));
    await page.route(`**/exam/${uuid(1, 1)}/result`, (route) => {
      reviews++;
      if (reviews > 1) return route.fulfill({ json: reviewPayload(uuid(1, 1)) });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'not-completed') return route.fulfill({ status: 409, json: { error: 'Exam not completed' } });
      if (failure === 'identity') return route.fulfill({ json: reviewPayload(uuid(1, 2)) });
      return route.fulfill({ json: { ...reviewPayload(uuid(1, 1)), score: 47 } });
    });
    await openFromSetup(page);
    await page.getByRole('button', { name: 'Review exam' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(failure === 'not-completed' ? 'not finished yet' : 'could not load this exam review');
    await expect(page.locator('.history-entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry review' }).click();
    await expect(metric(page, 'Result')).toContainText('Passed');
    expect(reviews).toBe(2);
  });
}

test('a history 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/exam/history**', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Exams', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('a review 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/exam/history**', (route) => route.fulfill({ json: { items: [examItem(1, 'COMPLETED')], nextCursor: null } }));
  await page.route(`**/exam/${uuid(1, 1)}/result`, (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Review exam' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
});

test('opens from practice and from a finished exam, and returns to the origin', async ({ page }) => {
  let categoryRequests = 0;
  await page.route('**/practice/categories', (route) => { categoryRequests++; return route.fulfill({ json: { categories: [] } }); });
  await page.route('**/exam/history**', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/exam/start', (route) => route.fulfill({ json: {
    examId: uuid(1, 9), vehicleType: 'CAR', questionCount: 50, passingScore: 45, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), questions,
  } }));
  await page.route('**/exam/answer', (route) => {
    const body = route.request().postDataJSON() as { examQuestionId: string; choiceId: string };
    return route.fulfill({ json: { examId: uuid(1, 9), examQuestionId: body.examQuestionId, selectedChoiceId: body.choiceId, answeredAt: new Date().toISOString(), answeredCount: 50, remainingCount: 0 } });
  });
  await page.route('**/exam/complete', (route) => route.fulfill({ json: { examId: uuid(1, 9), questionCount: 50, answeredCount: 50, unansweredCount: 0, score: 45, passingScore: 45, passed: true, completedAt: new Date().toISOString() } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Exams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Exam history' })).toBeVisible();
  await expect(page.getByText('No mock exams yet')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  expect(categoryRequests).toBe(2);

  await page.getByRole('button', { name: 'Mock exam', exact: true }).click();
  await page.getByRole('button', { name: 'Start exam' }).click();
  await page.getByRole('radio', { name: 'A. Choice A of 1' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.getByRole('button', { name: 'Finish exam' }).click();
  await expect(page.getByRole('heading', { name: 'Exam complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Review in exam history' }).click();
  await expect(page.getByRole('heading', { name: 'Exam history' })).toBeVisible();
  await expect(page.getByText('No mock exams yet')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
});

test('leaving exam history is immediate and ignores a delayed response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false;
  await page.route('**/exam/history**', async (route) => {
    await gate;
    try { await route.fulfill({ json: { items: [examItem(1, 'COMPLETED')], nextCursor: null } }); } catch { /* detached */ }
    completed = true;
  });
  await openFromSetup(page);
  await expect(page.getByRole('status')).toContainText('Loading your exams');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await expect.poll(() => completed).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Mock exams' })).toHaveCount(0);
});
