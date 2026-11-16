// Fails when an NF error code has no docs page, or a page has no code.
// Imports the built sdk, so it runs after `pnpm build`.
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findDocProblems } from './lib/doc-problems.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = await import(
  pathToFileURL(join(root, 'packages/sdk/dist/index.js')).href
)
const files = readdirSync(join(root, 'docs/errors'))
const problems = findDocProblems(sdk.ERROR_CODES, files)
for (const p of problems) console.error(p)
if (problems.length > 0) process.exit(1)
console.log(
  `check-error-docs: ${Object.keys(sdk.ERROR_CODES).length} codes, all documented.`
)
