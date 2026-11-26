// Remote components (Module Federation client components): a host renders a
// remote's client component in its own React tree on its own React.
// Next hosts server-render it (verified builds only) and hydrate it; the SPA
// renders it in the browser. Remotes: test/fixtures/components-remote
// (signed c1, tampered t1, unsigned u1; this spec starts the redeploy remote).
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { COMPONENTS_PORTS } from './fixtures/components-keys.ts'
import { lanePort } from './lane.ts'
import {
  BUNDLER,
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES,
  HOST_PAGES_BASE,
  HOST_SPA,
  LANE,
  LOGS_DIR,
  MODE,
  PORTS,
} from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

const here = dirname(fileURLToPath(import.meta.url))
const remoteFixture = join(here, '..', 'fixtures', 'components-remote')
const NF_SERVE = join(
  here,
  '..',
  '..',
  'packages',
  'server',
  'dist',
  'node',
  'cli.js'
)
const origin = (port: number) => `http://127.0.0.1:${lanePort(port)}`
const SIGNED = origin(COMPONENTS_PORTS.signed)
const REDEPLOY = origin(COMPONENTS_PORTS.redeploy)
const TAMPERED = origin(COMPONENTS_PORTS.tampered)

type Host = {
  name: string
  url: string
  value: string
  /** Server-rendered (Next) or browser-only (SPA). */
  ssr: boolean
  /** Build log for the cacheComponents route-type check. */
  cc?: boolean
  pages?: boolean
  /** The Next build folder (prod client-bundle check). */
  dist?: string
}
const HOSTS: Host[] = [
  {
    name: 'App Router',
    url: HOST_APP,
    value: 'from-app-host',
    ssr: true,
    dist: 'host-app/.next',
  },
  {
    name: 'App Router (cacheComponents)',
    url: HOST_APP_CC,
    value: 'from-app-host',
    ssr: true,
    cc: true,
    dist: 'host-app/.next-cc',
  },
  {
    name: 'Pages Router',
    url: HOST_PAGES,
    value: 'from-pages-host',
    ssr: true,
    pages: true,
    dist: 'host-pages/.next',
  },
  {
    name: 'Pages Router (basePath)',
    url: `${HOST_PAGES_BASE}/base`,
    value: 'from-pages-host',
    ssr: true,
    pages: true,
    dist: 'host-pages/.next-base',
  },
  { name: 'SPA', url: HOST_SPA, value: 'from-spa-host', ssr: false },
]

/** Console errors that mean React broke: hydration, a second React. */
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

async function html(url: string): Promise<{ status: number; body: string }> {
  // A server render must never hang: fail fast instead of waiting minutes.
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  return { status: res.status, body: markup(await res.text()) }
}

// `next dev --webpack` re-instantiates the host's server modules when it
// compiles another route; @module-federation/vite's process-wide share cache
// keeps the old instances, so the runtime renders remote components
// browser-only from then on (NF-028 "stale", documented). Those cells skip the
// server-HTML checks instead of failing them; every other cell asserts them.
const DEV_WEBPACK = MODE === 'dev' && BUNDLER === 'webpack'
function expectServerMarkup(body: string, expected: string): void {
  if (
    DEV_WEBPACK &&
    !body.includes(expected) &&
    body.includes('data-nf-browser-only')
  ) {
    test.skip(
      true,
      'next dev --webpack reloaded the host modules: Mode A renders browser-only (stale share cache)'
    )
  }
  expect(body).toContain(expected)
}

const counterText = (page: Page) => page.getByTestId('counter-text')

/**
 * Server HTML is visible before it hydrates, and a click before hydration is
 * lost: click until the first click that lands, then expect exactly one.
 */
async function clickOnceHydrated(page: Page): Promise<void> {
  const button = page.getByTestId('counter-btn')
  await expect(async () => {
    await button.click()
    await expect(button).not.toHaveText('count 1', { timeout: 500 })
  }).toPass({ timeout: 15_000 })
  await expect(button).toHaveText('count 2')
}

