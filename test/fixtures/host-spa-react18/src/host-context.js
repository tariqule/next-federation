import { createContext } from 'react'

// The host's `components-context` module (Counter's, host-provided): the
// remote reads this context object, so the provider's value.
export const HostContext = createContext('NO-HOST-CONTEXT')
