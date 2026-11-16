// The Vercel build (vercel.json `buildCommand`, run by `vercel build`).
//
// 1. `vite build` with NF_VERCEL=1: base = the production domain, output in
//    dist/vercel/<buildId>/{client,rsc,ssr} (one build per deployment).
// 2. dist/vercel/static/b/<buildId>/assets/*: the static output Vercel serves
//    (vercel.json `outputDirectory`), at the build-pinned paths the envelope
//    names.
// 3. dist/vercel/entry.js: re-exports the build's rsc handler and its
//    buildId under a fixed path, so api/nf.ts imports it statically and the
//    function bundle traces every server chunk.
//
// NF_BUILD_ID sets the build id (default: a timestamp, as `vite build`).
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const out = join(root, 'dist', 'vercel')

rmSync(out, { recursive: true, force: true })
execFileSync(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NF_VERCEL: '1' } }
)

const builds = readdirSync(out, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
if (builds.length !== 1) {
  throw new Error(`expected one build in ${out}, found ${builds.join(', ')}`)
}
const buildId = builds[0]!
const info = JSON.parse(
  readFileSync(join(out, buildId, 'nf-build.json'), 'utf8')
) as { buildId: string; base: string }

cpSync(join(out, buildId, 'client'), join(out, 'static', 'b', buildId), {
  recursive: true,
})
writeFileSync(
  join(out, 'entry.js'),
  `export { default } from './${buildId}/rsc/index.js'\nexport const buildId = ${JSON.stringify(buildId)}\n`
)
writeFileSync(
  join(out, 'entry.d.ts'),
  'declare const handler: (request: Request) => Promise<Response>\nexport default handler\nexport declare const buildId: string\n'
)
process.stdout.write(`next-federation: build ${info.buildId} at ${info.base}\n`)
