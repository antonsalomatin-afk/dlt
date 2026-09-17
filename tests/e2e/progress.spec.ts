import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'p'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const validProgress = { answered: 7, correct: 5, incorrect: 2, accuracyPercent: 71 };
const metric = (page: Page, label: string) => page.locator('.progress-metric').getByText(label, { exact: true }).locator('..');
const renderCheckpoint = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

async function authenticate(page: Page, vehicle: 'CAR' | null = null) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"progress-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openFromSetup(page: Page, vehicle: 'CAR' | null = null) {
  await authenticate(page, vehicle);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
}

test('sends one exact no-store progress request and renders a nonempty accessible summary', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ method: string | undefined; hasBody: boolean; cache: RequestCache | undefined }> = [];
    Object.defineProperty(window, '__progressFetches', { value: records });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/me/progress')) records.push({
        method: init?.method,
        hasBody: init ? Object.prototype.hasOwnProperty.call(init, 'body') : false,
        cache: init?.cache,
      });
      return original(input, init);
    };
  });
  let requests = 0;
  await page.route('**/me/progress', (route) => {
    requests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postData()).toBeNull();
    return route.fulfill({ json: validProgress });
  });

  await openFromSetup(page);
  const summary = metric(page, 'Answered');
  await expect(summary).toContainText('7');
  await expect(metric(page, 'Correct')).toContainText('5');
  await expect(metric(page, 'Incorrect')).toContainText('2');
  await expect(metric(page, 'Accuracy')).toContainText('71%');
  await expect(page.locator('.progress-summary')).toHaveAttribute('aria-label', 'Lifetime progress summary');
  await renderCheckpoint(page);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __progressFetches: unknown }).__progressFetches)).toEqual([
    { method: 'GET', hasBody: false, cache: 'no-store' },
  ]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('shows the zero state and localizes the complete view in English, Russian, and Thai', async ({ page }) => {
  await page.route('**/me/progress', (route) => route.fulfill({ json: {
    answered: 0, correct: 0, incorrect: 0, accuracyPercent: null,
  } }));
  await openFromSetup(page);

  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await expect(page.getByText('No answers yet. Start practicing')).toBeVisible();
  await expect(metric(page, 'Accuracy')).toContainText('—');
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeVisible();
  await expect(metric(page, 'Всего ответов')).toContainText('0');
  await expect(page.getByText('Ответов пока нет')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад' })).toBeEnabled();
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.getByRole('heading', { name: 'ความคืบหน้า' })).toBeVisible();
  await expect(metric(page, 'ตอบแล้ว')).toContainText('0');
  await expect(page.getByText('ยังไม่มีคำตอบ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ย้อนกลับ' })).toBeEnabled();
});

test('opens without a selected vehicle and returns to setup', async ({ page }) => {
  await page.route('**/me/progress', (route) => route.fulfill({ json: validProgress }));
  await openFromSetup(page, null);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByText('Saved selection: Not chosen yet')).toBeVisible();
});

test('returns from progress opened in practice to a clean fresh practice view', async ({ page }) => {
  let categoryRequests = 0;
  await page.route('**/practice/categories', (route) => {
    categoryRequests++;
    return route.fulfill({ json: { categories: [] } });
  });
  await page.route('**/practice/next', (route) => route.fulfill({ json: {
    presentationId: '650e8400-e29b-41d4-a716-446655440000',
    question: {
      id: '750e8400-e29b-41d4-a716-446655440000', textThai: null, textExamEnglish: null,
      textEnglish: 'Question before progress', textRussian: null,
      choices: ['A', 'B', 'C', 'D'].map((key, index) => ({
        id: `850e8400-e29b-41d4-a716-44665544000${index}`, key,
        textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
      })),
    },
  } }));
  await page.route('**/me/progress', (route) => route.fulfill({ json: validProgress }));
  await authenticate(page, 'CAR');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Question before progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Question before progress' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
  expect(categoryRequests).toBe(2);
});

