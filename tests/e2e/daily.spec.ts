import { clickNavigation } from './navigation.ts';
import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'x'.repeat(43);
const ids = Array.from({ length: 8 }, (_, index) => `550e8400-e29b-41d4-a716-${(index + 1).toString().padStart(12, '0')}`);
const question = {
  id: ids[1],
  textThai: null,
  textExamEnglish: 'Choose the safest action.',
  textEnglish: 'Which action is safe today?',
  textRussian: 'Какое действие безопасно сегодня?',
  choices: ids.slice(2, 6).map((id, index) => ({
    id, key: ['D', 'B', 'A', 'C'][index], textThai: index === 0 ? 'ตัวเลือกไทย' : null,
    textEnglish: `Daily action ${index + 1}`, textRussian: index === 1 ? 'Русский вариант' : null,
  })),
};
const daily = { day: '2026-10-03', presentationId: ids[0], answered: false, question };
const answer = {
  presentationId: daily.presentationId,
  selectedChoiceId: ids[2],
  correctChoiceId: ids[4],
  isCorrect: false,
  explanationThai: null,
  explanationEnglish: 'Leave enough stopping distance.',
  explanationRussian: null,
  trapExplanationThai: null,
  trapExplanationEnglish: 'Do not follow too closely.',
  trapExplanationRussian: null,
};

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: ids[7], username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function enterDaily(page: Page) {
  await authenticate(page);
  await clickNavigation(page, 'Today’s question');
}

test('setup entry sends one exact guarded daily request and exposes loading before the safe question', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/daily', async (route) => {
    requests++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postDataJSON()).toEqual({});
    await gate;
    await route.fulfill({ json: daily });
  });
  await authenticate(page);
  expect(requests).toBe(0);
  await clickNavigation(page, 'Today’s question');
  await expect(page.getByRole('heading', { name: 'Today’s question' })).toBeVisible();
  await expect(page.locator('section.daily')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status')).toContainText('Loading today’s question');
  expect(requests).toBe(1);
  release?.();
  await expect(page.getByRole('heading', { name: question.textEnglish })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Answer choices' }).getByRole('radio')).toHaveCount(4);
  expect(requests).toBe(1);
});

test('ordinary practice entry opens daily without requesting an ordinary question', async ({ page }) => {
  let dailyRequests = 0;
  let ordinaryRequests = 0;
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.route('**/practice/next', (route) => { ordinaryRequests++; return route.fulfill({ status: 500 }); });
  await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ json: daily }); });
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await clickNavigation(page, 'Today’s question');
  await expect(page.getByRole('heading', { name: question.textEnglish })).toBeVisible();
  expect({ dailyRequests, ordinaryRequests }).toEqual({ dailyRequests: 1, ordinaryRequests: 0 });
});

test('submits captured daily IDs once and preserves the validated result without another assignment', async ({ page }) => {
  let dailyRequests = 0;
  let answerRequests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/daily', (route) => { dailyRequests++; return route.fulfill({ json: daily }); });
  await page.route('**/practice/answer', async (route) => {
    answerRequests++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postDataJSON()).toEqual({ presentationId: daily.presentationId, choiceId: ids[2] });
    await gate;
    await route.fulfill({ json: answer });
  });
  await enterDaily(page);
  await page.getByRole('radio', { name: /Daily action 1/ }).check();
  await page.getByRole('button', { name: 'Check answer' }).click({ clickCount: 2 });
  await expect(page.getByRole('button', { name: 'Please wait' })).toBeDisabled();
  expect(answerRequests).toBe(1);
  release?.();
  const result = page.getByRole('region', { name: 'Answer result' });
  await expect(result).toContainText('Incorrect');
  await expect(result).toContainText('Leave enough stopping distance.');
  await expect(result).toContainText('Do not follow too closely.');
  await expect(page.getByRole('radio', { name: /Daily action 1/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Daily action 3/ })).toHaveAccessibleName(/Correct answer/);
  expect({ dailyRequests, answerRequests }).toEqual({ dailyRequests: 1, answerRequests: 1 });
});

