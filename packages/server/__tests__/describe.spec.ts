// nf-describe: any built Module Federation 2.0 remote (Rspack, webpack, Vite)
// in nf-serve's layout -> the next-federation components descriptor.
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  componentDescriptorDigest,
  parseComponentDescriptorFile,
} from '@next-federation/protocol'
import type { ComponentBuildDescriptor } from '@next-federation/protocol'
import { compactVerify, importJWK } from 'jose'
import type { JWK } from 'jose'
import {
  describeComponentsBuild,
  runDescribeCli,
  verifyComponentsBuild,
} from '../src/node/describe.ts'

const sri = (bytes: string | Buffer) =>
  `sha384-${createHash('sha384').update(bytes).digest('base64')}`

const BASE = 'https://shop.example/b/r1/'
const ENTRY = 'module.exports = { get() {}, init() {} }'

/** An Rspack-style build: no ssrRemoteEntry in the browser manifest. */
async function rspackBuild(
  manifest: Record<string, unknown> = {}
): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'nf-describe-'))
  const dir = join(root, 'r1')
  await mkdir(join(dir, 'client', 'server'), { recursive: true })
  await writeFile(
    join(dir, 'client', 'mf-manifest.json'),
    JSON.stringify({
      id: 'shop',
      name: 'shop',
      metaData: {
        name: 'shop',
        publicPath: BASE,
        remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
        ...manifest,
      },
      exposes: [
        {
          path: './Counter',
          assets: {
            js: { sync: ['__federation_expose_Counter.mjs'], async: [] },
            css: { sync: ['counter.css'], async: [] },
          },
        },
      ],
    })
  )
  await writeFile(join(dir, 'client', 'remoteEntry.js'), 'export {}')
  await writeFile(join(dir, 'client', 'server', 'remoteEntry.js'), ENTRY)
  return { root, dir }
}

const readJson = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

function privateJwk(): JWK {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { ...(privateKey.export({ format: 'jwk' }) as JWK), kid: 'k1' }
}

test('records the server entry in the manifest, then hashes the manifest and the server graph', async () => {
  const build = await rspackBuild()
  root = build.root
  const { file } = await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
    now: 1_700_000_000_000,
  })
  const manifestBytes = await readFile(
    join(build.dir, 'client', 'mf-manifest.json')
  )
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    metaData: { ssrRemoteEntry: unknown }
  }
  expect(manifest.metaData.ssrRemoteEntry).toEqual({
    name: 'remoteEntry.js',
    path: 'server',
    type: 'commonjs-module',
  })
  expect(file).toMatchObject({
    v: 1,
    name: 'shop',
    buildId: 'r1',
    base: BASE,
    manifest: `${BASE}mf-manifest.json`,
    iat: 1_700_000_000,
    // Exactly what the Vite plugin signs: the entry and each expose's sync files.
    assets: {
      entry: `${BASE}remoteEntry.js`,
      exposes: {
        './Counter': {
          css: [`${BASE}counter.css`],
          js: [`${BASE}__federation_expose_Counter.mjs`],
        },
      },
    },
    ssr: {
      integrity: {
        'mf-manifest.json': sri(manifestBytes),
        'server/remoteEntry.js': sri(ENTRY),
      },
    },
  })
  expect(file.jws).toBeUndefined()
  // The published files: what nf-serve serves.
  expect(parseComponentDescriptorFile(file)).toEqual(file)
  expect(await readJson(join(build.dir, 'nf-components.json'))).toEqual(file)
  expect(await readJson(join(build.dir, 'nf-build.json'))).toEqual({
    kind: 'components',
    name: 'shop',
    buildId: 'r1',
    builtAt: 1_700_000_000_000,
    base: BASE,
  })
  const { digest, ...payload } = file
  expect(digest).toBe(await componentDescriptorDigest(payload))
})

test('NF_COMPONENTS_SIGNING_KEY signs the descriptor (ES256 JWS of the canonical payload)', async () => {
  const build = await rspackBuild()
  root = build.root
  const jwk = privateJwk()
  const { file } = await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: { NF_COMPONENTS_SIGNING_KEY: JSON.stringify(jwk) },
  })
  const publicJwk = { ...jwk }
  delete publicJwk.d
  const { payload, protectedHeader } = await compactVerify(
    file.jws!,
    await importJWK(publicJwk, 'ES256')
  )
  expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: 'k1' })
  const expected: Record<string, unknown> = { ...file }
  delete expected.digest
  delete expected.jws
  expect(JSON.parse(new TextDecoder().decode(payload))).toEqual(expected)
})

