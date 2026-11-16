'use client'

import type { HostContext, IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { stripBasePath } from '../bridge.ts'

/**
 * App Router island mount: island links navigate through `next/navigation`.
 * `router.push` adds `basePath` itself, so it is stripped from island hrefs.
 */
export function NextIslandMount(props: {
  envelope: IslandEnvelope
  host: HostContext
  token: { endpoint: string; identityKey: string } | null
  errorFallback?: ReactNode
}): ReactElement {
  const { envelope, host, token, errorFallback } = props
  const router = useRouter()
  const { basePath, locale } = host
  const bridge = useMemo(
    () => ({
      basePath,
      locale,
      navigate: (href: string) => router.push(stripBasePath(href, basePath)),
      prefetch: (href: string) =>
        router.prefetch(stripBasePath(href, basePath)),
    }),
    [router, basePath, locale]
  )
  return (
    <IslandMount
      envelope={envelope}
      bridge={bridge}
      token={token}
      errorFallback={errorFallback}
    />
  )
}
