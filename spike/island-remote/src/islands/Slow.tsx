// Test island: answers after `ms` milliseconds, to exercise host timeouts.
export default async function Slow({ ms }: { ms: number }) {
  await new Promise((r) => setTimeout(r, ms));
  return <p data-island="Slow">finally</p>;
}

// One loadCss() per module: plugin-rsc 0.5.39 only wires the first call in a module in builds.
export const islandCss = () => import.meta.viteRsc.loadCss();
