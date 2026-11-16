import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelopes: (IslandEnvelope | null)[] };

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    envelopes: await Promise.all([
      getIslandProps({
        remote: 'a',
        island: 'ProductPanel',
        props: { sku: 'A1' },
      }),
      getIslandProps({
        remote: 'a',
        island: 'ProductPanel',
        props: { sku: 'B2' },
      }),
      getIslandProps({
        remote: 'b',
        island: 'Banner',
        props: { text: 'Hello B' },
      }),
    ]),
  },
});

export default function Two({ envelopes }: Props) {
  const remotes = ['a', 'a', 'b'];
  return (
    <main>
      <h1>Two remotes, three islands</h1>
      {envelopes.map((envelope, i) => (
        <PagesIsland
          key={i}
          envelope={envelope}
          remote={remotes[i]}
          fallback={<p>remote unavailable</p>}
        />
      ))}
    </main>
  );
}
