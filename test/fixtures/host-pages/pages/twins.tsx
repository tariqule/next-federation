import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { islands: IslandProps[] }

// Review Focus 1: the same island with the same props, twice. Each mount gets
// its own id prefix, so the islands' `useId` ids never collide.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const spec = { remote: 'a', island: 'ProductPanel', props: { sku: 'A1' } }
  return {
    props: {
      islands: await Promise.all([
        getIslandProps(ctx, spec),
        getIslandProps(ctx, spec),
      ]),
    },
  }
}

export default function Twins({ islands }: Props) {
  return (
    <main>
      <h1>Twins</h1>
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
