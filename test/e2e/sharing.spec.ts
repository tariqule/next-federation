import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { lanePort } from './lane.ts'
import { LOGS_DIR } from './servers.ts'

// Island React sharing: production remotes share React through the
// island share scope of `@next-federation/vite` (on by default for builds).
// SPA host `/shared`. Servers: NF_MODE=prod NF_APPS=remote-a,remote-b,remote-c,host-spa
// (skew case: NF_SUITE=skew, remote-a serves v1 and v2). NF_SHARE=0 builds
// the remotes with `share: false`. Measurements: NF_MEASURE=1, `-g measure`,
// first with NF_SHARE=0 (the unshared control), then with sharing (asserts).
// NF_LANE moves every port (lane.ts).
const SPA = `http://localhost:${lanePort(4200)}`
const A = `http://127.0.0.1:${lanePort(4100)}`
const B = `http://127.0.0.1:${lanePort(4101)}`
const C = `http://127.0.0.1:${lanePort(4104)}`
const FIRST_LIVE = { timeout: 30_000 }
const PROD = process.env.NF_MODE === 'prod'
const SHARE = PROD && process.env.NF_SHARE !== '0'
const SHARE_OFF = PROD && process.env.NF_SHARE === '0'
const SKEW = process.env.NF_SUITE === 'skew'
const MEASURE = process.env.NF_MEASURE === '1'

/** The chunk that holds a build's bundled React copies (`react-<hash>.js`). */
const reactChunks = (urls: string[]) =>
  urls.filter((u) => /\/assets\/react-[\w-]+\.js$/.test(new URL(u).pathname))

/**
 * The fixture's runtime probe (island-remote/fixture-plugins.ts): the version
 * of every react, react-dom and react-dom/client copy a remote evaluated.
 */
type Probe = {
  react?: string[]
  'react-dom'?: string[]
  'react-dom/client'?: string[]
}

let current: { errors: string[]; warnings: string[] } | undefined
// A failed case prints what the page logged (a bootstrap error leaves no DOM trace).
test.afterEach(({}, info) => {
  if (current && info.status !== info.expectedStatus) {
    console.log(`[page] ${info.title}\n${JSON.stringify(current, null, 2)}`)
  }
  current = undefined
})

function watch(page: Page) {
  const js: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  current = { errors, warnings }
  page.on('response', (r) => r.url().endsWith('.js') && js.push(r.url()))
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
    if (m.type() === 'warning') warnings.push(m.text())
  })
  return { js, errors, warnings }
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(
    () => (window as unknown as { __probeReact?: Probe }).__probeReact ?? {}
  )

/** Every probed package evaluated exactly these versions (sorted). */
const copies = (...versions: string[]): Probe => {
  const sorted = [...versions].sort()
  return { react: sorted, 'react-dom': sorted, 'react-dom/client': sorted }
}
const sortedProbe = async (page: Page): Promise<Probe> =>
  Object.fromEntries(
    Object.entries(await probe(page)).map(([k, v]) => [k, [...v].sort()])
  )

const flightScopes = (page: Page) =>
  page.evaluate(
    (key) =>
      Object.keys(
        (window as unknown as Record<string, object>)[key] ?? {}
      ).sort(),
    FLIGHT_REGISTRY_GLOBAL
  )

const island = (page: Page, remote: string) =>
  page.locator(`[data-remote="${remote}"] [data-island="ProductPanel"]`)

/** Console noise that would mean two Reacts met, or a root was torn down mid-commit. */
const REACT_TROUBLE =
  /Invalid hook call|Minified React error|unmount a root while React was already rendering|more than one copy of React/

