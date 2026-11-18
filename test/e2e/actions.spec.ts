// Island Server Actions in every host: App Router (cacheComponents
// off and on), Pages Router (with and without basePath) and the SPA.
import { expect, test } from '@playwright/test'
import type { Locator, Page, Request } from '@playwright/test'
import { decodeJwt } from 'jose'
import {
  HOST_APP,
  HOST_APP_CC,
  HOST_PAGES,
  HOST_PAGES_BASE,
  HOST_SPA,
  ISSUER,
  MODE,
  REMOTE_A,
  REMOTE_B,
} from './servers.ts'

type Host = {
  name: string
  /** The /actions page for a signed-in `sub` (or signed out). */
  url: (sub?: string) => string
  /** Next hosts sign in with the `nf-user` cookie; the SPA passes `sub` in the URL. */
  next: boolean
}
const nextHost = (name: string, base: string): Host => ({
  name,
  url: () => `${base}/actions`,
  next: true,
})
const HOSTS: Host[] = [
  nextHost('App Router', HOST_APP),
  nextHost('App Router cacheComponents', HOST_APP_CC),
  nextHost('Pages Router', HOST_PAGES),
  nextHost('Pages Router basePath', `${HOST_PAGES_BASE}/base`),
  {
    name: 'SPA',
    url: (sub) => `${HOST_SPA}/actions${sub ? `?sub=${sub}` : ''}`,
    next: false,
  },
]

async function signIn(page: Page, host: Host, sub: string | undefined) {
  if (host.next && sub) {
    await page
      .context()
      .addCookies([{ name: 'nf-user', value: sub, url: 'http://localhost' }])
  }
}

const isAction = (r: Request) =>
  new URL(r.url()).pathname.endsWith('/_nf/action')

function actionRequests(page: Page): Request[] {
  const seen: Request[] = []
  page.on('request', (r) => {
    if (isAction(r) && r.method() === 'POST') seen.push(r)
  })
  return seen
}

const mount = (page: Page, key: string) => page.getByTestId(`mount-${key}`)
const result = (m: Locator, name: string) => m.getByTestId(`result-${name}`)
const errorOf = (m: Locator, name: string) => m.getByTestId(`error-${name}`)

async function live(page: Page, count = 3) {
  await expect(
    page.locator('[data-nf-root][data-nf-state="live"]')
  ).toHaveCount(count, { timeout: MODE === 'dev' ? 90_000 : 30_000 })
}

async function open(page: Page, host: Host, sub?: string, count = 3) {
  await signIn(page, host, sub)
  await page.goto(host.url(sub))
  await live(page, count)
}

/** Runs one action from its button and waits for its result to commit. */
async function run(m: Locator, name: string) {
  const out = result(m, name)
  const before = Number((await out.getAttribute('data-calls')) ?? '0')
  await m.getByTestId(`submit-${name}`).click()
  await expect(out).toHaveAttribute('data-calls', String(before + 1))
}

