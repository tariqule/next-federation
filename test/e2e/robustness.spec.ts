// Failure modes and the Review Focus cases on the three Next hosts (App
// Router with and without cacheComponents, Pages Router), plus the SPA.
// - Focus 1: two identical islands on one page (`/twins`).
// - Focus 2: envelopes that must be refused (`/tampered`, fake remote cases
//   ForeignBootstrap, VersionTwo, NotJson).
// - Focus 3: props above the GET limit (`/big-props`, fake remote Echo).
// Servers: issuer, fake-remote, remote-a, remote-b, host-app, host-app-cc,
// host-pages, host-spa.
import { expect, test, type Page } from '@playwright/test'
import { lanePort } from './lane.ts'
import {
  FAKE_REMOTE,
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES,
  HOST_SPA,
  MODE,
  REMOTE_A,
} from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

const PAYLOAD = '</script><script>window.pwned=1</script><!--'
// The same string as the `big-props` fixture pages: Latin with a combining
// accent, CJK, right-to-left, an emoji ZWJ sequence and an astral symbol.
const UNICODE = 'héllo é · 日本語 · עברית · 👩🏽‍💻 · 𝄞'
// Where the ForeignBootstrap envelope points its bootstrap (fake-remote.ts).
const FOREIGN = `http://127.0.0.1:${lanePort(4199)}`
const FIRST_LIVE = { timeout: 30_000 }
const HOSTS = [
  { name: 'App Router', url: HOST_APP, router: 'app' },
  { name: 'App Router + cacheComponents', url: HOST_APP_CC, router: 'app' },
  { name: 'Pages Router', url: HOST_PAGES, router: 'pages' },
] as const

