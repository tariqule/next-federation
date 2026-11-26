// Remote components descriptor API, shared by both routers: which build of a
// components remote this render uses. Resolved on the server (Server
// Component, getServerSideProps or getStaticProps) and passed as a prop to a
// component made with `createRemoteComponent`, so the browser loads the build
// the server rendered.
import type { ComponentTarget, Federation } from '@next-federation/core'
import { fetchVerifiedComponentDescriptor } from '@next-federation/core/components'
import type { VerifiedDescriptorResult } from '@next-federation/core/components'
import { componentTrustRegistry, liveRefusal } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { canLoadServerCode } from '@next-federation/react/components/server-loader'
import { logger } from '@next-federation/sdk'
import { withEvents } from './component-events.ts'

export type { RemoteComponentDescriptor }

export type ComponentDescriptorOptions = {
  /**
   * Fetch on every request (`cache: 'no-store'`). With `cacheComponents`,
   * render it inside `<Suspense>` (a dynamic hole); otherwise the descriptor
   * is cached for the remote's `components.revalidate` seconds.
   */
  dynamic?: boolean
}

// The last descriptor each remote resolved: kept for when the remote is
// down (its build's assets are retained by nf-serve). Not a cache: every
// call fetches (through Next's caches), so Next always sees the fetch.
const lastKnown = new Map<string, RemoteComponentDescriptor>()

/**
 * The descriptor, marked `refused` when this server process refused the
 * build's code for a build fact (NF-027/NF-028, recorded by its remote
 * component runtimes; NF-036 is per expose, never recorded per build): the
 * browser then does not load it, from any boundary or navigation, until the
 * refusal expires (REFUSAL_TTL_MS, 5 minutes). Outside the signed
 * payload, so verification and pinning never see it.
 */
function withRefusal(
  descriptor: RemoteComponentDescriptor
): RemoteComponentDescriptor {
  // The runtimes record with performance.now (one clock per process).
  const code = liveRefusal(
    componentTrustRegistry().refusedBuilds,
    descriptor.remote,
    descriptor.base,
    performance.now()
  )
  return code ? { ...descriptor, refused: { code } } : descriptor
}

/** @internal Shared by the App Router and Pages Router entries. */
export async function resolveComponentDescriptor(
  federation: Federation,
  remote: string,
  options: ComponentDescriptorOptions & {
    get: (target: ComponentTarget) => Promise<VerifiedDescriptorResult>
  }
): Promise<RemoteComponentDescriptor | null> {
  const target = federation.componentTarget(remote)
  const key = `${remote} ${target.descriptorUrl}`
  const result = options.dynamic
    ? await fetchVerifiedComponentDescriptor(target, {
        init: { cache: 'no-store' },
      })
    : await options.get(target)
  if (!result.ok) {
    federation.emit({
      type: 'component:error',
      remote,
      code: result.code,
      ms: result.ms,
      ...(result.status === undefined ? {} : { status: result.status }),
    })
    const kept = lastKnown.get(key) ?? null
    logger.error(
      result.code,
      `${result.detail} ${kept ? `Rendering the last known build "${kept.buildId}".` : 'Rendering the fallback.'}`
    )
    return kept && withEvents(federation, withRefusal(kept))
  }
  const { verified } = result
  let { descriptor } = verified
  if (verified.code) {
    logger.warnOnce(
      verified.code,
      `${remote}@${descriptor.buildId}`,
      `${verified.detail} It renders in the browser only.`
    )
  }
  if (descriptor.ssr && !canLoadServerCode()) {
    logger.warnOnce(
      'NF-028',
      'node',
      'This Node.js has no process.getBuiltinModule (needs Node >= 20.16): remote components render in the browser only.'
    )
    descriptor = { ...descriptor, ssr: null }
  }
  lastKnown.set(key, descriptor)
  federation.emit({
    type: 'component:descriptor',
    remote,
    buildId: descriptor.buildId,
    ssr: descriptor.ssr !== null,
    ms: result.ms,
  })
  return withEvents(federation, withRefusal(descriptor))
}
