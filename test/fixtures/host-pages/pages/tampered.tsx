import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

// Review Focus 2: envelopes the host must refuse (fake remote cases). Each
// shows its fallback; nothing of the envelope reaches the page.
const CASES = [
  ['ForeignBootstrap', 'tampered-foreign', 'foreign unavailable'],
  ['VersionTwo', 'tampered-v2', 'protocol 2 unavailable'],
  ['NotJson', 'tampered-not-json', 'not json unavailable'],
] as const

type Props = { islands: IslandProps[] }

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    islands: await Promise.all(
      CASES.map(([island]) => getIslandProps(ctx, { remote: 'fake', island }))
    ),
  },
})

export default function Tampered({ islands }: Props) {
  return (
    <main>
      <h1>Tampered envelopes</h1>
      {islands.map((island, i) => {
        const [, testId, text] = CASES[i]!
        return (
          <RemoteIsland
            key={testId}
            {...island}
            fallback={<p data-testid={testId}>{text}</p>}
          />
        )
      })}
    </main>
  )
}
