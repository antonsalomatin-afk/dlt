import { clickNavigation } from './navigation.ts';
import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'r'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const preference = (enabled: boolean) => ({ dailyQuestionReminderEnabled: enabled });
const renderCheckpoint = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

async function authenticate(page: Page, vehicle: 'CAR' | null = null) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"reminders-test",ready(){}}};',
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
  await clickNavigation(page, 'Reminder settings');
}

test('loads one exact default-off preference and documents the active opt-in delivery schedule', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ method: string | undefined; hasBody: boolean; cache: RequestCache | undefined }> = [];
    Object.defineProperty(window, '__reminderFetches', { value: records });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/me/reminders')) records.push({
        method: init?.method,
        hasBody: init ? Object.prototype.hasOwnProperty.call(init, 'body') : false,
        cache: init?.cache,
      });
      return original(input, init);
    };
  });
  let requests = 0;
  await page.route('**/me/reminders', (route) => {
    requests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postData()).toBeNull();
    return route.fulfill({ json: preference(false) });
  });

  await openFromSetup(page);
  const toggle = page.getByRole('checkbox', { name: 'Daily-question reminder preference' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Daily questions in Telegram', { exact: true })).toBeVisible();
  await expect(page.getByText(/11:00 Thailand time/)).toBeVisible();
  await expect(page.getByText(/Saving does not send a message immediately/)).toBeVisible();
  await renderCheckpoint(page);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __reminderFetches: unknown }).__reminderFetches)).toEqual([
    { method: 'GET', hasBody: false, cache: 'no-store' },
  ]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('enables, disables and reloads only server-confirmed values with exact guarded requests', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ method: string | undefined; body: BodyInit | null | undefined; cache: RequestCache | undefined }> = [];
    Object.defineProperty(window, '__reminderMutations', { value: records });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/me/reminders') && init?.method === 'PATCH') records.push({
        method: init.method, body: init.body, cache: init.cache,
      });
      return original(input, init);
    };
  });
  let saved = false;
  let getRequests = 0;
  let patchRequests = 0;
  let releasePatch: (() => void) | undefined;
  const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  await page.route('**/me/reminders', async (route: Route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (request.method() === 'GET') {
      getRequests++;
      expect(request.postData()).toBeNull();
      return route.fulfill({ json: preference(saved) });
    }
    patchRequests++;
    expect(request.method()).toBe('PATCH');
    expect(request.headers()['content-type']).toContain('application/json');
    const body = request.postDataJSON() as unknown;
    expect(body).toEqual(preference(!saved));
    if (patchRequests === 1) await patchGate;
    saved = (body as { dailyQuestionReminderEnabled: boolean }).dailyQuestionReminderEnabled;
    return route.fulfill({ json: preference(saved) });
  });

  await openFromSetup(page, 'CAR');
  const toggle = page.getByRole('checkbox', { name: 'Daily-question reminder preference' });
  await expect(toggle).not.toBeChecked();
  await page.evaluate(() => {
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    checkbox?.click();
    checkbox?.click();
  });
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toBeChecked();
  expect(patchRequests).toBe(1);
  releasePatch?.();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('status')).toContainText('enabled');

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('status')).toContainText('disabled');
  expect(patchRequests).toBe(2);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await clickNavigation(page, 'Reminder settings');
  await expect(page.getByRole('checkbox', { name: 'Daily-question reminder preference' })).not.toBeChecked();
  expect(getRequests).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __reminderMutations: unknown }).__reminderMutations)).toEqual([
    { method: 'PATCH', body: JSON.stringify(preference(true)), cache: 'no-store' },
    { method: 'PATCH', body: JSON.stringify(preference(false)), cache: 'no-store' },
  ]);
});

test('opens from practice and returns to a clean practice destination without learning mutations', async ({ page }) => {
  let categories = 0;
  let learningMutations = 0;
  await page.route('**/practice/categories', (route) => {
    categories++;
    return route.fulfill({ json: { categories: [] } });
  });
  await page.route('**/practice/answer', (route) => { learningMutations++; return route.abort(); });
  await page.route('**/me/reminders', (route) => route.fulfill({ json: preference(true) }));
  await authenticate(page, 'CAR');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await clickNavigation(page, 'Reminder settings');
  await expect(page.getByRole('checkbox', { name: 'Daily-question reminder preference' })).toBeChecked();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  expect(categories).toBe(2);
  expect(learningMutations).toBe(0);
});

for (const failure of ['transport', 'http', 'missing', 'non-boolean', 'extra'] as const) {
  test(`hides the control and retries an initial ${failure} failure`, async ({ page }) => {
    let requests = 0;
    await page.route('**/me/reminders', (route) => {
      requests++;
      if (requests > 1) return route.fulfill({ json: preference(true) });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'missing') return route.fulfill({ json: {} });
      if (failure === 'non-boolean') return route.fulfill({ json: { dailyQuestionReminderEnabled: 'true' } });
      return route.fulfill({ json: { ...preference(true), extra: true } });
    });
    await openFromSetup(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your reminder preference');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry reminder settings' }).click();
    await expect(page.getByRole('checkbox', { name: 'Daily-question reminder preference' })).toBeChecked();
    expect(requests).toBe(2);
  });
}

for (const failure of ['transport', 'http', 'malformed', 'mismatch'] as const) {
  test(`preserves confirmed state and retries a ${failure} save failure`, async ({ page }) => {
    let patches = 0;
    await page.route('**/me/reminders', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: preference(false) });
      patches++;
      if (patches > 1) return route.fulfill({ json: preference(true) });
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'malformed') return route.fulfill({ json: { ...preference(true), extra: true } });
      return route.fulfill({ json: preference(false) });
    });
    await openFromSetup(page);
    const toggle = page.getByRole('checkbox', { name: 'Daily-question reminder preference' });
    await toggle.click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('last confirmed choice is still shown');
    await expect(toggle).not.toBeChecked();
    await page.getByRole('button', { name: 'Retry saving' }).click();
    await expect(toggle).toBeChecked();
    expect(patches).toBe(2);
  });
}

for (const method of ['GET', 'PATCH'] as const) {
  test(`a ${method} 401 expires the memory-only session`, async ({ page }) => {
    await page.route('**/me/reminders', (route) => route.request().method() === method
      ? route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
      : route.fulfill({ json: preference(false) }));
    await openFromSetup(page, 'CAR');
    if (method === 'PATCH') await page.getByRole('checkbox', { name: 'Daily-question reminder preference' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Reminder settings' })).toHaveCount(0);
  });
}

test('leaving invalidates a late response and a replacement mount remains authoritative', async ({ page }) => {
  let releaseOld: (() => void) | undefined;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let requests = 0;
  await page.route('**/me/reminders', async (route) => {
    requests++;
    if (requests === 1) {
      await oldGate;
      return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    }
    return route.fulfill({ json: preference(true) });
  });
  await openFromSetup(page, 'CAR');
  await expect(page.getByRole('status')).toContainText('Loading your reminder preference');
  await page.getByRole('button', { name: 'Back' }).click();
  await clickNavigation(page, 'Reminder settings');
  await expect(page.getByRole('checkbox', { name: 'Daily-question reminder preference' })).toBeChecked();
  releaseOld?.();
  await renderCheckpoint(page);
  await expect(page.getByRole('heading', { name: 'Reminder settings' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Daily-question reminder preference' })).toBeChecked();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(requests).toBe(2);
});
