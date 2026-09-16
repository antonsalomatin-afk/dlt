import { expect, test, type Page } from '@playwright/test';

const ids = ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440004'];
const categoryIds = ['550e8400-e29b-41d4-a716-446655440101', '550e8400-e29b-41d4-a716-446655440102'];
const categories = [
  { id: categoryIds[0], slug: 'signs', nameThai: 'ป้ายจราจร', nameEnglish: 'Road signs', nameRussian: 'Дорожные знаки', questionCount: 7 },
  { id: categoryIds[1], slug: 'safety', nameThai: 'ความปลอดภัย', nameEnglish: 'Safety', nameRussian: 'Безопасность', questionCount: 1 },
];
const presentation = { presentationId: '550e8400-e29b-41d4-a716-446655440010', question: {
  id: '550e8400-e29b-41d4-a716-446655440020', textEnglish: 'Which action is safe?', textRussian: 'Какое действие безопасно?', textThai: null, textExamEnglish: 'Select safe action.',
  choices: ids.map((id, index) => ({ id, key: ['D', 'B', 'A', 'C'][index], textEnglish: `Action ${index + 1}`, textRussian: null, textThai: null })),
} };
function answer(selectedChoiceId: string) { return { presentationId: presentation.presentationId, selectedChoiceId, correctChoiceId: ids[2], isCorrect: selectedChoiceId === ids[2], explanationEnglish: 'Keep a safe distance.', explanationRussian: null, explanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null, trapExplanationThai: null }; }
test.beforeEach(async ({ page }) => {
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories: [] } }));
});
async function openPractice(page: Page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"test",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token: 'x'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', user: { id: ids[0], username: null, firstName: null, selectedVehicleType: 'CAR' } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Start practice' }).click();
}
async function start(page: Page) {
  await openPractice(page);
  await page.getByRole('button', { name: 'Get a question' }).click();
}

test('loads categories with bearer auth, preserves server order and localizes labels', async ({ page }) => {
  await page.route('**/practice/categories', (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe(`Bearer ${'x'.repeat(43)}`);
    return route.fulfill({ json: { categories } });
  });
  await openPractice(page);
  const scope = page.getByRole('group', { name: 'Practice scope' });
  await expect(scope.getByRole('radio')).toHaveCount(3);
  await expect(scope.getByRole('radio').nth(0)).toHaveAccessibleName('All categories');
  await expect(scope.getByRole('radio').nth(1)).toHaveAccessibleName('Road signs 7 questions');
  await expect(scope.getByRole('radio').nth(2)).toHaveAccessibleName('Safety 1 question');
  await expect(scope.getByRole('radio', { name: 'All categories' })).toBeChecked();
  await page.getByRole('radio', { name: 'Russian' }).check();
  await expect(scope.getByRole('radio').nth(1)).toHaveAccessibleName('Дорожные знаки 7 questions');
  await page.getByRole('radio', { name: 'Thai', exact: true }).check();
  await expect(scope.getByRole('radio').nth(2)).toHaveAccessibleName('ความปลอดภัย 1 question');
});

test('an empty category list keeps All categories available and sends the exact empty selector', async ({ page }) => {
  await page.route('**/practice/next', (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: presentation });
  });
  await openPractice(page);
  const scope = page.getByRole('group', { name: 'Practice scope' });
  await expect(scope.getByRole('radio')).toHaveCount(1);
  await expect(scope.getByRole('radio', { name: 'All categories' })).toBeChecked();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Which action is safe?' })).toBeVisible();
});

test('selected scope continues, can change after a result and never changes that result', async ({ page }) => {
  const nextBodies: unknown[] = [];
  let nextCount = 0;
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories } }));
  await page.route('**/practice/next', (route) => {
    nextBodies.push(route.request().postDataJSON());
    nextCount++;
    return route.fulfill({ json: { ...presentation, presentationId: nextCount === 1 ? presentation.presentationId : ids[0] } });
  });
  await page.route('**/practice/answer', (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual(expect.objectContaining({ choiceId: ids[0] }));
    if (!body || typeof body !== 'object' || !('presentationId' in body) || typeof body.presentationId !== 'string') throw new Error('Missing presentation ID');
    return route.fulfill({ json: { ...answer(ids[0] ?? ''), presentationId: body.presentationId } });
  });
  await openPractice(page);
  const scope = page.getByRole('group', { name: 'Practice scope' });
  await scope.getByRole('radio', { name: /Road signs/ }).check();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(scope.getByRole('radio', { name: /Safety/ })).toBeDisabled();
  await page.getByRole('radio', { name: 'Action 1', exact: false }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('region', { name: 'Answer result' })).toBeVisible();
  await scope.getByRole('radio', { name: /Safety/ }).check();
  await expect(page.getByRole('region', { name: 'Answer result' })).toContainText('Incorrect');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Action 1', exact: false }).check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => nextBodies).toEqual([
    { categoryId: categoryIds[0] },
    { categoryId: categoryIds[1] },
    { categoryId: categoryIds[1] },
  ]);
});

