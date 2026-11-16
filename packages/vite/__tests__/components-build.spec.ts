// Builds the real components-remote fixture with `vite build`, without
// NF_BUILD_ID (a child process, as a remote app runs it): Vite resolves the
// config once per environment, and every resolution must agree on the
// default build id. Needs the workspace packages built (`pnpm build`).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const fixture = resolve(
  import.meta.dirname,
  '../../../test/fixtures/components-remote'
)
const out = 'dist/.nf-build-spec'
const vite = join(fixture, 'node_modules', 'vite', 'bin', 'vite.js')

afterAll(async () => {
  await rm(join(fixture, out), { recursive: true, force: true })
  await rm(join(fixture, `${out}-test-env`), { recursive: true, force: true })
})

test('vite build without NF_BUILD_ID writes one build with its manifest and descriptor', async () => {
  await rm(join(fixture, out), { recursive: true, force: true })
  const env: Record<string, string | undefined> = {
    ...process.env,
    NF_OUT: out,
  }
  for (const key of [
    // A remote's own `vite build`: not a test environment.
    'NODE_ENV',
    'VITEST',
    'JEST_WORKER_ID',
    'NF_BUILD_ID',
    'NF_COMPONENTS_BUILT_AT',
    'NF_COMPONENTS_SIGNING_KEY',
    'NF_VITE_COMMAND',
  ]) {
    delete env[key]
  }
  execFileSync(process.execPath, [vite, 'build', '--logLevel', 'error'], {
    cwd: fixture,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const builds = readdirSync(join(fixture, out))
  expect(builds).toHaveLength(1)
  const dir = join(fixture, out, builds[0]!)
  expect(existsSync(join(dir, 'client', 'mf-manifest.json'))).toBe(true)
  const descriptor = JSON.parse(
    await readFile(join(dir, 'nf-components.json'), 'utf8')
  ) as {
    buildId: string
    base: string
    ssr: { integrity: Record<string, string> }
    assets?: {
      entry: string
      exposes: Record<string, { css: string[]; js: string[] }>
    }
  }
  expect(descriptor.buildId).toBe(builds[0])
  // The browser files, signed with the rest: Counter.css and its chunks.
  const counter = descriptor.assets?.exposes['./Counter']
  expect(descriptor.assets?.entry).toBe(`${descriptor.base}remoteEntry.js`)
  expect(counter?.css).toHaveLength(1)
  expect(counter?.css[0]).toMatch(
    new RegExp(`^${descriptor.base}assets/Counter-[\\w-]+\\.css$`)
  )
  expect(counter?.js.some((f) => /\/Counter-[\w-]+\.js$/.test(f))).toBe(true)
  for (const url of [...counter!.css, ...counter!.js]) {
    expect(
      existsSync(join(dir, 'client', url.slice(descriptor.base.length)))
    ).toBe(true)
  }
  expect(descriptor.base).toMatch(new RegExp(`/b/${builds[0]}/$`))
  expect(Object.keys(descriptor.ssr.integrity)).toContain('remoteEntry.ssr.js')
}, 120_000)

test('a build in a test environment fails with NF-002, not a missing manifest', () => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NF_OUT: `${out}-test-env`,
    NODE_ENV: 'test',
  }
  delete env.MFE_VITE_NO_TEST_ENV_CHECK
  let stderr = ''
  try {
    execFileSync(process.execPath, [vite, 'build', '--logLevel', 'error'], {
      cwd: fixture,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    stderr = String((error as { stderr?: Buffer }).stderr ?? error)
  }
  expect(stderr).toMatch(/NF-002/)
  expect(stderr).toMatch(/MFE_VITE_NO_TEST_ENV_CHECK/)
}, 120_000)
