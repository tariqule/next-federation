import { renderToString } from 'react-dom/server'
import type { IslandEnvelope } from '@next-federation/protocol'
import { RemoteIsland } from '../src/pages/remote-island.tsx'

const mounted: Record<string, unknown>[] = []
rs.mock('@next-federation/react', () => ({
  IslandMount: (props: Record<string, unknown>) => {
    mounted.push(props)
    return null
  },
}))
rs.mock('next/router', () => ({
  useRouter: () => ({
    basePath: '',
    locales: [],
    defaultLocale: undefined,
    push: () => Promise.resolve(true),
    prefetch: () => Promise.resolve(),
  }),
}))

const envelope: IslandEnvelope = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'b1',
  mode: 'production',
  html: '<p>hi from a</p>',
  rscPayload: '0:"x"',
  css: [],
  bootstrap: 'https://a.example.com/_nf/b1/bootstrap.js',
  reactVersion: '19.3.1',
  idPlaceholder: 'nfph0',
}
const host = { basePath: '', locale: '' }

test.each([
  [{}, true],
  [{ errorFallback: 'down' }, false],
  [{ errorFallback: 'down', inertOnLoadFailure: true }, true],
  [{ inertOnLoadFailure: false }, false],
])('%j → IslandMount inertOnLoadFailure %s', (extra, expected) => {
  mounted.length = 0
  renderToString(
    <RemoteIsland
      remote="a"
      envelope={envelope}
      host={host}
      token={null}
      {...extra}
    />
  )
  expect(mounted).toHaveLength(1)
  expect(mounted[0]).toMatchObject({ inertOnLoadFailure: expected })
})
