// Packs every package under packages/* and checks the tarball contents.
// Driven only by each package.json, so new packages need no edits here.
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack } from './lib/pack-problems.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')
const out = mkdtempSync(join(tmpdir(), 'nf-pack-'))
const problems = []
let count = 0

try {
  for (const dir of readdirSync(packagesDir).sort()) {
    const pkgDir = join(packagesDir, dir)
    const manifestPath = join(pkgDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    count++
    const dest = join(out, dir)
    try {
      execFileSync('pnpm', ['pack', '--pack-destination', dest], {
        cwd: pkgDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const [tgz] = readdirSync(dest).filter((f) => f.endsWith('.tgz'))
      if (!tgz) throw new Error('pnpm pack produced no tarball')
      const listing = execFileSync('tar', ['-tzf', join(dest, tgz)], {
        encoding: 'utf8',
      })
      const files = listing
        .split('\n')
        .filter((l) => l && !l.endsWith('/'))
        .map((l) => l.replace(/^package\//, ''))
      problems.push(...checkPack(manifest.name, files, manifest.exports))
    } catch (error) {
      problems.push(
        `${manifest.name}: pack failed: ${error?.stderr ?? error?.message ?? error}`
      )
    }
  }
  if (count === 0) problems.push('no packages found under packages/')
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL ${p}`)
  process.exit(1)
}
console.log(`check-pack: ${count} package(s) packed and verified`)
