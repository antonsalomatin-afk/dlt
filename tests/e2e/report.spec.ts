import { clickNavigation, openTopics } from './navigation.ts';
import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'x'.repeat(43);
const ids = ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440004'];
const presentation = { presentationId: '550e8400-e29b-41d4-a716-446655440010', question: {
  id: '550e8400-e29b-41d4-a716-446655440020', textEnglish: 'Which action is safe?', textRussian: 'Какое действие безопасно?', textThai: null, textExamEnglish: 'Select safe action.',
  choices: ids.map((id, index) => ({ id, key: ['D', 'B', 'A', 'C'][index], textEnglish: `Action ${index + 1}`, textRussian: null, textThai: null })),
} };
const reportResponse = { reportId: '550e8400-e29b-41d4-a716-446655440099', presentationId: presentation.presentationId, createdAt: '2026-10-02T04:00:00.000Z' };
const category = { id: '550e8400-e29b-41d4-a716-446655440101', slug: 'signs', nameThai: 'ป้ายจราจร', nameEnglish: 'Road signs', nameRussian: 'Дорожные знаки', questionCount: 7 };

async function openPractice(page: Page, next: (route: Route) => void | Promise<void> = (route) => route.fulfill({ json: presentation }), categories: typeof category[] = []) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"test",ready(){}}};' }));
  await page.route('**/auth/telegram', (route) => route.fulfill({ json: { token, expiresAt: '2099-01-01T00:00:00.000Z', user: { id: ids[0], username: null, firstName: null, selectedVehicleType: 'CAR' } } }));
  await page.route('**/practice/categories', (route) => route.fulfill({ json: { categories } }));
  await page.route('**/practice/next', next);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start practice' }).click();
  if (categories.length > 0) { await openTopics(page); await page.getByRole('radio', { name: /Road signs/ }).check(); }
  await page.getByRole('button', { name: 'Get a question' }).click();
  await expect(page.getByRole('heading', { name: 'Which action is safe?' })).toBeVisible();
}

async function openReport(page: Page) {
  await page.getByRole('button', { name: 'Report question' }).click();
  await expect(page.getByRole('textbox', { name: 'What may be wrong with this question?' })).toBeVisible();
}

test('opens and cancels a report and rejects invalid details without a request', async ({ page }) => {
  let requests = 0;
  await page.route('**/practice/report', (route) => { requests++; return route.fulfill({ json: reportResponse }); });
  await openPractice(page);
  await openReport(page);
  const details = page.getByRole('textbox', { name: 'What may be wrong with this question?' });
  await details.fill('unsent report');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await openReport(page);
  await expect(details).toHaveValue('');

  for (const invalid of ['ab', ' leading space', 'trailing space ', 'a'.repeat(1001), '😀'.repeat(1001), 'bad\tcontrol']) {
    await details.fill(invalid);
    await page.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.locator('#report-error')).toContainText('Enter 3–1000 characters');
  }
  await details.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(element, `bad${String.fromCharCode(0xd800)}value`);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('#report-error')).toContainText('Enter 3–1000 characters');
  expect(requests).toBe(0);
});

test('submits exact emoji and newline details once and preserves the unanswered question', async ({ page }) => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const detailsText = 'The sign 😀\nlooks incorrect';
  await page.route('**/practice/report', async (route) => {
    requests++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().headers()['content-type']).toContain('application/json');
    expect(route.request().postDataJSON()).toEqual({ presentationId: presentation.presentationId, details: detailsText });
    await gate;
    await route.fulfill({ json: reportResponse });
  });
  await openPractice(page);
  await page.getByRole('radio', { name: /Action 1/ }).check();
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill(detailsText);
  await page.getByRole('button', { name: 'Submit report' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Save to favorites' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check answer' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Action 2/ })).toBeDisabled();
  release?.();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Action 1/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Which action is safe?' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What may be wrong with this question?' })).toHaveCount(0);
});

