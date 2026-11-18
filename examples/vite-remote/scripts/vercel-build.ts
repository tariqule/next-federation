// The Vercel build (`buildCommand` in vercel.json, after the workspace
// packages are built). One deployment holds one build:
//
// 1. `vite build` with NF_VERCEL=1: base = the production domain, output in
//    dist/vercel/<buildId>/{client,rsc,ssr}.
// 2. dist/vercel/static/b/<buildId>/: the build's client files, the static
//    output Vercel serves (`outputDirectory`), at the build-pinned paths the
//    island envelopes name.
// 3. dist/vercel/static/index.html: the landing page at `/` (landing/), which
//    says this is a remote. The rewrites send only `/_nf/*` and
//    `/b/<buildId>/_nf/*` to the Function, so `/` stays static.
// 4. dist/vercel/entry.js: re-exports the build's island handler and its id
//    under a fixed path, so api/nf.ts imports it statically and Vercel's file
//    tracing bundles every server chunk.
import { execFileSync } from 'node:child_process'
import { cpSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
cpSync(join(out, buildId, 'client'), join(out, 'static', 'b', buildId), {
  recursive: true,
})
cpSync(join(root, 'landing', 'index.html'), join(out, 'static', 'index.html'))
writeFileSync(
  join(out, 'entry.js'),
  `export { default } from './${buildId}/rsc/index.js'\nexport const buildId = ${JSON.stringify(buildId)}\n`
)
writeFileSync(
  join(out, 'entry.d.ts'),
  'declare const handler: (request: Request) => Promise<Response>\nexport default handler\nexport declare const buildId: string\n'
)
console.log(`vercel-build: build ${buildId}`)
