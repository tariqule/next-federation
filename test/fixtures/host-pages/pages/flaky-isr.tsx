import type { GetStaticProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { flaky: IslandProps }

// ISR with the documented retry pattern (static.spec.ts): while the remote
// fails, a regeneration keeps the last good envelope (`stale: true`) and
// retries soon; without one it renders the fallback. 2 s instead of 60 here.
export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const flaky = await getIslandProps(ctx, {
    remote: 'fake',
    island: 'Flaky',
    props: { id: 'pages' },
  })
  return {
    props: { flaky },
    revalidate: flaky.envelope && !flaky.stale ? 2 : 1,
  }
}

export default function FlakyIsr({ flaky }: Props) {
  return (
    <main>
      <h1>Flaky ISR</h1>
      <RemoteIsland
        {...flaky}
        fallback={<p>loading flaky…</p>}
        errorFallback={<p>flaky unavailable</p>}
      />
    </main>
  )
}
