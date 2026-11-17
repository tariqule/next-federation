import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveBuilds } from '../src/node/serve-builds.ts'
import type { ServedBuilds } from '../src/node/serve-builds.ts'

const HANDLER = `export default async (req) => {
  const p = new URL(req.url).pathname
  if (p.endsWith('/hang')) return new Promise(() => {})
  if (p.endsWith('/crash')) setTimeout(() => process.exit(3), 10)
  // Refused on its headers, the body never read (as the island handler's 413).
  if (req.headers.get('x-refuse')) return new Response(null, { status: 413 })
  const text = await req.text()
  return new Response(JSON.stringify({
    buildId: BUILD, pid: process.pid, nodeEnv: process.env.NODE_ENV,
    path: new URL(req.url).pathname, body: text,
    te: req.headers.get('te'), secret: req.headers.get('x-secret'),
    keepAlive: req.headers.get('keep-alive'), host: req.headers.get('host'),
  }), { headers: { 'content-type': 'application/json' } })
}`

function alive(marker: string): string {
  try {
    // No shell: on Linux `sh -c "pgrep -f <marker>"` keeps the shell, whose own
    // command line contains the marker, so pgrep would find it.
    return execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

let root: string
let served: ServedBuilds | undefined
const base = () => `http://127.0.0.1:${served!.port}`

function makeBuild(id: string, hoursAgo: number) {
  const dir = join(root, id)
  mkdirSync(join(dir, 'client', 'assets', 'sub'), { recursive: true })
  mkdirSync(join(dir, 'rsc'), { recursive: true })
  writeFileSync(
    join(dir, 'nf-build.json'),
    JSON.stringify({ buildId: id, builtAt: Date.now() - hoursAgo * 3_600_000 })
  )
  writeFileSync(join(dir, 'client', 'assets', 'app.js'), `console.log("${id}")`)
  writeFileSync(join(dir, 'client', 'assets', 'sub', 'a.css'), 'a{}')
  writeFileSync(
    join(dir, 'rsc', 'index.js'),
    `const BUILD = ${JSON.stringify(id)}\n${HANDLER}`
  )
}

function raw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: served!.port, path, method: 'GET' },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'nf-serve-'))
  makeBuild('v1', 50)
  makeBuild('v2', 1)
  makeBuild('v0', 100)
  writeFileSync(join(root, 'secret.txt'), 'top secret')
  served = await serveBuilds({
    dir: root,
    port: 0,
    upstreamTimeoutMs: 700,
    retention: { maxBuilds: 2, minAgeMs: 0 },
  })
}, 30000)

afterAll(async () => {
  await served?.close()
  rmSync(root, { recursive: true, force: true })
})

test('plans live and retired builds at start', () => {
  expect(served!.current).toBe('v2')
  expect(served!.live).toEqual(['v2', 'v1'])
  expect(served!.retired).toEqual(['v0'])
})

test('routes /b/v1/_nf/* to v1 and /_nf/* to the current build', async () => {
  const one = await (await fetch(`${base()}/b/v1/_nf/health`)).json()
  expect(one.buildId).toBe('v1')
  expect(one.path).toBe('/_nf/health')
  expect(one.nodeEnv).toBe('production')
  const cur = await (await fetch(`${base()}/_nf/health`)).json()
  expect(cur.buildId).toBe('v2')
})

function rawPost(
  headers: Record<string, string>,
  chunks: string[]
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: served!.port,
        path: '/_nf/x',
        method: 'POST',
        headers,
      },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode ?? 0 })
      }
    )
    req.on('error', reject)
    for (const c of chunks) req.write(c)
    req.end()
  })
}

