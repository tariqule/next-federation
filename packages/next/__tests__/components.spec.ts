// The Next entries of remote components register the host's own Next router
// modules as shared modules, per router, at the host's Next version (plus
// `@next-federation/router`: router-modules.spec.tsx).
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

/**
 * `shared` is Next's own module with `guarded` replaced (guarded-next.spec.tsx
 * covers the guards): every other export is Next's.
 */
function expectGuarded(
  shared: unknown,
  next: Record<string, unknown>,
  guarded: string[]
) {
  const module = shared as Record<string, unknown>
  expect(Object.keys(module).sort()).toEqual(
    [...new Set([...Object.keys(next), ...guarded])].sort()
  )
  for (const key of Object.keys(module)) {
    if (guarded.includes(key)) expect(module[key]).not.toBe(next[key])
    else expect(module[key]).toBe(next[key])
  }
}

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
  expect(Object.keys(shared).sort()).toEqual([
    '@next-federation/router',
    'next/link',
    'next/navigation',
  ])
  expect(shared['next/link']!.version).toBe('16.4.6')
  expectGuarded(shared['next/link']!.module, NextLink, ['default'])
  expect(shared['next/navigation']!.version).toBe('16.4.6')
  expectGuarded(shared['next/navigation']!.module, NextNavigation, [
    'useRouter',
  ])
  expect(typeof entry.createRemoteComponent).toBe('function')
})

test('Pages Router: next/link and next/router (never next/navigation)', async () => {
  rs.stubEnv('NF_NEXT_VERSION', '16.4.6')
  await import('../src/pages/components.tsx')
  const shared = registered[0]!
  expect(Object.keys(shared).sort()).toEqual([
    '@next-federation/router',
    'next/link',
    'next/router',
  ])
  expect(shared['next/router']!.version).toBe('16.4.6')
  expectGuarded(shared['next/router']!.module, NextRouter, [
    'default',
    'useRouter',
    'withRouter',
  ])
  expectGuarded(shared['next/link']!.module, NextLink, ['default'])
})

test('without withNextFederation (no NF_NEXT_VERSION) the entry fails with NF-017', async () => {
  rs.stubEnv('NF_NEXT_VERSION', undefined)
  await expect(import('../src/client/components.tsx')).rejects.toMatchObject({
    code: 'NF-017',
  })
  expect(registered).toHaveLength(0)
})
