// The real server entries of the two remote builds the loader keeps apart per
// router layer (ISOLATED_SERVER_BUILDS): the Vite components-remote fixture
// (@module-federation/vite) and the Rspack one (@module-federation/enhanced),
// built here, loaded by two layers (two Reacts) in one process. A renamed
// globalThis key in either plugin, or a registry the loader does not scope,
// fails these tests. Needs the workspace packages built (`pnpm build`).
import { execFileSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as MFRuntime from '@module-federation/runtime'
import { createInstance } from '@module-federation/runtime'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type {
  FederationInstance,
  ServerScope,
  SharedModules,
} from '../src/components/runtime.ts'
import {
  ISOLATED_SERVER_BUILDS,
  createServerEntryPlugin,
} from '../src/components/server-loader.ts'

const fixtures = resolve(import.meta.dirname, '../../../test/fixtures')
const OUT = 'dist/.nf-react-spec'

type Build = {
  dir: string
  port: number
  buildId: string
  descriptor: RemoteComponentDescriptor
}

function buildEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  // A remote's own build: not a test environment.
  for (const key of [
    'NODE_ENV',
    'VITEST',
    'JEST_WORKER_ID',
    'NF_COMPONENTS_BUILT_AT',
    'NF_COMPONENTS_SIGNING_KEY',
    'NF_VITE_COMMAND',
    'NF_LANE',
  ]) {
    delete env[key]
  }
  return env
}

async function readBuild(
  fixture: string,
  buildId: string,
  port: number
): Promise<Build> {
  const dir = join(fixtures, fixture, OUT, buildId)
  const file = JSON.parse(
    await readFile(join(dir, 'nf-components.json'), 'utf8')
  ) as Omit<RemoteComponentDescriptor, 'remote' | 'maxBuilds'>
  return {
    dir,
    port,
    buildId,
    descriptor: { ...file, remote: file.name, maxBuilds: 5 },
  }
}

let vite: Build
let vite2: Build
let rspack: Build

