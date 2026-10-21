import { expect, test, type Page } from '@playwright/test';

const token = 'x'.repeat(43);
const question = {
  id: '550e8400-e29b-41d4-a716-446655440020', textThai: null, textExamEnglish: null,
  textEnglish: 'Daily deep-link question', textRussian: null,
  choices: ['550e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440024']
    .map((id, index) => ({ id, key: ['A', 'B', 'C', 'D'][index], textThai: null, textEnglish: `Choice ${index + 1}`, textRussian: null })),
};

async function openFromTelegram(page: Page, startParameter: string, vehicle: 'CAR' | 'MOTORCYCLE' | null, url = '/') {
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
  await expect(page.locator('.vehicle-context')).toHaveText('Saved vehicle: Car');
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

const presentationId = '550e8400-e29b-41d4-a716-446655440010';

for (const [vehicle, label] of [[null, 'Not selected'], ['MOTORCYCLE', 'Motorcycle']] as const) {
test(`saved link opens an old snapshot with saved vehicle ${label} and requires explicit confirmation`, async ({ page }) => {
  let dailyRequests = 0;
  let answerRequests = 0;
  await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ status: 500 }); });
  await page.route('**/practice/presentation', (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postDataJSON()).toEqual({ presentationId });
    return route.fulfill({ json: { day: '2026-01-01', presentationId, answered: false, question } });
  });
  await page.route('**/practice/answer', (route) => {
    answerRequests++;
    expect(route.request().postDataJSON()).toEqual({ presentationId, choiceId: question.choices[1]?.id });
    return route.fulfill({ json: { presentationId, selectedChoiceId: question.choices[1]?.id, correctChoiceId: question.choices[0]?.id, isCorrect: false,
      explanationThai: null, explanationEnglish: 'Saved explanation.', explanationRussian: null,
      trapExplanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null,
    } });
  });
  await openFromTelegram(page, `start_param=question_${presentationId}`, vehicle);
  await expect(page.getByRole('heading', { name: 'Linked question' })).toBeVisible();
  await expect(page.getByText('SAVED QUESTION · 2026-01-01')).toBeVisible();
  await expect(page.locator('.vehicle-context')).toHaveText(`Saved vehicle: ${label}`);
  await page.getByRole('radio', { name: 'A. Choice 1' }).check();
  await page.getByRole('radio', { name: 'B. Choice 2' }).check();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radio', { name: 'B. Choice 2' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Daily deep-link question' })).toBeVisible();
  await expect(page.locator('.vehicle-context')).toHaveText(`Saved vehicle: ${label}`);
  expect(answerRequests).toBe(0);
  await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check answer' }).click({ clickCount: 2 });
  await expect(page.getByRole('region', { name: 'Answer result' })).toContainText('Saved explanation.');
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  expect({ answerRequests, dailyRequests }).toEqual({ answerRequests: 1, dailyRequests: 0 });
});
}

test('completed saved link shows history and practice without an answer submission', async ({ page }) => {
  let answerRequests = 0;
  await page.route('**/practice/presentation', (route) => route.fulfill({ json: { day: '2026-01-01', presentationId, answered: true, question } }));
  await page.route('**/practice/answer', (route) => { answerRequests++; return route.fulfill({ status: 500 }); });
  await openFromTelegram(page, `start_param=question_${presentationId}`, 'CAR');
  await expect(page.getByText('This question is complete.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open History', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with ordinary practice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check answer' })).toHaveCount(0);
  expect(answerRequests).toBe(0);
});

for (const link of ['foreign', 'malformed', 'mismatch'] as const) {
  test(`${link} saved link shows safe guidance without today's assignment`, async ({ page }) => {
    let dailyRequests = 0;
    let linkedRequests = 0;
    await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ status: 500 }); });
    await page.route('**/practice/presentation', (route) => {
      linkedRequests++;
      return link === 'mismatch'
        ? route.fulfill({ json: { day: '2026-01-01', presentationId: '550e8400-e29b-41d4-a716-446655440099', answered: false, question } })
        : route.fulfill({ status: 404, json: { error: 'Presentation not found' } });
    });
    await openFromTelegram(page, `start_param=question_${link === 'malformed' ? 'bad' : presentationId}`, 'CAR');
    await expect(page.getByText(link === 'mismatch' ? 'We could not load this question.' : link === 'malformed' ? 'This question link is invalid.' : 'This question link is unavailable.', { exact: false })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'A. Choice 1' })).toHaveCount(0);
    expect(dailyRequests).toBe(0);
    expect(linkedRequests).toBe(link === 'malformed' ? 0 : 1);
  });
}

test('saved link cannot load a presentation when normal Telegram authentication fails', async ({ page }) => {
  let linkedRequests = 0;
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:'start_param=question_${presentationId}',ready(){}}};` }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ status: 401 }));
  await page.route('**/practice/presentation', (route) => { linkedRequests++; return route.fulfill({ status: 500 }); });
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your Telegram sign-in has expired.');
  expect(linkedRequests).toBe(0);
});
