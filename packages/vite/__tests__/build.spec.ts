// Builds the real island-remote fixture with Vite's builder API and checks the
// output. Needs the workspace packages built (`pnpm build`): the fixture's
// vite.config.ts and the remote's runtime resolve `@next-federation/*` from
// their `dist`, exactly as a remote app does.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineFederation } from '@next-federation/core'
import { mintIslandToken, publicJwks } from '@next-federation/core/identity'
import { generateSigningKey } from '@next-federation/core/identity'
import {
  islandSharedEntry,
  islandShareScope,
  parseEnvelope,
} from '@next-federation/protocol'
import type { IslandEnvelope } from '@next-federation/protocol'
import { createBuilder } from 'vite'
import type { Plugin } from 'vite'
import { nextFederationIslands } from '../src/index.ts'

const fixture = resolve(
  import.meta.dirname,
  '../../../test/fixtures/island-remote'
)
// Inside the fixture, so the built server code resolves its imports the way
// `nf-serve` does (strict pnpm: only the fixture's own node_modules).
const out = join(fixture, 'dist/a/t1')
const tmp = join(fixture, 'src/.nf-build-spec')

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

let info: Record<string, unknown>
let clientJs: string
let clientFiles: Record<string, string>
let entryChunk: string
let handler: (req: Request) => Promise<Response>

async function island(
  name: string,
  props: unknown,
  headers?: Record<string, string>
): Promise<{ res: Response; env: IslandEnvelope | null }> {
  const res = await handler(
    new Request(`http://127.0.0.1:4100/_nf/island/${name}?p=${b64(props)}`, {
      headers,
    })
  )
  const env = res.ok ? parseEnvelope(await res.clone().json()) : null
  return { res, env }
}

const ENV_KEYS = ['NODE_ENV', 'NF_BUILD_ID', 'NF_REMOTE', 'PORT'] as const
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
)
function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
}

/** Newest mtime of any file under `dir`. */
function newestMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const mtime = entry.isDirectory()
      ? newestMtime(path)
      : statSync(path).mtimeMs
    newest = Math.max(newest, mtime)
  }
  return newest
}

beforeAll(async () => {
  // The fixture's vite.config.ts loads this package from dist: fail fast
  // instead of testing a stale build.
  const distIndex = join(import.meta.dirname, '../dist/index.js')
  if (!existsSync(distIndex)) {
    throw new Error(
      'build.spec needs the workspace packages built: run `pnpm build`.'
    )
  }
  if (
    newestMtime(join(import.meta.dirname, '../src')) >
    statSync(distIndex).mtimeMs
  ) {
    throw new Error(
      'packages/vite/dist is older than packages/vite/src: run `pnpm build` (or `pnpm --filter @next-federation/vite build`).'
    )
  }
  // The build and the built handler run in production mode, as under nf-serve
  // (rstest sets NODE_ENV=test). Restored exactly in afterAll.
  process.env.NODE_ENV = 'production'
  process.env.NF_BUILD_ID = 't1'
  delete process.env.NF_REMOTE
  delete process.env.PORT
  await rm(out, { recursive: true, force: true })
  try {
    const builder = await createBuilder({
      root: fixture,
      configFile: join(fixture, 'vite.config.ts'),
      logLevel: 'error',
    })
    await builder.buildApp()
  } finally {
    // NODE_ENV stays 'production' while the built handler is exercised.
    if (savedEnv.NF_BUILD_ID === undefined) delete process.env.NF_BUILD_ID
    else process.env.NF_BUILD_ID = savedEnv.NF_BUILD_ID
  }

  info = JSON.parse(await readFile(join(out, 'nf-build.json'), 'utf8'))
  const assets = join(out, 'client/assets')
  const files = (await readdir(assets)).filter((f) => f.endsWith('.js'))
  const sources = await Promise.all(
    files.map((f) => readFile(join(assets, f), 'utf8'))
  )
  clientJs = sources.join('\n')
  clientFiles = Object.fromEntries(files.map((f, i) => [f, sources[i]!]))
  entryChunk = sources[files.findIndex((f) => f.startsWith('index-'))] ?? ''
  handler = (await import(pathToFileURL(join(out, 'rsc/index.js')).href))
    .default
}, 180000)

