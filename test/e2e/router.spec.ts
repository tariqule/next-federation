// Remotes written with their own router: `next/link` and `next/navigation`
// (RouterLink, RouterSearch) or `react-router` (RouterReactRouter, and
// RouterInternal with its own MemoryRouter), unchanged. The build rewires
// those imports to shims on the internal `@next-federation/router`, so one
// build navigates through the host's router: the App Router and the Pages
// Router (provided by the @next-federation/next entries), React Router
// (`provideNavigation` in the SPA), or the remote's own document router
// when the host provides none (or one outside the remote's range: full page
// navigations). A React Router link inside the remote's own router stays
// inside it.
// Remotes: test/fixtures/components-remote's links build (l1, NF_LINKS:
// ./RouterLink, ./RouterSearch, ./RouterReactRouter, ./RouterInternal; and
// rm1 that accepts router >=9.0.0 only) and components-remote-rspack
// (./RouterLink from the same source, `routerShimAliases()` and
// `routerSharedEntry()`, its bundled router labelled 0.99.0).
// Hosts: /router/* on host-app (both), host-pages (basePath /base, locale
// fr) and host-spa (/rr/* with React Router, /router-none* without).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { COMPONENTS_PORTS } from './fixtures/components-keys.ts'
import { lanePort } from './lane.ts'
import {
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES_BASE,
  HOST_SPA,
  LANE,
  LOGS_DIR,
  MODE,
  PORTS,
} from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

const ROUTER_VERSION = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', '..', 'packages/router/package.json'),
      'utf8'
    )
  ) as { version: string }
).version
/** RouterLink's `external` href in every host: another origin. */
const EXTERNAL = `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.signed)}/_nf/components.json`

const APP_HOSTS = [
  {
    name: 'App Router host',
    url: HOST_APP,
    port: PORTS.hostApp,
    dist: '.next',
  },
  {
    name: 'App Router host (cacheComponents)',
    url: HOST_APP_CC,
    port: PORTS.hostAppCc,
    dist: '.next-cc',
  },
] as const

const LINK =
  /<a[^>]*href="\/router\/next"[^>]*data-testid="router-link"|<a[^>]*data-testid="router-link"[^>]*href="\/router\/next"/
const STATIC_PATHNAME = /data-testid="router-pathname"[^>]*>\/router\/static</

/** Console errors that mean React broke: hydration, a second React. */
const BAD =
  /hydrat|Invalid hook call|did not match|Minified React error #4(18|19|23|25)/i

function watch(page: Page) {
  const bad: string[] = []
  const all: string[] = []
  page.on('pageerror', (e) => {
    all.push(e.message)
    // Next's own dev HMR client (Pages Router, `next dev`) can throw on an
    // `isrManifest` message while pages change quickly: not this page's React.
    if (MODE === 'dev' && e.message.startsWith('[HMR] Invalid message')) return
    bad.push(e.message)
  })
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    all.push(m.text())
    if (BAD.test(m.text())) bad.push(m.text())
  })
  return { bad, all }
}

/** Waits until React owns the element (hydrated, or rendered in the browser). */
async function hydrated(page: Page, testId: string): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      return (
        el !== null &&
        Object.keys(el).some((key) => key.startsWith('__reactProps'))
      )
    },
    testId,
    { timeout: 30_000 }
  )
}

/**
 * The visible element: the cacheComponents host keeps the page a client
 * navigation left in a hidden Activity.
 */
const shown = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true }).first()

/** Survives a client navigation only (a full load starts a new window). */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as { __nfNoReload?: boolean }).__nfNoReload = true
  })
}

async function marked(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as { __nfNoReload?: boolean }).__nfNoReload === true
  )
}

async function serverHtml(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  expect(res.status).toBe(200)
  return markup(await res.text())
}

/** The href of the server HTML's `<a data-testid=testId>`, if it is there. */
function anchorHrefOf(body: string, testId: string): string | undefined {
  const anchor = body
    .match(/<a\b[^>]*>/g)
    ?.find((a) => a.includes(`data-testid="${testId}"`))
  return anchor ? /\bhref="([^"]*)"/.exec(anchor)?.[1] : undefined
}

/** The text of the server HTML's element with `data-testid=testId`. */
function textOf(body: string, testId: string): string | undefined {
  return new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(body)?.[1]
}

