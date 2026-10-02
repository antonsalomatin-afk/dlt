import { expect, test, type Locator, type Page } from '@playwright/test';

const token = 'q'.repeat(43);
const uuid = (value: number) => `650e8400-e29b-41d4-a716-${value.toString().padStart(12, '0')}`;
const examId = uuid(999);
const startedAt = '2098-01-01T00:00:00.000Z';
const expiresAt = '2098-01-01T01:00:00.000Z';
const questions = Array.from({ length: 50 }, (_, index) => ({
  examQuestionId: uuid(index + 1), position: index + 1,
  question: {
    id: uuid(100 + index), textThai: null, textExamEnglish: index === 0 ? 'Formal question one' : null,
    textEnglish: `Question ${index + 1}`, textRussian: null,
    choices: ['A', 'B', 'C', 'D'].map((key, choice) => ({
      id: uuid(1_000 + index * 4 + choice), key, textThai: null, textEnglish: `Choice ${key} for ${index + 1}`, textRussian: null,
    })),
  },
}));
const currentPayload = (answered = 0, serverTime = '2098-01-01T00:10:00.000Z') => ({
  examId, vehicleType: 'CAR', questionCount: 50, passingScore: 45, startedAt, expiresAt, serverTime,
  expired: serverTime >= expiresAt, answeredCount: answered, remainingCount: 50 - answered,
  questions: questions.map((question, index) => ({
    ...question, selectedChoiceId: index < answered ? question.question.choices[0]?.id : null,
    answeredAt: index < answered ? `2098-01-01T00:${(index % 50).toString().padStart(2, '0')}:00.000Z` : null,
  })),
});
const reportResponse = (examQuestionId: string) => ({ reportId: uuid(8_000 + Number(examQuestionId.slice(-2))), examQuestionId, createdAt: '2026-10-02T12:00:00.000Z' });

function reviewQuestion(index: number) {
  return {
    id: uuid(300 + index), textThai: null, textExamEnglish: null, textEnglish: `Review question ${index}`, textRussian: null,
    choices: ['A', 'B', 'C', 'D'].map((key, choice) => ({
      id: uuid(3_000 + index * 4 + choice), key, textThai: null, textEnglish: `Review choice ${key}-${index}`, textRussian: null,
    })),
  };
}
function mistake(index: number, unanswered = false) {
  const question = reviewQuestion(index);
  return {
    examQuestionId: uuid(500 + index), position: index,
    selectedChoiceId: unanswered ? null : question.choices[0]?.id, answeredAt: unanswered ? null : '2026-10-01T08:10:00.000Z',
    correctChoiceId: question.choices[2]?.id, question,
    explanationThai: null, explanationEnglish: `Explanation ${index}`, explanationRussian: null,
    trapExplanationThai: null, trapExplanationEnglish: `Trap ${index}`, trapExplanationRussian: null,
  };
}
const historyItem = { examId, vehicleType: 'CAR', questionCount: 50, answeredCount: 50, unansweredCount: 0, score: 48, passingScore: 45, passed: true, startedAt: '2026-10-01T08:00:00.000Z', completedAt: '2026-10-01T09:00:00.000Z' };
const review = { examId, questionCount: 50, score: 48, passingScore: 45, passed: true, completedAt: historyItem.completedAt, mistakes: [mistake(1), mistake(2, true)] };
const perfectReview = { ...review, score: 50, mistakes: [] };

async function authenticate(page: Page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"exam-report-test",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: uuid(900), username: null, firstName: null, selectedVehicleType: 'CAR' } } }));
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.goto('/');
}

async function openExam(page: Page, current: object = currentPayload()) {
  await page.route('**/exam/current', (route) => route.fulfill({ json: current }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Mock exam' }).click();
  await expect(page.getByRole('heading', { name: /Question \d+ of 50/ })).toBeVisible();
}

async function openReview(page: Page, payload: object = review) {
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem], nextCursor: null } }));
  await page.route(`**/exam/${examId}/review`, (route) => route.fulfill({ json: payload }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Exam history' }).click();
  await page.getByRole('button', { name: 'Review mistakes' }).click();
  await expect(page.getByRole('heading', { name: 'Exam mistakes' })).toBeVisible();
}

async function openReport(scope: Page | Locator) {
  await scope.getByRole('button', { name: 'Report question' }).click();
  await expect(scope.getByRole('textbox', { name: 'What may be wrong with this question?' })).toBeVisible();
}

test('active exam report opens, cancels, validates locally and clears its draft on question switch', async ({ page }) => {
  let requests = 0;
  await page.route('**/exam/report', (route) => { requests++; return route.fulfill({ json: reportResponse(uuid(1)) }); });
  await openExam(page);
  await openReport(page);
  const details = page.getByRole('textbox', { name: 'What may be wrong with this question?' });
  await expect(page.getByText('allegation for human review')).toBeVisible();
  await details.fill('Unsent exam report');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await openReport(page);
  await expect(details).toHaveValue('');
  for (const invalid of ['ab', ' padded', 'padded ', 'a'.repeat(1001), '😀'.repeat(1001), 'bad\tcontrol']) {
    await details.fill(invalid);
    await page.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.locator('[id^="exam-report-error-"]')).toContainText('Enter 3–1000 characters');
  }
  await details.evaluate((element) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, `bad${String.fromCharCode(0xd800)}value`);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('[id^="exam-report-error-"]')).toContainText('Enter 3–1000 characters');
  await details.fill('Clear this report when switching');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Question 2 of 50' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await openReport(page);
  await expect(details).toHaveValue('');
  expect(requests).toBe(0);
});

