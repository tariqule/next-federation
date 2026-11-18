import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { HOST_APP, HOST_PAGES, REMOTE_A, REMOTE_B } from './servers.ts'

// Island React sharing on Next hosts. `/two` mounts two islands of
// remote `a` and one of remote `b`, all on React 19.3.1.
// - App Router: Next runs its own canary React, so the host never provides
//   React; the islands share one React among themselves.
// - Pages Router: the host's React is the app's stable install. Without
//   `provideHostReact()` it behaves like the App Router; with it, the islands
//   run on the host's React (`/shared`, whose `_app` calls it).
// Servers: NF_MODE=prod NF_APPS=issuer,remote-a,remote-b,host-app,host-pages.
const PROD = process.env.NF_MODE === 'prod'
const SHARE = PROD && process.env.NF_SHARE !== '0'
// NF_MEASURE=1 remotes build without the React copy probe these tests read.
const MEASURE = process.env.NF_MEASURE === '1'
const FIRST_LIVE = { timeout: 30_000 }

const NAMESPACE = '@next-federation/island-share@1'

/** NF_APPS (servers.ts) may start a subset: `sharing` also matches this file. */
const only = process.env.NF_APPS?.split(',').map((s) => s.trim())
const running = (app: string) => !only || only.includes(app)

/** The chunk holding a remote build's bundled React copies. */
const reactChunks = (urls: string[]) =>
  urls.filter((u) => /\/assets\/react-[\w-]+\.js$/.test(new URL(u).pathname))

type Probe = Record<string, string[] | undefined>

function watch(page: Page) {
  const js: string[] = []
  const errors: string[] = []
  page.on('response', (r) => r.url().endsWith('.js') && js.push(r.url()))
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' && !text.includes('Download the React DevTools'))
      errors.push(text)
  })
  return { js, errors }
}

/** Who provides React 19.3.1 in the island share scope. */
const reactProvider = (page: Page) =>
  page.evaluate((ns) => {
    const g = globalThis as unknown as {
      __FEDERATION__?: {
        __SHARE__?: Record<
          string,
          Record<string, Record<string, Record<string, { from: string }>>>
        >
      }
    }
    return g.__FEDERATION__?.__SHARE__?.[ns]?.['nf-islands']?.react?.['19.3.1']
      ?.from
  }, NAMESPACE)

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(
    () => (window as unknown as { __probeReact?: Probe }).__probeReact ?? {}
  )

test.describe('island React sharing on Next hosts', () => {
  test.skip(
    !SHARE || MEASURE,
    'needs NF_MODE=prod with sharing on, no NF_MEASURE'
  )

  for (const host of [
    { name: 'App Router', url: HOST_APP, app: 'host-app' },
    {
      name: 'Pages Router without provideHostReact',
      url: HOST_PAGES,
      app: 'host-pages',
    },
  ]) {
    test(`${host.name}: the islands share one React; the host provides none`, async ({
      page,
    }) => {
      test.skip(!running(host.app), `${host.app} is not in NF_APPS`)
      const seen = watch(page)
      await page.goto(`${host.url}/two`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        3,
        FIRST_LIVE
      )
      // One remote's React copy, downloaded and evaluated once.
      const origins = new Set(
        reactChunks(seen.js).map((u) => new URL(u).origin)
      )
      expect(origins.size).toBe(1)
      expect([REMOTE_A, REMOTE_B]).toContain([...origins][0])
      expect(await probe(page)).toEqual({
        react: ['19.3.1'],
        'react-dom': ['19.3.1'],
        'react-dom/client': ['19.3.1'],
      })
      const provider = await reactProvider(page)
      expect(provider).not.toBe('host')
      expect(
        provider?.startsWith(`${REMOTE_A}/`) ||
          provider?.startsWith(`${REMOTE_B}/`)
      ).toBe(true)
      // Independent state per island on the one shared React.
      const counters = page.getByTestId('counter')
      await counters.nth(0).click()
      await counters.nth(0).click()
      await counters.nth(1).click()
      await expect(counters.nth(0)).toHaveText('count 2')
      await expect(counters.nth(1)).toHaveText('count 1')
      expect(seen.errors).toEqual([])
    })
  }

  // host-pages' `_app` calls provideHostReact() on `/shared` only (islands of
  // remotes `a` and `b`).
  test('Pages Router with provideHostReact: islands download no React at all', async ({
    page,
  }) => {
    test.skip(!running('host-pages'), 'host-pages is not in NF_APPS')
    const seen = watch(page)
    const gzip: Record<string, number> = {}
    const pending: Promise<void>[] = []
    page.on('response', (r) => {
      const { origin, pathname } = new URL(r.url())
      if (![REMOTE_A, REMOTE_B].includes(origin) || !pathname.endsWith('.js'))
        return
      pending.push(
        r
          .body()
          .catch(() => Buffer.alloc(0))
          .then((body) => {
            gzip[origin] = (gzip[origin] ?? 0) + gzipSync(body).length
          })
      )
    })
    await page.goto(`${HOST_PAGES}/shared`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __hostProvidedReact?: boolean })
            .__hostProvidedReact
      )
    ).toBe(true)
    expect(
      reactChunks(seen.js).filter((u) => !u.startsWith(HOST_PAGES))
    ).toEqual([])
    // No island evaluated a React copy of its own: one React on the page.
    expect(await probe(page)).toEqual({})
    expect(await reactProvider(page)).toBe('host')
    // About 12 KB gzip per remote: island code and the flight client only.
    await page.waitForLoadState('networkidle')
    await Promise.all(pending)
    expect(Object.keys(gzip).sort()).toEqual([REMOTE_A, REMOTE_B].sort())
    for (const [origin, bytes] of Object.entries(gzip)) {
      expect(bytes, `${origin}: ${bytes} B`).toBeLessThanOrEqual(30 * 1024)
    }
    const counters = page.getByTestId('counter')
    await counters.nth(0).click()
    await expect(counters.nth(0)).toHaveText('count 1')
    await expect(counters.nth(1)).toHaveText('count 0')
    expect(seen.errors).toEqual([])
  })
})
