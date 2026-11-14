import { Counter } from './Counter';
import { Link } from './Link';

// Hrefs are host-relative and include basePath/locale, which the host passes in (design §6).
export default async function Links({
  slug,
  basePath = '',
  locale = '',
}: {
  slug: string;
  basePath?: string;
  locale?: string;
}) {
  const other = slug === 'one' ? 'two' : 'one';
  const prefix = `${basePath}${locale ? `/${locale}` : ''}`;
  return (
    <nav data-island="Links">
      <span data-testid="slug">on {slug}</span>{' '}
      <Link href={`${prefix}/nav/${other}`}>go to {other}</Link> <Counter />
    </nav>
  );
}

// One loadCss() per module: plugin-rsc 0.5.39 only wires the first call in a module in builds.
export const islandCss = () => import.meta.viteRsc.loadCss();
