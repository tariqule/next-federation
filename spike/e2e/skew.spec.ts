import { expect, test } from '@playwright/test';

// Gate g: a cached island from an older remote build keeps working after a redeploy
// (self-hosted, build-pinned asset paths). Runs with NF_REMOTE_MODE=skew, where remote A
// serves builds v1 and v2 with v2 current.
test.skip(process.env.NF_REMOTE_MODE !== 'skew', 'needs NF_REMOTE_MODE=skew');

const SKEW = 'http://localhost:4200/skew';
const A = 'http://127.0.0.1:4100';
const island = (page: import('@playwright/test').Page) =>
  page.locator('[data-island="ProductPanel"]');

test('an island rendered by the old build still hydrates and its action reaches the old build', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => r.url().startsWith(A) && requests.push(r.url()));
  await page.goto(`${SKEW}?build=v1`);
  await expect(page.locator('[data-nf-root]')).toHaveAttribute(
    'data-nf-build',
    'v1',
  );
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
  expect(requests.some((u) => u.startsWith(`${A}/b/v1/assets/`))).toBe(true);
  expect(requests.some((u) => u.startsWith(`${A}/b/v2/`))).toBe(false);

  await island(page).getByTestId('counter').click();
  await expect(island(page).getByTestId('counter')).toHaveText('count 1');
  await island(page).getByRole('button', { name: 'Add A1' }).click();
  await expect(island(page).getByTestId('cart-count')).toHaveText(
    '1 for anonymous',
  );
  expect(requests).toContain(`${A}/b/v1/_nf/action`);
});

test('the current build serves v2-pinned assets', async ({ page }) => {
  await page.goto(SKEW);
  await expect(page.locator('[data-nf-root]')).toHaveAttribute(
    'data-nf-build',
    'v2',
  );
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
});

test('a new buildId re-bootstraps the island on the new build', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => r.url().startsWith(A) && requests.push(r.url()));
  await page.goto(`${SKEW}?build=v1`);
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'load current build' }).click();
  await expect(page.locator('[data-nf-root]')).toHaveAttribute(
    'data-nf-build',
    'v2',
  );
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1);
  expect(requests.some((u) => u.startsWith(`${A}/b/v2/assets/`))).toBe(true);
  await island(page).getByTestId('counter').click();
  await expect(island(page).getByTestId('counter')).toHaveText('count 1');
});