beforeAll(async () => {
  const viteFixture = join(fixtures, 'components-remote')
  execFileSync(
    process.execPath,
    [
      join(viteFixture, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--logLevel',
      'error',
    ],
    {
      cwd: viteFixture,
      env: buildEnv({ NF_OUT: OUT, NF_BUILD_ID: 'rv1', PORT: '4997' }),
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  )
  vite = await readBuild('components-remote', 'rv1', 4997)
  // A second build of the same container name ("components").
  execFileSync(
    process.execPath,
    [
      join(viteFixture, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--logLevel',
      'error',
    ],
    {
      cwd: viteFixture,
      env: buildEnv({ NF_OUT: OUT, NF_BUILD_ID: 'rv2', PORT: '4997' }),
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  )
  vite2 = await readBuild('components-remote', 'rv2', 4997)
  const rspackFixture = join(fixtures, 'components-remote-rspack')
  execFileSync(process.execPath, ['scripts/build.ts'], {
    cwd: rspackFixture,
    env: buildEnv({ NF_OUT: OUT, NF_BUILD_ID: 'rr1', PORT: '4996' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  rspack = await readBuild('components-remote-rspack', 'rr1', 4996)
}, 240_000)

afterAll(async () => {
  for (const fixture of ['components-remote', 'components-remote-rspack']) {
    await rm(join(fixtures, fixture, OUT), { recursive: true, force: true })
  }
})

/** Serves both builds from disk, as nf-serve would. */
async function get(url: string) {
  for (const build of [vite, vite2, rspack]) {
    const prefix = `http://127.0.0.1:${build.port}/b/${build.buildId}/`
    if (!url.startsWith(prefix)) continue
    try {
      const body = await readFile(
        join(build.dir, 'client', url.slice(prefix.length))
      )
      return { status: 200, body: new Uint8Array(body), headers: {} }
    } catch {
      break
    }
  }
  return { status: 404, body: new Uint8Array(), headers: {} }
}

type FakeReact = {
  id: string
  version: string
  calls: string[]
  useState: (v: unknown) => [unknown, () => void]
  useContext: (c: unknown) => unknown
}

const fakeReact = (id: string): FakeReact => {
  const react: FakeReact = {
    id,
    version: '19.3.1',
    calls: [],
    useState: (v) => {
      react.calls.push('useState')
      return [v, () => {}]
    },
    useContext: () => {
      react.calls.push('useContext')
      return `context-of-${id}`
    },
  }
  return react
}

type Layer = {
  react: FakeReact
  runtime: ReturnType<typeof createComponentRuntime>
  scopes: ServerScope[]
}

/** One Next layer: its own React, runtime and Module Federation instance. */
function layer(id: string, plugins: unknown[] = []): Layer {
  const react = fakeReact(id)
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const hostShared: SharedModules = {
    react: { version: '19.3.1', module: react },
    'react-dom': { version: '19.3.1', module: { id } },
    'react-dom/client': { version: '19.3.1', module: { id } },
    'react/jsx-runtime': {
      version: '19.3.1',
      module: { jsx, jsxs: jsx, Fragment: 'Fragment' },
    },
    'components-context': {
      version: '1.0.0',
      module: { HostContext: { layer: id } },
    },
  }
  const scopes: ServerScope[] = []
  const runtime = createComponentRuntime({
    isServer: true,
    react,
    hostShared,
    createInstance: (options) =>
      createInstance({
        ...(options as unknown as Parameters<typeof createInstance>[0]),
        plugins: [
          ...(options.plugins as Parameters<
            typeof createInstance
          >[0]['plugins'] &
            unknown[]),
          ...(plugins as never[]),
        ],
      }) as unknown as FederationInstance,
    serverPlugin: (integrityFor, scope) => {
      scopes.push(scope)
      return createServerEntryPlugin({
        integrityFor,
        hostModules: { '@module-federation/runtime': MFRuntime },
        get,
        scope,
      })
    },
    canLoadServerCode: () => true,
    isTrusted: () => true,
  })
  return { react, runtime, scopes }
}

type Loaded = {
  default: (props: { start?: number }) => unknown
  remoteReact?: { id?: string }
}

/**
 * The build under test is one the loader isolates: its manifest's
 * pluginVersion and runtime setup are in ISOLATED_SERVER_BUILDS. Otherwise
 * the second layer would render browser-only and these tests would check
 * the fallback instead.
 */
async function expectIsolated(build: Build, bundlesRuntime: boolean) {
  const manifest = JSON.parse(
    await readFile(join(build.dir, 'client', 'mf-manifest.json'), 'utf8')
  ) as { metaData: { pluginVersion: string } }
  expect(
    ISOLATED_SERVER_BUILDS.filter(
      (b) =>
        b.pluginVersion === manifest.metaData.pluginVersion &&
        b.bundlesRuntime === bundlesRuntime
    ),
    `pluginVersion ${manifest.metaData.pluginVersion} is not in ISOLATED_SERVER_BUILDS`
  ).toHaveLength(1)
}

const MF_KEY = /^__mf_|^__FEDERATION|^__VMOK__|^__GLOBAL_LOADING/

beforeEach(() => {
  rs.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})

test('Vite build: each layer gets its own share cache and init state, nothing new on globalThis', async () => {
  await expectIsolated(vite, false)
  const before = new Set(Object.getOwnPropertyNames(globalThis))
  const app = layer('app')
  const pages = layer('pages')
  const fromApp = (await app.runtime.serverLoad(
    vite.descriptor,
    './Counter'
  )) as unknown as Loaded | null
  const fromPages = (await pages.runtime.serverLoad(
    vite.descriptor,
    './Counter'
  )) as unknown as Loaded | null
  expect(fromApp).not.toBeNull()
  expect(fromPages).not.toBeNull()
  expect(fromApp).not.toBe(fromPages)
  // The remote renders on its layer's React.
  fromApp!.default({ start: 1 })
  expect(app.react.calls).toEqual(['useContext', 'useState'])
  expect(pages.react.calls).toEqual([])
  fromPages!.default({ start: 1 })
  expect(pages.react.calls).toEqual(['useContext', 'useState'])
  // Its state lives in each layer's scope, under the keys the loader scopes.
  for (const [l, id] of [
    [app, 'app'],
    [pages, 'pages'],
  ] as const) {
    const globals = l.scopes.at(-1)!.globals as {
      __mf_module_cache__?: { share: Record<string, { id?: string }> }
    }
    expect(globals.__mf_module_cache__?.share['default:react']?.id).toBe(id)
    expect(Object.keys(globals).some((k) => k.startsWith('__mf_init__'))).toBe(
      true
    )
  }
  // A renamed key would land on the real globalThis.
  const added = Object.getOwnPropertyNames(globalThis).filter(
    (k) => !before.has(k)
  )
  expect(added.filter((k) => MF_KEY.test(k))).toEqual([])
  expect(added).toEqual([])
}, 60_000)

test('Rspack build: layer A gets its own React even when layer B initialises between its init and get', async () => {
  await expectIsolated(rspack, true)
  let bInitialised!: () => void
  const bInit = new Promise<void>((r) => (bInitialised = r))
  // Layer A waits, after its container's init, until B's container is
  // initialised: then A resolves its shared modules (A.init, B.init, A.get).
  const a = layer('app', [
    {
      name: 'test-a-waits-for-b',
      async beforeGetExpose(args: unknown) {
        await bInit
        return args
      },
    },
  ])
  const b = layer('pages', [
    {
      name: 'test-b-signals',
      async afterInitRemote(args: unknown) {
        bInitialised()
        return args
      },
    },
  ])
  const [fromA, fromB] = (await Promise.all([
    a.runtime.serverLoad(rspack.descriptor, './Counter'),
    b.runtime.serverLoad(rspack.descriptor, './Counter'),
  ])) as unknown as Array<Loaded | null>
  expect(fromA).not.toBeNull()
  expect(fromB).not.toBeNull()
  expect(fromA!.remoteReact?.id).toBe('app')
  expect(fromB!.remoteReact?.id).toBe('pages')
  // Rendering A's component calls A's hooks only.
  fromA!.default({ start: 1 })
  expect(a.react.calls).toEqual(['useContext', 'useState'])
  expect(b.react.calls).toEqual([])
  fromB!.default({ start: 1 })
  expect(b.react.calls).toEqual(['useContext', 'useState'])
  // Its runtime registry is per layer: nothing of it on the real one.
  const fed = (
    globalThis as {
      __FEDERATION__?: { __INSTANCES__: Array<{ name: string }> }
    }
  ).__FEDERATION__
  expect(
    (fed?.__INSTANCES__ ?? []).some((i) => i.name === 'components_rspack')
  ).toBe(false)
}, 60_000)

/** The build id the Counter of a loaded module renders (data-build). */
function renderedBuild(mod: Loaded | null): unknown {
  const tree = mod?.default({ start: 0 }) as {
    props?: { 'data-build'?: unknown }
  } | null
  return tree?.props?.['data-build']
}

test('two builds of one container name loaded at once: each gets its own build, in one layer and across two', async () => {
  await expectIsolated(vite, false)
  const errors = rs.spyOn(console, 'error').mockImplementation(() => {})
  const app = layer('app')
  const pages = layer('pages')
  const loads = (await Promise.all([
    app.runtime.serverLoad(vite.descriptor, './Counter'),
    pages.runtime.serverLoad(vite2.descriptor, './Counter'),
    app.runtime.serverLoad(vite2.descriptor, './Counter'),
    pages.runtime.serverLoad(vite.descriptor, './Counter'),
  ])) as unknown as Array<Loaded | null>
  expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([])
  expect(loads.map(renderedBuild)).toEqual(['rv1', 'rv2', 'rv2', 'rv1'])
}, 60_000)

test('another build of the container after a new MF instance (a module registered late) loads that build, not the one loaded before', async () => {
  await expectIsolated(vite, false)
  const errors = rs.spyOn(console, 'error').mockImplementation(() => {})
  const app = layer('app')
  const first = (await app.runtime.serverLoad(
    vite.descriptor,
    './Counter'
  )) as unknown as Loaded | null
  expect(renderedBuild(first)).toBe('rv1')
  // A shared module the instance did not have: the next load starts over.
  app.runtime.registerShared({
    'late-module': { version: '1.0.0', module: {} },
  })
  const second = (await app.runtime.serverLoad(
    vite2.descriptor,
    './Counter'
  )) as unknown as Loaded | null
  expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([])
  expect(renderedBuild(second)).toBe('rv2')
}, 60_000)
