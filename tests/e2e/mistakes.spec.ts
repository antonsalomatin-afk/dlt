import { clickNavigation, openNavigation } from './navigation.ts';
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

function retryPresentation(index = 1) {
  return {
    presentationId: `650e8400-e29b-41d4-a716-44665544000${index}`,
    question: {
      ...mistake(index).question,
      id: `750e8400-e29b-41d4-a716-44665544000${index}`,
      textEnglish: `Concept retry question ${index}`,
    },
  };
}

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR', mockCategories = true) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"mistakes-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  if (mockCategories) await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openFromSetup(page: Page) {
  await authenticate(page);
  await clickNavigation(page, 'Mistakes', true);
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
  await clickNavigation(page, 'Mistakes', true);

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
  await clickNavigation(page, 'Mistakes', true);
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
  await openNavigation(page, 'Mistakes', true); await expect(page.getByRole('button', { name: 'Mistakes', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('starts one exact concept retry, shows it before categories load, answers normally, and consumes the handoff', async ({ page }) => {
  const source = mistake(1);
  const retry = retryPresentation(1);
  let feedRequests = 0;
  let retryRequests = 0;
  let nextRequests = 0;
  let releaseCategories: (() => void) | undefined;
  const categoriesGate = new Promise<void>((resolve) => { releaseCategories = resolve; });
  await page.route('**/me/mistakes?limit=10', (route) => {
    feedRequests++;
    return route.fulfill({ json: { items: [source], nextCursor: null } });
  });
  await page.route('**/practice/categories', async (route) => {
    await categoriesGate;
    return route.fulfill({ json: { categories: [] } });
  });
  await page.route('**/practice/next', (route) => { nextRequests++; return route.fulfill({ json: retry }); });
  await page.route('**/practice/retry-mistake', (route) => {
    retryRequests++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().headers()['content-type']).toContain('application/json');
    expect(route.request().postDataJSON()).toEqual({ presentationId: source.presentationId });
    return route.fulfill({ json: retry });
  });
  await page.route('**/practice/answer', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      presentationId: retry.presentationId,
      choiceId: retry.question.choices[2]?.id,
    });
    return route.fulfill({ json: {
      presentationId: retry.presentationId,
      selectedChoiceId: retry.question.choices[2]?.id,
      correctChoiceId: retry.question.choices[2]?.id,
      isCorrect: true,
      explanationThai: null,
      explanationEnglish: 'Keep applying the concept.',
      explanationRussian: null,
      trapExplanationThai: null,
      trapExplanationEnglish: null,
      trapExplanationRussian: null,
    } });
  });

  await authenticate(page, 'CAR', false);
  await clickNavigation(page, 'Mistakes', true);
  await page.locator('.history-entry').first().locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Practice this concept' }).click();
  await expect(page.getByRole('heading', { name: retry.question.textEnglish })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading practice categories');
  expect(retryRequests).toBe(1);
  expect(nextRequests).toBe(0);

  releaseCategories?.();
  await page.getByRole('radio', { name: /A\. Mistake choice/ }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByRole('region', { name: 'Answer result' })).toContainText('Correct');
  await clickNavigation(page, 'Mistakes', true);
  await expect(page.locator('.history-entry')).toHaveCount(1);
  expect(feedRequests).toBe(2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: retry.question.textEnglish })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
  expect(nextRequests).toBe(0);
});

test('retries the same mistake after transport, HTTP, and malformed success or error failures', async ({ page }) => {
  const source = mistake(1);
  let requests = 0;
  await page.route('**/me/mistakes?limit=10', (route) => route.fulfill({ json: { items: [source], nextCursor: null } }));
  await page.route('**/practice/retry-mistake', (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ presentationId: source.presentationId });
    if (requests === 1) return route.abort();
    if (requests === 2) return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    if (requests === 3) return route.fulfill({ status: 404, json: { error: 'Mistake not found', hidden: true } });
    if (requests === 4) return route.fulfill({ json: { ...retryPresentation(1), hidden: true } });
    return route.fulfill({ json: retryPresentation(1) });
  });
  await openFromSetup(page);
  await page.locator('.history-entry').first().locator(':scope > summary').click();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.getByRole('button', { name: 'Practice this concept' }).click();
    await expect(page.locator('.history-entry').getByRole('alert')).toContainText('could not start concept practice');
  }
  await page.getByRole('button', { name: 'Practice this concept' }).click();
  await expect(page.getByRole('heading', { name: 'Concept retry question 1' })).toBeVisible();
  expect(requests).toBe(5);
});

