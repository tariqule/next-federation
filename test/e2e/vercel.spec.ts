import { encodeIslandRequest } from '@next-federation/protocol'
import { expect, test, type Page } from '@playwright/test'
import { HOST_APP } from './servers.ts'

// The island remote deployed on Vercel (test/fixtures/island-remote, guide:
// docs/guides/deploying-a-remote-on-vercel.md), embedded by a local host-app
// whose remote `a` is the Vercel production domain. Run after two production
// deploys, with:
//   NF_VERCEL_PROD_URL            the production domain, https://<project>.vercel.app
//   NF_VERCEL_OLD_DEPLOYMENT_ID   the previous deployment's id (dpl_...)
//   NF_VERCEL_OLD_DEPLOYMENT_URL  the previous deployment's generated URL
//   NF_VERCEL_OLD_BUILD_ID        the previous deployment's island buildId
// Servers: NF_MODE=prod NF_APPS=host-app (servers.ts points the host's
// remote `a` at NF_VERCEL_PROD_URL).
//
// What these tests pin down is what Vercel does on the Hobby plan, where
// Skew Protection is not available (verified 2026-11-16, see the guide).
const PROD = process.env.NF_VERCEL_PROD_URL?.replace(/\/+$/, '') ?? ''
const OLD_DEPLOYMENT_ID = process.env.NF_VERCEL_OLD_DEPLOYMENT_ID ?? ''
const OLD_DEPLOYMENT_URL =
  process.env.NF_VERCEL_OLD_DEPLOYMENT_URL?.replace(/\/+$/, '') ?? ''
const OLD_BUILD = process.env.NF_VERCEL_OLD_BUILD_ID ?? ''
test.skip(!PROD, 'needs NF_VERCEL_PROD_URL (a deployed Vercel remote)')

const PROPS = { sku: 'A1' }
const islandUrl = (base: string) =>
  encodeIslandRequest(base, 'ProductPanel', PROPS).url
const island = (page: Page) => page.locator('[data-island="ProductPanel"]')
const root = (page: Page) => page.locator('[data-nf-root]')

type Envelope = {
  buildId: string
  mode: string
  bootstrap: string
  css: string[]
}

async function currentEnvelope(page: Page): Promise<{
  envelope: Envelope
  text: string
}> {
  const res = await page.request.get(islandUrl(PROD))
  expect(res.status()).toBe(200)
  const text = await res.text()
  return { envelope: JSON.parse(text) as Envelope, text }
}

/**
 * Vercel Authentication's answer to an unauthenticated request: a redirect
 * to its login for a browser-style Accept, 401 for a JSON one (what a host's
 * server-side envelope fetch sends).
 */
async function expectVercelAuth(page: Page, url: string): Promise<void> {
  const browser = await page.request.get(url, { maxRedirects: 0 })
  expect(browser.status()).toBe(302)
  expect(browser.headers().location).toMatch(
    /^https:\/\/vercel\.com\/sso-api\?/
  )
  const json = await page.request.get(url, {
    maxRedirects: 0,
    headers: { accept: 'application/json' },
  })
  expect(json.status()).toBe(401)
}

test.beforeAll(() => {
  for (const [name, value] of Object.entries({
    NF_VERCEL_OLD_DEPLOYMENT_ID: OLD_DEPLOYMENT_ID,
    NF_VERCEL_OLD_DEPLOYMENT_URL: OLD_DEPLOYMENT_URL,
    NF_VERCEL_OLD_BUILD_ID: OLD_BUILD,
  })) {
    if (!value) throw new Error(`${name} is not set`)
  }
})

test('the production domain serves envelopes and assets without auth (Deployment Protection on)', async ({
  page,
}) => {
  const health = await page.request.get(`${PROD}/_nf/health`)
  expect(health.status()).toBe(200)
  expect(await health.text()).toBe('ok')

  const { envelope } = await currentEnvelope(page)
  expect(envelope.mode).toBe('production')
  expect(envelope.buildId).not.toBe(OLD_BUILD)
  const pinned = `${PROD}/b/${envelope.buildId}/`
  expect(envelope.bootstrap.startsWith(pinned)).toBe(true)
  expect(envelope.css.length).toBeGreaterThan(0)
  for (const url of [envelope.bootstrap, ...envelope.css]) {
    expect(url.startsWith(pinned)).toBe(true)
    const asset = await page.request.get(url)
    expect(asset.status()).toBe(200)
    // Cross-origin module scripts and stylesheets need CORS.
    expect(asset.headers()['access-control-allow-origin']).toBe('*')
    expect(asset.headers()['cache-control']).toContain('immutable')
  }

  // End to end: the local host renders the island from Vercel and it hydrates.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith(PROD)) requests.push(r.url())
  })
  await page.goto(HOST_APP)
  await expect(root(page)).toHaveAttribute('data-nf-build', envelope.buildId)
  await expect(root(page)).toHaveAttribute('data-nf-state', 'live')
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  expect(requests).toContain(envelope.bootstrap)
  expect(requests.every((u) => u.startsWith(pinned))).toBe(true)
  expect(errors).toEqual([])
})

