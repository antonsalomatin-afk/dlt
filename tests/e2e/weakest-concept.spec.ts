import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'w'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const conceptId = 'e50e8400-e29b-41d4-a716-000000000001';
const categoryId = 'e50e8400-e29b-41d4-a716-000000000002';
const weakest = {
  conceptId, slug: 'reduced-grip', nameThai: 'การยึดเกาะ', nameEnglish: 'Reduced grip', nameRussian: 'Сцепление',
  answered: 4, correct: 1, incorrect: 3, accuracyPercent: 25,
};
const strongest = {
  conceptId: 'e50e8400-e29b-41d4-a716-000000000003', slug: 'signs', nameThai: 'ป้าย', nameEnglish: 'Signs', nameRussian: 'Знаки',
  answered: 2, correct: 2, incorrect: 0, accuracyPercent: 100,
};
const conceptProgress = {
  concepts: [weakest, strongest],
  unassigned: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: null },
  total: { answered: 6, correct: 3, incorrect: 3, accuracyPercent: 50 },
};
const categories = { categories: [{
  id: categoryId, slug: 'signs-category', nameThai: 'ป้ายจราจร', nameEnglish: 'Signs category', nameRussian: 'Категория знаков', questionCount: 4,
}] };
function presentation(label: string) {
  return {
    presentationId: `f50e8400-e29b-41d4-a716-${String(label.length).padStart(12, '0')}`,
    question: {
      id: `f60e8400-e29b-41d4-a716-${String(label.length).padStart(12, '0')}`,
      textThai: null, textExamEnglish: null, textEnglish: label, textRussian: null,
      choices: ['A', 'B', 'C', 'D'].map((key, index) => ({
        id: `f70e8400-e29b-41d4-a71${index}-${String(label.length).padStart(12, '0')}`,
        key, textThai: null, textEnglish: `Choice ${key}`, textRussian: null,
      })),
    },
  };
}

async function authenticate(page: Page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"weakest-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: 'CAR' },
  } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openPractice(page: Page) {
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
}

const weakestOption = (page: Page) => page.getByRole('radio', { name: /Weakest rule/u });

test('offers the weakest rule and sends exactly its conceptId on first and continued requests', async ({ page }) => {
  const bodies: unknown[] = [];
  let conceptRequests = 0;
  await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
  await page.route('**/me/progress/concepts', (route) => {
    conceptRequests++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    return route.fulfill({ json: conceptProgress });
  });
  await page.route('**/practice/next', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: presentation(`Grip question ${bodies.length}`) });
  });

  await openPractice(page);
  await expect(page.getByText('Weakest rule: Reduced grip')).toBeVisible();
  await expect(page.getByText('25% correct so far')).toBeVisible();
  await weakestOption(page).check();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Grip question 1' })).toBeVisible();
  await expect(weakestOption(page)).toBeChecked();
  await page.getByRole('radio', { name: 'A. Choice A' }).check();
  await page.route('**/practice/answer', (route) => {
    const body = route.request().postDataJSON() as { presentationId: string; choiceId: string };
    return route.fulfill({ json: {
      presentationId: body.presentationId, selectedChoiceId: body.choiceId, correctChoiceId: body.choiceId, isCorrect: true,
      explanationThai: null, explanationEnglish: 'Because grip matters.', explanationRussian: null,
      trapExplanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null,
    } });
  });
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('heading', { name: 'Correct' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Grip question 2' })).toBeVisible();

  expect(bodies).toEqual([{ conceptId }, { conceptId }]);
  expect(conceptRequests).toBe(1);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('keeps one scope active and locks it while a question is unanswered', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: conceptProgress }));
  await page.route('**/practice/next', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: presentation(`Scoped question ${bodies.length}`) });
  });
  await openPractice(page);

  await weakestOption(page).check();
  await expect(page.getByRole('radio', { name: 'All categories' })).not.toBeChecked();
  await page.getByRole('radio', { name: /Signs category/u }).check();
  await expect(weakestOption(page)).not.toBeChecked();
  await weakestOption(page).check();
  await expect(page.getByRole('radio', { name: /Signs category/u })).not.toBeChecked();

  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Scoped question 1' })).toBeVisible();
  await expect(page.locator('.practice-scope input').first()).toBeDisabled();
  expect(bodies).toEqual([{ conceptId }]);
});

test('names the rule when the weakest concept has nothing available and keeps the scope', async ({ page }) => {
  await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: conceptProgress }));
  let requests = 0;
  await page.route('**/practice/next', (route) => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 404, json: { error: 'No questions available' } });
    return route.fulfill({ json: presentation('Recovered question') });
  });
  await openPractice(page);
  await weakestOption(page).check();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('No questions are available for Reduced grip');
  await expect(weakestOption(page)).toBeChecked();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Recovered question' })).toBeVisible();
});

test('localizes the weakest rule label in Russian and Thai', async ({ page }) => {
  await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ json: conceptProgress }));
  await openPractice(page);
  await expect(page.getByText('Weakest rule: Reduced grip')).toBeVisible();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByText('Weakest rule: Сцепление')).toBeVisible();
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.getByText('Weakest rule: การยึดเกาะ')).toBeVisible();
});

for (const failure of ['transport', 'http', 'malformed', 'empty'] as const) {
  test(`hides the weakest rule and keeps practice usable when concept progress is ${failure}`, async ({ page }) => {
    await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
    await page.route('**/me/progress/concepts', (route) => {
      if (failure === 'transport') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
      if (failure === 'malformed') return route.fulfill({ json: { ...conceptProgress, extra: true } });
      return route.fulfill({ json: { concepts: [], unassigned: conceptProgress.unassigned, total: { answered: 0, correct: 0, incorrect: 0, accuracyPercent: null } } });
    });
    const bodies: unknown[] = [];
    await page.route('**/practice/next', (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ json: presentation('Unscoped question') });
    });
    await openPractice(page);
    await expect(page.getByRole('radio', { name: 'All categories' })).toBeChecked();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Get a question' }).click();
    await expect(page.getByRole('heading', { name: 'Unscoped question' })).toBeVisible();
    await expect(weakestOption(page)).toHaveCount(0);
    expect(bodies).toEqual([{}]);
  });
}

test('a concept progress 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
  await page.route('**/me/progress/concepts', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('leaving practice ignores a delayed concept progress response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false;
  await page.route('**/practice/categories', (route) => route.fulfill({ json: categories }));
  await page.route('**/me/progress/concepts', async (route: Route) => {
    await gate;
    try { await route.fulfill({ json: conceptProgress }); } catch { /* the page may have detached */ }
    completed = true;
  });
  await openPractice(page);
  await page.getByRole('button', { name: 'Change vehicle' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await expect.poll(() => completed).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await expect(weakestOption(page)).toHaveCount(0);
});