test('active exam sends one exact request, blocks cross-question actions and keeps countdown and per-question success', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const details = 'Exam sign 😀\nlooks incorrect';
  await page.route('**/exam/report', async (route) => {
    requests++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().headers()['content-type']).toContain('application/json');
    expect(route.request().postDataJSON()).toEqual({ examQuestionId: uuid(1), details });
    await gate;
    await route.fulfill({ json: reportResponse(uuid(1)) });
  });
  await openExam(page);
  await page.getByRole('radio', { name: /Choice A for 1/ }).check();
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill(details);
  const before = await page.getByRole('timer').textContent();
  await page.evaluate(() => {
    const submit = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Submit report');
    const nextQuestion = document.querySelector<HTMLButtonElement>('button[aria-label^="Question 2,"]');
    submit?.click(); submit?.click(); nextQuestion?.click();
  });
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole('heading', { name: 'Question 1 of 50' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Choice B for 1/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Question 2, unanswered' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Leave exam' })).toBeEnabled();
  await expect.poll(async () => page.getByRole('timer').textContent(), { timeout: 3_000 }).not.toBe(before);
  release?.();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Choice A for 1/ })).toBeChecked();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('reports an answered exam question without changing answer secrecy or navigation', async ({ page }) => {
  await page.route('**/exam/answer', (route) => route.fulfill({ json: {
    examId, examQuestionId: uuid(1), selectedChoiceId: uuid(1_000), answeredAt: '2098-01-01T00:11:00.000Z', answeredCount: 1, remainingCount: 49,
  } }));
  await page.route('**/exam/report', (route) => route.fulfill({ json: reportResponse(uuid(1)) }));
  await openExam(page);
  await page.getByRole('radio', { name: /Choice A for 1/ }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.getByRole('button', { name: 'Question 1, answered' }).click();
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('The answered question may be ambiguous');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
  await expect(page.getByText('Answer saved. This question is read-only.')).toBeVisible();
  await expect(page.getByText(/Correct answer|Incorrect|Explanation/)).toHaveCount(0);
  await expect(page.getByLabel('Exam progress')).toContainText('1 answered');
});

test('active exam keeps exact report details through retryable failures', async ({ page }) => {
  let attempt = 0;
  await page.route('**/exam/report', (route) => {
    attempt++;
    if (attempt === 1) return route.abort();
    if (attempt === 2) return route.fulfill({ status: 400, json: { error: 'Bad Request' } });
    if (attempt === 3) return route.fulfill({ status: 500, json: { error: 'test' } });
    if (attempt === 4) return route.fulfill({ json: { ...reportResponse(uuid(1)), extra: true } });
    if (attempt === 5) return route.fulfill({ json: reportResponse(uuid(2)) });
    return route.fulfill({ json: reportResponse(uuid(1)) });
  });
  await openExam(page);
  await openReport(page);
  const details = page.getByRole('textbox', { name: 'What may be wrong with this question?' });
  await details.fill('Keep this exact exam retry text');
  for (let current = 1; current <= 5; current++) {
    await page.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.locator('[id^="exam-report-error-"]')).toContainText('details are still here');
    await expect(details).toHaveValue('Keep this exact exam retry text');
    expect(attempt).toBe(current);
  }
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
});

test('active exam distinguishes unavailable, conflict and session expiry', async ({ page }) => {
  let attempt = 0;
  await page.route('**/exam/report', (route) => {
    attempt++;
    if (attempt === 1) return route.fulfill({ status: 404, json: { error: 'Exam question not found' } });
    return route.fulfill({ status: 409, json: { error: 'Report already submitted' } });
  });
  await openExam(page);
  await openReport(page);
  const details = page.getByRole('textbox', { name: 'What may be wrong with this question?' });
  await details.fill('This exam question seems unavailable');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('[id^="exam-report-error-"]')).toContainText('no longer available to report');
  await expect(details).toHaveValue('This exam question seems unavailable');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Report already submitted', { exact: true })).toBeVisible();

  await page.unroute('**/exam/report');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.route('**/exam/report', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('A valid second report description');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
});

