import { expect, test, type Page } from '@playwright/test';

const SPA = 'http://localhost:4200/islands';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

const islandA = (page: Page) => page.locator('[data-island="ProductPanel"]');
const islandB = (page: Page) => page.locator('[data-island="Banner"]');

test.describe('island lifecycle in a CSR host (SPA)', () => {
  test('two remotes hydrate independently with no plugin-rsc page globals', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto(SPA);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    await islandA(page).getByTestId('counter').click();
    await islandA(page).getByTestId('counter').click();
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 2');
    await expect(islandB(page).getByTestId('counter')).toHaveText('count 0');
    const globals = await page.evaluate(() => [
      typeof (window as any).__viteRscCallServer,
      typeof (window as any).__vite_rsc_require__,
      typeof (window as any).__vite_rsc_client_require__,
    ]);
    expect(globals).toEqual(['undefined', 'undefined', 'undefined']);
    expect(errors).toEqual([]);
  });

  test('a new envelope updates the island in place and keeps client state', async ({
    page,
  }) => {
    await page.goto(SPA);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    await islandB(page).getByTestId('counter').click();
    await page.getByRole('button', { name: 'bump' }).click();
    await expect(islandB(page).getByTestId('banner-text')).toHaveText(
      'Hello B2',
    );
    await expect(islandB(page).getByTestId('counter')).toHaveText('count 1');
  });

  test('a container swap re-bootstraps the island', async ({ page }) => {
    await page.goto(SPA);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'swap' }).click();
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    await islandA(page).getByTestId('counter').click();
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 1');
  });

  test('rapid nav: toggling 10 times leaves exactly one live root per island and no errors', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto(SPA);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    const toggle = page.getByRole('button', { name: 'toggle' });
    for (let i = 0; i < 10; i++) await toggle.click({ delay: 0 });
    await expect(page.locator('[data-nf-root]')).toHaveCount(2);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    await islandA(page).getByTestId('counter').click();
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 1');
    expect(errors).toEqual([]);
  });
});
