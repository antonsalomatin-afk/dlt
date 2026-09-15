import { expect, test, type Page } from '@playwright/test';

const token = 'm'.repeat(43);
const userId = '150e8400-e29b-41d4-a716-446655440000';
const choiceIds = [
  '150e8400-e29b-41d4-a716-446655440001',
  '150e8400-e29b-41d4-a716-446655440002',
  '150e8400-e29b-41d4-a716-446655440003',
  '150e8400-e29b-41d4-a716-446655440004',
] as const;
const cursor = Buffer.from(JSON.stringify({
  v: 1, submittedAt: '2026-09-15T09:00:00.000Z', attemptId: '250e8400-e29b-41d4-a716-446655440001',
}), 'utf8').toString('base64url');

function mistake(index: number) {
  return {
    presentationId: `350e8400-e29b-41d4-a716-44665544000${index}`,
    submittedAt: `2026-09-${16 - index}T0${9 - index}:00:00.000Z`,
    selectedChoiceId: choiceIds[0],
    correctChoiceId: choiceIds[2],
    isCorrect: false,
    question: {
      id: `450e8400-e29b-41d4-a716-44665544000${index}`,
      textThai: null,
      textExamEnglish: index === 1 ? 'Select the safest response.' : null,
      textEnglish: `Mistake question ${index}`,
      textRussian: index === 1 ? `Ошибка ${index}` : null,
      choices: choiceIds.map((id, choiceIndex) => ({
        id,
        key: (['D', 'B', 'A', 'C'] as const)[choiceIndex],
        textThai: null,
        textEnglish: `Mistake choice ${index}-${choiceIndex + 1}`,
        textRussian: choiceIndex === 0 ? `Ошибка вариант ${index}-1` : null,
      })),
    },
    explanationThai: null,
    explanationEnglish: index === 1 ? 'Review the underlying rule.' : null,
    explanationRussian: null,
    trapExplanationThai: null,
    trapExplanationEnglish: index === 1 ? 'Do not choose by position.' : null,
    trapExplanationRussian: null,
  };
}

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"mistakes-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openFromSetup(page: Page) {
  await authenticate(page);
  await page.getByRole('button', { name: 'Mistakes', exact: true }).click();
}

test('opens mistakes from practice, expands an incorrect localized snapshot, and returns to clean practice', async ({ page }, testInfo) => {
  await page.route('**/me/mistakes?limit=10', (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    return route.fulfill({ json: { items: [mistake(1)], nextCursor: null } });
  });
  await page.route('**/practice/next', (route) => route.fulfill({ json: {
    presentationId: mistake(1).presentationId, question: mistake(1).question,
  } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Mistake question 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Mistakes', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Mistakes to review' })).toBeVisible();
  await expect(page.getByText('Review each incorrect submitted answer as its own attempt.')).toBeVisible();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await expect(page.locator('.history-outcome')).toHaveText(['Incorrect']);
  const entry = page.locator('.history-entry');
  await expect(entry.locator('time')).toHaveAttribute('datetime', '2026-09-15T08:00:00.000Z');
  await entry.locator(':scope > summary').click();
  await entry.getByText('Exam English wording').click();
  await expect(entry.getByText('Select the safest response.')).toBeVisible();
  await expect(entry.getByText('D. Mistake choice 1-1').locator('..').getByText('Your answer')).toBeVisible();
  await expect(entry.getByText('A. Mistake choice 1-3').locator('..').getByText('Correct answer')).toBeVisible();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(entry.getByRole('heading', { name: 'Ошибка 1' })).toBeVisible();
  await expect(entry.getByText('Ошибка вариант 1-1')).toBeVisible();
  await expect(entry.getByText('Mistake choice 1-2')).toBeVisible();
  await expect(entry.getByText('Review the underlying rule.')).toBeVisible();
  await page.getByRole('radio', { name: 'Thai', exact: true }).check();
  await expect(entry.getByRole('heading', { name: 'Mistake question 1' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-mistakes.png'), fullPage: true });

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mistake question 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
});

test('loads two mistake pages once and retries the exact failed pagination cursor', async ({ page }) => {
  let pageRequests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/mistakes?limit=10*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [mistake(1)], nextCursor: cursor } });
    expect(url.searchParams.get('cursor')).toBe(cursor);
    pageRequests++;
    if (pageRequests === 1) { await gate; return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }); }
    return route.fulfill({ json: { items: [mistake(2)], nextCursor: null } });
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
  await expect(page.getByRole('main').getByRole('alert')).toContainText('incorrect submitted answers');
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry mistakes' }).click();
  await expect(page.locator('.history-entry')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect(pageRequests).toBe(2);
});

test('shows initial loading, retries a transport failure, and returns from empty mistakes to setup', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/mistakes?limit=10', async (route) => {
    requests++;
    if (requests === 1) { await gate; return route.abort(); }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await authenticate(page, null);
  await page.getByRole('button', { name: 'Mistakes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Loading your incorrect submitted answers');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  release?.();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('incorrect submitted answers');
  await page.getByRole('button', { name: 'Retry mistakes' }).click();
  await expect(page.getByText('no incorrect submitted answers')).toBeVisible();
  await page.locator('.empty-history').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
});

for (const invalid of ['malformed', 'logically-correct'] as const) {
  test(`rejects a ${invalid} mistakes response and allows retry`, async ({ page }) => {
    const valid = mistake(1);
    let requests = 0;
    await page.route('**/me/mistakes?limit=10', (route) => {
      requests++;
      const invalidItem = invalid === 'malformed'
        ? { ...valid, submittedAt: '2026-09-15T08:00:00Z' }
        : { ...valid, selectedChoiceId: valid.correctChoiceId, isCorrect: true };
      return route.fulfill({ json: requests === 1 ? { items: [invalidItem], nextCursor: null } : { items: [valid], nextCursor: null } });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('incorrect submitted answers');
    await expect(page.locator('.history-entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry mistakes' }).click();
    await expect(page.locator('.history-entry')).toHaveCount(1);
  });
}

test('rejects a duplicate presentation on a later mistakes page and preserves validated items', async ({ page }) => {
  let pageRequests = 0;
  await page.route('**/me/mistakes?limit=10*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [mistake(1)], nextCursor: cursor } });
    pageRequests++;
    return route.fulfill({ json: pageRequests === 1
      ? { items: [mistake(1)], nextCursor: null }
      : { items: [mistake(2)], nextCursor: null } });
  });
  await openFromSetup(page);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('incorrect submitted answers');
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry mistakes' }).click();
  await expect(page.locator('.history-entry')).toHaveCount(2);
});

test('a mistakes 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/me/mistakes?limit=10', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFromSetup(page);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Mistakes', exact: true })).toHaveCount(0);
});

test('leaving mistakes is immediate and ignores a delayed response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/mistakes?limit=10', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openFromSetup(page);
  await expect(page.getByRole('status')).toContainText('Loading your incorrect submitted answers');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Mistakes', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
