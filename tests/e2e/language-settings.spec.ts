import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'l'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
type Language = 'ENGLISH' | 'RUSSIAN' | 'THAI';
const preference = (preferredLanguage: Language) => ({ preferredLanguage });
const renderCheckpoint = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

async function authenticate(page: Page, vehicle: 'CAR' | null = null) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"language-test",ready(){}}};',
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
  await page.getByRole('button', { name: 'Language settings' }).click();
}

test('loads one exact English default and states the future-message boundary', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ method: string | undefined; hasBody: boolean; cache: RequestCache | undefined }> = [];
    Object.defineProperty(window, '__languageFetches', { value: records });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/me/language')) records.push({
        method: init?.method,
        hasBody: init ? Object.prototype.hasOwnProperty.call(init, 'body') : false,
        cache: init?.cache,
      });
      return original(input, init);
    };
  });
  let requests = 0;
  await page.route('**/me/language', (route) => {
    requests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postData()).toBeNull();
    return route.fulfill({ json: preference('ENGLISH') });
  });

  await openFromSetup(page);
  await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Russian' })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Thai' })).not.toBeChecked();
  await expect(page.getByText('This preference applies to future messages.')).toBeVisible();
  await expect(page.getByText(/does not change the separate language selectors in practice, history, progress or mock exams/iu)).toBeVisible();
  await renderCheckpoint(page);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __languageFetches: unknown }).__languageFetches)).toEqual([
    { method: 'GET', hasBody: false, cache: 'no-store' },
  ]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('saves Russian and Thai through exact guarded requests and reloads server state', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ method: string | undefined; body: BodyInit | null | undefined; cache: RequestCache | undefined }> = [];
    Object.defineProperty(window, '__languageMutations', { value: records });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/me/language') && init?.method === 'PATCH') records.push({ method: init.method, body: init.body, cache: init.cache });
      return original(input, init);
    };
  });
  let saved: Language = 'ENGLISH';
  let gets = 0;
  let patches = 0;
  let releasePatch: (() => void) | undefined;
  const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  await page.route('**/me/language', async (route: Route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (request.method() === 'GET') {
      gets++;
      expect(request.postData()).toBeNull();
      return route.fulfill({ json: preference(saved) });
    }
    patches++;
    expect(request.method()).toBe('PATCH');
    expect(request.headers()['content-type']).toContain('application/json');
    const body = request.postDataJSON() as { preferredLanguage: Language };
    if (patches === 1) await patchGate;
    saved = body.preferredLanguage;
    return route.fulfill({ json: preference(saved) });
  });

  await openFromSetup(page, 'CAR');
  await page.getByRole('radio', { name: 'Russian' }).check();
  const save = page.getByRole('button', { name: 'Save language' });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Save language'));
    button?.click();
    button?.click();
  });
  await expect(page.getByRole('radio', { name: 'Russian' })).toBeDisabled();
  expect(patches).toBe(1);
  releasePatch?.();
  await expect(page.getByRole('status')).toContainText('Preference saved: Russian');

  await page.getByRole('radio', { name: 'Thai' }).check();
  await save.click();
  await expect(page.getByRole('status')).toContainText('Preference saved: Thai');
  expect(patches).toBe(2);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Language settings' }).click();
  await expect(page.getByRole('radio', { name: 'Thai' })).toBeChecked();
  expect(gets).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __languageMutations: unknown }).__languageMutations)).toEqual([
    { method: 'PATCH', body: JSON.stringify(preference('RUSSIAN')), cache: 'no-store' },
    { method: 'PATCH', body: JSON.stringify(preference('THAI')), cache: 'no-store' },
  ]);
});

test('does not PATCH an unchanged confirmed value', async ({ page }) => {
  let patches = 0;
  await page.route('**/me/language', (route) => {
    if (route.request().method() === 'PATCH') patches++;
    return route.fulfill({ json: preference('ENGLISH') });
  });
  await openFromSetup(page);
  await expect(page.getByRole('button', { name: 'Preference saved' })).toBeDisabled();
  await page.getByRole('radio', { name: 'English' }).check();
  await renderCheckpoint(page);
  expect(patches).toBe(0);
});

