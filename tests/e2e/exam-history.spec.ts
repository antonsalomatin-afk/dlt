import { expect, test, type Page } from '@playwright/test';

const token = 'r'.repeat(43);
const uuid = (value: number) => `750e8400-e29b-41d4-a716-${value.toString().padStart(12, '0')}`;
const examIds = [uuid(1), uuid(2), uuid(3)] as const;
const timestamp = (day: number, hour = 8) => `2026-09-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:00:00.000Z`;
const cursor = (startedAt: string, examId: string) => Buffer.from(JSON.stringify({ v: 1, startedAt, examId }), 'utf8').toString('base64url');

function historyItem(index: number, passed: boolean) {
  const score = passed ? 46 : 40;
  return {
    examId: examIds[index - 1]!, vehicleType: index === 2 ? 'MOTORCYCLE' : 'CAR', questionCount: 50,
    answeredCount: index === 2 ? 47 : 50, unansweredCount: index === 2 ? 3 : 0,
    score, passingScore: 45, passed, startedAt: timestamp(20 - index), completedAt: timestamp(20 - index, 9),
  };
}

function question(index: number) {
  return {
    id: uuid(100 + index), textThai: index === 1 ? 'คำถามทบทวน' : null, textExamEnglish: index === 1 ? 'Formal review question' : null,
    textEnglish: `Review question ${index}`, textRussian: index === 1 ? 'Вопрос для разбора' : null,
    choices: ['A', 'B', 'C', 'D'].map((key, choice) => ({
      id: uuid(1_000 + index * 4 + choice), key, textThai: index === 1 ? `ตัวเลือก ${key}` : null,
      textEnglish: `Review choice ${key}-${index}`, textRussian: index === 1 && choice === 0 ? 'Русский вариант A' : null,
    })),
  };
}

function mistake(index: number, unanswered = false) {
  const presented = question(index);
  return {
    examQuestionId: uuid(500 + index), position: index * 3,
    selectedChoiceId: unanswered ? null : presented.choices[0]?.id,
    answeredAt: unanswered ? null : timestamp(19, 8),
    correctChoiceId: presented.choices[2]?.id,
    question: presented,
    explanationThai: index === 1 ? 'คำอธิบาย' : null, explanationEnglish: `Explanation ${index}`, explanationRussian: index === 1 ? 'Объяснение' : null,
    trapExplanationThai: null, trapExplanationEnglish: `Trap ${index}`, trapExplanationRussian: null,
  };
}

const review = (examId = examIds[0]) => ({
  examId, questionCount: 50, score: 48, passingScore: 45, passed: true,
  completedAt: timestamp(19, 9), mistakes: [mistake(1), mistake(2, true)],
});
const perfectReview = (examId = examIds[0]) => ({
  examId, questionCount: 50, score: 50, passingScore: 45, passed: true, completedAt: timestamp(19, 9), mistakes: [],
});

async function authenticate(page: Page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"exam-history-test",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: uuid(900), username: null, firstName: null, selectedVehicleType: 'CAR' } } }));
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openHistory(page: Page) {
  await authenticate(page);
  await page.getByRole('button', { name: 'Exam history' }).click();
}

test('enters from setup and practice and renders pass/fail privacy-safe summaries', async ({ page }) => {
  let requests = 0;
  await page.route('**/exam/history?limit=10', (route) => {
    requests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().url()).not.toContain(token);
    return route.fulfill({ json: { items: [historyItem(1, true), historyItem(2, false)], nextCursor: null } });
  });
  await openHistory(page);
  await expect(page.locator('.exam-history-entry')).toHaveCount(2);
  await expect(page.locator('.exam-history-entry').first()).toContainText('Passed46 / 50');
  await expect(page.locator('.exam-history-entry').nth(1)).toContainText('Not passed40 / 50');
  await expect(page.locator('.exam-history-entry').nth(1)).toContainText('Motorcycle');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Exam history' }).click();
  await expect(page.getByRole('heading', { name: 'Exam history' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  expect(requests).toBe(2);
});

test('shows friendly empty history and returns to setup', async ({ page }) => {
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await openHistory(page);
  await expect(page.getByText('no completed mock exams')).toBeVisible();
  await page.locator('.empty-history').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
});

test('appends two pages once and retries the exact failed cursor', async ({ page }) => {
  const first = historyItem(1, true); const second = historyItem(2, false);
  const nextCursor = cursor(first.startedAt, first.examId);
  let pageRequests = 0;
  await page.route('**/exam/history?limit=10*', (route) => {
    const value = new URL(route.request().url()).searchParams.get('cursor');
    if (value === null) return route.fulfill({ json: { items: [first], nextCursor } });
    expect(value).toBe(nextCursor); pageRequests++;
    return pageRequests === 1 ? route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }) : route.fulfill({ json: { items: [second], nextCursor: null } });
  });
  await openHistory(page);
  await page.getByRole('button', { name: 'Load more exams' }).click();
  await expect(page.locator('.exam-history').getByRole('alert')).toContainText('could not load your exam history');
  await expect(page.locator('.exam-history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry exam history' }).click();
  await expect(page.locator('.exam-history-entry')).toHaveCount(2);
  expect(pageRequests).toBe(2);
});

