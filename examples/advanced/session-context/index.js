'use client'
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from 'react'

// Who is signed in, as a React context the hosts own. The header remote
// (remote components) declares this package host-provided, so it reads the
// host's context object, never a copy of its own.
//
// The value is display data only (a name and a role), never a token. The
// storefront's pages are prerendered static shells that cannot know the
// visitor, so the provider asks the host's own session route once in the
// browser (`endpoint`, same origin, sent with the session cookie).
const SessionContext = createContext(null)

const ANONYMOUS = { user: null, role: null, loaded: false }

export function SessionProvider({ endpoint, children }) {
  const [session, setSession] = useState(ANONYMOUS)
  useEffect(() => {
    if (!endpoint) return
    let live = true
    fetch(endpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live)
          setSession({
            user: body?.user ?? null,
            role: body?.role ?? null,
            loaded: true,
          })
      })
      .catch(() => live && setSession({ ...ANONYMOUS, loaded: true }))
    return () => {
      live = false
    }
  }, [endpoint])
  return createElement(SessionContext.Provider, { value: session }, children)
}

export function useSession() {
  return useContext(SessionContext) ?? ANONYMOUS
}
