import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'c'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const conceptId = (index: number) => `d50e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`;
const concept = (index: number, slug: string, english: string, correct: number, incorrect: number) => ({
  conceptId: conceptId(index), slug, nameThai: `ไทย ${english}`, nameEnglish: english, nameRussian: `Рус ${english}`,
  answered: correct + incorrect, correct, incorrect, accuracyPercent: Math.round((correct / (correct + incorrect)) * 100),
});
const summary = (correct: number, incorrect: number) => ({
  answered: correct + incorrect, correct, incorrect,
  accuracyPercent: correct + incorrect === 0 ? null : Math.round((correct / (correct + incorrect)) * 100),
});
const grip = concept(1, 'reduced-grip', 'Reduced grip', 0, 3);
const hazards = concept(2, 'hidden-hazards', 'Hidden hazards', 2, 2);
const signs = concept(3, 'regulatory-signs', 'Regulatory signs', 3, 0);
const validProgress = { concepts: [grip, hazards, signs], unassigned: summary(1, 1), total: summary(6, 6) };
const metric = (page: Page, label: string) => page.locator('.progress-metric').getByText(label, { exact: true }).locator('..');
const renderCheckpoint = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

async function authenticate(page: Page, vehicle: 'CAR' | null = null) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"concepts-test",ready(){}}};',
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
  await page.getByRole('button', { name: 'Concepts', exact: true }).click();
}

test('sends one exact no-store request and renders concepts weakest first', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ method: string | undefined; hasBody: boolean; cache: RequestCache | undefined }> = [];
    Object.defineProperty(window, '__conceptFetches', { value: records });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/me/progress/concepts')) records.push({
        method: init?.method,
        hasBody: init ? Object.prototype.hasOwnProperty.call(init, 'body') : false,
        cache: init?.cache,
      });
      return original(input, init);
    };
  });
  let requests = 0;
  await page.route('**/me/progress/concepts', (route) => {
    requests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postData()).toBeNull();
    return route.fulfill({ json: validProgress });
  });

  await openFromSetup(page);
  await expect(page.getByRole('heading', { name: 'Concepts' })).toBeVisible();
  await expect(metric(page, 'Answered')).toContainText('12');
  await expect(metric(page, 'Correct')).toContainText('6');
  await expect(metric(page, 'Accuracy')).toContainText('50%');
  const rows = page.getByRole('list', { name: 'Practice accuracy by concept' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Reduced grip');
  await expect(rows.nth(0)).toContainText('0%');
  await expect(rows.nth(0)).toContainText('0 of 3 correct');
  await expect(rows.nth(1)).toContainText('Hidden hazards');
  await expect(rows.nth(1)).toContainText('50%');
  await expect(rows.nth(2)).toContainText('Regulatory signs');
  await expect(rows.nth(2)).toContainText('100%');
  await expect(page.locator('.concept-unassigned')).toContainText('Not grouped yet');
  await expect(page.locator('.concept-unassigned')).toContainText('1 of 2 correct');
  await renderCheckpoint(page);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __conceptFetches: unknown }).__conceptFetches)).toEqual([
    { method: 'GET', hasBody: false, cache: 'no-store' },
  ]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('hides the unassigned bucket when it has no answers and shows the empty state', async ({ page }) => {
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: {
    concepts: [grip], unassigned: summary(0, 0), total: summary(0, 3),
  } }));
  await openFromSetup(page);
  await expect(page.getByRole('list', { name: 'Practice accuracy by concept' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.concept-unassigned')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.unroute('**/me/progress/concepts');
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: {
    concepts: [], unassigned: summary(0, 0), total: summary(0, 0),
  } }));
  await page.getByRole('button', { name: 'Concepts', exact: true }).click();
  await expect(page.getByText('No answers yet. Practise a few questions')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Practice accuracy by concept' })).toHaveCount(0);
  await expect(metric(page, 'Accuracy')).toContainText('—');
});

test('localizes the view and concept names in English, Russian and Thai', async ({ page }) => {
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: validProgress }));
  await openFromSetup(page);
  await expect(page.getByRole('heading', { name: 'Concepts' })).toBeVisible();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: 'Правила' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Точность практики по правилам' }).getByRole('listitem').nth(0)).toContainText('Рус Reduced grip');
  await expect(metric(page, 'Всего ответов')).toContainText('12');
  await expect(page.getByText('0 из 3 правильно')).toBeVisible();
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.getByRole('heading', { name: 'กฎ', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'ความแม่นยำในการฝึกแยกตามกฎ' }).getByRole('listitem').nth(0)).toContainText('ไทย Reduced grip');
  await expect(page.getByRole('button', { name: 'ย้อนกลับ' })).toBeEnabled();
});

