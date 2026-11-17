// `RemoteIsland blocking` (App Router, private islands): the island renders in
// place in the first HTML, with no streamed fallback and no client-side swap,
// on the legacy host, the cacheComponents host (partialPrefetching on) and
// the Next 15 host. Page: /orders-inline (`?case=down|slow`) in host-app and
// host-app-next15. Runs in every mode and bundler of the e2e matrix.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  HOST_APP,
  HOST_APP_CC,
  HOST_APP_NEXT15,
  LOGS_DIR,
  MODE,
  PORTS,
} from './servers.ts'
import { markup } from './lib/strip-scripts.ts'
import { warmUp } from './lib/warm-up.ts'

const HOSTS = [
  {
    name: 'Next 16, cacheComponents off',
    url: HOST_APP,
    log: `host-app-${PORTS.hostApp}`,
    next15: false,
  },
  {
    name: 'Next 16, cacheComponents + partialPrefetching',
    url: HOST_APP_CC,
    log: `host-app-${PORTS.hostAppCc}`,
    next15: false,
  },
  {
    name: 'Next 15',
    url: HOST_APP_NEXT15,
    log: `host-app-next15-${PORTS.hostAppNext15}`,
    next15: true,
  },
]

const JWT = /eyJ[\w-]{10,}\.[\w-]+\.[\w-]+/
const COOKIE = { cookie: 'nf-user=user-1' }
const CONTENT = 'Orders for user-1'
const FALLBACK = 'loading orders'
const ERROR_FALLBACK = 'orders unavailable'
// The host's island fetch timeout (defineFederation default).
const TIMEOUT_MS = 3_000

/** Where React parks streamed boundaries: `<div hidden id="S:0">`. */
const firstStreamed = (html: string) => {
  const at = markup(html).indexOf('<div hidden id="S:')
  return at < 0 ? Infinity : at
}

// Next's embedded RSC data (`self.__next_f.push([1, "<rows>"])`).
function flight(html: string): string {
  return [...html.matchAll(/<script>self\.__next_f\.push\((.*?)\)<\/script>/gs)]
    .map((m) => {
      const pushed = JSON.parse(m[1]!) as unknown[]
      return typeof pushed[1] === 'string' ? pushed[1] : ''
    })
    .join('')
}

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

async function get(url: string, headers: Record<string, string> = COOKIE) {
  const started = Date.now()
  const res = await fetch(url, { headers })
  const html = await res.text()
  return { status: res.status, html, ms: Date.now() - started }
}

for (const host of HOSTS) {
  test.describe(`blocking private island (${host.name})`, () => {
    const page = `${host.url}/orders-inline`

    test.beforeAll(async () => {
      // `next dev` compiles the page (and the remote its island) on the
      // first request, inside the island timeout.
      await warmUp(page, { headers: COOKIE, ready: /Orders for/ })
    })

    test('the island is in the first HTML, in place: no fallback, no streamed swap', async () => {
      const { status, html } = await get(page)
      expect(status).toBe(200)
      const body = markup(html)
      const at = body.indexOf(CONTENT)
      expect(at).toBeGreaterThan(0)
      // In the shell, before any streamed boundary, and the fallback never
      // rendered in its place.
      expect(at).toBeLessThan(firstStreamed(html))
      expect(body).not.toContain(FALLBACK)
      expect(html).not.toContain('$RC(')
      // Right after the page's heading: no Suspense placeholder
      // (`<template id="B:…">`) between them.
      const heading = body.indexOf('<h1>My orders, inline</h1>')
      const section = body.indexOf('<section data-island="MyOrders"')
      expect(heading).toBeGreaterThan(0)
      expect(section).toBeGreaterThan(heading)
      expect(body.slice(heading, section)).not.toContain('<template')
    })

    test('no token in the HTML or the RSC payload', async () => {
      // Next 15 dev inlines React's debug info, which carries what a linked
      // library awaits (NF-037; installed-dev.spec.ts covers a real install).
      test.skip(
        host.next15 && MODE === 'dev',
        'Next 15 dev with a linked library (NF-037)'
      )
      const { html } = await get(page)
      expect(flight(html)).toContain('Orders for')
      expect(html).not.toMatch(JWT)
      expect(flight(html)).not.toMatch(JWT)
    })

    test('hydrates without errors and the island goes live', async ({
      page: browser,
      context,
    }) => {
      await context.addCookies([
        { name: 'nf-user', value: 'user-1', url: host.url },
      ])
      const errors = collectErrors(browser)
      await browser.goto(page)
      await expect(browser.locator('[data-nf-state="live"]')).toHaveCount(1)
      await expect(browser.getByText(CONTENT)).toBeVisible()
      await expect(browser.getByText(FALLBACK)).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('an anonymous visitor gets errorFallback in place', async () => {
      const { status, html } = await get(page, {})
      expect(status).toBe(200)
      const body = markup(html)
      expect(body).toContain(ERROR_FALLBACK)
      expect(body.indexOf(ERROR_FALLBACK)).toBeLessThan(firstStreamed(html))
      expect(body).not.toContain(FALLBACK)
      expect(body).not.toContain('Orders for')
    })

    test('remote down: 200 with errorFallback in place', async () => {
      const { status, html } = await get(`${page}?case=down`)
      expect(status).toBe(200)
      const body = markup(html)
      expect(body).toContain(ERROR_FALLBACK)
      expect(body.indexOf(ERROR_FALLBACK)).toBeLessThan(firstStreamed(html))
      expect(body).not.toContain(FALLBACK)
      expect(html).not.toContain('$RC(')
    })

    test('remote slower than the island timeout: 200 with errorFallback in place, within the timeout', async () => {
      // The remote answers after 10 s; the page answers at the timeout.
      const { status, html, ms } = await get(`${page}?case=slow`)
      expect(status).toBe(200)
      const body = markup(html)
      expect(body).toContain(ERROR_FALLBACK)
      expect(body).not.toContain('finally')
      expect(body).not.toContain(FALLBACK)
      expect(ms).toBeGreaterThanOrEqual(TIMEOUT_MS - 100)
      expect(ms).toBeLessThan(TIMEOUT_MS + 4_000)
    })

    test('next build marks the route dynamic (ƒ): no static shell', () => {
      test.skip(MODE !== 'prod', 'production builds only')
      const log = readFileSync(join(LOGS_DIR, `${host.log}.build.log`), 'utf8')
      expect(log).toMatch(/^[├└┌] ƒ \/orders-inline\b/m)
    })
  })
}
