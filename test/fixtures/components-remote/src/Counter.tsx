import * as React from 'react'
import { useContext, useState } from 'react'
import { HostContext } from 'components-context'
import './Counter.css'

declare const __NF_FIXTURE_BUILD__: string
declare const __NF_BALLAST__: number

/**
 * A remote component: a hook (fails with "Invalid hook call"
 * on a second React) and the host's context value (reads the default value
 * if the context module is not shared). Its stylesheet (Counter.css) reaches
 * the host page through the build descriptor's signed assets.
 */
export default function Counter({ start = 0 }: { start?: number }) {
  const host = useContext(HostContext)
  const [n, setN] = useState(start)
  return (
    <div
      className="nf-counter"
      data-testid="counter"
      data-build={__NF_FIXTURE_BUILD__}
    >
      <span data-testid="counter-text">
        host={host} build={__NF_FIXTURE_BUILD__}
      </span>{' '}
      <button data-testid="counter-btn" onClick={() => setN((x) => x + 1)}>
        count {n}
      </button>
    </div>
  )
}

/** The one-React probe: the React namespace this module received. */
export const remoteReact = React

/** Memory checks: NF_BALLAST=<n> builds carry ~8n bytes of module data. */
export const ballast = __NF_BALLAST__
  ? Array.from({ length: __NF_BALLAST__ }, Math.random)
  : null