test('a manifest that already names its server entry needs no --ssr-entry', async () => {
  const build = await rspackBuild({
    ssrRemoteEntry: {
      name: 'remoteEntry.js',
      path: 'server',
      type: 'commonjs-module',
    },
  })
  root = build.root
  const before = await readFile(join(build.dir, 'client', 'mf-manifest.json'))
  const { file } = await describeComponentsBuild({ dir: build.dir, env: {} })
  expect(Object.keys(file.ssr!.integrity).sort()).toEqual([
    'mf-manifest.json',
    'server/remoteEntry.js',
  ])
  // Left as built.
  expect(await readFile(join(build.dir, 'client', 'mf-manifest.json'))).toEqual(
    before
  )
})

test('--no-ssr: a browser-only descriptor', async () => {
  const build = await rspackBuild()
  root = build.root
  const { file } = await describeComponentsBuild({
    dir: build.dir,
    ssr: false,
    env: {},
  })
  expect(file.ssr).toBeNull()
})

test('re-describing a build keeps its build time (same digest)', async () => {
  const build = await rspackBuild()
  root = build.root
  const opts = { dir: build.dir, ssrEntry: 'server/remoteEntry.js', env: {} }
  const first = await describeComponentsBuild({ ...opts, now: 1_000_000 })
  const again = await describeComponentsBuild({ ...opts, now: 9_000_000 })
  expect(again.file).toEqual(first.file)
})

test.each([
  [
    'no server entry and no --no-ssr',
    {},
    { ssrEntry: undefined },
    /--ssr-entry/,
  ],
  [
    'a server entry that does not exist',
    {},
    { ssrEntry: 'server/missing.js' },
    /missing\.js/,
  ],
  [
    'a manifest naming another server entry',
    { ssrRemoteEntry: { name: 'other.js', path: '' } },
    { ssrEntry: 'server/remoteEntry.js' },
    /other\.js/,
  ],
  [
    'a relative publicPath ("auto")',
    { publicPath: 'auto' },
    { ssrEntry: 'server/remoteEntry.js' },
    /--base/,
  ],
  [
    'a base that is not unique per build',
    { publicPath: 'https://shop.example/' },
    { ssrEntry: 'server/remoteEntry.js' },
    /r1/,
  ],
  [
    'plain http for a public host',
    { publicPath: 'http://shop.example/b/r1/' },
    { ssrEntry: 'server/remoteEntry.js' },
    /https/,
  ],
  [
    'a container name that is not an identifier',
    { name: 'my-shop' },
    { ssrEntry: 'server/remoteEntry.js' },
    /my-shop/,
  ],
] as const)('%s is NF-002', async (_label, manifest, opts, message) => {
  const build = await rspackBuild(manifest)
  root = build.root
  await expect(
    describeComponentsBuild({ dir: build.dir, env: {}, ...opts })
  ).rejects.toMatchObject({ code: 'NF-002', message })
})

test('a server build that requires Node modules (async chunk loading) is NF-002', async () => {
  const build = await rspackBuild()
  root = build.root
  // Rspack/webpack `target: 'async-node'` with async chunks loads them with fs + vm.
  await writeFile(
    join(build.dir, 'client', 'server', 'remoteEntry.js'),
    'var fs = require("fs"), vm = require("vm"); module.exports = {}'
  )
  await expect(
    describeComponentsBuild({
      dir: build.dir,
      ssrEntry: 'server/remoteEntry.js',
      env: {},
    })
  ).rejects.toMatchObject({ code: 'NF-002', message: /"fs".*asyncChunks/s })
})

test('a build folder name that is not a build id is NF-002 unless --build-id is given', async () => {
  const build = await rspackBuild({ publicPath: 'https://shop.example/b/v2/' })
  root = build.root
  await expect(
    describeComponentsBuild({
      dir: build.dir,
      ssrEntry: 'server/remoteEntry.js',
      env: {},
      buildId: '_bad',
    })
  ).rejects.toMatchObject({ code: 'NF-002' })
  const { file } = await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
    buildId: 'v2',
  })
  expect(file.buildId).toBe('v2')
})

test('verify: an untouched build passes; a tampered server file is a digest mismatch (NF-027)', async () => {
  const build = await rspackBuild()
  root = build.root
  await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
  })
  await expect(verifyComponentsBuild(build.dir)).resolves.toEqual({
    signature: 'unsigned',
  })
  await writeFile(
    join(build.dir, 'client', 'server', 'remoteEntry.js'),
    `globalThis.pwned = true;\n${ENTRY}`
  )
  await expect(verifyComponentsBuild(build.dir)).rejects.toMatchObject({
    code: 'NF-027',
    message: /server\/remoteEntry\.js/,
  })
})

