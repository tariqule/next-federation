// R3 against the real Module Federation runtime (browser environment): a
// failed remote entry must not stay cached in MF's own state, so every retry
// reaches the runtime's loadEntry plugin with a fresh entry URL.
import { createInstance } from '@module-federation/runtime'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type { FederationInstance } from '../src/components/runtime.ts'

const base = 'http://127.0.0.1:4999/b/r3/'
const manifest = {
  id: 'components',
  name: 'components',
  metaData: {
    name: 'components',
    type: 'app',
    buildInfo: { buildVersion: '1.0.0', buildName: 'components' },
    remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
    types: { path: '', name: '' },
    globalName: 'components',
    pluginVersion: '1.24.0',
    publicPath: base,
  },
  shared: [],
  remotes: [],
  exposes: [
    {
      id: 'components:Counter',
      name: 'Counter',
      assets: { js: { async: [], sync: [] }, css: { async: [], sync: [] } },
      path: './Counter',
    },
  ],
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  rs.restoreAllMocks()
})

test('every browser retry imports the entry again under a new URL (real MF runtime)', async () => {
  rs.spyOn(console, 'warn').mockImplementation(() => {})
  rs.spyOn(console, 'error').mockImplementation(() => {})
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('mf-manifest.json')) {
      return new Response(JSON.stringify(manifest), {
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new TypeError(`offline: ${String(url)}`)
  }) as typeof fetch
  const imported: string[] = []
  let attempts = 0
  const runtime = createComponentRuntime({
    isServer: false,
    react: {},
    hostShared: {},
    createInstance: (options) =>
      createInstance(
        options as unknown as Parameters<typeof createInstance>[0]
      ) as unknown as FederationInstance,
    canLoadServerCode: () => false,
    sleep: async () => {
      attempts++
    },
    importEntry: async (url) => {
      imported.push(url)
      if (imported.length < 3) throw new TypeError(`still offline: ${url}`)
      return {
        init: async () => {},
        get: async () => () => ({ default: () => null, ok: true }),
      }
    },
  })
  const d = {
    remote: 'components',
    name: 'mf_r3_components',
    buildId: 'r3',
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: null,
    maxBuilds: 5,
  }
  const mod = (await runtime.load(d, './Counter')) as unknown as {
    ok?: boolean
  }
  expect(mod.ok).toBe(true)
  expect(imported).toEqual([
    `${base}remoteEntry.js?nf_retry=1`,
    `${base}remoteEntry.js?nf_retry=2`,
    `${base}remoteEntry.js?nf_retry=3`,
  ])
  expect(attempts).toBe(3)
}, 30_000)
