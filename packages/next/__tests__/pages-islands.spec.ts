import { defineFederation } from '@next-federation/core'
import type { FederationEvent } from '@next-federation/core'
import { generateSigningKey } from '@next-federation/core/identity'
import { logger } from '@next-federation/sdk'
import type { GetServerSidePropsContext, GetStaticPropsContext } from 'next'
import { createPagesIslands } from '../src/pages/create-pages-islands.ts'
import type { PagesIdentity } from '../src/pages/api-handler.ts'

const envelope = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'b1',
  mode: 'production',
  html: '<p>hi</p>',
  rscPayload: '0:"x"',
  css: ['https://a.example.com/a.css'],
  bootstrap: 'https://a.example.com/boot.js',
  reactVersion: '19.2.0',
  idPlaceholder: 'nfph0',
}

type Seen = { url: string; headers: Record<string, string>; init: RequestInit }
let seen: Seen[]
let respond: () => Response
let events: FederationEvent[]
const realFetch = globalThis.fetch
const env = { ...process.env }

let signingKey: string
beforeAll(async () => {
  signingKey = await generateSigningKey('k1')
})

function federation(withIdentity = true) {
  return defineFederation({
    remotes: { a: { origin: 'https://a.example.com', retries: 0 } },
    onEvent: (event) => events.push(event),
    ...(withIdentity
      ? {
          identity: {
            issuer: 'https://host.example.com',
            signingKeys: signingKey,
          },
        }
      : {}),
  })
}

const req = (cookies: Record<string, string> = {}) =>
  ({ headers: {}, cookies }) as unknown as GetServerSidePropsContext['req']

function ssr(
  extra: Partial<GetServerSidePropsContext> = {}
): GetServerSidePropsContext {
  return {
    req: req(),
    res: {} as GetServerSidePropsContext['res'],
    query: {},
    resolvedUrl: '/',
    locales: ['en', 'fr'],
    defaultLocale: 'en',
    locale: 'en',
    ...extra,
  } as GetServerSidePropsContext
}

const ssg = (extra: Partial<GetStaticPropsContext> = {}) =>
  ({
    locales: ['en', 'fr'],
    defaultLocale: 'en',
    locale: 'en',
    ...extra,
  }) as GetStaticPropsContext

// The host context the remote received (GET requests carry it as `h`).
const hostSent = (s: Seen) =>
  JSON.parse(
    Buffer.from(new URL(s.url).searchParams.get('h')!, 'base64url').toString()
  ) as unknown

beforeEach(() => {
  process.env.NF_CACHE_MODEL = 'legacy'
  process.env.NF_BASE_PATH = '/base'
  events = []
  seen = []
  respond = () => new Response(JSON.stringify(envelope))
  globalThis.fetch = ((url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, init })
    return Promise.resolve(respond())
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  process.env = { ...env }
  rs.restoreAllMocks()
})

test('public island: envelope, host context from ctx.locale, token null', async () => {
  const { getIslandProps } = createPagesIslands(federation())
  const props = await getIslandProps(ssr({ locale: 'fr' }), {
    remote: 'a',
    island: 'Banner',
    props: { text: 'hi' },
  })
  expect(props).toEqual({
    remote: 'a',
    envelope,
    host: { basePath: '/base', locale: 'fr' },
    token: null,
  })
  expect(seen).toHaveLength(1)
  expect(seen[0]!.url).toContain('/_nf/island/Banner')
  expect(seen[0]!.headers.authorization).toBeUndefined()
  // The remote receives the same host context.
  expect(hostSent(seen[0]!)).toEqual({ basePath: '/base', locale: 'fr' })
  expect(events).toMatchObject([
    { type: 'island:fetch', remote: 'a', island: 'Banner' },
  ])
})

