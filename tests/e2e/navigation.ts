import type { Page } from '@playwright/test';

/** Follow the real disclosure when a secondary destination is not on screen. */
export async function openNavigation(page: Page, name: string, exact = false) {
  if (!await page.getByRole('button', { name, exact }).isVisible()) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
  }
}

export async function clickNavigation(page: Page, name: string, exact = false) {
  await openNavigation(page, name, exact);
  await page.getByRole('button', { name, exact }).click();
}

export async function openTopics(page: Page) {
  const topics = page.locator('details.scope-picker');
  if (!await topics.evaluate((element) => element.hasAttribute('open'))) {
    await topics.locator('summary').click();
  }
}
