import { assertEnvelopeUrls, parseEnvelope } from '../src/index.ts'

const valid = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'v1',
  mode: 'production',
  html: '<p>x</p>',
  rscPayload: '0:x',
  css: ['https://r.example/a.css'],
  bootstrap: 'https://r.example/b.js',
  reactVersion: '19.3.1',
  idPlaceholder: 'nfid-1a2b3c4d-',
}

test('accepts a valid envelope and keeps unknown fields', () => {
  const parsed = parseEnvelope({ ...valid, future: 1 })
  expect(parsed).toMatchObject(valid)
  expect((parsed as Record<string, unknown>).future).toBe(1)
})

test('unknown major version is NF-003, before field checks', () =>
  expect(() => parseEnvelope({ protocolVersion: 2 })).toThrow(/NF-003/))

test('a non-object is NF-004', () =>
  expect(() => parseEnvelope('x')).toThrow(/NF-004/))

test.each([
  'remote',
  'buildId',
  'mode',
  'html',
  'rscPayload',
  'css',
  'bootstrap',
  'reactVersion',
  'idPlaceholder',
])('missing %s is NF-004', (field) => {
  const broken: Record<string, unknown> = { ...valid }
  delete broken[field]
  expect(() => parseEnvelope(broken)).toThrow(/NF-004/)
})

test.each(['', 'ab', 'has space', 'a.b-c-d', 'x'.repeat(3) + '\u00e9'])(
  'idPlaceholder %p is NF-004',
  (idPlaceholder) =>
    expect(() => parseEnvelope({ ...valid, idPlaceholder })).toThrow(/NF-004/)
)

test('mode outside the union is NF-004', () =>
  expect(() => parseEnvelope({ ...valid, mode: 'test' })).toThrow(/NF-004/))

test('relative bootstrap is NF-004', () =>
  expect(() => parseEnvelope({ ...valid, bootstrap: '/b.js' })).toThrow(
    /NF-004/
  ))

test('relative css entry is NF-004', () =>
  expect(() => parseEnvelope({ ...valid, css: ['a.css'] })).toThrow(/NF-004/))

test('bootstrap on a foreign origin is NF-005', () =>
  expect(() =>
    assertEnvelopeUrls(
      { ...parseEnvelope(valid), bootstrap: 'https://evil.example/b.js' },
      ['https://r.example']
    )
  ).toThrow(/NF-005/))

test('css on an allowed asset origin passes', () =>
  expect(() =>
    assertEnvelopeUrls(
      { ...parseEnvelope(valid), css: ['https://cdn.example/a.css'] },
      ['https://r.example', 'https://cdn.example']
    )
  ).not.toThrow())

test('css on a foreign origin is NF-005', () =>
  expect(() =>
    assertEnvelopeUrls(
      { ...parseEnvelope(valid), css: ['https://evil.example/a.css'] },
      ['https://r.example']
    )
  ).toThrow(/NF-005/))

test.each(['javascript:alert(1)', 'data:text/javascript,1'])(
  '%s is NF-005',
  (bootstrap) =>
    expect(() =>
      assertEnvelopeUrls({ ...parseEnvelope(valid), bootstrap }, [
        'https://r.example',
      ])
    ).toThrow(/NF-005/)
)

const bypass: [string, string][] = [
  ['relative', '/b.js'],
  ['protocol-relative', '//evil.example/b.js'],
  ['data:', 'data:text/javascript,1'],
  ['javascript:', 'javascript:alert(1)'],
  ['different port on an allowed host', 'https://r.example:8443/b.js'],
  ['different scheme on an allowed host', 'http://r.example/b.js'],
]

describe('URL bypass attempts', () => {
  test.each(bypass)(
    'bootstrap %s is rejected by assertEnvelopeUrls',
    (_, url) =>
      expect(() =>
        assertEnvelopeUrls({ ...parseEnvelope(valid), bootstrap: url }, [
          'https://r.example',
        ])
      ).toThrow(/NF-005/)
  )

  test.each(bypass)('css %s is rejected by assertEnvelopeUrls', (_, url) =>
    expect(() =>
      assertEnvelopeUrls({ ...parseEnvelope(valid), css: [url] }, [
        'https://r.example',
      ])
    ).toThrow(/NF-005/)
  )

  test.each([
    ['relative', '/b.js'],
    ['protocol-relative', '//evil.example/b.js'],
  ])('parseEnvelope rejects a %s bootstrap or css as NF-004', (_, url) => {
    expect(() => parseEnvelope({ ...valid, bootstrap: url })).toThrow(/NF-004/)
    expect(() => parseEnvelope({ ...valid, css: [url] })).toThrow(/NF-004/)
  })
})
