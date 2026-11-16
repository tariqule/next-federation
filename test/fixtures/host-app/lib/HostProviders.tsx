'use client'
import { HostContext } from 'components-context'
import type { ReactNode } from 'react'

export function HostProviders({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>
}