test('leaving an active exam ignores a late report 401', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/exam/report', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openExam(page);
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('A valid delayed exam report');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await page.getByRole('button', { name: 'Leave exam' }).click();
  release?.();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('expiry completes normally and invalidates a pending report response', async ({ page }) => {
  const nearExpiry = currentPayload(10, '2098-01-01T00:59:58.500Z');
  let releaseReport: (() => void) | undefined;
  const reportGate = new Promise<void>((resolve) => { releaseReport = resolve; });
  await page.route('**/exam/report', async (route) => { await reportGate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await page.route('**/exam/complete', (route) => route.fulfill({ json: {
    examId, questionCount: 50, answeredCount: 10, unansweredCount: 40, score: 8, passingScore: 45, passed: false, completedAt: expiresAt,
  } }));
  await openExam(page, nearExpiry);
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('A pending report at expiry');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('.exam-result')).toContainText('Unanswered40', { timeout: 5_000 });
  releaseReport?.();
  await page.waitForTimeout(100);
  await expect(page.locator('.exam-result')).toContainText('8 / 50');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('report actions appear only inside completed mistake cards, not summaries or perfect reviews', async ({ page }) => {
  let reviewRequests = 0;
  await page.route('**/exam/history?limit=10', (route) => route.fulfill({ json: { items: [historyItem], nextCursor: null } }));
  await page.route(`**/exam/${examId}/review`, (route) => { reviewRequests++; return route.fulfill({ json: reviewRequests === 1 ? review : perfectReview }); });
  await authenticate(page);
  await page.getByRole('button', { name: 'Exam history' }).click();
  await expect(page.getByRole('button', { name: 'Report question' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review mistakes' }).click();
  await expect(page.locator('.exam-mistake-card').getByRole('button', { name: 'Report question' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  await page.getByRole('button', { name: 'Review mistakes' }).click();
  await expect(page.getByText('Perfect exam')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report question' })).toHaveCount(0);
});

test('review allows one report request across cards and retains per-question outcomes and drafts', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/exam/report', async (route) => {
    requests++;
    const body: unknown = route.request().postDataJSON();
    if (body === null || typeof body !== 'object' || !('examQuestionId' in body) || !('details' in body)
      || typeof body.examQuestionId !== 'string' || typeof body.details !== 'string') throw new Error('Invalid exam report request body');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    if (body.examQuestionId === uuid(501)) {
      expect(body.details).toBe('First review report 😀\nexact');
      await gate;
      return route.fulfill({ json: reportResponse(uuid(501)) });
    }
    expect(body).toEqual({ examQuestionId: uuid(502), details: 'Second unsent review draft' });
    return route.fulfill({ status: 409, json: { error: 'Report already submitted' } });
  });
  await openReview(page);
  const cards = page.locator('.exam-mistake-card');
  await openReport(cards.nth(0));
  await openReport(cards.nth(1));
  await cards.nth(0).getByRole('textbox').fill('First review report 😀\nexact');
  await cards.nth(1).getByRole('textbox').fill('Second unsent review draft');
  await cards.nth(0).getByRole('button', { name: 'Submit report' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => requests).toBe(1);
  await expect(cards.nth(1).getByRole('textbox')).toBeDisabled();
  await expect(cards.nth(1).getByRole('button', { name: 'Submit report' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back to exam history' })).toBeEnabled();
  release?.();
  await expect(cards.nth(0).getByText('Report submitted', { exact: true })).toBeVisible();
  await expect(cards.nth(1).getByRole('textbox')).toHaveValue('Second unsent review draft');
  await cards.nth(1).getByRole('button', { name: 'Submit report' }).click();
  await expect(cards.nth(1).getByText('Report already submitted', { exact: true })).toBeVisible();
  expect(requests).toBe(2);
});

test('back from review is immediate and ignores a late report error', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/exam/report', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openReview(page);
  const card = page.locator('.exam-mistake-card').first();
  await openReport(card);
  await card.getByRole('textbox').fill('Delayed review report details');
  await card.getByRole('button', { name: 'Submit report' }).click();
  await page.getByRole('button', { name: 'Back to exam history' }).click();
  release?.();
  await expect(page.locator('.exam-history-entry')).toHaveCount(1);
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});
