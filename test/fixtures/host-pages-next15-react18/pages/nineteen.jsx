import { getComponentDescriptor } from '@next-federation/next/pages/server'
import { federation } from '../lib/federation'
import { HostContext } from '../lib/host-context'
import { RemoteCounter } from '../lib/RemoteCounter'

// Counter from the 19-only build (react ^19.0.0): this host's React 18
// is outside its range, so it renders its fallback (NF-036).
export const getServerSideProps = async () => ({
  props: {
    descriptor: await getComponentDescriptor(federation, 'components19'),
  },
})

export default function Nineteen({ descriptor }) {
  return (
    <main>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <HostContext.Provider value="from-pages-react18-host">
        <RemoteCounter descriptor={descriptor} start={1} />
      </HostContext.Provider>
    </main>
  )
}
