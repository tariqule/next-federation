// Next.js 15 hosts (React 19): islands and remote components on an App
// Router host (test/fixtures/host-app-next15) and a Pages Router host
// (test/fixtures/host-pages-next15), both on next@15 and the legacy caching
// model, with the Next 16 hosts' remotes (island remote `a`, the signed
// components remote). Runs in every mode and bundler of the e2e matrix.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import { decodeJwt } from 'jose'
import {
  BUNDLER,
  FAKE_REMOTE,
  HOST_APP_NEXT15,
  HOST_PAGES_NEXT15,
  LOGS_DIR,
  MODE,
  PORTS,
  REMOTE_A,
} from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

type Host = {
  name: string
  url: string
  router: 'app' | 'pages'
  /** The remote component's link and what it renders from the host router. */
  link: { testId: string; expose: string; router: [string, string] }
}

const HOSTS: Host[] = [
  {
    name: 'App Router',
    url: HOST_APP_NEXT15,
    router: 'app',
    link: {
      testId: 'remote-link',
      expose: './NavLink',
      router: ['remote-pathname', '/components'],
    },
  },
  {
    name: 'Pages Router',
    url: HOST_PAGES_NEXT15,
    router: 'pages',
    link: {
      testId: 'remote-pages-link',
      expose: './PagesNavLink',
      router: ['remote-router', '/components no-locale'],
    },
  },
]

// `next dev` with webpack re-instantiates host modules, so remote components
// render browser-only there (the same limit as the Next 16 hosts, see
// mode-a.spec.ts). Next 15's dev server uses webpack unless --turbopack.
const DEV_WEBPACK = MODE === 'dev' && BUNDLER === 'webpack'

// These fixtures link the library from the workspace, outside node_modules,
// so under `next dev` Next's tooling treats it as app code and React's debug
// info, which Next 15 inlines in the App Router's HTML and RSC payload,
// carries what it awaits (cookies, headers, the minted token; NF-037,
// docs/guides/limits.mdx). The leak check is skipped only there:
// installed-dev.spec.ts runs it against a real install under `next dev`.
const LINKED_DEV = (host: Host) => MODE === 'dev' && host.router === 'app'

const JWT = /eyJ[A-Za-z0-9_-]{10,}\./
// The private island's content, as HTML, RSC or JSON-escaped HTML.
const ORDERS = /Orders for (<!-- -->|\\u003c!-- --\\u003e)?user-1/

// Request headers that must never be echoed into a page (React's dev-only
// debug info carries them when they are awaited).
const LEAK_HEADERS = [
  'x-forwarded-host',
  'x-forwarded-for',
  'sec-fetch-mode',
  'upgrade-insecure-requests',
  'accept-language',
]

const BAD =
  /hydrat|Invalid hook call|did not match|Minified React error #4(18|19|23|25)/i

function watch(page: Page) {
  const bad: string[] = []
  const all: string[] = []
  page.on('pageerror', (e) => {
    all.push(e.message)
    bad.push(e.message)
  })
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    all.push(m.text())
    if (BAD.test(m.text())) bad.push(m.text())
  })
  return { bad, all }
}

async function serverHtml(url: string, cookie?: string): Promise<string> {
  const res = await fetch(url, {
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30_000),
  })
  expect(res.status).toBe(200)
  return markup(await res.text())
}

const island = (page: Page, name: string) =>
  page.locator(`[data-island="${name}"]`)

/** Waits until the browser loaded (and so hydrated) this expose. */
async function loadedInBrowser(page: Page, expose: string): Promise<void> {
  await page.waitForFunction(
    (x) =>
      (
        (window as { __nfEvents?: Array<{ type: string; expose: string }> })
          .__nfEvents ?? []
      ).some((e) => e.type === 'component:load' && e.expose === x),
    expose,
    { timeout: 20_000 }
  )
}

test('the Next 15 hosts run Next 15', async ({ page }) => {
  for (const host of HOSTS) {
    await page.goto(`${host.url}/`)
    // Next's browser global, on both routers.
    const version = await page.evaluate(
      () => (window as { next?: { version?: string } }).next?.version
    )
    expect(version, host.name).toMatch(/^15\./)
  }
})

