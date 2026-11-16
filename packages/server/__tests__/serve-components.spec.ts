// nf-serve with Mode A (components) builds: static files only, no build
// process; the descriptor of the current build at /_nf/components.json.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveBuilds } from '../src/node/serve-builds.ts'
import type { ServedBuilds } from '../src/node/serve-builds.ts'

let root: string
let served: ServedBuilds | undefined
const url = (path: string) => `http://127.0.0.1:${served!.port}${path}`

function makeComponentsBuild(id: string, hoursAgo: number) {
  const dir = join(root, id)
  mkdirSync(join(dir, 'client', 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'nf-build.json'),
    JSON.stringify({
      kind: 'components',
      name: 'components',
      buildId: id,
      builtAt: Date.now() - hoursAgo * 3_600_000,
      base: `http://127.0.0.1/b/${id}/`,
    })
  )
  writeFileSync(
    join(dir, 'nf-components.json'),
    JSON.stringify({ v: 1, buildId: id })
  )
  writeFileSync(
    join(dir, 'client', 'remoteEntry.js'),
    `export const id = "${id}"`
  )
  writeFileSync(
    join(dir, 'client', 'remoteEntry.ssr.js'),
    `exports.id = "${id}"`
  )
  writeFileSync(join(dir, 'client', 'mf-manifest.json'), `{"id":"${id}"}`)
  writeFileSync(join(dir, 'client', 'assets', 'Counter-x.cjs'), 'exports.c = 1')
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'nf-serve-components-'))
  makeComponentsBuild('c1', 50)
  makeComponentsBuild('c2', 1)
  makeComponentsBuild('c0', 100)
  served = await serveBuilds({
    dir: root,
    port: 0,
    retention: { maxBuilds: 2, minAgeMs: 0 },
  })
}, 30000)

afterAll(async () => {
  await served?.close()
  rmSync(root, { recursive: true, force: true })
})

test('plans retention over component builds like island builds', () => {
  expect(served!.live).toEqual(['c2', 'c1'])
  expect(served!.retired).toEqual(['c0'])
  expect(served!.current).toBe('c2')
})

test('/_nf/components.json is the current build descriptor, never cached', async () => {
  const res = await fetch(url('/_nf/components.json'))
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
  expect(await res.json()).toEqual({ v: 1, buildId: 'c2' })
})

test('/b/<id>/ serves every file of a live build, immutable', async () => {
  for (const [path, body] of [
    ['/b/c1/remoteEntry.js', 'export const id = "c1"'],
    ['/b/c1/mf-manifest.json', '{"id":"c1"}'],
    ['/b/c1/remoteEntry.ssr.js', 'exports.id = "c1"'],
    ['/b/c2/assets/Counter-x.cjs', 'exports.c = 1'],
  ] as const) {
    const res = await fetch(url(path))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  }
  expect(
    (await fetch(url('/b/c1/remoteEntry.js'))).headers.get('content-type')
  ).toMatch(/javascript/)
})

test('a build descriptor is served under its own base', async () => {
  const res = await fetch(url('/b/c1/nf-components.json'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ v: 1, buildId: 'c1' })
})

test('a retired component build answers 410 NF-023', async () => {
  const res = await fetch(url('/b/c0/remoteEntry.js'))
  expect(res.status).toBe(410)
  expect(await res.json()).toEqual({ error: 'NF-023' })
})

test('nothing outside client/ is reachable', async () => {
  for (const path of [
    '/b/c1/nf-build.json',
    '/b/c1/../c1/nf-build.json',
    '/b/c1/%2e%2e/nf-build.json',
    '/b/c1/missing.js',
  ]) {
    // `%2e%2e` is normalised to `..` by fetch: `/b/nf-build.json` names no live build (410).
    expect([404, 410]).toContain((await fetch(url(path))).status)
  }
})

test('/_nf/health answers for a components current build', async () => {
  const res = await fetch(url('/_nf/health'))
  expect(res.status).toBe(200)
})
