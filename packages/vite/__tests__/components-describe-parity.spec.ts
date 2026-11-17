// Parity: `nf-describe` (any Module Federation 2.0 build) run on a build of
// the Vite components-remote fixture reproduces the descriptor the plugin
// wrote. Needs the workspace packages built (`pnpm build`).
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describeComponentsBuild } from '@next-federation/server/node'
import { compactVerify, importJWK } from 'jose'
import type { JWK } from 'jose'

const fixture = resolve(
  import.meta.dirname,
  '../../../test/fixtures/components-remote'
)
const out = 'dist/.nf-describe-parity'
const vite = join(fixture, 'node_modules', 'vite', 'bin', 'vite.js')

afterAll(async () => {
  await rm(join(fixture, out), { recursive: true, force: true })
})

test('nf-describe on a Vite-built remote writes the plugin descriptor', async () => {
  await rm(join(fixture, out), { recursive: true, force: true })
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk: JWK = { ...(privateKey.export({ format: 'jwk' }) as JWK) }
  const key = JSON.stringify({ ...jwk, kid: 'parity' })
  const env: Record<string, string | undefined> = {
    ...process.env,
    NF_OUT: out,
    NF_BUILD_ID: 'p1',
    NF_COMPONENTS_SIGNING_KEY: key,
  }
  for (const name of ['NODE_ENV', 'NF_COMPONENTS_BUILT_AT', 'NF_VITE_COMMAND'])
    delete env[name]
  execFileSync(process.execPath, [vite, 'build', '--logLevel', 'error'], {
    cwd: fixture,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const dir = join(fixture, out, 'p1')
  const read = async (file: string) =>
    JSON.parse(await readFile(join(dir, file), 'utf8')) as Record<
      string,
      unknown
    >
  const plugin = await read('nf-components.json')
  const pluginInfo = await read('nf-build.json')
  const manifest = await readFile(join(dir, 'client', 'mf-manifest.json'))
  await rm(join(dir, 'nf-components.json'))

  // The fixture publishes types (`types: true`): nf-describe signs them with --types.
  const { file } = await describeComponentsBuild({
    dir,
    types: true,
    env: { NF_COMPONENTS_SIGNING_KEY: key },
  })
  // Payload and digest identical (ES256 signatures are randomized: both verify).
  const { jws: pluginJws, ...pluginRest } = plugin
  const { jws, ...rest } = file
  expect(rest).toEqual(pluginRest)
  expect(Object.keys(file.ssr!.integrity)).toContain('remoteEntry.ssr.js')
  // The signed browser assets too (stylesheets and modulepreload chunks).
  expect(file.assets?.exposes['./Counter']?.js.length).toBeGreaterThan(0)
  expect(file.assets).toEqual(plugin.assets)
  // The signed shared modules too, per expose (nf-describe reads the usage
  // the plugin left next to the build): the fallback library with its
  // bundled version, next/* host-only, each listed for its own exposes.
  expect(file.shared).toEqual(plugin.shared)
  expect(file.shared?.['components-fallback-lib']).toEqual({
    requiredVersion: '^2.0.0',
    fallback: true,
    version: '2.0.0',
    exposes: ['./Versioned'],
  })
  expect(file.shared?.['next/router']).toEqual({
    requiredVersion: false,
    fallback: false,
    exposes: ['./PagesNavLink'],
  })
  expect(file.shared?.react).toBeUndefined()
  const publicKey = await importJWK({ ...jwk, d: undefined }, 'ES256')
  for (const token of [jws!, pluginJws as string]) {
    const { payload } = await compactVerify(token, publicKey)
    expect(JSON.parse(new TextDecoder().decode(payload))).toMatchObject({
      buildId: 'p1',
      ssr: file.ssr,
    })
  }
  // The build as the plugin left it: same nf-build.json, manifest untouched.
  expect(await read('nf-build.json')).toEqual(pluginInfo)
  expect(await readFile(join(dir, 'client', 'mf-manifest.json'))).toEqual(
    manifest
  )
}, 120_000)
