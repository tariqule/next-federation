import { RemoteIsland } from '../../lib/federation'

export default function Inject() {
  return (
    <main>
      <h1>Injection</h1>
      <RemoteIsland
        remote="b"
        island="Banner"
        props={{ text: '</script><script>window.pwned=1</script><!--' }}
        fallback={<p>loading banner…</p>}
      />
    </main>
  )
}