test('verify: an edited descriptor payload no longer matches its digest (NF-027)', async () => {
  const build = await rspackBuild()
  root = build.root
  await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
  })
  const path = join(build.dir, 'nf-components.json')
  const file = await readJson(path)
  await writeFile(path, JSON.stringify({ ...file, buildId: 'r9' }))
  await expect(verifyComponentsBuild(build.dir)).rejects.toMatchObject({
    code: 'NF-027',
  })
})

test('the CLI: --dir and --ssr-entry describe, --verify checks, bad usage exits 1', async () => {
  const build = await rspackBuild()
  root = build.root
  const lines: string[] = []
  const log = (line: string) => lines.push(line)
  expect(
    await runDescribeCli(
      ['--dir', build.dir, '--ssr-entry', 'server/remoteEntry.js'],
      {},
      log
    )
  ).toBe(0)
  expect(lines.join('\n')).toMatch(/r1.*unsigned/)
  expect(await runDescribeCli(['--dir', build.dir, '--verify'], {}, log)).toBe(
    0
  )
  await writeFile(join(build.dir, 'client', 'server', 'remoteEntry.js'), 'x')
  expect(await runDescribeCli(['--dir', build.dir, '--verify'], {}, log)).toBe(
    1
  )
  expect(lines.join('\n')).toMatch(/NF-027/)
  expect(await runDescribeCli([], {}, log)).toBe(1)
  expect(lines.at(-1)).toMatch(/usage: nf-describe/)
})

/** A signed, described build and its public key. */
async function signedBuild() {
  const build = await rspackBuild()
  root = build.root
  const jwk = privateJwk()
  await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: { NF_COMPONENTS_SIGNING_KEY: JSON.stringify(jwk) },
  })
  const publicJwk = { ...jwk }
  delete publicJwk.d
  return { ...build, publicJwk }
}

/** Rewrites the descriptor's payload with `edit`, recomputing its digest (the JWS stays). */
async function editPayload(
  dir: string,
  edit: (payload: ComponentBuildDescriptor) => void
): Promise<void> {
  const path = join(dir, 'nf-components.json')
  const file = (await readJson(path)) as Record<string, unknown>
  const jws = file.jws
  const payload = { ...file } as unknown as ComponentBuildDescriptor
  delete (payload as Record<string, unknown>).digest
  delete (payload as Record<string, unknown>).jws
  edit(payload)
  const digest = await componentDescriptorDigest(payload)
  await writeFile(path, JSON.stringify({ ...payload, digest, jws }))
}

test('verify: a signed build reports whether its signature was checked', async () => {
  const build = await signedBuild()
  await expect(verifyComponentsBuild(build.dir)).resolves.toEqual({
    signature: 'not-checked',
  })
  await expect(
    verifyComponentsBuild(build.dir, { publicKeys: [build.publicJwk] })
  ).resolves.toEqual({ signature: 'verified' })
  const other = privateJwk()
  delete other.d
  await expect(
    verifyComponentsBuild(build.dir, { publicKeys: [{ ...other, kid: 'k1' }] })
  ).rejects.toMatchObject({ code: 'NF-027', message: /signature/ })
})

test('verify: an edited payload with a recomputed digest and the old JWS fails (NF-027)', async () => {
  const build = await signedBuild()
  await editPayload(build.dir, (p) => {
    p.iat = (p.iat ?? 0) + 3600
  })
  // Without a key too: the JWS payload is not the descriptor's.
  await expect(verifyComponentsBuild(build.dir)).rejects.toMatchObject({
    code: 'NF-027',
    message: /JWS/,
  })
})

test('verify: tampered assets (recomputed digest, old JWS) fail (NF-027)', async () => {
  const build = await signedBuild()
  await editPayload(build.dir, (p) => {
    p.assets!.exposes['./Counter']!.js.push(`${BASE}evil.mjs`)
  })
  await expect(
    verifyComponentsBuild(build.dir, { publicKeys: [build.publicJwk] })
  ).rejects.toMatchObject({ code: 'NF-027' })
})

test('verify: tampered assets of an unsigned build fail the digest (NF-027)', async () => {
  const build = await rspackBuild()
  root = build.root
  await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
  })
  const path = join(build.dir, 'nf-components.json')
  const file = (await readJson(path)) as { assets: { entry: string } }
  file.assets.entry = `${BASE}evil.js`
  await writeFile(path, JSON.stringify(file))
  await expect(verifyComponentsBuild(build.dir)).rejects.toMatchObject({
    code: 'NF-027',
    message: /digest/,
  })
})

test('the CLI: --verify says the signature was not checked without --public-key', async () => {
  const build = await signedBuild()
  const lines: string[] = []
  const log = (line: string) => lines.push(line)
  expect(await runDescribeCli(['--dir', build.dir, '--verify'], {}, log)).toBe(
    0
  )
  expect(lines.at(-1)).toMatch(/signature not checked/)
  expect(
    await runDescribeCli(
      [
        '--dir',
        build.dir,
        '--verify',
        '--public-key',
        JSON.stringify(build.publicJwk),
      ],
      {},
      log
    )
  ).toBe(0)
  expect(lines.at(-1)).toMatch(/signature verified/)
})

