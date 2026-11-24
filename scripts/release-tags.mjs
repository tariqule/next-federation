#!/usr/bin/env node
// Release tags for the publish workflow (docs/releasing.md).
//   node scripts/release-tags.mjs --dry-run   print the tags it would push
//   node scripts/release-tags.mjs             tag HEAD and push the missing tags
// One `<name>@<version>` tag per published package, from package.json, at the
// commit being published. Tags that already exist on origin are left alone, so
// a re-run is safe (the "release tags" ruleset forbids moving them anyway).
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planReleaseTags } from './lib/release-tags.mjs'

const packagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages'
)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

const dryRun = process.argv.includes('--dry-run')

const manifests = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) =>
    JSON.parse(readFileSync(join(packagesDir, d.name, 'package.json'), 'utf8'))
  )

const remoteTags = new Set(
  git('ls-remote', '--tags', 'origin')
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .filter((ref) => ref.startsWith('refs/tags/') && !ref.endsWith('^{}'))
    .map((ref) => ref.slice('refs/tags/'.length))
)

const { create, existing } = planReleaseTags(manifests, remoteTags)
const head = git('rev-parse', 'HEAD').trim()

for (const tag of existing) console.log(`exists  ${tag}`)
for (const tag of create)
  console.log(`${dryRun ? 'would tag' : 'tag'}  ${tag} -> ${head}`)

if (dryRun || create.length === 0) process.exit(0)

for (const tag of create) git('tag', '--force', tag, head)
git('push', 'origin', ...create.map((tag) => `refs/tags/${tag}`))
console.log(`pushed ${create.length} tag(s)`)
