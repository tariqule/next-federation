import { RemoteIsland } from '../../lib/federation'

// Review Focus 2: envelopes the host must refuse (fake remote cases). Each
// shows its fallback; nothing of the envelope reaches the page.
const CASES = [
  ['ForeignBootstrap', 'tampered-foreign', 'foreign unavailable'],
  ['VersionTwo', 'tampered-v2', 'protocol 2 unavailable'],
  ['NotJson', 'tampered-not-json', 'not json unavailable'],
] as const

export default function Tampered() {
  return (
    <main>
      <h1>Tampered envelopes</h1>
      {CASES.map(([island, testId, text]) => (
        <RemoteIsland
          key={island}
          remote="fake"
          island={island}
          fallback={<p>loading…</p>}
          errorFallback={<p data-testid={testId}>{text}</p>}
        />
      ))}
    </main>
  )
}
