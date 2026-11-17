import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import {
  CompressionCache,
  compressBody,
  isCompressibleFile,
  isCompressibleResponse,
  negotiateEncoding,
} from '../src/node/compress.ts'

describe('negotiateEncoding', () => {
  test.each([
    [undefined, null],
    ['', null],
    ['gzip', 'gzip'],
    ['br', 'br'],
    ['gzip, deflate, br', 'br'],
    ['br;q=0.5, gzip', 'gzip'],
    ['br;q=1, gzip;q=1', 'br'],
    ['gzip;q=0.8, br;q=0.8', 'br'],
    ['GZIP', 'gzip'],
    ['x-gzip', 'gzip'],
    ['deflate', null],
    ['identity', null],
    ['br;q=0', null],
    ['br;q=0, gzip;q=0', null],
    ['*', 'br'],
    ['*;q=0.5, br;q=0', 'gzip'],
    ['*;q=0', null],
    ['gzip;q=0, *', 'br'],
    ['br;q=0.001', 'br'],
    ['br;q=abc, gzip', 'gzip'],
    [['gzip', 'br'], 'br'],
  ] as const)('%j -> %j', (header, expected) => {
    expect(negotiateEncoding(header as string | string[] | undefined)).toBe(
      expected
    )
  })
})

describe('what is compressed', () => {
  test('text assets yes, images and fonts no', () => {
    for (const file of [
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.css',
      'a.json',
      'a.svg',
      'a.html',
      'a.map',
      'a.txt',
    ]) {
      expect(isCompressibleFile(file), file).toBe(true)
    }
    for (const file of ['a.png', 'a.jpg', 'a.webp', 'a.woff2', 'a.woff', 'a']) {
      expect(isCompressibleFile(file), file).toBe(false)
    }
  })

  test('a proxied response: JSON without an encoding, public', () => {
    const ok = { 'content-type': 'application/json' }
    expect(isCompressibleResponse('GET', 200, ok, {})).toBe(true)
    expect(isCompressibleResponse('POST', 200, ok, {})).toBe(true)
    // Already encoded by the build: never encoded twice.
    expect(
      isCompressibleResponse(
        'GET',
        200,
        { ...ok, 'content-encoding': 'gzip' },
        {}
      )
    ).toBe(false)
    expect(isCompressibleResponse('HEAD', 200, ok, {})).toBe(false)
    expect(isCompressibleResponse('GET', 304, ok, {})).toBe(false)
    expect(isCompressibleResponse('GET', 206, ok, {})).toBe(false)
    expect(
      isCompressibleResponse(
        'GET',
        200,
        { ...ok, 'cache-control': 'public, no-transform' },
        {}
      )
    ).toBe(false)
    // A per-user response (the request carried a token) stays as it is.
    expect(
      isCompressibleResponse('GET', 200, ok, { authorization: 'Bearer x' })
    ).toBe(false)
    // Server Action results stream (Flight): left alone.
    expect(
      isCompressibleResponse(
        'POST',
        200,
        { 'content-type': 'text/x-component;charset=utf-8' },
        {}
      )
    ).toBe(false)
  })
})

describe('compressBody', () => {
  const text = Buffer.from('export const x = 1\n'.repeat(500))
  test('br and gzip round-trip to the original bytes', async () => {
    const br = await compressBody(text, 'br')
    expect(br.length).toBeLessThan(text.length / 4)
    expect(brotliDecompressSync(br).equals(text)).toBe(true)
    const gz = await compressBody(text, 'gzip')
    expect(gz.length).toBeLessThan(text.length / 4)
    expect(gunzipSync(gz).equals(text)).toBe(true)
  })
})

describe('CompressionCache', () => {
  const body = Buffer.from('a'.repeat(4096))
  test('compresses once per file version and encoding', async () => {
    const cache = new CompressionCache(1024 * 1024)
    let reads = 0
    const read = async () => {
      reads++
      return body
    }
    const key = { path: '/x.js', mtimeMs: 1, size: body.length }
    const a = await cache.get(key, 'br', read)
    const b = await cache.get(key, 'br', read)
    expect(b).toBe(a)
    expect(reads).toBe(1)
    expect(cache.peek(key, 'br')).toBe(a)
    expect(cache.peek(key, 'gzip')).toBeUndefined()
    await cache.get(key, 'gzip', read)
    expect(reads).toBe(2)
    // A new version of the file (mtime or size): compressed again.
    await cache.get({ ...key, mtimeMs: 2 }, 'br', read)
    expect(reads).toBe(3)
  })

  test('concurrent requests share one compression', async () => {
    const cache = new CompressionCache(1024 * 1024)
    let reads = 0
    const read = async () => {
      reads++
      return body
    }
    const key = { path: '/y.js', mtimeMs: 1, size: body.length }
    const [a, b] = await Promise.all([
      cache.get(key, 'br', read),
      cache.get(key, 'br', read),
    ])
    expect(a).toBe(b)
    expect(reads).toBe(1)
  })

  test('stays under its byte cap, least recently used out first', async () => {
    const random = (n: number) =>
      Buffer.from(
        Array.from({ length: n }, () => Math.floor(Math.random() * 256))
      )
    // Incompressible bodies: each entry is about 3000 bytes.
    const cache = new CompressionCache(7000)
    const files = [1, 2, 3].map((i) => ({
      key: { path: `/${i}.bin`, mtimeMs: 1, size: 3000 },
      body: random(3000),
    }))
    await cache.get(files[0]!.key, 'gzip', async () => files[0]!.body)
    await cache.get(files[1]!.key, 'gzip', async () => files[1]!.body)
    // Touch the first: the second is now the least recently used.
    await cache.get(files[0]!.key, 'gzip', async () => files[0]!.body)
    await cache.get(files[2]!.key, 'gzip', async () => files[2]!.body)
    expect(cache.bytes).toBeLessThanOrEqual(7000)
    expect(cache.peek(files[0]!.key, 'gzip')).toBeDefined()
    expect(cache.peek(files[1]!.key, 'gzip')).toBeUndefined()
    expect(cache.peek(files[2]!.key, 'gzip')).toBeDefined()
  })

  test('a failed read is not cached', async () => {
    const cache = new CompressionCache(1024 * 1024)
    const key = { path: '/z.js', mtimeMs: 1, size: body.length }
    await expect(
      cache.get(key, 'br', async () => {
        throw new Error('gone')
      })
    ).rejects.toThrow('gone')
    expect(await cache.get(key, 'br', async () => body)).toBeInstanceOf(Buffer)
  })
})