for (const host of HOSTS) {
  test.describe(host.name, () => {
    // Dev hosts compile pages on first request (webpack is slow).
    test.describe.configure({ timeout: 120_000 })
    test('Enter before hydration is blocked; after hydration one click is one action', async ({
      page,
    }) => {
      const actions = actionRequests(page)
      const documentPosts: string[] = []
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.resourceType() === 'document')
          documentPosts.push(r.url())
      })
      // Hold every remote module load: the islands stay server-rendered only.
      const held: (() => Promise<void>)[] = []
      let holding = true
      await page.route(
        (url) =>
          (url.origin === REMOTE_A || url.origin === REMOTE_B) &&
          !url.pathname.includes('/_nf/'),
        (route) => {
          if (holding) held.push(() => route.continue())
          else void route.continue()
        }
      )
      await signIn(page, host, 'alice')
      await page.goto(host.url('alice'), { waitUntil: 'domcontentloaded' })
      // Server HTML only: the button is disabled through its <fieldset disabled>.
      const button = mount(page, 'a1').getByTestId('submit-add')
      await expect(button).toBeDisabled({ timeout: 30_000 })
      await expect(page.locator('[data-nf-state="live"]')).toHaveCount(0)
      await page.keyboard.press('Enter')
      // Tab never lands in an island (its fields are disabled). Enter on a
      // host link would be the host's own navigation, so it is pressed only
      // while nothing is focused.
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab')
        const inIsland = await page.evaluate(
          () => document.activeElement?.closest('[data-nf-root]') != null
        )
        expect(inIsland).toBe(false)
        const onBody = await page.evaluate(
          () => document.activeElement === document.body
        )
        if (onBody) await page.keyboard.press('Enter')
      }
      await mount(page, 'a1')
        .getByTestId('submit-add')
        .click({ force: true })
        .catch(() => {})
      await page.waitForTimeout(500)
      expect(actions).toHaveLength(0)
      expect(documentPosts).toEqual([])
      expect(new URL(page.url()).pathname).toMatch(/\/actions$/)

      holding = false
      for (const release of held.splice(0)) await release()
      await live(page)
      await run(mount(page, 'a1'), 'add')
      expect(await result(mount(page, 'a1'), 'add').textContent()).toContain(
        '"count"'
      )
      // Nothing queued before hydration fires late: still exactly one.
      await page.waitForTimeout(500)
      expect(actions).toHaveLength(1)
      await expect(result(mount(page, 'a1'), 'add')).toHaveAttribute(
        'data-calls',
        '1'
      )
    })

    test('a cached page acts as the current user, per browser context (D2)', async ({
      browser,
    }) => {
      for (const sub of ['alice', 'bob']) {
        const context = await browser.newContext()
        const page = await context.newPage()
        await open(page, host, sub)
        await run(mount(page, 'a1'), 'whoami')
        await expect(result(mount(page, 'a1'), 'whoami')).toContainText(
          `"sub":"${sub}"`
        )
        await context.close()
      }
    })

    test('D2: the page itself is static, the same bytes for every user', async ({
      page,
    }) => {
      test.skip(!host.next || MODE !== 'prod', 'prod Next hosts')
      const fetchAs = async (sub: string) => {
        const res = await page.request.get(host.url(), {
          headers: { cookie: `nf-user=${sub}` },
        })
        expect(res.status()).toBe(200)
        return { headers: res.headers(), body: await res.text() }
      }
      // Warm the cache (ISR / prerender), then compare two users.
      await fetchAs('warm')
      const alice = await fetchAs('alice')
      const bob = await fetchAs('bob')
      expect(alice.body).toBe(bob.body)
      for (const { headers } of [alice, bob]) {
        const cache = headers['x-nextjs-cache'] ?? ''
        const prerender = headers['x-nextjs-prerender'] ?? ''
        expect(
          /HIT|STALE/.test(cache) || prerender === '1',
          `x-nextjs-cache=${cache} x-nextjs-prerender=${prerender}`
        ).toBe(true)
        expect(headers['cache-control'] ?? '').not.toMatch(/private|no-store/)
      }
    })

    test('D2: switching user in one tab, the next action acts as the new user', async ({
      page,
    }) => {
      test.skip(!host.next, 'Next hosts sign in with a cookie')
      await open(page, host, 'alice')
      await run(mount(page, 'a1'), 'whoami')
      await expect(result(mount(page, 'a1'), 'whoami')).toContainText(
        '"sub":"alice"'
      )
      await page
        .context()
        .addCookies([
          { name: 'nf-user', value: 'bob', url: 'http://localhost' },
        ])
      await run(mount(page, 'a1'), 'whoami')
      await expect(result(mount(page, 'a1'), 'whoami')).toContainText(
        '"sub":"bob"'
      )
    })

    test('requests carry the bearer, never a cookie, even when the remote set one', async ({
      page,
    }) => {
      await page.context().addCookies([
        { name: 'remote-session', value: 'leak', url: REMOTE_A },
        { name: 'remote-session', value: 'leak', url: REMOTE_B },
      ])
      const actions = actionRequests(page)
      await open(page, host, 'alice')
      await run(mount(page, 'a1'), 'whoami')
      const headers = await actions[0]!.allHeaders()
      expect(headers.cookie).toBeUndefined()
      expect(headers.authorization).toMatch(/^Bearer ey/)
      expect(decodeJwt(headers.authorization!.slice(7)).aud).toBe('a')
    })

    test('two remotes and two mounts never cross', async ({ page }) => {
      const actions = actionRequests(page)
      await open(page, host, 'alice')
      for (const key of ['a1', 'a2', 'b']) await run(mount(page, key), 'add')
      expect(actions.map((r) => new URL(r.url()).origin)).toEqual([
        REMOTE_A,
        REMOTE_A,
        REMOTE_B,
      ])
      const tokens = await Promise.all(
        actions.map(async (r) => (await r.allHeaders()).authorization ?? '')
      )
      expect(tokens.map((t) => decodeJwt(t.slice(7)).aud)).toEqual([
        'a',
        'a',
        'b',
      ])
      // Each result landed in its own island only.
      for (const key of ['a1', 'a2', 'b']) {
        await expect(result(mount(page, key), 'add')).toHaveAttribute(
          'data-calls',
          '1'
        )
        await expect(result(mount(page, key), 'whoami')).toHaveText('')
      }
    })

    test('requireIdentity: refused signed out, runs signed in', async ({
      browser,
    }) => {
      const out = await browser.newContext()
      const signedOut = await out.newPage()
      // A signed-out visitor is not an error at the host's token endpoint:
      // 200 { token: null }, never a 401 (which browsers log as an error).
      const tokenStatuses: number[] = []
      signedOut.on('response', (r) => {
        if (new URL(r.url()).pathname.endsWith('/api/next-federation/token'))
          tokenStatuses.push(r.status())
      })
      await open(signedOut, host)
      await run(mount(signedOut, 'a1'), 'order')
      await expect(errorOf(mount(signedOut, 'a1'), 'order')).toContainText(
        'NF-014'
      )
      if (host.next) {
        expect(tokenStatuses.length).toBeGreaterThan(0)
        expect(new Set(tokenStatuses)).toEqual(new Set([200]))
      }
      await out.close()
      const inCtx = await browser.newContext()
      const signedIn = await inCtx.newPage()
      await open(signedIn, host, 'carol')
      await run(mount(signedIn, 'a1'), 'order')
      await expect(result(mount(signedIn, 'a1'), 'order')).toHaveText(
        'order A1 for carol'
      )
      await inCtx.close()
    })

    test(`errors are ${MODE === 'prod' ? 'redacted' : 'shown'} and an action outside the root works`, async ({
      page,
    }) => {
      const actions = actionRequests(page)
      await open(page, host, 'alice')
      await run(mount(page, 'a1'), 'failing')
      const error = errorOf(mount(page, 'a1'), 'failing')
      await expect(error).not.toHaveText('')
      if (MODE === 'prod')
        await expect(error).not.toContainText('fixture secret detail')
      else await expect(error).toContainText('fixture secret detail')
      await run(mount(page, 'a1'), 'ping')
      await expect(result(mount(page, 'a1'), 'ping')).toHaveText('pong')
      // Dev ids of files outside the root (here through a symlink) are /@fs/ paths.
      const id = (await actions.at(-1)!.allHeaders())['x-nf-action']!
      if (MODE === 'dev')
        expect(id).toMatch(/^\/@fs\/.*island-remote-shared\/ping\.ts#ping$/)
    })
  })
}

