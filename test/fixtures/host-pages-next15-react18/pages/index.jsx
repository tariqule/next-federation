import { RemoteIsland } from '@next-federation/next/pages'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import { federation, getIslandProps } from '../lib/federation'
import { HostContext } from '../lib/host-context'
import { RemoteCounter } from '../lib/RemoteCounter'

// A public island and a remote component, both server-rendered.
export const getServerSideProps = async (ctx) => ({
  props: {
    product: await getIslandProps(ctx, {
      remote: 'a',
      island: 'ProductPanel',
      props: { sku: 'A1' },
    }),
    descriptor: await getComponentDescriptor(federation, 'components'),
  },
})

export default function Home({ product, descriptor }) {
  return (
    <main>
      <h1>Pages Router host (Next 15, React 18)</h1>
      <RemoteIsland {...product} fallback={<p>product unavailable</p>} />
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <HostContext.Provider value="from-pages-react18-host">
        <RemoteCounter descriptor={descriptor} start={1} />
      </HostContext.Provider>
    </main>
  )
}
