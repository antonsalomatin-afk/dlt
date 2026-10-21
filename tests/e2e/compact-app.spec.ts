import { expect, test, type Page } from '@playwright/test';

const choices = ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440004'];
const presentationId = '550e8400-e29b-41d4-a716-446655440010';
const question = {
  id: '550e8400-e29b-41d4-a716-446655440020', textEnglish: 'What should you do before changing lanes?',
  textRussian: 'Что следует сделать перед перестроением? Проверьте дорожную обстановку и убедитесь, что выбранный манёвр можно выполнить безопасно.', textThai: null, textExamEnglish: null,
  choices: choices.map((id, index) => ({ id, key: ['A', 'B', 'C', 'D'][index], textEnglish: ['Turn immediately', 'Check mirrors and blind spots', 'Close your eyes', 'Ignore other vehicles'][index], textRussian: null, textThai: null })),
};

async function signIn(page: Page, vehicle: 'CAR' | 'MOTORCYCLE' = 'CAR') {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType:'application/javascript', body:'window.Telegram={WebApp:{initData:"compact-test",ready(){}}};' }));
  await page.route('**/auth/telegram', route => route.fulfill({ json: { token:'x'.repeat(43),expiresAt:'2099-01-01T00:00:00.000Z',user:{id:choices[0],username:null,firstName:null,selectedVehicleType:vehicle} } }));
  await page.route('**/practice/categories', route => route.fulfill({json:{categories:[]}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'What will you drive?'})).toBeVisible();
}

for (const [vehicle, label] of [['CAR', 'Car'], ['MOTORCYCLE', 'Motorcycle']] as const) {
  test(`practice identifies the saved ${label} profile selection`, async ({ page }) => {
    await signIn(page, vehicle);
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.locator('.vehicle-context')).toHaveText(`Saved vehicle: ${label}`);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.vehicle-context')).toHaveText(`Saved vehicle: ${label}`);
  });
}

for (const width of [320,390,1000]) {
  test(`compact onboarding puts practice first at ${width}px`, async({page},info) => {
    await page.setViewportSize({width,height:780});
    await signIn(page);
    await expect(page.getByText('A little practice.')).toHaveCount(0);
    const start=page.getByRole('button',{name:'Start practice'});
    await expect(start).toBeInViewport();
    await expect(page.getByRole('button',{name:'Mock exam',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`compact-onboarding-${width}.png`),fullPage:true});
  });
}

test('menu preserves choices, Escape restores focus, and only Check answer submits', async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  let next=0;
  let submitted=0;
  await page.route('**/practice/next',route=>{
    next++;
    return route.fulfill({json:{presentationId:next===1?presentationId:choices[3],question:{...question,textEnglish:next===1?question.textEnglish:'What should you check next?'}}});
  });
  await page.route('**/practice/answer',route=>{
    submitted++;
    expect(route.request().postDataJSON()).toEqual({presentationId,choiceId:choices[1]});
    return route.fulfill({json:{presentationId,selectedChoiceId:choices[1],correctChoiceId:choices[1],isCorrect:true,explanationEnglish:'Check mirrors and blind spots before moving.',explanationRussian:null,explanationThai:null,trapExplanationEnglish:null,trapExplanationRussian:null,trapExplanationThai:null}});
  });
  await signIn(page);
  await page.getByRole('button',{name:'Start practice'}).click();
  await page.getByRole('button',{name:'Get a question'}).click();
  await page.getByRole('radio',{name:/Turn immediately/}).check();
  await page.getByRole('radio',{name:/Check mirrors and blind spots/}).check();
  expect(submitted).toBe(0);
  await page.screenshot({path:info.outputPath('compact-question-390.png'),fullPage:true});
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Learning menu'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Change vehicle'})).toBeFocused();
  await page.screenshot({path:info.outputPath('compact-menu-390.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeFocused();
  await expect(page.getByRole('radio',{name:/Check mirrors and blind spots/})).toBeChecked();
  expect(next).toBe(1); expect(submitted).toBe(0);
  await page.getByRole('button',{name:'Check answer',exact:true}).click();
  await expect(page.getByRole('region',{name:'Answer result'})).toContainText('Correct');
  expect(submitted).toBe(1);
  await page.screenshot({path:info.outputPath('compact-feedback-390.png'),fullPage:true});
  await page.getByRole('button',{name:'Next question'}).click();
  await expect(page.getByRole('heading',{name:'What should you check next?'})).toBeVisible();
  expect(next).toBe(2);
  await page.setViewportSize({width:320,height:780});
  await page.getByRole('radio',{name:'Russian',exact:true}).check();
  await expect(page.getByRole('heading',{name:question.textRussian})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('compact-russian-320.png'),fullPage:true});
});
