import { expect, test, type Page } from '@playwright/test';

const token = 'f'.repeat(43);
const userId = '950e8400-e29b-41d4-a716-446655440000';
const choiceIds = [
  '950e8400-e29b-41d4-a716-446655440001',
  '950e8400-e29b-41d4-a716-446655440002',
  '950e8400-e29b-41d4-a716-446655440003',
  '950e8400-e29b-41d4-a716-446655440004',
] as const;
const presentationId = '950e8400-e29b-41d4-a716-446655440010';
const questionId = '950e8400-e29b-41d4-a716-446655440020';
const question = {
  id: questionId,
  textThai: null,
  textExamEnglish: 'Choose the safest action.',
  textEnglish: 'Which action is safe?',
  textRussian: 'Какое действие безопасно?',
  choices: choiceIds.map((id, index) => ({
    id,
    key: (['D', 'B', 'A', 'C'] as const)[index],
    textThai: index === 1 ? 'ตัวเลือกไทย' : null,
    textEnglish: `Action ${index + 1}`,
    textRussian: index === 0 ? 'Русский вариант' : null,
  })),
};
const presentation = { presentationId, question };
const cursor = Buffer.from(JSON.stringify({
  v: 1, updatedAt: '2026-09-16T09:00:00.000Z', favoriteId: 'a50e8400-e29b-41d4-a716-446655440001',
}), 'utf8').toString('base64url');

function favorite(index: number) {
  return {
    presentationId: `b50e8400-e29b-41d4-a716-44665544000${index}`,
    favoritedAt: `2026-09-${17 - index}T0${9 - index}:00:00.000Z`,
    question: {
      ...question,
      id: `c50e8400-e29b-41d4-a716-44665544000${index}`,
      textEnglish: `Favorite question ${index}`,
      textRussian: index === 1 ? `Избранный вопрос ${index}` : null,
    },
  };
}

async function authenticate(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"favorites-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: vehicle },
  } }));
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
}

async function openPracticeQuestion(page: Page) {
  await page.route('**/practice/next', (route) => route.fulfill({ json: presentation }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: question.textEnglish })).toBeVisible();
}

async function openFavorites(page: Page, vehicle: 'CAR' | null = 'CAR') {
  await authenticate(page, vehicle);
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
}