test('opens from practice and returns to clean practice without learning mutations', async ({ page }) => {
  let categories = 0;
  let learningMutations = 0;
  await page.route('**/practice/categories', (route) => {
    categories++;
    return route.fulfill({ json: { categories: [] } });
  });
  await page.route('**/practice/answer', (route) => { learningMutations++; return route.abort(); });
  await page.route('**/me/language', (route) => route.fulfill({ json: preference('RUSSIAN') }));
  await authenticate(page, 'CAR');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await page.getByRole('button', { name: 'Language settings' }).click();
  await expect(page.getByRole('radio', { name: 'Russian' })).toBeChecked();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
  expect(categories).toBe(2);
  expect(learningMutations).toBe(0);
});

for (const failure of ['transport', 'http', 'missing', 'unsupported', 'wrong-case', 'non-string', 'extra'] as const) {
  test(`hides choices and retries an initial ${failure} failure`, async ({ page }) => {
    let requests = 0;
    await page.route('**/me/language', (route) => {
      requests++;
      if (requests > 1) return route.fulfill({ json: preference('THAI') });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'missing') return route.fulfill({ json: {} });
      if (failure === 'unsupported') return route.fulfill({ json: { preferredLanguage: 'GERMAN' } });
      if (failure === 'wrong-case') return route.fulfill({ json: { preferredLanguage: 'english' } });
      if (failure === 'non-string') return route.fulfill({ json: { preferredLanguage: 1 } });
      return route.fulfill({ json: { ...preference('ENGLISH'), extra: true } });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your preferred language');
    await expect(page.getByRole('radio')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry language settings' }).click();
    await expect(page.getByRole('radio', { name: 'Thai' })).toBeChecked();
    expect(requests).toBe(2);
  });
}

for (const failure of ['transport', 'http', 'malformed', 'mismatch'] as const) {
  test(`preserves confirmed state and retries a ${failure} save failure`, async ({ page }) => {
    let patches = 0;
    await page.route('**/me/language', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: preference('ENGLISH') });
      patches++;
      if (patches > 1) return route.fulfill({ json: preference('RUSSIAN') });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'malformed') return route.fulfill({ json: { ...preference('RUSSIAN'), extra: true } });
      return route.fulfill({ json: preference('THAI') });
    });
    await openFromSetup(page);
    await page.getByRole('radio', { name: 'Russian' }).check();
    await page.getByRole('button', { name: 'Save language' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('last confirmed language is English');
    await expect(page.getByRole('radio', { name: 'Russian' })).toBeChecked();
    await page.getByRole('button', { name: 'Retry saving' }).click();
    await expect(page.getByRole('status')).toContainText('Preference saved: Russian');
    expect(patches).toBe(2);
  });
}

for (const method of ['GET', 'PATCH'] as const) {
  test(`a ${method} 401 expires the memory-only session`, async ({ page }) => {
    await page.route('**/me/language', (route) => route.request().method() === method
      ? route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
      : route.fulfill({ json: preference('ENGLISH') }));
    await openFromSetup(page, 'CAR');
    if (method === 'PATCH') {
      await page.getByRole('radio', { name: 'Thai' }).check();
      await page.getByRole('button', { name: 'Save language' }).click();
    }
    await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Language settings' })).toHaveCount(0);
  });
}

test('leaving invalidates a late response and replacement mount stays authoritative', async ({ page }) => {
  let releaseOld: (() => void) | undefined;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let requests = 0;
  await page.route('**/me/language', async (route) => {
    requests++;
    if (requests === 1) {
      await oldGate;
      return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    }
    return route.fulfill({ json: preference('THAI') });
  });
  await openFromSetup(page, 'CAR');
  await expect(page.getByRole('status')).toContainText('Loading your preferred language');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Language settings' }).click();
  await expect(page.getByRole('radio', { name: 'Thai' })).toBeChecked();
  releaseOld?.();
  await renderCheckpoint(page);
  await expect(page.getByRole('heading', { name: 'Language settings' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Thai' })).toBeChecked();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(requests).toBe(2);
});
