import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelope: IslandEnvelope | null };

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    envelope: await getIslandProps({
      remote: 'a',
      island: 'ProductPanel',
      props: { sku: 'A1' },
    }),
  },
});

export default function Home({ envelope }: Props) {
  return (
    <main>
      <h1>Pages Router host</h1>
      <PagesIsland
        envelope={envelope}
        remote="a"
        fallback={<p>loading product…</p>}
      />
    </main>
  );
}
