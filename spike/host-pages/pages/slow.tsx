import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelope: IslandEnvelope | null };

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    envelope: await getIslandProps({
      remote: 'a',
      island: 'Slow',
      props: { ms: 10_000 },
    }),
  },
});

export default function Page({ envelope }: Props) {
  return (
    <main>
      <PagesIsland
        envelope={envelope}
        remote="a"
        fallback={<p>remote too slow</p>}
      />
    </main>
  );
}
