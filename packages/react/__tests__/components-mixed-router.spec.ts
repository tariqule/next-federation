// Mixed-router hosts: an App Router and a Pages Router route in one Next
// server process render with two Reacts (Next's vendored copy and the one in
// node_modules), one remote component runtime per layer. Against the real
// Module Federation runtime and server loader, with a remote shaped like
// @module-federation/vite 1.24's SSR output (process-wide
// `globalThis.__mf_module_cache__`, first writer wins), each layer must get
// its own copy of the remote's server code, bound to its own React.
import { createHash } from 'node:crypto'
import * as MFRuntime from '@module-federation/runtime'
import { createInstance } from '@module-federation/runtime'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type {
  FederationInstance,
  SharedModules,
} from '../src/components/runtime.ts'
import { createServerEntryPlugin } from '../src/components/server-loader.ts'

const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

// The shape of @module-federation/vite 1.24's SSR entry: `init` resolves the
// host's shares through the remote's own MF instance (found by name in the
// process-wide __FEDERATION__) and writes them into the module cache.
const remoteEntry = (name: string) => `
const mf = require("@module-federation/runtime");
const sharedSingletons = {
  react: { name: "react", version: "19.3.1", scope: "default",
    shareConfig: { import: false, singleton: true, requiredVersion: false } },
  "components-fallback-lib": { name: "components-fallback-lib", version: "2.0.0", scope: "default",
    shareConfig: { import: false, singleton: false, requiredVersion: "^2.0.0" } },
};
function getRemoteRuntime() {
  const options = { name: ${JSON.stringify(name)}, remotes: [], shared: {} };
  const existing = globalThis.__FEDERATION__?.__INSTANCES__?.find((i) => i.options.name === options.name && !i.options.version);
  if (!existing) return mf.createInstance(options);
  existing.initOptions(options);
  return existing;
}
const initToken = { from: ${JSON.stringify(name)} };
async function init(shared = {}, initScope = []) {
  const initRes = getRemoteRuntime();
  if (initScope.indexOf(initToken) >= 0) return;
  initScope.push(initToken);
  const entries = [];
  initRes.initShareScopeMap("default", shared);
  await Promise.all(await initRes.initializeSharing("default", { strategy: "version-first", from: "build", initScope }));
  for (const [pkg, info] of Object.entries(sharedSingletons)) {
    if (!shared[pkg] || pkg !== "react") continue;
    // A turn between the share lookups, as the real entry awaits each one.
    await new Promise((r) => setTimeout(r, 5));
    const factory = await initRes.loadShare(pkg, { customShareInfo: { ...info, scope: ["default"] } });
    entries.push({ pkg, module: await factory() });
  }
  const moduleCache = globalThis.__mf_module_cache__ ||= { share: {}, remote: {} };
  const cache = moduleCache.share ||= {};
  for (const { pkg, module } of entries) {
    cache["default:" + pkg] ??= module;
    cache[pkg] ??= module;
  }
  return initRes;
}
exports.init = init;
exports.get = async (expose) => {
  if (expose !== "./Probe") throw new Error("no " + expose);
  const mod = require("./assets/Probe.cjs");
  return () => mod;
};
`

// An expose chunk: reads the module cache when evaluated (as the real
// loadShare chunks do), and the per-build init state key.
const probeChunk = (build: string) => `
var __mfPromiseGlobalKey = "__mf_init__virtual:mf:__mfe_internal__components__mf_owner__${build}__mf_v__runtimeInit__mf_v__.js__";
var state = globalThis[__mfPromiseGlobalKey];
if (!state) state = globalThis[__mfPromiseGlobalKey] = { initPromise: new Promise(() => {}) };
globalThis.__mf_module_cache__ ||= { share: {}, remote: {} };
var share = globalThis.__mf_module_cache__.share;
var fallback = share["default:components-fallback-lib@2.0.0"] ?? { bundled: true };
exports.default = function Probe() { return null };
exports.remoteReact = share["default:react"];
exports.fallbackLib = fallback;
exports.build = ${JSON.stringify(build)};
`