test('default locale maps to locale ""; non-default to the locale', async () => {
  const { getIslandProps } = createPagesIslands(federation())
  const spec = { remote: 'a', island: 'Banner' }
  expect((await getIslandProps(ssr({ locale: 'en' }), spec)).host).toEqual({
    basePath: '/base',
    locale: '',
  })
  expect((await getIslandProps(ssg({ locale: 'fr' }), spec)).host).toEqual({
    basePath: '/base',
    locale: 'fr',
  })
  // No i18n config: Next leaves locale undefined.
  expect(
    (
      await getIslandProps(
        ssg({ locale: undefined, defaultLocale: undefined }),
        spec
      )
    ).host
  ).toEqual({ basePath: '/base', locale: '' })
})

test('private island in getServerSideProps mints a token and returns only endpoint + identityKey', async () => {
  const getIdentity = rs.fn<PagesIdentity>((r) =>
    r.cookies['nf-user'] ? { sub: r.cookies['nf-user'] } : null
  )
  const { getIslandProps } = createPagesIslands(federation(), { getIdentity })
  const ctx = ssr({ req: req({ 'nf-user': 'user-1', session: 'secret' }) })
  const props = await getIslandProps(ctx, {
    remote: 'a',
    island: 'MyOrders',
    private: true,
  })
  expect(getIdentity).toHaveBeenCalledWith(ctx.req)
  expect(seen).toHaveLength(1)
  const authorization = seen[0]!.headers.authorization!
  expect(authorization).toMatch(/^Bearer ey/)
  expect(seen[0]!.init.cache).toBe('no-store')
  expect(seen[0]!.init.credentials).toBe('omit')
  expect(JSON.stringify(seen[0]!.headers)).not.toContain('secret')
  expect(props).toMatchObject({
    remote: 'a',
    envelope,
    host: { basePath: '/base', locale: '' },
    token: { endpoint: '/base/api/next-federation/token?aud=a' },
  })
  expect(Object.keys(props.token!).sort()).toEqual(['endpoint', 'identityKey'])
  const key = props.token!.identityKey
  expect(key).toMatch(/^[\w-]{22}$/)
  expect(key).not.toContain('user-1')
  // Stable for the same user (the browser token cache is bound to it), and
  // different for another user.
  const again = await getIslandProps(ctx, {
    remote: 'a',
    island: 'MyOrders',
    private: true,
  })
  expect(again.token!.identityKey).toBe(key)
  const other = await getIslandProps(
    ssr({ req: req({ 'nf-user': 'user-2' }) }),
    { remote: 'a', island: 'MyOrders', private: true }
  )
  expect(other.token!.identityKey).toMatch(/^[\w-]{22}$/)
  expect(other.token!.identityKey).not.toBe(key)
  // Neither the props nor the events carry the token.
  expect(JSON.stringify(props)).not.toContain(authorization.slice(7))
  expect(JSON.stringify(events)).not.toContain(authorization.slice(7))
})

test('private island in getStaticProps (no req) is NF-002', async () => {
  const { getIslandProps } = createPagesIslands(federation(), {
    getIdentity: () => ({ sub: 'user-1' }),
  })
  await expect(
    getIslandProps(ssg(), { remote: 'a', island: 'MyOrders', private: true })
  ).rejects.toMatchObject({ code: 'NF-002' })
  expect(seen).toHaveLength(0)
})

test('private island without getIdentity or identity config is NF-013', async () => {
  const spec = { remote: 'a', island: 'MyOrders', private: true }
  await expect(
    createPagesIslands(federation()).getIslandProps(ssr(), spec)
  ).rejects.toMatchObject({ code: 'NF-013' })
  await expect(
    createPagesIslands(federation(false), {
      getIdentity: () => ({ sub: 'u' }),
    }).getIslandProps(ssr(), spec)
  ).rejects.toMatchObject({ code: 'NF-013' })
  expect(seen).toHaveLength(0)
})

