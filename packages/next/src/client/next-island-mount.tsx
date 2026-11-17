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
  /** `identityKey: null`: a public island whose actions act as the signed-in user. */
  token: { endpoint: string; identityKey: string | null } | null
  errorFallback?: ReactNode
  /** The page gave no `errorFallback` of its own: keep the HTML if the code cannot load. */
  inertOnLoadFailure?: boolean
}): ReactElement {
  const { envelope, host, token, errorFallback, inertOnLoadFailure } = props
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
      inertOnLoadFailure={inertOnLoadFailure}
    />
  )
}
