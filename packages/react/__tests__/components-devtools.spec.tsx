// The Module Federation Chrome devtools read the page's
// `window.__FEDERATION__`: `moduleInfo` (the global snapshot: each consumer
// with its `remotesInfo`, each producer keyed `name:manifestUrl`),
// `__INSTANCES__`, and the plugins they push into `__GLOBAL_PLUGIN__` before
// the page runs (their `loadRemoteSnapshot` hook posts the snapshot to the
// panel). Remote components load through the real MF runtime with the
// build's mf-manifest.json as the entry, so all of it is filled in.
import { createInstance } from '@module-federation/runtime'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type { FederationInstance } from '../src/components/runtime.ts'

const base = 'http://127.0.0.1:4998/b/dt1/'
const manifestUrl = `${base}mf-manifest.json`
// The shape @module-federation/vite writes for a components build.
const manifest = {
  id: 'mf_dt_components',
  name: 'mf_dt_components',
  metaData: {
    name: 'mf_dt_components',
    type: 'app',
    buildInfo: { buildVersion: '1.0.0', buildName: 'mf_dt_components' },
    remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
    ssrRemoteEntry: { name: 'remoteEntry.ssr.js', path: '', type: 'module' },
    types: { path: '', name: '' },
    globalName: 'mf_dt_components',
    pluginVersion: '1.24.0',
    publicPath: base,
  },
  shared: [],
  remotes: [],
  exposes: [
    {
      id: 'mf_dt_components:Counter',
      name: 'Counter',
      assets: { js: { async: [], sync: [] }, css: { async: [], sync: [] } },
      path: './Counter',
    },
  ],
}

type Snapshot = Record<
  string,
  {
    remotesInfo?: Record<string, { matchedVersion: string }>
    remoteEntry?: string
    publicPath?: string
    modules?: Array<{ modulePath: string }>
  }
>

/** As the devtools panel splits the snapshot (chrome-devtools separateType). */
function separateType(moduleInfo: Snapshot) {
  const consumers: string[] = []
  const producer: string[] = []
  for (const [key, info] of Object.entries(moduleInfo)) {
    const ids = Object.keys(info.remotesInfo ?? {})
    if (ids.length === 0) continue
    consumers.push(key)
    for (const id of ids) if (!producer.includes(id)) producer.push(id)
  }
  return { consumers, producer }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('a remote component load fills the global snapshot the devtools panel reads', async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url) === manifestUrl) {
      return new Response(JSON.stringify(manifest), {
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new TypeError(`unexpected fetch ${String(url)}`)
  }) as typeof fetch
  // The devtools extension injects its plugins before the page's scripts.
  const posted: Snapshot[] = []
  const g = globalThis as unknown as {
    __FEDERATION__: {
      __GLOBAL_PLUGIN__: unknown[]
      __INSTANCES__?: Array<{ name: string }>
      moduleInfo: Snapshot
    }
  }
  g.__FEDERATION__ ??= { __GLOBAL_PLUGIN__: [], moduleInfo: {} }
  g.__FEDERATION__.__GLOBAL_PLUGIN__ ??= []
  g.__FEDERATION__.__GLOBAL_PLUGIN__.push({
    name: 'devtools-like-plugin',
    loadRemoteSnapshot(args: Record<string, unknown>) {
      posted.push(structuredClone(g.__FEDERATION__.moduleInfo))
      return args
    },
    // Stands in for the browser's import() of the remote entry.
    loadEntry() {
      return {
        init: async () => {},
        get: async () => () => ({ default: () => null }),
      }
    },
  })
  const runtime = createComponentRuntime({
    isServer: false,
    react: {},
    hostShared: {},
    createInstance: (options) =>
      createInstance(
        options as unknown as Parameters<typeof createInstance>[0]
      ) as unknown as FederationInstance,
    canLoadServerCode: () => false,
  })
  await runtime.load(
    {
      remote: 'components',
      name: 'mf_dt_components',
      buildId: 'dt1',
      base,
      manifest: manifestUrl,
      ssr: null,
      maxBuilds: 5,
    },
    './Counter'
  )
  // The devtools plugin ran inside the remote components runtime.
  expect(posted.length).toBeGreaterThan(0)
  expect(posted[0]!.nf_host?.remotesInfo?.mf_dt_components).toEqual({
    matchedVersion: manifestUrl,
  })
  const moduleInfo = g.__FEDERATION__.moduleInfo
  expect(separateType(moduleInfo)).toEqual({
    consumers: ['nf_host'],
    producer: ['mf_dt_components'],
  })
  const remote = moduleInfo[`mf_dt_components:${manifestUrl}`]
  expect(remote?.publicPath).toBe(base)
  expect(remote?.remoteEntry).toBe('remoteEntry.js')
  expect(remote?.modules?.map((m) => m.modulePath)).toEqual(['./Counter'])
  expect(g.__FEDERATION__.__INSTANCES__?.map((i) => i.name)).toContain(
    'nf_host'
  )
})
