import { corsHeaders } from '../src/cors.ts'

const req = (origin?: string) =>
  new Request('https://r.example/_nf/island/P', {
    headers: origin ? { origin } : {},
  })

test('an allowed origin gets exact-origin CORS headers, never *', () => {
  const h = corsHeaders(req('https://a.example'), ['https://a.example'])
  expect(h['access-control-allow-origin']).toBe('https://a.example')
  expect(h['access-control-allow-headers']).toBe(
    'Authorization, Content-Type, X-NF-Action'
  )
  expect(h['access-control-allow-methods']).toBe('GET, POST, OPTIONS')
  expect(h['access-control-max-age']).toBe('600')
  expect(h.vary).toBe('Origin')
})

test('a disallowed or absent origin gets only Vary: Origin', () => {
  expect(
    corsHeaders(req('https://evil.example'), ['https://a.example'])
  ).toEqual({ vary: 'Origin' })
  expect(corsHeaders(req(), ['https://a.example'])).toEqual({ vary: 'Origin' })
})

test('a * host entry never produces allow-origin *', () => {
  expect(
    corsHeaders(req('https://a.example'), ['*'])['access-control-allow-origin']
  ).toBeUndefined()
})