const unique = (label: string) =>
  `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

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

type Stats = { requests: Record<string, number> }
const echoRequests = async (
  request: import('@playwright/test').APIRequestContext,
  id: string
) =>
  ((await (await request.get(`${FAKE_REMOTE}/_stats`)).json()) as Stats)
    .requests[`Echo:${id}`] ?? 0

for (const host of HOSTS) {
  test.describe(`${host.name}: failure modes`, () => {
    test('a remote that is down: page returns 200 with the fallback', async ({
      page,
    }) => {
      const res = await page.goto(`${host.url}/down`)
      expect(res!.status()).toBe(200)
      // Streaming briefly keeps a hidden copy until React swaps it in.
      await expect(page.getByText('remote unavailable')).toHaveCount(1)
      await expect(page.getByText('remote unavailable')).toBeVisible()
      await expect(page.getByText('loading…')).toHaveCount(0)
    })

    test("an island stylesheet that never loads does not hold the host's client navigation", async ({
      page,
    }) => {
      // Every stylesheet of remote A stalls: the request is never answered.
      await page.route(
        (url) => url.origin === REMOTE_A && url.pathname.endsWith('.css'),
        () => {}
      )
      try {
        await page.goto(`${host.url}/static`)
        await page.waitForLoadState('load')
        // `/` renders ProductPanel, whose envelope lists a stylesheet.
        const started = Date.now()
        await page.getByRole('link', { name: 'home', exact: true }).click()
        await expect(page).toHaveURL(`${host.url}/`, { timeout: 5_000 })
        await expect(
          page.getByRole('heading', { name: /Router host$/ })
        ).toBeVisible({ timeout: 5_000 })
        expect(Date.now() - started).toBeLessThan(5_000)
        // The host stays interactive: another client navigation commits.
        await page.getByRole('link', { name: 'nav', exact: true }).click()
        await expect(page).toHaveURL(`${host.url}/nav/one`, { timeout: 5_000 })
        await expect(
          page.getByRole('heading', { name: 'Nav one' })
        ).toBeVisible({ timeout: 5_000 })
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
      }
    })

    test('a slow remote: the host times out and shows the fallback', async ({
      page,
    }) => {
      // Measured in the page, from navigation start to the first time the
      // fallback is visible: test-runner polling and load stay out of it.
      await page.addInitScript((text) => {
        const w = window as unknown as { fallbackAt?: number }
        const check = () => {
          if (
            w.fallbackAt === undefined &&
            document.body?.innerText.includes(text)
          )
            w.fallbackAt = performance.now()
        }
        new MutationObserver(check).observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
        })
      }, 'remote too slow')
      const res = await page.goto(`${host.url}/slow`)
      expect(res!.status()).toBe(200)
      // Streaming briefly keeps a hidden copy until React swaps it in.
      await expect(page.getByText('remote too slow')).toHaveCount(1)
      await expect(page.getByText('remote too slow')).toBeVisible()
      await expect(page.getByText('loading…')).toHaveCount(0)
      const { fallbackAt, responseStart } = await page.evaluate(() => ({
        fallbackAt: (window as unknown as { fallbackAt?: number }).fallbackAt,
        responseStart: (
          performance.getEntriesByType(
            'navigation'
          )[0] as PerformanceNavigationTiming
        ).responseStart,
      }))
      expect(fallbackAt).toBeDefined()
      // The 3 s island timeout, not the remote's 10 s. In production the
      // whole page time is the library's (fetch budget, then the fallback).
      // `next dev` first compiles the route on demand (up to 0.9 s on a busy
      // 2-core CI runner), which the library does not control, so in dev the
      // window starts at the page's first byte: a streamed App Router page
      // sends it as it starts rendering, i.e. as the island fetch starts. A
      // Pages Router page sends its first byte only after the fetch, so
      // there the production run is the check.
      if (MODE === 'prod') expect(fallbackAt!).toBeLessThan(3500)
      expect(fallbackAt! - responseStart).toBeLessThan(3500)
    })

    test('island content cannot inject script', async ({ page, request }) => {
      const html = await (await request.get(`${host.url}/inject`)).text()
      expect(html).not.toContain('<script>window.pwned=1</script>')
      await page.goto(`${host.url}/inject`)
      await expect(page.getByTestId('banner-text')).toHaveText(PAYLOAD)
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>).pwned
        )
      ).toBeUndefined()
    })

    test('a signed-out visitor sees the private island fallback and nothing of it', async ({
      page,
      request,
    }) => {
      const html = markup(
        await (await request.get(`${host.url}/orders`)).text()
      )
      expect(html).toContain('orders unavailable')
      expect(html).not.toContain('Orders for')
      await page.goto(`${host.url}/orders`)
      await expect(page.getByText('orders unavailable')).toBeVisible()
      await expect(page.getByText('Orders for')).toHaveCount(0)
      await expect(page.locator('[data-nf-root]')).toHaveCount(0)
    })

    test('two identical islands on one page are both live with independent state and distinct ids', async ({
      page,
    }) => {
      const errors = collectErrors(page)
      await page.goto(`${host.url}/twins`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      await page.getByTestId('counter').first().click()
      await expect(page.getByTestId('counter').first()).toHaveText('count 1')
      await expect(page.getByTestId('counter').last()).toHaveText('count 0')
      const ids = await page
        .locator('[data-nf-root] [id]')
        .evaluateAll((els) => els.map((e) => e.id))
      // The islands render `useId` ids (the fixture's Counter): not vacuous.
      expect(ids.length).toBeGreaterThanOrEqual(2)
      expect(new Set(ids).size).toBe(ids.length)
      expect(errors).toEqual([])
    })

    test('an envelope with a foreign bootstrap URL shows the fallback and the URL is never requested', async ({
      page,
      request,
    }) => {
      const requested: string[] = []
      page.on('request', (r) => {
        if (r.url().startsWith(FOREIGN)) requested.push(r.url())
      })
      const html = await (await request.get(`${host.url}/tampered`)).text()
      expect(html).not.toContain(FOREIGN)
      expect(html).not.toContain('foreign bootstrap html')
      await page.goto(`${host.url}/tampered`)
      await expect(page.getByTestId('tampered-foreign')).toBeVisible()
      await expect(page.getByTestId('foreign-html')).toHaveCount(0)
      await page.waitForLoadState('networkidle')
      expect(requested).toEqual([])
      await expect(page.locator('[data-nf-root]')).toHaveCount(0)
    })

    test('an unknown protocol major and a non-JSON 200 both show the fallback', async ({
      page,
      request,
    }) => {
      const html = markup(
        await (await request.get(`${host.url}/tampered`)).text()
      )
      expect(html).toContain('protocol 2 unavailable')
      expect(html).toContain('not json unavailable')
      expect(html).not.toContain('protocol 2 html')
      expect(html).not.toContain('not an envelope')
      await page.goto(`${host.url}/tampered`)
      await expect(page.getByTestId('tampered-v2')).toBeVisible()
      await expect(page.getByTestId('tampered-not-json')).toBeVisible()
      await expect(page.getByTestId('v2-html')).toHaveCount(0)
    })

    test('props above the GET limit travel by POST and render; equal props in another key order reuse the cache', async ({
      request,
    }) => {
      const id = unique(host.router)
      const pad = 'x'.repeat(3000)
      // The canonical (sorted-key) JSON both islands' props encode to: the
      // fixture writes them in two key orders, the remote sees one.
      const length = JSON.stringify({
        id,
        pad,
        tag: 'big',
        text: UNICODE,
      }).length
      const load = async () =>
        markup(
          await (await request.get(`${host.url}/big-props?id=${id}`)).text()
        )
      const html = await load()
      const echoes = [
        ...html.matchAll(
          /echo (\S+) rev \d+ via (\w+) props (\d+) keys (\S+)/g
        ),
      ].map((m) => m.slice(1))
      expect(echoes).toEqual([
        [id, 'POST', String(length), 'id,pad,tag,text'],
        [id, 'POST', String(length), 'id,pad,tag,text'],
      ])
      if (host.router === 'pages') {
        // The Pages Router has no island cache: getServerSideProps fetches
        // each island (getStaticProps' `revalidate` is the cache there).
        expect(await echoRequests(request, id)).toBe(2)
        return
      }
      // One request for both islands (one cache key for both key orders),
      // and the next page load is served from the cache.
      expect(await echoRequests(request, id)).toBe(1)
      expect(await load()).toContain(`echo ${id} rev`)
      expect(await echoRequests(request, id)).toBe(1)
    })

    test('unicode props render intact', async ({ page, request }) => {
      const html = markup(
        await (
          await request.get(`${host.url}/big-props?id=${unique('u')}`)
        ).text()
      )
      // The Banner (GET) and both Echo islands (POST).
      expect(html.split(UNICODE).length - 1).toBe(3)
      await page.goto(`${host.url}/big-props?id=${unique('u')}`)
      // In GET props (the Banner) and in POST props (both Echo islands).
      await expect(page.getByTestId('echo-text')).toHaveText([UNICODE, UNICODE])
      const banner = page.locator('[data-island="Banner"]')
      await expect(banner.getByTestId('banner-text')).toHaveText(UNICODE)
      await expect(
        page.locator('[data-nf-root]:has([data-island="Banner"])')
      ).toHaveAttribute('data-nf-state', 'live', FIRST_LIVE)
      // Still intact after hydration and an update of the island's state.
      await banner.getByTestId('counter').click()
      await expect(banner.getByTestId('counter')).toHaveText('count 1')
      await expect(banner.getByTestId('banner-text')).toHaveText(UNICODE)
    })

    test('no hydration warning or console error on any island page', async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.url },
      ])
      const errors = collectErrors(page)
      // Every page whose islands all come from working remotes, and the
      // fallback pages. `/big-props` is left out: the fake remote's Echo has
      // no bootstrap (its 404 is the expected inert case). On the fallback
      // pages the host logs each failed island with its NF code by design,
      // and `next dev` replays server logs in the browser console: only
      // those expected codes are allowed there.
      const PAGES: [string, number, RegExp?][] = [
        ['/', 1],
        ['/two', 3],
        ['/twins', 2],
        ['/nav/one', 1],
        ['/inject', 1],
        ['/orders', 1],
        ['/down', 0, /\[ next-federation \] .*NF-007: /],
        ['/tampered', 0, /\[ next-federation \] .*NF-00[345]: /],
      ]
      for (const [path, live, expected] of PAGES) {
        errors.length = 0
        await page.goto(`${host.url}${path}`)
        await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
          live,
          FIRST_LIVE
        )
        // Hydration warnings are logged before an island turns live.
        await expect(page.locator('[data-nf-state="booting"]')).toHaveCount(0)
        await page.waitForLoadState('load')
        expect(
          errors.filter((e) => !expected?.test(e)),
          path
        ).toEqual([])
      }
    })
  })
}

test.describe('SPA host: failure modes', () => {
  test('island content cannot inject script', async ({ page }) => {
    await page.goto(`${HOST_SPA}/inject`)
    await expect(page.getByTestId('banner-text')).toHaveText(PAYLOAD)
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).pwned
      )
    ).toBeUndefined()
  })
})