afterAll(async () => {
  restoreEnv()
  await rm(out, { recursive: true, force: true })
  await rm(tmp, { recursive: true, force: true })
})

test('writes nf-build.json with the pinned base', () => {
  expect(info).toMatchObject({
    name: 'a',
    buildId: 't1',
    base: 'http://127.0.0.1:4100/b/t1/',
  })
  expect(typeof info.builtAt).toBe('number')
})

test('marks the build as ES modules so nf-serve loads it on Node 20', async () => {
  // Node < 22 treats a .js file as CommonJS unless the nearest package.json
  // says "type": "module", e.g. when only the build folder is deployed.
  const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))
  expect(pkg).toEqual({ type: 'module' })
})

test('the client entry keeps its mountIsland export', () => {
  expect(entryChunk).toMatch(/export\s*\{[^}]*mountIsland/)
})

test('client chunks reference the scoped registry and no plugin-rsc page globals', () => {
  // The minifier may turn the key's quotes into backticks.
  expect(clientJs).toMatch(
    /__nf_rsc__\[["`]http:\/\/127\.0\.0\.1:4100\/b\/t1\/["`]\]/
  )
  expect(clientJs).not.toMatch(
    /__vite_rsc_require__|__viteRscCallServer|__vite_rsc_client_require__|__webpack_require__|__webpack_chunk_load__/
  )
})

test('the built handler serves an envelope with css for every island that imports css', async () => {
  const { env } = await island('ProductPanel', { sku: 'A1' })
  expect(env!.mode).toBe('production')
  expect(env!.css[0]).toMatch(
    /^http:\/\/127\.0\.0\.1:4100\/b\/t1\/assets\/.+\.css$/
  )
  expect(env!.bootstrap).toMatch(
    /^http:\/\/127\.0\.0\.1:4100\/b\/t1\/assets\/.+\.js$/
  )
  expect(env!.html).not.toMatch(/<script|<link/)
  expect(env!.html).toContain('nf-product-panel')

  // Banner imports the same stylesheet; Links and Slow import none.
  const banner = (await island('Banner', { text: 'hi' })).env!
  expect(banner.css).toEqual(env!.css)
  expect((await island('Links', { slug: 'one' })).env!.css).toEqual([])
  expect((await island('Slow', { ms: 1 })).env!.css).toEqual([])
})

test('Link inside an island renders a plain anchor through the server bridge', async () => {
  const { env } = await island('Links', { slug: 'one' })
  expect(env!.html).toContain('href="/nav/two"')
})

test('one identity store: a private island sees the verified token subject', async () => {
  const ISSUER = 'http://localhost:3999'
  const key = await generateSigningKey('build-spec')
  const federation = defineFederation({
    remotes: { a: { origin: 'http://127.0.0.1:4100' } },
    identity: { issuer: ISSUER, signingKeys: [key] },
  })
  const jwks = await publicJwks(federation)
  const { token } = await mintIslandToken(federation, {
    remote: 'a',
    identity: { sub: 'u1' },
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === `${ISSUER}/jwks`) {
      return new Response(JSON.stringify(jwks), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return realFetch(input, init)
  }) as typeof fetch
  try {
    const anonymous = await island('MyOrders', {})
    expect(anonymous.res.status).toBe(401)
    const { res, env } = await island(
      'MyOrders',
      {},
      { authorization: `Bearer ${token}` }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(env!.html.replaceAll('<!-- -->', '')).toContain('Orders for u1')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the fixture Cart island: forms disabled until hydration, actions run on this build', async () => {
  const { res, env } = await island('Cart', { sku: 'A1' })
  expect(res.status).toBe(200)
  expect(env!.island).toBe('Cart')
  expect(env!.html.match(/<fieldset[^>]*disabled/g)).toHaveLength(5)
  // The actions reach the client component as props: their ids are in the payload.
  const ids = [
    ...env!.rscPayload.matchAll(/"id":"([^"]+#[A-Za-z_$][\w$]*)"/g),
  ].map((m) => m[1]!)
  const whoami = ids.find((id) => id.endsWith('#whoami'))!
  const order = ids.find((id) => id.endsWith('#placeOrder'))!
  const post = (id: string) =>
    handler(
      new Request('http://127.0.0.1:4100/_nf/action?island=Cart', {
        method: 'POST',
        headers: {
          'x-nf-action': id,
          'content-type': 'text/plain;charset=UTF-8',
        },
        body: '[]',
      })
    )
  const who = await post(whoami)
  expect(who.status).toBe(200)
  const text = await who.text()
  expect(text).toContain('"buildId":"t1"')
  expect(text).toContain('"sub":null')
  // placeOrder is wrapped in requireIdentity: no token, no decode.
  const refused = await post(order)
  expect(refused.status).toBe(401)
  expect(await refused.json()).toEqual({ error: 'NF-014' })
})

/** Builds the fixture with one extra island and extra plugins, from src. */
async function buildVariant(
  islandSource: Record<string, string>,
  extraPlugins: Plugin[] = [],
  check?: (outDir: string) => Promise<void>,
  extraOptions: Partial<Parameters<typeof nextFederationIslands>[0]> = {}
): Promise<unknown> {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  for (const [file, code] of Object.entries(islandSource)) {
    await writeFile(join(tmp, file), code)
  }
  try {
    const builder = await createBuilder({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        ...nextFederationIslands({
          name: 'a',
          base: 'http://127.0.0.1:4100/',
          hosts: ['http://localhost:3100'],
          outDir: 'dist/build-spec-variant',
          buildId: 'v',
          islands: { Bad: './src/.nf-build-spec/Bad.tsx' },
          ...extraOptions,
        }),
        ...extraPlugins,
      ],
    })
    await builder.buildApp()
    // The output folder is `<outDir>/<buildId>`.
    if (check) await check(join(fixture, 'dist/build-spec-variant/v'))
    return null
  } catch (error) {
    return error
  } finally {
    await rm(join(fixture, 'dist/build-spec-variant'), {
      recursive: true,
      force: true,
    })
  }
}

test("a 'use client' module importing a 'use server' file fails the build with NF-034", async () => {
  const error = await buildVariant({
    'actions.ts': "'use server'\nexport async function save() {}\n",
    'Button.tsx':
      "'use client'\nimport { save } from './actions'\nexport function Button() { return <button onClick={() => save()}>x</button> }\n",
    'Bad.tsx':
      "import { Button } from './Button'\nexport default function Bad() { return <Button /> }\n",
  })
  const message = String((error as Error | null)?.message)
  expect(message).toContain('NF-034')
  expect(message).toContain('actions.ts')
  expect(message).toContain('Button.tsx')
}, 60000)

// Runs requests against a built `rsc/index.js` in a child process: plugin-rsc's
// server runtime keeps process-wide state, so a second build must not be
// imported into this one (it would take over the fixture build's references).
type BuiltResult = {
  status: number
  type: string | null
  cors: string | null
  body: string
}

function runBuilt(
  dir: string,
  requests: { url: string; init?: RequestInit }[],
  nodeEnv: string | null = 'production'
): BuiltResult[] & { stderr: string } {
  const script = `
    const { default: handler } = await import(${JSON.stringify(pathToFileURL(join(dir, 'rsc/index.js')).href)})
    const out = []
    for (const { url, init } of JSON.parse(process.argv[1])) {
      const res = await handler(new Request(url, init))
      out.push({ status: res.status, type: res.headers.get('content-type'),
        cors: res.headers.get('access-control-allow-origin'), body: await res.text() })
    }
    process.stdout.write(JSON.stringify(out))
  `
  const env: Record<string, string | undefined> = { ...process.env }
  if (nodeEnv === null) delete env.NODE_ENV
  else env.NODE_ENV = nodeEnv
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, JSON.stringify(requests)],
    { cwd: dir, env, encoding: 'utf8' }
  )
  if (run.status !== 0) throw new Error(`built handler failed: ${run.stderr}`)
  return Object.assign(JSON.parse(run.stdout) as BuiltResult[], {
    stderr: run.stderr,
  })
}

test('a Server Component passing a Server Action to <Form> builds, and the route runs it', async () => {
  const error = await buildVariant(
    {
      'actions.ts':
        "'use server'\nexport async function save(n: number) { return n * 2 }\n",
      'Bad.tsx':
        "import { Form } from '@next-federation/island'\nimport { save } from './actions'\nexport default function Bad() { return <Form action={save}><button>x</button></Form> }\n",
    },
    [],
    async (dir) => {
      const [page] = runBuilt(dir, [
        { url: 'http://127.0.0.1:4100/_nf/island/Bad' },
      ])
      expect(page!.status).toBe(200)
      const env = parseEnvelope(JSON.parse(page!.body))
      expect(env.island).toBe('Bad')
      expect(env.html).toMatch(/<fieldset[^>]*disabled/)
      const id = /\$ACTION_ID_([^"]+)"/.exec(env.html)?.[1]
      expect(id).toMatch(/#save$/)
      const text = 'text/plain;charset=UTF-8'
      const [ran, unknown] = runBuilt(dir, [
        {
          url: 'http://127.0.0.1:4100/_nf/action?island=Bad',
          init: {
            method: 'POST',
            headers: {
              'x-nf-action': id!,
              'content-type': text,
              origin: 'http://localhost:3100',
            },
            body: '[21]',
          },
        },
        {
          url: 'http://127.0.0.1:4100/_nf/action',
          init: {
            method: 'POST',
            headers: { 'x-nf-action': 'nope#save', 'content-type': text },
            body: '[]',
          },
        },
      ])
      expect(ran!.status).toBe(200)
      expect(ran!.type).toMatch(/^text\/x-component/)
      expect(ran!.cors).toBe('http://localhost:3100')
      expect(ran!.body).toContain('42')
      expect(unknown!.status).toBe(404)
      expect(JSON.parse(unknown!.body)).toEqual({ error: 'NF-031' })
    }
  )
  expect(error).toBeNull()
}, 60000)

/** The island's action id, read from React's progressive-enhancement input. */
function actionIdOf(dir: string): string {
  const [page] = runBuilt(dir, [
    { url: 'http://127.0.0.1:4100/_nf/island/Bad' },
  ])
  const html = parseEnvelope(JSON.parse(page!.body)).html
  const id = /\$ACTION_ID_([^"]+)"/.exec(html)?.[1]
  if (!id) throw new Error(`no action id in ${html}`)
  return id
}
const postAction = (id: string, body = '[]') => ({
  url: 'http://127.0.0.1:4100/_nf/action',
  init: {
    method: 'POST',
    headers: { 'x-nf-action': id, 'content-type': 'text/plain;charset=UTF-8' },
    body,
  },
})
const FORM_ISLAND =
  "import { Form } from '@next-federation/island'\nimport { save } from './actions'\nexport default function Bad() { return <Form action={save}><button>x</button></Form> }\n"

test('actions.requireIdentity: true answers 401 NF-014 to an unwrapped action without a token', async () => {
  const error = await buildVariant(
    {
      'actions.ts': "'use server'\nexport async function save() { return 1 }\n",
      'Bad.tsx': FORM_ISLAND,
    },
    [],
    async (dir) => {
      const [res] = runBuilt(dir, [postAction(actionIdOf(dir))])
      expect(res!.status).toBe(401)
      expect(JSON.parse(res!.body)).toEqual({ error: 'NF-014' })
    },
    { actions: { requireIdentity: true } }
  )
  expect(error).toBeNull()
}, 60000)

test('a production build redacts action errors even when NODE_ENV is unset, and warns', async () => {
  const error = await buildVariant(
    {
      'actions.ts':
        "'use server'\nexport async function save() { throw new Error('secret detail') }\n",
      'Bad.tsx': FORM_ISLAND,
    },
    [],
    async (dir) => {
      const id = actionIdOf(dir)
      const result = runBuilt(dir, [postAction(id)], null)
      expect(result[0]!.status).toBe(200)
      expect(result[0]!.body).not.toContain('secret detail')
      expect(result.stderr).toContain('NF-033')
      expect(result.stderr).toMatch(/NF-002[^\n]*NODE_ENV/)
    }
  )
  expect(error).toBeNull()
}, 60000)

test('a "use client" island entry fails the build with NF-002', async () => {
  const error = await buildVariant({
    'Bad.tsx': "'use client'\nexport default function Bad() { return null }\n",
  })
  expect(String((error as Error | null)?.message)).toContain('NF-002')
  expect(String((error as Error | null)?.message)).toContain("'use client'")
}, 60000)

test.each(['vite:react-babel', 'vite:react-refresh', 'vite:react-swc'])(
  'adding @vitejs/plugin-react (plugin "%s") fails with NF-002',
  async (name) => {
    const error = await buildVariant(
      { 'Bad.tsx': 'export default function Bad() { return null }\n' },
      [{ name }]
    )
    expect(String((error as Error | null)?.message)).toContain('NF-002')
    expect(String((error as Error | null)?.message)).toContain(name)
  },
  60000
)

test('with sharing on, the flight client chunk is still scoped per build and is not in the share manifest', async () => {
  const names = Object.keys(clientFiles)
  const local = names.filter((f) => /^react-/.test(f))
  // One lazy chunk holds the bundled copies; nothing else is named react*.
  expect(local).toHaveLength(1)
  const copies = clientFiles[local[0]!]!
  expect(copies).toContain('react.transitional.element')
  expect(copies).toMatch(/hydrateRoot/)
  // The flight client stays in this build's own chunks, scoped to its slot.
  expect(copies).not.toMatch(/__nf_rsc__|createFromReadableStream/)
  const scoped = names.filter((f) =>
    /__nf_rsc__\[["`]http:\/\/127\.0\.0\.1:4100\/b\/t1\/["`]\]/.test(
      clientFiles[f]!
    )
  )
  expect(scoped).toHaveLength(1)
  expect(scoped[0]).not.toMatch(/^react-/)
  // The share manifest: the four React entries at the installed version,
  // never the flight client.
  for (const name of [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
  ]) {
    expect(clientJs).toMatch(
      new RegExp(
        `name:["\`]${name.replace('/', '\\/')}["\`],version:["\`]19\\.3\\.1["\`]`
      )
    )
  }
  expect(clientJs).not.toMatch(/name:["`]react-server-dom-webpack/)
  // The entry awaits the share scope before the bootstrap loads.
  expect(entryChunk).toMatch(/await /)
  expect(entryChunk).not.toContain('react.transitional.element')
  // The envelope's reactVersion is the version the build shares under.
  const { env } = await island('ProductPanel', { sku: 'A1' })
  expect(env!.reactVersion).toBe('19.3.1')
})

test('share: false produces the same output shape as before sharing existed', async () => {
  const outDir = 'dist/build-spec-share-off'
  try {
    const builder = await createBuilder({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      plugins: nextFederationIslands({
        name: 'a',
        base: 'http://127.0.0.1:4100/',
        hosts: ['http://localhost:3100'],
        outDir,
        buildId: 'off',
        share: false,
        islands: { ProductPanel: './src/islands/ProductPanel.tsx' },
      }),
    })
    await builder.buildApp()
    const assets = join(fixture, outDir, 'off/client/assets')
    const files = (await readdir(assets)).filter((f) => f.endsWith('.js'))
    const sources = await Promise.all(
      files.map((f) => readFile(join(assets, f), 'utf8'))
    )
    const all = sources.join('\n')
    expect(files.filter((f) => /^(?:react|share)-/.test(f))).toEqual([])
    expect(all).not.toMatch(/__FEDERATION__|island-share|nf-islands/)
    const entry = sources[files.findIndex((f) => f.startsWith('index-'))]!
    // React and the bootstrap are in the entry chunk itself, no boundary.
    expect(entry).toContain('react.transitional.element')
    expect(entry).toMatch(/export\s*\{[^}]*mountIsland/)
    expect(entry).not.toMatch(/bootstrap\.client/)
    expect(all).toMatch(
      /__nf_rsc__\[["`]http:\/\/127\.0\.0\.1:4100\/b\/off\/["`]\]/
    )
  } finally {
    await rm(join(fixture, outDir), { recursive: true, force: true })
  }
}, 120000)

/**
 * Runs a copy of the built client entry, as a host page would import it. A
 * stand-in `document` is enough for Vite's preload helper.
 */
async function runClientEntry(
  copy: string
): Promise<{ mountIsland?: unknown }> {
  const assets = join(out, 'client/assets')
  const dir = join(out, `client-run-${copy}`)
  await cp(assets, dir, { recursive: true })
  const entry = (await readdir(dir)).find(
    (f) => f.startsWith('index-') && f.endsWith('.js')
  )!
  return import(pathToFileURL(join(dir, entry)).href)
}

const g = globalThis as { document?: unknown; __FEDERATION__?: unknown }

test('the built client entry bootstraps whether or not anything on the page provides React', async () => {
  const savedDocument = g.document
  g.document = {
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, addEventListener() {} }),
    head: { appendChild() {} },
  }
  delete g.__FEDERATION__
  try {
    // Nothing provides React (a Next App Router host): this build provides it.
    const first = await runClientEntry('first')
    expect(typeof first.mountIsland).toBe('function')
    const scope = () =>
      (
        g.__FEDERATION__ as {
          __SHARE__: Record<
            string,
            Record<
              string,
              Record<string, Record<string, { from: string; loaded?: boolean }>>
            >
          >
        }
      ).__SHARE__['@next-federation/island-share@1']!['nf-islands']!
    expect(scope().react!['19.3.1']).toMatchObject({
      from: 'http://127.0.0.1:4100/b/t1/',
      loaded: true,
    })
    // A second remote on the same React consumes that provider.
    const second = await runClientEntry('second')
    expect(typeof second.mountIsland).toBe('function')
    expect(Object.keys(scope().react!)).toEqual(['19.3.1'])

    // A host that provides its React: the entries provideHostReact() writes,
    // with the host's own (Node-resolved, same version) React modules.
    delete g.__FEDERATION__
    const require = createRequire(join(fixture, 'package.json'))
    const host = islandShareScope()
    for (const name of [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
    ]) {
      const lib: unknown = require(name)
      const entry = islandSharedEntry('19.3.1', 'host', () =>
        Promise.resolve(() => lib)
      )
      entry.loaded = true
      entry.lib = () => lib
      host[name] = { '19.3.1': entry }
    }
    const third = await runClientEntry('third')
    expect(typeof third.mountIsland).toBe('function')
    expect(scope().react!['19.3.1']!.from).toBe('host')
  } finally {
    if (savedDocument === undefined) delete g.document
    else g.document = savedDocument
    delete g.__FEDERATION__
  }
}, 60000)

/**
 * Bare specifiers reachable from a built `@next-federation/*` entry, following
 * relative imports and other workspace packages through their dist.
 */
async function bareImportsOf(
  pkg: string,
  subpath: string
): Promise<Set<string>> {
  const packages = resolve(import.meta.dirname, '../..')
  const distOf = async (name: string, sub: string) => {
    const dir = join(packages, name.slice('@next-federation/'.length))
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8')
    ) as {
      exports: Record<string, { default: string }>
    }
    return join(dir, manifest.exports[sub]!.default)
  }
  const bare = new Set<string>()
  const seen = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return
    seen.add(file)
    const code = await readFile(file, 'utf8')
    const IMPORT =
      /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g
    for (const match of Array.from(code.matchAll(IMPORT))) {
      const spec = (match[1] ?? match[2])!
      if (spec.startsWith('.')) {
        await visit(join(dirname(file), spec))
      } else if (spec.startsWith('@next-federation/')) {
        const [, name, ...rest] = spec.slice(1).split('/')
        const sub = rest.length ? `./${rest.join('/')}` : '.'
        await visit(await distOf(`@next-federation/${name}`, sub))
      } else bare.add(spec)
    }
  }
  await visit(await distOf(pkg, subpath))
  return bare
}

test('NF-011 guard: the built share-scope entry reaches no React module', async () => {
  const bare = await bareImportsOf('@next-federation/island', './share-scope')
  expect([...bare].filter((s) => /^react(?:-dom)?(?:\/|$)/.test(s))).toEqual([])
  // The walk does see React where it is imported: the bootstrap barrel.
  const barrel = await bareImportsOf('@next-federation/island', './bootstrap')
  expect(barrel.has('react')).toBe(true)
})
