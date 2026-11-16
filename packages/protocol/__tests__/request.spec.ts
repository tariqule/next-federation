import {
  GET_PROPS_LIMIT,
  decodeIslandRequest,
  encodeIslandRequest,
} from '../src/index.ts'

const base = 'https://r.example'

test('round-trips unicode props and host context over GET', async () => {
  const r = encodeIslandRequest(
    base,
    'Panel',
    { t: 'héllo ✓ 日本' },
    { host: { basePath: '/base', locale: 'fr' } }
  )
  expect(r.method).toBe('GET')
  expect(await decodeIslandRequest(new Request(r.url))).toEqual({
    island: 'Panel',
    props: { t: 'héllo ✓ 日本' },
    host: { basePath: '/base', locale: 'fr' },
  })
})

test('omits h when the host context is absent or empty', () => {
  expect(encodeIslandRequest(base, 'Panel', {}).url).not.toContain('h=')
  expect(
    encodeIslandRequest(
      base,
      'Panel',
      {},
      { host: { basePath: '', locale: '' } }
    ).url
  ).not.toContain('h=')
})

test('strips trailing slashes from base', () =>
  expect(encodeIslandRequest(base + '/', 'Panel', {}).url).toMatch(
    /^https:\/\/r\.example\/_nf\/island\/Panel\?p=/
  ))

test('equal props in different key order give the same URL', () =>
  expect(encodeIslandRequest(base, 'P', { a: 1, b: 2 }).url).toBe(
    encodeIslandRequest(base, 'P', { b: 2, a: 1 }).url
  ))

// canonicalJson({ s }) is n + 8 bytes; base64url length is ceil(4 * bytes / 3).
const propsOfBytes = (bytes: number) => ({ s: 'a'.repeat(bytes - 8) })

test('p of exactly 2048 chars is GET', () => {
  const r = encodeIslandRequest(base, 'P', propsOfBytes(1536))
  expect(new URL(r.url).searchParams.get('p')).toHaveLength(GET_PROPS_LIMIT)
  expect(r.method).toBe('GET')
})

test('p over 2048 chars is POST with a JSON body and no query', async () => {
  const props = propsOfBytes(1537)
  const r = encodeIslandRequest(base, 'P', props, {
    host: { basePath: '/b', locale: '' },
  })
  expect(r.method).toBe('POST')
  expect(r.url).toBe('https://r.example/_nf/island/P')
  expect(r.headers['content-type']).toBe('application/json')
  expect(JSON.parse(r.body ?? '')).toEqual({
    props,
    host: { basePath: '/b', locale: '' },
  })
  expect(
    await decodeIslandRequest(
      new Request(r.url, { method: r.method, headers: r.headers, body: r.body })
    )
  ).toEqual({ island: 'P', props, host: { basePath: '/b', locale: '' } })
})

test('decodes a build-pinned path /b/v1/_nf/island/Panel', async () => {
  const r = encodeIslandRequest(`${base}/b/v1`, 'Panel', { a: 1 })
  expect(r.url).toContain('/b/v1/_nf/island/Panel?p=')
  expect((await decodeIslandRequest(new Request(r.url))).island).toBe('Panel')
})

test('token becomes a Bearer header and never appears in the URL or body', () => {
  for (const props of [{ a: 1 }, { s: 'a'.repeat(3000) }]) {
    const r = encodeIslandRequest(base, 'P', props, { token: 'tok.en.sig' })
    expect(r.headers.authorization).toBe('Bearer tok.en.sig')
    expect(r.url).not.toContain('tok.en.sig')
    expect(r.body ?? '').not.toContain('tok.en.sig')
  }
  expect(encodeIslandRequest(base, 'P', {}).headers.authorization).toBe(
    undefined
  )
})

test('island name "../x" is NF-002', () =>
  expect(() => encodeIslandRequest(base, '../x', {})).toThrow(/NF-002/))

test('decode: non-island path is NF-004', async () => {
  await expect(
    decodeIslandRequest(new Request('https://r.example/other'))
  ).rejects.toThrow(/NF-004/)
})

test('decode: bad base64, bad JSON and non-object host are NF-004', async () => {
  const get = (q: string) =>
    decodeIslandRequest(new Request(`https://r.example/_nf/island/P?${q}`))
  const b64 = (s: string) => btoa(s).replace(/=+$/, '')
  await expect(get('p=***')).rejects.toThrow(/NF-004/)
  await expect(get(`p=${b64('{nope')}`)).rejects.toThrow(/NF-004/)
  await expect(get(`h=${b64('"x"')}`)).rejects.toThrow(/NF-004/)
  await expect(get(`h=${b64('[1]')}`)).rejects.toThrow(/NF-004/)
})

test('decode: bad island name is NF-004', async () => {
  await expect(
    decodeIslandRequest(new Request('https://r.example/_nf/island/%2E%2E'))
  ).rejects.toThrow(/NF-004/)
})

test('decode: missing p means empty props', async () =>
  expect(
    await decodeIslandRequest(new Request('https://r.example/_nf/island/P'))
  ).toEqual({ island: 'P', props: {}, host: { basePath: '', locale: '' } }))
