import { createRemoteComponent } from '@next-federation/next/pages/components'
import * as HostContextModule from './host-context'

// Counter from the descriptor's build: the react18 build accepts this
// host's React 18, the 19-only one renders the fallback (NF-036). It reads
// this host's `components-context`.
export const RemoteCounter = createRemoteComponent({
  expose: './Counter',
  shared: {
    'components-context': { version: '1.0.0', module: HostContextModule },
  },
  fallback: <span data-testid="fallback">counter unavailable</span>,
})
