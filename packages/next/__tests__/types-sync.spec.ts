// nf-types: downloads the type declarations a components remote's build
// lists in its descriptor (only from a verified descriptor, only from the
// remote's origins, each file checked against its sha384; nothing is run)
// and generates the host's `RemoteProps` mapping.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { defineFederation } from '@next-federation/core'
import {
  canonicalJson,
  componentDescriptorDigest,
} from '@next-federation/protocol'
import type {
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
} from '@next-federation/protocol'
import * as ts from 'typescript'
import {
  replaceFolder,
  runTypesCli,
  syncRemoteTypes,
} from '../src/types/sync.ts'

const sri = (text: string | Buffer) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

const ENTRY =
  "export * from './compiled-types/Counter.js'\nexport { default } from './compiled-types/Counter.js'\n"
const COUNTER =
  "export default function Counter({ start }: {\n    start?: number;\n}): import('react').JSX.Element;\n"

let server: Server
let origin: string
type Route = {
  status?: number
  body?: string | Buffer
  location?: string
  /** Answers the request itself (streams, drips). */
  handle?: (res: import('node:http').ServerResponse) => void
}
let routes: Record<string, Route>
let hits: string[]
let outDir: string

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url!)
    const route = routes[req.url!]
    if (!route) {
      res.statusCode = 404
      return res.end()
    }
    if (route.handle) return route.handle(res)
    res.statusCode = route.status ?? 200
    if (route.location) res.setHeader('location', route.location)
    res.end(route.body ?? '')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

// Inside the package (not the OS tmpdir): the typecheck below resolves
// `react` from the workspace.
const scratch = resolve(import.meta.dirname, '.types-sync-scratch')

beforeEach(async () => {
  hits = []
  await mkdir(scratch, { recursive: true })
  outDir = await mkdtemp(join(scratch, 'out-'))
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string }

function keyPair(): { priv: KeyObject; pub: PublicJwk } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const pub = {
    ...(publicKey.export({ format: 'jwk' }) as Omit<PublicJwk, 'kid'>),
    kid: 'k1',
  }
  return { priv: privateKey, pub }
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/** A compact ES256 JWS of the canonical payload, as remotes sign it. */
function jwsOf(p: ComponentBuildDescriptor, key: KeyObject): string {
  const header = { alg: 'ES256', kid: 'k1', typ: 'nf-components+jws' }
  const input = `${b64(JSON.stringify(header))}.${b64(canonicalJson(p))}`
  const signature = sign('sha256', Buffer.from(input), {
    key,
    dsaEncoding: 'ieee-p1363',
  })
  return `${input}.${b64(signature)}`
}

const FILES: Record<string, string | Buffer> = {
  '@mf-types/Counter.d.ts': ENTRY,
  '@mf-types/compiled-types/Counter.d.ts': COUNTER,
}

/** The index a build publishes for `files` (canonical JSON, as nf-describe writes it). */
function indexOf(files: Record<string, string | Buffer> = FILES) {
  return {
    exposes: { './Counter': '@mf-types/Counter.d.ts' },
    files: Object.fromEntries(
      Object.entries(files).map(([path, body]) => [path, sri(body)])
    ),
  }
}

const indexBody = (index: unknown) => `${canonicalJson(index)}\n`

function payload(
  index: unknown = indexOf(),
  base = `${origin}/b/c1/`
): ComponentBuildDescriptor {
  return {
    v: 1,
    name: 'components',
    buildId: 'c1',
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: null,
    types: {
      index: `${base}@mf-types/index.json`,
      integrity: sri(indexBody(index)),
    },
  }
}

async function publish(
  p: ComponentBuildDescriptor,
  priv?: KeyObject,
  bodies: Record<string, string | Buffer> = FILES,
  index: unknown = indexOf()
): Promise<ComponentDescriptorFile> {
  const digest = await componentDescriptorDigest(p)
  let file: ComponentDescriptorFile = { ...p, digest }
  if (priv) file = { ...file, jws: jwsOf(p, priv) }
  routes = {
    '/_nf/components.json': { body: JSON.stringify(file) },
    '/b/c1/@mf-types/index.json': { body: indexBody(index) },
  }
  for (const [path, body] of Object.entries(bodies)) {
    routes[`/b/c1/${path}`] = { body }
  }
  return file
}

function federation(ssr: Record<string, unknown> | false) {
  return defineFederation({
    remotes: { components: { origin, components: { ssr } as never } },
  })
}

test('a signed build: downloads its declarations and writes the RemoteProps mapping', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results).toEqual([
    {
      remote: 'components',
      status: 'written',
      buildId: 'c1',
      trust: 'signature',
      files: 2,
    },
  ])
  expect(
    await readFile(
      join(outDir, 'components/@mf-types/compiled-types/Counter.d.ts'),
      'utf8'
    )
  ).toBe(COUNTER)
  const index = await readFile(join(outDir, 'index.d.ts'), 'utf8')
  expect(index).toContain('interface NextFederationRemoteComponents')
  expect(index).toContain(
    `"./Counter": typeof import("./components/@mf-types/Counter.js")`
  )
})

