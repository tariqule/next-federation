import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type Page } from '@playwright/test'
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'
import { FAKE_REMOTE, HOST_APP, HOST_APP_CC } from './servers.ts'

const HOSTS = [
  { name: 'cacheComponents off', url: HOST_APP, cc: false },
  { name: 'cacheComponents on', url: HOST_APP_CC, cc: true },
]
const FAKE = FAKE_REMOTE
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/

const here = dirname(fileURLToPath(import.meta.url))
const signingKey = JSON.parse(
  readFileSync(join(here, 'fixtures', 'test-signing-key.json'), 'utf8')
) as Record<string, string>

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !m.text().includes('Download the React DevTools')
    )
      errors.push(m.text())
  })
  return errors
}
const strip = (html: string) => html.replaceAll('<!-- -->', '')
// The rendered markup only: without Next's embedded RSC data, which also
// carries the fallbacks as props.
const markup = (html: string) =>
  strip(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''))
const island = (page: Page, name: string) =>
  page.locator(`[data-island="${name}"]`)
// Next's embedded RSC data: the `self.__next_f.push([1, "<rows>"])` scripts in
// the HTML, decoded to the Flight rows. (Read from the HTML: after hydration
// `self.__next_f` no longer holds it.)
function flight(html: string): string {
  const chunks = [
    ...html.matchAll(/<script>self\.__next_f\.push\((.*?)\)<\/script>/gs),
  ].map((m) => {
    const pushed = JSON.parse(m[1]!) as unknown[]
    return typeof pushed[1] === 'string' ? pushed[1] : ''
  })
  expect(chunks.join('')).not.toBe('')
  return chunks.join('')
}
// A Flight client-reference row for an export, e.g. `1c:I[41672,["…"],"Name"]`.
const clientReference = (name: string) =>
  new RegExp(`^[0-9a-f]+:I\\[.*,"${name}"(,\\d+)?\\]$`, 'm')
// Stylesheet links to a remote (remotes are reached as 127.0.0.1).
const REMOTE_SHEET = 'link[rel="stylesheet"][href^="http://127.0.0.1"]'
const remoteSheets = (html: string) =>
  [
    ...html.matchAll(
      /<link[^>]*rel="stylesheet"[^>]*href="(http:\/\/127\.0\.0\.1:[^"]+)"/g
    ),
  ].map((m) => m[1])