for (const host of HOSTS) {
  test.describe(`Next 15 ${host.name} host`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as { __nfEvents?: unknown[] }
        w.__nfEvents = []
        document.addEventListener('nf:component', (e) =>
          w.__nfEvents!.push((e as CustomEvent).detail)
        )
      })
    })

    test('an island is in the server HTML and hydrates without errors', async ({
      page,
    }) => {
      expect(await serverHtml(`${host.url}/`)).toContain('Product A1')
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      const counter = island(page, 'ProductPanel').getByTestId('counter')
      await counter.click()
      await expect(counter).toHaveText('count 1')
      expect(bad, all.join('\n')).toEqual([])
    })

    test('a private island renders per user; anonymous gets the fallback', async ({
      browser,
    }) => {
      const url = `${host.url}/orders`
      const one = await serverHtml(url, 'nf-user=user-1')
      const two = await serverHtml(url, 'nf-user=user-2')
      const anonymous = await serverHtml(url)
      expect(one).toContain('Orders for user-1')
      expect(one).not.toContain('user-2')
      expect(two).toContain('Orders for user-2')
      expect(anonymous).toContain('orders unavailable')
      expect(anonymous).not.toContain('Orders for')
      // And in the browser.
      for (const [user, text] of [
        ['user-1', 'Orders for user-1'],
        [null, 'orders unavailable'],
      ] as const) {
        const context = await browser.newContext()
        if (user) {
          await context.addCookies([{ name: 'nf-user', value: user, url }])
        }
        const page = await context.newPage()
        await page.goto(url)
        await expect(page.getByText(text)).toBeVisible()
        if (!user) await expect(page.getByText('Orders for')).toHaveCount(0)
        await context.close()
      }
    })

    test('no identity token, cookie or request header reaches the browser', async ({
      browser,
    }) => {
      test.skip(
        LINKED_DEV(host),
        'linked library under next dev (NF-037): installed-dev.spec.ts covers a real install'
      )
      // Random canaries: a cookie and an Authorization header on the
      // request, which must not appear in anything sent back.
      const cookieCanary = `cc${randomBytes(8).toString('hex')}`
      const authCanary = `ac${randomBytes(8).toString('hex')}`
      const requestHeaders = {
        cookie: `nf-user=user-1; nf-canary=${cookieCanary}`,
        authorization: `Bearer ${authCanary}`,
      }
      const get = async (path: string, extra: Record<string, string> = {}) => {
        const res = await fetch(`${host.url}${path}`, {
          headers: { ...requestHeaders, ...extra },
          signal: AbortSignal.timeout(30_000),
        })
        expect(res.status, path).toBe(200)
        return {
          type: res.headers.get('content-type') ?? '',
          body: await res.text(),
        }
      }
      const html = (await get('/orders')).body
      const bodies: Array<[string, string]> = [['HTML', html]]
      if (host.router === 'app') {
        // The RSC payload of a client navigation to the page.
        const rsc = await get('/orders', { rsc: '1' })
        expect(rsc.type).toContain('text/x-component')
        bodies.push(['RSC payload', rsc.body])
      } else {
        // __NEXT_DATA__, and the JSON a client navigation fetches.
        const data = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s.exec(
          html
        )
        expect(data, '__NEXT_DATA__').not.toBeNull()
        bodies.push(['__NEXT_DATA__', data![1]!])
        const { buildId } = JSON.parse(data![1]!) as { buildId: string }
        const json = await get(`/_next/data/${buildId}/orders.json`, {
          'x-nextjs-data': '1',
        })
        expect(json.type).toContain('application/json')
        bodies.push(['/_next/data orders.json', json.body])
      }
      // Soft: every leaking body is reported, not only the first.
      for (const [name, body] of bodies) {
        expect.soft(body, name).toMatch(ORDERS)
        expect.soft(body, name).not.toMatch(JWT)
        expect.soft(body, name).not.toContain(cookieCanary)
        expect.soft(body, name).not.toContain(authCanary)
        expect.soft(body, name).not.toContain('nf-user')
        for (const header of LEAK_HEADERS) {
          expect.soft(body.toLowerCase(), name).not.toContain(header)
        }
      }
      expect(test.info().errors).toEqual([])

      // A real browser: every response from the host on a full load and a
      // client navigation to the page (the token endpoint's own answer, which
      // is a token by design, aside).
      const context = await browser.newContext()
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.url },
        { name: 'nf-canary', value: cookieCanary, url: host.url },
      ])
      const page = await context.newPage()
      const seen: Promise<string | null>[] = []
      const navigations: string[] = []
      page.on('response', (r) => {
        const u = r.url()
        if (!u.startsWith(host.url) || u.includes('/api/next-federation/token'))
          return
        if (u.includes('/_next/data/') || r.request().headers()['rsc'])
          navigations.push(u)
        seen.push(
          r.body().then(
            (b) => {
              const text = b.toString('latin1')
              return JWT.test(text) || text.includes(cookieCanary) ? u : null
            },
            () => null
          )
        )
      })
      page.on('websocket', (ws) => {
        ws.on('framereceived', (f) => {
          const text =
            typeof f.payload === 'string'
              ? f.payload
              : Buffer.from(f.payload).toString('latin1')
          if (JWT.test(text) || text.includes(cookieCanary))
            seen.push(Promise.resolve(`websocket ${ws.url()}`))
        })
      })
      await page.goto(`${host.url}/orders`)
      await expect(page.getByText('Orders for user-1')).toBeVisible()
      await page.getByRole('link', { name: 'home' }).click()
      await expect(page).toHaveURL(`${host.url}/`)
      await page.getByRole('link', { name: 'orders' }).click()
      await expect(page).toHaveURL(`${host.url}/orders`)
      await expect(page.getByText('Orders for user-1')).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(navigations.some((u) => u.includes('/orders'))).toBe(true)
      expect((await Promise.all(seen)).filter(Boolean)).toEqual([])
      expect(markup(await page.content())).not.toMatch(JWT)
      await context.close()
    })

    test('an island link navigates the host client-side', async ({ page }) => {
      const html = await serverHtml(`${host.url}/nav/one`)
      expect(html).toMatch(/<a[^>]*href="\/nav\/two"/)
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/nav/one`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      const documents: string[] = []
      page.on('request', (r) => {
        if (r.resourceType() === 'document') documents.push(r.url())
      })
      await island(page, 'Links')
        .getByRole('link', { name: 'go to two' })
        .click()
      await expect(page).toHaveURL(`${host.url}/nav/two`)
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug')
      ).toHaveText('on two')
      expect(documents).toEqual([]) // no full page load
      expect(bad, all.join('\n')).toEqual([])
    })

    test('a remote island that is down renders the fallback', async ({
      page,
    }) => {
      expect(await serverHtml(`${host.url}/down`)).toContain(
        'remote unavailable'
      )
      await page.goto(`${host.url}/down`)
      await expect(page.getByText('remote unavailable')).toBeVisible()
    })

    test("a remote component from a signed descriptor: server-rendered on the host's Next router, then a client navigation", async ({
      page,
    }) => {
      const { testId, expose, router } = host.link
      const body = await serverHtml(`${host.url}/components`)
      expect(body).toMatch(/data-testid="rendered-build"[^>]*>c1</)
      if (!(DEV_WEBPACK && body.includes('data-nf-browser-only'))) {
        expect(body).toMatch(
          new RegExp(
            `<a[^>]*href="/nav/one"[^>]*data-testid="${testId}"|<a[^>]*data-testid="${testId}"[^>]*href="/nav/one"`
          )
        )
        expect(body).toMatch(
          new RegExp(`data-testid="${router[0]}"[^>]*>${router[1]}<`)
        )
      }
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/components`)
      await expect(page.getByTestId(router[0])).toHaveText(router[1])
      await loadedInBrowser(page, expose)
      // Survives a client navigation only (a full load starts a new window).
      await page.evaluate(() => {
        ;(window as { __nfNoReload?: boolean }).__nfNoReload = true
      })
      await page.getByTestId(testId).click()
      await expect(page).toHaveURL(`${host.url}/nav/one`)
      await expect(
        page.locator('[data-island="Links"]:visible').getByTestId('slug')
      ).toHaveText('on one')
      expect(
        await page.evaluate(
          () => (window as { __nfNoReload?: boolean }).__nfNoReload
        )
      ).toBe(true)
      expect(bad, all.join('\n')).toEqual([])
    })

    test('a remote component whose remote is down renders its fallback', async ({
      page,
    }) => {
      const fallback =
        host.router === 'app' ? 'nav-fallback' : 'pages-nav-fallback'
      const body = await serverHtml(`${host.url}/components-down`)
      expect(body).toMatch(/data-testid="rendered-build"[^>]*>none</)
      await page.goto(`${host.url}/components-down`)
      await expect(page.getByTestId(fallback)).toBeVisible()
      await expect(page.getByTestId(host.link.testId)).toHaveCount(0)
    })
  })
}

