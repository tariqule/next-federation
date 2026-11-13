import { expect, test } from '@playwright/test'

const A = 'http://127.0.0.1:4100'
const p = (props: unknown) => Buffer.from(JSON.stringify(props)).toString('base64url')

test.describe('island remote protocol endpoint', () => {
  test('serves a v1 envelope with SSR html, css and an absolute bootstrap URL', async ({ request }) => {
    const res = await request.get(`${A}/_nf/island/ProductPanel?p=${p({ sku: 'A1' })}`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    expect(res.status()).toBe(200)
    expect(res.headers()['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(res.headers()['vary']).toContain('Origin')
    const env = await res.json()
    expect(env.protocolVersion).toBe(1)
    expect(env.html).toContain('Product A1')
    expect(env.html).toContain('data-testid="counter"')
    expect(env.rscPayload.length).toBeGreaterThan(0)
    expect(env.css.length).toBeGreaterThanOrEqual(1)
    expect(env.html).not.toContain('<link') // islands never emit hoistables (design §6)
    expect(env.bootstrap.startsWith(`${A}/`)).toBe(true)
    expect(env.identifierPrefix).toMatch(/^nf-a-ProductPanel-/)
    expect(typeof env.buildId).toBe('string')
  })

  test('does not grant CORS to an origin that is not allowed', async ({ request }) => {
    const res = await request.get(`${A}/_nf/island/ProductPanel?p=${p({ sku: 'A1' })}`, {
      headers: { Origin: 'http://evil.test' },
    })
    expect(res.headers()['access-control-allow-origin']).toBeUndefined()
  })

  test('returns 404 for an unknown island', async ({ request }) => {
    const res = await request.get(`${A}/_nf/island/Nope`)
    expect(res.status()).toBe(404)
  })
})

test.describe('private islands (identity tokens)', () => {
  const mint = async (request: import('@playwright/test').APIRequestContext, q: string) =>
    (await request.get(`http://localhost:3999/mint?${q}`)).text()

  test('a valid token renders per-user content and is never publicly cacheable', async ({ request }) => {
    const token = await mint(request, 'aud=a&sub=user-1')
    const res = await request.get(`${A}/_nf/island/MyOrders`, { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(200)
    expect((await res.json()).html.replaceAll('<!-- -->', '')).toContain('Orders for user-1')
    expect(res.headers()['cache-control']).toBe('private, no-store')
  })

  test('a token for another remote gets 401 and no content', async ({ request }) => {
    const token = await mint(request, 'aud=b&sub=user-1')
    const res = await request.get(`${A}/_nf/island/MyOrders`, { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(401)
    expect(await res.text()).toBe('')
  })

  test('an expired token gets 401', async ({ request }) => {
    const token = await mint(request, 'aud=a&ttl=-1')
    const res = await request.get(`${A}/_nf/island/MyOrders`, { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(401)
  })

  test('a private island without a token gets 401', async ({ request }) => {
    const res = await request.get(`${A}/_nf/island/MyOrders`)
    expect(res.status()).toBe(401)
  })
})
