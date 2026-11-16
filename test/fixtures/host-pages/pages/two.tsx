import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { islands: IslandProps[] }

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    islands: await Promise.all([
      getIslandProps(ctx, {
        remote: 'a',
        island: 'ProductPanel',
        props: { sku: 'A1' },
      }),
      getIslandProps(ctx, {
        remote: 'a',
        island: 'ProductPanel',
        props: { sku: 'B2' },
      }),
      getIslandProps(ctx, {
        remote: 'b',
        island: 'Banner',
        props: { text: 'Hello B' },
      }),
    ]),
  },
})

export default function Two({ islands }: Props) {
  return (
    <main>
      <h1>Two remotes, three islands</h1>
      {islands.map((island, i) => (
        <RemoteIsland
          key={i}
          {...island}
          fallback={<p>remote unavailable</p>}
        />
      ))}
    </main>
  )
}