test('answered replay is explicitly complete and discloses no reconstructed result', async ({ page }) => {
  await page.route('**/practice/daily', (route) => route.fulfill({ json: { ...daily, answered: true } }));
  await enterDaily(page);
  await expect(page.getByRole('status')).toContainText('Today’s question is complete');
  await expect(page.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Answer choices' }).getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  await expect(page.getByText(/Correct answer|Your answer|Explanation unavailable/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open History' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Continue with ordinary practice' })).toBeEnabled();
});

test('language selection uses the accepted English fallback policy', async ({ page }) => {
  await page.route('**/practice/daily', (route) => route.fulfill({ json: daily }));
  await enterDaily(page);
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: question.textRussian ?? '' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Daily action 1/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Русский вариант/ })).toBeVisible();
  await page.getByRole('radio', { name: 'Thai', exact: true }).check();
  await expect(page.getByRole('heading', { name: question.textEnglish })).toBeVisible();
  await expect(page.getByRole('radio', { name: /ตัวเลือกไทย/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Daily action 2/ })).toBeVisible();
});

for (const status of [401, 404, 409, 500]) {
  test(`handles daily HTTP ${status} without rendering unsafe state`, async ({ page }) => {
    await page.route('**/practice/daily', (route) => route.fulfill({ status, json: { error: 'test' } }));
    await enterDaily(page);
    await expect(page.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
    if (status === 401) {
      await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    } else if (status === 409) {
      await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
      await expect(page.locator('.saved')).toContainText('Not chosen yet');
      await expect(page.getByRole('button', { name: 'Save vehicle' })).toBeDisabled();
    } else {
      await expect(page.getByText(status === 404 ? /No question is available/ : /could not load today’s question/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Retry today’s question' })).toBeEnabled();
    }
  });
}

for (const failure of ['transport', 'malformed'] as const) {
  test(`retries a ${failure} daily failure exactly once`, async ({ page }) => {
    let requests = 0;
    await page.route('**/practice/daily', (route: Route) => {
      requests++;
      if (requests === 1) return failure === 'transport'
        ? route.abort()
        : route.fulfill({ json: { ...daily, internal: 'hidden' } });
      return route.fulfill({ json: daily });
    });
    await enterDaily(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load today’s question');
    await page.getByRole('button', { name: 'Retry today’s question' }).click({ clickCount: 2 });
    await expect(page.getByRole('heading', { name: question.textEnglish })).toBeVisible();
    expect(requests).toBe(2);
  });
}

test('rejects a malformed answer without replacing the daily snapshot', async ({ page }) => {
  await page.route('**/practice/daily', (route) => route.fulfill({ json: daily }));
  await page.route('**/practice/answer', (route) => route.fulfill({ json: { ...answer, presentationId: ids[6] } }));
  await enterDaily(page);
  await page.getByRole('radio', { name: /Daily action 1/ }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not confirm');
  await expect(page.getByRole('heading', { name: question.textEnglish })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry answer' })).toBeEnabled();
});

for (const status of [401, 409]) {
  test(`handles daily answer HTTP ${status} without inventing a result`, async ({ page }) => {
    await page.route('**/practice/daily', (route) => route.fulfill({ json: daily }));
    await page.route('**/practice/answer', (route) => route.fulfill({ status, json: { error: 'test' } }));
    await enterDaily(page);
    await page.getByRole('radio', { name: /Daily action 1/ }).check();
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
    if (status === 401) {
      await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
    } else {
      await expect(page.getByRole('status')).toContainText('already submitted');
      await expect(page.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open History' })).toBeEnabled();
    }
  });
}

test('leaving while daily loads is immediate and ignores a late expiry', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/daily', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await authenticate(page);
  await clickNavigation(page, 'Today’s question');
  await clickNavigation(page, 'Vehicle setup');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await expect(page.getByRole('button', { name: 'Selection saved' })).toBeDisabled();
  await expect(page.getByRole('main').getByText('session has ended')).toHaveCount(0);
});

test('leaving during answer submission ignores the late result', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/daily', (route) => route.fulfill({ json: daily }));
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.route('**/practice/answer', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await enterDaily(page);
  await page.getByRole('radio', { name: /Daily action 1/ }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await clickNavigation(page, 'Ordinary practice');
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  release?.();
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
  await expect(page.getByRole('main').getByText('session has ended')).toHaveCount(0);
});
