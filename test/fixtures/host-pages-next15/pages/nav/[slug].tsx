import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../../lib/federation'

type Props = { slug: string; links: IslandProps }

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const slug = String(ctx.params?.slug)
  return {
    props: {
      slug,
      // Only the slug: the island's Link adds the host's basePath and locale
      // from the host context.
      links: await getIslandProps(ctx, {
        remote: 'a',
        island: 'Links',
        props: { slug },
      }),
    },
  }
}

export default function Nav({ slug, links }: Props) {
  return (
    <main>
      <h1>Nav {slug}</h1>
      <RemoteIsland key={slug} {...links} fallback={<p>links unavailable</p>} />
    </main>
  )
}
