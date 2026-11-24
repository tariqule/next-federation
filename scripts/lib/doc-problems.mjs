/**
 * Dependency-free so unit tests can import it without a built sdk.
 * @param {Record<string, { slug: string }>} codes
 * @param {string[]} files file names under docs/errors
 * @returns {string[]} problems, empty when docs and codes agree
 */
export function findDocProblems(codes, files) {
  const pages = new Set(
    files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  )
  const slugs = new Set(Object.values(codes).map((c) => c.slug))
  const problems = []
  // The library links to docs/errors/<slug>.md (DOCS_BASE in the sdk), so an
  // error page written as .mdx would be a dead link. index.mdx is the section
  // index, not an error page.
  for (const f of files) {
    if (f.endsWith('.mdx') && f !== 'index.mdx')
      problems.push(
        `docs/errors/${f}: error pages must stay .md until DOCS_BASE changes`
      )
  }
  for (const [code, { slug }] of Object.entries(codes)) {
    if (!pages.has(slug))
      problems.push(`${code}: missing docs/errors/${slug}.md`)
  }
  for (const page of pages) {
    if (!slugs.has(page)) problems.push(`orphaned docs/errors/${page}.md`)
  }
  return problems
}