test('saves the visible presentation exactly once and blocks answer submission while pending', async ({ page }) => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/favorite', async (route) => {
    calls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().postDataJSON()).toEqual({ presentationId, favorite: true });
    await gate;
    await route.fulfill({ json: { presentationId, favorite: true } });
  });
  await openPracticeQuestion(page);
  await page.getByRole('radio', { name: /Action 1/ }).check();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Save to favorites');
    button?.click(); button?.click();
  });
  await expect(page.getByRole('button', { name: 'Saving favorite' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Please wait' })).toBeDisabled();
  expect(calls).toBe(1);
  release?.();
  await expect(page.getByRole('button', { name: 'Saved to favorites' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
});

for (const failure of ['transport', 'http', 'malformed'] as const) {
  test(`preserves the question and retries a ${failure} favorite save failure`, async ({ page }) => {
    let calls = 0;
    await page.route('**/practice/favorite', (route) => {
      calls++;
      if (calls === 1) {
        if (failure === 'transport') return route.abort();
        if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'test' } });
        return route.fulfill({ json: { presentationId, favorite: false } });
      }
      return route.fulfill({ json: { presentationId, favorite: true } });
    });
    await openPracticeQuestion(page);
    await page.getByRole('radio', { name: /Action 2/ }).check();
    await page.getByRole('button', { name: 'Save to favorites' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not save this favorite');
    await expect(page.getByRole('radio', { name: /Action 2/ })).toBeChecked();
    await page.getByRole('button', { name: 'Retry favorite' }).click();
    await expect(page.getByRole('button', { name: 'Saved to favorites' })).toBeDisabled();
    expect(calls).toBe(2);
  });
}

test('handles unavailable and expired favorite saves safely', async ({ page }) => {
  let calls = 0;
  await page.route('**/practice/favorite', (route) => {
    calls++;
    return route.fulfill({ status: calls === 1 ? 404 : 401, json: { error: 'test' } });
  });
  await openPracticeQuestion(page);
  await page.getByRole('button', { name: 'Save to favorites' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('no longer available to save');
  await page.getByRole('button', { name: 'Retry favorite' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('favorites navigation is immediate during save and ignores its late response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/favorite', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await page.route('**/me/favorites?limit=10', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await openPracticeQuestion(page);
  await page.getByRole('button', { name: 'Save to favorites' }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Favorites', exact: true })).toBeVisible();
  release?.();
  await page.waitForTimeout(100);
  await expect(page.getByText('no saved favorites yet')).toBeVisible();
  await expect(page.getByRole('main').getByText('session has ended')).toHaveCount(0);
});

test('a newly loaded presentation starts unsaved after saving the previous one', async ({ page }) => {
  const nextPresentationId = '950e8400-e29b-41d4-a716-446655440011';
  let nextCalls = 0;
  await page.route('**/practice/next', (route) => {
    nextCalls++;
    return route.fulfill({ json: { ...presentation, presentationId: nextCalls === 1 ? presentationId : nextPresentationId } });
  });
  await page.route('**/practice/favorite', (route) => route.fulfill({ json: route.request().postDataJSON() }));
  await page.route('**/practice/answer', (route) => route.fulfill({ json: {
    presentationId, selectedChoiceId: choiceIds[0], correctChoiceId: choiceIds[0], isCorrect: true,
    explanationThai: null, explanationEnglish: null, explanationRussian: null,
    trapExplanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null,
  } }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await page.getByRole('button', { name: 'Save to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Saved to favorites' })).toBeDisabled();
  await page.getByRole('radio', { name: /Action 1/ }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Save to favorites' })).toBeEnabled();
});

test('renders immutable favorites in server order with localization and returns to clean practice', async ({ page }) => {
  await page.route('**/me/favorites?limit=10', (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    return route.fulfill({ json: { items: [favorite(1), favorite(2)], nextCursor: null } });
  });
  await page.route('**/practice/next', (route) => route.fulfill({ json: presentation }));
  await authenticate(page);
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.locator('.favorite-entry')).toHaveCount(2);
  await expect(page.locator('.favorite-entry').first().locator('time')).toHaveAttribute('datetime', '2026-09-16T08:00:00.000Z');
  await expect(page.locator('.favorite-entry').first().getByText('D. Action 1')).toBeVisible();
  await expect(page.getByText('Correct answer')).toHaveCount(0);
  await expect(page.getByText('Explanation')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.getByRole('heading', { name: 'Избранный вопрос 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Favorite question 2' })).toBeVisible();
  await expect(page.locator('.favorite-entry').first().getByText('D. Русский вариант')).toBeVisible();
  await page.getByRole('radio', { name: 'Thai', exact: true }).check();
  await expect(page.locator('.favorite-entry').first().getByText('B. ตัวเลือกไทย')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Favorite question 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
});

test('appends a second page once and retries the exact failed cursor', async ({ page }) => {
  let pageCalls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/favorites?limit=10*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [favorite(1)], nextCursor: cursor } });
    expect(url.searchParams.get('cursor')).toBe(cursor);
    pageCalls++;
    if (pageCalls === 1) { await gate; return route.fulfill({ status: 500, json: { error: 'test' } }); }
    return route.fulfill({ json: { items: [favorite(2)], nextCursor: null } });
  });
  await openFavorites(page);
  await expect(page.locator('.favorite-entry')).toHaveCount(1);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Load more');
    button?.click(); button?.click();
  });
  await expect.poll(() => pageCalls).toBe(1);
  release?.();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your favorites');
  await expect(page.locator('.favorite-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry favorites' }).click();
  await expect(page.locator('.favorite-entry')).toHaveCount(2);
  expect(pageCalls).toBe(2);
});

test('retries initial transport failure and shows the friendly empty state', async ({ page }) => {
  let calls = 0;
  await page.route('**/me/favorites?limit=10', (route) => {
    calls++;
    return calls === 1 ? route.abort() : route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await openFavorites(page, null);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your favorites');
  await page.getByRole('button', { name: 'Retry favorites' }).click();
  await expect(page.getByText('no saved favorites yet')).toBeVisible();
  await page.locator('.empty-favorites').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
});

for (const invalid of ['unknown field', 'timestamp', 'cursor', 'duplicate presentation', 'duplicate question'] as const) {
  test(`rejects a favorites page with ${invalid} and allows retry`, async ({ page }) => {
    let calls = 0;
    const first = favorite(1);
    const invalidPayload = invalid === 'unknown field'
      ? { items: [{ ...first, correctChoiceId: choiceIds[0] }], nextCursor: null }
      : invalid === 'timestamp'
        ? { items: [{ ...first, favoritedAt: '2026-09-16T08:00:00Z' }], nextCursor: null }
        : invalid === 'cursor'
          ? { items: [first], nextCursor: `${cursor}=` }
        : invalid === 'duplicate presentation'
          ? { items: [first, { ...favorite(2), presentationId: first.presentationId }], nextCursor: null }
          : { items: [first, { ...favorite(2), question: { ...favorite(2).question, id: first.question.id } }], nextCursor: null };
    await page.route('**/me/favorites?limit=10', (route) => {
      calls++;
      return route.fulfill({ json: calls === 1 ? invalidPayload : { items: [first], nextCursor: null } });
    });
    await openFavorites(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your favorites');
    await expect(page.locator('.favorite-entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry favorites' }).click();
    await expect(page.locator('.favorite-entry')).toHaveCount(1);
  });
}

for (const duplicate of ['presentation', 'question'] as const) {
  test(`rejects a duplicate ${duplicate} across favorites pages and preserves the first page`, async ({ page }) => {
    let pageCalls = 0;
    const first = favorite(1);
    await page.route('**/me/favorites?limit=10*', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [first], nextCursor: cursor } });
      pageCalls++;
      const second = pageCalls === 1
        ? duplicate === 'presentation' ? { ...favorite(2), presentationId: first.presentationId } : { ...favorite(2), question: { ...favorite(2).question, id: first.question.id } }
        : favorite(2);
      return route.fulfill({ json: { items: [second], nextCursor: null } });
    });
    await openFavorites(page);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your favorites');
    await expect(page.locator('.favorite-entry')).toHaveCount(1);
    await page.getByRole('button', { name: 'Retry favorites' }).click();
    await expect(page.locator('.favorite-entry')).toHaveCount(2);
  });
}

for (const duplicate of ['presentation', 'question'] as const) {
  test(`rejects a repeated ${duplicate} after the first-page favorite is removed`, async ({ page }) => {
    let pageCalls = 0;
    const first = favorite(1);
    await page.route('**/me/favorites?limit=10*', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [first], nextCursor: cursor } });
      pageCalls++;
      const next = pageCalls === 1
        ? duplicate === 'presentation' ? { ...favorite(2), presentationId: first.presentationId } : { ...favorite(2), question: { ...favorite(2).question, id: first.question.id } }
        : favorite(2);
      return route.fulfill({ json: { items: [next], nextCursor: null } });
    });
    await page.route('**/practice/favorite', (route) => route.fulfill({ json: route.request().postDataJSON() }));
    await openFavorites(page);
    await expect(page.locator('.favorite-entry')).toHaveCount(1);
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('.favorite-entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your favorites');
    await expect(page.locator('.favorite-entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry favorites' }).click();
    await expect(page.locator('.favorite-entry')).toHaveCount(1);
    expect(pageCalls).toBe(2);
  });
}

