import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  HOST_PAGES,
  HOST_PAGES_BASE,
  LOGS_DIR,
  PORTS,
  REMOTE_A,
  REMOTE_B,
} from './servers.ts'

// One app, two hosts: 3101 plain, 3103 with basePath "/base". Both have i18n
// (en default, fr).
const HOSTS = [
  { name: 'no basePath', origin: HOST_PAGES, base: '', port: PORTS.hostPages },
  {
    name: 'basePath /base',
    origin: HOST_PAGES_BASE,
    base: '/base',
    port: PORTS.hostPagesBase,
  },
]
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' && !text.includes('Download the React DevTools'))
      errors.push(text)
    if (m.type() === 'warning' && /hydrat/i.test(text)) errors.push(text)
  })
  return errors
}
const strip = (html: string) => html.replaceAll('<!-- -->', '')
const island = (page: Page, name: string) =>
  page.locator(`[data-island="${name}"]`)
// The page props Next embeds for hydration.
function nextData(html: string): string {
  const json = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s.exec(
    html
  )?.[1]
  expect(json).toBeDefined()
  return json!
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
// Records island DOM events from the first script on.
async function recordIslandEvents(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { islandEvents: string[] }).islandEvents = seen
    document.addEventListener('nf:island', (e) => {
      const detail = (e as CustomEvent<{ type: string; remote: string }>).detail
      seen.push(`${detail.type}:${detail.remote}`)
    })
  })
  return () =>
    page.evaluate(
      () => (window as unknown as { islandEvents: string[] }).islandEvents
    )
}

