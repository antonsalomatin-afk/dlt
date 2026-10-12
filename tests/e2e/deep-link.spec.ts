import { expect, test, type Page } from '@playwright/test';

const token = 'x'.repeat(43);
const question = {
  id: '550e8400-e29b-41d4-a716-446655440020', textThai: null, textExamEnglish: null,
  textEnglish: 'Daily deep-link question', textRussian: null,
  choices: ['550e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440024']
    .map((id, index) => ({ id, key: ['A', 'B', 'C', 'D'][index], textThai: null, textEnglish: `Choice ${index + 1}`, textRussian: null })),
};

async function openFromTelegram(page: Page, startParameter: string, vehicle: 'CAR' | null, url = '/') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(startParameter)},ready(){}}};`,
  }));
  await page.route('**/auth/telegram', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ initData: startParameter });
    await route.fulfill({ json: { token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: '550e8400-e29b-41d4-a716-446655440000', username: null, firstName: null, selectedVehicleType: vehicle } } });
  });
  await page.goto(url);
}

test('valid daily startapp routes an authenticated learner with a vehicle directly to daily', async ({ page }) => {
  let dailyRequests = 0;
  await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ json: { day: '2026-10-12', presentationId: '550e8400-e29b-41d4-a716-446655440010', answered: false, question } }); });
  await openFromTelegram(page, 'auth_date=1&start_param=daily&hash=signed', 'CAR');
  await expect(page.getByRole('heading', { name: 'Today’s question' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily deep-link question' })).toBeVisible();
  expect(dailyRequests).toBe(1);
});

test('daily intent falls back to setup until vehicle selection exists', async ({ page }) => {
  let dailyRequests = 0;
  await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ json: {} }); });
  await openFromTelegram(page, 'start_param=daily', null);
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  expect(dailyRequests).toBe(0);
});

test('browser query parameters and unknown start values cannot create daily navigation', async ({ page }) => {
  let dailyRequests = 0;
  await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ json: {} }); });
  await openFromTelegram(page, 'start_param=unknown', 'CAR', '/?tgWebAppStartParam=daily');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  expect(dailyRequests).toBe(0);
});
