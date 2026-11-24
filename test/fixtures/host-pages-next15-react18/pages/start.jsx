import Link from 'next/link'

// No island here: a client navigation to `/` mounts its island in the
// browser (react18.spec.ts).
export default function Start() {
  return (
    <main>
      <h1>Start</h1>
      <Link href="/" data-testid="to-island">
        To the island page
      </Link>
    </main>
  )
}
