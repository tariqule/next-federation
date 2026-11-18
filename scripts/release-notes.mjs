#!/usr/bin/env node
// GitHub Release notes (docs/releasing.md).
//   node scripts/release-notes.mjs [version]   Markdown body on stdout
//   node scripts/release-notes.mjs --version   the version every package shares
// Without a version, the packages' current version is used (they must all match).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseNotes, commonVersion } from './lib/release-notes.mjs'

const packagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages'
)

function main(argv) {
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
  const manifests = dirs.map((dir) => ({
    dir,
    ...JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
  }))

  if (argv[0] === '--version') {
    process.stdout.write(`${commonVersion(manifests)}\n`)
    return
  }
  if (argv.length > 1 || argv[0]?.startsWith('-')) {
    throw new Error('Usage: release-notes.mjs [version | --version]')
  }
  const version = argv[0] ?? commonVersion(manifests)
  const changelogs = manifests.flatMap((m) => {
    try {
      return [
        {
          name: m.name,
          text: readFileSync(join(m.dir, 'CHANGELOG.md'), 'utf8'),
        },
      ]
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  })
  process.stdout.write(buildReleaseNotes(version, changelogs))
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(`release-notes: ${error.message}`)
  process.exit(1)
}
