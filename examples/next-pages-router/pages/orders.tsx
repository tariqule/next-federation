import type { GetServerSideProps } from 'next'
import { useRouter } from 'next/router'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { Embedded } from '../lib/Embedded'
import { getIslandProps } from '../lib/federation'

type Props = { user: string | null; orders: IslandProps }

// A private island: the token is minted and used on the server only. The page
// props carry the rendered envelope, never a token.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    user: ctx.req.cookies['demo-user'] ?? null,
    orders: await getIslandProps(ctx, {
      remote: 'shop',
      island: 'MyOrders',
      private: true,
    }),
  },
})

export default function Orders({ user, orders }: Props) {
  // A plain form post does not get the basePath added: add it here.
  const action = `${useRouter().basePath}/api/session`
  return (
    <main>
      <h1>My orders</h1>
      {/* DEMO ONLY: see pages/api/session.ts. */}
      <form action={action} method="post">
        {user ? (
          <>
            Signed in as <b>{user}</b> <button>Sign out</button>
          </>
        ) : (
          <>
            <input name="user" placeholder="any name" required />{' '}
            <button>Sign in</button>
          </>
        )}
      </form>
      <Embedded remote="shop" name="MyOrders" isPrivate>
        <RemoteIsland
          {...orders}
          fallback={<p>Sign in to see your orders.</p>}
        />
      </Embedded>
    </main>
  )
}
