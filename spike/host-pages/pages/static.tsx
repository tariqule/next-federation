import type { GetStaticProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelope: IslandEnvelope | null };

// Public island on an ISR page: must stay static (gate i).
export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    envelope: await getIslandProps({
      remote: 'b',
      island: 'Banner',
      props: { text: 'static banner' },
    }),
  },
  revalidate: 60,
});

export default function StaticPage({ envelope }: Props) {
  return (
    <main>
      <h1>Static page</h1>
      <PagesIsland
        envelope={envelope}
        remote="b"
        fallback={<p>loading banner…</p>}
      />
    </main>
  );
}