for (const branch of [
  { status: 404, error: 'Mistake not found', guidance: 'mistake is no longer available' },
  { status: 404, error: 'No questions available', guidance: 'No practice questions are available for this concept' },
  { status: 409, error: 'Mistake has no concept', guidance: 'not linked to a practice concept' },
] as const) {
  test(`shows stable non-destructive guidance for ${branch.error}`, async ({ page }) => {
    await page.route('**/me/mistakes?limit=10', (route) => route.fulfill({ json: { items: [mistake(1)], nextCursor: null } }));
    await page.route('**/practice/retry-mistake', (route) => route.fulfill({ status: branch.status, json: { error: branch.error } }));
    await openFromSetup(page);
    await page.locator('.history-entry').first().locator(':scope > summary').click();
    await page.getByRole('button', { name: 'Practice this concept' }).click();
    await expect(page.locator('.history-entry').getByRole('alert')).toContainText(branch.guidance);
    await expect(page.locator('.history-entry')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Practice this concept' })).toBeEnabled();
  });
}

test('expires on a validated retry 401 and clears the in-memory session', async ({ page }) => {
  await page.route('**/me/mistakes?limit=10', (route) => route.fulfill({ json: { items: [mistake(1)], nextCursor: null } }));
  await page.route('**/practice/retry-mistake', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFromSetup(page);
  await page.locator('.history-entry').first().locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Practice this concept' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Mistakes', exact: true })).toHaveCount(0);
});

test('returns a missing-vehicle retry conflict to setup and clears the confirmed choice', async ({ page }) => {
  await page.route('**/me/mistakes?limit=10', (route) => route.fulfill({ json: { items: [mistake(1)], nextCursor: null } }));
  await page.route('**/practice/retry-mistake', (route) => route.fulfill({ status: 409, json: { error: 'Vehicle selection required' } }));
  await openFromSetup(page);
  await page.locator('.history-entry').first().locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Practice this concept' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByText('Saved selection: Not chosen yet')).toBeVisible();
});

test('guards same-turn duplicate retry and retry-versus-pagination overlap', async ({ page }) => {
  let retryRequests = 0;
  let pageRequests = 0;
  let releaseRetry: (() => void) | undefined;
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route('**/me/mistakes?limit=10*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('cursor')) return route.fulfill({ json: { items: [mistake(1)], nextCursor: cursor } });
    pageRequests++;
    return route.fulfill({ json: { items: [mistake(2)], nextCursor: null } });
  });
  await page.route('**/practice/retry-mistake', async (route) => {
    retryRequests++;
    await retryGate;
    return route.fulfill({ json: retryPresentation(1) });
  });
  await openFromSetup(page);
  await page.locator('.history-entry').first().locator(':scope > summary').click();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Practice this concept');
    button?.click();
    button?.click();
  });
  await expect(page.getByRole('button', { name: 'Starting concept practice' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeDisabled();
  await page.getByRole('button', { name: 'Load more' }).click({ force: true });
  expect(retryRequests).toBe(1);
  expect(pageRequests).toBe(0);
  releaseRetry?.();
  await expect(page.getByRole('heading', { name: 'Concept retry question 1' })).toBeVisible();
});

test('Back stays available during retry and ignores a late 401', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/mistakes?limit=10', (route) => route.fulfill({ json: { items: [mistake(1)], nextCursor: null } }));
  await page.route('**/practice/retry-mistake', async (route) => {
    await gate;
    return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
  });
  await openFromSetup(page);
  await page.locator('.history-entry').first().locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Practice this concept' }).click();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await page.waitForTimeout(100);
  await openNavigation(page, 'Mistakes', true); await expect(page.getByRole('button', { name: 'Mistakes', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
