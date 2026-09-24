import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'e'.repeat(43);
const uuid = (value: number) => `550e8400-e29b-41d4-a716-${value.toString().padStart(12, '0')}`;
const examId = uuid(999);
const startedAt = '2098-01-01T00:00:00.000Z';
const expiresAt = '2098-01-01T01:00:00.000Z';
const questions = Array.from({ length: 50 }, (_, index) => ({
  examQuestionId: uuid(index + 1), position: index + 1,
  question: {
    id: uuid(100 + index), textThai: index === 0 ? 'คำถามหนึ่ง' : null, textExamEnglish: index === 0 ? 'Formal question one' : null,
    textEnglish: `Question ${index + 1}`, textRussian: index === 0 ? 'Вопрос один' : null,
    choices: ['A', 'B', 'C', 'D'].map((key, choice) => ({
      id: uuid(1_000 + index * 4 + choice), key, textThai: index === 0 ? `ตัวเลือก ${key}` : null,
      textEnglish: `Choice ${key} for ${index + 1}`, textRussian: index === 0 ? `Вариант ${key}` : null,
    })),
  },
}));
const startPayload = { examId, vehicleType: 'CAR', questionCount: 50, passingScore: 45, startedAt, expiresAt, questions };
const currentPayload = (answered: number, serverTime = '2098-01-01T00:10:00.000Z') => ({
  ...startPayload, serverTime, expired: serverTime >= expiresAt, answeredCount: answered, remainingCount: 50 - answered,
  questions: questions.map((question, index) => ({
    ...question,
    selectedChoiceId: index < answered ? question.question.choices[0]?.id : null,
    answeredAt: index < answered ? `2098-01-01T00:${(index % 50).toString().padStart(2, '0')}:00.000Z` : null,
  })),
});
const resultPayload = (answeredCount: number, score: number) => ({
  examId, questionCount: 50, answeredCount, unansweredCount: 50 - answeredCount, score,
  passingScore: 45, passed: score >= 45, completedAt: answeredCount === 50 ? '2098-01-01T00:50:00.000Z' : expiresAt,
});

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"exam-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: uuid(900), username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openExam(page: Page, current: object | null = null) {
  await page.route('**/exam/current', (route) => current
    ? route.fulfill({ json: current })
    : route.fulfill({ status: 404, json: { error: 'Exam not found' } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam' }).click();
}

test('no-current entry starts with exact requests and keeps credentials out of URLs and storage', async ({ page }) => {
  const observed: Array<{ url: string; method: string; body: string | null; authorization: string | undefined }> = [];
  await page.route('**/exam/current', (route) => {
    observed.push(record(route));
    return route.fulfill({ status: 404, json: { error: 'Exam not found' } });
  });
  await page.route('**/exam/start', (route) => {
    observed.push(record(route));
    return route.fulfill({ json: startPayload });
  });
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await expect(page.getByText('50', { exact: true })).toBeVisible();
  await expect(page.getByText('60 minutes', { exact: true })).toBeVisible();
  await expect(page.getByText('45 / 50')).toBeVisible();
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.getByRole('heading', { name: 'Question 1 of 50' })).toBeVisible();
  expect(observed.map(({ method, body }) => ({ method, body }))).toEqual([{ method: 'GET', body: null }, { method: 'POST', body: '{}' }]);
  expect(observed.every(({ url, authorization }) => !url.includes(token) && authorization === `Bearer ${token}`)).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('restores persisted answers, authoritative progress and first unanswered question', async ({ page }) => {
  await openExam(page, currentPayload(2));
  await expect(page.getByRole('heading', { name: 'Question 3 of 50' })).toBeVisible();
  await expect(page.getByLabel('Exam progress')).toContainText('2 answered');
  await expect(page.getByLabel('Exam progress')).toContainText('48 remaining');
  await page.getByRole('button', { name: 'Question 1, answered' }).click();
  await expect(page.getByRole('radio', { name: /Choice A for 1/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Choice B for 1/ })).toBeDisabled();
  await expect(page.getByText('Answer saved. This question is read-only.')).toBeVisible();
});

test('saves authoritative progress without early correctness and moves to the next unanswered question', async ({ page }) => {
  await page.route('**/exam/answer', (route) => {
    expect(route.request().postDataJSON()).toEqual({ examQuestionId: uuid(2), choiceId: uuid(1004) });
    return route.fulfill({ json: { examId, examQuestionId: uuid(2), selectedChoiceId: uuid(1004), answeredAt: '2098-01-01T00:11:00.000Z', answeredCount: 2, remainingCount: 48 } });
  });
  await openExam(page, currentPayload(1));
  await page.getByRole('radio', { name: /Choice A for 2/ }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('heading', { name: 'Question 3 of 50' })).toBeVisible();
  await expect(page.getByLabel('Exam progress')).toContainText('2 answered');
  await expect(page.getByText(/Correct answer|Incorrect|Explanation/)).toHaveCount(0);
});

test('the final answer completes once and renders the authoritative result', async ({ page }) => {
  let completions = 0;
  await page.route('**/exam/answer', (route) => route.fulfill({ json: {
    examId, examQuestionId: uuid(50), selectedChoiceId: uuid(1196), answeredAt: '2098-01-01T00:50:00.000Z', answeredCount: 50, remainingCount: 0,
  } }));
  await page.route('**/exam/complete', (route) => { completions++; expect(route.request().postDataJSON()).toEqual({ examId }); return route.fulfill({ json: resultPayload(50, 46) }); });
  await openExam(page, currentPayload(49));
  await page.getByRole('radio', { name: /Choice A for 50/ }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.locator('.exam-result')).toContainText('Passed');
  await expect(page.locator('.exam-result')).toContainText('46 / 50');
  await expect(page.locator('.exam-result')).toContainText('Answered50');
  expect(completions).toBe(1);
});

test('exact server expiry clamps the timer and completes with unanswered questions', async ({ page }) => {
  let completions = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/exam/complete', async (route) => { completions++; await gate; return route.fulfill({ json: resultPayload(10, 8) }); });
  await openExam(page, currentPayload(10, expiresAt));
  await expect(page.getByRole('timer')).toHaveText('00:00');
  release?.();
  await expect(page.locator('.exam-result')).toContainText('Unanswered40');
  expect(completions).toBe(1);
});

test('localizes with fallback and supports navigator and previous/next controls', async ({ page }) => {
  await openExam(page, currentPayload(0));
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: 'Вопрос один' })).toBeVisible();
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.getByRole('heading', { name: 'คำถามหนึ่ง' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Question 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByRole('heading', { name: 'Question 1 of 50' })).toBeVisible();
  await page.getByRole('button', { name: 'Question 50, unanswered' }).click();
  await expect(page.getByRole('heading', { name: 'Question 50 of 50' })).toBeVisible();
});

test('a 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/exam/current', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('vehicle and insufficient-content conflicts recover without inventing an exam', async ({ page }) => {
  let starts = 0;
  await page.route('**/exam/start', (route) => {
    starts++;
    return starts === 1
      ? route.fulfill({ status: 409, json: { error: 'Not enough questions available' } })
      : route.fulfill({ status: 409, json: { error: 'Vehicle selection required' } });
  });
  await openExam(page);
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.locator('.exam').getByRole('alert')).toContainText('not enough verified questions');
  await page.getByRole('button', { name: 'Try starting again' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByText('Saved selection: Not chosen yet')).toBeVisible();
});

test('an in-progress start conflict performs one current-exam reload', async ({ page }) => {
  let currentRequests = 0;
  let starts = 0;
  await page.route('**/exam/current', (route) => {
    currentRequests++;
    return currentRequests === 1
      ? route.fulfill({ status: 404, json: { error: 'Exam not found' } })
      : route.fulfill({ json: currentPayload(3) });
  });
  await page.route('**/exam/start', (route) => { starts++; return route.fulfill({ status: 409, json: { error: 'Exam already in progress' } }); });
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.getByRole('heading', { name: 'Question 4 of 50' })).toBeVisible();
  expect({ currentRequests, starts }).toEqual({ currentRequests: 2, starts: 1 });
});

for (const failure of ['transport', 'malformed'] as const) {
  test(`a ${failure} current-exam failure has a deterministic retry`, async ({ page }) => {
    let requests = 0;
    await page.route('**/exam/current', (route) => {
      requests++;
      if (requests > 1) return route.fulfill({ status: 404, json: { error: 'Exam not found' } });
      return failure === 'transport' ? route.abort() : route.fulfill({ json: { ...currentPayload(0), score: 50 } });
    });
    await authenticate(page);
    await page.getByRole('button', { name: 'Mock exam' }).click();
    await expect(page.locator('.exam').getByRole('alert')).toContainText('could not load your mock exam');
    await page.getByRole('button', { name: 'Retry exam' }).click();
    await expect(page.getByRole('button', { name: 'Start mock exam' })).toBeEnabled();
    expect(requests).toBe(2);
  });
}

test('opens from practice and reloads current after an answer conflict', async ({ page }) => {
  let currentRequests = 0;
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.route('**/exam/current', (route) => { currentRequests++; return route.fulfill({ json: currentRequests === 1 ? currentPayload(0) : currentPayload(1) }); });
  await page.route('**/exam/answer', (route) => route.fulfill({ status: 409, json: { error: 'Answer already submitted' } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await page.getByRole('radio', { name: /Choice A for 1/ }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('heading', { name: 'Question 2 of 50' })).toBeVisible();
  expect(currentRequests).toBe(2);
});

test('leaving during answer submission ignores the stale response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.route('**/exam/answer', async (route) => {
    await gate;
    return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
  });
  await openExam(page, currentPayload(0));
  await page.getByRole('radio', { name: /Choice A for 1/ }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('button', { name: 'Leave exam' })).toBeEnabled();
  await page.getByRole('button', { name: 'Leave exam' }).click();
  release?.();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

function record(route: Route) {
  const request = route.request();
  return { url: request.url(), method: request.method(), body: request.postData(), authorization: request.headers().authorization };
}
