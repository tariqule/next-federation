import { findViolations } from '../check-guardrails.mjs'

const scan = (text: string, path = 'packages/next/src/x.ts') =>
  findViolations([{ path, text }]).map((v) => v.rule)

test('flags each banned pattern', () => {
  expect(scan(`import x from 'next/dist/server/foo'`)).toEqual([
    'next-internal-import',
  ])
  expect(scan('self.__next_f.push(1)')).toEqual(['next-internal-global'])
  expect(scan('globalThis.__RSC_MANIFEST')).toEqual(['next-internal-global'])
  expect(scan('process.env.__NEXT_CACHE_COMPONENTS')).toEqual([
    'next-internal-global',
  ])
  expect(scan('await connection()')).toEqual(['connection-call'])
})
test('does not flag look-alikes', () => {
  expect(scan('const connectionString = makeConnection(url)')).toEqual([])
  expect(scan(`import { cookies } from 'next/headers'`)).toEqual([])
})
test('reports 1-based line numbers', () => {
  expect(
    findViolations([{ path: 'a.ts', text: 'ok\nawait connection()' }])[0]?.line
  ).toBe(2)
})
test('allows __NEXT_DATA__ only inside test/', () => {
  const text = 'window.__NEXT_DATA__'
  expect(scan(text, 'test/fixtures/host-pages/pages/a.tsx')).toEqual([])
  expect(scan(text)).toEqual(['next-internal-global'])
})
test('skips markdown files', () => {
  expect(scan('never calls connection()', 'packages/core/README.md')).toEqual(
    []
  )
  expect(scan('connection()', 'packages/core/CHANGELOG.md')).toEqual([])
})
