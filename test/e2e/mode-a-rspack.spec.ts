// Mode A with a remote NOT built with Vite: test/fixtures/components-remote-rspack
// is built with Rspack + @module-federation/enhanced (Module Federation 2.0),
// its descriptor written by `nf-describe`, served by nf-serve (signed rs1,
// unsigned ru1). The hosts and their runtime are the same as mode-a.spec.ts.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { COMPONENTS_PORTS } from './fixtures/components-keys.ts'
import { lanePort } from './lane.ts'
import {
  BUNDLER,
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES,
  HOST_SPA,
  MODE,
} from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

const RSPACK = `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.rspack)}`

type Host = { name: string; url: string; value: string; ssr: boolean }
const HOSTS: Host[] = [
  { name: 'App Router', url: HOST_APP, value: 'from-app-host', ssr: true },
  {
    name: 'App Router (cacheComponents)',
    url: HOST_APP_CC,
    value: 'from-app-host',
    ssr: true,
  },
  {
    name: 'Pages Router',
    url: HOST_PAGES,
    value: 'from-pages-host',
    ssr: true,
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
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const body = markup(await res.text())
  return { status: res.status, body }
}

// As in mode-a.spec.ts: `next dev --webpack` reloads the host's server
// modules, after which Mode A renders browser-only (NF-028 "stale").
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

test('the Rspack build has a signed nf-describe descriptor covering its server entry', async () => {
  const res = await fetch(`${RSPACK}/_nf/components.json`)
  expect(res.status).toBe(200)
  const descriptor = (await res.json()) as {
    name: string
    buildId: string
    base: string
    jws?: string
    ssr: { integrity: Record<string, string> } | null
  }
  expect(descriptor).toMatchObject({
    name: 'components_rspack',
    buildId: 'rs1',
    base: `${RSPACK}/b/rs1/`,
  })
  expect(typeof descriptor.jws).toBe('string')
  expect(Object.keys(descriptor.ssr!.integrity).sort()).toEqual([
    'mf-manifest.json',
    'server/remoteEntry.js',
  ])
  // nf-describe recorded the server entry in the browser manifest.
  const manifest = (await (
    await fetch(`${RSPACK}/b/rs1/mf-manifest.json`)
  ).json()) as { metaData: { ssrRemoteEntry: unknown } }
  expect(manifest.metaData.ssrRemoteEntry).toEqual({
    name: 'remoteEntry.js',
    path: 'server',
    type: 'commonjs-module',
  })
})

for (const host of HOSTS) {
  test.describe(`Mode A, Rspack remote: ${host.name}`, () => {
    const path = host.ssr ? '/mode-a/rspack' : '/mode-a?rspack=1'

    test('renders on the host React with the host context; click updates it', async ({
      page,
    }) => {
      const expected = `host=${host.value} build=rs1`
      if (host.ssr) {
        const { status, body } = await html(`${host.url}${path}`)
        expect(status).toBe(200)
        // Server-rendered from the verified (signed) build.
        expectServerMarkup(body, expected)
        expect(body).not.toContain('data-nf-browser-only')
        // One React on the server: the remote got this layer's React.
        expect(body).toMatch(/data-testid="react-probe"[^>]*>true</)
      }
      const { bad, all } = watch(page)
      await page.goto(`${host.url}${path}`)
      await expect(page.getByTestId('counter-text')).toHaveText(expected)
      await expect(page.getByTestId('counter-btn')).toHaveText('count 1')
      if (host.ssr) {
        // One React in the browser, and the page has hydrated.
        await expect(page.getByTestId('react-probe')).toHaveAttribute(
          'data-client',
          'true'
        )
      }
      await page.getByTestId('counter-btn').click()
      await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
      expect(bad, all.join('\n')).toEqual([])
    })

    if (!host.ssr) return

    test('an unsigned Rspack build renders in the browser only', async ({
      page,
    }) => {
      const { status, body } = await html(`${host.url}/mode-a/rspack-unsigned`)
      expect(status).toBe(200)
      expect(body).not.toContain('data-testid="counter"')
      expect(body).toContain('counter unavailable')
      const { bad, all } = watch(page)
      await page.goto(`${host.url}/mode-a/rspack-unsigned`)
      await expect(page.getByTestId('counter-text')).toHaveText(
        `host=${host.value} build=ru1`
      )
      await page.getByTestId('counter-btn').click()
      await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
      expect(bad, all.join('\n')).toEqual([])
    })
  })
}

// Mixed-router host: an App Router route and a Pages Router route of one
// Next server process (two Reacts). The Rspack build bundles its own Module
// Federation runtime: each layer's copy gets its own registry, so both
// layers server-render it on their own React, in either order.
for (const host of HOSTS.filter(
  (h) => h.url === HOST_APP || h.url === HOST_APP_CC
)) {
  test(`mixed router (${host.name}): an Rspack remote server-renders in both routers, each on its own React`, async ({
    page,
  }) => {
    const routes = [
      { path: '/mode-a/rspack', value: 'from-app-host' },
      { path: '/mode-a-mixed?remote=rspack', value: 'from-mixed-host' },
    ]
    for (const route of [...routes, ...[...routes].reverse()]) {
      const { status, body } = await html(`${host.url}${route.path}`)
      expect(status).toBe(200)
      expectServerMarkup(body, `host=${route.value} build=rs1`)
      expect(body).not.toContain('data-nf-browser-only')
      expect(body).toMatch(/data-testid="react-probe"[^>]*>true</)
    }
    for (const route of routes) {
      const { bad, all } = watch(page)
      await page.goto(`${host.url}${route.path}`)
      await expect(page.getByTestId('counter-text')).toHaveText(
        `host=${route.value} build=rs1`
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
