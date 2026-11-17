// Gate i (static pages with public islands) and gate g (revalidateIsland)
// through production Next hosts. Reads the `next build` logs the harness
// writes (servers.ts), so it runs only with NF_MODE=prod.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { FAKE_REMOTE, LOGS_DIR, PORTS, serverLog } from './servers.ts'
import { markup } from './lib/strip-scripts.ts'

const FAKE = FAKE_REMOTE
const buildLog = (port: number) =>
  readFileSync(join(LOGS_DIR, `host-app-${port}.build.log`), 'utf8')

test.skip(process.env.NF_MODE !== 'prod', 'production builds only')

for (const [name, port] of [
  ['legacy', PORTS.hostApp],
  ['cacheComponents', PORTS.hostAppCc],
] as const) {
  const url = `http://localhost:${port}`

  test(`${name}: a page with a public island is prerendered`, async ({
    request,
  }) => {
    const log = buildLog(port)
    expect(log).toMatch(/^[├└┌] [○●◐] \/static\b/m)
    // Private island: dynamic by design. With cacheComponents it is a dynamic
    // hole in a partial prerender (ruling 5).
    if (name === 'legacy') expect(log).toMatch(/^[├└┌] ƒ \/orders\b/m)
    else expect(log).toMatch(/^[├└┌] ◐ \/orders\b/m)
    const res = await request.get(`${url}/static`)
    expect(await res.text()).toContain('nf-product-panel') // island HTML is in the prerendered output
  })

  test(`${name}: the JWKS and token route is not prerendered at build`, async ({
    request,
  }) => {
    // A JWKS frozen at build would outlive a key rotation.
    expect(buildLog(port)).toMatch(
      /^[├└┌] ƒ \/api\/next-federation\/\[\.\.\.nf\]/m
    )
    const res = await request.get(`${url}/api/next-federation/jwks`)
    expect(res.headers()['x-nextjs-cache']).toBeUndefined()
    expect(res.headers()['x-nextjs-prerender']).toBeUndefined()
  })

  test(`${name}: revalidateIsland makes the next request pick up new remote content`, async ({
    request,
  }) => {
    const page = async () =>
      markup(await (await request.get(`${url}/reval`)).text())
    const revOf = (html: string) =>
      Number(/echo reval rev (\d+)/.exec(html)?.[1])
    // Start from a fresh entry: a background regeneration still in flight
    // when the tag is revalidated would store the old content as new (the
    // page is ISR with a 60 s island revalidate, and the suite runs longer).
    await expect
      .poll(
        async () =>
          (await request.get(`${url}/reval`)).headers()['x-nextjs-cache'],
        { timeout: 10_000, intervals: [250] }
      )
      .not.toBe('STALE')
    const before = revOf(await page())
    expect(before).toBeGreaterThan(0)
    const { rev } = (await (await request.post(`${FAKE}/_rev`)).json()) as {
      rev: number
    }
    expect(rev).toBeGreaterThan(before)
    // Still cached: the remote changed, the host has not been told.
    expect(revOf(await page())).toBe(before)
    const res = await request.post(`${url}/api/revalidate?remote=fake`)
    expect(res.status()).toBe(200)
    // The tag is expired once the handler's revalidation has been applied,
    // which Next finishes after the response is sent: allow a short window.
    await expect
      .poll(async () => revOf(await page()), {
        timeout: 5_000,
        intervals: [100],
      })
      .toBe(rev)
  })
}

// B1/B2 (validation round 3) and B5 (round 4): a static page with a public
// island must stay static through an island outage, regenerate on its
// revalidate time, answer client navigations (RSC) with 200, and keep the
// island's last good envelope while the remote fails (stale-if-error).
// `/flaky-static` and `/flaky-cold` revalidate their island every 2 s.

/** The page's cache state: never a partial prerender (`x-nextjs-postponed`). */
function staticState(res: APIResponse, what: string): string {
  const h = res.headers()
  const state = `${what}: ${res.status()} cache=${h['x-nextjs-cache']} postponed=${h['x-nextjs-postponed']} cache-control=${h['cache-control']}`
  expect(res.status(), state).toBe(200)
  expect(h['x-nextjs-postponed'], state).toBeUndefined()
  // MISS: rendered for this request and stored (still static).
  expect(['HIT', 'STALE', 'MISS'], state).toContain(h['x-nextjs-cache'])
  expect(h['cache-control'], state).toMatch(/^s-maxage=\d+/)
  return h['x-nextjs-cache']!
}

/** A client navigation's RSC request for the page answers 200. */
async function expectRsc(request: APIRequestContext, url: string) {
  const res = await request.get(`${url}?_rsc`, {
    headers: { RSC: '1' },
    maxRedirects: 0,
  })
  expect(res.status(), `RSC ${url}`).toBe(200)
}

const flakyRev = (html: string, id: string) =>
  Number(new RegExp(`flaky ${id} rev (\\d+)`).exec(html)?.[1])

const flakyRequests = async (request: APIRequestContext, id: string) =>
  (
    (await (await request.get(`${FAKE}/_stats`)).json()) as {
      requests: Record<string, number>
    }
  ).requests[`Flaky:${id}`] ?? 0

