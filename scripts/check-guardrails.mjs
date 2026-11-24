// Grep guardrail (design section 11): no Next.js internals, no connection().
// Pure text scan. It must run before `pnpm build` and on a fresh clone, so it
// imports nothing from the packages. Error-docs coverage lives in
// scripts/check-error-docs.mjs, which runs after the build.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RULES = [
  { rule: 'next-internal-import', pattern: /['"]next\/dist\// },
  {
    rule: 'next-internal-global',
    pattern: /__RSC_MANIFEST|__next_[a-z]\w*|__NEXT_[A-Z]\w*|__next_f\b/,
  },
  { rule: 'connection-call', pattern: /(?<![\w.])connection\s*\(/ },
]

const SKIPPED_FILE = /(^|\/)(AGENTS\.md|next-env\.d\.ts)$|\.mdx?$/
const SKIPPED_DIR = /^test\/e2e\//

/**
 * @param {Array<{ path: string; text: string }>} files
 * @returns {Array<{ path: string; line: number; rule: string }>}
 */
export function findViolations(files) {
  const violations = []
  for (const { path, text } of files) {
    if (SKIPPED_FILE.test(path) || SKIPPED_DIR.test(path)) continue
    const inTest = path.startsWith('test/')
    text.split('\n').forEach((raw, index) => {
      // `__NEXT_DATA__` is a public Next.js global that fixtures may assert on.
      const line = inTest ? raw.replaceAll('__NEXT_DATA__', '') : raw
      for (const { rule, pattern } of RULES) {
        if (pattern.test(line)) {
          violations.push({ path, line: index + 1, rule })
        }
      }
    })
  }
  return violations
}

function listFiles() {
  const out = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      'packages',
      'test/fixtures',
    ],
    { encoding: 'utf8' }
  )
  return out.split('\0').filter(Boolean)
}

function main() {
  const files = listFiles().flatMap((path) => {
    try {
      return [{ path, text: readFileSync(path, 'utf8') }]
    } catch {
      return [] // listed but deleted from the working tree
    }
  })
  const violations = findViolations(files)
  for (const v of violations) console.log(`${v.path}:${v.line} ${v.rule}`)
  if (violations.length > 0) {
    console.log(`\n${violations.length} guardrail violation(s).`)
    process.exit(1)
  }
  console.log(`guardrail: 0 violations in ${files.length} file(s).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
