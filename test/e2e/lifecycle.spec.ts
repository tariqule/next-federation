import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'
import { expect, test, type Page } from '@playwright/test'
import { HOST_SPA, REMOTE_A } from './servers.ts'

// Servers: NF_APPS=fake-remote,remote-a,remote-b,host-spa (fake-remote is
// 4102, for the inert case).
const SPA = HOST_SPA
// The first wait for live islands includes a cold envelope fetch and, in dev,
// the remote's first dependency optimization; later waits stay short.
const FIRST_LIVE = { timeout: 30_000 }
const A = REMOTE_A

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  return errors
}

const islandA = (page: Page) => page.locator('[data-island="ProductPanel"]')
const islandB = (page: Page) => page.locator('[data-island="Banner"]')
// Rendered by the fixture from getLiveIslandCount() (no page global), which
// sweeps roots whose container left the document before counting, so a
// count is never inflated by a root waiting for its deferred teardown.
const liveRoots = (page: Page) => page.getByTestId('live-roots')

test.describe('island lifecycle in a CSR host (SPA)', () => {
  test('two remotes hydrate independently with no plugin-rsc page globals', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.goto(`${SPA}/islands`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    await islandA(page).getByTestId('counter').click()
    await islandA(page).getByTestId('counter').click()
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 2')
    await expect(islandB(page).getByTestId('counter')).toHaveText('count 0')
    const globals = await page.evaluate(() => [
      typeof (window as unknown as Record<string, unknown>).__viteRscCallServer,
      typeof (window as unknown as Record<string, unknown>)
        .__vite_rsc_require__,
      typeof (window as unknown as Record<string, unknown>)
        .__vite_rsc_client_require__,
    ])
    expect(globals).toEqual(['undefined', 'undefined', 'undefined'])
    expect(errors).toEqual([])
  })

  test('no plugin-rsc page globals and exactly one library global', async ({
    page,
  }) => {
    await page.goto(`${SPA}/islands`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    // getOwnPropertyNames, not keys: a non-enumerable global counts too.
    expect(
      await page.evaluate(() =>
        Object.getOwnPropertyNames(window).filter((k) =>
          /vite_rsc|viteRsc|^__nf/.test(k)
        )
      )
    ).toEqual([FLIGHT_REGISTRY_GLOBAL])
  })

  test('StrictMode: each island is hydrated exactly once', async ({ page }) => {
    const errors = collectErrors(page)
    // Records island events from the first script on; no `__nf` name.
    await page.addInitScript(() => {
      const seen: string[] = []
      ;(window as unknown as { islandEvents: string[] }).islandEvents = seen
      document.addEventListener('nf:island', (e) => {
        const detail = (e as CustomEvent<{ type: string; remote: string }>)
          .detail
        seen.push(`${detail.type}:${detail.remote}`)
      })
    })
    await page.goto(`${SPA}/islands`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    await expect(liveRoots(page)).toHaveText('2')
    const islandEvents = () =>
      page.evaluate(() =>
        [
          ...(window as unknown as { islandEvents: string[] }).islandEvents,
        ].sort()
      )
    // Both hydrations reported; then one macrotask, so that a second
    // (StrictMode) hydration queued behind them would have reported too.
    await expect
      .poll(islandEvents)
      .toEqual(expect.arrayContaining(['island:hydrate:a', 'island:hydrate:b']))
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
    await expect(liveRoots(page)).toHaveText('2')
    expect(await islandEvents()).toEqual([
      'island:hydrate:a',
      'island:hydrate:b',
    ])
    await islandA(page).getByTestId('counter').click()
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 1')
    expect(errors).toEqual([])
  })

  test('a new envelope updates the island in place and keeps client state', async ({
    page,
  }) => {
    await page.goto(`${SPA}/islands`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    await islandB(page).getByTestId('counter').click()
    await page.getByRole('button', { name: 'bump' }).click()
    await expect(islandB(page).getByTestId('banner-text')).toHaveText(
      'Hello B2'
    )
    await expect(islandB(page).getByTestId('counter')).toHaveText('count 1')
  })

  test('a container swap re-bootstraps the island', async ({ page }) => {
    await page.goto(`${SPA}/islands`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    await page.getByRole('button', { name: 'swap' }).click()
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
    await expect(liveRoots(page)).toHaveText('2')
    await islandA(page).getByTestId('counter').click()
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 1')
  })

  test('rapid nav: toggling 10 times leaves exactly one live root per island and no errors', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.goto(`${SPA}/islands`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    const toggle = page.getByRole('button', { name: 'toggle' })
    for (let i = 0; i < 10; i++) await toggle.click({ delay: 0 })
    await expect(page.locator('[data-nf-root]')).toHaveCount(2)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
    await expect(liveRoots(page)).toHaveText('2')
    await islandA(page).getByTestId('counter').click()
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 1')
    expect(errors).toEqual([])
  })

  test('toggle during bootstrap leaves exactly two live roots and no errors', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    // Hold remote A's bootstrap module, whatever URL its envelope names (dev
    // and production builds serve it from different paths).
    let bootstrap: string | undefined
    await page.route(
      (url) => url.origin === A && url.pathname === '/_nf/island/ProductPanel',
      async (route) => {
        const response = await route.fetch()
        bootstrap = ((await response.json()) as { bootstrap: string }).bootstrap
        await route.fulfill({ response })
      }
    )
    await page.route(
      (url) => bootstrap !== undefined && url.href === bootstrap,
      async (route) => {
        await held
        await route.continue()
      }
    )
    await page.goto(`${SPA}/islands`)
    await expect.poll(() => bootstrap).toBeDefined()
    const toggle = page.getByRole('button', { name: 'toggle' })
    for (let i = 0; i < 10; i++) await toggle.click({ delay: 0 })
    release()
    await expect(page.locator('[data-nf-root]')).toHaveCount(2)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    await expect(liveRoots(page)).toHaveText('2')
    await islandA(page).getByTestId('counter').click()
    await expect(islandA(page).getByTestId('counter')).toHaveText('count 1')
    expect(errors).toEqual([])
  })

  for (const [toggles, shown] of [
    [11, false],
    [10, true],
  ] as const) {
    test(`a bootstrap aborted after ${toggles} toggles reports only for an island still on the page`, async ({
      page,
    }) => {
      // The library's own reports: its island:error events, its logger's
      // console lines and uncaught page errors. How the browser words the
      // aborted request in the console is its own (Chromium "Failed to load
      // resource", Firefox "Cross-Origin Request Blocked"), not the library's.
      const pageErrors: string[] = []
      const logged: string[] = []
      page.on('pageerror', (e) => pageErrors.push(e.message))
      page.on('console', (m) => {
        if (m.type() === 'error' && m.text().includes('[ next-federation ]'))
          logged.push(m.text())
      })
      await page.addInitScript(() => {
        const seen: string[] = []
        ;(window as unknown as { islandErrors: string[] }).islandErrors = seen
        document.addEventListener('nf:island', (e) => {
          const d = (
            e as CustomEvent<{
              type: string
              remote: string
              kind?: string
              code?: string
            }>
          ).detail
          if (d.type === 'island:error')
            seen.push(`${d.remote}:${d.kind}:${d.code}`)
        })
      })
      const islandErrors = () =>
        page.evaluate(() => [
          ...(window as unknown as { islandErrors: string[] }).islandErrors,
        ])
      let abort!: () => void
      const held = new Promise<void>((r) => (abort = r))
      // Hold remote A's bootstrap module (as above), then fail it.
      let bootstrap: string | undefined
      await page.route(
        (url) =>
          url.origin === A && url.pathname === '/_nf/island/ProductPanel',
        async (route) => {
          const response = await route.fetch()
          bootstrap = ((await response.json()) as { bootstrap: string })
            .bootstrap
          await route.fulfill({ response })
        }
      )
      let aborted = false
      await page.route(
        (url) => bootstrap !== undefined && url.href === bootstrap,
        async (route) => {
          await held
          await route.abort()
          aborted = true
        }
      )
      await page.goto(`${SPA}/islands`)
      await expect.poll(() => bootstrap).toBeDefined()
      const toggle = page.getByRole('button', { name: 'toggle' })
      for (let i = 0; i < toggles; i++) await toggle.click({ delay: 0 })
      abort()
      await expect.poll(() => aborted).toBe(true)
      if (shown) {
        // The island on the page is inert (server HTML kept) and reports
        // the failure once; the nine unmounted ones report nothing.
        await expect(
          page.locator('[data-nf-root]:has([data-island="ProductPanel"])')
        ).toHaveAttribute('data-nf-state', 'inert')
        await expect.poll(islandErrors).toEqual(['a:bootstrap:NF-011'])
        await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
      } else {
        await expect(page.locator('[data-nf-root]')).toHaveCount(0)
      }
      // Let any late rejection handler and the deferred teardown run.
      await page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 50))
      )
      // An unmounted island's container is detached, so its events would not
      // reach the document: its logger line would still show here.
      expect(await islandErrors()).toEqual(shown ? ['a:bootstrap:NF-011'] : [])
      expect(logged).toHaveLength(shown ? 1 : 0)
      if (shown) expect(logged[0]).toContain('NF-011')
      expect(pageErrors).toEqual([])
      await expect(liveRoots(page)).toHaveText(shown ? '1' : '0')
    })
  }

  test('a bootstrap that fails to load leaves the server html visible and inert', async ({
    page,
  }) => {
    await page.goto(`${SPA}/inert`)
    await expect(page.locator('[data-nf-state="inert"]')).toHaveCount(1)
    await expect(page.getByTestId('broken-html')).toBeVisible()
    await expect(liveRoots(page)).toHaveText('0')
  })
})
