import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../lib/PagesIsland';
import { getIslandProps } from '../lib/federation';

type Props = { envelope: IslandEnvelope | null };

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    envelope: await getIslandProps({
      remote: 'b',
      island: 'Banner',
      props: { text: '</script><script>window.pwned=1</script><!--' },
    }),
  },
});

export default function Page({ envelope }: Props) {
  return (
    <main>
      <PagesIsland
        envelope={envelope}
        remote="b"
        fallback={<p>loading banner…</p>}
      />
    </main>
  );
}
