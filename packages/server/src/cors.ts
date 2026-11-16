/**
 * CORS headers for a request. Only an exact `Origin` match against `hosts` gets allow-origin
 * (never `*`); `Vary: Origin` is always present so shared caches key on the origin.
 */
export function corsHeaders(
  req: Request,
  hosts: readonly string[]
): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = { vary: 'Origin' }
  if (origin !== null && origin !== '*' && hosts.includes(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] =
      'Authorization, Content-Type, X-NF-Action'
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    headers['access-control-max-age'] = '600'
  }
  return headers
}