test.describe('island React sharing (nf-islands)', () => {
  test.skip(!SHARE || MEASURE, 'needs NF_MODE=prod, sharing on, no NF_MEASURE')

  test.describe('default suite', () => {
    test.skip(SKEW, 'default suite only')

    test('two remotes on the same React download React exactly once', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=a,b`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      const origins = new Set(
        reactChunks(seen.js).map((u) => new URL(u).origin)
      )
      // React and ReactDOM came from one remote only.
      expect(origins.size).toBe(1)
      expect(await probe(page)).toEqual(copies('19.3.1'))
      expect(seen.errors).toEqual([])
      expect(seen.warnings.filter((w) => REACT_TROUBLE.test(w))).toEqual([])
    })

    test('positive control: one remote alone downloads its React', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=a`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        1,
        FIRST_LIVE
      )
      const origins = new Set(
        reactChunks(seen.js).map((u) => new URL(u).origin)
      )
      expect([...origins]).toEqual([A])
      expect(await probe(page)).toEqual(copies('19.3.1'))
    })

    test('both islands keep independent state and their own flight scope', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=a,b`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      await island(page, 'a').getByTestId('counter').click()
      await island(page, 'a').getByTestId('counter').click()
      await island(page, 'b').getByTestId('counter').click()
      await expect(island(page, 'a').getByTestId('counter')).toHaveText(
        'count 2'
      )
      await expect(island(page, 'b').getByTestId('counter')).toHaveText(
        'count 1'
      )
      const scopes = await flightScopes(page)
      expect(scopes).toHaveLength(2)
      expect(scopes[0]!.startsWith(`${A}/`)).toBe(true)
      expect(scopes[1]!.startsWith(`${B}/`)).toBe(true)
      expect(seen.errors).toEqual([])
    })

    test('a remote on a different React version works with its own copy', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=a,c`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      // Ruling 7: remote c really resolved the older React, server and browser.
      await expect(page.locator('[data-remote="c"]')).toHaveAttribute(
        'data-react-version',
        '19.3.0'
      )
      await expect(page.locator('[data-remote="a"]')).toHaveAttribute(
        'data-react-version',
        '19.3.1'
      )
      expect(await sortedProbe(page)).toEqual(copies('19.3.0', '19.3.1'))
      const origins = new Set(
        reactChunks(seen.js).map((u) => new URL(u).origin)
      )
      expect([...origins].sort()).toEqual([A, C])
      await island(page, 'a').getByTestId('counter').click()
      await island(page, 'c').getByTestId('counter').click()
      await island(page, 'c').getByTestId('counter').click()
      await expect(island(page, 'a').getByTestId('counter')).toHaveText(
        'count 1'
      )
      await expect(island(page, 'c').getByTestId('counter')).toHaveText(
        'count 2'
      )
      expect(seen.errors).toEqual([])
      expect(seen.warnings.filter((w) => REACT_TROUBLE.test(w))).toEqual([])
    })

    test('load order does not matter: c first, then a and b', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=c,a,b&seq=1`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        3,
        FIRST_LIVE
      )
      // a and b still share; c is separate.
      expect(await sortedProbe(page)).toEqual(copies('19.3.0', '19.3.1'))
      const origins = new Set(
        reactChunks(seen.js).map((u) => new URL(u).origin)
      )
      expect([...origins].sort()).toEqual([A, C])
      for (const remote of ['c', 'a', 'b']) {
        await island(page, remote).getByTestId('counter').click()
        await expect(island(page, remote).getByTestId('counter')).toHaveText(
          'count 1'
        )
      }
      expect(seen.errors).toEqual([])
    })

    test('a host that provides its React: islands download no React at all', async ({
      page,
    }) => {
      const seen = watch(page)
      // `host=1`: the SPA host calls provideHostReact() (React 19.3.1).
      await page.goto(`${SPA}/shared?remotes=a,b&host=1`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      expect(
        await page.evaluate(
          () =>
            (window as { __hostProvidedReact?: boolean }).__hostProvidedReact
        )
      ).toBe(true)
      expect(reactChunks(seen.js).filter((u) => !u.startsWith(SPA))).toEqual([])
      // No remote evaluated a React copy: both islands run on the host's.
      expect(await probe(page)).toEqual({})
      await island(page, 'a').getByTestId('counter').click()
      await expect(island(page, 'a').getByTestId('counter')).toHaveText(
        'count 1'
      )
      expect(seen.errors).toEqual([])
      expect(seen.warnings.filter((w) => REACT_TROUBLE.test(w))).toEqual([])
    })

    test('swap and toggle on the host-provided React (carried risks a, b)', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=a,b&host=1`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      expect(await probe(page)).toEqual({})
      await island(page, 'a').getByTestId('counter').click()
      await expect(island(page, 'a').getByTestId('counter')).toHaveText(
        'count 1'
      )
      // Container swap: the old roots run on the very React that runs the
      // host's effect, so IslandMount destroys them once the effect is over.
      await page.getByRole('button', { name: 'swap' }).click()
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
      await expect(page.getByTestId('live-roots')).toHaveText('2')
      const toggle = page.getByRole('button', { name: 'toggle' })
      for (let i = 0; i < 10; i++) await toggle.click({ delay: 0 })
      await expect(page.locator('[data-nf-root]')).toHaveCount(2)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
      await expect(page.getByTestId('live-roots')).toHaveText('2')
      await island(page, 'b').getByTestId('counter').click()
      await expect(island(page, 'b').getByTestId('counter')).toHaveText(
        'count 1'
      )
      expect(seen.errors).toEqual([])
      expect(seen.warnings.filter((w) => REACT_TROUBLE.test(w))).toEqual([])
    })

    test('swap and toggle with two remotes sharing one React', async ({
      page,
    }) => {
      const seen = watch(page)
      await page.goto(`${SPA}/shared?remotes=a,b`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        2,
        FIRST_LIVE
      )
      await page.getByRole('button', { name: 'swap' }).click()
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
      const toggle = page.getByRole('button', { name: 'toggle' })
      for (let i = 0; i < 10; i++) await toggle.click({ delay: 0 })
      await expect(page.locator('[data-nf-root]')).toHaveCount(2)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
      await expect(page.getByTestId('live-roots')).toHaveText('2')
      await island(page, 'a').getByTestId('counter').click()
      await expect(island(page, 'a').getByTestId('counter')).toHaveText(
        'count 1'
      )
      expect(seen.errors).toEqual([])
      expect(seen.warnings.filter((w) => REACT_TROUBLE.test(w))).toEqual([])
    })
  })

  test('two builds of one remote (v1 + v2) still isolate their flight clients while sharing React', async ({
    page,
  }) => {
    test.skip(!SKEW, 'needs NF_SUITE=skew')
    const seen = watch(page)
    await page.goto(`${SPA}/skew?both=1`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    const v1 = page.locator('[data-nf-root][data-nf-build="v1"]')
    const v2 = page.locator('[data-nf-root][data-nf-build="v2"]')
    await v1.getByTestId('counter').click()
    await v1.getByTestId('counter').click()
    await v2.getByTestId('counter').click()
    await expect(v1.getByTestId('counter')).toHaveText('count 2')
    await expect(v2.getByTestId('counter')).toHaveText('count 1')
    expect(await flightScopes(page)).toEqual([`${A}/b/v1/`, `${A}/b/v2/`])
    expect(await probe(page)).toEqual(copies('19.3.1'))
    // React came from one of the two builds only.
    const builds = new Set(
      reactChunks(seen.js).map((u) => new URL(u).pathname.split('/')[2])
    )
    expect(builds.size).toBe(1)
    expect(seen.errors).toEqual([])
  })
})

