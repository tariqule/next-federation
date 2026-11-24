import { findDocProblems } from '../lib/doc-problems.mjs'

const codes = { 'NF-001': { slug: 'a' }, 'NF-002': { slug: 'b' } }

test('reports nothing when pages and codes agree', () => {
  expect(findDocProblems(codes, ['a.md', 'b.md'])).toEqual([])
})

test('reports a missing page and an orphaned page', () => {
  expect(findDocProblems(codes, ['a.md', 'c.md'])).toEqual([
    'NF-002: missing docs/errors/b.md',
    'orphaned docs/errors/c.md',
  ])
})

test('rejects an .mdx error page but allows the section index', () => {
  expect(findDocProblems(codes, ['a.md', 'b.md', 'index.mdx'])).toEqual([])
  expect(findDocProblems(codes, ['a.md', 'b.mdx'])).toEqual([
    'docs/errors/b.mdx: error pages must stay .md until DOCS_BASE changes',
    'NF-002: missing docs/errors/b.md',
  ])
})
