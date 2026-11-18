// The Vercel build (`buildCommand` in vercel.json, after the workspace
// packages are built). The remote is static files only; one deployment holds
// one build:
//
// 1. `vite build` with NF_VERCEL=1: base = the production domain, output in
//    dist/vercel/<buildId>/, descriptor signed with NF_COMPONENTS_SIGNING_KEY.
// 2. dist/vercel/static/ (`outputDirectory`), laid out as `nf-serve` serves
//    a components build: b/<buildId>/* (the build's files and descriptor)
//    and _nf/components.json (the current descriptor, which hosts fetch).
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

// A live demo's hosts server-render only a signed build: fail without a key.
if (!process.env.NF_COMPONENTS_SIGNING_KEY) {
  throw new Error('set NF_COMPONENTS_SIGNING_KEY (a private EC P-256 JWK)')
}

const root = join(import.meta.dirname, '..')
const out = join(root, 'dist', 'vercel')

rmSync(out, { recursive: true, force: true })
execFileSync(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NF_VERCEL: '1' } }
)

const builds = readdirSync(out)
if (builds.length !== 1) {
  throw new Error(`expected one build in ${out}, found ${builds.join(', ')}`)
}
const buildId = builds[0]!
const descriptor = join(out, buildId, 'nf-components.json')
if (!JSON.parse(readFileSync(descriptor, 'utf8')).jws) {
  throw new Error(`${descriptor} is not signed`)
}
const pinned = join(out, 'static', 'b', buildId)
// Every file of client/ except the build's bookkeeping (as nf-serve).
cpSync(join(out, buildId, 'client'), pinned, {
  recursive: true,
  filter: (src) =>
    !basename(src).startsWith('.') && basename(src) !== 'mf-stats.json',
})
cpSync(descriptor, join(pinned, 'nf-components.json'))
mkdirSync(join(out, 'static', '_nf'))
cpSync(descriptor, join(out, 'static', '_nf', 'components.json'))
console.log(`vercel-build: signed build ${buildId}`)