test.describe('share: false', () => {
  test.skip(!SHARE_OFF || SKEW || MEASURE, 'needs NF_MODE=prod NF_SHARE=0')

  test('share: false remotes behave exactly like the spike (one React per remote)', async ({
    page,
  }) => {
    const seen = watch(page)
    await page.goto(`${SPA}/shared?remotes=a,b`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    // Each remote evaluated its own React, bundled in its own chunks.
    expect(await probe(page)).toEqual(copies('19.3.1', '19.3.1'))
    expect(reactChunks(seen.js)).toEqual([])
    expect(await page.evaluate(() => '__FEDERATION__' in globalThis)).toBe(
      false
    )
    await island(page, 'a').getByTestId('counter').click()
    await island(page, 'b').getByTestId('counter').click()
    await island(page, 'b').getByTestId('counter').click()
    await expect(island(page, 'a').getByTestId('counter')).toHaveText('count 1')
    await expect(island(page, 'b').getByTestId('counter')).toHaveText('count 2')
    expect(seen.errors).toEqual([])
  })

  test('provideHostReact has no effect on share: false remotes', async ({
    page,
  }) => {
    const seen = watch(page)
    await page.goto(`${SPA}/shared?remotes=a,b&host=1`)
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
      2,
      FIRST_LIVE
    )
    expect(await probe(page)).toEqual(copies('19.3.1', '19.3.1'))
    await page.getByRole('button', { name: 'swap' }).click()
    await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
    await expect(page.getByTestId('live-roots')).toHaveText('2')
    expect(seen.errors).toEqual([])
  })
})

