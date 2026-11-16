// Server bindings never hand an untrusted descriptor to the MF runtime:
// loadRemoteModule and preloadRemoteComponent check the runtime's trust
// decision first (a real runtime over a fake MF instance).
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createBindings } from '../src/components/render.tsx'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type { FederationInstance } from '../src/components/runtime.ts'

const base = 'http://127.0.0.1:4110/b/c1/'
const forged: RemoteComponentDescriptor = {
  remote: 'components',
  name: 'components',
  buildId: 'c1',
  base,
  manifest: `${base}mf-manifest.json`,
  ssr: { integrity: { 'mf-manifest.json': 'sha384-FORGED' } },
  maxBuilds: 5,
}

test('an untrusted descriptor on the server never reaches loadRemote', async () => {
  rs.spyOn(console, 'warn').mockImplementation(() => {})
  const calls: string[] = []
  const instance: FederationInstance = {
    registerRemotes: () => calls.push('registerRemotes'),
    registerShared: () => {},
    loadRemote: async () => {
      calls.push('loadRemote')
      return { default: () => null } as never
    },
  }
  const runtime = createComponentRuntime({
    isServer: true,
    react: {},
    hostShared: {},
    createInstance: () => instance,
    canLoadServerCode: () => true,
    isTrusted: () => false,
  })
  const bindings = createBindings({ runtime, isServer: true })
  await expect(
    bindings.loadRemoteModule(forged, './Counter')
  ).rejects.toMatchObject({ code: 'NF-028' })
  await bindings.preloadRemoteComponent(forged, './Counter')
  await new Promise((r) => setTimeout(r, 10))
  expect(calls).toEqual([])
})
