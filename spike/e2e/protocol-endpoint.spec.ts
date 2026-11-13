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