// Island Server Actions on the Next 15 App Router host (as actions.spec.ts
// does on the Next 16 hosts): a public island on a static page whose action
// runs as the signed-in user, with the island's bearer and never a cookie.
test.describe('Next 15 App Router host: island Server Actions', () => {
  test.describe.configure({ timeout: 120_000 })

  test('an action runs as the signed-in user, with a bearer and no cookie', async ({
    page,
  }) => {
    const actions: Request[] = []
    page.on('request', (r) => {
      if (
        r.method() === 'POST' &&
        new URL(r.url()).pathname.endsWith('/_nf/action')
      )
        actions.push(r)
    })
    await page.context().addCookies([
      { name: 'nf-user', value: 'alice', url: 'http://localhost' },
      // A cookie the remote set must not be sent with the action either.
      { name: 'remote-session', value: 'leak', url: REMOTE_A },
    ])
    const { bad, all } = watch(page)
    await page.goto(`${HOST_APP_NEXT15}/actions`)
    const mount = page.getByTestId('mount-a1')
    await expect(
      mount.locator('[data-nf-root][data-nf-state="live"]')
    ).toHaveCount(1, { timeout: MODE === 'dev' ? 90_000 : 30_000 })
    const result = mount.getByTestId('result-whoami')
    await mount.getByTestId('submit-whoami').click()
    await expect(result).toHaveAttribute('data-calls', '1')
    await expect(result).toContainText('"sub":"alice"')
    await expect(mount.getByTestId('error-whoami')).toHaveText('')
    expect(actions).toHaveLength(1)
    expect(new URL(actions[0]!.url()).origin).toBe(REMOTE_A)
    const headers = await actions[0]!.allHeaders()
    expect(headers.cookie).toBeUndefined()
    expect(headers.authorization).toMatch(/^Bearer ey/)
    const claims = decodeJwt(headers.authorization!.slice(7))
    expect(claims).toMatchObject({ aud: 'a', sub: 'alice' })
    expect(bad, all.join('\n')).toEqual([])
  })
})

