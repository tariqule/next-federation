'use client'
import * as HostContextModule from 'components-context'
import { createRemoteComponent } from '@next-federation/react/components'

// The remote declares `components-context` host-provided: it reads this
// host's context object (and so the value of the provider below it).
export const RemoteCounter = createRemoteComponent<{ start?: number }>({
  expose: './Counter',
  shared: {
    'components-context': { version: '1.0.0', module: HostContextModule },
  },
  fallback: <span data-testid="fallback">counter unavailable</span>,
})
