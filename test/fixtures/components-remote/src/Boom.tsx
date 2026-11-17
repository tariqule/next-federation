/**
 * Throws while rendering (B1): on the server only (`where="server"`, like a
 * component that reads `window` during render), or everywhere.
 */
export default function Boom({
  where = 'always',
}: {
  where?: 'server' | 'always'
}) {
  if (where === 'always' || typeof window === 'undefined') {
    throw new Error(`Boom (${where}): render error thrown by the remote`)
  }
  return <span data-testid={`boom-${where}`}>rendered in the browser</span>
}
