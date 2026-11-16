import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { banner: IslandProps }

// Nothing listens on the `down` remote: the page renders the fallback.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    banner: await getIslandProps(ctx, {
      remote: 'down',
      island: 'Banner',
      props: { text: 'never' },
    }),
  },
})

export default function Page({ banner }: Props) {
  return (
    <main>
      <RemoteIsland {...banner} fallback={<p>remote unavailable</p>} />
    </main>
  )
}
