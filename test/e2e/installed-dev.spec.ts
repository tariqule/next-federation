// next-federation installed the way an app gets it (packed tarballs in a real
// node_modules, fixtures/installed-host.ts), on Next 15 and Next 16, with
// Next's default dev source maps and with `next dev --disable-source-maps`.
//
// Under `next dev` React sends its development debug info to the browser:
// Next 15 inlines it in the HTML, Next 16 sends it over the dev server's
// websocket. The test first proves that this debug info arrived (a positive
// control, so it cannot pass by seeing nothing), then that a server-rendered
// private island put no identity token, cookie or request header into it or
// into any HTTP response. Next's dev tooling leaves code under node_modules
// out of React's debug info, as long as Node's source maps are on; a
// workspace-linked library is not left out (NF-037, docs/guides/limits.md),
// which is why the linked fixtures in next15.spec.ts skip this check under
// `next dev`. Run with NF_SUITE=installed NF_MODE=dev.
import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { warmUp } from './lib/warm-up.ts'
import { INSTALLED_HOSTS, INSTALLED_NEXT, SUITE } from './servers.ts'

test.skip(SUITE !== 'installed', 'NF_SUITE=installed only')

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/
const CONTENT = /Orders for (<!-- -->)?user-1/
/** React's debug rows for a Server Component (as JSON, or JSON in a JS string). */
const DEBUG_ROW = /\\?"env\\?":\\?"Server\\?"/
/**
 * Next 16's binary HMR message for React debug chunks (createBinaryHmrMessageData):
 * byte 0 is the type (0), byte 1 the request id's length, then the id, then
 * the chunk. A request's last message has no chunk (`chunk: null`), so it is
 * exactly 2 + id length bytes long.
 */
const REACT_DEBUG_CHUNK = 0

// Every host is a freshly started `next dev`: its first request to /orders
// compiles the page, and remote `a`'s dev server compiles the island, while
// the host's 3 s island timeout runs, so a cold host can render the
// fallback once (NF-008). Warm each host first, outside the browser, as a
// different user than the test's: the test still makes and inspects every
// request it asserts on, and starts with no state for its user. The result
// is ignored; a host that stays cold fails the assertions below.
test.beforeAll(async () => {
  test.setTimeout(90_000)
  await Promise.all(
    INSTALLED_HOSTS.map(async (host) => {
      const url = `http://localhost:${host.port}`
      await warmUp(`${url}/orders`, {
        headers: { cookie: 'nf-user=warm-up' },
        ready: /Orders for (<!-- -->)?warm-up/,
      })
      // The page the test navigates to and back from.
      await warmUp(`${url}/`, { ready: /Installed-library host/ })
    })
  )
})

for (const host of INSTALLED_HOSTS) {
  const url = `http://localhost:${host.port}`
  const name = `Next ${host.major}${host.flags ? ` ${host.flags}` : ''}`

  test(`${name} (installed library): a private island is server-rendered and nothing about the request reaches the browser`, async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const cookieCanary = `cc${randomBytes(8).toString('hex')}`
    const headerCanary = `hc${randomBytes(8).toString('hex')}`
    const authCanary = `ac${randomBytes(8).toString('hex')}`
    const leaks = (text: string): string[] =>
      [
        JWT.test(text) && 'an identity token',
        text.includes(cookieCanary) && 'the canary cookie',
        text.includes('nf-user') && 'the nf-user cookie',
        text.includes(headerCanary) && 'the canary header',
        text.includes(authCanary) && 'the Authorization header',
      ].filter((x): x is string => typeof x === 'string')

    const context = await browser.newContext()
    await context.addCookies([
      { name: 'nf-user', value: 'user-1', url },
      { name: 'nf-canary', value: cookieCanary, url },
    ])
    const page = await context.newPage()
    // The extra headers go to the host only (the remote's CORS is not under test).
    await page.route(`${url}/**`, (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          'x-nf-canary': headerCanary,
          authorization: `Bearer ${authCanary}`,
        },
      })
    )
    const found: string[] = []
    const reads: Promise<void>[] = []
    // Per React request id (the document's is the HMR socket's `id`): debug
    // chunks with Server Component rows seen, and whether the closing frame
    // arrived.
    const withRows = new Set<string>()
    const opened = new Set<string>()
    const closed = new Set<string>()
    let documentId: string | null = null
    page.on('response', (r) => {
      const u = r.url()
      // The token endpoint answers with a token by design.
      if (!u.startsWith(url) || u.includes('/api/next-federation/token')) return
      reads.push(
        r.body().then(
          (b) => {
            for (const what of leaks(b.toString('latin1')))
              found.push(`${what} in ${u}`)
          },
          () => {}
        )
      )
    })
    page.on('websocket', (ws) => {
      documentId ??= new URL(ws.url()).searchParams.get('id')
      ws.on('framereceived', (f) => {
        const binary = typeof f.payload !== 'string'
        const text = binary
          ? Buffer.from(f.payload).toString('latin1')
          : (f.payload as string)
        if (binary) {
          const bytes = f.payload as Buffer
          if (bytes[0] === REACT_DEBUG_CHUNK && bytes.length >= 2) {
            const end = 2 + bytes[1]!
            const id = bytes.subarray(2, end).toString('utf8')
            if (bytes.length === end) closed.add(id)
            else {
              opened.add(id)
              if (DEBUG_ROW.test(text)) withRows.add(id)
            }
          }
        }
        for (const what of leaks(text))
          found.push(`${what} in websocket ${ws.url()}`)
      })
    })

    const res = await page.goto(`${url}/orders`)
    const html = await res!.text()
    // Server-rendered, by the version under test.
    expect(html).toMatch(CONTENT)
    expect(
      await page.evaluate(
        () => (window as { next?: { version?: string } }).next?.version
      )
    ).toBe(INSTALLED_NEXT[host.major])
    await expect(page.getByText('Orders for user-1')).toBeVisible()
    // Positive control: React's debug info for this page reached the browser.
    if (host.major === 15) {
      expect(html, 'debug rows inlined in the HTML').toMatch(DEBUG_ROW)
    } else {
      // All of the document's debug info, up to its closing frame (the
      // island renders in Suspense, so its rows come last).
      await expect
        .poll(
          () =>
            documentId !== null &&
            withRows.has(documentId) &&
            closed.has(documentId),
          {
            message:
              "the document's React debug chunks and their closing frame over the HMR websocket",
            timeout: 20_000,
          }
        )
        .toBe(true)
    }
    // A client navigation back to the page (an RSC request).
    await page.getByRole('link', { name: 'home' }).click()
    await expect(page).toHaveURL(`${url}/`)
    await page.getByRole('link', { name: 'orders' }).click()
    await expect(page.getByText('Orders for user-1')).toBeVisible()
    await page.waitForLoadState('networkidle')
    // Every React request that sent debug chunks (the navigation's too) has
    // finished sending them.
    await expect
      .poll(() => [...opened].filter((id) => !closed.has(id)), {
        message: 'closing frames for every React debug stream',
        timeout: 20_000,
      })
      .toEqual([])
    await Promise.all(reads)
    expect(found).toEqual([])
    await context.close()
  })
}