/** Polls until a regeneration ran in this server process (STALE, then HIT). */
async function regenerated(request: APIRequestContext, url: string) {
  let seenStale = false
  await expect
    .poll(
      async () => {
        const cache = staticState(await request.get(url), url)
        if (cache === 'STALE') seenStale = true
        return seenStale && cache === 'HIT'
      },
      { timeout: 20_000, intervals: [250] }
    )
    .toBe(true)
}

for (const [name, port] of [
  ['legacy', PORTS.hostApp],
  ['cacheComponents', PORTS.hostAppCc],
] as const) {
  const url = `http://localhost:${port}`

  test(`${name}: a public island page regenerates as static on its revalidate time, and its RSC requests answer 200`, async ({
    request,
  }) => {
    await request.post(`${FAKE}/_flaky?down=0`)
    const page = `${url}/flaky-static`
    expect(buildLog(port)).toMatch(/^[├└┌] ○ \/flaky-static\b/m)
    await regenerated(request, page)
    // And again: not a one-off.
    await regenerated(request, page)
    await expectRsc(request, page)
    await expectRsc(request, `${url}/`)
  })

  test(`${name}: an island outage at regeneration keeps the page static with the last good island (stale-if-error), then it refreshes`, async ({
    request,
  }) => {
    const page = `${url}/flaky-static`
    const html = async () => {
      const res = await request.get(page)
      staticState(res, page)
      return markup(await res.text())
    }
    try {
      await request.post(`${FAKE}/_flaky?down=0`)
      await regenerated(request, page)
      const good = flakyRev(await html(), 'isr')
      expect(good).toBeGreaterThan(0)
      const fetchedBefore = await flakyRequests(request, 'isr')
      await request.post(`${FAKE}/_flaky?down=1`)
      // Several regenerations while the remote fails: every response is the
      // static page with the last good island, never the fallback.
      const until = Date.now() + 8_000
      while (Date.now() < until) {
        const down = await html()
        expect(down).toContain(`flaky isr rev ${good}`)
        expect(down).not.toContain('flaky unavailable')
        await new Promise((r) => setTimeout(r, 400))
      }
      await expectRsc(request, page)
      // The regenerations did reach the (failing) remote.
      expect(await flakyRequests(request, 'isr')).toBeGreaterThan(fetchedBefore)
      if (name === 'cacheComponents') {
        const log = readFileSync(serverLog('host-app', port), 'utf8')
        expect(log).toMatch(
          /NF-007: .*Island "Flaky" from remote "fake" failed at \S+\/_nf\/island\/Flaky \(HTTP 503\); rendering its last good envelope \(\d+ s old\)/
        )
      }
      // Recovery: the next regenerations pick up the remote's new content.
      const { rev } = (await (await request.post(`${FAKE}/_rev`)).json()) as {
        rev: number
      }
      await request.post(`${FAKE}/_flaky?down=0`)
      await expect
        .poll(async () => flakyRev(await html(), 'isr'), {
          timeout: 20_000,
          intervals: [500],
        })
        .toBe(rev)
      await regenerated(request, page)
      await expectRsc(request, page)
    } finally {
      await request.post(`${FAKE}/_flaky?down=0`)
    }
  })

  test(`${name}: an outage with no good envelope in this process: static with the fallback, regenerated within seconds`, async ({
    request,
  }) => {
    const page = `${url}/flaky-cold`
    const html = async () => {
      const res = await request.get(page)
      staticState(res, page)
      return markup(await res.text())
    }
    try {
      // Down before this process ever fetched the island: the first
      // regeneration has nothing to keep.
      await request.post(`${FAKE}/_flaky?down=1`)
      await expect
        .poll(html, { timeout: 20_000, intervals: [500] })
        .toContain('flaky unavailable')
      await expectRsc(request, page)
      await request.post(`${FAKE}/_flaky?down=0`)
      await expect
        .poll(html, { timeout: 20_000, intervals: [500] })
        .toContain('flaky cold rev')
      await regenerated(request, page)
    } finally {
      await request.post(`${FAKE}/_flaky?down=0`)
    }
  })
}

test('Pages Router ISR: a failed regeneration keeps the last good island (`stale: true`), then it refreshes', async ({
  request,
}) => {
  const page = `http://localhost:${PORTS.hostPages}/flaky-isr`
  const html = async () => {
    const res = await request.get(page)
    staticState(res, page)
    return markup(await res.text())
  }
  try {
    await request.post(`${FAKE}/_flaky?down=0`)
    await regenerated(request, page)
    const good = flakyRev(await html(), 'pages')
    expect(good).toBeGreaterThan(0)
    const fetchedBefore = await flakyRequests(request, 'pages')
    await request.post(`${FAKE}/_flaky?down=1`)
    const until = Date.now() + 6_000
    while (Date.now() < until) {
      const down = await html()
      expect(down).toContain(`flaky pages rev ${good}`)
      expect(down).not.toContain('flaky unavailable')
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(await flakyRequests(request, 'pages')).toBeGreaterThan(fetchedBefore)
    const { rev } = (await (await request.post(`${FAKE}/_rev`)).json()) as {
      rev: number
    }
    await request.post(`${FAKE}/_flaky?down=0`)
    await expect
      .poll(async () => flakyRev(await html(), 'pages'), {
        timeout: 20_000,
        intervals: [500],
      })
      .toBe(rev)
  } finally {
    await request.post(`${FAKE}/_flaky?down=0`)
  }
})
