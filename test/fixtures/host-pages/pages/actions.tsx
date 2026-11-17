import type { GetStaticProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { a1: IslandProps; a2: IslandProps; b: IslandProps }

// Public islands with Server Actions on an ISR page (see app/actions in
// host-app): static, yet each action runs as the current user.
export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const [a1, a2, b] = await Promise.all([
    getIslandProps(ctx, { remote: 'a', island: 'Cart', props: { sku: 'A1' } }),
    getIslandProps(ctx, { remote: 'a', island: 'Cart', props: { sku: 'A2' } }),
    getIslandProps(ctx, { remote: 'b', island: 'Cart', props: { sku: 'B1' } }),
  ])
  const ok = a1.envelope && a2.envelope && b.envelope
  return { props: { a1, a2, b }, revalidate: ok ? 60 : 1 }
}

export default function ActionsPage({ a1, a2, b }: Props) {
  return (
    <main>
      <h1>Actions</h1>
      <div data-testid="mount-a1">
        <RemoteIsland {...a1} fallback={<p>cart unavailable</p>} />
      </div>
      <div data-testid="mount-a2">
        <RemoteIsland {...a2} fallback={<p>cart unavailable</p>} />
      </div>
      <div data-testid="mount-b">
        <RemoteIsland {...b} fallback={<p>cart unavailable</p>} />
      </div>
    </main>
  )
}
