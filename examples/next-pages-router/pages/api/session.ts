import type { NextApiRequest, NextApiResponse } from 'next'

// DEMO ONLY: "signs in" whoever is named in the form, with a plain cookie and
// no password. Use your real authentication; next-federation only needs
// getIdentity() (lib/federation.ts) to return the signed-in user.
export default function session(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = String(req.body?.user ?? '')
    .replace(/[^\w-]/g, '')
    .slice(0, 32)
  res.setHeader(
    'Set-Cookie',
    user
      ? `demo-user=${user}; Path=/; HttpOnly; SameSite=Lax`
      : 'demo-user=; Path=/; Max-Age=0'
  )
  res.redirect(303, '/shop/orders')
}