test('leftover staging folders of a crashed run are removed first', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  const uuid = '123e4567-e89b-42d3-a456-426614174000'
  const leftovers = [`.components-${uuid}`, `.components-old-${uuid}`]
  // Another remote's (or the user's) folders stay.
  const kept = [`.components-b-${uuid}`, '.keep']
  for (const name of [...leftovers, ...kept]) {
    await mkdir(join(outDir, name, 'x'), { recursive: true })
  }
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'written' })
  expect((await readdir(outDir)).sort()).toEqual(
    [...kept, 'components', 'index.d.ts'].sort()
  )
})

test('a pinned build verifies too', async () => {
  const p = payload()
  await publish(p)
  const results = await syncRemoteTypes({
    federation: federation({
      pinned: { c1: await componentDescriptorDigest(p) },
    }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'written', trust: 'pinned' })
})

test('an unverified descriptor (unsigned, not pinned) is refused before any file is fetched (NF-028)', async () => {
  const { pub } = keyPair()
  await publish(payload())
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-028' })
  expect(hits).toEqual(['/_nf/components.json'])
  expect(existsSync(join(outDir, 'components'))).toBe(false)
})

test('a file that does not match its sha384 is refused, and the previous types are kept (NF-027)', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  const fed = federation({ publicKeys: [pub] })
  await syncRemoteTypes({ federation: fed, outDir })
  await publish(payload(), priv, {
    ...FILES,
    '@mf-types/compiled-types/Counter.d.ts': 'export default any\n',
  })
  const results = await syncRemoteTypes({ federation: fed, outDir })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-027' })
  expect(
    await readFile(
      join(outDir, 'components/@mf-types/compiled-types/Counter.d.ts'),
      'utf8'
    )
  ).toBe(COUNTER)
})

test('a build served from another origin is refused (NF-005)', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(indexOf(), 'https://evil.example/b/c1/'), priv)
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-005' })
})

test('a redirected file is refused (never followed off the build)', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  routes['/b/c1/@mf-types/Counter.d.ts'] = {
    status: 302,
    body: '',
    location: 'https://evil.example/x.d.ts',
  }
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-029' })
  expect(existsSync(join(outDir, 'components'))).toBe(false)
})

test('a file over the size limit is refused', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
    maxFileBytes: 16,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-029' })
})

test('a build without types is reported, nothing is written', async () => {
  const { priv, pub } = keyPair()
  const withoutTypes = payload()
  delete withoutTypes.types
  await publish(withoutTypes, priv)
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'none', buildId: 'c1' })
  expect(existsSync(join(outDir, 'components'))).toBe(false)
})

test('a build that stops publishing types removes the previous ones and their index entry', async () => {
  const { priv, pub } = keyPair()
  const fed = federation({ publicKeys: [pub] })
  await publish(payload(), priv)
  await syncRemoteTypes({ federation: fed, outDir })
  expect(existsSync(join(outDir, 'components', 'nf-types.json'))).toBe(true)
  expect(await readFile(join(outDir, 'index.d.ts'), 'utf8')).toContain(
    '"components": {'
  )
  const withoutTypes = payload()
  delete withoutTypes.types
  await publish(withoutTypes, priv)
  const results = await syncRemoteTypes({ federation: fed, outDir })
  expect(results[0]).toMatchObject({ status: 'none', buildId: 'c1' })
  expect(existsSync(join(outDir, 'components'))).toBe(false)
  const index = await readFile(join(outDir, 'index.d.ts'), 'utf8')
  expect(index).toContain('interface NextFederationRemoteComponents')
  expect(index).not.toContain('components')
})