for (const host of HOSTS) {
  test.describe(`Mode A: ${host.name}`, () => {
    test('renders the remote component on the host React; click updates it', async ({
      page,
    }) => {
      const expected = `host=${host.value} build=c1`
      if (host.ssr) {
        const { status, body } = await html(`${host.url}/mode-a`)
        expect(status).toBe(200)
        // Server-rendered: the markup and the host's context value.
        expectServerMarkup(body, expected)
        // One React on the server: the remote got this layer's React.
        expect(body).toMatch(/data-testid="react-probe"[^>]*>true</)
      }
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/mode-a`)
      await expect(counterText(page)).toHaveText(expected)
      await expect(page.getByTestId('counter-btn')).toHaveText('count 1')
      if (host.ssr) {
        // Set by an effect: the page has hydrated (a click before would be lost).
        await expect(page.getByTestId('react-probe')).toHaveAttribute(
          'data-client',
          'true'
        )
      }
      await page.getByTestId('counter-btn').click()
      await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
      expect(bad, all.join('\n')).toEqual([])
    })

    test("the remote's stylesheet applies, one link per href; the server HTML links it and modulepreloads the entry + chunks", async ({
      page,
    }) => {
      const build = `${SIGNED}/b/c1/`
      if (host.ssr) {
        const res = await fetch(`${host.url}/mode-a`, {
          signal: AbortSignal.timeout(30_000),
        })
        const body = await res.text()
        expectServerMarkup(markup(body), `host=${host.value} build=c1`)
        const links = [...body.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
        // A stylesheet resource of the boundary: a <link precedence>
        // (inline boundary, Pages Router), or a preload from the shell plus
        // React's reveal instruction for a streamed one (App Router).
        const css = links
          .filter(
            (l) =>
              (l.includes('rel="preload"') && l.includes('as="style"')) ||
              l.includes('rel="stylesheet"')
          )
          .map((l) => /href="([^"]+)"/.exec(l)?.[1])
          .filter((h) => h?.startsWith(`${build}assets/Counter-`))
        expect(css, links.join('\n')).toHaveLength(1)
        const href = css[0]!
        const asLink = links.filter(
          (l) => l.includes('rel="stylesheet"') && l.includes(`href="${href}"`)
        )
        if (host.pages || asLink.length > 0) {
          expect(asLink, links.join('\n')).toHaveLength(1)
          expect(asLink[0]).toContain('data-precedence="next-federation"')
        } else {
          expect(body).toContain(`"${href}","next-federation"`)
        }
        const preloads = links
          .filter((l) => l.includes('rel="modulepreload"'))
          .map((l) => /href="([^"]+)"/.exec(l)?.[1])
        expect(preloads).toContain(`${build}remoteEntry.js`)
        expect(
          preloads.some((h) => h?.startsWith(`${build}assets/Counter-`)),
          preloads.join('\n')
        ).toBe(true)
        // Each modulepreload once.
        expect(new Set(preloads).size).toBe(preloads.length)
      }
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/mode-a`)
      await expect(counterText(page)).toHaveText(`host=${host.value} build=c1`)
      if (host.ssr) {
        await expect(page.getByTestId('react-probe')).toHaveAttribute(
          'data-client',
          'true'
        )
      }
      await expect(page.getByTestId('counter')).toHaveCSS(
        'color',
        'rgb(12, 34, 56)'
      )
      const hrefs = await page
        .locator(`link[rel="stylesheet"][href^="${build}"]`)
        .evaluateAll((ls) => ls.map((l) => l.getAttribute('href')))
      expect(hrefs).toHaveLength(1)
      expect(hrefs[0]).toMatch(/\/assets\/Counter-[\w-]+\.css$/)
      expect(bad, all.join('\n')).toEqual([])
    })

    test('a remote that is down renders the fallback with status 200 (cold)', async ({
      page,
    }) => {
      const path = host.ssr ? '/mode-a/down' : '/mode-a?down=1'
      if (host.ssr) {
        const { status, body } = await html(`${host.url}${path}`)
        expect(status).toBe(200)
        expect(body).toContain('counter unavailable')
        expect(body).not.toContain('data-testid="counter"')
      }
      await page.goto(`${host.url}${path}`)
      await expect(page.getByTestId('fallback')).toBeVisible()
      await expect(page.getByTestId('rendered-build')).toHaveText('none')
    })

    if (!host.ssr) return

    test('a tampered build is refused: the fallback stays and the browser never loads it', async ({
      page,
    }) => {
      const { status, body } = await html(`${host.url}/mode-a/tampered`)
      expect(status).toBe(200)
      expect(body).not.toContain('data-testid="counter"')
      expect(body).toContain('data-nf-refused')
      expect(body).toContain('data-nf-code="NF-027"')
      expect(body).toContain('counter unavailable')
      // No modulepreload or stylesheet hint for the refused build.
      expect(body).not.toMatch(
        new RegExp(`<link[^>]*${TAMPERED.replace(/\./g, '\\.')}`)
      )
      const requested: string[] = []
      page.on('request', (r) => {
        if (r.url().startsWith(TAMPERED)) requested.push(r.url())
      })
      await page.goto(`${host.url}/mode-a/tampered`)
      await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('fallback')).toBeVisible()
      await expect(page.getByTestId('counter')).toHaveCount(0)
      expect(requested).toEqual([])
      const probe = await (
        await fetch(`${host.url}/api/components-probe`)
      ).json()
      expect(probe.tamperedRan).toBe(false)
    })

    test('an unsigned build without a pinned digest renders browser-only', async ({
      page,
    }) => {
      const { status, body } = await html(`${host.url}/mode-a/unsigned`)
      expect(status).toBe(200)
      expect(body).not.toContain('data-testid="counter"')
      expect(body).toContain('counter unavailable')
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/mode-a/unsigned`)
      await expect(counterText(page)).toHaveText(`host=${host.value} build=u1`)
      await page.getByTestId('counter-btn').click()
      await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
      expect(bad, all.join('\n')).toEqual([])
    })

    test('remote assets down after SSR: the server HTML stays (inert), then the fallback', async ({
      page,
    }) => {
      // Warm the server's module cache first.
      expectServerMarkup(
        (await html(`${host.url}/mode-a`)).body,
        `host=${host.value} build=c1`
      )
      const blocked: string[] = []
      await page.route(`${SIGNED}/**`, (route: Route) => {
        const url = route.request().url()
        // The scripts are down; the stylesheet still loads: a streamed App
        // Router boundary whose stylesheet fails is client-rendered by React
        // (documented in docs/guides/remote-components/reference.mdx).
        if (url.endsWith('.css')) return route.continue()
        // One manifest request per attempt (the modulepreloads of the server
        // HTML are blocked too, but not counted).
        if (url.includes('mf-manifest.json')) blocked.push(url)
        return route.abort()
      })
      try {
        await page.goto(`${host.url}/mode-a`, { waitUntil: 'domcontentloaded' })
        await expect(counterText(page)).toHaveText(
          `host=${host.value} build=c1`
        )
        // After the browser's first retry the server HTML is still there.
        await expect
          .poll(() => blocked.length, { timeout: 15_000 })
          .toBeGreaterThan(1)
        await expect(counterText(page)).toBeVisible()
        await expect(page.getByTestId('fallback')).toBeVisible({
          timeout: 15_000,
        })
        // Replaced only after every attempt (1 + 3 retries) failed.
        expect(blocked.length).toBeGreaterThanOrEqual(4)
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
      }
    })

    test('a stalled stylesheet never holds a client navigation', async ({
      page,
    }) => {
      const stalled: string[] = []
      // Never answered: the browser waits on these for as long as it likes.
      await page.route(`${SIGNED}/b/c1/assets/*.css`, (route: Route) => {
        stalled.push(route.request().url())
      })
      try {
        await page.goto(`${host.url}/mode-a/down`)
        const link = page.getByTestId('to-mode-a')
        await expect(link).toHaveAttribute('data-hydrated', 'true')
        await page.evaluate(() => {
          ;(window as unknown as { __nfSamePage: boolean }).__nfSamePage = true
        })
        await link.click()
        // Rendered within the runtime's first attempt, CSS still pending.
        await expect(counterText(page)).toHaveText(
          `host=${host.value} build=c1`,
          { timeout: 8_000 }
        )
        expect(
          await page.evaluate(
            () => (window as unknown as { __nfSamePage?: boolean }).__nfSamePage
          )
        ).toBe(true)
        expect(stalled.length).toBeGreaterThan(0)
        await page.getByTestId('counter-btn').click()
        await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
      }
    })

    test('preload / Suspense: a cold server cache still renders inline HTML', async () => {
      // Pages Router waits for Suspense during SSR; App Router streams it.
      const query = host.pages ? '?preload=1' : ''
      const { body } = await html(`${host.url}/mode-a${query}`)
      expectServerMarkup(body, `host=${host.value} build=c1`)
    })

    if (!host.pages) {
      test('a remote component that throws while the server renders it: the static page keeps its fallback, the browser renders it (NF-040)', async ({
        page,
      }) => {
        const path = '/mode-a/crash-static'
        if (MODE === 'prod') {
          // `next build` prerendered it (it fails on any render error).
          const log = readFileSync(
            join(
              LOGS_DIR,
              `host-app-${host.cc ? PORTS.hostAppCc : PORTS.hostApp}.build.log`
            ),
            'utf8'
          )
          expect(log).toMatch(/^[├└┌] [○◐] \/mode-a\/crash-static\b/m)
          expect(log).toContain('NF-040')
          expect(log).not.toContain('Error occurred prerendering')
        }
        const { status, body } = await html(`${host.url}${path}`)
        expect(status).toBe(200)
        // Both booms: the loading fallback, marked for the browser (a
        // streamed render also has Suspense's own fallback before it).
        expect(body.match(/<template data-nf-browser-only=/g)).toHaveLength(2)
        expect(
          body.match(/data-testid="boom-loading"/g)?.length
        ).toBeGreaterThanOrEqual(2)
        expect(body).not.toContain('boom unavailable')
        // The component next to them still server-renders.
        expectServerMarkup(body, `host=${host.value} build=c1`)
        await page.addInitScript(() => {
          const seen: unknown[] = []
          ;(window as unknown as { __nfEvents: unknown[] }).__nfEvents = seen
          document.addEventListener('nf:component', (e) => {
            const { type, code, expose, env, remote, buildId } = (
              e as CustomEvent
            ).detail as Record<string, unknown>
            seen.push({ type, code, expose, env, remote, buildId })
          })
        })
        const { bad, all } = watch(page)
        await page.goto(`${host.url}${path}`)
        // Throws on the server only: the browser renders it.
        await expect(page.getByTestId('boom-server')).toHaveText(
          'rendered in the browser'
        )
        // Throws everywhere: the error fallback, reported once.
        await expect(
          page.getByTestId('boom-always-slot').getByTestId('boom-failed')
        ).toBeVisible()
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as { __nfEvents: unknown[] }).__nfEvents
            )
          )
          .toContainEqual({
            type: 'component:error',
            code: 'NF-040',
            expose: './Boom',
            env: 'client',
            remote: 'cached',
            buildId: 'c1',
          })
        expect(all.join('\n')).toContain('NF-040')
        await clickOnceHydrated(page)
        expect(bad, all.join('\n')).toEqual([])
      })
    }

    if (host.dist && MODE === 'prod') {
      test('the client bundle has the runtime but never the server loader', () => {
        const dir = join(
          here,
          '..',
          'fixtures',
          `${host.dist}${LANE ? `-${LANE}` : ''}`,
          'static'
        )
        const files = readdirSync(dir, { recursive: true })
          .map(String)
          .filter((f) => f.endsWith('.js'))
        const js = files
          .map((f) => readFileSync(join(dir, f), 'utf8'))
          .join('\n')
        expect(js).toContain('nf:component')
        expect(js).not.toContain('nf-components-server-loader')
        expect(js).not.toContain('does not match its sha384')
      })
    }

    if (host.cc && MODE === 'prod') {
      test('cacheComponents: cached descriptor is static, per-request one is PPR', async () => {
        const log = readFileSync(
          join(LOGS_DIR, `host-app-${PORTS.hostAppCc}.build.log`),
          'utf8'
        )
        // Prerendered with the descriptor's cache life (this Next prints ◐
        // for every route of this host; see static.spec.ts).
        expect(log).toMatch(/^[├└┌] [○◐] \/mode-a\/cached\s+1m\s+1h/m)
        expect(log).toMatch(/^[├└┌] ◐ \/mode-a[ \t]*$/m)
        const raw = async (path: string) => {
          const res = await fetch(`${host.url}${path}`)
          return {
            prerender: res.headers.get('x-nextjs-prerender'),
            body: (await res.text()).replaceAll('<!-- -->', ''),
          }
        }
        const streamed = /<div hidden id="S:\d+">[\s\S]*counter-text/
        // Cached descriptor: the remote's markup is in the static shell.
        const cached = await raw('/mode-a/cached')
        expect(cached.prerender).toMatch(/^1(, 1)?$/)
        expect(cached.body).toContain(`host=${host.value} build=c1`)
        expect(cached.body).not.toMatch(streamed)
        // Per-request descriptor: a PPR hole streamed after the shell.
        const dynamic = await raw('/mode-a')
        expect(dynamic.body).toContain('data-testid="shell-fallback"')
        expect(dynamic.body).toMatch(streamed)
      })
    }

    if (!host.pages) {
      test('mixed router: App Router and Pages Router routes both server-render, each on its own React', async ({
        page,
      }) => {
        // Two Reacts in one process (Next's vendored copy for app/, the one
        // in node_modules for pages/): each layer loads its own copy of the
        // remote's server code. Both orders: whichever layer loads first.
        const routes = [
          { path: '/mode-a', value: 'from-app-host' },
          { path: '/mode-a-mixed', value: 'from-mixed-host' },
        ]
        for (const route of [...routes, ...[...routes].reverse()]) {
          const { status, body } = await html(`${host.url}${route.path}`)
          expect(status).toBe(200)
          expect(body).toContain(`host=${route.value} build=c1`)
          expect(body).not.toContain('data-nf-browser-only')
          // One React per layer: the remote got this layer's React.
          expect(body).toMatch(/data-testid="react-probe"[^>]*>true</)
        }
        for (const route of routes) {
          const { bad, all } = watch(page)
          await page.goto(`${host.url}${route.path}`)
          await expect(counterText(page)).toHaveText(
            `host=${route.value} build=c1`
          )
          await expect(page.getByTestId('react-probe')).toHaveAttribute(
            'data-client',
            'true'
          )
          await page.getByTestId('counter-btn').click()
          await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
          expect(bad, all.join('\n')).toEqual([])
          page.removeAllListeners('console')
          page.removeAllListeners('pageerror')
        }
      })
    }
  })
}

// Redeploy and skew need two real builds and a remote restart: prod only.
test.describe('Mode A: redeploy and skew (prod)', () => {
  test.skip(MODE !== 'prod', 'prod only')
  test.describe.configure({ mode: 'serial' })
  let server: ChildProcess | null = null
  const dist = join(
    remoteFixture,
    LANE ? `dist/${LANE}/redeploy` : 'dist/redeploy'
  )

  async function serve(current?: string) {
    await stop()
    server = spawn(
      'node',
      [
        NF_SERVE,
        '--dir',
        dist,
        '--port',
        String(lanePort(COMPONENTS_PORTS.redeploy)),
        ...(current ? ['--current', current] : []),
      ],
      { stdio: 'ignore' }
    )
    await expect
      .poll(
        async () => {
          try {
            const res = await fetch(`${REDEPLOY}/_nf/components.json`)
            return res.ok
              ? ((await res.json()) as { buildId: string }).buildId
              : ''
          } catch {
            return ''
          }
        },
        { timeout: 20_000 }
      )
      .toBe(current ?? 'r2')
  }
  async function stop() {
    if (!server) return
    const done = new Promise((r) => server!.once('exit', r))
    server.kill()
    await done
    server = null
  }

  test.beforeAll(() => {
    rmSync(dist, { recursive: true, force: true })
    for (const id of ['r1', 'r2']) {
      execFileSync('node', ['scripts/e2e.ts', 'build', 'redeploy', id], {
        cwd: remoteFixture,
        stdio: 'inherit',
      })
    }
    expect(existsSync(join(dist, 'r2', 'nf-components.json'))).toBe(true)
  })
  test.afterAll(stop)

  for (const host of HOSTS.filter((h) => h.ssr)) {
    test(`${host.name}: the client loads the build the server rendered; a redeploy is picked up without restart`, async ({
      page,
    }) => {
      test.setTimeout(90_000)
      await serve('r1')
      const url = `${host.url}/mode-a/redeploy`
      await expect
        .poll(async () => (await html(url)).body, { timeout: 15_000 })
        .toContain(`host=${host.value} build=r1`)

      // Skew: the server renders r1; r2 goes live while the browser's
      // remote requests are held. The browser must load r1 only.
      const requested: string[] = []
      let release!: () => void
      const held = new Promise<void>((r) => (release = r))
      await page.route(`${REDEPLOY}/**`, async (route: Route) => {
        requested.push(new URL(route.request().url()).pathname)
        // Scripts only: a held stylesheet would be render-blocking (in the
        // Pages Router it holds the parser), and it is build-pinned anyway.
        if (!route.request().url().endsWith('.css')) await held
        await route.continue()
      })
      const { bad, all } = watch(page)
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('rendered-build')).toHaveText('r1')
      await serve()
      release()
      await clickOnceHydrated(page)
      await expect(counterText(page)).toHaveText(`host=${host.value} build=r1`)
      expect(requested.length).toBeGreaterThan(0)
      expect(
        requested.every((p) => p.startsWith('/b/r1/')),
        requested.join('\n')
      ).toBe(true)
      expect(bad, all.join('\n')).toEqual([])

      // Redeploy: the host picks up r2 on its own (descriptor revalidate 1 s).
      await expect
        .poll(async () => (await html(url)).body, { timeout: 20_000 })
        .toContain(`host=${host.value} build=r2`)
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await page.goto(url)
      await expect(counterText(page)).toHaveText(`host=${host.value} build=r2`)
      await stop()
    })
  }
})

test('Mode A e2e cell', () => {
  // Recorded in the report: which cell ran.
  test
    .info()
    .annotations.push({ type: 'cell', description: `${MODE} ${BUNDLER}` })
})
