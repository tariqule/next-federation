import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { slow: IslandProps }

// Slower than the island timeout: the page renders the fallback.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    slow: await getIslandProps(ctx, {
      remote: 'a',
      island: 'Slow',
      props: { ms: 10_000 },
    }),
  },
})

export default function Page({ slow }: Props) {
  return (
    <main>
      <RemoteIsland {...slow} fallback={<p>remote too slow</p>} />
    </main>
  )
}