test('an index that does not match its signed sha384 is refused before any declaration is fetched (NF-027)', async () => {
  const { priv, pub } = keyPair()
  const forged = indexOf({
    ...FILES,
    '@mf-types/compiled-types/Counter.d.ts': 'export default any\n',
  })
  await publish(payload(), priv, FILES, forged)
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-027' })
  expect(hits).toEqual(['/_nf/components.json', '/b/c1/@mf-types/index.json'])
})

test.each([
  ['an encoded parent segment', '%2e%2e/x.d.ts'],
  ['a drive letter segment', 'a/C:/x.d.ts'],
  ['a parent segment', '@mf-types/../../x.d.ts'],
])(
  'a signed index with %s is refused, nothing is fetched or written',
  async (_name, path) => {
    const { priv, pub } = keyPair()
    const index = {
      exposes: {},
      files: { [path]: sri('export {}\n') },
    }
    await publish(payload(index), priv, {}, index)
    const results = await syncRemoteTypes({
      federation: federation({ publicKeys: [pub] }),
      outDir,
    })
    expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-029' })
    expect(hits).toEqual(['/_nf/components.json', '/b/c1/@mf-types/index.json'])
    expect(existsSync(join(outDir, 'components'))).toBe(false)
  }
)

test('the total budget of a build is enforced', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
    maxTotalBytes: ENTRY.length + 10,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-029' })
  expect(existsSync(join(outDir, 'components'))).toBe(false)
})

test('declarations are hashed and written as raw bytes (a BOM is kept)', async () => {
  const { priv, pub } = keyPair()
  const bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(COUNTER),
  ])
  const files = { ...FILES, '@mf-types/compiled-types/Counter.d.ts': bom }
  await publish(payload(indexOf(files)), priv, files, indexOf(files))
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'written' })
  expect(
    await readFile(
      join(outDir, 'components/@mf-types/compiled-types/Counter.d.ts')
    )
  ).toEqual(bom)
})

test('a body without content-length over the limit is refused without buffering it', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  let written = 0
  routes['/b/c1/@mf-types/Counter.d.ts'] = {
    handle(res) {
      res.writeHead(200) // chunked: no content-length
      const chunk = Buffer.alloc(64 * 1024, 32)
      const pump = () => {
        while (written < 64 * 1024 * 1024 && res.write(chunk)) {
          written += chunk.length
        }
        if (written < 64 * 1024 * 1024) res.once('drain', pump)
        else res.end()
      }
      res.on('close', () => res.removeAllListeners('drain'))
      pump()
    },
  }
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-029' })
  expect(written).toBeLessThan(16 * 1024 * 1024)
})

test('a slow drip is cut at the size limit', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  routes['/b/c1/@mf-types/Counter.d.ts'] = {
    handle(res) {
      res.writeHead(200)
      const timer = setInterval(() => res.write('xxxxxxxx'), 5)
      res.on('close', () => clearInterval(timer))
    },
  }
  const started = performance.now()
  const results = await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
    maxFileBytes: 64,
  })
  expect(results[0]).toMatchObject({ status: 'failed', code: 'NF-029' })
  expect(performance.now() - started).toBeLessThan(2000)
})

test('unsafe-dev trust syncs (development only) and the CLI warns about it', async () => {
  await publish(payload())
  const config = join(outDir, 'federation-dev.mjs')
  await writeFile(
    config,
    `import { defineFederation } from '@next-federation/core'\nexport default defineFederation({ remotes: { components: { origin: ${JSON.stringify(origin)}, components: { ssr: { integrity: 'unsafe-dev' } } } } })\n`
  )
  const lines: string[] = []
  expect(
    await runTypesCli(['--config', config, '--out', join(outDir, 'dev')], (l) =>
      lines.push(l)
    )
  ).toBe(0)
  expect(lines.join('\n')).toMatch(/unsafe-dev/)
  expect(lines.join('\n')).toMatch(/warning/i)
})

