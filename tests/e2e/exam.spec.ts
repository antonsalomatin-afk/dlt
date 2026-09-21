import { expect, test, type Page } from '@playwright/test';

const token = 'e'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const examId = 'a50e8400-e29b-41d4-a716-000000000001';
const uuid = (group: number, item: number) => `b50e8400-e29b-41d4-a716-${String(group).padStart(6, '0')}${String(item).padStart(6, '0')}`;
const questions = Array.from({ length: 50 }, (_, index) => ({
  examQuestionId: uuid(1, index + 1), position: index + 1,
  question: {
    id: uuid(2, index + 1), textThai: `คำถาม ${index + 1}`, textExamEnglish: index === 0 ? 'Official wording one' : null,
    textEnglish: `Exam question ${index + 1}`, textRussian: index === 0 ? 'Вопрос 1' : null,
    choices: ['A', 'B', 'C', 'D'].map((key, choiceIndex) => ({
      id: uuid(10 + index, choiceIndex + 1), key, textThai: null, textEnglish: `Option ${key} of ${index + 1}`, textRussian: null,
    })),
  },
}));
function startPayload(startedAt = new Date()) {
  return {
    examId, vehicleType: 'CAR', questionCount: 50, passingScore: 45,
    startedAt: startedAt.toISOString(), expiresAt: new Date(startedAt.getTime() + 3_600_000).toISOString(), questions,
  };
}
const answerPayload = (examQuestionId: string, selectedChoiceId: string, answeredCount: number) => ({
  examId, examQuestionId, selectedChoiceId, answeredAt: new Date().toISOString(), answeredCount, remainingCount: 50 - answeredCount,
});
const completePayload = { examId, questionCount: 50, answeredCount: 48, unansweredCount: 2, score: 46, passingScore: 45, passed: true, completedAt: new Date().toISOString() };
const metric = (page: Page, label: string) => page.locator('.progress-metric').getByText(label, { exact: true }).locator('..');

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"exam-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openFromSetup(page: Page) {
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the real thing?' })).toBeVisible();
}

async function startExam(page: Page) {
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByText('Question 1 of 50')).toBeVisible();
}

