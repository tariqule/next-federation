import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { orders: IslandProps }

// Private island: the token is minted and used on the server only; the page
// props carry the rendered envelope and the token endpoint, never a token.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    orders: await getIslandProps(ctx, {
      remote: 'a',
      island: 'MyOrders',
      private: true,
    }),
  },
})

export default function Orders({ orders }: Props) {
  return (
    <main>
      <h1>My orders</h1>
      <RemoteIsland {...orders} fallback={<p>orders unavailable</p>} />
    </main>
  )
}