for (const host of HOSTS) {
  const url = `${host.origin}${host.base}`

  test.describe(`Next Pages Router host (${host.name})`, () => {
    test('server HTML contains the island and it hydrates without errors', async ({
      page,
      request,
    }) => {
      const html = strip(await (await request.get(`${url}/`)).text())
      expect(html).toContain('Product A1')
      const errors = collectErrors(page)
      await page.goto(`${url}/`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      await island(page, 'ProductPanel').getByTestId('counter').click()
      await expect(
        island(page, 'ProductPanel').getByTestId('counter')
      ).toHaveText('count 1')
      expect(errors).toEqual([])
    })

    test('gate c2: two remotes, three islands live and independent', async ({
      page,
    }) => {
      const errors = collectErrors(page)
      await page.goto(`${url}/two`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(3)
      const p0 = island(page, 'ProductPanel').nth(0)
      const p1 = island(page, 'ProductPanel').nth(1)
      const banner = island(page, 'Banner')
      await p0.getByTestId('counter').click()
      await p0.getByTestId('counter').click()
      await p1.getByTestId('counter').click()
      await expect(p0.getByTestId('counter')).toHaveText('count 2')
      await expect(p1.getByTestId('counter')).toHaveText('count 1')
      const bc = banner.getByTestId('counter')
      if (await bc.count()) {
        await bc.click()
        await expect(bc).toHaveText('count 1')
        await expect(p0.getByTestId('counter')).toHaveText('count 2')
      }
      expect(
        await page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__viteRscCallServer
        )
      ).toBeUndefined()
      expect(errors).toEqual([])
    })

    test('StrictMode host: islands hydrate once and no hydration warning is logged', async ({
      page,
    }) => {
      const errors = collectErrors(page)
      const events = await recordIslandEvents(page)
      await page.goto(`${url}/two`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(3)
      // Give a second (StrictMode) hydration time to show up if there were one.
      await page.waitForTimeout(500)
      await expect(page.locator('[data-nf-root]')).toHaveCount(3)
      expect((await events()).sort()).toEqual([
        'island:hydrate:a',
        'island:hydrate:a',
        'island:hydrate:b',
      ])
      await island(page, 'Banner').getByTestId('counter').click()
      await expect(island(page, 'Banner').getByTestId('counter')).toHaveText(
        'count 1'
      )
      expect(errors).toEqual([])
    })

    test('island CSS is in the server HTML once per stylesheet, ahead of the island, without next/head', async ({
      page,
      request,
    }) => {
      const sheets = (h: string) =>
        [
          ...h.matchAll(
            /<link[^>]*rel="stylesheet"[^>]*href="(http:\/\/127\.0\.0\.1:[^"]+)"/g
          ),
        ].map((m) => m[1])
      const html = await (await request.get(`${url}/`)).text()
      // React's stylesheet resource, not a next/head tag.
      expect(html).toMatch(
        new RegExp(
          `<link rel="stylesheet" href="${escapeRe(REMOTE_A)}/[^"]+\\.css" data-precedence="next-federation"/>`
        )
      )
      expect(sheets(html)).toHaveLength(1)
      // Ahead of the island markup, so it never paints unstyled.
      expect(html.indexOf(sheets(html)[0]!)).toBeLessThan(
        html.indexOf('data-nf-root')
      )
      // Three islands, two remotes: one stylesheet per remote, each once.
      const two = await (await request.get(`${url}/two`)).text()
      expect(sheets(two)).toHaveLength(2)
      expect(new Set(sheets(two)).size).toBe(2)
      expect(sheets(two).some((h) => h!.startsWith(REMOTE_B))).toBe(true)
      // No "Do not add stylesheets using next/head" dev warning (nor any
      // other next/head one) while the page loads and hydrates.
      const warnings: string[] = []
      page.on('console', (m) => {
        if (/next\/head|no-stylesheets-in-head/.test(m.text()))
          warnings.push(m.text())
      })
      await page.goto(`${url}/two`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(3)
      const hrefs = await page
        .locator('link[rel="stylesheet"][href^="http://127.0.0.1"]')
        .evaluateAll((links) => links.map((l) => l.getAttribute('href')))
      expect(hrefs).toHaveLength(2)
      expect(new Set(hrefs).size).toBe(2)
      // The fixture's `.nf-product-panel` rule (1px border, 6px radius) applies.
      for (const name of ['ProductPanel', 'Banner']) {
        const el = island(page, name).first()
        await expect(el).toHaveCSS('border-top-width', '1px')
        await expect(el).toHaveCSS('border-top-left-radius', '6px')
      }
      // A page with one remote's island links only that remote's sheet.
      await page.goto(`${url}/`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      await expect(
        page.locator('link[rel="stylesheet"][href^="http://127.0.0.1"]')
      ).toHaveCount(1)
      expect(warnings).toEqual([])
    })

    test('a private island renders per user and no token reaches the page', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.origin },
      ])
      const res = await page.goto(`${url}/orders`)
      const html = strip(await res!.text())
      expect(html).toContain('Orders for user-1')
      expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./) // includes __NEXT_DATA__
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
    })

    test('a private island without a session shows its fallback', async ({
      request,
    }) => {
      const html = strip(await (await request.get(`${url}/orders`)).text())
      expect(html).toContain('orders unavailable')
      expect(html).not.toContain('Orders for')
      expect(JSON.parse(nextData(html)).props.pageProps.orders).toMatchObject({
        envelope: null,
        token: null,
      })
    })

    test('no token in the HTML or in __NEXT_DATA__', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.origin },
      ])
      // Every response to the browser, including the `/_next/data` JSON a
      // client navigation to a getServerSideProps page fetches.
      const seen: Promise<string | null>[] = []
      const dataUrls: string[] = []
      page.on('response', (r) => {
        if (r.url().includes('/_next/data/')) dataUrls.push(r.url())
        seen.push(
          r.body().then(
            (b) => (JWT.test(b.toString('latin1')) ? r.url() : null),
            () => null
          )
        )
      })
      const res = await page.goto(`${url}/orders`)
      const html = await res!.text()
      const data = nextData(html)
      // The props carry the token endpoint and an opaque key, never a token.
      const orders = JSON.parse(data).props.pageProps.orders as {
        token: { endpoint: string; identityKey: string }
      }
      expect(orders.token.endpoint).toBe(
        `${host.base}/api/next-federation/token?aud=a`
      )
      expect(orders.token.identityKey).not.toContain('user-1')
      expect(data).not.toMatch(JWT)
      expect(html).not.toMatch(JWT)
      await expect(page.getByText('Orders for user-1')).toBeVisible()
      await page.getByRole('link', { name: 'home' }).click()
      await expect(page).toHaveURL(host.base ? url : `${url}/`)
      await page.getByRole('link', { name: 'orders' }).click()
      await expect(page).toHaveURL(`${url}/orders`)
      await expect(page.getByText('Orders for user-1')).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(dataUrls.some((u) => u.includes('/orders.json'))).toBe(true)
      expect((await Promise.all(seen)).filter(Boolean)).toEqual([])
      expect(strip(await page.content())).not.toMatch(JWT)
    })

    test('the JWKS route is served (under the basePath when set)', async ({
      request,
    }) => {
      const res = await request.get(`${url}/api/next-federation/jwks`)
      expect(res.status()).toBe(200)
      const jwks = (await res.json()) as { keys: Record<string, string>[] }
      expect(jwks.keys).toHaveLength(1)
      expect(jwks.keys[0]!.d).toBeUndefined()
    })

    test('an island link in a locale navigates the host client-side', async ({
      page,
    }) => {
      await page.goto(`${url}/fr/nav/one`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      const link = island(page, 'Links').getByRole('link', {
        name: 'go to two',
      })
      await expect(link).toHaveAttribute('href', `${host.base}/fr/nav/two`)
      const documents: string[] = []
      page.on('request', (r) => {
        if (r.resourceType() === 'document') documents.push(r.url())
      })
      await page.evaluate(
        () => ((window as unknown as Record<string, unknown>).__nfMarker = 1)
      )
      await link.click()
      await expect(page).toHaveURL(`${url}/fr/nav/two`)
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug')
      ).toHaveText('on two')
      expect(documents).toEqual([]) // no full page load
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>).__nfMarker
        )
      ).toBe(1)
    })

    test('an island link in the default locale has no locale prefix', async ({
      page,
    }) => {
      await page.goto(`${url}/nav/one`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      const link = island(page, 'Links').getByRole('link', {
        name: 'go to two',
      })
      await expect(link).toHaveAttribute('href', `${host.base}/nav/two`)
      await link.click()
      await expect(page).toHaveURL(`${url}/nav/two`)
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug')
      ).toHaveText('on two')
    })
  })
}