test.describe('sharing measurements', () => {
  test.skip(
    !MEASURE || !PROD || SKEW,
    'needs NF_MEASURE=1, NF_MODE=prod, default suite'
  )
  const kb = (n: number) => Math.round((n / 1024) * 10) / 10
  // The unshared control: written by the NF_SHARE=0 measurement run, read by
  // the shared one (run the control first).
  const CONTROL = join(LOGS_DIR, 'sharing-measure-control.json')
  type Control = Record<string, Record<string, number>>
  const readControl = (): Control =>
    existsSync(CONTROL)
      ? (JSON.parse(readFileSync(CONTROL, 'utf8')) as Control)
      : {}
  /** Budgets (Task 18B): first or mismatched remote, and a second same-React remote. */
  const MAX_OVERHEAD = 8 * 1024
  const MAX_SECOND = 30 * 1024

  for (const query of [
    'remotes=a',
    'remotes=a,b',
    'remotes=a,c',
    'remotes=a,b&host=1',
  ]) {
    test(`measure JS per origin: ${query}`, async ({ page }) => {
      const perOrigin: Record<
        string,
        { files: number; raw: number; gzip: number; react: number }
      > = {}
      const pending: Promise<void>[] = []
      page.on('response', (r) => {
        const url = new URL(r.url())
        if (![A, B, C].includes(url.origin) || !url.pathname.endsWith('.js'))
          return
        pending.push(
          r
            .body()
            .catch(() => Buffer.alloc(0))
            .then((body) => {
              const entry = (perOrigin[url.origin] ??= {
                files: 0,
                raw: 0,
                gzip: 0,
                react: 0,
              })
              entry.files += 1
              entry.raw += body.length
              entry.gzip += gzipSync(body).length
              if (reactChunks([r.url()]).length) entry.react += 1
            })
        )
      })
      await page.goto(`${SPA}/shared?${query}`)
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
        new URLSearchParams(query).get('remotes')!.split(',').length,
        FIRST_LIVE
      )
      await page.waitForTimeout(500)
      await Promise.all(pending)
      const report = Object.fromEntries(
        Object.entries(perOrigin).map(([o, v]) => [
          o,
          {
            files: v.files,
            reactFiles: v.react,
            rawKB: kb(v.raw),
            gzipKB: kb(v.gzip),
            rawBytes: v.raw,
            gzipBytes: v.gzip,
          },
        ])
      )
      // Size numbers for each sharing scenario, printed for the run log.
      console.log(
        `[measure] share=${SHARE ? 'on' : 'off'} ${query} ${JSON.stringify(report)}`
      )
      const gzip = (origin: string) => perOrigin[origin]?.gzip ?? 0
      if (!SHARE) {
        const control = readControl()
        control[query] = Object.fromEntries(
          Object.entries(perOrigin).map(([o, v]) => [o, v.gzip])
        )
        mkdirSync(LOGS_DIR, { recursive: true })
        writeFileSync(CONTROL, `${JSON.stringify(control, null, 2)}\n`)
        return
      }
      if (query === 'remotes=a,b') {
        // Both remotes load at once, so either may provide React: the
        // provider downloads it once, the other one costs little.
        const provider = [A, B].filter((o) => perOrigin[o]?.react)
        expect(provider).toHaveLength(1)
        const second = provider[0] === A ? B : A
        expect(gzip(second)).toBeGreaterThan(0)
        expect(gzip(second)).toBeLessThanOrEqual(MAX_SECOND)
      }
      if (query === 'remotes=a,b&host=1') {
        // On the host's React neither remote downloads one.
        for (const origin of [A, B]) {
          expect(gzip(origin)).toBeGreaterThan(0)
          expect(gzip(origin)).toBeLessThanOrEqual(MAX_SECOND)
          expect(perOrigin[origin]!.react).toBe(0)
        }
      }
      if (query === 'remotes=a' || query === 'remotes=a,c') {
        const control = readControl()[query]
        expect(
          control,
          `no unshared control in ${CONTROL}: run the NF_SHARE=0 measurement first`
        ).toBeDefined()
        // A remote that downloads its own React pays at most 8 KB for sharing.
        for (const origin of query === 'remotes=a' ? [A] : [A, C]) {
          expect(gzip(origin) - control![origin]!).toBeLessThanOrEqual(
            MAX_OVERHEAD
          )
        }
      }
    })
  }
})