test.describe('SPA token edge cases', () => {
  test('a token for another audience: one retry, then NF-014 (exactly 2 requests)', async ({
    page,
  }) => {
    const actions = actionRequests(page)
    await page.goto(`${HOST_SPA}/actions?sub=alice&aud=b`)
    await live(page)
    await run(mount(page, 'a1'), 'whoami')
    await expect(errorOf(mount(page, 'a1'), 'whoami')).toContainText('NF-014')
    expect(actions).toHaveLength(2)
    const events = await page.evaluate(
      () =>
        (
          window as { testIslandEvents?: { type: string }[] }
        ).testIslandEvents?.filter((e) => e.type === 'island:action') ?? []
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'island:action',
        ok: false,
        status: 401,
        code: 'NF-014',
        retried: true,
      }),
    ])
  })
})

test.describe('SPA token retry', () => {
  test('a 401 for a foreign-audience token: one retry with a fresh token succeeds', async ({
    page,
  }) => {
    const tokenRequests: string[] = []
    page.on('request', (r) => {
      if (r.url().startsWith(`${ISSUER}/token`)) tokenRequests.push(r.url())
    })
    const actions = actionRequests(page)
    const foreign = await (
      await page.request.get(`${ISSUER}/mint?aud=b&sub=alice`)
    ).text()
    let swapped = false
    await page.route(
      (url) => url.origin === REMOTE_A && url.pathname.endsWith('/_nf/action'),
      async (route) => {
        if (swapped || route.request().method() !== 'POST')
          return route.continue()
        swapped = true
        // The first action's bearer is replaced by a token for another remote.
        await route.continue({
          headers: {
            ...route.request().headers(),
            authorization: `Bearer ${foreign}`,
          },
        })
      }
    )
    await page.goto(`${HOST_SPA}/actions?sub=alice`)
    await live(page)
    await run(mount(page, 'a1'), 'whoami')
    await expect(result(mount(page, 'a1'), 'whoami')).toContainText(
      '"sub":"alice"'
    )
    await expect(errorOf(mount(page, 'a1'), 'whoami')).toHaveText('')
    expect(actions).toHaveLength(2)
    expect(tokenRequests).toHaveLength(2)
    const events = await page.evaluate(
      () =>
        (
          window as { testIslandEvents?: { type: string }[] }
        ).testIslandEvents?.filter((e) => e.type === 'island:action') ?? []
    )
    expect(events).toEqual([
      expect.objectContaining({ ok: true, status: 200, retried: true }),
    ])
  })
})