for (const failure of ['transport', 'http'] as const) {
  test(`retries a category ${failure} failure before enabling questions`, async ({ page }) => {
    let requests = 0;
    await page.route('**/practice/categories', (route) => {
      requests++;
      if (requests === 1) return failure === 'transport' ? route.abort() : route.fulfill({ status: 500, json: { error: 'test' } });
      return route.fulfill({ json: { categories } });
    });
    await openPractice(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load practice categories');
    await expect(page.getByRole('button', { name: 'Get a question' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry categories' }).click();
    await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled();
    expect(requests).toBe(2);
  });
}

for (const invalid of ['malformed', 'duplicate ID', 'duplicate slug'] as const) {
  test(`rejects a ${invalid} category payload and allows retry`, async ({ page }) => {
    let requests = 0;
    await page.route('**/practice/categories', (route) => {
      requests++;
      if (requests > 1) return route.fulfill({ json: { categories } });
      const invalidCategories = invalid === 'malformed'
        ? [{ ...categories[0], questionCount: 0, extra: true }]
        : invalid === 'duplicate ID'
          ? [categories[0], { ...categories[1], id: categories[0]?.id }]
          : [categories[0], { ...categories[1], slug: categories[0]?.slug }];
      return route.fulfill({ json: { categories: invalidCategories } });
    });
    await openPractice(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load practice categories');
    await expect(page.getByRole('group', { name: 'Practice scope' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry categories' }).click();
    await expect(page.getByRole('group', { name: 'Practice scope' }).getByRole('radio')).toHaveCount(3);
  });
}

for (const status of [401, 409]) {
  test(`category loading handles HTTP ${status}`, async ({ page }) => {
    await page.route('**/practice/categories', (route) => route.fulfill({ status, json: { error: 'test' } }));
    await openPractice(page);
    if (status === 401) {
      await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    } else {
      await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start practice' })).toHaveCount(0);
    }
  });
}

test('shows distinct filtered and unfiltered no-question guidance without changing selection', async ({ page }) => {
  let requests = 0;
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories } }));
  await page.route('**/practice/next', (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual(requests === 1 ? { categoryId: categoryIds[0] } : {});
    return route.fulfill({ status: 404, json: { error: 'No questions available' } });
  });
  await openPractice(page);
  const scope = page.getByRole('group', { name: 'Practice scope' });
  await scope.getByRole('radio', { name: /Road signs/ }).check();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('status')).toContainText('No questions are available in Road signs');
  await expect(scope.getByRole('radio', { name: /Road signs/ })).toBeChecked();
  await scope.getByRole('radio', { name: 'All categories' }).check();
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('status')).toContainText('No questions available for this vehicle');
});

test('shows category loading and ignores a late category response after departure', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/categories', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openPractice(page);
  await expect(page.getByRole('status')).toContainText('Loading practice categories');
  await expect(page.getByRole('button', { name: 'Get a question' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change vehicle' }).click();
  release?.();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

for (const selected of [0, 1, 2, 3]) {
  test(`choice ${selected + 1}, server result, language fallback and continuation`, async ({ page }, info) => {
    let count = 0;
    await page.route('**/practice/next', (route) => { count++; expect(route.request().postDataJSON()).toEqual({}); expect(route.request().headers().authorization).toBe(`Bearer ${'x'.repeat(43)}`); return route.fulfill({ json: { ...presentation, presentationId: count === 1 ? presentation.presentationId : ids[0] } }); });
    await page.route('**/practice/answer', (route) => { expect(route.request().postDataJSON()).toEqual({ presentationId: presentation.presentationId, choiceId: ids[selected] }); return route.fulfill({ json: answer(ids[selected] ?? '') }); });
    await start(page);
    await expect(page.getByRole('group', { name: 'Answer choices' }).getByRole('radio')).toHaveCount(4);
    await expect(page.getByText('Keep a safe distance.')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Russian' }).check(); await expect(page.getByRole('heading', { name: 'Какое действие безопасно?' })).toBeVisible();
    await page.getByRole('radio', { name: 'Thai', exact: true }).check(); await expect(page.getByRole('heading', { name: 'Which action is safe?' })).toBeVisible();
    await page.getByText('Exam English wording').click(); await expect(page.getByText('Select safe action.')).toBeVisible();
    await page.getByRole('radio', { name: `Action ${selected + 1}`, exact: false }).check();
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByRole('region', { name: 'Answer result' }).getByRole('heading', { name: selected === 2 ? 'Correct' : 'Incorrect', exact: true })).toBeVisible();
    await expect(page.getByText('Keep a safe distance.')).toBeVisible(); await expect(page.getByText('Trap explanation unavailable.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Action 3', exact: false })).toHaveAccessibleName(/Correct answer/);
    await expect(page.getByRole('radio', { name: `Action ${selected + 1}`, exact: false })).toBeChecked();
    if (selected === 2) await page.screenshot({ path: info.outputPath('practice-result.png'), fullPage: true });
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Answer choices' }).locator('input:checked')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit answer' })).toBeDisabled(); expect(count).toBe(2);
  });
}

test('one pending submission, transport retry and already-submitted guidance', async ({ page }) => {
  await page.route('**/practice/next', (route) => route.fulfill({ json: presentation }));
  let release: (() => void) | undefined; const gate = new Promise<void>((resolve) => { release = resolve; }); let count = 0;
  await page.route('**/practice/answer', async (route) => { count++; if (count === 1) { await gate; await route.abort(); } else await route.fulfill({ status: 409, json: { error: 'Answer already submitted' } }); });
  await start(page); await page.getByRole('radio', { name: 'Action 1', exact: false }).check(); await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('button', { name: 'Please wait' }).first()).toBeDisabled(); await expect(page.getByRole('radio', { name: 'Action 2', exact: false })).toBeDisabled();
  expect(count).toBe(1); release?.(); await expect(page.getByRole('main').getByRole('alert')).toContainText('could not confirm');
  await expect(page.getByRole('radio', { name: 'Action 1', exact: false })).toBeChecked(); await page.getByRole('button', { name: 'Retry answer' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('already submitted'); await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled(); expect(count).toBe(2);
});
for (const status of [401, 404, 409, 500]) {
  test(`next handles HTTP ${status}`, async ({ page }) => {
    await page.route('**/practice/next', (route) => route.fulfill({ status, json: { error: 'test' } })); await start(page);
    await expect(page.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
    if (status === 401) { await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended'); await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled(); }
    else if (status === 409) await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
    else { await expect(page.getByText(status === 404 ? /No questions available/ : /could not load/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Get a question' })).toBeEnabled(); }
  });
}
for (const invalid of ['hidden', 'duplicate', 'missing'] as const) {
  test(`rejects ${invalid} presentation DTO`, async ({ page }) => {
    const question = invalid === 'hidden' ? { ...presentation.question, correctChoiceId: ids[0] } : invalid === 'duplicate' ? { ...presentation.question, choices: Array(4).fill(presentation.question.choices[0]) } : { ...presentation.question, textEnglish: null };
    await page.route('**/practice/next', (route) => route.fulfill({ json: { ...presentation, question } })); await start(page);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not load'); await expect(page.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
  });
}
for (const mismatch of ['presentationId', 'selectedChoiceId', 'correctChoiceId', 'isCorrect'] as const) {
  test(`rejects inconsistent answer ${mismatch}`, async ({ page }) => {
    await page.route('**/practice/next', (route) => route.fulfill({ json: presentation }));
    await page.route('**/practice/answer', (route) => route.fulfill({ json: { ...answer(ids[0] ?? ''), [mismatch]: mismatch === 'isCorrect' ? true : presentation.question.id } }));
    await start(page); await page.getByRole('radio', { name: 'Action 1', exact: false }).check(); await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not confirm'); await expect(page.getByRole('region', { name: 'Answer result' })).toHaveCount(0);
  });
}
test('ignores a late response after leaving practice', async ({ page }) => {
  let release: (() => void) | undefined; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/next', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await start(page); await page.getByRole('button', { name: 'Change vehicle' }).click(); release?.();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Save vehicle' })).toBeVisible();
});
test('missing vehicle allows resaving the previously confirmed vehicle', async ({ page }) => {
  await page.route('**/practice/next', (route) => route.fulfill({ status: 409, json: { error: 'Vehicle selection required' } }));
  await page.route('**/me/vehicle', (route) => route.fulfill({ json: { id: ids[0], username: null, firstName: null, selectedVehicleType: 'CAR' } }));
  await start(page); await page.getByRole('radio', { name: 'Car', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Save vehicle' })).toBeEnabled(); await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled();
});

