// Gate i (static pages with public islands) and gate g (revalidateIsland)
// through production Next hosts. Reads the `next build` logs the harness
// writes (servers.ts), so it runs only with NF_MODE=prod.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { FAKE_REMOTE, HOST_APP_CC, LOGS_DIR, PORTS } from './servers.ts'
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

test('cacheComponents: a static route whose remote is down at revalidation regenerates as a partial prerender', async ({
  request,
}) => {
  const url = `${HOST_APP_CC}/flaky-static`
  const page = async () => markup(await (await request.get(url)).text())
  expect(buildLog(PORTS.hostAppCc)).toMatch(/^[├└┌] [○◐] \/flaky-static\b/m)
  try {
    // Built while the remote was up: the island is in the static output.
    expect(await page()).toContain('flaky isr rev')
    await request.post(`${FAKE}/_flaky?down=1`)
    // The island revalidates every 2 s. After the next regeneration the
    // failure is a dynamic hole: the shell carries the Suspense fallback and
    // the error fallback is streamed into it per request.
    await expect
      .poll(page, { timeout: 20_000, intervals: [1000] })
      .toContain('flaky unavailable')
    const down = await page()
    expect(down).toContain('loading flaky…')
    expect(down).not.toContain('flaky isr rev')
    // Not frozen: the next requests pick the remote up again.
    await request.post(`${FAKE}/_flaky?down=0`)
    await expect
      .poll(page, { timeout: 20_000, intervals: [1000] })
      .toContain('flaky isr rev')
  } finally {
    await request.post(`${FAKE}/_flaky?down=0`)
  }
})
