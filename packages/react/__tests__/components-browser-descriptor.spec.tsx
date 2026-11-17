// fetchDescriptorInBrowser (SPA hosts): the browser-only descriptor keeps the
// build's browser assets, so an SPA loads the remote's stylesheets too.
import { fetchDescriptorInBrowser } from '../src/components/index.tsx'

const base = 'https://remote.example/b/c1/'
const file = {
  v: 1,
  name: 'components',
  buildId: 'c1',
  base,
  manifest: `${base}mf-manifest.json`,
  ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
  assets: {
    entry: `${base}remoteEntry.js`,
    exposes: {
      './Counter': { css: [`${base}assets/a.css`], js: [`${base}assets/a.js`] },
    },
  },
  digest: 'sha384-x',
}

afterEach(() => {
  rs.unstubAllGlobals()
})

test('carries the build assets, never ssr', async () => {
  rs.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify(file), { status: 200 })
  )
  const d = await fetchDescriptorInBrowser(
    'https://remote.example/_nf/components.json'
  )
  expect(d?.ssr).toBeNull()
  expect(d?.assets).toEqual(file.assets)
})

test('carries the shared requirements (the browser checks them, NF-036)', async () => {
  const shared = {
    'next/link': { requiredVersion: false, fallback: false },
    lib: { requiredVersion: '^2.0.0', fallback: true, exposes: ['./Counter'] },
  }
  rs.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ ...file, shared }), { status: 200 })
  )
  const d = await fetchDescriptorInBrowser(
    'https://remote.example/_nf/components.json'
  )
  expect(d?.shared).toEqual(shared)
})
