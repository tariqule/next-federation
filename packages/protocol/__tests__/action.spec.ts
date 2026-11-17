import { isNFError } from '@next-federation/sdk'
import {
  ACTION_HEADER,
  ACTION_ID_PATTERN,
  ACTION_PATH,
  DEFAULT_MAX_ACTION_BODY_BYTES,
  parseActionRequest,
  parseEnvelope,
} from '../src/index.ts'

const URL_BASE = `https://r.example/b/v1${ACTION_PATH}`
const TEXT = 'text/plain;charset=UTF-8'

function req(headers: Record<string, string>, url: string = URL_BASE): Request {
  return new Request(url, { method: 'POST', headers, body: '[]' })
}

// Headers refuses some values (e.g. NUL), so the parser is also driven through a stub.
function stubReq(id: string, contentType: string = TEXT): Request {
  const headers = {
    get: (name: string) =>
      name.toLowerCase() === ACTION_HEADER ? id : contentType,
  } as unknown as Headers
  return { url: URL_BASE, method: 'POST', headers } as unknown as Request
}

test('constants', () => {
  expect(ACTION_PATH).toBe('/_nf/action')
  expect(ACTION_HEADER).toBe('x-nf-action')
  expect(DEFAULT_MAX_ACTION_BODY_BYTES).toBe(1_048_576)
})

test.each([
  'src/actions.ts#addToCart',
  '/abs/path/actions.ts#placeOrder',
  '@scope/pkg/a.js#$x',
  'a+b-c.d_e#_',
  'abc123#default',
  `${'a'.repeat(512)}#f`,
  `a#${'f'.repeat(128)}`,
])('accepts id %p', (id) => {
  expect(ACTION_ID_PATTERN.test(id)).toBe(true)
  expect(
    parseActionRequest(req({ [ACTION_HEADER]: id, 'content-type': TEXT }))
  ).toEqual({ id, island: null, contentType: TEXT })
})

test.each([
  '',
  'noexport',
  '#onlyexport',
  'file#',
  'file#1abc',
  'file#a-b',
  'a#b#c',
  'has space#x',
  'quote"#x',
  '../x#a',
  'src/../../etc#a',
  'a\0b#c',
  `${'a'.repeat(513)}#f`,
  `a#${'f'.repeat(129)}`,
  'file?x#a',
  'C:\\x#a',
])('rejects id %p with NF-032', (id) => {
  expect(() => parseActionRequest(stubReq(id))).toThrow(/NF-032/)
})

test('missing header is NF-032', () => {
  expect(() => parseActionRequest(req({ 'content-type': TEXT }))).toThrow(
    /NF-032/
  )
})

test.each([
  ['text/plain;charset=UTF-8', true],
  ['text/plain; charset=utf-8', true],
  ['TEXT/PLAIN;Charset="UTF-8"', true],
  ['multipart/form-data; boundary=----x', true],
  ['text/plain', false],
  ['text/plain;charset=latin1', false],
  ['application/json', false],
  ['application/x-www-form-urlencoded', false],
  ['multipart/form-data', false],
  ['', false],
] as const)('content-type %p accepted: %p', (contentType, ok) => {
  // A string-bodied Request defaults to text/plain, so "no content type" goes through the stub.
  const run = () =>
    parseActionRequest(
      contentType
        ? req({ [ACTION_HEADER]: 'a.ts#f', 'content-type': contentType })
        : stubReq('a.ts#f', '')
    )
  if (ok) expect(run().contentType).toBe(contentType)
  else expect(run).toThrow(/NF-032/)
})

test('island query is returned when valid and rejected when not', () => {
  const ok = parseActionRequest(
    req(
      { [ACTION_HEADER]: 'a.ts#f', 'content-type': TEXT },
      `${URL_BASE}?island=Cart_1`
    )
  )
  expect(ok.island).toBe('Cart_1')
  for (const bad of ['', '1x', 'a b', 'a/b', '..']) {
    let error: unknown
    try {
      parseActionRequest(
        req(
          { [ACTION_HEADER]: 'a.ts#f', 'content-type': TEXT },
          `${URL_BASE}?island=${encodeURIComponent(bad)}`
        )
      )
    } catch (e) {
      error = e
    }
    expect(isNFError(error, 'NF-032')).toBe(true)
  }
})

const envelope = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'v1',
  mode: 'production',
  html: '<p>x</p>',
  rscPayload: '0:x',
  css: [],
  bootstrap: 'https://r.example/b.js',
  reactVersion: '19.3.1',
  idPlaceholder: 'nfid-1a2b3c4d-',
}

test('envelope island is optional and must be an island name', () => {
  expect(parseEnvelope(envelope).island).toBeUndefined()
  expect(parseEnvelope({ ...envelope, island: 'Cart' }).island).toBe('Cart')
  expect(() => parseEnvelope({ ...envelope, island: 1 })).toThrow(/NF-004/)
  expect(() => parseEnvelope({ ...envelope, island: 'a b' })).toThrow(/NF-004/)
})