test.describe('private island token refresh', () => {
  test('a token is reused, then refreshed after 280 s (page clock)', async ({
    page,
  }) => {
    await page.clock.install()
    const tokenFetches: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.endsWith('/api/next-federation/token'))
        tokenFetches.push(r.url())
    })
    await page
      .context()
      .addCookies([{ name: 'nf-user', value: 'dave', url: 'http://localhost' }])
    await page.goto(`${HOST_APP}/orders`)
    await live(page, 1)
    const orders = page.locator('[data-island="MyOrders"]')
    await run(orders, 'whoami')
    await run(orders, 'whoami')
    expect(tokenFetches).toHaveLength(1)
    await page.clock.fastForward('04:40')
    await run(orders, 'whoami')
    expect(tokenFetches).toHaveLength(2)
    await expect(result(orders, 'whoami')).toContainText('"sub":"dave"')
  })
})

test.describe('action endpoint over HTTP', () => {
  const post = (page: Page, url: string, id: string, body = '[]') =>
    page.request.post(url, {
      headers: {
        origin: HOST_APP,
        'x-nf-action': id,
        'content-type': 'text/plain;charset=UTF-8',
      },
      data: body,
    })

  async function whoamiId(page: Page): Promise<string> {
    const actions = actionRequests(page)
    await open(page, nextHost('App Router', HOST_APP), 'alice')
    await run(mount(page, 'a1'), 'whoami')
    return (await actions[0]!.allHeaders())['x-nf-action']!
  }

  test('ids that are not Server Actions are 404 NF-031, with CORS', async ({
    page,
  }) => {
    const id = await whoamiId(page)
    const file = id.split('#')[0]!
    const ids = [
      // A name the 'use server' module does not export. (An exported value
      // that is not an async function cannot exist there: plugin-rsc refuses
      // to build it.)
      `${file}#notExported`,
      // An exported function of a plain module: not a server reference.
      '/src/data.ts#getProduct',
    ]
    for (const bad of ids) {
      const res = await post(page, `${REMOTE_A}/_nf/action`, bad)
      expect(res.status(), bad).toBe(404)
      expect(await res.json()).toEqual({ error: 'NF-031' })
      expect(res.headers()['access-control-allow-origin']).toBe(HOST_APP)
    }
  })

  test('an id naming a non-action module is refused before that module is imported', async ({
    page,
  }) => {
    const id = await whoamiId(page)
    const res = await post(
      page,
      `${REMOTE_A}/_nf/action`,
      '/src/side-effect.ts#poke'
    )
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'NF-031' })
    // whoami reports how often src/side-effect.ts was imported on the remote.
    const who = await post(page, `${REMOTE_A}/_nf/action`, id)
    expect(who.status()).toBe(200)
    expect(await who.text()).toContain('"sideEffects":0')
  })

  test("413s are readable by the browser: the build's limit and nf-serve's ceiling", async ({
    page,
  }) => {
    await page.goto(HOST_APP)
    const corsOf = new Map<number, string | null>()
    page.on('response', (r) => {
      if (r.url() === `${REMOTE_A}/_nf/action` && r.status() === 413) {
        const size = Number(r.request().postDataBuffer()?.length ?? 0)
        corsOf.set(
          Math.round(size / (1024 * 1024)),
          r.headers()['access-control-allow-origin'] ?? null
        )
      }
    })
    // 2 MiB: over the build's 1 MiB limit, answered by the build (CORS echoes
    // the origin). 9 MiB (prod): over nf-serve's 8 MiB ceiling, answered by
    // nf-serve itself (`*`). nf-serve answers before reading the body; Chromium
    // still reads that response here, so the check stays strict (no reset
    // tolerated).
    const sizes = MODE === 'prod' ? [2, 9] : [2]
    for (const mib of sizes) {
      const status = await page.evaluate(
        async ({ url, mib }) => {
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'x-nf-action': 'x#y',
                'content-type': 'text/plain;charset=UTF-8',
              },
              body: 'x'.repeat(mib * 1024 * 1024),
              credentials: 'omit',
            })
            return res.status
          } catch (e) {
            return String(e)
          }
        },
        { url: `${REMOTE_A}/_nf/action`, mib }
      )
      expect(status, `${mib} MiB`).toBe(413)
    }
    await expect.poll(() => corsOf.size).toBe(sizes.length)
    expect(corsOf.get(2)).toBe(HOST_APP)
    if (MODE === 'prod') expect(corsOf.get(9)).toBe('*')
  })

  test('dev: a client import of a "use server" file is NF-034', async ({
    page,
  }) => {
    test.skip(MODE !== 'dev', 'vite dev only')
    // Vite sends the error to the HMR clients connected to remote a, and keeps
    // it for the next one to connect when there are none: without this page,
    // the next test's page would open under its error overlay.
    await open(page, nextHost('App Router', HOST_APP), 'alice')
    const res = await page.request.get(`${REMOTE_A}/src/actions.ts`)
    expect(res.status()).toBe(500)
    expect(await res.text()).toContain('NF-034')
    await expect(page.locator('vite-error-overlay')).toContainText('NF-034')
  })
})
