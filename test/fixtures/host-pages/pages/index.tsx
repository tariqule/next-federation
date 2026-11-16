import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { product: IslandProps }

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    product: await getIslandProps(ctx, {
      remote: 'a',
      island: 'ProductPanel',
      props: { sku: 'A1' },
    }),
  },
})

export default function Home({ product }: Props) {
  return (
    <main>
      <h1>Pages Router host</h1>
      <RemoteIsland {...product} fallback={<p>product unavailable</p>} />
    </main>
  )
}