/**
 * Opens `url`, checks the remote link's href and usePathname (`from`), clicks
 * it and checks a client navigation to /router/next.
 */
async function clientNavigation(
  page: Page,
  url: string,
  { href, from }: { href: string; from: string }
) {
  const { bad, all } = watch(page)
  await page.goto(url)
  const link = page.getByTestId('router-link').first()
  await expect(link).toHaveAttribute('href', href, { timeout: 20_000 })
  await hydrated(page, 'router-link')
  await expect(shown(page, 'router-pathname')).toHaveText(from)
  await mark(page)
  await link.click()
  await expect(shown(page, 'router-page')).toHaveText('router next')
  await expect(shown(page, 'router-pathname')).toHaveText('/router/next', {
    timeout: 20_000,
  })
  expect(await marked(page)).toBe(true)
  expect(bad, all.join('\n')).toEqual([])
}

for (const host of APP_HOSTS) {
  for (const path of ['/router/static', '/router/dynamic']) {
    test(`${host.name}: RouterLink navigates client-side (window marker survives) and shows /router/next (${path})`, async ({
      page,
    }) => {
      await clientNavigation(page, `${host.url}${path}`, {
        href: '/router/next',
        from: path,
      })
      await expect(page).toHaveURL(`${host.url}/router/next`)
    })
  }

  test(`${host.name}: the static RouterLink page is in the build's static routes and its HTML contains the link`, async () => {
    if (MODE === 'prod') {
      const log = readFileSync(
        join(LOGS_DIR, `host-app-${host.port}.build.log`),
        'utf8'
      )
      // ○ static, ● SSG, ◐ partial prerender (this Next prints ◐ for every
      // route of the cacheComponents host); never ƒ (dynamic).
      expect(log).toMatch(/^[├└┌] [○●◐] \/router\/static\b/m)
      expect(log).not.toMatch(/^[├└┌] ƒ \/router\/static\b/m)
      // The prerendered page the build wrote.
      const prerendered = markup(
        readFileSync(
          join(
            import.meta.dirname,
            '..',
            'fixtures',
            'host-app',
            `${host.dist}${LANE ? `-${LANE}` : ''}`,
            'server/app/router/static.html'
          ),
          'utf8'
        )
      )
      expect(prerendered).toMatch(LINK)
      expect(prerendered).toMatch(STATIC_PATHNAME)
      // A live request to the cacheComponents host may be a regeneration
      // that renders before this process loaded the build (NF-039: its
      // remote components wait for request time), so only the legacy host
      // is also checked live.
      if (host.dist === '.next-cc') return
    }
    const body = await serverHtml(`${host.url}/router/static`)
    expect(body).toMatch(LINK)
    expect(body).toMatch(STATIC_PATHNAME)
  })
}

test('App Router host: static RouterSearch page renders the fallback in its HTML and the value after hydration', async ({
  page,
}) => {
  if (MODE === 'prod') {
    const log = readFileSync(
      join(LOGS_DIR, `host-app-${PORTS.hostApp}.build.log`),
      'utf8'
    )
    expect(log).toMatch(/^[├└┌] [○●] \/router\/search\b/m)
    // Static HTML: the search params are unknown there, so the component
    // renders its fallback (Next's client-side rendering bailout).
    const body = await serverHtml(`${HOST_APP}/router/search?q=shoes`)
    expect(body).toContain('data-testid="router-search-fallback"')
    expect(body).not.toContain('q=shoes')
  }
  const { bad, all } = watch(page)
  await page.goto(`${HOST_APP}/router/search?q=shoes`)
  await expect(page.getByTestId('router-search')).toHaveText('q=shoes', {
    timeout: 20_000,
  })
  expect(bad, all.join('\n')).toEqual([])
})