test('the CLI: an unsigned build in production is a warning', async () => {
  const build = await rspackBuild()
  root = build.root
  const seen: Array<[string, string]> = []
  const log = (line: string, level: 'info' | 'warn' = 'info') =>
    seen.push([level, line])
  const args = ['--dir', build.dir, '--ssr-entry', 'server/remoteEntry.js']
  expect(await runDescribeCli(args, { NODE_ENV: 'production' }, log)).toBe(0)
  expect(seen.at(-1)).toEqual(['warn', expect.stringMatching(/unsigned/)])
  expect(await runDescribeCli(args, {}, log)).toBe(0)
  expect(seen.at(-1)![0]).toBe('info')
})

test('a server file that is a symlink out of the build folder is NF-002', async () => {
  const build = await rspackBuild()
  root = build.root
  const outside = join(build.root, 'outside.js')
  await writeFile(outside, ENTRY)
  const entry = join(build.dir, 'client', 'server', 'remoteEntry.js')
  await rm(entry)
  await symlink(outside, entry)
  await expect(
    describeComponentsBuild({
      dir: build.dir,
      ssrEntry: 'server/remoteEntry.js',
      env: {},
    })
  ).rejects.toMatchObject({ code: 'NF-002', message: /symlink/ })
})

test('a server folder that is a symlink out of the build folder is NF-002', async () => {
  const build = await rspackBuild()
  root = build.root
  const outside = join(build.root, 'elsewhere')
  await mkdir(outside)
  await writeFile(join(outside, 'remoteEntry.js'), ENTRY)
  await rm(join(build.dir, 'client', 'server'), { recursive: true })
  await symlink(outside, join(build.dir, 'client', 'server'))
  await expect(
    describeComponentsBuild({
      dir: build.dir,
      ssrEntry: 'server/remoteEntry.js',
      env: {},
    })
  ).rejects.toMatchObject({ code: 'NF-002', message: /symlink|outside/ })
})

test.each(['nf-build.json', 'nf-components.json', 'client/mf-manifest.json'])(
  'never writes through a symlinked %s (NF-002, the target is untouched)',
  async (name) => {
    const build = await rspackBuild()
    root = build.root
    const target = join(build.root, 'victim.json')
    const original =
      name === 'client/mf-manifest.json'
        ? await readFile(join(build.dir, name), 'utf8')
        : '{"keep":true}'
    await writeFile(target, original)
    await rm(join(build.dir, name), { force: true })
    await symlink(target, join(build.dir, name))
    await expect(
      describeComponentsBuild({
        dir: build.dir,
        ssrEntry: 'server/remoteEntry.js',
        env: {},
      })
    ).rejects.toMatchObject({ code: 'NF-002', message: /symlink/ })
    expect(await readFile(target, 'utf8')).toBe(original)
  }
)

test('verify: a symlinked client/mf-manifest.json is NF-002 (also for a browser-only build)', async () => {
  const build = await rspackBuild()
  root = build.root
  await describeComponentsBuild({ dir: build.dir, ssr: false, env: {} })
  const manifest = join(build.dir, 'client', 'mf-manifest.json')
  const outside = join(build.root, 'manifest-copy.json')
  await writeFile(outside, await readFile(manifest))
  await rm(manifest)
  await symlink(outside, manifest)
  await expect(verifyComponentsBuild(build.dir)).rejects.toMatchObject({
    code: 'NF-002',
    message: /symlink/,
  })
})

/** Moves `client/` outside the build folder and links it back. */
async function symlinkClient(build: { root: string; dir: string }) {
  const outside = join(build.root, 'client-elsewhere')
  await rename(join(build.dir, 'client'), outside)
  await symlink(outside, join(build.dir, 'client'))
}

test('describe: a client folder that is a symlink out of the build folder is NF-002', async () => {
  const build = await rspackBuild()
  root = build.root
  await symlinkClient(build)
  await expect(
    describeComponentsBuild({
      dir: build.dir,
      ssrEntry: 'server/remoteEntry.js',
      env: {},
    })
  ).rejects.toMatchObject({ code: 'NF-002', message: /client/ })
})

test('verify: a client folder that is a symlink out of the build folder is NF-002', async () => {
  const build = await rspackBuild()
  root = build.root
  await describeComponentsBuild({
    dir: build.dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
  })
  await symlinkClient(build)
  await expect(verifyComponentsBuild(build.dir)).rejects.toMatchObject({
    code: 'NF-002',
    message: /client/,
  })
})
