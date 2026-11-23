// React 18 hosts embed islands and remote components. Two hosts, each a
// template under test/fixtures installed on React 18.3.1 with the packed
// packages (fixtures/installed-host.ts):
//   3110  host-pages-next15-react18: Next 15 Pages Router. `/` server-renders
//         the public island ProductPanel and Counter from the components
//         remote's react18 build (c18, accepts '^18.3.0 || ^19.0.0');
//         `/start` links to `/` (client navigation); `/nineteen` renders
//         Counter from the 19-only build (c1).
//   4201  host-spa-react18: a Vite SPA under StrictMode. `/islands` mounts
//         ProductPanel in the browser, `/components` renders c18's Counter,
//         `/shared?host=1` calls provideHostReact() first, `/nineteen` renders
//         c1's Counter.
// React 18 has no stylesheet resources: island and component links carry
// `data-precedence="next-federation"`, and their head copies `data-nf-css`.
// Run with NF_SUITE=react18 (`pnpm e2e:react18`).
import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { markup } from './lib/strip-scripts.ts'
import { warmUp } from './lib/warm-up.ts'
import {
  COMPONENTS_19,
  COMPONENTS_REACT18,
  HOST_PAGES_REACT18,
  HOST_SPA_REACT18,
  MODE,
  PORTS,
  REMOTE_A,
  SUITE,
  serverLog,
} from './servers.ts'

test.skip(SUITE !== 'react18', 'NF_SUITE=react18 only')

const PAGES = HOST_PAGES_REACT18
const SPA = HOST_SPA_REACT18
const PRECEDENCE = 'next-federation'
/**
 * React 18 hydration trouble: the development warnings and the production
 * recoverable errors (minified #418, #419, #422, #423, #425).
 */
const HYDRATION =
  /hydrat|did not match|server HTML|error #(418|419|422|423|425)\b/i

/** Every console message and page error, plus the errors on their own. */
function watch(page: Page) {
  const all: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => {
    all.push(`pageerror: ${e.message}`)
    errors.push(e.message)
  })
  page.on('console', (m) => {
    const text = m.text()
    all.push(`${m.type()}: ${text}`)
    if (m.type() === 'error' && !text.includes('Download the React DevTools'))
      errors.push(text)
  })
  return { all, errors }
}

/** Records nf:island events (`<type>:<remote>`) from the first script on. */
async function recordIslandEvents(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { islandEvents: string[] }).islandEvents = seen
    document.addEventListener('nf:island', (e) => {
      const detail = (e as CustomEvent<{ type: string; remote: string }>).detail
      seen.push(`${detail.type}:${detail.remote}`)
    })
  })
  return () =>
    page.evaluate(
      () => (window as unknown as { islandEvents: string[] }).islandEvents
    )
}

type Link = { at: number; href: string; tag: string }
/** The `<link rel="stylesheet">` tags of some markup, in order. */
function stylesheets(html: string): Link[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .filter((m) => /\brel="stylesheet"/.test(m[0]))
    .map((m) => ({
      at: m.index,
      href: /\bhref="([^"]+)"/.exec(m[0])?.[1] ?? '',
      tag: m[0],
    }))
}

/** The stylesheet links in the document's head, as [href, precedence, nf-css]. */
type HeadSheet = [
  href: string | null,
  precedence: string | null,
  nfCss: boolean,
]
const headSheets = (page: Page): Promise<HeadSheet[]> =>
  page
    .locator('head link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map(
        (l): HeadSheet => [
          l.getAttribute('href'),
          l.getAttribute('data-precedence'),
          l.hasAttribute('data-nf-css'),
        ]
      )
    )

const island = (page: Page) => page.locator('[data-island="ProductPanel"]')
const isIslandCss = (href: string | null) =>
  !!href?.startsWith(`${REMOTE_A}/`) && href.endsWith('.css')
const isCounterCss = (origin: string) => (href: string | null) =>
  !!href?.startsWith(`${origin}/`) && /\/Counter-[^/]+\.css$/.test(href)

/** The fixture's runtime probe (island-remote/fixture-plugins.ts). */
type Probe = {
  react?: string[]
  'react-dom'?: string[]
  'react-dom/client'?: string[]
}