test('streams bodies, strips hop-by-hop headers, caps a chunked body', async () => {
  const echoed = await (
    await fetch(`${base()}/b/v1/_nf/x`, { method: 'POST', body: 'payload' })
  ).json()
  expect(echoed.body).toBe('payload')

  const seen = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: served!.port,
        path: '/_nf/x',
        headers: {
          connection: 'x-secret, keep-alive',
          'x-secret': 'leak',
          'keep-alive': 'timeout=5',
          te: 'trailers',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body)))
      }
    )
    req.on('error', reject)
    req.end()
  })
  expect(seen.secret).toBeNull()
  expect(seen.keepAlive).toBeNull()
  expect(seen.te).toBeNull()

  // No content-length: a chunked body past the cap is refused while streaming.
  const big = Array.from({ length: 10 }, () => 'x'.repeat(8000))
  expect((await rawPost({ 'transfer-encoding': 'chunked' }, big)).status).toBe(
    413
  )
  const declared = await fetch(`${base()}/_nf/x`, {
    method: 'POST',
    body: 'x'.repeat(70000),
  })
  expect(declared.status).toBe(413)
})

test('an upstream that never answers yields 504', async () => {
  const res = await fetch(`${base()}/_nf/hang`)
  expect(res.status).toBe(504)
})

test('a failing build at startup leaves no surviving sibling process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-serve-fail-'))
  try {
    for (const id of ['slow', 'bad']) {
      mkdirSync(join(dir, id, 'rsc'), { recursive: true })
      writeFileSync(
        join(dir, id, 'nf-build.json'),
        JSON.stringify({ buildId: id, builtAt: Date.now() })
      )
    }
    writeFileSync(
      join(dir, 'slow', 'rsc', 'index.js'),
      `await new Promise((r) => setTimeout(r, 1500))\nexport default async () => new Response('x')`
    )
    writeFileSync(
      join(dir, 'bad', 'rsc', 'index.js'),
      `throw new Error('bad build')`
    )
    await expect(serveBuilds({ dir, port: 0 })).rejects.toThrow()
    expect(alive(dir)).toBe('')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 20000)

test('a build that crashes after startup is reported through onExit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-serve-crash-'))
  let crashed: { buildId: string; code: number | null } | undefined
  let handle: ServedBuilds | undefined
  try {
    mkdirSync(join(dir, 'v1', 'rsc'), { recursive: true })
    writeFileSync(
      join(dir, 'v1', 'nf-build.json'),
      JSON.stringify({ buildId: 'v1', builtAt: Date.now() })
    )
    writeFileSync(
      join(dir, 'v1', 'rsc', 'index.js'),
      `const BUILD = 'v1'\n${HANDLER}`
    )
    const gone = new Promise<void>((resolve) => {
      serveBuilds({
        dir,
        port: 0,
        onExit: (info) => {
          crashed = info
          resolve()
        },
      }).then((h) => {
        handle = h
        void fetch(`http://127.0.0.1:${h.port}/_nf/crash`).catch(() => {})
      })
    })
    await gone
    expect(crashed).toMatchObject({ buildId: 'v1', code: 3 })
    const after = await fetch(`http://127.0.0.1:${handle!.port}/_nf/x`)
    expect(after.status).toBe(502)
    // nf-serve's own errors are readable cross-origin, like its 410.
    expect(after.headers.get('access-control-allow-origin')).toBe('*')
  } finally {
    await handle?.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 20000)

test('serves pinned assets immutably and blocks path traversal', async () => {
  const ok = await fetch(`${base()}/b/v1/assets/app.js`)
  expect(ok.status).toBe(200)
  expect(ok.headers.get('cache-control')).toBe(
    'public, max-age=31536000, immutable'
  )
  expect(ok.headers.get('access-control-allow-origin')).toBe('*')
  expect(await ok.text()).toBe('console.log("v1")')
  expect((await fetch(`${base()}/b/v1/assets/sub/a.css`)).status).toBe(200)
  // The URL parser resolves the dot segments to /b/rsc/index.js: an unknown build.
  expect((await raw('/b/v1/assets/../../rsc/index.js')).status).toBe(410)
  expect((await raw('/b/v1/assets/../rsc/index.js')).status).toBe(404)
  expect((await raw('/b/v1/assets/..%2f..%2frsc%2findex.js')).status).toBe(404)
  expect((await raw('/b/v1/assets/%2e%2e/%2e%2e/secret.txt')).status).toBe(410)
  expect((await raw('/b/v1/assets/..%2f..%2fsecret.txt')).status).toBe(404)
  expect((await raw('/b/v1/assets/%00')).status).toBe(404)
  expect((await raw('/b/v1/assets/sub')).status).toBe(404)
})

