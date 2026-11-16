// The Next entries of remote components register the host's own Next router
// modules as shared modules, per router, at the host's Next version.
import * as NextLink from 'next/link'
import * as NextNavigation from 'next/navigation'
import * as NextRouter from 'next/router'

const { registered } = rs.hoisted(() => ({
  registered: [] as Array<Record<string, { version: string; module: unknown }>>,
}))
rs.mock('@next-federation/react/components', () => ({
  registerSharedModules: (shared: (typeof registered)[number]) => {
    registered.push(shared)
  },
  createRemoteComponent: () => null,
  loadRemoteModule: () => null,
  preloadRemoteComponent: () => null,
  COMPONENT_EVENT: 'nf:component',
}))

beforeEach(() => {
  registered.length = 0
  rs.resetModules()
})
afterEach(() => {
  rs.unstubAllEnvs()
})

test('App Router: next/link and next/navigation (never next/router), at the host Next version', async () => {
  rs.stubEnv('NF_NEXT_VERSION', '16.4.6')
  const entry = await import('../src/client/components.tsx')
  expect(registered).toHaveLength(1)
  const shared = registered[0]!
  expect(Object.keys(shared).sort()).toEqual(['next/link', 'next/navigation'])
  expect(shared['next/link']).toEqual({ version: '16.4.6', module: NextLink })
  expect(shared['next/navigation']!.module).toBe(NextNavigation)
  expect(typeof entry.createRemoteComponent).toBe('function')
})

test('Pages Router: next/link and next/router (never next/navigation)', async () => {
  rs.stubEnv('NF_NEXT_VERSION', '16.4.6')
  await import('../src/pages/components.tsx')
  const shared = registered[0]!
  expect(Object.keys(shared).sort()).toEqual(['next/link', 'next/router'])
  expect(shared['next/router']).toEqual({
    version: '16.4.6',
    module: NextRouter,
  })
})

test('without withNextFederation (no NF_NEXT_VERSION) the entry fails with NF-017', async () => {
  rs.stubEnv('NF_NEXT_VERSION', undefined)
  await expect(import('../src/client/components.tsx')).rejects.toMatchObject({
    code: 'NF-017',
  })
  expect(registered).toHaveLength(0)
})