test('keeps report details retryable across transport, HTTP and invalid success failures', async ({ page }) => {
  let attempt = 0;
  await page.route('**/practice/report', (route) => {
    attempt++;
    if (attempt === 1) return route.abort();
    if (attempt === 2) return route.fulfill({ status: 400, json: { error: 'Bad Request' } });
    if (attempt === 3) return route.fulfill({ status: 500, json: { error: 'test' } });
    if (attempt === 4) return route.fulfill({ json: { ...reportResponse, extra: true } });
    if (attempt === 5) return route.fulfill({ json: { ...reportResponse, presentationId: ids[1] } });
    return route.fulfill({ json: reportResponse });
  });
  await openPractice(page);
  await openReport(page);
  const details = page.getByRole('textbox', { name: 'What may be wrong with this question?' });
  await details.fill('Keep this exact retry text');
  for (let current = 1; current <= 5; current++) {
    await page.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.locator('#report-error')).toContainText('details are still here');
    await expect(details).toHaveValue('Keep this exact retry text');
    expect(attempt).toBe(current);
  }
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
});

test('distinguishes unavailable and already-submitted reports', async ({ page }) => {
  let attempt = 0;
  await page.route('**/practice/report', (route) => {
    attempt++;
    return attempt === 1
      ? route.fulfill({ status: 404, json: { error: 'Presentation not found' } })
      : route.fulfill({ status: 409, json: { error: 'Report already submitted' } });
  });
  await openPractice(page);
  await openReport(page);
  const details = page.getByRole('textbox', { name: 'What may be wrong with this question?' });
  await details.fill('This presentation appears outdated');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('#report-error')).toContainText('no longer available to report');
  await expect(details).toHaveValue('This presentation appears outdated');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Report already submitted', { exact: true })).toBeVisible();
  await expect(details).toHaveCount(0);
});

test('expires on report 401 and ignores a late 401 after immediate navigation', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/practice/report', async (route) => { await gate; await route.fulfill({ status: 401, json: { error: 'Unauthorized' } }); });
  await openPractice(page);
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('A valid report description');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await clickNavigation(page, 'Change vehicle');
  release?.();
  await expect(page.getByRole('heading', { name: 'What will you drive?' })).toBeVisible();
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('expires the active in-memory session on a report 401', async ({ page }) => {
  await page.route('**/practice/report', (route) => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await openPractice(page);
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('A valid report description');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('session has ended');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('reports after answering without changing result, favorite, language or the next presentation', async ({ page }) => {
  let next = 0;
  const second = { ...presentation, presentationId: '550e8400-e29b-41d4-a716-446655440011' };
  await page.route('**/practice/answer', (route) => route.fulfill({ json: {
    presentationId: presentation.presentationId, selectedChoiceId: ids[0], correctChoiceId: ids[2], isCorrect: false,
    explanationEnglish: 'Keep a safe distance.', explanationRussian: null, explanationThai: null,
    trapExplanationEnglish: null, trapExplanationRussian: null, trapExplanationThai: null,
  } }));
  await page.route('**/practice/favorite', (route) => route.fulfill({ json: { presentationId: presentation.presentationId, favorite: true } }));
  await page.route('**/practice/report', (route) => route.fulfill({ json: reportResponse }));
  await openPractice(page, (route) => {
    expect(route.request().postDataJSON()).toEqual({ categoryId: category.id });
    next++;
    return route.fulfill({ json: next === 1 ? presentation : second });
  }, [category]);
  await page.getByRole('radio', { name: 'Russian' }).check();
  await page.getByRole('radio', { name: /Action 1/ }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.getByRole('button', { name: 'Save to favorites' }).click();
  await openReport(page);
  await page.getByRole('textbox', { name: 'What may be wrong with this question?' }).fill('The wording may be misleading');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Report submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Answer result' })).toContainText('Incorrect');
  await expect(page.getByRole('button', { name: 'Saved to favorites' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Какое действие безопасно?' })).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.getByRole('button', { name: 'Report question' })).toBeVisible();
  await openReport(page);
  await expect(page.getByRole('textbox', { name: 'What may be wrong with this question?' })).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'Russian' })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Дорожные знаки/ })).toBeChecked();
});
