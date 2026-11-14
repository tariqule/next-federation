import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelope: IslandEnvelope | null };

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    envelope: await getIslandProps({
      remote: 'down',
      island: 'Banner',
      props: { text: 'never' },
    }),
  },
});

export default function Page({ envelope }: Props) {
  return (
    <main>
      <PagesIsland
        envelope={envelope}
        remote="down"
        fallback={<p>remote unavailable</p>}
      />
    </main>
  );
}
