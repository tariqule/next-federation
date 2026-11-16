import type { GetStaticProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { banner: IslandProps }

// Public island on an ISR page: the page stays static (gate i); its own
// `revalidate` is the island's cache. A failed island would keep the fallback
// for the whole window, so a page without the envelope retries after 1 s.
export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const banner = await getIslandProps(ctx, {
    remote: 'b',
    island: 'Banner',
    props: { text: 'static banner' },
  })
  return { props: { banner }, revalidate: banner.envelope ? 60 : 1 }
}

export default function StaticPage({ banner }: Props) {
  return (
    <main>
      <h1>Static page</h1>
      <RemoteIsland {...banner} fallback={<p>banner unavailable</p>} />
    </main>
  )
}
