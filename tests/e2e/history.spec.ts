import { expect, test, type Page } from '@playwright/test';

const token = 'h'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const choiceIds = [
  '550e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440002',
  '550e8400-e29b-41d4-a716-446655440003',
  '550e8400-e29b-41d4-a716-446655440004',
] as const;
const cursor = Buffer.from(JSON.stringify({
  v: 1, submittedAt: '2026-09-15T09:00:00.000Z', attemptId: '650e8400-e29b-41d4-a716-446655440001',
}), 'utf8').toString('base64url');

function item(index: number, correct: boolean) {
  const selectedChoiceId = correct ? choiceIds[2] : choiceIds[0];
  return {
    presentationId: `750e8400-e29b-41d4-a716-44665544000${index}`,
    submittedAt: `2026-09-${16 - index}T0${9 - index}:00:00.000Z`,
    selectedChoiceId,
    correctChoiceId: choiceIds[2],
    isCorrect: correct,
    question: {
      id: `850e8400-e29b-41d4-a716-44665544000${index}`,
      textThai: null,
      textExamEnglish: index === 1 ? 'Choose the safest action.' : null,
      textEnglish: `History question ${index}`,
      textRussian: index === 1 ? `Вопрос истории ${index}` : null,
      choices: choiceIds.map((id, choiceIndex) => ({
        id,
        key: (['D', 'B', 'A', 'C'] as const)[choiceIndex],
        textThai: null,
        textEnglish: `Choice ${index}-${choiceIndex + 1}`,
        textRussian: choiceIndex === 0 ? `Вариант ${index}-1` : null,
      })),
    },
    explanationThai: null,
    explanationEnglish: index === 1 ? 'English explanation.' : null,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: index === 1 ? 'English trap.' : null,
    trapExplanationRussian: null,
  };
}

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"history-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openFromSetup(page: Page) {
  await authenticate(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();
}

test('opens owned correct and incorrect history, expands localized snapshots, and returns to clean practice', async ({ page }, testInfo) => {
  const history = { items: [item(1, true), item(2, false)], nextCursor: null };
  await page.route('**/me/history?limit=10', (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    return route.fulfill({ json: history });
  });
  await page.route('**/practice/next', (route) => route.fulfill({ json: {
    presentationId: item(1, true).presentationId, question: item(1, true).question,
  } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'History question 1' })).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();

  await expect(page.locator('.history-entry')).toHaveCount(2);
  await expect(page.locator('.history-outcome')).toHaveText(['Correct', 'Incorrect']);
  const first = page.locator('.history-entry').first();
  await expect(first.locator('time')).toHaveAttribute('datetime', '2026-09-15T08:00:00.000Z');
  await first.locator(':scope > summary').click();
  await expect(first.getByText('Choose the safest action.')).not.toBeVisible();
  await first.getByText('Exam English wording').click();
  await expect(first.getByText('Choose the safest action.')).toBeVisible();
  await expect(first.getByText('A. Choice 1-3')).toBeVisible();
  await expect(first.getByText('A. Choice 1-3').locator('..').getByText('Your answer')).toBeVisible();
  await expect(first.getByText('A. Choice 1-3').locator('..').getByText('Correct answer')).toBeVisible();
  await expect(first.getByText('D. Choice 1-1').locator('..').getByText('Your answer')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(first.getByRole('heading', { name: 'Вопрос истории 1' })).toBeVisible();
  await expect(first.getByText('Вариант 1-1')).toBeVisible();
  await expect(first.getByText('Choice 1-2')).toBeVisible();
  await expect(first.getByText('English explanation.')).toBeVisible();
  await page.getByRole('radio', { name: 'Thai', exact: true }).check();
  await expect(first.getByRole('heading', { name: 'History question 1' })).toBeVisible();
  const second = page.locator('.history-entry').nth(1);
  await second.locator(':scope > summary').click();
  await expect(second.getByText('D. Choice 2-1').locator('..').getByText('Your answer')).toBeVisible();
  await expect(second.getByText('A. Choice 2-3').locator('..').getByText('Correct answer')).toBeVisible();
  await expect(second.getByText('Explanation unavailable.', { exact: true })).toBeVisible();
  await expect(second.getByText('Trap explanation unavailable.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-history.png'), fullPage: true });

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'History question 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
});

test('loads two pages once, appends valid items, and preserves the cursor for pagination retry', async ({ page }) => {
  let pageRequests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/history?limit=10*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [item(1, true)], nextCursor: cursor } });
    expect(url.searchParams.get('cursor')).toBe(cursor);
    pageRequests++;
    if (pageRequests === 1) { await gate; return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }); }
    return route.fulfill({ json: { items: [item(2, false)], nextCursor: null } });
  });
  await openFromSetup(page);
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Load more');
    button?.click(); button?.click();
  });
  await expect(page.getByRole('button', { name: 'Loading more' })).toBeDisabled();
  expect(pageRequests).toBe(1);
  release?.();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your answer history');
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry history' }).click();
  await expect(page.locator('.history-entry')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect(pageRequests).toBe(2);
});

test('shows initial loading, retries a transport failure, and returns from empty history to setup', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/history?limit=10', async (route) => {
    requests++;
    if (requests === 1) { await gate; return route.abort(); }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await authenticate(page, null);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Loading your answer history');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  release?.();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your answer history');
  await page.getByRole('button', { name: 'Retry history' }).click();
  await expect(page.getByText('You have not submitted any answers yet')).toBeVisible();
  await page.locator('.empty-history').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
});

for (const invalid of ['malformed', 'cross-field'] as const) {
  test(`rejects ${invalid} history responses and allows retry`, async ({ page }) => {
    const valid = item(1, true);
    let requests = 0;
    await page.route('**/me/history?limit=10', (route) => {
      requests++;
      const invalidItem = invalid === 'malformed'
        ? { ...valid, submittedAt: '2026-09-15T08:00:00Z' }
        : { ...valid, isCorrect: false };
      return route.fulfill({ json: requests === 1 ? { items: [invalidItem], nextCursor: null } : { items: [valid], nextCursor: null } });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your answer history');
    await expect(page.locator('.history-entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry history' }).click();
    await expect(page.locator('.history-entry')).toHaveCount(1);
  });
}

test('rejects duplicate presentation IDs across pages while preserving the valid first page', async ({ page }) => {
  let pageRequests = 0;
  await page.route('**/me/history?limit=10*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [item(1, true)], nextCursor: cursor } });
    pageRequests++;
    return route.fulfill({ json: pageRequests === 1
      ? { items: [item(1, true)], nextCursor: null }
      : { items: [item(2, false)], nextCursor: null } });
  });
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your answer history');
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry history' }).click();
  await expect(page.locator('.history-entry')).toHaveCount(2);
});

test('a history 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/me/history?limit=10', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFromSetup(page);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
});

test('leaving history is immediate and ignores a delayed response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/history?limit=10', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openFromSetup(page);
  await expect(page.getByRole('status')).toContainText('Loading your answer history');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