test('App Router host, two RouterLinks: one click adds exactly one history entry', async ({
  page,
}) => {
  const { bad, all } = watch(page)
  await page.goto(`${HOST_APP}/router/two`)
  await expect(page.getByTestId('router-link')).toHaveCount(2)
  await hydrated(page, 'router-link')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="router-link"]')].every(
        (el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))
      ),
    undefined,
    { timeout: 30_000 }
  )
  const before = await page.evaluate(() => history.length)
  await mark(page)
  await page.getByTestId('router-link').first().click()
  await expect(page).toHaveURL(`${HOST_APP}/router/next`)
  await expect(shown(page, 'router-page')).toHaveText('router next')
  expect(await page.evaluate(() => history.length)).toBe(before + 1)
  expect(await marked(page)).toBe(true)
  // One back lands on the page the click left (two entries would not).
  await page.goBack()
  await expect(page).toHaveURL(`${HOST_APP}/router/two`)
  await expect(shown(page, 'router-page')).toHaveText('router two')
  expect(bad, all.join('\n')).toEqual([])
})

test('App Router host, range-miss build: full navigation to /router/next (marker gone, page correct, no reload loop)', async ({
  page,
}) => {
  const { bad, all } = watch(page)
  await page.goto(`${HOST_APP}/router/miss`)
  await expect(page.getByTestId('rendered-build')).toHaveText('rm1')
  const link = page.getByTestId('router-link')
  // The remote's own document router: a plain link, no basePath to add here.
  await expect(link).toHaveAttribute('href', '/router/next')
  await hydrated(page, 'router-link')
  const warning = `router-miss bundles its own "@next-federation/router" (host has ${ROUTER_VERSION}, remote needs ">=9.0.0")`
  await expect
    .poll(() => all.filter((l) => l.includes(warning)).length, {
      timeout: 15_000,
    })
    .toBe(1)
  await mark(page)
  await link.click()
  await expect(page).toHaveURL(`${HOST_APP}/router/next`)
  await expect(shown(page, 'router-page')).toHaveText('router next')
  expect(await marked(page)).toBe(false)
  // The page that loaded stays: no reload loop, no URL reset.
  await mark(page)
  await page.waitForTimeout(1500)
  expect(await marked(page)).toBe(true)
  await expect(page).toHaveURL(`${HOST_APP}/router/next`)
  expect(all.filter((l) => l.includes(warning))).toHaveLength(1)
  expect(bad, all.join('\n')).toEqual([])
})

test('App Router host, Rspack RouterLink with bundled router 0.99.0: client navigation (marker survives)', async ({
  page,
}) => {
  await clientNavigation(page, `${HOST_APP}/router/rspack`, {
    href: '/router/next',
    from: '/router/rspack',
  })
  await expect(page).toHaveURL(`${HOST_APP}/router/next`)
  // The page it left rendered the Rspack build (rs1).
  await page.goBack()
  await expect(page.getByTestId('rendered-build')).toHaveText('rs1')
})

test('Pages host (/base, fr): href /base/fr/router/next; client navigation keeps fr; usePathname shows /router/next', async ({
  page,
}) => {
  await clientNavigation(page, `${HOST_PAGES_BASE}/base/fr/router/link`, {
    href: '/base/fr/router/next',
    from: '/router/link',
  })
  await expect(page).toHaveURL(`${HOST_PAGES_BASE}/base/fr/router/next`)
})

test('SPA with React Router (basename /rr): href /rr/router/next, client navigation, usePathname /router/next', async ({
  page,
}) => {
  await clientNavigation(page, `${HOST_SPA}/rr/router/link`, {
    href: '/rr/router/next',
    from: '/router/link',
  })
  await expect(page).toHaveURL(`${HOST_SPA}/rr/router/next`)
})

test('SPA without an adapter: full navigation to the href', async ({
  page,
}) => {
  const { bad, all } = watch(page)
  await page.goto(`${HOST_SPA}/router-none`)
  const link = page.getByTestId('router-link')
  await expect(link).toHaveAttribute('href', '/router/next', {
    timeout: 20_000,
  })
  await expect(shown(page, 'router-pathname')).toHaveText('/router-none')
  await mark(page)
  await link.click()
  await expect(page).toHaveURL(`${HOST_SPA}/router/next`)
  await expect(shown(page, 'router-page')).toHaveText('router next')
  expect(await marked(page)).toBe(false)
  await expect(shown(page, 'router-pathname')).toHaveText('/router/next', {
    timeout: 20_000,
  })
  expect(bad, all.join('\n')).toEqual([])
})