test('starts with one exact request, shows the intro policy and the first positioned question, and keeps nothing in storage', async ({ page }) => {
  let starts = 0;
  await page.route('**/exam/start', (route) => {
    starts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: startPayload() });
  });
  await openFromSetup(page);
  await expect(metric(page, 'Questions')).toContainText('50');
  await expect(metric(page, 'Minutes')).toContainText('60');
  await expect(metric(page, 'Pass mark')).toContainText('45');
  await expect(metric(page, 'Vehicle')).toContainText('Car');
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByRole('heading', { name: 'Mock exam' })).toBeVisible();
  await expect(page.getByText('Question 1 of 50')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exam question 1' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^(59|60):[0-5]\d$/u);
  await expect(page.getByText('Answered 0 · Remaining 50')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish exam' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous question' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: 'Вопрос 1' })).toBeVisible();
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.getByRole('heading', { name: 'คำถาม 1' })).toBeVisible();
  await expect(page.getByText('Official wording one')).toBeAttached();
  expect(starts).toBe(1);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('submits exact answers, locks answered questions without correctness, navigates positions, and finishes with the persisted summary', async ({ page }) => {
  const answered: unknown[] = [];
  await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload() }));
  await page.route('**/exam/answer', (route) => {
    const body = route.request().postDataJSON() as { examQuestionId: string; choiceId: string };
    answered.push(body);
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    return route.fulfill({ json: answerPayload(body.examQuestionId, body.choiceId, answered.length === 1 ? 1 : 50) });
  });
  let completes = 0;
  await page.route('**/exam/complete', (route) => {
    completes++;
    expect(route.request().postDataJSON()).toEqual({ examId });
    return route.fulfill({ json: completePayload });
  });
  await startExam(page);
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  await page.getByRole('radio', { name: 'B. Option B of 1' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Answered 1 · Remaining 49')).toBeVisible();
  await expect(page.getByText('B. Option B of 1 — Your answer')).toBeVisible();
  await expect(page.getByText(/Correct answer|Incorrect|Explanation/u)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);
  await expect(page.locator('.answers input').first()).toBeDisabled();
  expect(answered).toEqual([{ examQuestionId: uuid(1, 1), choiceId: uuid(10, 2) }]);

  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.getByText('Question 2 of 50')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exam question 2' })).toBeVisible();
  await expect(page.locator('.answers input').first()).toBeEnabled();
  await page.getByRole('button', { name: 'Previous question' }).click();
  await expect(page.getByText('Question 1 of 50')).toBeVisible();
  await expect(page.getByText('B. Option B of 1 — Your answer')).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('radio', { name: 'D. Option D of 2' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Answered 50 · Remaining 0')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('All questions answered');
  await page.getByRole('button', { name: 'Finish exam' }).click();
  await expect(page.getByRole('heading', { name: 'Exam complete' })).toBeVisible();
  await expect(metric(page, 'Score')).toContainText('46 / 50');
  await expect(metric(page, 'Pass mark')).toContainText('45');
  await expect(metric(page, 'Answered')).toContainText('48');
  await expect(metric(page, 'Unanswered')).toContainText('2');
  await expect(metric(page, 'Result')).toContainText('Passed');
  await expect(page.getByRole('timer')).toHaveCount(0);
  expect(completes).toBe(1);
  await page.getByRole('button', { name: 'Start another exam' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the real thing?' })).toBeVisible();
});

test('keeps the selected choice for retry after transport and malformed answer failures', async ({ page }) => {
  let attempts = 0;
  await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload() }));
  await page.route('**/exam/answer', (route) => {
    attempts++;
    const body = route.request().postDataJSON() as { examQuestionId: string; choiceId: string };
    expect(body).toEqual({ examQuestionId: uuid(1, 1), choiceId: uuid(10, 3) });
    if (attempts === 1) return route.abort();
    if (attempts === 2) return route.fulfill({ json: { ...answerPayload(body.examQuestionId, body.choiceId, 1), isCorrect: true } });
    return route.fulfill({ json: answerPayload(body.examQuestionId, body.choiceId, 1) });
  });
  await startExam(page);
  await page.getByRole('radio', { name: 'C. Option C of 1' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not save your answer');
  await expect(page.getByRole('radio', { name: 'C. Option C of 1' })).toBeChecked();
  await page.getByRole('button', { name: 'Retry answer' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not save your answer');
  await page.getByRole('button', { name: 'Retry answer' }).click();
  await expect(page.getByText('Answered 1 · Remaining 49')).toBeVisible();
  expect(attempts).toBe(3);
});

test('handles already-submitted, expired and completed answer conflicts', async ({ page }) => {
  const conflicts = ['Answer already submitted', 'Exam expired'] as const;
  let attempts = 0;
  await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload() }));
  await page.route('**/exam/answer', (route) => route.fulfill({ status: 409, json: { error: conflicts[attempts++] ?? 'Exam already completed' } }));
  await page.route('**/exam/complete', (route) => route.fulfill({ json: { ...completePayload, score: 40, passed: false } }));
  await startExam(page);
  await page.getByRole('radio', { name: 'A. Option A of 1' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('already answered');
  await expect(page.getByText('A. Option A of 1 — Your answer')).toBeVisible();
  await expect(page.getByText('Answered 1 · Remaining 49')).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('radio', { name: 'A. Option A of 2' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Time is up');
  await expect(page.locator('.answers input').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finish exam' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);
});

test('a completed conflict loads the persisted result', async ({ page }) => {
  await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload() }));
  await page.route('**/exam/answer', (route) => route.fulfill({ status: 409, json: { error: 'Exam already completed' } }));
  await page.route('**/exam/complete', (route) => route.fulfill({ json: { ...completePayload, score: 40, passed: false } }));
  await startExam(page);
  await page.getByRole('radio', { name: 'A. Option A of 1' }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('heading', { name: 'Exam complete' })).toBeVisible();
  await expect(metric(page, 'Result')).toContainText('Not passed');
  await expect(metric(page, 'Score')).toContainText('40 / 50');
});

test('time up disables answering, enables finishing, and reports an incomplete exam', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-21T09:00:00.000Z') });
  await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload(new Date('2026-09-21T09:00:00.000Z')) }));
  let completes = 0;
  await page.route('**/exam/complete', (route) => {
    completes++;
    return route.fulfill(completes === 1 ? { status: 409, json: { error: 'Exam incomplete' } } : { json: { ...completePayload, answeredCount: 0, unansweredCount: 50, score: 0, passed: false } });
  });
  await startExam(page);
  await expect(page.getByRole('timer')).toHaveText('60:00');
  await page.clock.fastForward('30:00');
  await expect(page.getByRole('timer')).toHaveText('30:00');
  await expect(page.getByRole('button', { name: 'Finish exam' })).toBeDisabled();
  await page.clock.fastForward('30:00');
  await expect(page.getByRole('timer')).toHaveText('00:00');
  await expect(page.locator('.answers input').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish exam' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('50 questions are unanswered');
  await page.getByRole('button', { name: 'Finish exam' }).click();
  await expect(metric(page, 'Result')).toContainText('Not passed');
  await expect(metric(page, 'Unanswered')).toContainText('50');
  expect(completes).toBe(2);
});

for (const failure of ['transport', 'http', 'malformed', 'identity'] as const) {
  test(`shows retry guidance for a ${failure} completion failure`, async ({ page }) => {
    let completes = 0;
    await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload() }));
    await page.route('**/exam/answer', (route) => {
      const body = route.request().postDataJSON() as { examQuestionId: string; choiceId: string };
      return route.fulfill({ json: answerPayload(body.examQuestionId, body.choiceId, 50) });
    });
    await page.route('**/exam/complete', (route) => {
      completes++;
      if (completes > 1) return route.fulfill({ json: completePayload });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'identity') return route.fulfill({ json: { ...completePayload, examId: uuid(9, 9) } });
      return route.fulfill({ json: { ...completePayload, score: 49 } });
    });
    await startExam(page);
    await page.getByRole('radio', { name: 'A. Option A of 1' }).check();
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await page.getByRole('button', { name: 'Finish exam' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not score your exam');
    await expect(page.locator('.progress-summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish exam' }).click();
    await expect(metric(page, 'Result')).toContainText('Passed');
    expect(completes).toBe(2);
  });
}

