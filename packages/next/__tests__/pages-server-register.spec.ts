// `/pages/server` registers the host's next/link and next/router on import,
// as `/pages/components` does, so a server-side preload of a build that lists
// them in `shared` is not refused with a false NF-036.
import type { RemoteComponentDescriptor } from '@next-federation/protocol'

// A loader that trusts every descriptor, so a preload reaches the shared-module
// check (an untrusted build is blocked before it).
rs.mock('@next-federation/react/components/server-loader', () => ({
  serverLoader: {
    canLoadServerCode: () => true,
    isTrustedDescriptor: () => true,
    createServerEntryPlugin: () => ({ name: 'test-server-entry' }),
    forgetInstance: () => {},
  },
}))

const base = 'http://127.0.0.1:4110/b/c1/'
const descriptor: RemoteComponentDescriptor = {
  remote: 'components',
  name: 'components',
  buildId: 'c1',
  base,
  manifest: `${base}mf-manifest.json`,
  ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
  maxBuilds: 5,
  shared: {
    'next/link': { requiredVersion: false, fallback: false },
    'next/router': { requiredVersion: false, fallback: false },
  },
}

beforeEach(() => {
  rs.resetModules()
  rs.stubEnv('NF_NEXT_VERSION', '16.4.6')
})
afterEach(() => {
  rs.unstubAllEnvs()
})

test('importing only pages/server registers next/link and next/router', async () => {
  const { preloadRemoteComponent } = await import('../src/pages/server.ts')
  const result = await preloadRemoteComponent(descriptor, './NavLink', {
    timeoutMs: 60_000,
  })
  expect(result.state).not.toBe('refused')
  expect(result).not.toMatchObject({ code: 'NF-036' })
})

test('importing pages/components as well does not register twice', async () => {
  await import('../src/pages/server.ts')
  await import('../src/pages/components.tsx')
  const { preloadRemoteComponent } = await import('../src/pages/server.ts')
  const result = await preloadRemoteComponent(descriptor, './NavLink', {
    timeoutMs: 60_000,
  })
  expect(result.state).not.toBe('refused')
  expect(result).not.toMatchObject({ code: 'NF-036' })
})

// Each Next layer bundles its own copy of `@next-federation/react/components`
// (one runtime per layer), modelled here by a module reset between imports.
test('an App Router layer runtime does not get the Pages registration', async () => {
  await import('../src/pages/server.ts')
  rs.resetModules()
  const { preloadRemoteComponent } =
    await import('../src/client/components.tsx')
  const result = await preloadRemoteComponent(descriptor, './NavLink', {
    timeoutMs: 60_000,
  })
  // next/router is never provided to App Router remotes.
  expect(result).toMatchObject({ state: 'refused', code: 'NF-036' })
})
