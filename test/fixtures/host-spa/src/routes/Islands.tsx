import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { federation, loadIsland } from '../lib/islands.ts'

// CSR host: envelopes are fetched in the browser (CORS) and mounted client-side.
export function Islands() {
  const [a, setA] = useState<IslandEnvelope>()
  const [b, setB] = useState<IslandEnvelope>()
  const [bannerText, setBannerText] = useState('Hello B')
  const [swapKey, setSwapKey] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    void loadIsland(federation.target('a'), 'ProductPanel', {
      sku: 'A1',
    }).then((r) => r.ok && setA(r.envelope))
  }, [])
  useEffect(() => {
    void loadIsland(federation.target('b'), 'Banner', {
      text: bannerText,
    }).then((r) => r.ok && setB(r.envelope))
  }, [bannerText])

  return (
    <main>
      <button onClick={() => setBannerText('Hello B2')}>bump</button>
      <button onClick={() => setSwapKey((k) => k + 1)}>swap</button>
      <button onClick={() => setVisible((v) => !v)}>toggle</button>
      {visible && (
        <div key={swapKey}>
          {a && <IslandMount envelope={a} />}
          {b && <IslandMount envelope={b} />}
        </div>
      )}
    </main>
  )
}
