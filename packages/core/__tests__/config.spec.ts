import { isNFError } from '@next-federation/sdk'
import { defineFederation } from '../src/index.ts'
import type { FederationConfig } from '../src/index.ts'

const shop = { shop: { origin: 'https://shop.example.com/' } }

test('resolves defaults', () => {
  const f = defineFederation({ remotes: shop })
  expect(f.target('shop')).toEqual({
    remote: 'shop',
    origin: 'https://shop.example.com',
    allowedOrigins: ['https://shop.example.com'],
    timeoutMs: 3000,
    retries: 1,
  })
  expect(f.islands).toEqual({ revalidate: 60, warnBytes: 102400 })
  expect(f.identity).toBeNull()
  expect(f.routesPath).toBe('/api/next-federation')
  expect(f.remotes).toEqual(['shop'])
})

test('per-remote values override islands defaults', () => {
  const f = defineFederation({
    remotes: {
      a: {
        origin: 'http://localhost:4000',
        assetOrigins: ['https://cdn.example.com/'],
        timeoutMs: 500,
        retries: 0,
      },
      b: { origin: 'https://b.example.com' },
    },
    islands: { timeoutMs: 1000, retries: 2, revalidate: 5, warnBytes: 10 },
  })
  expect(f.target('a')).toEqual({
    remote: 'a',
    origin: 'http://localhost:4000',
    allowedOrigins: ['http://localhost:4000', 'https://cdn.example.com'],
    timeoutMs: 500,
    retries: 0,
  })
  expect(f.target('b')).toMatchObject({ timeoutMs: 1000, retries: 2 })
  expect(f.islands).toEqual({ revalidate: 5, warnBytes: 10 })
})

test('identity: single key becomes an array, ttl defaults to 300', () => {
  const f = defineFederation({
    remotes: shop,
    identity: { issuer: 'https://host.example.com', signingKeys: 'pem' },
  })
  expect(f.identity).toEqual({
    issuer: 'https://host.example.com',
    signingKeys: ['pem'],
    ttlSeconds: 300,
  })
})

test('unknown remote is NF-001 and names the remote', () => {
  const f = defineFederation({ remotes: shop })
  expect(() => f.target('nope')).toThrow(/NF-001.*"nope"/)
  expect(() => f.target('__proto__')).toThrow(/NF-001/)
})

const bad: [string, unknown, RegExp][] = [
  [
    'bad name',
    { remotes: { 'a b': { origin: 'https://x.example' } } },
    /"a b"/,
  ],
  [
    'origin with path',
    { remotes: { a: { origin: 'https://x.example/app' } } },
    /remotes\.a\.origin/,
  ],
  [
    'origin with query',
    { remotes: { a: { origin: 'https://x.example?x=1' } } },
    /remotes\.a\.origin/,
  ],
  [
    'relative origin',
    { remotes: { a: { origin: '/x' } } },
    /remotes\.a\.origin/,
  ],
  [
    'non-http origin',
    { remotes: { a: { origin: 'ftp://x.example' } } },
    /remotes\.a\.origin/,
  ],
  [
    'negative timeout',
    { remotes: { a: { origin: 'https://x.example', timeoutMs: -1 } } },
    /remotes\.a\.timeoutMs/,
  ],
  [
    'NaN retries',
    { remotes: { a: { origin: 'https://x.example', retries: NaN } } },
    /remotes\.a\.retries/,
  ],
  [
    'asset origin with path',
    {
      remotes: {
        a: {
          origin: 'https://x.example',
          assetOrigins: ['https://c.example/p'],
        },
      },
    },
    /assetOrigins\[0\]/,
  ],
  [
    'islands.revalidate negative',
    { remotes: shop, islands: { revalidate: -5 } },
    /islands\.revalidate/,
  ],
  [
    'relative issuer',
    { remotes: shop, identity: { issuer: '/x', signingKeys: 'k' } },
    /identity\.issuer/,
  ],
  [
    'empty signing keys',
    {
      remotes: shop,
      identity: { issuer: 'https://h.example', signingKeys: [] },
    },
    /identity\.signingKeys/,
  ],
  [
    'routesPath without slash',
    { remotes: shop, routesPath: 'api/nf' },
    /routesPath/,
  ],
  ['missing remotes', {}, /remotes/],
]

test.each(bad)('%s is NF-002', (_name, config, key) => {
  let thrown: unknown
  try {
    defineFederation(config as FederationConfig)
  } catch (error) {
    thrown = error
  }
  expect(isNFError(thrown, 'NF-002')).toBe(true)
  expect((thrown as Error).message).toMatch(key)
})

test('emit passes events to onEvent', () => {
  const seen: unknown[] = []
  const f = defineFederation({ remotes: shop, onEvent: (e) => seen.push(e) })
  const event = {
    type: 'island:fetch',
    remote: 'shop',
    island: 'cart',
    ms: 12,
    bytes: 100,
    attempts: 1,
  } as const
  f.emit(event)
  expect(seen).toEqual([event])
})

test('a throwing onEvent does not propagate', () => {
  const f = defineFederation({
    remotes: shop,
    onEvent: () => {
      throw new Error('boom')
    },
  })
  expect(() =>
    f.emit({
      type: 'island:error',
      remote: 'shop',
      island: 'cart',
      ms: 1,
      attempts: 2,
      code: 'NF-007',
    })
  ).not.toThrow()
})

test('a rejecting async onEvent does not become an unhandled rejection', async () => {
  const f = defineFederation({
    remotes: shop,
    onEvent: (() => Promise.reject(new Error('boom'))) as () => void,
  })
  expect(() =>
    f.emit({
      type: 'island:fetch',
      remote: 'shop',
      island: 'c',
      ms: 1,
      bytes: 1,
      attempts: 1,
    })
  ).not.toThrow()
  await new Promise((r) => setTimeout(r, 0))
})

