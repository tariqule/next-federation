import type { ReactNode } from 'react'
import { InspectBadge } from './client'
import { REMOTES } from './remotes'
import type { EmbedInfo } from './remotes'

export { REMOTES } from './remotes'
export type { CacheMode, EmbedInfo, RemoteName, Router } from './remotes'
export { ARRIVALS_SCRIPT } from './arrivals'

/**
 * Demo only: the dashed outline and tag around a piece of the page that a
 * remote serves (or that the host owns), plus the "How is this page built?"
 * badge. Host markup that wraps the island or component and never goes
 * inside it. Works in Server Components, the Pages Router and the SPA.
 */
export function Embedded({
  children,
  ...info
}: EmbedInfo & { children: ReactNode }) {
  const remote = info.remote ? REMOTES[info.remote] : null
  return (
    <div
      className={`embedded embedded-${info.remote ?? 'host'}`}
      data-embed={info.name}
    >
      <small className="embedded-tag">
        <span className="tag-long">
          {info.isPrivate ? 'private ' : ''}
          {info.kind}{' '}
        </span>
        <code>{info.name}</code>
        {remote ? (
          <>
            <span className="tag-long"> from the</span> <b>{remote.label}</b>
            <span className="tag-long"> remote</span>
          </>
        ) : null}
      </small>
      <InspectBadge info={info} />
      <div className="embedded-body">{children}</div>
    </div>
  )
}