// The fixture's `.nf-product-panel` rule (1px border, 6px radius) applies.
async function expectIslandStyled(page: Page) {
  const panel = page.locator('[data-island="ProductPanel"]').first()
  await expect(panel).toHaveCSS('border-top-width', '1px')
  await expect(panel).toHaveCSS('border-top-left-radius', '6px')
}
const unique = (label: string) =>
  `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

for (const host of HOSTS) {
  test.describe(`Next App Router host (${host.name})`, () => {
    test('server HTML contains the island and it hydrates without errors', async ({
      page,
      request,
    }) => {
      const html = strip(await (await request.get(`${host.url}/`)).text())
      expect(html).toContain('Product A1')
      expect(html).not.toContain('<link rel="stylesheet" crossorigin') // no hoistables from the island
      const errors = collectErrors(page)
      await page.goto(`${host.url}/`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      await island(page, 'ProductPanel').getByTestId('counter').click()
      await expect(
        island(page, 'ProductPanel').getByTestId('counter')
      ).toHaveText('count 1')
      // The mount is a client reference ('use client' boundary), not
      // server-rendered-only markup.
      expect(flight(html)).toMatch(clientReference('NextIslandMount'))
      expect(errors).toEqual([])
    })

    test('gate c2: two remotes, three islands live and independent', async ({
      page,
    }) => {
      const errors = collectErrors(page)
      await page.goto(`${host.url}/two`)
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

    test('island CSS is rendered by the host with precedence', async ({
      page,
      request,
    }) => {
      const html = await (await request.get(`${host.url}/`)).text()
      const head = /<head>([\s\S]*?)<\/head>/.exec(html)![1]!
      expect(remoteSheets(head)).toHaveLength(1)
      expect(remoteSheets(html)).toEqual(remoteSheets(head))
      await page.goto(`${host.url}/`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      // Every stylesheet link to the remote is the one React stylesheet.
      await expect(page.locator(REMOTE_SHEET)).toHaveCount(1)
      await expect(
        page.locator(
          'link[rel="stylesheet"][data-precedence="next-federation"]'
        )
      ).toHaveCount(1)
      await expectIslandStyled(page)
    })

    test('island CSS links are deduped across islands of one remote', async ({
      page,
      request,
    }) => {
      // Three islands, two remotes: one stylesheet per remote, each once,
      // in the server HTML and in the browser.
      const html = await (await request.get(`${host.url}/two`)).text()
      const inHtml = [
        ...html.matchAll(/<link[^>]*data-precedence="next-federation"[^>]*>/g),
      ].map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
      expect(inHtml).toHaveLength(2)
      expect(new Set(inHtml).size).toBe(2)
      await page.goto(`${host.url}/two`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(3)
      const hrefs = await page
        .locator('link[rel="stylesheet"][data-precedence="next-federation"]')
        .evaluateAll((links) => links.map((l) => l.getAttribute('href')))
      expect(hrefs).toHaveLength(2)
      expect(new Set(hrefs).size).toBe(2)
      await expect(page.locator(REMOTE_SHEET)).toHaveCount(2)
    })

    test('a private island renders per user and the token never reaches HTML or the RSC payload', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.url },
      ])
      const res = await page.goto(`${host.url}/orders`)
      const html = strip(await res!.text())
      expect(html).toContain('Orders for user-1')
      expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./)
      expect(flight(html)).toContain('Orders for')
      expect(flight(html)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./)
    })

    test('a private island is a per-request dynamic hole: each user sees their own, anonymous sees the error fallback', async ({
      request,
    }) => {
      const get = async (cookie?: string) =>
        strip(
          await (
            await request.get(`${host.url}/orders`, {
              headers: cookie ? { cookie } : {},
            })
          ).text()
        )
      const one = await get('nf-user=user-1')
      const two = await get('nf-user=user-2')
      const anonymous = markup(await get())
      expect(one).toContain('Orders for user-1')
      expect(one).not.toContain('user-2')
      expect(two).toContain('Orders for user-2')
      expect(two).not.toContain('user-1')
      expect(anonymous).toContain('orders unavailable')
      expect(anonymous).not.toContain('Orders for')
    })

    test('the JWKS route publishes the runtime signing key (public part only)', async ({
      request,
    }) => {
      const res = await request.get(`${host.url}/api/next-federation/jwks`)
      expect(res.status()).toBe(200)
      expect(res.headers()['cache-control']).toBe('public, max-age=300')
      const jwks = (await res.json()) as { keys: Record<string, string>[] }
      expect(jwks.keys).toEqual([
        {
          kty: 'EC',
          crv: 'P-256',
          x: signingKey.x,
          y: signingKey.y,
          kid: signingKey.kid,
          alg: 'ES256',
          use: 'sig',
        },
      ])
      expect(JSON.stringify(jwks)).not.toContain(signingKey.d)
    })

    test('the token endpoint works for a signed-in user and rejects anonymous', async ({
      request,
    }) => {
      const url = `${host.url}/api/next-federation/token?aud=a`
      const ok = await request.post(url, {
        headers: { cookie: 'nf-user=user-3' },
      })
      expect(ok.status()).toBe(200)
      expect(ok.headers()['cache-control']).toBe('no-store')
      const body = (await ok.json()) as {
        token: string
        expiresAt: number
        identityKey: string
      }
      expect(Object.keys(body).sort()).toEqual([
        'expiresAt',
        'identityKey',
        'token',
      ])
      // Exactly the standard claims: nothing else from the identity is copied in.
      const claims = decodeJwt(body.token)
      expect(Object.keys(claims).sort()).toEqual([
        'aud',
        'exp',
        'iat',
        'iss',
        'sub',
      ])
      const jwks = (await (
        await request.get(`${host.url}/api/next-federation/jwks`)
      ).json()) as Parameters<typeof createLocalJWKSet>[0]
      const { payload, protectedHeader } = await jwtVerify(
        body.token,
        createLocalJWKSet(jwks),
        { issuer: host.url, audience: 'a', algorithms: ['ES256'] }
      )
      expect(payload.sub).toBe('user-3')
      expect(payload.exp).toBe(body.expiresAt)
      expect(protectedHeader.kid).toBe(signingKey.kid)

      const anonymous = await request.post(url)
      expect(anonymous.status()).toBe(401)
      expect(anonymous.headers()['cache-control']).toBe('no-store')
      expect(await anonymous.text()).toBe('')

      const unknown = await request.post(
        `${host.url}/api/next-federation/token?aud=nope`,
        { headers: { cookie: 'nf-user=user-3' } }
      )
      expect(unknown.status()).toBe(400)
    })

    test("no token in the HTML, in Next's embedded RSC data, or in any response to the browser", async ({
      browserName,
    }) => {
      // It launches its own Chromium (below): once, in the Chromium project.
      test.skip(browserName !== 'chromium', 'Chromium only')
      // Responses fulfilled through page.route lose their local address
      // space, so Chrome's Local Network Access checks would block the page's
      // own localhost requests (the dev HMR socket, RSC fetches): this test
      // uses its own browser with those checks off.
      const browser = await chromium.launch({
        args: ['--disable-features=LocalNetworkAccessChecks'],
      })
      try {
        const context = await browser.newContext()
        const page = await context.newPage()
        await context.addCookies([
          { name: 'nf-user', value: 'user-1', url: host.url },
        ])
        // Every response the browser gets goes through here, so each body is
        // read and scanned before the browser sees it.
        const scanned: { url: string; document: boolean; rsc: boolean }[] = []
        const unread: string[] = []
        const withToken: string[] = []
        await page.route('**/*', async (route) => {
          const request = route.request()
          let response
          let body
          try {
            response = await route.fetch()
            body = await response.body()
          } catch (error) {
            unread.push(`${request.url()}: ${String(error)}`)
            return route.abort().catch(() => {})
          }
          scanned.push({
            url: request.url(),
            document: request.resourceType() === 'document',
            rsc:
              request.headers()['rsc'] === '1' ||
              new URL(request.url()).searchParams.has('_rsc'),
          })
          if (JWT.test(body.toString('latin1'))) withToken.push(request.url())
          // The body is already decoded: drop the encoding headers with it.
          const headers = { ...response.headers() }
          delete headers['content-encoding']
          delete headers['content-length']
          await route
            .fulfill({ status: response.status(), headers, body })
            .catch(() => {})
        })
        const res = await page.goto(`${host.url}/orders`)
        expect(flight(await res!.text())).not.toMatch(JWT)
        await expect(page.getByText('Orders for user-1')).toBeVisible()
        // Client navigations and a refresh fetch RSC payloads too.
        await page.getByRole('link', { name: 'home' }).click()
        await expect(page).toHaveURL(`${host.url}/`)
        await page.getByRole('button', { name: 'refresh' }).click()
        await page.goto(`${host.url}/orders`)
        await page.getByRole('link', { name: 'nav' }).click()
        await expect(page).toHaveURL(`${host.url}/nav/one`)
        await page.waitForLoadState('networkidle')
        await page.unrouteAll({ behavior: 'wait' })
        expect(unread).toEqual([])
        expect(withToken).toEqual([])
        const orders = scanned.filter(
          (r) => r.document && new URL(r.url).pathname === '/orders'
        )
        expect(orders.length).toBe(2)
        // Only the two `goto`s load documents: the rest is client-side.
        expect(scanned.filter((r) => r.document).length).toBe(2)
        // RSC fetches: the client navigations and the refresh.
        expect(scanned.filter((r) => r.rsc).length).toBeGreaterThanOrEqual(3)
        expect(strip(await page.content())).not.toMatch(JWT)
      } finally {
        await browser.close()
      }
    })

    test('preloadIsland: one island request for preload + render', async ({
      request,
    }) => {
      const id = unique(host.cc ? 'cc' : 'legacy')
      const html = markup(
        await (await request.get(`${host.url}/preload?id=${id}`)).text()
      )
      expect(html).toContain(`echo ${id} rev`)
      const [, started, delay] = /started (\d+) delay (\d+)/
        .exec(html)!
        .map(Number)
      const stats = (await (await request.get(`${FAKE}/_stats`)).json()) as {
        requests: Record<string, number>
        arrivals: Record<string, number[]>
      }
      expect(stats.requests[`Echo:${id}`]).toBe(1)
      // The load started early: the remote saw the request while the page
      // was still in its own delay, not after it (as a render-time load would).
      const [arrived] = stats.arrivals[`Echo:${id}`]!
      expect(arrived).toBeGreaterThanOrEqual(started!)
      expect(arrived).toBeLessThan(started! + delay!)
    })

    test('the island link renders the host-relative href and navigates client-side', async ({
      page,
      request,
    }) => {
      const html = await (await request.get(`${host.url}/nav/one`)).text()
      expect(html).toMatch(/<a[^>]*href="\/nav\/two"/)
      await page.goto(`${host.url}/nav/one`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      const link = island(page, 'Links').getByRole('link', {
        name: 'go to two',
      })
      await expect(link).toHaveAttribute('href', '/nav/two')
      const documents: string[] = []
      page.on('request', (r) => {
        if (r.resourceType() === 'document') documents.push(r.url())
      })
      await link.click()
      await expect(page).toHaveURL(`${host.url}/nav/two`)
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug')
      ).toHaveText('on two')
      expect(documents).toEqual([]) // no full page load
    })

    test('an island link navigates the host client-side', async ({ page }) => {
      await page.goto(`${host.url}/nav/one`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      await page.evaluate(
        () => ((window as unknown as Record<string, unknown>).__nfMarker = 1)
      )
      await island(page, 'Links')
        .getByRole('link', { name: 'go to two' })
        .click()
      await expect(page).toHaveURL(`${host.url}/nav/two`)
      // With cacheComponents the previous route stays mounted in a hidden <Activity>,
      // so only the visible island belongs to the new route.
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug')
      ).toHaveText('on two')
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>).__nfMarker
        )
      ).toBe(1) // no full reload
    })

    test('router.refresh() keeps island client state', async ({ page }) => {
      await page.goto(`${host.url}/`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      await island(page, 'ProductPanel').getByTestId('counter').click()
      await page.getByRole('button', { name: 'refresh' }).click()
      await page.waitForTimeout(500)
      await expect(
        island(page, 'ProductPanel').getByTestId('counter')
      ).toHaveText('count 1')
      await expect(page.locator('[data-nf-root]')).toHaveCount(1)
    })

    test('back navigation keeps a live island (Activity with cacheComponents)', async ({
      page,
    }) => {
      await page.goto(`${host.url}/nav/one`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      await island(page, 'Links').getByTestId('counter').click()
      await page.getByRole('link', { name: 'host static page' }).click()
      await expect(page).toHaveURL(`${host.url}/static`)
      await page.goBack()
      await expect(page).toHaveURL(`${host.url}/nav/one`)
      await expect(page.locator('[data-island="Links"]:visible')).toHaveCount(1)
      await expect(
        island(page, 'Links')
          .locator('visible=true')
          .getByTestId('counter')
          .first()
      ).toBeVisible()
      if (host.cc) {
        // With Activity the same live island root is shown again, with its state.
        await expect(
          island(page, 'Links').getByTestId('counter').first()
        ).toHaveText('count 1')
      }
    })

    if (host.cc) {
      test("a host-level 'use cache' with a long cacheLife does not freeze an island failure", async ({
        request,
      }) => {
        const id = unique('outer')
        const page = () =>
          request
            .get(`${host.url}/outer-cache?id=${id}`)
            .then(async (r) => markup(await r.text()))
        try {
          await request.post(`${FAKE}/_flaky?down=1`)
          const down = await page()
          expect(down).toContain(`cached section ${id}`)
          expect(down).toContain('flaky unavailable')
          await request.post(`${FAKE}/_flaky?down=0`)
          await expect
            .poll(page, { timeout: 15_000, intervals: [500] })
            .toContain(`flaky ${id} rev`)
        } finally {
          await request.post(`${FAKE}/_flaky?down=0`)
        }
      })
    }
  })
}