test('opens without a selected vehicle and returns to setup', async ({ page }) => {
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: validProgress }));
  await openFromSetup(page, null);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.getByText('Saved selection: Not chosen yet')).toBeVisible();
});

test('returns from concepts opened in practice to a clean fresh practice view', async ({ page }) => {
  let categoryRequests = 0;
  await page.route('**/practice/categories', (route) => { categoryRequests++; return route.fulfill({ json: { categories: [] } }); });
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: validProgress }));
  await authenticate(page, 'CAR');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await page.getByRole('button', { name: 'Concepts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Concepts' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
  expect(categoryRequests).toBe(2);
});

for (const failure of ['transport', 'http', 'malformed'] as const) {
  test(`shows safe guidance without partial rows and retries a ${failure} failure`, async ({ page }) => {
    let requests = 0;
    await page.route('**/me/progress/concepts', (route) => {
      requests++;
      if (requests > 1) return route.fulfill({ json: validProgress });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      return route.fulfill({ json: { ...validProgress, extra: true } });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your concepts');
    await expect(page.locator('.concept-list')).toHaveCount(0);
    await expect(page.locator('.progress-summary')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry concepts' }).click();
    await expect(metric(page, 'Answered')).toContainText('12');
    expect(requests).toBe(2);
  });
}

const invalidResponses = {
  ordering: { ...validProgress, concepts: [signs, hazards, grip] },
  duplicate: { ...validProgress, concepts: [grip, { ...hazards, conceptId: grip.conceptId }, signs] },
  total: { ...validProgress, total: summary(7, 6) },
  counts: { ...validProgress, concepts: [{ ...grip, correct: 1 }, hazards, signs] },
  accuracy: { ...validProgress, concepts: [{ ...grip, accuracyPercent: 1 }, hazards, signs] },
  zeroAnswers: { concepts: [{ ...grip, answered: 0, correct: 0, incorrect: 0, accuracyPercent: 0 }], unassigned: summary(0, 0), total: summary(0, 0) },
  blankName: { ...validProgress, concepts: [{ ...grip, nameEnglish: ' ' }, hazards, signs] },
  missingUnassigned: { concepts: [grip, hazards, signs], total: summary(6, 6) },
} as const;

for (const [name, invalid] of Object.entries(invalidResponses)) {
  test(`rejects a ${name} concept response and permits retry`, async ({ page }) => {
    let requests = 0;
    await page.route('**/me/progress/concepts', (route) => {
      requests++;
      return route.fulfill({ json: requests === 1 ? invalid : validProgress });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your concepts');
    await expect(page.locator('.concept-list')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry concepts' }).click();
    await expect(page.getByRole('list', { name: 'Practice accuracy by concept' }).getByRole('listitem')).toHaveCount(3);
  });
}

test('a concepts 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFromSetup(page, 'CAR');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Concepts', exact: true })).toHaveCount(0);
});

test('leaving concepts is immediate and ignores a delayed response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false;
  await page.route('**/me/progress/concepts', async (route: Route) => {
    await gate;
    try { await route.fulfill({ json: validProgress }); } catch { /* the page may have detached */ }
    completed = true;
  });
  await openFromSetup(page);
  await expect(page.getByRole('status')).toContainText('Loading your concepts');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await expect.poll(() => completed).toBe(true);
  await renderCheckpoint(page);
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(page.locator('.concept-list')).toHaveCount(0);
});

test('the synchronous guard prevents overlapping retries', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route('**/me/progress/concepts', async (route: Route) => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 500, json: { error: 'test' } });
    await gate;
    return route.fulfill({ json: validProgress });
  });
  await openFromSetup(page);
  await expect(page.getByRole('button', { name: 'Retry concepts' })).toBeEnabled();
  await page.evaluate(() => {
    const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Retry concepts');
    retry?.click();
    retry?.click();
  });
  await expect(page.getByRole('status')).toContainText('Loading your concepts');
  expect(requests).toBe(2);
  release?.();
  await expect(metric(page, 'Answered')).toContainText('12');
  expect(requests).toBe(2);
});
