import { defineFederation } from '@next-federation/core'
import { generateSigningKey } from '@next-federation/core/identity'
import { isNFError, logger } from '@next-federation/sdk'
import { createFederationApiHandler } from '../src/pages/api-handler.ts'
import { createFederationRoutes } from '../src/routes.ts'

rs.mock('next/headers', () => ({ cookies: rs.fn(), headers: rs.fn() }))

const federation = (signingKeys: string[]) =>
  defineFederation({
    remotes: { shop: { origin: 'https://shop.example.com' } },
    identity: { issuer: 'https://host.example.com', signingKeys },
  })

const ctx = (nf: string[]) => ({ params: Promise.resolve({ nf }) })

beforeEach(() => {
  rs.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (error) {
    return error
  }
  return 'resolved'
}

test('App Router routes: every request awaits startup validation and fails with its error', async () => {
  const { GET } = createFederationRoutes(federation(['not a key']), {
    getIdentity: async () => null,
  })
  // An unknown route would otherwise answer 404 without touching the keys.
  const error = await rejection(
    GET(new Request('http://localhost/api/next-federation/nope'), ctx(['nope']))
  )
  expect(isNFError(error)).toBe(true)
})

test('Pages API handler: every request awaits startup validation and fails with its error', async () => {
  const handler = createFederationApiHandler(federation(['not a key']), {
    getIdentity: () => null,
  })
  const res = {
    setHeader: rs.fn(),
    status: rs.fn(() => res),
    end: rs.fn(),
    json: rs.fn(),
  }
  const error = await rejection(
    Promise.resolve(
      handler(
        { method: 'GET', query: { nf: ['nope'] }, headers: {} } as never,
        res as never
      )
    )
  )
  expect(isNFError(error)).toBe(true)
  expect(res.status).not.toHaveBeenCalled()
})

test('valid keys: requests are served once validation resolves', async () => {
  const { GET } = createFederationRoutes(
    federation([await generateSigningKey('k1')]),
    { getIdentity: async () => null }
  )
  const response = await GET(
    new Request('http://localhost/api/next-federation/jwks'),
    ctx(['jwks'])
  )
  expect(response.status).toBe(200)
})
