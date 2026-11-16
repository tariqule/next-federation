// Island JS cost per remote, and how often island data appears in a Next
// host's HTML. Production remotes only, without the fixture's React probe:
//   NF_MEASURE=1 pnpm e2e:prod -- measure            (sharing on, the default)
//   NF_MEASURE=1 NF_SHARE=0 pnpm e2e:prod -- measure (sharing off)
// Each run records its own entry (`share: true` or `share: false`) in
// docs/measurements.json and keeps the other one. The budgets below fail the
// spec when exceeded, so a size regression is visible.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import {
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES,
  HOST_SPA,
  MODE,
  REMOTE_A,
  REMOTE_B,
} from './servers.ts'

test.skip(
  process.env.NF_MEASURE !== '1' || MODE !== 'prod',
  'needs NF_MEASURE=1 and NF_MODE=prod'
)

const SHARE = process.env.NF_SHARE !== '0'
const OUT = new URL('../../docs/measurements.json', import.meta.url)
const REMOTES = { a: REMOTE_A, b: REMOTE_B }
const FIRST_LIVE = { timeout: 30_000 }
const KB = 1024
/** Gzip budgets per remote origin (Task 24). */
const BUDGET = {
  /** A remote with its own React: unshared, or the first shared remote. */
  ownReact: 84 * KB,
  /** A further remote on the same React, or any remote on a host's React. */
  sharedReact: 30 * KB,
}

const kb = (n: number) => Math.round((n / KB) * 10) / 10
const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

type Js = { files: number; raw: number; gzip: number }
type Report = Record<string, unknown>
const report: Report = {}

/** JS bytes the browser downloads from each remote origin while `url` loads its islands. */
async function islandJs(page: Page, url: string, live: number) {
  const perRemote: Record<string, Js> = {}
  const pending: Promise<void>[] = []
  page.on('response', (r) => {
    const { origin, pathname } = new URL(r.url())
    const name = Object.entries(REMOTES).find(([, o]) => o === origin)?.[0]
    if (!name || !pathname.endsWith('.js')) return
    pending.push(
      r
        .body()
        .catch(() => Buffer.alloc(0))
        .then((body) => {
          const entry = (perRemote[name] ??= { files: 0, raw: 0, gzip: 0 })
          entry.files += 1
          entry.raw += body.length
          entry.gzip += gzipSync(body).length
        })
    )
  })
  await page.goto(url)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(
    live,
    FIRST_LIVE
  )
  await page.waitForLoadState('networkidle')
  await Promise.all(pending)
  return perRemote
}

const summary = (perRemote: Record<string, Js>) =>
  Object.fromEntries(
    Object.entries(perRemote)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, v]) => [
        name,
        { files: v.files, rawKB: kb(v.raw), gzipKB: kb(v.gzip) },
      ])
  )

/**
 * The budget for each remote: with sharing, one remote (the largest) brings
 * React and every other one reuses it; with a host-provided React none brings
 * it; without sharing each brings its own.
 */
function expectWithinBudget(perRemote: Record<string, Js>, hostReact: boolean) {
  const sizes = Object.values(perRemote)
    .map((v) => v.gzip)
    .sort((a, b) => b - a)
  expect(sizes.length).toBe(2)
  sizes.forEach((gzip, i) => {
    const limit =
      SHARE && (hostReact || i > 0) ? BUDGET.sharedReact : BUDGET.ownReact
    expect(gzip, `remote #${i + 1}: ${kb(gzip)} KB`).toBeLessThanOrEqual(limit)
  })
}

const JS_CASES = [
  { key: 'spa', url: `${HOST_SPA}/islands`, live: 2, hostReact: false },
  { key: 'appRouter', url: `${HOST_APP}/two`, live: 3, hostReact: false },
  { key: 'pagesRouter', url: `${HOST_PAGES}/two`, live: 3, hostReact: false },
  // The host provides its React (provideHostReact), a SPA and a Pages Router
  // host. It has no effect on `share: false` remotes.
  {
    key: 'spaHostReact',
    url: `${HOST_SPA}/shared?remotes=a,b&host=1`,
    live: 2,
    hostReact: true,
  },
  {
    key: 'pagesRouterHostReact',
    url: `${HOST_PAGES}/shared`,
    live: 2,
    hostReact: true,
  },
]

for (const c of JS_CASES) {
  test(`island JS per remote: ${c.key}`, async ({ page }) => {
    const perRemote = await islandJs(page, c.url, c.live)
    ;((report.islandJs ??= {}) as Report)[c.key] = summary(perRemote)
    expectWithinBudget(perRemote, c.hostReact)
  })
}

test('island data duplication in Next host pages', async ({ request }) => {
  const p = Buffer.from(JSON.stringify({ sku: 'A1' })).toString('base64url')
  const envelope = (await (
    await request.get(`${REMOTE_A}/_nf/island/ProductPanel?p=${p}`)
  ).json()) as { html: string; rscPayload: string }
  // In the island HTML (and so also in its RSC payload, which encodes the
  // same tree), and only in the RSC payload: a prop of the client Counter
  // that it never renders (fixture ProductPanel).
  const HTML_MARKER = 'nf-product-panel'
  const RSC_MARKER = 'nf-rsc-marker-A1'
  expect(count(envelope.html, HTML_MARKER)).toBe(1)
  expect(count(envelope.html, RSC_MARKER)).toBe(0)
  expect(count(envelope.rscPayload, RSC_MARKER)).toBe(1)
  const duplication: Report = {
    envelope: {
      htmlKB: kb(envelope.html.length),
      rscPayloadKB: kb(envelope.rscPayload.length),
    },
  }
  for (const [name, url] of [
    ['appRouter', `${HOST_APP}/`],
    ['appRouterCacheComponents', `${HOST_APP_CC}/`],
    ['pagesRouter', `${HOST_PAGES}/`],
  ] as const) {
    const html = await (await request.get(url)).text()
    const rscPayloadCopies = count(html, RSC_MARKER)
    duplication[name] = {
      documentKB: kb(html.length),
      htmlMarkerCopies: count(html, HTML_MARKER),
      rscPayloadCopies,
    }
    // The payload reaches the page exactly once (it must, for the island to
    // hydrate), and the island HTML at most three times: the DOM, the
    // envelope in the host's embedded data, and the payload's own tree.
    expect(rscPayloadCopies).toBe(1)
    expect(count(html, HTML_MARKER)).toBeLessThanOrEqual(3)
  }
  report.duplication = duplication
})

test.afterAll(() => {
  if (Object.keys(report).length === 0) return
  type Out = { runs?: Record<string, unknown> } & Record<string, unknown>
  const previous: Out = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as Out)
    : {}
  const runs = { ...previous.runs }
  runs[`share: ${SHARE}`] = {
    measuredAt: new Date().toISOString(),
    bundler: process.env.NF_BUNDLER === 'webpack' ? 'webpack' : 'turbopack',
    ...report,
  }
  const out = {
    about:
      'Written by test/e2e/measure.spec.ts. islandJs: JS downloaded per remote origin (gzip). duplication: copies of an island HTML marker and of an RSC-payload-only marker in each host document.',
    budgetsKB: {
      ownReact: BUDGET.ownReact / KB,
      sharedReact: BUDGET.sharedReact / KB,
    },
    runs,
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
})