test('a retired or unknown build answers 410 NF-023', async () => {
  for (const id of ['v0', 'nope']) {
    const res = await raw(`/b/${id}/assets/app.js`)
    expect(res.status).toBe(410)
    expect(JSON.parse(res.body)).toEqual({ error: 'NF-023' })
  }
  const res = await fetch(`${base()}/b/v0/_nf/health`)
  expect(res.status).toBe(410)
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
})

test('each build runs in its own process', async () => {
  const a = await (await fetch(`${base()}/b/v1/_nf/x`)).json()
  const b = await (await fetch(`${base()}/b/v2/_nf/x`)).json()
  expect(a.pid).not.toBe(b.pid)
  expect(a.pid).not.toBe(process.pid)
})

function postTo(
  path: string,
  headers: Record<string, string>,
  chunks: string[]
): Promise<{ status: number; cors: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    let responded = false
    const req = request(
      { host: '127.0.0.1', port: served!.port, path, method: 'POST', headers },
      (res) => {
        responded = true
        let body = ''
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            cors:
              (res.headers['access-control-allow-origin'] as string) ?? null,
            body,
          })
        res.on('data', (c) => (body += c))
        res.on('end', done)
        res.on('error', done)
      }
    )
    // The server may answer early and reset the upload: only a reset before any answer fails.
    req.on('error', (e) => (responded ? undefined : reject(e)))
    for (const c of chunks) req.write(c)
    req.end()
  })
}

test("nf-serve's own 413 and 504 carry CORS, so browsers can read them", async () => {
  const declared = await fetch(`${base()}/_nf/x`, {
    method: 'POST',
    body: 'x'.repeat(70000),
  })
  expect(declared.status).toBe(413)
  expect(declared.headers.get('access-control-allow-origin')).toBe('*')
  const big = Array.from({ length: 10 }, () => 'x'.repeat(8000))
  const streamed = await postTo(
    '/_nf/x',
    { 'transfer-encoding': 'chunked' },
    big
  )
  expect(streamed.status).toBe(413)
  expect(streamed.cors).toBe('*')
  const hang = await fetch(`${base()}/_nf/hang`)
  expect(hang.status).toBe(504)
  expect(hang.headers.get('access-control-allow-origin')).toBe('*')
})

test('/_nf/action has its own higher ceiling, so the build answers its own limit', async () => {
  // 200 KB, above the island ceiling (65536), sent in chunks.
  const body = Array.from({ length: 25 }, () => 'x'.repeat(8000))
  for (const path of ['/_nf/action', '/b/v1/_nf/action']) {
    const res = await postTo(path, { 'content-type': 'text/plain' }, body)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).body.length).toBe(200_000)
  }
  // An island path keeps the island ceiling.
  expect((await postTo('/b/v1/_nf/island/x', {}, body)).status).toBe(413)
  // Above the action ceiling (default 8 MiB) nf-serve answers 413 itself, with CORS.
  const over = await fetch(`${base()}/_nf/action`, {
    method: 'POST',
    body: 'x'.repeat(8 * 1024 * 1024 + 1),
  })
  expect(over.status).toBe(413)
  expect(over.headers.get('access-control-allow-origin')).toBe('*')
})

test("a build's early 413 leaves nf-serve's upstream connection usable", async () => {
  // Between the build's action limit and nf-serve's ceiling: nf-serve forwards
  // the upload, the build answers before reading it, and nf-serve's keep-alive
  // connection to the build must still carry the next request.
  for (const size of [300_000, 2 * 1024 * 1024]) {
    const refused = await fetch(`${base()}/b/v1/_nf/action`, {
      method: 'POST',
      headers: { 'x-refuse': '1' },
      body: 'x'.repeat(size),
    })
    expect(refused.status).toBe(413)
    const next = await fetch(`${base()}/b/v1/_nf/x`)
    expect(next.status, `after ${size} bytes`).toBe(200)
  }
})