test('target() output survives JSON round-trip unchanged', () => {
  const f = defineFederation({
    remotes: {
      ...shop,
      b: { origin: 'https://b.example', assetOrigins: ['https://c.example'] },
    },
  })
  for (const name of f.remotes) {
    const t = f.target(name)
    expect(JSON.parse(JSON.stringify(t))).toEqual(t)
  }
})

test('target() returns a fresh object each call', () => {
  const f = defineFederation({ remotes: shop })
  f.target('shop').allowedOrigins.push('https://evil.example')
  expect(f.target('shop').allowedOrigins).toEqual(['https://shop.example.com'])
})

const origin = (o: string, extra: Record<string, unknown> = {}) =>
  defineFederation({ remotes: { a: { origin: o, ...extra } } }).target('a')

test('credentials are rejected without echoing them', () => {
  for (const o of [
    'https://alice:hunter2@x.example',
    'https://alice@x.example',
  ]) {
    let message = ''
    try {
      origin(o)
    } catch (error) {
      expect(isNFError(error, 'NF-002')).toBe(true)
      message = (error as Error).message
    }
    expect(message).toMatch(/remotes\.a\.origin/)
    expect(message).not.toContain('hunter2')
    expect(message).not.toContain('alice')
  }
  expect(() =>
    origin('https://x.example', {
      assetOrigins: ['ftp://bob:s3cret@c.example'],
    })
  ).toThrow(/assetOrigins\[0\]/)
  try {
    origin('https://x.example', {
      assetOrigins: ['ftp://bob:s3cret@c.example'],
    })
  } catch (error) {
    expect((error as Error).message).not.toContain('s3cret')
    expect((error as Error).message).not.toContain('bob')
  }
})

test('origin is normalised: case, default port, trailing slash', () => {
  expect(origin('https://X.Example:443/').origin).toBe('https://x.example')
  expect(origin('http://x.example:80').origin).toBe('http://x.example')
  expect(origin('http://x.example:8080/').origin).toBe('http://x.example:8080')
})

test('IPv6 origins are kept', () => {
  expect(origin('http://[::1]:4100').origin).toBe('http://[::1]:4100')
})

test.each([
  'https://x.example?',
  'https://x.example#',
  'https://x.example/?a=1',
  'https://x.example/#a',
])('%s (query or hash) is NF-002', (o) => {
  expect(() => origin(o)).toThrow(/NF-002.*remotes\.a\.origin/)
})

test('assetOrigins are deduplicated and the remote origin comes first', () => {
  const t = origin('https://x.example/', {
    assetOrigins: [
      'https://cdn.example',
      'https://CDN.example/',
      'https://x.example',
      'https://img.example',
    ],
  })
  expect(t.allowedOrigins).toEqual([
    'https://x.example',
    'https://cdn.example',
    'https://img.example',
  ])
})

describe('plain http outside development', () => {
  let before: string | undefined
  beforeEach(() => {
    before = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
  })
  afterEach(() => {
    process.env.NODE_ENV = before
  })

  const nf002 = (config: unknown): string => {
    try {
      defineFederation(config as FederationConfig)
    } catch (error) {
      expect(isNFError(error, 'NF-002')).toBe(true)
      return (error as Error).message
    }
    throw new Error('expected NF-002')
  }

  test.each([
    ['origin', { a: { origin: 'http://shop.example' } }, /remotes\.a\.origin/],
    [
      'assetOrigins',
      {
        a: {
          origin: 'https://shop.example',
          assetOrigins: ['http://cdn.example'],
        },
      },
      /remotes\.a\.assetOrigins\[0\]/,
    ],
  ])('a non-loopback http %s is NF-002', (_what, remotes, key) => {
    const message = nf002({ remotes })
    expect(message).toMatch(key)
    expect(message).toMatch(/https/)
  })

  test('a non-loopback http issuer is NF-002 naming its origin only', () => {
    const message = nf002({
      remotes: shop,
      identity: { issuer: 'http://host.example/auth', signingKeys: 'k' },
    })
    expect(message).toMatch(/identity\.issuer.*http:\/\/host\.example/)
    expect(message).not.toContain('/auth')
  })

  test('loopback http is accepted', () => {
    const f = defineFederation({
      remotes: {
        a: { origin: 'http://localhost:4000' },
        b: { origin: 'http://127.0.0.1:4001' },
        c: { origin: 'http://[::1]:4002' },
      },
      identity: { issuer: 'http://localhost:3000', signingKeys: 'k' },
    })
    expect(f.remotes).toEqual(['a', 'b', 'c'])
  })

  test('allowInsecureHttp: true accepts it; a non-boolean is NF-002', () => {
    const f = defineFederation({
      remotes: { a: { origin: 'http://shop.example' } },
      identity: { issuer: 'http://host.example', signingKeys: 'k' },
      allowInsecureHttp: true,
    })
    expect(f.target('a').origin).toBe('http://shop.example')
    expect(
      nf002({ remotes: shop, allowInsecureHttp: 'yes' as unknown as boolean })
    ).toMatch(/allowInsecureHttp/)
  })
})

test('identity.ttlSeconds above 900 is NF-002 (remotes refuse older tokens)', () => {
  const config = (ttlSeconds: number) => ({
    remotes: shop,
    identity: { issuer: 'https://h.example', signingKeys: 'k', ttlSeconds },
  })
  expect(defineFederation(config(900)).identity?.ttlSeconds).toBe(900)
  expect(() => defineFederation(config(901))).toThrow(
    /NF-002.*identity\.ttlSeconds.*900/
  )
})
