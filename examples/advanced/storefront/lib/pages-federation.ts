// Pages Router: import from getServerSideProps and API routes only, which
// Next removes from the browser bundle.
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'
import { federation } from './federation.config'
import { claimsOf, sessionFrom } from './session'

const getIdentity: PagesIdentity = (req) =>
  claimsOf(sessionFrom((name) => req.cookies[name]))

export const { getIslandProps } = createPagesIslands(federation, {
  getIdentity,
})
export { federation }
