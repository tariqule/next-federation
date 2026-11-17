import { copy, version } from 'components-fallback-lib'

/**
 * Reads a module shared with `fallback: true` (requiredVersion ^2.0.0): the
 * host's copy when it provides a satisfying one, else this build's own.
 */
export default function Versioned() {
  return (
    <span data-testid="versioned">
      {copy}@{version}
    </span>
  )
}
