'use client'
import { createContext } from 'react'

// Owned by the host: the components remote declares this module host-provided
// (never bundled), so the remote reads the host's own context object.
export const HostContext = createContext('NO-HOST-CONTEXT')
