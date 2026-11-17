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
  // Build bookkeeping Vite and Module Federation leave in the browser folder.
  mkdirSync(join(dir, 'client', '.vite'), { recursive: true })
  writeFileSync(
    join(dir, 'client', '.vite', 'manifest.json'),
    '{"src/x.tsx":{}}'
  )
  writeFileSync(join(dir, 'client', '.vite', 'mf-preload.json'), '{}')
  writeFileSync(join(dir, 'client', 'mf-stats.json'), '{"shared":[]}')
  writeFileSync(join(dir, 'client', 'assets', '.hidden'), 'x')
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

test('build bookkeeping is not served: dot folders and files (.vite/), mf-stats.json', async () => {
  for (const path of [
    '/b/c1/.vite/manifest.json',
    '/b/c1/.vite/mf-preload.json',
    '/b/c1/%2Evite/manifest.json',
    '/b/c1/mf-stats.json',
    '/b/c1/assets/.hidden',
  ]) {
    const res = await fetch(url(path))
    expect(res.status, path).toBe(404)
  }
  // The browser and server code next to them still is.
  expect((await fetch(url('/b/c1/mf-manifest.json'))).status).toBe(200)
})

test('/_nf/health answers for a components current build', async () => {
  const res = await fetch(url('/_nf/health'))
  expect(res.status).toBe(200)
})

test('B3: a descriptor and server chunks are compressed when accepted', async () => {
  const { request } = await import('node:http')
  const { gunzipSync } = await import('node:zlib')
  const big = JSON.stringify({
    v: 1,
    buildId: 'c1',
    integrity: Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `assets/chunk-${i}.cjs`,
        'x'.repeat(64),
      ])
    ),
  })
  writeFileSync(join(root, 'c1', 'nf-components.json'), big)
  writeFileSync(
    join(root, 'c1', 'client', 'assets', 'big.cjs'),
    'exports.a = 1\n'.repeat(200)
  )
  const get = (path: string) =>
    new Promise<{ headers: Record<string, unknown>; body: Buffer }>(
      (resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: served!.port,
            path,
            agent: false,
            headers: { 'accept-encoding': 'gzip' },
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () =>
              resolve({ headers: res.headers, body: Buffer.concat(chunks) })
            )
          }
        )
        req.on('error', reject)
        req.end()
      }
    )
  const descriptor = await get('/b/c1/nf-components.json')
  expect(descriptor.headers['content-encoding']).toBe('gzip')
  expect(descriptor.headers['cache-control']).toBe(
    'public, max-age=31536000, immutable'
  )
  expect(gunzipSync(descriptor.body).toString()).toBe(big)
  const chunk = await get('/b/c1/assets/big.cjs')
  expect(chunk.headers['content-encoding']).toBe('gzip')
  expect(gunzipSync(chunk.body).toString()).toBe('exports.a = 1\n'.repeat(200))
})
