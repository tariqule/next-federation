import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelope: IslandEnvelope | null };

// Private island: the token is minted and used here on the server only; the page props
// carry the rendered envelope, never the token.
export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
}) => {
  const sub = req.cookies['nf-user'];
  // Spike-only hook so e2e can force an expired token.
  const testTtl = req.cookies['nf-test-ttl'];
  return {
    props: {
      envelope: sub
        ? await getIslandProps({
            remote: 'a',
            island: 'MyOrders',
            sub,
            ttlSeconds: testTtl === undefined ? undefined : Number(testTtl),
          })
        : null,
    },
  };
};

export default function Orders({ envelope }: Props) {
  return (
    <main>
      <h1>My orders</h1>
      <PagesIsland
        envelope={envelope}
        remote="a"
        fallback={<p>orders unavailable</p>}
      />
    </main>
  );
}