function remoteBuild(name: string, build: string) {
  const base = `http://127.0.0.1:4999/b/${build}/`
  const files: Record<string, string> = {
    'mf-manifest.json': JSON.stringify({
      id: name,
      name,
      metaData: {
        name,
        type: 'app',
        buildInfo: { buildVersion: '1.0.0', buildName: name },
        remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
        ssrRemoteEntry: {
          name: 'remoteEntry.ssr.js',
          path: '',
          type: 'module',
        },
        types: { path: '', name: '' },
        globalName: name,
        pluginVersion: '1.24.0',
        publicPath: base,
      },
      shared: [],
      remotes: [],
      exposes: [
        {
          id: `${name}:Probe`,
          name: 'Probe',
          assets: {
            js: { async: [], sync: [] },
            css: { async: [], sync: [] },
          },
          path: './Probe',
        },
      ],
    }),
    'remoteEntry.ssr.js': remoteEntry(name),
    'assets/Probe.cjs': probeChunk(build),
  }
  const descriptor: RemoteComponentDescriptor = {
    remote: name,
    name,
    buildId: build,
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: {
      integrity: Object.fromEntries(
        Object.entries(files).map(([path, text]) => [path, sri(text)])
      ),
    },
    maxBuilds: 5,
    shared: {
      'components-fallback-lib': {
        requiredVersion: '^2.0.0',
        fallback: true,
        version: '2.0.0',
      },
    },
  }
  return { base, files, descriptor }
}

let served: Map<string, string>
let requests: string[]

const get = async (url: string) => {
  requests.push(url)
  const body = served.get(url)
  return body === undefined
    ? { status: 404, body: new Uint8Array(), headers: {} }
    : { status: 200, body: new TextEncoder().encode(body), headers: {} }
}

function serve(build: ReturnType<typeof remoteBuild>) {
  for (const [path, text] of Object.entries(build.files)) {
    served.set(`${build.base}${path}`, text)
  }
}

type FakeReact = { useState: () => string; version: string; id: string }
const fakeReact = (id: string): FakeReact => ({
  id,
  version: '19.3.1',
  useState: () => id,
})

/** One Next layer: its own React and its own remote component runtime. */
function layer(react: FakeReact, extra: SharedModules = {}) {
  const hostShared: SharedModules = {
    react: { version: react.version, module: react },
    ...extra,
  }
  return createComponentRuntime({
    isServer: true,
    react,
    hostShared,
    createInstance: (options) =>
      createInstance(
        options as unknown as Parameters<typeof createInstance>[0]
      ) as unknown as FederationInstance,
    serverPlugin: (integrityFor, scope) =>
      createServerEntryPlugin({
        integrityFor,
        hostModules: { '@module-federation/runtime': MFRuntime },
        get,
        scope,
      }),
    canLoadServerCode: () => true,
    isTrusted: () => true,
  })
}

type ProbeModule = {
  remoteReact?: FakeReact
  fallbackLib?: unknown
  build: string
}

