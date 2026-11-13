import { expect, test } from '@playwright/test'

test('the SPA renders remote islands client-side', async ({ page }) => {
  await page.goto('http://localhost:4200/islands')
  await expect(page.locator('[data-island="ProductPanel"] h2')).toHaveText('Product A1')
  await expect(page.getByTestId('banner-text')).toHaveText('Hello B')
})

test('the SPA serves a Module Federation remote entry and a manifest exposing ./CartButton', async ({ request }) => {
  expect((await request.get('http://localhost:4200/remoteEntry.js')).status()).toBe(200)
  const manifest = await (await request.get('http://localhost:4200/mf-manifest.json')).json()
  expect(manifest.metaData.remoteEntry.name).toBe('remoteEntry.js')
  expect(manifest.exposes.map((e: { path: string }) => e.path)).toContain('./CartButton')
})
