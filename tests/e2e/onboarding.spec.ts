import { expect, test, type Page } from '@playwright/test';

const user = { id: '550e8400-e29b-41d4-a716-446655440000', username: 'test', firstName: 'Test', selectedVehicleType: null };
const login = { token: 'x'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', user };
async function telegram(page: Page, data = 'signed-test-data') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(data)}, ready() { document.documentElement.dataset.telegramReady = 'yes'; } } };` }));
}
async function authenticate(page: Page, vehicle: 'CAR' | 'MOTORCYCLE' | null = null) {
  await telegram(page);
  await page.route('**/auth/telegram', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ initData: 'signed-test-data' });
    await route.fulfill({ json: { ...login, user: { ...user, selectedVehicleType: vehicle } } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

test('missing Telegram data provides launch guidance without login request', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/auth/telegram')) requests++; });
  await telegram(page, ''); await page.goto('/');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Open ThaiDLT from');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(requests).toBe(0);
});

test('script failure can be retried', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.abort());
  await page.goto('/'); await expect(page.getByRole('main').getByRole('alert')).toContainText('could not connect');
  await page.unroute('https://telegram.org/js/telegram-web-app.js'); await telegram(page);
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: login }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
});

test('login, save and change vehicle with in-memory credentials', async ({ page }, testInfo) => {
  await authenticate(page);
  await expect(page.locator('html')).toHaveAttribute('data-telegram-ready', 'yes');
  let count = 0;
  await page.route('**/me/vehicle', async (route) => {
    count++;
    expect(route.request().headers().authorization).toBe(`Bearer ${login.token}`);
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({ vehicleType: count === 1 ? 'CAR' : 'MOTORCYCLE' });
    await route.fulfill({ json: { ...user, selectedVehicleType: count === 1 ? 'CAR' : 'MOTORCYCLE' } });
  });
  await page.getByRole('radio', { name: 'Car', exact: true }).check();
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('status')).toContainText('Saved selection: Car');
  await page.getByRole('radio', { name: 'Motorcycle' }).check();
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('status')).toContainText('Saved selection: Motorcycle');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
  expect(count).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('mobile-onboarding.png'), fullPage: true });
});

test('preserves existing preference and prevents pending duplicate saves', async ({ page }) => {
  await authenticate(page, 'MOTORCYCLE');
  await expect(page.getByRole('radio', { name: 'Motorcycle' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Selection saved' })).toBeDisabled();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  await page.route('**/me/vehicle', async (route) => { count++; await gate; await route.fulfill({ json: { ...user, selectedVehicleType: 'CAR' } }); });
  await page.getByRole('radio', { name: 'Car', exact: true }).check();
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('button', { name: 'Saving' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Motorcycle' })).toBeDisabled();
  release?.(); await expect(page.getByRole('status')).toContainText('Saved selection: Car'); expect(count).toBe(1);
});

for (const failure of ['malformed', 'transport', 'http'] as const) {
  test(`rejects ${failure} login response`, async ({ page }) => {
    await telegram(page);
    await page.route('**/auth/telegram', (route) => failure === 'transport' ? route.abort() : route.fulfill({ status: failure === 'http' ? 500 : 200, json: { ...login, token: 'invalid' } }));
    await page.goto('/'); await expect(page.getByRole('main').getByRole('alert')).toContainText('could not connect');
    await expect(page.getByRole('radio')).toHaveCount(0);
  });
  test(`${failure} save retains confirmed preference and permits retry`, async ({ page }) => {
    await authenticate(page, 'CAR');
    await page.route('**/me/vehicle', (route) => failure === 'transport' ? route.abort() : route.fulfill({ status: failure === 'http' ? 500 : 200, json: { ...user, selectedVehicleType: 'PLANE' } }));
    await page.getByRole('radio', { name: 'Motorcycle' }).check(); await page.getByRole('button', { name: 'Save vehicle' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not confirm');
    await expect(page.locator('.saved')).toHaveText('Saved selection: Car');
    await expect(page.getByRole('button', { name: 'Save vehicle' })).toBeEnabled();
  });
}

test('protected 401 clears session and offers reopening guidance', async ({ page }) => {
  await authenticate(page, 'CAR');
  await page.route('**/me/vehicle', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await page.getByRole('radio', { name: 'Motorcycle' }).check(); await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended'); await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

