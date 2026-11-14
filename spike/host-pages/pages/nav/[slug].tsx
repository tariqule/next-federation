import type { GetServerSideProps } from 'next';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';
import { PagesIsland } from '../../lib/PagesIsland';
import { BASE_PATH, getIslandProps } from '../../lib/federation';

type Props = { slug: string; envelope: IslandEnvelope | null };

export const getServerSideProps: GetServerSideProps<Props> = async ({
  params,
  locale,
  defaultLocale,
}) => {
  const slug = String(params?.slug);
  return {
    props: {
      slug,
      envelope: await getIslandProps({
        remote: 'a',
        island: 'Links',
        // The island renders full hrefs, so it needs basePath and the non-default locale.
        props: {
          slug,
          basePath: BASE_PATH,
          locale: locale === defaultLocale ? '' : locale,
        },
      }),
    },
  };
};

export default function Nav({ slug, envelope }: Props) {
  return (
    <main>
      <h1>Nav {slug}</h1>
      <PagesIsland
        key={slug}
        envelope={envelope}
        remote="a"
        fallback={<p>loading links…</p>}
      />
    </main>
  );
}