beforeEach(() => {
  served = new Map()
  requests = []
  rs.spyOn(console, 'warn').mockImplementation(() => {})
  rs.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete (globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__
  rs.restoreAllMocks()
})

const globalKeys = () =>
  Object.keys(globalThis).filter(
    (k) => k === '__mf_module_cache__' || k.startsWith('__mf_init__')
  )

test('each layer renders the remote on its own React (two Reacts, one process)', async () => {
  const build = remoteBuild('mixed_one', 'm1')
  serve(build)
  const appReact = fakeReact('app-router')
  const pagesReact = fakeReact('pages-router')
  const app = layer(appReact)
  const pages = layer(pagesReact)

  const fromApp = (await app.serverLoad(
    build.descriptor,
    './Probe'
  )) as unknown as ProbeModule | null
  const fromPages = (await pages.serverLoad(
    build.descriptor,
    './Probe'
  )) as unknown as ProbeModule | null

  expect(fromApp?.remoteReact).toBe(appReact)
  expect(fromPages?.remoteReact).toBe(pagesReact)
  // Two evaluated copies of the build, one per layer.
  expect(fromApp).not.toBe(fromPages)
  expect(app.serverBlock(build.descriptor)).toBeNull()
  expect(pages.serverBlock(build.descriptor)).toBeNull()
  // Each layer fetched and verified the build itself.
  const entry = `${build.base}remoteEntry.ssr.js`
  expect(requests.filter((u) => u === entry)).toHaveLength(2)
  expect(
    requests.filter((u) => u === `${build.base}mf-manifest.json`)
  ).toHaveLength(2)
  // The process-wide MF vite cache and init keys are never written.
  expect(globalKeys()).toEqual([])
})

test('concurrent first loads in both layers still get their own React', async () => {
  const build = remoteBuild('mixed_two', 'm2')
  serve(build)
  const appReact = fakeReact('app-router')
  const pagesReact = fakeReact('pages-router')
  const app = layer(appReact)
  const pages = layer(pagesReact)
  const [fromApp, fromPages] = (await Promise.all([
    app.serverLoad(build.descriptor, './Probe'),
    pages.serverLoad(build.descriptor, './Probe'),
  ])) as unknown as Array<ProbeModule | null>
  expect(fromApp?.remoteReact).toBe(appReact)
  expect(fromPages?.remoteReact).toBe(pagesReact)
})

test("a fallback copy is seeded per layer: each layer gets its own host's module", async () => {
  const build = remoteBuild('mixed_three', 'm3')
  serve(build)
  const appLib = { lib: 'app' }
  const pagesLib = { lib: 'pages' }
  const app = layer(fakeReact('app-router'), {
    'components-fallback-lib': { version: '2.1.0', module: appLib },
  })
  const pages = layer(fakeReact('pages-router'), {
    'components-fallback-lib': { version: '2.1.0', module: pagesLib },
  })
  const fromApp = (await app.serverLoad(
    build.descriptor,
    './Probe'
  )) as unknown as ProbeModule | null
  const fromPages = (await pages.serverLoad(
    build.descriptor,
    './Probe'
  )) as unknown as ProbeModule | null
  expect(fromApp?.fallbackLib).toBe(appLib)
  expect(fromPages?.fallbackLib).toBe(pagesLib)
  expect(globalKeys()).toEqual([])
})

test('maxBuilds applies per layer', async () => {
  const builds = ['p1', 'p2', 'p3'].map((id) => remoteBuild('mixed_four', id))
  builds.forEach(serve)
  const app = layer(fakeReact('app-router'))
  const pages = layer(fakeReact('pages-router'))
  for (const b of builds) {
    const d = { ...b.descriptor, maxBuilds: 2 }
    await app.serverLoad(d, './Probe')
  }
  await pages.serverLoad({ ...builds[0]!.descriptor, maxBuilds: 2 }, './Probe')
  expect(app.loadedBuilds('mixed_four')).toEqual(['p2', 'p3'])
  expect(pages.loadedBuilds('mixed_four')).toEqual(['p1'])
})

test('an integrity mismatch in one layer is refused in that layer too', async () => {
  const build = remoteBuild('mixed_five', 'm5')
  serve(build)
  const app = layer(fakeReact('app-router'))
  const pages = layer(fakeReact('pages-router'))
  expect(
    (
      (await app.serverLoad(
        build.descriptor,
        './Probe'
      )) as unknown as ProbeModule | null
    )?.build
  ).toBe('m5')
  // The remote now serves different bytes: the second layer verifies the
  // build itself and never evaluates them.
  served.set(`${build.base}assets/Probe.cjs`, 'exports.default = () => null')
  expect(await pages.serverLoad(build.descriptor, './Probe')).toBeNull()
})

test('the process registry hands every server runtime its own scope', async () => {
  const before = componentTrustRegistry().hostRuntimes ?? 0
  const scopes: unknown[] = []
  for (const react of [fakeReact('a'), fakeReact('b')]) {
    const runtime = createComponentRuntime({
      isServer: true,
      react,
      hostShared: {},
      createInstance: () => ({
        registerRemotes() {},
        registerShared() {},
        async loadRemote() {
          return { default: () => null } as never
        },
      }),
      serverPlugin: (_integrityFor, scope) => {
        scopes.push(scope)
        return { name: 'x' }
      },
      canLoadServerCode: () => true,
      isTrusted: () => true,
    })
    await runtime.load(remoteBuild('mixed_six', 's1').descriptor, './Probe')
  }
  expect(componentTrustRegistry().hostRuntimes).toBe(before + 2)
  const [a, b] = scopes as Array<{ id: string; globals: object }>
  expect(a!.id).not.toBe(b!.id)
  expect(a!.globals).not.toBe(b!.globals)
})
