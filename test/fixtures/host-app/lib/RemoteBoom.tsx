'use client'
import { createRemoteComponent } from '@next-federation/react/components'

// The remote's `./Boom` throws while rendering (on the server only, or
// everywhere): loading text while it loads, failure text when it failed.
export const RemoteBoom = createRemoteComponent<{
  where?: 'server' | 'always'
}>({
  expose: './Boom',
  fallback: <span data-testid="boom-loading">loading</span>,
  errorFallback: <span data-testid="boom-failed">boom unavailable</span>,
})