// Static stays static on Next 15: read from the `next build` logs the harness
// writes (servers.ts), as static.spec.ts and pages-router.spec.ts do.
test.describe('production builds of the Next 15 hosts', () => {
  test.skip(MODE !== 'prod', 'production builds only')
  const buildLog = (app: string, port: number) =>
    readFileSync(join(LOGS_DIR, `${app}-${port}.build.log`), 'utf8')

  test('App Router: generateStaticParams and public-island pages are prerendered; a private island page is dynamic', async () => {
    const log = buildLog('host-app-next15', PORTS.hostAppNext15)
    expect(log).toMatch(/^[├└┌] [○●] \/nav\/\[slug\]/m)
    expect(log).toMatch(/^[├└┌] [○●] \/ /m)
    expect(log).toMatch(/^[├└┌] ƒ \/orders\b/m)
    const res = await fetch(`${HOST_APP_NEXT15}/nav/one`)
    expect(['HIT', 'STALE']).toContain(res.headers.get('x-nextjs-cache'))
    expect(markup(await res.text())).toContain('on one') // island HTML is prerendered
    const orders = await fetch(`${HOST_APP_NEXT15}/orders`)
    expect(orders.headers.get('x-nextjs-cache')).toBeNull()
  })

  test('Pages Router: getStaticProps + revalidate stays static (ISR); a private island page is dynamic', async () => {
    const log = buildLog('host-pages-next15', PORTS.hostPagesNext15)
    expect(log).toMatch(/^[├└┌] ● \/static\b/m)
    expect(log).toMatch(/^[├└┌] ƒ \/orders\b/m)
    const res = await fetch(`${HOST_PAGES_NEXT15}/static`)
    expect(['HIT', 'STALE']).toContain(res.headers.get('x-nextjs-cache'))
    expect(res.headers.get('cache-control')).toMatch(/^s-maxage=60\b/)
    const html = markup(await res.text())
    expect(html).toContain('static banner') // island HTML is in the prerendered page
    expect(html).not.toContain('banner unavailable')
    const orders = await fetch(`${HOST_PAGES_NEXT15}/orders`)
    expect(orders.headers.get('x-nextjs-cache')).toBeNull()
  })

  // revalidateIsland calls `revalidateTag(tag, { expire: 0 })`; Next 15's
  // revalidateTag takes the tag only and must still expire it.
  test('App Router: revalidateIsland makes the next request pick up new remote content', async ({
    request,
  }) => {
    const url = `${HOST_APP_NEXT15}/reval`
    const page = async () => markup(await (await request.get(url)).text())
    const revOf = (html: string) =>
      Number(/echo reval rev (\d+)/.exec(html)?.[1])
    // Start from a fresh entry: a background regeneration still in flight
    // when the tag is revalidated would store the old content as new.
    await expect
      .poll(async () => (await request.get(url)).headers()['x-nextjs-cache'], {
        timeout: 10_000,
        intervals: [250],
      })
      .not.toBe('STALE')
    const before = revOf(await page())
    expect(before).toBeGreaterThan(0)
    const { rev } = (await (
      await request.post(`${FAKE_REMOTE}/_rev`)
    ).json()) as { rev: number }
    expect(rev).toBeGreaterThan(before)
    // Still cached: the remote changed, the host has not been told.
    expect(revOf(await page())).toBe(before)
    const res = await request.post(
      `${HOST_APP_NEXT15}/api/revalidate?remote=fake`
    )
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ revalidated: 'fake' })
    await expect
      .poll(async () => revOf(await page()), {
        timeout: 5_000,
        intervals: [100],
      })
      .toBe(rev)
  })
})