test('external link: normal navigation in every host', async ({ page }) => {
  // Every click's `defaultPrevented`, read by a window listener: it runs
  // after the page's own handlers (React's, the host Link's), so `true`
  // means the page intercepted the click. Reported through a binding, which
  // reaches the test before the page unloads.
  const prevented: boolean[] = []
  await page.exposeFunction('__nfClickPrevented', (value: boolean) => {
    prevented.push(value)
  })
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      const report = (
        window as unknown as { __nfClickPrevented?: (v: boolean) => void }
      ).__nfClickPrevented
      report?.(e.defaultPrevented)
    })
  })
  for (const url of [
    `${HOST_APP}/router/static`,
    `${HOST_APP_CC}/router/static`,
    `${HOST_PAGES_BASE}/base/fr/router/link`,
    `${HOST_SPA}/rr/router/link`,
    `${HOST_SPA}/router-none`,
  ]) {
    prevented.length = 0
    await page.goto(url)
    await hydrated(page, 'router-external')
    const external = shown(page, 'router-external')
    await expect(external, url).toHaveAttribute('href', EXTERNAL)
    await external.click()
    await expect(page, url).toHaveURL(EXTERNAL)
    expect(prevented, url).toEqual([false])
  }
})

test('RouterReactRouter (react-router Link, no router in the remote): client navigation in App, Pages (/base/fr prefix) and React Router SPA hosts; full navigation in the plain SPA', async ({
  page,
}) => {
  const cases = [
    {
      url: `${HOST_APP}/router/react-router`,
      href: '/router/next',
      from: '/router/react-router',
      to: `${HOST_APP}/router/next`,
      client: true,
      ssr: true,
    },
    {
      // The legacy App Router host and the Pages host check the server
      // HTML; the page is the same on this one.
      url: `${HOST_APP_CC}/router/react-router`,
      href: '/router/next',
      from: '/router/react-router',
      to: `${HOST_APP_CC}/router/next`,
      client: true,
    },
    {
      url: `${HOST_PAGES_BASE}/base/fr/router/react-router`,
      href: '/base/fr/router/next',
      from: '/router/react-router',
      to: `${HOST_PAGES_BASE}/base/fr/router/next`,
      client: true,
      ssr: true,
    },
    {
      // provideNavigation({ useNavigate, useHref, useLocation }): the
      // basename comes from useHref, the pathname from useLocation.
      url: `${HOST_SPA}/rr/router/react-router`,
      href: '/rr/router/next',
      from: '/router/react-router',
      to: `${HOST_SPA}/rr/router/next`,
      client: true,
    },
    {
      // No navigation provided: a plain link, the document's pathname.
      url: `${HOST_SPA}/router-none/react-router`,
      href: '/router/next',
      from: '/router-none/react-router',
      to: `${HOST_SPA}/router/next`,
      client: false,
    },
  ]
  const { bad, all } = watch(page)
  for (const c of cases) {
    if ('ssr' in c) {
      // Server-rendered with the host's router: href and pathname in the
      // HTML (a browser-only render has neither).
      const body = await serverHtml(c.url)
      expect(anchorHrefOf(body, 'rr-link'), c.url).toBe(c.href)
      expect(textOf(body, 'rr-pathname'), c.url).toBe(c.from)
    }
    await page.goto(c.url)
    const link = shown(page, 'rr-link')
    await expect(link, c.url).toHaveAttribute('href', c.href, {
      timeout: 20_000,
    })
    await hydrated(page, 'rr-link')
    await expect(shown(page, 'rr-pathname'), c.url).toHaveText(c.from)
    await mark(page)
    await link.click()
    await expect(page, c.url).toHaveURL(c.to)
    await expect(shown(page, 'router-page'), c.url).toHaveText('router next')
    expect(await marked(page), c.url).toBe(c.client)
  }
  expect(bad, all.join('\n')).toEqual([])
})

