import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import type { IslandEnvelope } from '@next-federation/protocol'
import { RemoteIsland } from '../src/pages/remote-island.tsx'

rs.mock('next/router', () => ({
  useRouter: () => ({
    basePath: '/shop',
    locales: ['en', 'fr'],
    defaultLocale: 'en',
    push: () => Promise.resolve(true),
    prefetch: () => Promise.resolve(),
  }),
}))

// Next discourages stylesheets in `next/head` (a dev warning on every page):
// record anything rendered through it.
const inHead: ReactNode[] = []
rs.mock('next/head', () => ({
  default: ({ children }: { children: ReactNode }) => {
    inHead.push(children)
    return null
  },
}))

const CSS = 'https://a.example.com/_nf/b1/assets/panel.css'

const envelope: IslandEnvelope = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'b1',
  mode: 'production',
  html: '<p>hi from a</p>',
  rscPayload: '0:"x"',
  css: [CSS],
  bootstrap: 'https://a.example.com/_nf/b1/bootstrap.js',
  reactVersion: '19.3.1',
  idPlaceholder: 'nfph0',
}
const host = { basePath: '/shop', locale: 'fr' }

test('the server HTML links the island CSS once, ahead of the island, without next/head', () => {
  const html = renderToString(
    <>
      <RemoteIsland remote="a" envelope={envelope} host={host} token={null} />
      <RemoteIsland remote="a" envelope={envelope} host={host} token={null} />
    </>
  )
  const links = [...html.matchAll(/<link[^>]*>/g)].map((m) => m[0])
  expect(links).toEqual([
    `<link rel="stylesheet" href="${CSS}" data-precedence="next-federation"/>`,
  ])
  expect(html.indexOf(CSS)).toBeLessThan(html.indexOf('hi from a'))
  expect(inHead).toEqual([])
})

test('no envelope: the fallback and no stylesheet', () => {
  const html = renderToString(
    <RemoteIsland
      remote="a"
      envelope={null}
      host={host}
      token={null}
      fallback={<p>later</p>}
    />
  )
  expect(html).toBe('<p>later</p>')
})