for (const failure of ['transport', 'http', 'malformed'] as const) {
  test(`shows safe guidance without partial metrics and retries a ${failure} failure`, async ({ page }) => {
    let requests = 0;
    await page.route('**/me/progress', (route) => {
      requests++;
      if (requests > 1) return route.fulfill({ json: validProgress });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      return route.fulfill({ json: { ...validProgress, extra: true } });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your progress');
    await expect(page.locator('.progress-summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry progress' }).click();
    await expect(metric(page, 'Answered')).toContainText('7');
    expect(requests).toBe(2);
  });
}

const invalidResponses = {
  missing: { answered: 3, correct: 2, incorrect: 1 },
  fractional: { answered: 3.5, correct: 2, incorrect: 1, accuracyPercent: 67 },
  unsafe: { answered: Number.MAX_SAFE_INTEGER + 1, correct: Number.MAX_SAFE_INTEGER, incorrect: 1, accuracyPercent: 100 },
  negative: { answered: 3, correct: -1, incorrect: 4, accuracyPercent: -33 },
  counts: { answered: 4, correct: 2, incorrect: 1, accuracyPercent: 50 },
  rounding: { answered: 3, correct: 2, incorrect: 1, accuracyPercent: 66 },
  zeroAccuracy: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: 0 },
  nullAccuracy: { answered: 3, correct: 2, incorrect: 1, accuracyPercent: null },
} as const;

for (const [name, invalid] of Object.entries(invalidResponses)) {
  test(`rejects the strict ${name} progress response and permits retry`, async ({ page }) => {
    let requests = 0;
    await page.route('**/me/progress', (route) => {
      requests++;
      return route.fulfill({ json: requests === 1 ? invalid : validProgress });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your progress');
    await expect(page.locator('.progress-summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry progress' }).click();
    await expect(metric(page, 'Accuracy')).toContainText('71%');
  });
}

test('a progress 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/me/progress', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFromSetup(page, 'CAR');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Progress', exact: true })).toHaveCount(0);
});

for (const stale of ['success', 'error', '401'] as const) {
  test(`a replacement mount stays authoritative after a stale ${stale}`, async ({ page }) => {
    const replacement = { answered: 4, correct: 1, incorrect: 3, accuracyPercent: 25 };
    let releaseOld: (() => void) | undefined;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    let resolveOldCompletion: (() => void) | undefined;
    let rejectOldCompletion: ((reason: unknown) => void) | undefined;
    const oldCompletion = new Promise<void>((resolve, reject) => {
      resolveOldCompletion = resolve;
      rejectOldCompletion = reject;
    });
    let requests = 0;
    await page.route('**/me/progress', async (route) => {
      requests++;
      if (requests !== 1) return route.fulfill({ json: replacement });
      await oldGate;
      try {
        if (stale === 'success') await route.fulfill({ json: validProgress });
        else await route.fulfill({ status: stale === '401' ? 401 : 500, json: { error: stale } });
        resolveOldCompletion?.();
      } catch (error) {
        rejectOldCompletion?.(error);
      }
    });

    await openFromSetup(page);
    await expect(page.getByRole('status')).toContainText('Loading your progress');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(metric(page, 'Answered')).toContainText('4');
    await expect(metric(page, 'Accuracy')).toContainText('25%');
    expect(requests).toBe(2);

    releaseOld?.();
    await oldCompletion;
    await renderCheckpoint(page);

    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(metric(page, 'Answered')).toContainText('4');
    await expect(metric(page, 'Correct')).toContainText('1');
    await expect(metric(page, 'Incorrect')).toContainText('3');
    await expect(metric(page, 'Accuracy')).toContainText('25%');
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    expect(requests).toBe(2);

    if (stale === '401') {
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByRole('button', { name: 'Progress', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    }
  });
}

test('the synchronous guard prevents overlapping retries', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route('**/me/progress', async (route: Route) => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 500, json: { error: 'test' } });
    await gate;
    return route.fulfill({ json: validProgress });
  });
  await openFromSetup(page);
  await expect(page.getByRole('button', { name: 'Retry progress' })).toBeEnabled();
  await page.evaluate(() => {
    const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Retry progress');
    retry?.click();
    retry?.click();
  });
  await expect(page.getByRole('status')).toContainText('Loading your progress');
  expect(requests).toBe(2);
  release?.();
  await expect(metric(page, 'Answered')).toContainText('7');
  expect(requests).toBe(2);
});
