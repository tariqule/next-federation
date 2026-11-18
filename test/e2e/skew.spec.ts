import { expect, test, type Page } from '@playwright/test'
import { HOST_SPA, REMOTE_A, REMOTE_A_RETIRED } from './servers.ts'

// A cached island from an older remote build keeps working after a redeploy
// (self-hosted, build-pinned asset paths). Runs with NF_SUITE=skew, where
// remote A serves builds v1 and v2 with v2 current, and a second serve of the
// same builds on 4103 has retired v1.
// Servers: NF_APPS=fake-remote,remote-a,remote-b,remote-a-retired,host-spa,components-remote
test.skip(process.env.NF_SUITE !== 'skew', 'needs NF_SUITE=skew')

const SKEW = `${HOST_SPA}/skew`
const A = REMOTE_A
const island = (page: Page) => page.locator('[data-island="ProductPanel"]')

function requestsTo(page: Page, origin: string): string[] {
  const requests: string[] = []
  page.on(
    'request',
    (r) => r.url().startsWith(origin) && requests.push(r.url())
  )
  return requests
}

test('a v1 island keeps working after v2 is deployed: assets and state stay on v1', async ({
  page,
}) => {
  const requests = requestsTo(page, A)
  await page.goto(`${SKEW}?build=v1`)
  await expect(page.locator('[data-nf-root]')).toHaveAttribute(
    'data-nf-build',
    'v1'
  )
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  expect(
    requests.some((u) => u.startsWith(`${A}/b/v1/_nf/island/ProductPanel?`))
  ).toBe(true)
  expect(requests.some((u) => u.startsWith(`${A}/b/v1/assets/`))).toBe(true)
  expect(requests.some((u) => u.startsWith(`${A}/b/v2/`))).toBe(false)
})

test('a new buildId re-bootstraps on v2', async ({ page }) => {
  const requests = requestsTo(page, A)
  await page.goto(`${SKEW}?build=v1`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  await page.getByRole('button', { name: 'load current build' }).click()
  // The current build is v2, and it serves v2-pinned assets.
  await expect(page.locator('[data-nf-root]')).toHaveAttribute(
    'data-nf-build',
    'v2'
  )
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  await expect(page.getByTestId('live-roots')).toHaveText('1')
  expect(requests.some((u) => u.startsWith(`${A}/b/v2/assets/`))).toBe(true)
  // A fresh root on the new build: client state starts over.
  await expect(island(page).getByTestId('counter')).toHaveText('count 0')
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
})

test('v1 and v2 islands of one remote are live together', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${SKEW}?both=1`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  await expect(page.getByTestId('live-roots')).toHaveText('2')
  const v1 = page.locator('[data-nf-root][data-nf-build="v1"]')
  const v2 = page.locator('[data-nf-root][data-nf-build="v2"]')
  await expect(v1).toHaveCount(1)
  await expect(v2).toHaveCount(1)
  await v1.getByTestId('counter').click()
  await v1.getByTestId('counter').click()
  await v2.getByTestId('counter').click()
  await expect(v1.getByTestId('counter')).toHaveText('count 2')
  await expect(v2.getByTestId('counter')).toHaveText('count 1')
  expect(errors).toEqual([])
})

test('a retired build answers 410 and the host shows its fallback', async ({
  page,
}) => {
  const statuses: number[] = []
  page.on(
    'response',
    (r) =>
      r.url().startsWith(`${REMOTE_A_RETIRED}/b/v1/`) &&
      statuses.push(r.status())
  )
  await page.goto(`${HOST_SPA}/retired`)
  const fallback = page.getByTestId('island-fallback')
  await expect(fallback).toBeVisible()
  await expect(fallback).toHaveAttribute('data-code', 'NF-007')
  await expect(fallback).toContainText('status 410')
  // StrictMode runs the fetch effect twice in dev; every answer is a 410.
  expect(statuses.length).toBeGreaterThan(0)
  expect(new Set(statuses)).toEqual(new Set([410]))
  await expect(page.locator('[data-nf-root]')).toHaveCount(0)
  // The retiring server still serves the build it kept (v2), current and pinned.
  const p = Buffer.from(JSON.stringify({ sku: 'A1' })).toString('base64url')
  for (const path of ['', '/b/v2']) {
    const res = await page.request.get(
      `${REMOTE_A_RETIRED}${path}/_nf/island/ProductPanel?p=${p}`
    )
    expect(res.status()).toBe(200)
    expect(((await res.json()) as { buildId: string }).buildId).toBe('v2')
  }
})

test("on one page, a v1 island's action runs on /b/v1 and a v2 island's on /b/v2", async ({
  page,
}) => {
  const actions: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/_nf/action'))
      actions.push(r.url())
  })
  await page.goto(`${HOST_SPA}/actions?skew=1`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2, {
    timeout: 30_000,
  })
  for (const build of ['v1', 'v2']) {
    const mount = page.getByTestId(`mount-${build}`)
    await mount.getByTestId('submit-whoami').click()
    await expect(mount.getByTestId('result-whoami')).toContainText(
      `"buildId":"${build}"`
    )
  }
  expect(actions).toEqual([
    `${A}/b/v1/_nf/action?island=Cart`,
    `${A}/b/v2/_nf/action?island=Cart`,
  ])
})
