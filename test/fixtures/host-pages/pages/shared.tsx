import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

// React sharing with a host-provided React: `_app` calls provideHostReact()
// on this route only, so islands built on this host's exact React version
// run on it and download no React (test/e2e/sharing-next.spec.ts).
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
        remote: 'b',
        island: 'Banner',
        props: { text: 'Hello B' },
      }),
    ]),
  },
})

export default function Shared({ islands }: Props) {
  return (
    <main>
      <h1>Host-provided React</h1>
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
