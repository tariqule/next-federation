// Prose word count of docs pages, to check the budgets in
// docs/maintainers/docs-style.md. Strips frontmatter, fenced code, JSX
// component tags, link URLs and table pipes.
//
// Usage: node scripts/docs-prose-words.mjs <file|dir>...
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

function pages(target) {
  if (!statSync(target).isDirectory()) return [target]
  return readdirSync(target)
    .sort()
    .flatMap((name) => pages(path.join(target, name)))
    .filter((f) => /\.mdx?$/.test(f))
}

export function proseWords(source) {
  const text = source
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<\/?[A-Z][^>]*>/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[|#>*`_-]+/g, ' ')
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let total = 0
  for (const arg of process.argv.slice(2)) {
    for (const file of pages(arg)) {
      const n = proseWords(readFileSync(file, 'utf8'))
      total += n
      console.log(String(n).padStart(6), file)
    }
  }
  console.log(String(total).padStart(6), 'total')
}