test('rejects a duplicate across pages and preserves validated history for retry', async ({ page }) => {
  const first = historyItem(1, true); const second = historyItem(2, false);
  const nextCursor = cursor(first.startedAt, first.examId);
  let pageRequests = 0;
  await page.route('**/exam/history?limit=10*', (route) => {
    if (!new URL(route.request().url()).searchParams.has('cursor')) return route.fulfill({ json: { items: [first], nextCursor } });
    pageRequests++;
    return route.fulfill({ json: { items: [pageRequests === 1 ? first : second], nextCursor: null } });
  });
  await openHistory(page);
  await page.getByRole('button', { name: 'Load more exams' }).click();
  await expect(page.locator('.exam-history-entry')).toHaveCount(1);
  await expect(page.locator('.exam-history').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry exam history' }).click();
  await expect(page.locator('.exam-history-entry')).toHaveCount(2);
});

test('renders a perfect review and preserves history when returning', async ({ page }) => {
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem(1, true)], nextCursor: null } }));
  let reviews = 0;
  await page.route(`**/exam/${examIds[0]}/review`, (route) => { reviews++; return route.fulfill({ json: perfectReview() }); });
  await openHistory(page);
  await page.getByRole('button', { name: 'Review mistakes' }).click();
  await expect(page.getByText('Perfect exam')).toBeVisible();
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  await expect(page.locator('.exam-history-entry')).toHaveCount(1);
  expect(reviews).toBe(1);
});

test('renders incorrect and unanswered immutable mistakes with localization', async ({ page }) => {
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem(1, true)], nextCursor: null } }));
  await page.route(`**/exam/${examIds[0]}/review`, (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    const url = new URL(route.request().url());
    expect(url.pathname).toBe(`/exam/${examIds[0]}/review`); expect(url.search).toBe(''); expect(url.href).not.toContain(token);
    return route.fulfill({ json: review() });
  });
  await openHistory(page);
  await page.getByRole('button', { name: 'Review mistakes' }).click();
  await expect(page.locator('.exam-mistake-card')).toHaveCount(2);
  await expect(page.locator('.exam-mistake-card').first()).toContainText('Incorrect');
  await expect(page.locator('.exam-mistake-card').nth(1)).toContainText('Unanswered');
  await expect(page.locator('.exam-mistake-card').first().getByText('Your answer')).toBeVisible();
  await expect(page.locator('.exam-mistake-card').first().getByText('Correct answer')).toBeVisible();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: 'Вопрос для разбора' })).toBeVisible();
  await expect(page.getByText('Русский вариант A')).toBeVisible();
  await expect(page.getByText('Объяснение')).toBeVisible();
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.getByRole('heading', { name: 'คำถามทบทวน' })).toBeVisible();
  await expect(page.getByText('Trap 1')).toBeVisible();
});

