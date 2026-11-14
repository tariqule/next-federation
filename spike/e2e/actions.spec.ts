import { expect, test } from '@playwright/test';

const SPA = 'http://localhost:4200/islands';
const islandA = (page: import('@playwright/test').Page) =>
  page.locator('[data-island="ProductPanel"]');

test.describe('island Server Actions (cross-site, bearer token, no cookies)', () => {
  test('an action updates only its own island and reaches its own remote with a token and no cookie', async ({
    page,
  }) => {
    const actionRequests: {
      url: string;
      auth: string | null;
      cookie: string | null;
    }[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/_nf/action'))
        actionRequests.push({
          url: r.url(),
          auth: r.headers()['authorization'] ?? null,
          cookie: r.headers()['cookie'] ?? null,
        });
    });
    await page.goto(SPA);
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
    await islandA(page).getByRole('button', { name: 'Add A1' }).click();
    await expect(islandA(page).getByTestId('cart-count')).toHaveText(
      '1 for user-1',
    );
    expect(actionRequests).toHaveLength(1);
    expect(actionRequests[0]!.url).toBe('http://127.0.0.1:4100/_nf/action');
    expect(actionRequests[0]!.auth).toMatch(/^Bearer ey/);
    expect(actionRequests[0]!.cookie).toBeNull();
  });

  test('before hydration the form is disabled and cannot submit to the host', async ({
    page,
  }) => {
    const hostPosts: string[] = [];
    page.on(
      'request',
      (r) =>
        r.method() === 'POST' &&
        r.url().startsWith('http://localhost:4200') &&
        hostPosts.push(r.url()),
    );
    // Hold the island bootstrap so the island stays un-hydrated.
    // Dev serves it as /src/bootstrap.tsx, a production build as /assets/index-<hash>.js.
    await page.route(
      (url) =>
        url.origin === 'http://127.0.0.1:4100' &&
        (url.pathname === '/src/bootstrap.tsx' ||
          /^\/assets\/index-[\w-]+\.js$/.test(url.pathname)),
      async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        await route.continue();
      },
    );
    await page.goto(SPA);
    const qty = islandA(page).locator('input[name="qty"]');
    const submit = islandA(page).getByRole('button', { name: 'Add A1' });
    await expect(qty).toBeDisabled();
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    await page.waitForTimeout(300);
    expect(hostPosts).toEqual([]);
    expect(page.url()).toBe(SPA);
    // After hydration it works.
    await expect(submit).toBeEnabled({ timeout: 10_000 });
  });
});