const invalidStarts = {
  short: { ...startPayload(), questions: questions.slice(0, 49) },
  duration: { ...startPayload(), expiresAt: new Date(Date.now() + 3_500_000).toISOString() },
  positions: { ...startPayload(), questions: questions.map((item) => ({ ...item, position: 1 })) },
  disclosure: { ...startPayload(), questions: questions.map((item) => ({ ...item, correctChoiceId: uuid(10, 1) })) },
  vehicle: { ...startPayload(), vehicleType: 'MOTORCYCLE' },
} as const;

for (const [name, invalid] of Object.entries(invalidStarts)) {
  test(`rejects a ${name} start response and permits retry`, async ({ page }) => {
    let starts = 0;
    await page.route('**/exam/start', (route) => {
      starts++;
      return route.fulfill({ json: starts === 1 ? invalid : startPayload() });
    });
    await openFromSetup(page);
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not start your exam');
    await expect(page.getByRole('timer')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry exam start' }).click();
    await expect(page.getByText('Question 1 of 50')).toBeVisible();
    expect(starts).toBe(2);
  });
}

test('explains an exam already in progress and insufficient questions', async ({ page }) => {
  let starts = 0;
  await page.route('**/exam/start', (route) => {
    starts++;
    if (starts === 1) return route.fulfill({ status: 409, json: { error: 'Exam already in progress' } });
    if (starts === 2) return route.fulfill({ status: 404, json: { error: 'Not enough questions available' } });
    return route.fulfill({ json: startPayload() });
  });
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('already have an exam in progress');
  await page.getByRole('button', { name: 'Retry exam start' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Not enough questions');
  await page.getByRole('button', { name: 'Retry exam start' }).click();
  await expect(page.getByText('Question 1 of 50')).toBeVisible();
});

test('a vehicle-required start returns to setup and a 401 clears the session', async ({ page }) => {
  await page.route('**/exam/start', (route) => route.fulfill({ status: 409, json: { error: 'Vehicle selection required' } }));
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Choose and save your vehicle');
  await expect(page.getByRole('button', { name: 'Mock exam', exact: true })).toHaveCount(0);

  await page.unroute('**/exam/start');
  await page.route('**/exam/start', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await page.getByRole('radio', { name: 'Car' }).check();
  await page.route('**/me/vehicle', (route) => route.fulfill({ json: { id: userId, username: null, firstName: null, selectedVehicleType: 'CAR' } }));
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await page.getByRole('button', { name: 'Mock exam', exact: true }).click();
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('opens from practice and returns to a clean practice view', async ({ page }) => {
  let categoryRequests = 0;
  await page.route('**/practice/categories', (route) => { categoryRequests++; return route.fulfill({ json: { categories: [] } }); });
  await page.route('**/exam/start', (route) => route.fulfill({ json: startPayload() }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await page.getByRole('button', { name: 'Mock exam', exact: true }).click();
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByText('Question 1 of 50')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
  expect(categoryRequests).toBe(2);
  await page.getByRole('button', { name: 'Mock exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the real thing?' })).toBeVisible();
});

test('leaving during start is immediate and ignores the late response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false;
  await page.route('**/exam/start', async (route) => {
    await gate;
    try { await route.fulfill({ json: startPayload() }); } catch { /* the page may have detached */ }
    completed = true;
  });
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByRole('status')).toContainText('Preparing your exam');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await expect.poll(() => completed).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
});
