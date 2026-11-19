import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { Embedded } from 'example-inspect'
import type { EmbedInfo } from 'example-inspect'
import { PagePanel } from 'example-inspect/client'
import { PagesMiniCart, PagesNav, PagesSearch } from '../lib/header.pages'
import { federation, getIslandProps } from '../lib/pages-federation'
import { sessionFrom } from '../lib/session'
import { GUIDES, SOURCE } from '../lib/guides'

// The admin page is a Pages Router route in the same app as the App Router
// storefront (a mixed-router host). It embeds the same header components and
// the same ProductGrid island, plus the admin-only Inventory island.
type Props = {
  session: { user: string; role: string } | null
  published: string | null
  header: RemoteComponentDescriptor | null
  inventory: IslandProps
  grid: IslandProps
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const session = sessionFrom((name) => ctx.req.cookies[name])
  const [header, inventory, grid] = await Promise.all([
    getComponentDescriptor(federation, 'header'),
    // Private: the token is minted and used here, on the server. The page
    // props carry the rendered envelope only, never the token.
    getIslandProps(ctx, {
      remote: 'account',
      island: 'Inventory',
      private: true,
    }),
    getIslandProps(ctx, {
      remote: 'cdp',
      island: 'ProductGrid',
      props: { category: 'shoes', locale: 'en' },
    }),
  ])
  const published =
    typeof ctx.query.published === 'string' &&
    /^\d{1,15}$/.test(ctx.query.published)
      ? ctx.query.published
      : null
  return { props: { session, published, header, inventory, grid } }
}

const TRAIL = ['Storefront', 'Pages Router page /admin']
const piece = (info: Omit<EmbedInfo, 'router' | 'trail'>): EmbedInfo => ({
  ...info,
  router: 'Pages Router',
  trail: TRAIL,
})

export default function Admin({
  session,
  published,
  header,
  inventory,
  grid,
}: Props) {
  return (
    <>
      <header className="site-header">
        <strong className="brand">Trailhead admin</strong>
        <Embedded
          {...piece({
            kind: 'remote component',
            remote: 'header',
            name: 'Header',
            cache: 'per-request',
            buildId: header?.buildId,
          })}
        >
          <div data-embed-content="">
            <PagesNav descriptor={header} />
          </div>
        </Embedded>
        <Embedded
          {...piece({
            kind: 'remote component',
            remote: 'header',
            name: 'SearchBox',
            cache: 'per-request',
            buildId: header?.buildId,
          })}
        >
          <div data-embed-content="">
            <PagesSearch descriptor={header} />
          </div>
        </Embedded>
        <Embedded
          {...piece({
            kind: 'remote component',
            remote: 'header',
            name: 'MiniCart',
            cache: 'per-request',
            buildId: header?.buildId,
          })}
        >
          <div data-embed-content="">
            <PagesMiniCart descriptor={header} />
          </div>
        </Embedded>
      </header>
      <p className="role">
        This route is served by the <b>Pages Router</b> of the same Next.js app
        (getServerSideProps). Links to the App Router pages reload the page.
      </p>
      <main>
        <PagePanel
          mode="dynamic"
          router="Pages Router"
          why="getServerSideProps runs on every request; the Pages Router waits for everything, so all pieces are in the first HTML."
          file={`${SOURCE}/pages/admin.tsx`}
          guide={GUIDES.components}
        />
        <h1>Admin</h1>
        {session ? (
          <p>
            Signed in as <b>{session.user}</b> ({session.role}).{' '}
            {session.role !== 'admin' &&
              'The Inventory island below refuses you: your token has no admin role.'}
          </p>
        ) : (
          <p>
            <a href="/store/en/account">Sign in</a> as an admin to use this
            page.
          </p>
        )}
        <Embedded
          {...piece({
            kind: 'island',
            remote: 'account',
            name: 'Inventory',
            cache: 'per-request',
            isPrivate: true,
            notes: [
              'The Account remote checks the role claim in the signed token.',
            ],
          })}
        >
          <RemoteIsland
            {...inventory}
            fallback={<p>Sign in to see the inventory.</p>}
          />
        </Embedded>
        <h2>Publish the catalog</h2>
        <p>
          The storefront caches the CDP and PDP islands for up to an hour.
          Publishing expires them now (<code>revalidateIsland</code>): the next
          visit to a page regenerates it with fresh island HTML. Watch the
          &quot;rendered at&quot; time in the grid on the{' '}
          <a href="/store/en">home page</a>.
        </p>
        <form action="/store/api/publish" method="post">
          <button disabled={session?.role !== 'admin'}>
            Publish (revalidate CDP and PDP)
          </button>{' '}
          {published && (
            <output>
              Published at{' '}
              {new Date(Number(published)).toISOString().slice(11, 19)} UTC.
            </output>
          )}
        </form>
        <h2>The live CDP grid</h2>
        <Embedded
          {...piece({
            kind: 'island',
            remote: 'cdp',
            name: 'ProductGrid',
            cache: 'per-request',
            notes: [
              'The same island as on the App Router home page, fetched here in getServerSideProps (not cached by this route).',
            ],
          })}
        >
          <RemoteIsland
            {...grid}
            fallback={<p>Products are unavailable right now.</p>}
          />
        </Embedded>
      </main>
    </>
  )
}