test('RouterInternal: clicking its internal link changes its own route; the host URL and the window marker are unchanged', async ({
  page,
}) => {
  const { bad, all } = watch(page)
  // Server-rendered in the Next.js hosts: the MemoryRouter's first route,
  // React Router's own href. (The cacheComponents host's static page is not
  // checked live: a live request may be a regeneration that renders before
  // the build is loaded, NF-039.)
  for (const url of [
    `${HOST_APP}/router/internal`,
    `${HOST_PAGES_BASE}/base/fr/router/internal`,
  ]) {
    const body = await serverHtml(url)
    expect(anchorHrefOf(body, 'internal-link'), url).toBe('/inner')
    expect(textOf(body, 'internal-pathname'), url).toBe('/')
  }
  for (const url of [
    `${HOST_APP}/router/internal`,
    `${HOST_APP_CC}/router/internal`,
    `${HOST_PAGES_BASE}/base/fr/router/internal`,
    `${HOST_SPA}/rr/router/internal`,
    `${HOST_SPA}/router-none/internal`,
  ]) {
    await page.goto(url)
    const link = shown(page, 'internal-link')
    // Inside its own MemoryRouter: React Router's own href, no host prefix.
    await expect(link, url).toHaveAttribute('href', '/inner', {
      timeout: 20_000,
    })
    await hydrated(page, 'internal-link')
    await expect(shown(page, 'internal-pathname'), url).toHaveText('/')
    const title = await shown(page, 'router-page').textContent()
    await mark(page)
    await link.click()
    await expect(shown(page, 'internal-page'), url).toHaveText('inner page')
    await expect(shown(page, 'internal-pathname'), url).toHaveText('/inner')
    await expect(page, url).toHaveURL(url)
    await expect(shown(page, 'router-page'), url).toHaveText(title!)
    expect(await marked(page), url).toBe(true)
  }
  expect(bad, all.join('\n')).toEqual([])
})

// One host server process loads builds one after the other. A build whose
// range excludes the host's router loads its own bundled copy; every later
// build still gets the host's router, on the server (hrefs, usePathname in
// the HTML) and in the browser.
const RSPACK_MISS_WARNING = `rspack-router-miss bundles its own "@next-federation/router" (host has ${ROUTER_VERSION}, remote needs ">=0.99.0")`

/** The server HTML's remote link href and usePathname text. */
async function serverLink(url: string) {
  const body = await serverHtml(url)
  return {
    body,
    href: /<a[^>]*href="([^"]*)"[^>]*data-testid="router-link"|<a[^>]*data-testid="router-link"[^>]*href="([^"]*)"/
      .exec(body)
      ?.slice(1)
      .find((x) => x !== undefined),
    pathname: /data-testid="router-pathname"[^>]*>([^<]*)</.exec(body)?.[1],
  }
}

// Guards the runtime's share resolution on the server (the host's copy, never
// another remote's): with it turned off, the Rspack page after the miss page
// renders /router/next without /base/fr.
test('one Pages host process (/base, fr): the Rspack range-miss page, then the normal Rspack and Vite pages still use the host router', async ({
  page,
}) => {
  const base = `${HOST_PAGES_BASE}/base/fr`
  // The range-miss build: its own copy (the document router) on the server
  // (no basePath, no locale, no server pathname) and in the browser.
  const miss = await serverLink(`${base}/router/rspack-miss`)
  expect(miss.body).toContain('data-testid="rendered-build">rsm1<')
  expect(miss.href).toBe('/router/next')
  expect(miss.pathname).toBe('')
  const { all } = watch(page)
  await page.goto(`${base}/router/rspack-miss`)
  await hydrated(page, 'router-link')
  await expect(page.getByTestId('router-link')).toHaveAttribute(
    'href',
    '/router/next'
  )
  await expect
    .poll(() => all.filter((l) => l.includes(RSPACK_MISS_WARNING)).length, {
      timeout: 15_000,
    })
    .toBe(1)
  // Later builds in the same process: the host's router.
  for (const path of ['/router/rspack', '/router/link']) {
    const next = await serverLink(`${base}${path}`)
    expect(next.href, path).toBe('/base/fr/router/next')
    expect(next.pathname, path).toBe(path)
    await clientNavigation(page, `${base}${path}`, {
      href: '/base/fr/router/next',
      from: path,
    })
    await expect(page).toHaveURL(`${base}/router/next`)
  }
  await expect(page.getByTestId('rendered-build')).toHaveText('l1')
})

