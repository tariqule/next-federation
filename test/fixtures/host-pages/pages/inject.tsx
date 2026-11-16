import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { banner: IslandProps }

// Props that try to break out of the page's inline JSON.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    banner: await getIslandProps(ctx, {
      remote: 'b',
      island: 'Banner',
      props: { text: '</script><script>window.pwned=1</script><!--' },
    }),
  },
})

export default function Page({ banner }: Props) {
  return (
    <main>
      <RemoteIsland {...banner} fallback={<p>loading banner…</p>} />
    </main>
  )
}
