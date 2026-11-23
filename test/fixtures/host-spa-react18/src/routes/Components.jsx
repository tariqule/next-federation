import { useEffect, useState } from 'react'
import {
  createRemoteComponent,
  fetchDescriptorInBrowser,
} from '@next-federation/react/components'
import * as HostContextModule from '../host-context.js'
import { HostContext } from '../host-context.js'

// Counter rendered in the browser on this host's React 18, reading this
// host's `components-context`:
//   /components  the react18 build (installed-host.ts sets
//                VITE_NF_COMPONENTS_REACT18), which accepts React 18
//   /nineteen    the 19-only build (the harness sets
//                VITE_NF_COMPONENTS_ORIGIN): its fallback (NF-036)
const REACT18 =
  import.meta.env.VITE_NF_COMPONENTS_REACT18 ?? 'http://127.0.0.1:4116'
const NINETEEN =
  import.meta.env.VITE_NF_COMPONENTS_ORIGIN ?? 'http://127.0.0.1:4110'

const RemoteCounter = createRemoteComponent({
  expose: './Counter',
  shared: {
    'components-context': { version: '1.0.0', module: HostContextModule },
  },
  fallback: <span data-testid="fallback">counter unavailable</span>,
})

// One fetch per origin for the page (StrictMode runs effects twice).
const descriptors = new Map()
const loadDescriptor = (origin) => {
  if (!descriptors.has(origin)) {
    descriptors.set(
      origin,
      fetchDescriptorInBrowser(`${origin}/_nf/components.json`, {
        remote: 'components',
      })
    )
  }
  return descriptors.get(origin)
}

function CounterPage({ origin }) {
  // undefined while loading, then the descriptor or null.
  const [loaded, setLoaded] = useState()
  useEffect(() => {
    void loadDescriptor(origin).then((d) => setLoaded(d ?? null))
  }, [origin])
  if (loaded === undefined) {
    return <span data-testid="shell-fallback">loading</span>
  }
  return (
    <main>
      <p data-testid="rendered-build">{loaded?.buildId ?? 'none'}</p>
      <HostContext.Provider value="from-spa-react18-host">
        <RemoteCounter descriptor={loaded} start={1} />
      </HostContext.Provider>
    </main>
  )
}

export const Components = () => <CounterPage origin={REACT18} />
export const Nineteen = () => <CounterPage origin={NINETEEN} />