// The order the other way round (the host's router first, then the miss
// builds, then the normal builds again). It checks that each build keeps its
// own router in either order. It does not guard the share resolution (it
// passed with the resolution turned off); the Pages test above does.
test('one App Router host process: normal pages first, then the range-miss pages use their own copy, then the normal pages still use the host router', async ({
  page,
}) => {
  // The host's router first (Rspack and Vite builds).
  for (const path of ['/router/rspack', '/router/static']) {
    await clientNavigation(page, `${HOST_APP}${path}`, {
      href: '/router/next',
      from: path,
    })
  }
  // The Rspack range-miss build: its own copy on the server (the document
  // router's server pathname is empty) and in the browser (full navigation).
  const miss = await serverLink(`${HOST_APP}/router/rspack-miss`)
  expect(miss.body).toContain('data-testid="rendered-build">rsm1<')
  expect(miss.href).toBe('/router/next')
  expect(miss.pathname).toBe('')
  const { bad, all } = watch(page)
  await page.goto(`${HOST_APP}/router/rspack-miss`)
  await hydrated(page, 'router-link')
  await mark(page)
  await page.getByTestId('router-link').click()
  await expect(page).toHaveURL(`${HOST_APP}/router/next`)
  await expect(shown(page, 'router-page')).toHaveText('router next')
  expect(await marked(page)).toBe(false)
  expect(all.filter((l) => l.includes(RSPACK_MISS_WARNING))).toHaveLength(1)
  // The Vite range-miss build: never the host's copy (it renders in the
  // browser only here when the host's copy is cached under its key).
  const viteMiss = await serverHtml(`${HOST_APP}/router/miss`)
  expect(viteMiss).not.toMatch(/data-testid="router-pathname"[^>]*>\/router/)
  await page.goto(`${HOST_APP}/router/miss`)
  await hydrated(page, 'router-link')
  await mark(page)
  await page.getByTestId('router-link').click()
  await expect(page).toHaveURL(`${HOST_APP}/router/next`)
  expect(await marked(page)).toBe(false)
  expect(bad, all.join('\n')).toEqual([])
  // Then the normal builds again: the host's router, server and browser.
  for (const path of ['/router/rspack', '/router/static']) {
    const next = await serverLink(`${HOST_APP}${path}`)
    expect(next.href, path).toBe('/router/next')
    expect(next.pathname, path).toBe(path)
    await clientNavigation(page, `${HOST_APP}${path}`, {
      href: '/router/next',
      from: path,
    })
  }
})

test('browser R2: in one document, the range-miss page then a normal page by client navigation keeps the host router', async ({
  page,
}) => {
  // The Rspack range-miss build loads its bundled router into the page;
  // the normal Rspack build, reached by the host's own client navigation,
  // still gets the host's router, never the copy the miss build loaded.
  // A behaviour check: it also passed with the runtime's browser plugin
  // (registerGlobalPlugins) removed, so the guard of that plugin stays the
  // unit test (components-runtime.spec.ts, real Module Federation runtime).
  const { bad, all } = watch(page)
  for (const host of [
    { base: HOST_APP, href: '/router/next' },
    { base: `${HOST_PAGES_BASE}/base/fr`, href: '/base/fr/router/next' },
  ]) {
    await page.goto(`${host.base}/router/rspack-miss`)
    await expect(page.getByTestId('rendered-build')).toHaveText('rsm1')
    await hydrated(page, 'router-link')
    // Its own copy: the document router's plain href.
    await expect(page.getByTestId('router-link')).toHaveAttribute(
      'href',
      '/router/next'
    )
    await expect
      .poll(() => all.filter((l) => l.includes(RSPACK_MISS_WARNING)).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0)
    await hydrated(page, 'host-link')
    await mark(page)
    await page.getByTestId('host-link').click()
    await expect(page).toHaveURL(`${host.base}/router/rspack`)
    await expect(shown(page, 'router-page')).toHaveText('router rspack')
    await expect(shown(page, 'rendered-build')).toHaveText('rs1')
    expect(await marked(page), host.base).toBe(true)
    const link = shown(page, 'router-link')
    await expect(link, host.base).toHaveAttribute('href', host.href, {
      timeout: 20_000,
    })
    await expect(shown(page, 'router-pathname'), host.base).toHaveText(
      '/router/rspack'
    )
    await hydrated(page, 'router-link')
    await link.click()
    await expect(page).toHaveURL(`${host.base}/router/next`)
    await expect(shown(page, 'router-page')).toHaveText('router next')
    // Still the same document: the host's router navigated.
    expect(await marked(page), host.base).toBe(true)
  }
  expect(bad, all.join('\n')).toEqual([])
})
