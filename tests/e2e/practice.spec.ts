import { expect, test, type Page } from '@playwright/test';

const ids = ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440004'];
const presentation = { presentationId: '550e8400-e29b-41d4-a716-446655440010', question: {
  id: '550e8400-e29b-41d4-a716-446655440020', textEnglish: 'Which action is safe?', textRussian: 'Какое действие безопасно?', textThai: null, textExamEnglish: 'Select safe action.',
  choices: ids.map((id, index) => ({ id, key: ['D', 'B', 'A', 'C'][index], textEnglish: `Action ${index + 1}`, textRussian: null, textThai: null })),
} };
function answer(selectedChoiceId: string) { return { presentationId: presentation.presentationId, selectedChoiceId, correctChoiceId: ids[2], isCorrect: selectedChoiceId === ids[2], explanationEnglish: 'Keep a safe distance.', explanationRussian: null, explanationThai: null, trapExplanationEnglish: null, trapExplanationRussian: null, trapExplanationThai: null }; }
async function start(page: Page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"test",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token: 'x'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', user: { id: ids[0], username: null, firstName: null, selectedVehicleType: 'CAR' } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Get a question' }).click();
}
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