test('does not resurrect a removed favorite when pending page validation finishes later', async ({ page }) => {
  let releasePage: (() => void) | undefined;
  const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
  const first = favorite(1);
  await page.route('**/me/favorites?limit=10*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === null) return route.fulfill({ json: { items: [first], nextCursor: cursor } });
    await pageGate;
    return route.fulfill({ json: { items: [first], nextCursor: null } });
  });
  await page.route('**/practice/favorite', (route) => route.fulfill({ json: route.request().postDataJSON() }));
  await openFavorites(page);
  await expect(page.locator('.favorite-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('button', { name: 'Loading more' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.favorite-entry')).toHaveCount(0);
  releasePage?.();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load your favorites');
  await expect(page.locator('.favorite-entry')).toHaveCount(0);
});

test('a favorites 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/me/favorites?limit=10', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFavorites(page);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('a removal 401 clears the in-memory session', async ({ page }) => {
  await page.route('**/me/favorites?limit=10', (route) => route.fulfill({ json: { items: [favorite(1)], nextCursor: null } }));
  await page.route('**/practice/favorite', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openFavorites(page);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('leaving favorites ignores a delayed feed response', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/favorites?limit=10', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openFavorites(page);
  await expect(page.getByRole('status')).toContainText('Loading your favorites');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toBeEnabled();
});

test('removes only after exact confirmation, prevents duplicates, retries failure, and reaches empty state', async ({ page }) => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const item = favorite(1);
  await page.route('**/me/favorites?limit=10', (route) => route.fulfill({ json: { items: [item], nextCursor: null } }));
  await page.route('**/practice/favorite', async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ presentationId: item.presentationId, favorite: false });
    if (calls === 1) { await gate; return route.fulfill({ json: { presentationId: item.presentationId, favorite: true } }); }
    return route.fulfill({ json: { presentationId: item.presentationId, favorite: false } });
  });
  await openFavorites(page);
  await expect(page.locator('.favorite-entry')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Remove');
    button?.click(); button?.click();
  });
  await expect(page.getByRole('button', { name: 'Removing' })).toBeDisabled();
  await expect(page.locator('.favorite-entry')).toHaveCount(1);
  expect(calls).toBe(1);
  release?.();
  await expect(page.getByText('could not remove this favorite')).toBeVisible();
  await expect(page.locator('.favorite-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry removal' }).click();
  await expect(page.locator('.favorite-entry')).toHaveCount(0);
  await expect(page.getByText('no saved favorites yet')).toBeVisible();
  expect(calls).toBe(2);
});

test('leaving during removal is immediate and ignores its late 401', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/me/favorites?limit=10', (route) => route.fulfill({ json: { items: [favorite(1)], nextCursor: null } }));
  await page.route('**/practice/favorite', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openFavorites(page);
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByText('session has ended')).toHaveCount(0);
});