test('with basePath and a locale the link is /base/fr/nav/two and does not double the prefix', async ({
  page,
}) => {
  const base = `${HOST_PAGES_BASE}/base`
  await page.goto(`${base}/fr/nav/one`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  const link = island(page, 'Links').getByRole('link', { name: 'go to two' })
  await expect(link).toHaveAttribute('href', '/base/fr/nav/two')
  const documents: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'document') documents.push(r.url())
  })
  await page.evaluate(
    () => ((window as unknown as Record<string, unknown>).__nfMarker = 1)
  )
  await link.click()
  await expect(page).toHaveURL(`${base}/fr/nav/two`)
  expect(page.url()).not.toContain('/base/base')
  expect(page.url()).not.toContain('/fr/fr')
  await expect(
    page.locator('[data-island="Links"]:visible').getByTestId('slug')
  ).toHaveText('on two')
  // The next island link is built from the new page's host context.
  await expect(
    island(page, 'Links').getByRole('link', { name: 'go to one' })
  ).toHaveAttribute('href', '/base/fr/nav/one')
  expect(documents).toEqual([]) // no full reload
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__nfMarker
    )
  ).toBe(1)
})

test.describe('production build (Pages Router)', () => {
  test.skip(process.env.NF_MODE !== 'prod', 'production builds only')

  for (const host of HOSTS) {
    test(`${host.name}: getStaticProps + revalidate keeps the page static (ISR); private and SSR pages are dynamic`, async ({
      request,
    }) => {
      const log = readFileSync(
        join(LOGS_DIR, `host-pages-${host.port}.build.log`),
        'utf8'
      )
      // ● is SSG (getStaticProps); Next 16 prints no revalidate for Pages
      // routes, so the ISR lifetime is read from the response below.
      expect(log).toMatch(/^[├└┌] ● \/static\b/m)
      expect(log).toMatch(/^[├└┌] ƒ \/orders\b/m)
      expect(log).toMatch(/^[├└┌] ƒ \/two\b/m)
      const url = `${host.origin}${host.base}`
      for (const path of ['/static', '/fr/static']) {
        const res = await request.get(`${url}${path}`)
        expect(['HIT', 'STALE']).toContain(res.headers()['x-nextjs-cache'])
        expect(res.headers()['cache-control']).toMatch(/^s-maxage=60\b/)
        const html = strip(await res.text())
        expect(html).toContain('static banner') // island HTML is in the prerendered page
        expect(html).not.toContain('banner unavailable')
      }
      // A private island page is never cached by the host.
      const orders = await request.get(`${url}/orders`)
      expect(orders.headers()['x-nextjs-cache']).toBeUndefined()
    })
  }
})