test('the CLI loads the federation module, syncs and exits 1 on a failure', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  // A host's federation module (plain ESM; resolves the workspace package).
  const config = join(outDir, 'federation.mjs')
  await writeFile(
    config,
    `import { defineFederation } from '@next-federation/core'\nexport const federation = defineFederation({ remotes: { components: { origin: ${JSON.stringify(origin)}, components: { ssr: { publicKeys: [${JSON.stringify(pub)}] } } } } })\n`
  )
  const lines: string[] = []
  const out = join(outDir, 'cli')
  expect(
    await runTypesCli(['--config', config, '--out', out], (line) =>
      lines.push(line)
    )
  ).toBe(0)
  expect(existsSync(join(out, 'index.d.ts'))).toBe(true)
  expect(lines.join('\n')).toMatch(/components: build c1, 2 files/)

  await publish(payload())
  expect(
    await runTypesCli(['--config', config, '--out', out], (line) =>
      lines.push(line)
    )
  ).toBe(1)
  expect(lines.join('\n')).toMatch(/NF-028/)
  expect(await runTypesCli(['--nope'], (line) => lines.push(line))).toBe(1)
})

test('typecheck: RemoteProps gives the remote’s real props, and a wrong prop fails tsc', async () => {
  const { priv, pub } = keyPair()
  await publish(payload(), priv)
  await syncRemoteTypes({
    federation: federation({ publicKeys: [pub] }),
    outDir,
  })
  const consumer = join(outDir, 'consumer.tsx')
  await writeFile(
    consumer,
    [
      "import { createRemoteComponent } from '@next-federation/next/components'",
      "import type { RemoteProps } from '@next-federation/next/components'",
      '',
      'const Counter = createRemoteComponent<',
      "  RemoteProps<'components', './Counter'>",
      ">({ expose: './Counter' })",
      '',
      'export const ok = <Counter descriptor={null} start={1} />',
      'export const wrong = <Counter descriptor={null} start="one" />',
      '',
    ].join('\n')
  )
  const src = (path: string) => resolve(import.meta.dirname, '../..', path)
  const program = ts.createProgram([consumer, join(outDir, 'index.d.ts')], {
    strict: true,
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    types: [],
    paths: {
      '@next-federation/next/components': [
        src('next/src/client/components.tsx'),
      ],
      '@next-federation/react/components': [
        src('react/src/components/index.tsx'),
      ],
    },
  })
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === consumer)
    .map((d) => ({
      line: d.file!.getLineAndCharacterOfPosition(d.start!).line + 1,
      text: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }))
  expect(errors).toHaveLength(1)
  expect(errors[0]!.line).toBe(9)
  expect(errors[0]!.text).toMatch(/string.*number|number/)
}, 30_000)

describe('replaceFolder: the previous types survive a failed swap', () => {
  async function setup() {
    const folder = join(outDir, 'components')
    const staging = join(outDir, '.components-new')
    await mkdir(folder)
    await writeFile(join(folder, 'a.d.ts'), 'old')
    await mkdir(staging)
    await writeFile(join(staging, 'a.d.ts'), 'new')
    return { folder, staging }
  }

  test('swaps in the staged folder and removes the old one', async () => {
    const { folder, staging } = await setup()
    await replaceFolder(staging, folder)
    expect(await readFile(join(folder, 'a.d.ts'), 'utf8')).toBe('new')
    expect((await readdir(outDir)).sort()).toEqual(['components'])
  })

  test('the old folder is never removed before the new one is in place', async () => {
    const { folder, staging } = await setup()
    const calls: string[] = []
    const error = await replaceFolder(staging, folder, {
      rename: async (from, to) => {
        calls.push(`rename ${from} -> ${to}`)
        // The staged folder cannot be moved in (a crash, a full disk).
        if (from === staging) throw new Error('EIO')
        await rename(from, to)
      },
      rm: async (path, opts) => {
        calls.push(`rm ${path}`)
        await rm(path, opts)
      },
    }).catch((e: unknown) => e)
    expect(String(error)).toMatch(/EIO/)
    expect(await readFile(join(folder, 'a.d.ts'), 'utf8')).toBe('old')
    expect(calls.some((c) => c === `rm ${folder}`)).toBe(false)
    expect((await readdir(outDir)).sort()).toEqual([
      '.components-new',
      'components',
    ])
  })

  test('a first sync (no previous folder) just moves the staged folder in', async () => {
    const folder = join(outDir, 'fresh')
    const staging = join(outDir, '.fresh-new')
    await mkdir(staging)
    await writeFile(join(staging, 'a.d.ts'), 'new')
    await replaceFolder(staging, folder)
    expect(await readFile(join(folder, 'a.d.ts'), 'utf8')).toBe('new')
  })
})
