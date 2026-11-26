// Readiness, refusal and fallback events of remote components, end to end
// (docs: the preload result, honouring refused builds, component events).
// Hosts: host-pages (Pages Router) and host-app (App Router). Remotes:
// test/fixtures/components-remote (signed c1, tampered t1, unsigned u1, and
// slow s1, whose server-side asset requests are held so a preload with a
// timeout always times out).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { COMPONENTS_PORTS } from './fixtures/components-keys.ts'
import { lanePort } from './lane.ts'
import { BUNDLER, HOST_APP, HOST_PAGES, MODE } from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

const TAMPERED = `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.tampered)}`
const BAD =
  /hydrat|Invalid hook call|did not match|Minified React error #4(18|19|23|25)/i
// next dev --webpack: Mode A may render browser-only on the server (stale
// share cache, documented); see mode-a.spec.ts.
const DEV_WEBPACK = MODE === 'dev' && BUNDLER === 'webpack'

type BrowserEvent = { type: string; remote?: string; reason?: string }
type ServerEvent = BrowserEvent & { env?: string }

/** Records every `nf:component` event of the page in window.__nfEvents. */
async function recordBrowserEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events: unknown[] = []
    ;(window as unknown as { __nfEvents: unknown[] }).__nfEvents = events
    document.addEventListener('nf:component', (e) => {
      const d = (e as CustomEvent).detail
      events.push({ type: d.type, remote: d.remote, reason: d.reason })
    })
  })
}
const browserEvents = (page: Page): Promise<BrowserEvent[]> =>
  page.evaluate(
    () => (window as unknown as { __nfEvents: BrowserEvent[] }).__nfEvents
  )

async function serverEvents(clear = false): Promise<ServerEvent[]> {
  const res = await fetch(`${HOST_PAGES}/api/nf-events`, {
    method: clear ? 'DELETE' : 'GET',
  })
  return (await res.json()) as ServerEvent[]
}

async function get(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  return {
    status: res.status,
    cacheControl: res.headers.get('cache-control') ?? '',
    body: markup(await res.text()),
  }
}

test.describe('preload, refusal and fallback events', () => {
  test('healthy Pages /mode-a: server-rendered, hydrates, interactive, no fallback event', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (BAD.test(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    await recordBrowserEvents(page)
    const first = await get(`${HOST_PAGES}/mode-a`)
    if (DEV_WEBPACK && first.body.includes('data-nf-browser-only')) {
      test.skip(true, 'next dev --webpack renders Mode A browser-only')
    }
    expect(first.body).toContain('host=from-pages-host build=c1')
    await serverEvents(true)
    await page.goto(`${HOST_PAGES}/mode-a`)
    const button = page.getByTestId('counter-btn')
    await expect(async () => {
      await button.click()
      await expect(button).not.toHaveText('count 1', { timeout: 500 })
    }).toPass({ timeout: 15_000 })
    await expect(button).toHaveText('count 2')
    expect(errors).toEqual([])
    const browser = await browserEvents(page)
    expect(browser.filter((e) => e.type === 'component:fallback')).toEqual([])
    const server = await serverEvents()
    expect(server.filter((e) => e.type === 'component:fallback')).toEqual([])
  })

  test('tampered (Pages): component:fallback refused in the browser and on the server', async ({
    page,
  }) => {
    await recordBrowserEvents(page)
    await serverEvents(true)
    await page.goto(`${HOST_PAGES}/mode-a/tampered`)
    await expect(page.getByTestId('fallback')).toBeVisible()
    await expect
      .poll(async () =>
        (await browserEvents(page)).filter(
          (e) => e.type === 'component:fallback'
        )
      )
      .toContainEqual({
        type: 'component:fallback',
        remote: 'tampered',
        reason: 'refused',
      })
    const server = await serverEvents()
    expect(server).toContainEqual(
      expect.objectContaining({
        type: 'component:fallback',
        remote: 'tampered',
        reason: 'refused',
        env: 'server',
      })
    )
  })

  for (const host of [
    { name: 'App Router', url: HOST_APP },
    { name: 'Pages Router', url: HOST_PAGES },
  ]) {
    test(`tampered (${host.name}): refused on the server, fallback after hydration, no browser request`, async ({
      page,
    }) => {
      const { status, body } = await get(`${host.url}/mode-a/tampered`)
      expect(status).toBe(200)
      expect(body).toContain('data-nf-refused')
      expect(body).toContain('counter unavailable')
      const requested: string[] = []
      page.on('request', (r) => {
        if (r.url().startsWith(TAMPERED)) requested.push(r.url())
      })
      await page.goto(`${host.url}/mode-a/tampered`)
      await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('fallback')).toBeVisible()
      await expect(page.getByTestId('counter')).toHaveCount(0)
      expect(requested).toEqual([])
    })
  }

  test('an unsigned build still loads in the browser', async ({ page }) => {
    await page.goto(`${HOST_PAGES}/mode-a/unsigned`)
    await expect(page.getByTestId('counter-text')).toHaveText(
      'host=from-pages-host build=u1'
    )
  })

  test('preload-status: ready is cacheable and server-rendered', async () => {
    // The first load may outlast the 200 ms timeout; it keeps loading.
    let res = await get(`${HOST_PAGES}/mode-a/preload-status?remote=components`)
    await expect
      .poll(
        async () => {
          res = await get(
            `${HOST_PAGES}/mode-a/preload-status?remote=components`
          )
          return res.body.match(/data-testid="preload-state">(\w+)/)?.[1]
        },
        { timeout: 20_000 }
      )
      .toBe('ready')
    // next dev always sends no-store for getServerSideProps pages.
    if (MODE === 'prod') expect(res.cacheControl).not.toContain('no-store')
    if (!(DEV_WEBPACK && res.body.includes('data-nf-browser-only'))) {
      expect(res.body).toContain('host=from-pages-host build=c1')
    }
  })

  test('preload-status: refused is no-store and omits the remote', async () => {
    const res = await get(`${HOST_PAGES}/mode-a/preload-status?remote=tampered`)
    expect(res.status).toBe(200)
    expect(res.body).toContain('data-testid="preload-state">refused')
    expect(res.cacheControl).toContain('no-store')
    expect(res.body).not.toContain('data-testid="counter"')
    expect(res.body).not.toContain('data-testid="fallback"')
  })

  test('preload-status: a slow remote times out (no-store), browser-only loads it', async ({
    page,
  }) => {
    // One request only: the held load later fails on the server (its own
    // load timeout), and a failed load is not a timeout any more.
    const response = await page.goto(
      `${HOST_PAGES}/mode-a/preload-status?remote=slow&browserOnly=1`
    )
    expect(response!.headers()['cache-control']).toContain('no-store')
    const body = markup(await response!.text())
    expect(body).toContain('data-testid="preload-state">timeout')
    expect(body).not.toContain('data-testid="counter"')
    await expect(page.getByTestId('preload-state')).toHaveText('timeout')
    await expect(page.getByTestId('counter-text')).toHaveText(
      'host=from-pages-host build=s1'
    )
  })
})
