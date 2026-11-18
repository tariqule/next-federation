import type { ReactNode } from 'react'

// Demo only: outlines a piece of the page that a remote serves and names it.
// The tag sits next to the embedded markup, never inside it.
const REMOTES = {
  shop: { kind: 'island', app: 'vite-remote' },
  cart: { kind: 'remote component', app: 'components-remote' },
}

export function Embedded({
  remote,
  name,
  isPrivate,
  children,
}: {
  remote: keyof typeof REMOTES
  name: string
  isPrivate?: boolean
  children: ReactNode
}) {
  const { kind, app } = REMOTES[remote]
  return (
    <div className={`embedded embedded-${remote}`}>
      <small className="embedded-tag">
        {isPrivate ? 'private ' : ''}
        {kind} <code>{name}</code> from the <code>{remote}</code> remote ({app})
      </small>
      {children}
    </div>
  )
}
