// Remote components and the host's Next.js modules (wave 2a): a Next host
// provides its own next/link, next/navigation (App Router) and next/router
// (Pages Router) to remote components (@next-federation/next/components and
// /pages/components); a host without them renders the documented fallback
// (NF-036). Plus shared-library negotiation: a library the remote shares
// with `fallback: true` comes from the host when its version satisfies the
// remote's range, else from the remote's own bundled copy.
// Remote: test/fixtures/components-remote (exposes ./NavLink, ./PagesNavLink,
// ./Versioned); hosts: /mode-a-next on every host.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  BUNDLER,
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES,
  HOST_PAGES_BASE,
  HOST_SPA,
  MODE,
} from './servers.ts'

type Host = {
  name: string
  /** The page under test. */
  page: string
  router: 'app' | 'pages' | null
  /** Where the remote link points, as the host's next/link renders it. */
  href?: string
  /** PagesNavLink's `router.pathname locale`. */
  routerText?: string
  /** Versioned's text: the host's copy or the remote's own. */
  versioned: string
}

const HOSTS: Host[] = [
  {
    name: 'App Router',
    page: `${HOST_APP}/mode-a-next`,
    router: 'app',
    href: '/mode-a',
    versioned: 'bundled@2.0.0',
  },
  {
    name: 'App Router (cacheComponents)',
    page: `${HOST_APP_CC}/mode-a-next`,
    router: 'app',
    href: '/mode-a',
    versioned: 'bundled@2.0.0',
  },
  {
    name: 'Pages Router',
    page: `${HOST_PAGES}/mode-a-next`,
    router: 'pages',
    href: '/mode-a',
    routerText: '/mode-a-next en',
    versioned: 'host@2.1.0',
  },
  {
    // basePath /base and the non-default locale: next/link adds both.
    name: 'Pages Router (basePath, locale fr)',
    page: `${HOST_PAGES_BASE}/base/fr/mode-a-next`,
    router: 'pages',
    href: '/base/fr/mode-a',
    routerText: '/mode-a-next fr',
    versioned: 'host@2.1.0',
  },
  {
    name: 'SPA',
    page: `${HOST_SPA}/mode-a-next`,
    router: null,
    versioned: 'bundled@2.0.0',
  },
]

// `next dev --webpack` re-instantiates host modules: remote components then
// render browser-only (stale share cache, see mode-a.spec.ts).
const DEV_WEBPACK = MODE === 'dev' && BUNDLER === 'webpack'

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

const markup = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replaceAll('<!-- -->', '')

async function serverHtml(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  expect(res.status).toBe(200)
  return markup(await res.text())
}

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

for (const host of HOSTS) {
  test.describe(`remote components and Next modules: ${host.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as { __nfEvents?: unknown[] }
        w.__nfEvents = []
        document.addEventListener('nf:component', (e) =>
          w.__nfEvents!.push((e as CustomEvent).detail)
        )
      })
    })

    if (host.router) {
      test("the remote link is the host's next/link: server markup, then a client navigation", async ({
        page,
      }) => {
        const testId =
          host.router === 'app' ? 'remote-link' : 'remote-pages-link'
        const expose = host.router === 'app' ? './NavLink' : './PagesNavLink'
        const body = await serverHtml(host.page)
        const ssr = !(DEV_WEBPACK && body.includes('data-nf-browser-only'))
        if (ssr) {
          expect(body).toMatch(
            new RegExp(
              `<a[^>]*href="${host.href}"[^>]*data-testid="${testId}"|<a[^>]*data-testid="${testId}"[^>]*href="${host.href}"`
            )
          )
          if (host.router === 'app') {
            expect(body).toMatch(
              /data-testid="remote-pathname"[^>]*>\/mode-a-next</
            )
          } else {
            expect(body).toContain(host.routerText)
          }
        }
        const { bad, all } = watch(page)
        await page.goto(host.page)
        const link = page.getByTestId(testId)
        await expect(link).toHaveAttribute('href', host.href!)
        if (host.router === 'pages') {
          await expect(page.getByTestId('remote-router')).toHaveText(
            host.routerText!
          )
        } else {
          await expect(page.getByTestId('remote-pathname')).toHaveText(
            '/mode-a-next'
          )
        }
        await loadedInBrowser(page, expose)
        // Survives a client navigation only (a full load starts a new window).
        await page.evaluate(() => {
          ;(window as { __nfNoReload?: boolean }).__nfNoReload = true
        })
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${host.href}$`))
        await expect(page.getByTestId('counter-text')).toBeVisible({
          timeout: 20_000,
        })
        expect(
          await page.evaluate(
            () => (window as { __nfNoReload?: boolean }).__nfNoReload
          )
        ).toBe(true)
        expect(bad, all.join('\n')).toEqual([])
      })

      test("a remote component that needs the other router's module renders its fallback (NF-036)", async ({
        page,
      }) => {
        const fallback =
          host.router === 'app' ? 'pages-nav-fallback' : 'nav-fallback'
        const missing =
          host.router === 'app' ? 'next/router' : 'next/navigation'
        const { all } = watch(page)
        await page.goto(host.page)
        // The refused load is logged, then its boundary settles on one
        // fallback (while it settles, the Suspense fallback shows next to
        // the hidden server HTML).
        await expect
          .poll(() => all.join('\n'), { timeout: 15_000 })
          .toMatch(new RegExp(`NF-036[\\s\\S]*"${missing}"`))
        await expect(page.getByTestId(fallback)).toHaveCount(1)
        await expect(page.getByTestId(fallback)).toBeVisible()
      })
    } else {
      test('a client-only host has no Next modules: next/* components render their fallback (NF-036)', async ({
        page,
      }) => {
        const { bad, all } = watch(page)
        await page.goto(host.page)
        await expect
          .poll(() => all.join('\n'), { timeout: 15_000 })
          .toMatch(/NF-036[\s\S]*"next\/link"/)
        await expect(page.getByTestId('nav-fallback')).toHaveCount(1)
        await expect(page.getByTestId('pages-nav-fallback')).toHaveCount(1)
        await expect(page.getByTestId('nav-fallback')).toBeVisible()
        await expect(page.getByTestId('remote-link')).toHaveCount(0)
        expect(bad, all.join('\n')).toEqual([])
      })
    }

    test(`a fallback-enabled shared library: ${host.versioned}`, async ({
      page,
    }) => {
      if (host.router) {
        const body = await serverHtml(host.page)
        if (!(DEV_WEBPACK && body.includes('data-nf-browser-only'))) {
          expect(body).toMatch(
            new RegExp(`data-testid="versioned"[^>]*>${host.versioned}<`)
          )
        }
      }
      const { bad, all } = watch(page)
      await page.goto(host.page)
      await loadedInBrowser(page, './Versioned')
      await expect(page.getByTestId('versioned')).toHaveText(host.versioned)
      expect(bad, all.join('\n')).toEqual([])
    })
  })
}
