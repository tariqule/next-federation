import Link from 'next/link'
import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { getComponentDescriptor } from '@next-federation/next/server'
import { COMPONENTS_PORTS } from '../../../e2e/fixtures/components-keys.ts'
import { lanePort } from '../../../e2e/lane.ts'
import { componentsFederation } from './components'
import {
  RemoteRouterInternal,
  RemoteRouterLink,
  RemoteRouterReactRouter,
  RemoteRouterSearch,
} from './RemoteRouter'

/** An absolute URL (another origin): a plain anchor in every host. */
export const EXTERNAL_HREF = `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.signed)}/_nf/components.json`

async function Section({
  remote,
  dynamic,
  links,
  search,
  external,
  reactRouter,
  internal,
}: {
  remote: string
  dynamic: boolean
  links: number
  search: boolean
  external: boolean
  reactRouter: boolean
  internal: boolean
}) {
  const descriptor = await getComponentDescriptor(
    componentsFederation,
    remote,
    {
      dynamic,
    }
  )
  return (
    <>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      {Array.from({ length: links }, (_, i) => (
        <p key={i}>
          <RemoteRouterLink
            descriptor={descriptor}
            external={external && i === 0 ? EXTERNAL_HREF : undefined}
          />
        </p>
      ))}
      {search ? <RemoteRouterSearch descriptor={descriptor} /> : null}
      {reactRouter ? <RemoteRouterReactRouter descriptor={descriptor} /> : null}
      {internal ? <RemoteRouterInternal descriptor={descriptor} /> : null}
    </>
  )
}

/**
 * A page of remote components written with their own router. `dynamic`: the
 * descriptor per request; otherwise the cached one (the page is static).
 * `hostLink`: a link of this host (next/link) to that page, for client
 * navigations between remote pages in one document.
 */
export function RouterPage({
  title,
  remote = 'links-cached',
  dynamic = false,
  links = 1,
  search = false,
  external = false,
  reactRouter = false,
  internal = false,
  hostLink,
  children,
}: {
  title: string
  remote?: string
  dynamic?: boolean
  links?: number
  search?: boolean
  external?: boolean
  reactRouter?: boolean
  internal?: boolean
  hostLink?: string
  children?: ReactNode
}) {
  return (
    <main>
      <h1 data-testid="router-page">{title}</h1>
      {hostLink ? (
        <Link href={hostLink} data-testid="host-link">
          host link
        </Link>
      ) : null}
      {children}
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section
          remote={remote}
          dynamic={dynamic}
          links={links}
          search={search}
          external={external}
          reactRouter={reactRouter}
          internal={internal}
        />
      </Suspense>
    </main>
  )
}
