import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'c'.repeat(43);
const userId = '550e8400-e29b-41d4-a716-446655440000';
const summary = { answered: 12, correct: 9, incorrect: 3, accuracyPercent: 75 };
const tiedAt = '2026-09-29T12:00:00.000Z';
const earlierAt = '2026-09-29T11:00:00.000Z';

const item = (conceptId: string, suffix: string, timestamp: string, answered: number, correct: number) => ({
  conceptId,
  slug: `concept-${suffix}`,
  nameThai: `แนวคิด ${suffix}`,
  nameEnglish: `Concept ${suffix}`,
  nameRussian: `Концепция ${suffix}`,
  practice: { answered: answered - 1, correct: Math.max(0, correct - 1), incorrect: answered - correct, lastAnsweredAt: timestamp },
  exam: { answered: 1, correct: correct > 0 ? 1 : 0, incorrect: correct > 0 ? 0 : 1, lastAnsweredAt: timestamp },
  total: { answered, correct, incorrect: answered - correct, accuracyPercent: Math.round((correct / answered) * 100) },
  masteryStatus: answered >= 5 && correct * 100 >= answered * 80 ? 'MASTERED' : 'LEARNING',
  lastActivityAt: timestamp,
});

const firstItem = item('30000000-0000-4000-8000-000000000003', 'A', tiedAt, 5, 4);
const secondItem = item('30000000-0000-4000-8000-000000000002', 'B', tiedAt, 4, 4);
const thirdItem = item('30000000-0000-4000-8000-000000000001', 'C', earlierAt, 5, 3);
const encodeCursor = (value: typeof secondItem) => Buffer.from(JSON.stringify({
  v: 1, lastActivityAt: value.lastActivityAt, conceptId: value.conceptId,
}), 'utf8').toString('base64url');
const cursor = encodeCursor(secondItem);

async function authenticate(page: Page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"concept-progress-test",ready(){}}};',
  }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: {
    token, expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: userId, username: null, firstName: null, selectedVehicleType: null },
  } }));
  await page.route('**/me/progress', (route) => route.fulfill({ json: summary }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
}

test('renders exact mastery and facts in English, Russian and Thai, then traverses tied pages', async ({ page }) => {
  const urls: string[] = [];
  await page.route('**/me/concept-progress?*', (route) => {
    urls.push(route.request().url());
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().method()).toBe('GET');
    expect(route.request().postData()).toBeNull();
    return route.fulfill({ json: urls.length === 1
      ? { items: [firstItem, secondItem], nextCursor: cursor }
      : { items: [thirdItem], nextCursor: null } });
  });
  await authenticate(page);

  const first = page.locator(`[data-concept-id="${firstItem.conceptId}"]`);
  await expect(first.getByRole('heading', { name: 'Concept A' })).toBeVisible();
  await expect(first.locator('[data-mastery-status="MASTERED"]')).toHaveText('Mastered');
  await expect(first).toContainText('Answered: 5');
  await expect(first).toContainText('Correct: 4');
  await expect(first).toContainText('Incorrect: 1');
  await expect(first).toContainText('80%');
  const second = page.locator(`[data-concept-id="${secondItem.conceptId}"]`);
  await expect(second.locator('[data-mastery-status="LEARNING"]')).toHaveText('Learning');

  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(first.getByRole('heading', { name: 'Концепция A' })).toBeVisible();
  await expect(first.locator('[data-mastery-status="MASTERED"]')).toHaveText('Освоено');
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(first.getByRole('heading', { name: 'แนวคิด A' })).toBeVisible();
  await expect(first.locator('[data-mastery-status="MASTERED"]')).toHaveText('เชี่ยวชาญแล้ว');

  await page.getByRole('button', { name: 'โหลดเพิ่มเติม' }).click();
  await expect(page.locator(`[data-concept-id="${thirdItem.conceptId}"]`)).toBeVisible();
  expect(urls.map((url) => new URL(url).pathname + new URL(url).search)).toEqual([
    '/me/concept-progress?limit=10', `/me/concept-progress?limit=10&cursor=${cursor}`,
  ]);
  expect(await page.locator('.concept-progress-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-concept-id')))).toEqual([
    firstItem.conceptId, secondItem.conceptId, thirdItem.conceptId,
  ]);
});

test('shows the localized NOT_STARTED state for an empty first page', async ({ page }) => {
  await page.route('**/me/concept-progress?*', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await authenticate(page);
  await expect(page.locator('[data-mastery-status="NOT_STARTED"]')).toContainText('Not started');
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(page.locator('[data-mastery-status="NOT_STARTED"]')).toContainText('Не начато');
  await page.getByRole('radio', { name: 'Thai' }).check();
  await expect(page.locator('[data-mastery-status="NOT_STARTED"]')).toContainText('ยังไม่เริ่ม');
});

for (const failure of ['transport', 'http', 'malformed', 'duplicate'] as const) {
  test(`retries the same cursor after a ${failure} next-page failure without discarding validated items`, async ({ page }) => {
    const requested: string[] = [];
    await page.route('**/me/concept-progress?*', (route) => {
      requested.push(route.request().url());
      if (requested.length === 1) return route.fulfill({ json: { items: [firstItem, secondItem], nextCursor: cursor } });
      if (requested.length === 2) {
        if (failure === 'transport') return route.abort();
        if (failure === 'http') return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
        return route.fulfill({ json: failure === 'duplicate'
          ? { items: [secondItem], nextCursor: null }
          : { items: [{ ...thirdItem, masteryStatus: 'MASTERED' }], nextCursor: null } });
      }
      return route.fulfill({ json: { items: [thirdItem], nextCursor: null } });
    });
    await authenticate(page);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('validated results are still shown');
    await expect(page.locator('.concept-progress-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Retry progress' }).click();
    await expect(page.locator('.concept-progress-card')).toHaveCount(3);
    expect(new URL(requested[1]!).search).toBe(new URL(requested[2]!).search);
  });
}

test('a concept-progress 401 expires the session', async ({ page }) => {
  await page.route('**/me/concept-progress?*', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await authenticate(page);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('ignores a late concept response after navigation', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let complete: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  await page.route('**/me/concept-progress?*', async (route) => {
    await gate;
    try { await route.fulfill({ json: { items: [firstItem], nextCursor: null } }); } catch { /* navigation may cancel it */ }
    complete?.();
  });
  await authenticate(page);
  await expect(page.getByRole('status')).toContainText('Loading more concepts');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  release?.();
  await completed;
  await expect(page.locator('.concept-progress-card')).toHaveCount(0);
});

test('the synchronous guard prevents overlapping load-more requests', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route('**/me/concept-progress?*', async (route: Route) => {
    requests++;
    if (requests === 1) return route.fulfill({ json: { items: [firstItem, secondItem], nextCursor: cursor } });
    await gate;
    return route.fulfill({ json: { items: [thirdItem], nextCursor: null } });
  });
  await authenticate(page);
  await expect(page.getByRole('button', { name: 'Load more' })).toBeEnabled();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Load more');
    button?.click(); button?.click();
  });
  await expect(page.getByRole('status')).toContainText('Loading more concepts');
  expect(requests).toBe(2);
  release?.();
  await expect(page.locator('.concept-progress-card')).toHaveCount(3);
  expect(requests).toBe(2);
});
