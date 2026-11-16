import { expect, test } from '@playwright/test'
import { HOST_SPA } from './servers.ts'

test('the SPA renders remote islands client-side', async ({ page }) => {
  await page.goto(`${HOST_SPA}/islands`)
  await expect(page.locator('[data-island="ProductPanel"] h2')).toHaveText(
    'Product A1'
  )
  await expect(page.getByTestId('banner-text')).toHaveText('Hello B')
})

test('IslandMount loads each island stylesheet once, into <head>', async ({
  page,
}) => {
  const sheets = () =>
    page
      .locator('link[rel="stylesheet"][href^="http://127.0.0.1"]')
      .evaluateAll((links) =>
        links.map((l) => ({
          href: l.getAttribute('href'),
          precedence: l.getAttribute('data-precedence'),
          inHead: l.parentElement === document.head,
        }))
      )
  await page.goto(`${HOST_SPA}/islands`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  // Two remotes, one stylesheet each; the host adds no <link> of its own.
  const first = await sheets()
  expect(first).toHaveLength(2)
  expect(new Set(first.map((s) => s.href)).size).toBe(2)
  for (const s of first) {
    expect(s).toMatchObject({ precedence: 'next-federation', inHead: true })
  }
  // The fixture's `.nf-product-panel` rule (1px border, 6px radius) applies.
  for (const name of ['ProductPanel', 'Banner']) {
    const el = page.locator(`[data-island="${name}"]`)
    await expect(el).toHaveCSS('border-top-width', '1px')
    await expect(el).toHaveCSS('border-top-left-radius', '6px')
  }
  // New envelope (bump) and remount (swap): still one link per href.
  await page.getByRole('button', { name: 'bump' }).click()
  await expect(page.getByTestId('banner-text')).toHaveText('Hello B2')
  await page.getByRole('button', { name: 'swap' }).click()
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  expect(await sheets()).toEqual(first)
})
