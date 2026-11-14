import './ProductPanel.css';
import { Counter } from './Counter';

export default async function Banner({ text }: { text: string }) {
  return (
    <aside className="nf-product-panel" data-island="Banner">
      <strong data-testid="banner-text">{text}</strong>
      <Counter />
    </aside>
  );
}

// One loadCss() per module: plugin-rsc 0.5.39 only wires the first call in a module in builds.
export const islandCss = () => import.meta.viteRsc.loadCss();
