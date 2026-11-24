import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { COMPONENTS_PORTS } from '../../../e2e/fixtures/components-keys.ts'
import { lanePort } from '../../../e2e/lane.ts'
import { componentsFederation } from './components'
import {
  RemoteRouterInternal,
  RemoteRouterLink,
  RemoteRouterReactRouter,
} from './RemoteRouter'

export type RouterPageProps = {
  descriptor: RemoteComponentDescriptor | null
  /**
   * An absolute URL (another origin): a plain anchor in every host. From
   * the server (NF_LANE is not in the browser bundle).
   */
  externalHref: string
}

/** getServerSideProps: the current descriptor of `remote`. */
export const routerPageProps =
  (remote: string): GetServerSideProps<RouterPageProps> =>
  async () => ({
    props: {
      descriptor: await getComponentDescriptor(componentsFederation, remote),
      externalHref: `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.signed)}/_nf/components.json`,
    },
  })

export const getRouterPageProps = routerPageProps('links')

/**
 * `show`: which remote component renders (RouterLink by default).
 * `hostLink`: a link of this host (next/link) to that page, for client
 * navigations between remote pages in one document.
 */
export function RouterPage({
  title,
  descriptor,
  externalHref,
  external = false,
  show = 'link',
  hostLink,
}: RouterPageProps & {
  title: string
  external?: boolean
  show?: 'link' | 'react-router' | 'internal'
  hostLink?: string
}) {
  return (
    <main>
      <h1 data-testid="router-page">{title}</h1>
      {hostLink ? (
        <Link href={hostLink} data-testid="host-link">
          host link
        </Link>
      ) : null}
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      {show === 'link' ? (
        <RemoteRouterLink
          descriptor={descriptor}
          external={external ? externalHref : undefined}
        />
      ) : null}
      {show === 'react-router' ? (
        <RemoteRouterReactRouter descriptor={descriptor} />
      ) : null}
      {show === 'internal' ? (
        <RemoteRouterInternal descriptor={descriptor} />
      ) : null}
    </main>
  )
}
