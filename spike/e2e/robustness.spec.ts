import { expect, test } from '@playwright/test';

const PAYLOAD = '</script><script>window.pwned=1</script><!--';
const HOSTS = [
  { name: 'App Router', url: 'http://localhost:3100' },
  { name: 'App Router + cacheComponents', url: 'http://localhost:3102' },
  { name: 'Pages Router', url: 'http://localhost:3101' },
];
const strip = (html: string) => html.replaceAll('<!-- -->', '');

for (const host of HOSTS) {
  test.describe(`${host.name}: failure modes`, () => {
    test('a remote that is down: page returns 200 with the fallback', async ({
      page,
    }) => {
      const res = await page.goto(`${host.url}/down`);
      expect(res!.status()).toBe(200);
      // Streaming briefly keeps a hidden copy until React swaps it in.
      await expect(page.getByText('remote unavailable')).toHaveCount(1);
      await expect(page.getByText('remote unavailable')).toBeVisible();
    });

    test('a slow remote: the host times out and shows the fallback', async ({
      page,
    }) => {
      const started = Date.now();
      const res = await page.goto(`${host.url}/slow`);
      expect(res!.status()).toBe(200);
      // Streaming briefly keeps a hidden copy until React swaps it in.
      await expect(page.getByText('remote too slow')).toHaveCount(1);
      await expect(page.getByText('remote too slow')).toBeVisible();
      expect(Date.now() - started).toBeLessThan(8000); // 3 s timeout, not the remote's 10 s
    });

    test('island content cannot inject script', async ({ page, request }) => {
      const html = await (await request.get(`${host.url}/inject`)).text();
      expect(html).not.toContain('<script>window.pwned=1</script>');
      await page.goto(`${host.url}/inject`);
      await expect(page.getByTestId('banner-text')).toHaveText(PAYLOAD);
      expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
    });

    test('an expired identity token shows the fallback and leaks nothing', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.url },
        { name: 'nf-test-ttl', value: '-1', url: host.url }, // spike-only test hook
      ]);
      const res = await page.goto(`${host.url}/orders`);
      const html = strip(await res!.text());
      expect(html).toContain('orders unavailable');
      expect(html).not.toContain('Orders for');
    });
  });
}

test.describe('SPA host: failure modes', () => {
  test('island content cannot inject script', async ({ page }) => {
    await page.goto('http://localhost:4200/inject');
    await expect(page.getByTestId('banner-text')).toHaveText(PAYLOAD);
    expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  });
});