test("Pages host on React 18: island HTML and Counter markup in the server response, Counter's <link> before its markup; both hydrate", async ({
  page,
  request,
}) => {
  const res = await request.get(`${PAGES}/`)
  expect(res.status()).toBe(200)
  const html = markup(await res.text())
  const sheets = stylesheets(html)

  // The island: its HTML, behind its stylesheet, a plain React 18 link.
  const root = html.indexOf('data-nf-root')
  expect(root).toBeGreaterThan(-1)
  expect(html.indexOf('data-island="ProductPanel"')).toBeGreaterThan(root)
  const islandSheets = sheets.filter((s) => isIslandCss(s.href))
  expect(islandSheets).toHaveLength(1)
  expect(islandSheets[0]!.tag).toContain(`data-precedence="${PRECEDENCE}"`)
  expect(islandSheets[0]!.at).toBeLessThan(root)

  // Counter from c18, on the host's context, behind its stylesheet.
  const counter = html.indexOf('host=from-pages-react18-host build=c18')
  expect(counter).toBeGreaterThan(-1)
  expect(html).toContain('<p data-testid="rendered-build">c18</p>')
  const counterSheets = sheets.filter((s) =>
    isCounterCss(COMPONENTS_REACT18)(s.href)
  )
  expect(counterSheets).toHaveLength(1)
  expect(counterSheets[0]!.tag).toContain(`data-precedence="${PRECEDENCE}"`)
  expect(counterSheets[0]!.at).toBeLessThan(counter)
  // No React 19 resource attribute leaks into React 18's HTML.
  expect(html).not.toMatch(/\sprecedence="/)
  expect(html).not.toContain('counter unavailable')

  // Both hydrate: the island goes live and keeps its server HTML, Counter
  // answers clicks from its server-rendered start.
  const { all, errors } = watch(page)
  await page.goto(`${PAGES}/`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  await expect(island(page)).toHaveCount(1)
  await expect(island(page)).toHaveCSS('border-top-width', '1px')
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  await expect(page.getByTestId('counter-text')).toHaveText(
    'host=from-pages-react18-host build=c18'
  )
  await expect(page.getByTestId('counter-btn')).toHaveText('count 1')
  await page.getByTestId('counter-btn').click()
  await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
  // Hydration added one head copy per stylesheet.
  const head = await headSheets(page)
  expect(head.filter(([href]) => isIslandCss(href))).toEqual([
    [islandSheets[0]!.href, PRECEDENCE, true],
  ])
  expect(
    head.filter(([href]) => isCounterCss(COMPONENTS_REACT18)(href))
  ).toEqual([[counterSheets[0]!.href, PRECEDENCE, true]])
  expect(errors, all.join('\n')).toEqual([])
})

test('Pages host on React 18: client navigation to an island page adds the head link before the island boots', async ({
  page,
}) => {
  // When each stylesheet link went into <head> (before the browser fetches it).
  await page.addInitScript(() => {
    const added: Array<{ href: string; at: number }> = []
    ;(window as unknown as { headLinks: typeof added }).headLinks = added
    const record = (parent: Node, node: Node) => {
      if (
        parent === document.head &&
        node instanceof HTMLLinkElement &&
        node.rel === 'stylesheet'
      ) {
        added.push({ href: node.href, at: performance.now() })
      }
    }
    const append = Node.prototype.appendChild
    Node.prototype.appendChild = function <T extends Node>(node: T): T {
      record(this, node)
      return append.call(this, node) as T
    }
    const insert = Node.prototype.insertBefore
    Node.prototype.insertBefore = function <T extends Node>(
      node: T,
      child: Node | null
    ): T {
      record(this, node)
      return insert.call(this, node, child) as T
    }
  })
  const { all, errors } = watch(page)
  await page.goto(`${PAGES}/start`)
  await expect(page.getByTestId('to-island')).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Survives a client navigation only (a full load starts a new window).
  await page.evaluate(() => {
    ;(window as { nfNoReload?: boolean }).nfNoReload = true
  })
  await page.getByTestId('to-island').click()
  await expect(page).toHaveURL(`${PAGES}/`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  expect(
    await page.evaluate(() => (window as { nfNoReload?: boolean }).nfNoReload)
  ).toBe(true)
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  await expect(island(page)).toHaveCSS('border-top-width', '1px')

  const timing = await page.evaluate((remote) => {
    const links = (
      window as unknown as { headLinks: Array<{ href: string; at: number }> }
    ).headLinks.filter((l) => l.href.startsWith(`${remote}/`))
    // Every JavaScript file of the island remote: the bootstrap and its imports.
    const scripts = performance
      .getEntriesByType('resource')
      .filter(
        (e) => e.name.startsWith(`${remote}/`) && /\.m?js(\?|$)/.test(e.name)
      )
      .map((e) => e.startTime)
    return { links, firstScript: Math.min(...scripts), scripts: scripts.length }
  }, REMOTE_A)
  expect(timing.links).toHaveLength(1)
  expect(isIslandCss(timing.links[0]!.href)).toBe(true)
  expect(timing.scripts).toBeGreaterThan(0)
  expect(timing.links[0]!.at).toBeLessThan(timing.firstScript)
  // The one head link for the island's stylesheet, as React 18 gets it.
  const head = await headSheets(page)
  expect(head.filter(([href]) => isIslandCss(href))).toEqual([
    [timing.links[0]!.href, PRECEDENCE, true],
  ])
  expect(errors, all.join('\n')).toEqual([])
})

test('SPA on React 18 (StrictMode): island boots once, Counter renders, one head link per stylesheet', async ({
  page,
}) => {
  const events = await recordIslandEvents(page)
  const { all, errors } = watch(page)
  await page.goto(`${SPA}/islands`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  await expect(island(page)).toHaveCount(1)
  await expect(page.getByTestId('live-roots')).toHaveText('1')
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  await expect(island(page)).toHaveCSS('border-top-width', '1px')
  // StrictMode mounted, unmounted and mounted again: still one root, booted once.
  await expect(page.getByTestId('live-roots')).toHaveText('1')
  expect(await events()).toEqual(['island:hydrate:a'])
  const islandHead = (await headSheets(page)).filter(([href]) =>
    isIslandCss(href)
  )
  expect(islandHead).toHaveLength(1)
  expect(islandHead[0]!.slice(1)).toEqual([PRECEDENCE, true])
  // The only island stylesheet link on the page is that head copy.
  await expect(
    page.locator(`link[rel="stylesheet"][href^="${REMOTE_A}/"]`)
  ).toHaveCount(1)

  // Counter from c18, rendered in the browser on React 18.
  await page.goto(`${SPA}/components`)
  await expect(page.getByTestId('counter-text')).toHaveText(
    'host=from-spa-react18-host build=c18'
  )
  await expect(page.getByTestId('counter-btn')).toHaveText('count 1')
  await page.getByTestId('counter-btn').click()
  await expect(page.getByTestId('counter-btn')).toHaveText('count 2')
  await expect(page.getByTestId('counter')).toHaveCount(1)
  const counterHead = (await headSheets(page)).filter(([href]) =>
    isCounterCss(COMPONENTS_REACT18)(href)
  )
  expect(counterHead).toHaveLength(1)
  expect(counterHead[0]!.slice(1)).toEqual([PRECEDENCE, true])
  await expect(
    page.locator(`link[rel="stylesheet"][href^="${COMPONENTS_REACT18}/"]`)
  ).toHaveCount(1)
  expect(errors, all.join('\n')).toEqual([])
})

test('SPA /shared?host=1 on React 18: the island boots on its own React 19', async ({
  page,
}) => {
  // The probe is in production remote builds only (dev remotes never share).
  test.skip(MODE !== 'prod', 'prod remotes only')
  const js: string[] = []
  page.on('response', (r) => {
    if (r.url().endsWith('.js')) js.push(r.url())
  })
  const { all, errors } = watch(page)
  await page.goto(`${SPA}/shared?host=1`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  // The host put its React 18.3.1 into the share scope...
  expect(
    await page.evaluate(
      () => (window as { __hostProvidedReact?: boolean }).__hostProvidedReact
    )
  ).toBe(true)
  // ...and the island, which needs exactly 19.3.1, evaluated its own copy.
  await expect(page.locator('[data-remote="a"]')).toHaveAttribute(
    'data-react-version',
    '19.3.1'
  )
  expect(
    await page.evaluate(
      () => (window as unknown as { __probeReact?: Probe }).__probeReact ?? {}
    )
  ).toEqual({
    react: ['19.3.1'],
    'react-dom': ['19.3.1'],
    'react-dom/client': ['19.3.1'],
  })
  expect(
    js.filter(
      (u) =>
        u.startsWith(`${REMOTE_A}/`) &&
        /\/assets\/react-[\w-]+\.js$/.test(new URL(u).pathname)
    )
  ).not.toEqual([])
  await island(page).getByTestId('counter').click()
  await expect(island(page).getByTestId('counter')).toHaveText('count 1')
  expect(errors, all.join('\n')).toEqual([])
})

test('the 19-only Counter build renders its fallback with NF-036 on both React 18 hosts', async ({
  page,
  request,
}) => {
  // One message (one log line) names the code, the range and the version.
  const refused = /NF-036.*"\^19\.0\.0".*18\.3\.1/

  // Pages host: the server renders the fallback, never Counter. Soft
  // assertions: a failure still reports the SPA's outcome below.
  const log = serverLog('host-pages-next15-react18', PORTS.hostPagesReact18)
  const logged = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  const before = logged().length
  const res = await request.get(`${PAGES}/nineteen`)
  expect(res.status()).toBe(200)
  const html = markup(await res.text())
  expect(html).toContain('<p data-testid="rendered-build">c1</p>')
  expect.soft(html).toContain('counter unavailable')
  expect.soft(html).not.toContain('host=from-pages-react18-host')
  await expect
    .soft(async () =>
      expect(
        logged()
          .slice(before)
          .split('\n')
          .filter((line) => refused.test(line))
      ).not.toEqual([])
    )
    .toPass({ timeout: 10_000 })
  // In the browser it stays on the fallback, without a render error.
  let seen = watch(page)
  await page.goto(`${PAGES}/nineteen`)
  await expect(page.getByTestId('rendered-build')).toHaveText('c1')
  await page.waitForLoadState('networkidle')
  await expect.soft(page.getByTestId('fallback')).toHaveCount(1)
  await expect.soft(page.getByTestId('fallback')).toBeVisible()
  await expect.soft(page.getByTestId('counter')).toHaveCount(0)
  expect(seen.all.filter((m) => m.startsWith('pageerror'))).toEqual([])

  // SPA: the browser refuses the load and renders the fallback.
  const descriptors: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/_nf/components.json')) descriptors.push(r.url())
  })
  seen = watch(page)
  await page.goto(`${SPA}/nineteen`)
  await expect(page.getByTestId('rendered-build')).toHaveText('c1')
  await page.waitForLoadState('networkidle')
  await expect
    .soft(async () =>
      expect(seen.all.filter((m) => refused.test(m))).not.toEqual([])
    )
    .toPass({ timeout: 15_000 })
  await expect.soft(page.getByTestId('fallback')).toHaveCount(1)
  await expect.soft(page.getByTestId('fallback')).toBeVisible()
  await expect.soft(page.getByTestId('counter')).toHaveCount(0)
  expect(seen.all.filter((m) => m.startsWith('pageerror'))).toEqual([])
  // The descriptor came from the 19-only build.
  expect(descriptors).toEqual([`${COMPONENTS_19}/_nf/components.json`])
})

test('no hydration warnings in any console', async ({ page }) => {
  const { all } = watch(page)
  const visits: Array<[string, () => Promise<void>]> = [
    [
      `${PAGES}/`,
      () => expect(page.locator('[data-nf-state="live"]')).toHaveCount(1),
    ],
    [
      `${PAGES}/start`,
      () => expect(page.getByTestId('to-island')).toBeVisible(),
    ],
    [
      `${PAGES}/nineteen`,
      () => expect(page.getByTestId('rendered-build')).toHaveText('c1'),
    ],
    [
      `${SPA}/islands`,
      () => expect(page.locator('[data-nf-state="live"]')).toHaveCount(1),
    ],
    [
      `${SPA}/components`,
      () => expect(page.getByTestId('counter-btn')).toBeVisible(),
    ],
    [
      `${SPA}/shared?host=1`,
      () => expect(page.locator('[data-nf-state="live"]')).toHaveCount(1),
    ],
    [
      `${SPA}/nineteen`,
      () => expect(page.getByTestId('rendered-build')).toHaveText('c1'),
    ],
  ]
  for (const [url, ready] of visits) {
    await page.goto(url)
    await ready()
    await page.waitForLoadState('networkidle')
  }
  // The client navigation too.
  await page.goto(`${PAGES}/start`)
  await page.waitForLoadState('networkidle')
  await page.getByTestId('to-island').click()
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(1)
  await page.waitForLoadState('networkidle')
  // Something was logged (a positive control), none of it about hydration.
  expect(all.length).toBeGreaterThan(0)
  expect(all.filter((m) => HYDRATION.test(m))).toEqual([])
})

test('Pages host on React 18: server rendering logs no useLayoutEffect warning (next dev)', async ({
  request,
}) => {
  // React prints this warning from development builds only.
  test.skip(MODE !== 'dev', 'next dev only')
  // A cold `next dev` can render the island's fallback once (NF-008).
  await warmUp(`${PAGES}/`, { ready: /data-nf-root/ })
  const log = serverLog('host-pages-next15-react18', PORTS.hostPagesReact18)
  const before = readFileSync(log, 'utf8').length
  const html = markup(await (await request.get(`${PAGES}/`)).text())
  // Both the island and Counter rendered on the server in this request.
  expect(html).toContain('data-nf-root')
  expect(html).toContain('host=from-pages-react18-host build=c18')
  // The request reached the log (Next logs each request under next dev,
  // the status in color).
  await expect
    .poll(() => readFileSync(log, 'utf8').slice(before), { timeout: 10_000 })
    .toMatch(/GET \/ \S*200\b/)
  expect(readFileSync(log, 'utf8')).not.toMatch(/useLayoutEffect/)
})