test('anonymous private island and failed fetch both give envelope null', async () => {
  const error = rs.spyOn(logger, 'error').mockImplementation(() => {})
  const { getIslandProps } = createPagesIslands(federation(), {
    getIdentity: (r) =>
      r.cookies['nf-user'] ? { sub: r.cookies['nf-user'] } : null,
  })
  const anonymous = await getIslandProps(ssr(), {
    remote: 'a',
    island: 'MyOrders',
    private: true,
  })
  expect(anonymous).toEqual({
    remote: 'a',
    envelope: null,
    host: { basePath: '/base', locale: '' },
    token: null,
  })
  expect(seen).toHaveLength(0) // no remote request for an anonymous visitor
  expect(events).toEqual([])

  respond = () => new Response('down', { status: 503 })
  const failed = await getIslandProps(ssr(), { remote: 'a', island: 'Banner' })
  expect(failed).toEqual({ ...anonymous, envelope: null })
  const failedPrivate = await getIslandProps(
    ssr({ req: req({ 'nf-user': 'user-1' }) }),
    { remote: 'a', island: 'MyOrders', private: true }
  )
  expect(failedPrivate.envelope).toBeNull()
  expect(failedPrivate.token).toBeNull()
  expect(events).toMatchObject([
    { type: 'island:error', remote: 'a', island: 'Banner' },
    { type: 'island:error', remote: 'a', island: 'MyOrders' },
  ])
  expect(error).toHaveBeenCalledTimes(2)
  expect(String(error.mock.calls[0]![1])).toContain('Banner')
})

test('the result survives JSON.stringify → parse unchanged', async () => {
  const { getIslandProps } = createPagesIslands(federation(), {
    getIdentity: () => ({ sub: 'user-1' }),
  })
  const results = [
    await getIslandProps(ssg(), { remote: 'a', island: 'Banner' }),
    await getIslandProps(ssr(), {
      remote: 'a',
      island: 'MyOrders',
      private: true,
    }),
  ]
  respond = () => new Response('down', { status: 500 })
  rs.spyOn(logger, 'error').mockImplementation(() => {})
  results.push(await getIslandProps(ssr(), { remote: 'a', island: 'Banner' }))
  for (const result of results) {
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  }
})

test('caller mistakes throw: unknown remote is NF-001, missing wrapper is NF-017', async () => {
  const { getIslandProps } = createPagesIslands(federation())
  await expect(
    getIslandProps(ssr(), { remote: 'nope', island: 'Banner' })
  ).rejects.toMatchObject({ code: 'NF-001' })
  delete process.env.NF_CACHE_MODEL
  await expect(
    getIslandProps(ssr(), { remote: 'a', island: 'Banner' })
  ).rejects.toMatchObject({ code: 'NF-017' })
})

test('D2: a public island on a host with getIdentity carries a null-key token, read without identity', async () => {
  const getIdentity = rs.fn<PagesIdentity>(async () => ({ sub: 'user-1' }))
  const { getIslandProps } = createPagesIslands(federation(), { getIdentity })
  for (const ctx of [ssr(), ssg()]) {
    const props = await getIslandProps(ctx, { remote: 'a', island: 'Banner' })
    expect(props.token).toEqual({
      endpoint: '/base/api/next-federation/token?aud=a',
      identityKey: null,
    })
    expect(props.envelope).toEqual(envelope)
  }
  expect(getIdentity).not.toHaveBeenCalled()
  expect(seen.every((s) => s.headers.authorization === undefined)).toBe(true)
  // A failed public island has nothing to act on: no token.
  respond = () => new Response('nope', { status: 500 })
  expect(
    (await getIslandProps(ssr(), { remote: 'a', island: 'Banner' })).token
  ).toBeNull()
})

test('D2: without identity config a public island keeps token null', async () => {
  const { getIslandProps } = createPagesIslands(federation(false), {
    getIdentity: async () => ({ sub: 'u' }),
  })
  expect(
    (await getIslandProps(ssr(), { remote: 'a', island: 'Banner' })).token
  ).toBeNull()
})
