import type { ReactNode } from 'react'

export type Session = {
  /** The signed-in user's display name, or null. */
  user: string | null
  role: 'customer' | 'admin' | null
  /** False until the host's session route answered. */
  loaded: boolean
}

export declare function SessionProvider(props: {
  /** The host's same-origin session route (GET answers { user, role }). */
  endpoint?: string
  children: ReactNode
}): ReactNode
export declare function useSession(): Session
