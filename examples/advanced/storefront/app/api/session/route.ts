import { cookies } from 'next/headers'
import { sessionFrom } from '../../../lib/session'

// DEMO ONLY: "signs in" whoever is named in the form, with plain cookies and
// no password, as a customer or an admin. Use your real authentication;
// next-federation only needs getIdentity() (lib/federation.ts).

/** Who is signed in, for the session context (display data, no token). */
export async function GET() {
  const store = await cookies()
  const session = sessionFrom((name) => store.get(name)?.value)
  return Response.json(session ?? { user: null, role: null }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function POST(request: Request) {
  const form = await request.formData()
  const user = String(form.get('user') ?? '')
    .replace(/[^\w-]/g, '')
    .slice(0, 32)
  const role = form.get('role') === 'admin' ? 'admin' : 'customer'
  // Only paths of this app (no open redirect).
  const next = String(form.get('next') ?? '/en/account')
  const path = /^\/[\w/-]*$/.test(next) ? next : '/en/account'
  const response = new Response(null, {
    status: 303,
    headers: { Location: `/store${path}` },
  })
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  const cookie = (name: string, value: string) =>
    value
      ? `${name}=${value}; Path=/store; HttpOnly; SameSite=Lax${secure}`
      : `${name}=; Path=/store; Max-Age=0${secure}`
  response.headers.append('Set-Cookie', cookie('demo-user', user))
  response.headers.append('Set-Cookie', cookie('demo-role', user ? role : ''))
  return response
}
