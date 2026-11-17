// B5: the NF-007 log line names the island URL and hints when the origin is
// not an island remote (a website or a Next.js app answering 404 HTML).
import { defineFederation, fetchIsland } from '@next-federation/core'
import { reportIsland } from '../src/server/report-island.ts'

const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
})
const target = federation.target('shop')

let error: ReturnType<typeof rs.spyOn>
beforeEach(() => {
  error = rs.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})

const logged = () => error.mock.calls.map((c) => c.join(' ')).join('\n')

test('NF-007 for a 404 HTML page: the URL (no query), the status and the hint', async () => {
  const result = await fetchIsland(target, {
    island: 'Hello',
    props: { name: 'private-prop' },
    fetch: (async () =>
      new Response('<html></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch,
  })
  reportIsland(federation, target, 'Hello', result)
  const line = logged()
  expect(line).toContain('NF-007')
  expect(line).toContain('https://shop.example.com/_nf/island/Hello (HTTP 404)')
  expect(line).toMatch(
    /is it an island remote \(does it serve \/_nf\/island\)\?/
  )
  expect(line).toContain("A Next.js app can't be a remote")
  expect(line).toContain('rendering its fallback')
  expect(line).not.toContain('private-prop')
  expect(line).not.toContain('?p=')
})

test('NF-008 names the URL too', () => {
  reportIsland(federation, target, 'Hello', {
    ok: false,
    code: 'NF-008',
    url: 'https://shop.example.com/_nf/island/Hello',
    meta: { ms: 3000, bytes: 0, attempts: 1 },
  })
  expect(logged()).toContain(
    'Island "Hello" from remote "shop" failed at https://shop.example.com/_nf/island/Hello; rendering its fallback.'
  )
})
