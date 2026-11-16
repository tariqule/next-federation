import { expect, test, type Page } from '@playwright/test';

const HOSTS = [
  { name: 'cacheComponents off', url: 'http://localhost:3100' },
  { name: 'cacheComponents on', url: 'http://localhost:3102' },
];

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

for (const host of HOSTS) {
  test.describe(`Next App Router host (${host.name})`, () => {
    test('server HTML contains the island and it hydrates without errors', async ({
      page,
      request,
    }) => {
      const html = strip(await (await request.get(`${host.url}/`)).text());
      expect(html).toContain('Product A1');
      expect(html).not.toContain('<link rel="stylesheet" crossorigin'); // no hoistables from the island
      const errors = collectErrors(page);
      await page.goto(`${host.url}/`);
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
      await island(page, 'ProductPanel').getByTestId('counter').click();
      await expect(
        island(page, 'ProductPanel').getByTestId('counter'),
      ).toHaveText('count 1');
      expect(errors).toEqual([]);
    });

    test('gate c2: two remotes, three islands live and independent', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.goto(`${host.url}/two`);
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(3);
      const p0 = island(page, 'ProductPanel').nth(0);
      const p1 = island(page, 'ProductPanel').nth(1);
      const banner = island(page, 'Banner');
      await p0.getByTestId('counter').click();
      await p0.getByTestId('counter').click();
      await p1.getByTestId('counter').click();
      await expect(p0.getByTestId('counter')).toHaveText('count 2');
      await expect(p1.getByTestId('counter')).toHaveText('count 1');
      const bc = banner.getByTestId('counter');
      if (await bc.count()) {
        await bc.click();
        await expect(bc).toHaveText('count 1');
        await expect(p0.getByTestId('counter')).toHaveText('count 2');
      }
      expect(
        await page.evaluate(() => (window as any).__viteRscCallServer),
      ).toBeUndefined();
      expect(errors).toEqual([]);
    });

    test('island CSS is rendered by the host with precedence', async ({
      page,
    }) => {
      await page.goto(`${host.url}/`);
      await expect(
        page.locator(
          'link[rel="stylesheet"][data-precedence="next-federation"]',
        ),
      ).toHaveCount(1);
    });

    test('a private island renders per user and the token never reaches HTML or the RSC payload', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.url },
      ]);
      const res = await page.goto(`${host.url}/orders`);
      const html = strip(await res!.text());
      expect(html).toContain('Orders for user-1');
      expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
      const flight = await page.evaluate(() =>
        JSON.stringify((self as any).__next_f ?? []),
      );
      expect(flight).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    });

    test('an island Server Action works through the host token endpoint', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-7', url: host.url },
      ]);
      await page.goto(`${host.url}/`);
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
      await island(page, 'ProductPanel')
        .getByRole('button', { name: 'Add A1' })
        .click();
      await expect(
        island(page, 'ProductPanel').getByTestId('cart-count'),
      ).toHaveText(/ for user-7$/);
    });

    test('an island link navigates the host client-side', async ({ page }) => {
      await page.goto(`${host.url}/nav/one`);
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
      await page.evaluate(() => ((window as any).__nfMarker = 1));
      await island(page, 'Links')
        .getByRole('link', { name: 'go to two' })
        .click();
      await expect(page).toHaveURL(`${host.url}/nav/two`);
      // With cacheComponents the previous route stays mounted in a hidden <Activity>,
      // so only the visible island belongs to the new route.
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug'),
      ).toHaveText('on two');
      expect(await page.evaluate(() => (window as any).__nfMarker)).toBe(1); // no full reload
    });

    test('router.refresh() keeps island client state', async ({ page }) => {
      await page.goto(`${host.url}/`);
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
      await island(page, 'ProductPanel').getByTestId('counter').click();
      await page.getByRole('button', { name: 'refresh' }).click();
      await page.waitForTimeout(500);
      await expect(
        island(page, 'ProductPanel').getByTestId('counter'),
      ).toHaveText('count 1');
      await expect(page.locator('[data-nf-root]')).toHaveCount(1);
    });

    test('back navigation keeps a live island (Activity with cacheComponents)', async ({
      page,
    }) => {
      await page.goto(`${host.url}/nav/one`);
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
      await island(page, 'Links').getByTestId('counter').click();
      await page.getByRole('link', { name: 'host static page' }).click();
      await expect(page).toHaveURL(`${host.url}/static`);
      await page.goBack();
      await expect(page).toHaveURL(`${host.url}/nav/one`);
      await expect(page.locator('[data-island="Links"]:visible')).toHaveCount(
        1,
      );
      await expect(
        island(page, 'Links')
          .locator('visible=true')
          .getByTestId('counter')
          .first(),
      ).toBeVisible();
      if (host.url.endsWith('3102')) {
        // With Activity the same live island root is shown again, with its state.
        await expect(
          island(page, 'Links').getByTestId('counter').first(),
        ).toHaveText('count 1');
      }
    });

    test('Mode A: a remote client component renders the fallback on the server and works in the browser', async ({
      page,
      request,
    }) => {
      const html = await (await request.get(`${host.url}/cart`)).text();
      expect(html).toContain('loading cart');
      const errors = collectErrors(page);
      await page.goto(`${host.url}/cart`);
      await page.getByTestId('mode-a-cart').click();
      await expect(page.getByTestId('mode-a-cart')).toHaveText(
        'Cart (3) opened 1',
      );
      expect(errors.filter((e) => /Invalid hook call/.test(e))).toEqual([]);
    });
  });
}