test('a generated deployment URL is behind auth and is never used in an envelope', async ({
  page,
}) => {
  const { envelope, text } = await currentEnvelope(page)
  // Standard Protection: Vercel Authentication on the generated URL, for the
  // handler and for static files alike (it runs before routing).
  await expectVercelAuth(page, `${OLD_DEPLOYMENT_URL}/_nf/health`)
  await expectVercelAuth(page, islandUrl(OLD_DEPLOYMENT_URL))
  await expectVercelAuth(
    page,
    envelope.bootstrap.replace(PROD, OLD_DEPLOYMENT_URL)
  )

  // The envelope names the production domain only: bootstrap, css, and every
  // *.vercel.app host anywhere in the envelope (payload and HTML included).
  const prodHost = new URL(PROD).host
  expect(new URL(envelope.bootstrap).host).toBe(prodHost)
  for (const href of envelope.css) expect(new URL(href).host).toBe(prodHost)
  const hosts = new Set(text.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app/g))
  expect([...hosts]).toEqual([prodHost])
})

test('an island rendered by the previous deployment degrades cleanly after a new deploy', async ({
  page,
}) => {
  const { envelope } = await currentEnvelope(page)
  const current = envelope.buildId
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const oldAssets: number[] = []
  page.on('response', (r) => {
    if (r.url().startsWith(`${PROD}/b/${OLD_BUILD}/`)) {
      oldAssets.push(r.status())
    }
  })

  // The page as a cache still holds it from before the deploy (the host's
  // envelope cache, a CDN, an open tab): the island's HTML, payload and
  // asset URLs pinned to the previous build. Replayed by rewriting the host's
  // HTML to the previous build's prefix; on the production domain every
  // request under that prefix now reaches the new deployment.
  await page.route(HOST_APP + '/', async (route) => {
    const response = await route.fetch()
    const html = (await response.text()).replaceAll(
      `/b/${current}/`,
      `/b/${OLD_BUILD}/`
    )
    await route.fulfill({ response, body: html })
  })
  const res = await page.goto(HOST_APP)
  expect(res?.status()).toBe(200)
  // The library's behaviour: the bootstrap import fails, the island goes
  // inert (no fallback swap) and its server HTML stays.
  await expect(root(page)).toHaveAttribute('data-nf-state', 'inert')
  await expect(island(page).getByRole('heading')).toBeVisible()
  await expect(island(page).getByTestId('counter')).toHaveText('count 0')
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 0')
  // Vercel's behaviour (Hobby, no Skew Protection): the previous build's
  // assets are gone from the production domain.
  expect(oldAssets.length).toBeGreaterThan(0)
  expect(new Set(oldAssets)).toEqual(new Set([404]))
  expect(errors).toEqual([])

  // A reload renders the current build, which is live.
  await page.unroute(HOST_APP + '/')
  await page.reload()
  await expect(root(page)).toHaveAttribute('data-nf-build', current)
  await expect(root(page)).toHaveAttribute('data-nf-state', 'live')
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  expect(errors).toEqual([])
})

test('the previous deployment no longer answers its build-pinned island path on the production domain', async ({
  page,
}) => {
  // With Skew Protection the previous deployment could keep answering. On
  // Hobby (no Skew Protection) the production domain always routes to the newest
  // deployment: its function retires every other build (410 NF-023, as
  // `nf-serve` does), and the deployment id in `?dpl=` or `x-deployment-id`
  // does not pin the request.
  const pinned = islandUrl(`${PROD}/b/${OLD_BUILD}`)
  const variants: Array<{ url: string; headers: Record<string, string> }> = [
    { url: pinned, headers: {} },
    { url: `${pinned}&dpl=${OLD_DEPLOYMENT_ID}`, headers: {} },
    { url: pinned, headers: { 'x-deployment-id': OLD_DEPLOYMENT_ID } },
  ]
  for (const { url, headers } of variants) {
    const res = await page.request.get(url, { headers })
    expect(res.status()).toBe(410)
    expect(await res.json()).toEqual({ error: 'NF-023' })
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  }
  // The previous deployment itself still answers its pinned path, but only
  // on its generated URL, behind Vercel Authentication.
  await expectVercelAuth(
    page,
    islandUrl(`${OLD_DEPLOYMENT_URL}/b/${OLD_BUILD}`)
  )
})
