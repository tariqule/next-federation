import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { HOST_APP, ISSUER, MODE, REMOTE_A } from './servers.ts'

const A = REMOTE_A
const HOST = HOST_APP
const p = (props: unknown) =>
  Buffer.from(JSON.stringify(props)).toString('base64url')
const productPanel = `${A}/_nf/island/ProductPanel?p=${p({ sku: 'A1' })}`

const mint = async (request: APIRequestContext, query: string) =>
  (await request.get(`${ISSUER}/mint?${query}`)).text()

test.describe('island remote protocol endpoint', () => {
  test('serves a v1 envelope with SSR html, css and an absolute bootstrap URL', async ({
    request,
  }) => {
    const res = await request.get(productPanel, { headers: { Origin: HOST } })
    expect(res.status()).toBe(200)
    expect(res.headers()['access-control-allow-origin']).toBe(HOST)
    expect(res.headers()['vary']).toContain('Origin')
    const env = await res.json()
    expect(env.protocolVersion).toBe(1)
    expect(env.remote).toBe('a')
    expect(env.html).toContain('Product A1')
    expect(env.html).toContain('data-testid="counter"')
    expect(env.rscPayload.length).toBeGreaterThan(0)
    expect(env.css.length).toBeGreaterThanOrEqual(1)
    for (const href of env.css) expect(href.startsWith(`${A}/`)).toBe(true)
    // Islands never emit hoistables.
    expect(env.html).not.toContain('<link')
    expect(env.bootstrap.startsWith(`${A}/`)).toBe(true)
    expect(env.idPlaceholder).toMatch(/^nfid-[0-9a-f]{8}-$/)
    expect(typeof env.buildId).toBe('string')
  })

  test('envelope mode matches how the remote was started', async ({
    request,
  }) => {
    const env = await (await request.get(productPanel)).json()
    expect(env.mode).toBe(MODE === 'prod' ? 'production' : 'development')
    // prod is served by nf-serve with build-pinned asset paths.
    if (MODE === 'prod') {
      expect(env.bootstrap).toMatch(
        new RegExp(`^${A}/b/${env.buildId}/assets/.+\\.js$`)
      )
    }
  })

  test('the island HTML contains no <script> or <link>', async ({
    request,
  }) => {
    // Production React emits them for client components; the
    // handler strips them.
    for (const url of [
      productPanel,
      `${A}/_nf/island/Banner?p=${p({ text: 'hi' })}`,
      `${A}/_nf/island/Links?p=${p({ slug: 'one' })}`,
    ]) {
      const env = await (await request.get(url)).json()
      expect(env.html).not.toMatch(/<script|<link/i)
    }
  })

  test('does not grant CORS to an origin that is not allowed', async ({
    request,
  }) => {
    const res = await request.get(productPanel, {
      headers: { Origin: 'http://evil.test' },
    })
    expect(res.status()).toBe(403)
    expect(res.headers()['access-control-allow-origin']).toBeUndefined()
  })

  test('an error response to an allowed origin carries CORS headers', async ({
    request,
  }) => {
    const res = await request.get(`${A}/_nf/island/Nope`, {
      headers: { Origin: HOST },
    })
    expect(res.status()).toBe(404)
    expect(res.headers()['access-control-allow-origin']).toBe(HOST)
    expect(await res.json()).toEqual({ error: 'NF-021' })
  })

  test('returns 404 for an unknown island', async ({ request }) => {
    const res = await request.get(`${A}/_nf/island/Nope`)
    expect(res.status()).toBe(404)
  })
})

test.describe('private islands (identity tokens)', () => {
  test('a valid token renders per-user content and is never publicly cacheable', async ({
    request,
  }) => {
    const token = await mint(request, 'aud=a&sub=user-1')
    const res = await request.get(`${A}/_nf/island/MyOrders`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).html.replaceAll('<!-- -->', '')).toContain(
      'Orders for user-1'
    )
    expect(res.headers()['cache-control']).toBe('private, no-store')
  })

  test('a token for another remote gets 401 and no content', async ({
    request,
  }) => {
    const token = await mint(request, 'aud=b&sub=user-1')
    const res = await request.get(`${A}/_nf/island/MyOrders`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(401)
    const body = await res.text()
    expect(body).not.toContain('Orders')
    expect(JSON.parse(body).error).toMatch(/^NF-01[46]$/)
  })

  test('an expired token gets 401', async ({ request }) => {
    const token = await mint(request, 'aud=a&ttl=-1')
    const res = await request.get(`${A}/_nf/island/MyOrders`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(401)
  })

  test('a private island without a token gets 401', async ({ request }) => {
    const res = await request.get(`${A}/_nf/island/MyOrders`)
    expect(res.status()).toBe(401)
  })
})

test('a token from an issuer that is not on the allowlist gets 401', async ({
  request,
}) => {
  // Signed by the fixture key, but claiming an issuer the remote does not
  // trust: the remote must not fetch keys from it (issuer allowlist).
  const token = await mint(request, 'aud=a&iss=http://evil.test')
  const res = await request.get(`${A}/_nf/island/MyOrders`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(401)
})
