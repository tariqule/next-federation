// Test island: answers after `ms` milliseconds, to exercise host timeouts.
export default async function Slow({ ms }: { ms: number }) {
  await new Promise((r) => setTimeout(r, ms))
  return <p data-island="Slow">finally</p>
}
