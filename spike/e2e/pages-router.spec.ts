import { expect, test, type Page } from '@playwright/test';

const HOST = 'http://localhost:3101';
const BASE_HOST = 'http://localhost:3103'; // same app with basePath "/base"

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !m.text().includes('Download the React DevTools')
    )
      errors.push(m.text());
  });
  return errors;
}
const strip = (html: string) => html.replaceAll('<!-- -->', '');
const island = (page: Page, name: string) =>
  page.locator(`[data-island="${name}"]`);

test.describe('Next Pages Router host', () => {
  test('server HTML contains the island and it hydrates without errors', async ({
    page,
    request,
  }) => {
    const html = strip(await (await request.get(`${HOST}/`)).text());
    expect(html).toContain('Product A1');
    const errors = collectErrors(page);
    await page.goto(`${HOST}/`);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
    await island(page, 'ProductPanel').getByTestId('counter').click();
    await expect(
      island(page, 'ProductPanel').getByTestId('counter'),
    ).toHaveText('count 1');
    expect(errors).toEqual([]);
  });

  test('island CSS is rendered by the host', async ({ request }) => {
    const html = await (await request.get(`${HOST}/`)).text();
    expect(html).toMatch(
      /<link[^>]+rel="stylesheet"[^>]+href="http:\/\/127\.0\.0\.1:4100\/[^"]+\.css/,
    );
  });

  test('a private island renders per user and no token reaches the page', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'nf-user', value: 'user-1', url: HOST }]);
    const res = await page.goto(`${HOST}/orders`);
    const html = strip(await res!.text());
    expect(html).toContain('Orders for user-1');
    expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // includes __NEXT_DATA__
  });

  test('a private island without a session shows its fallback', async ({
    request,
  }) => {
    const html = strip(await (await request.get(`${HOST}/orders`)).text());
    expect(html).toContain('orders unavailable');
    expect(html).not.toContain('Orders for');
  });

  test('an island Server Action works through the host token endpoint', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'nf-user', value: 'user-7', url: HOST }]);
    await page.goto(`${HOST}/`);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
    await island(page, 'ProductPanel')
      .getByRole('button', { name: 'Add A1' })
      .click();
    await expect(
      island(page, 'ProductPanel').getByTestId('cart-count'),
    ).toHaveText(/ for user-7$/);
  });

  test('an island link in a locale navigates the host client-side', async ({
    page,
  }) => {
    await page.goto(`${HOST}/fr/nav/one`);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
    await page.evaluate(() => ((window as any).__nfMarker = 1));
    await island(page, 'Links')
      .getByRole('link', { name: 'go to two' })
      .click();
    await expect(page).toHaveURL(`${HOST}/fr/nav/two`);
    await expect(
      page.locator('[data-island="Links"]:visible').getByTestId('slug'),
    ).toHaveText('on two');
    expect(await page.evaluate(() => (window as any).__nfMarker)).toBe(1);
  });

  test('with basePath and a locale the island link does not double the prefix', async ({
    page,
  }) => {
    await page.goto(`${BASE_HOST}/base/fr/nav/one`);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
    await expect(
      island(page, 'Links').getByRole('link', { name: 'go to two' }),
    ).toHaveAttribute('href', '/base/fr/nav/two');
    await page.evaluate(() => ((window as any).__nfMarker = 1));
    await island(page, 'Links')
      .getByRole('link', { name: 'go to two' })
      .click();
    await expect(page).toHaveURL(`${BASE_HOST}/base/fr/nav/two`);
    expect(await page.evaluate(() => (window as any).__nfMarker)).toBe(1);
  });

  test('Mode A: a remote client component renders the fallback on the server and works in the browser', async ({
    page,
    request,
  }) => {
    const html = await (await request.get(`${HOST}/cart`)).text();
    expect(html).toContain('loading cart');
    const errors = collectErrors(page);
    await page.goto(`${HOST}/cart`);
    await page.getByTestId('mode-a-cart').click();
    await expect(page.getByTestId('mode-a-cart')).toHaveText(
      'Cart (3) opened 1',
    );
    expect(errors.filter((e) => /Invalid hook call/.test(e))).toEqual([]);
  });
});