test('opens a direct perfect review from an authoritative exam result then loads clean history', async ({ page }) => {
  const startedAt = '2098-01-01T00:00:00.000Z'; const expiresAt = '2098-01-01T01:00:00.000Z';
  const questions = Array.from({ length: 50 }, (_, index) => {
    const presented = question(100 + index);
    return { examQuestionId: uuid(2_000 + index), position: index + 1, selectedChoiceId: presented.choices[0]?.id, answeredAt: `2098-01-01T00:${(index % 50).toString().padStart(2, '0')}:00.000Z`, question: presented };
  });
  await page.route('**/exam/current', (route) => route.fulfill({ json: { examId: examIds[0], vehicleType: 'CAR', questionCount: 50, passingScore: 45, startedAt, expiresAt, serverTime: '2098-01-01T00:50:00.000Z', expired: false, answeredCount: 50, remainingCount: 0, questions } }));
  await page.route('**/exam/complete', (route) => route.fulfill({ json: { examId: examIds[0], questionCount: 50, answeredCount: 50, unansweredCount: 0, score: 50, passingScore: 45, passed: true, completedAt: '2098-01-01T00:50:00.000Z' } }));
  await page.route(`**/exam/${examIds[0]}/review`, (route) => route.fulfill({ json: { ...perfectReview(), completedAt: '2098-01-01T00:50:00.000Z' } }));
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await expect(page.locator('.exam-result')).toBeVisible();
  await page.getByRole('button', { name: 'Review exam mistakes' }).click();
  await expect(page.getByText('Perfect exam')).toBeVisible();
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  await expect(page.getByText('no completed mock exams')).toBeVisible();
});

test('history and review 401 responses clear the in-memory session', async ({ page }) => {
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openHistory(page);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');

  await page.unrouteAll({ behavior: 'wait' });
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"again",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: uuid(900), username: null, firstName: null, selectedVehicleType: 'CAR' } } }));
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem(1, true)], nextCursor: null } }));
  await page.route(`**/exam/${examIds[0]}/review`, (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Exam history' }).click(); await page.getByRole('button', { name: 'Review mistakes' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
});

test('review 404 and not-completed 409 show stable non-destructive states', async ({ page }) => {
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem(1, true), historyItem(2, false)], nextCursor: null } }));
  await page.route(`**/exam/${examIds[0]}/review`, (route) => route.fulfill({ status: 404, json: { error: 'Exam not found' } }));
  await page.route(`**/exam/${examIds[1]}/review`, (route) => route.fulfill({ status: 409, json: { error: 'Exam not completed' } }));
  await openHistory(page);
  await page.getByRole('button', { name: 'Review mistakes' }).first().click();
  await expect(page.locator('.exam-history').getByRole('alert')).toContainText('exam is unavailable');
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  await page.getByRole('button', { name: 'Review mistakes' }).nth(1).click();
  await expect(page.locator('.exam-history').getByRole('alert')).toContainText('not completed yet');
});

for (const target of ['history', 'review'] as const) {
  test(`retries a malformed ${target} response without partial content`, async ({ page }) => {
    let requests = 0;
    await page.route('**/exam/history?limit=10', (route) => {
      if (target === 'review') return route.fulfill({ json: { items: [historyItem(1, true)], nextCursor: null } });
      requests++;
      return route.fulfill({ json: requests === 1 ? { items: [{ ...historyItem(1, true), userId: uuid(999) }], nextCursor: null } : { items: [], nextCursor: null } });
    });
    if (target === 'review') await page.route(`**/exam/${examIds[0]}/review`, (route) => { requests++; return route.fulfill({ json: requests === 1 ? { ...review(), userId: uuid(999) } : review() }); });
    await openHistory(page);
    if (target === 'review') await page.getByRole('button', { name: 'Review mistakes' }).click();
    await expect(page.locator('.exam-history').getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: target === 'history' ? 'Retry exam history' : 'Retry review' }).click();
    if (target === 'history') await expect(page.getByText('no completed mock exams')).toBeVisible();
    else await expect(page.locator('.exam-mistake-card')).toHaveCount(2);
  });
}

test('leaving pending history is immediate and ignores a late 401', async ({ page }) => {
  let release: (() => void) | undefined; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/exam/history?limit=10', async (route) => { await gate; return route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await authenticate(page); await page.getByRole('button', { name: 'Exam history' }).click();
  await expect(page.getByRole('status')).toContainText('Loading your exam history');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  release?.();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Exam history' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('back from a pending review preserves history and ignores its late 401', async ({ page }) => {
  let release: (() => void) | undefined; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem(1, true)], nextCursor: null } }));
  await page.route(`**/exam/${examIds[0]}/review`, async (route) => { await gate; return route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openHistory(page); await page.getByRole('button', { name: 'Review mistakes' }).click();
  await page.getByRole('button', { name: 'Back to exam history' }).click(); release?.();
  await expect(page.locator('.exam-history-entry')).toHaveCount(1);
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});
